import "server-only";
import { getFollowupPool,withTransaction } from "@/lib/followup-db";
import { decryptMetaSecret } from "@/lib/meta-secret";
import { MetaInputError } from "@/lib/meta-events";
import { consultingDestination,consultingLivePayload,consultingProductionOutcome } from "@/lib/consulting-meta-core";
import type { MetaStage,MetaUnit } from "@/lib/meta-core";

export async function setConsultingProduction(unit:MetaUnit,enabled:boolean,actor:string,confirmed:boolean) {
  if(enabled&&(!confirmed||process.env.CONSULTING_META_PRODUCTION!=="enabled"))throw new MetaInputError("Confirme a liberação e habilite CONSULTING_META_PRODUCTION no servidor.",409);
  return withTransaction(async c=>{
    const s=(await c.query("SELECT c.*,m.encrypted_access_token FROM followup.consulting_meta_settings c JOIN followup.meta_unit_settings m USING(unit) WHERE unit=$1 FOR UPDATE OF c",[unit])).rows[0];
    if(!s)throw new MetaInputError("Unidade não configurada.",404);
    if(s.production_enabled===enabled)return {enabled,enabledAt:s.production_enabled_at};
    if(enabled){
      if(!s.encrypted_access_token||!s.page_id||!s.dataset_id)throw new MetaInputError("Configure token, Página e dataset de fallback antes de liberar.",409);
      const pilots=await c.query(`SELECT count(DISTINCT event_type)::int AS total FROM followup.consulting_meta_events
        WHERE unit=$1 AND test_state='accepted' AND tested_at>now()-interval '7 days'
        AND event_type IN ('conversation_started','lead_qualified','payment_requested','appointment_confirmed')
        AND test_result->>'datasetId'=$2 AND test_result->>'pageId'=$3`,[unit,s.dataset_id,s.page_id]);
      if(pilots.rows[0].total!==4)throw new MetaInputError("Conclua os quatro testes nesta unidade/destino antes de liberar.",409);
    }
    const row=(await c.query(`UPDATE followup.consulting_meta_settings SET production_enabled=$2,test_only=NOT $2,
      production_enabled_at=CASE WHEN $2 THEN clock_timestamp() ELSE NULL END WHERE unit=$1 RETURNING production_enabled_at`,[unit,enabled])).rows[0];
    await c.query("UPDATE followup.consulting_meta_policy SET enabled=$2,enabled_at=CASE WHEN $2 THEN (SELECT production_enabled_at FROM followup.consulting_meta_settings WHERE unit=$1) ELSE NULL END WHERE unit=$1",[unit,enabled]);
    if(!enabled)await c.query("UPDATE followup.consulting_meta_events SET production_state='excluded',production_result=$2::jsonb WHERE unit=$1 AND production_state IN ('queued','preparing')",[unit,JSON.stringify({reason:"Produção pausada; não há recuperação retroativa."})]);
    await c.query("INSERT INTO followup.meta_admin_audit(unit,action,actor) VALUES($1,$2,$3)",[unit,enabled?"consulting_enable_production":"consulting_disable_production",actor]);
    return {enabled,enabledAt:row.production_enabled_at};
  });
}

export async function setConsultingProductionPolicy(unit:MetaUnit,eventType:string,enabled:boolean,actor:string) {
  return withTransaction(async c=>{
    const setting=(await c.query("SELECT production_enabled FROM followup.consulting_meta_settings WHERE unit=$1 FOR UPDATE",[unit])).rows[0];
    if(!setting?.production_enabled)throw new MetaInputError("Unidade não habilitada para produção.",409);
    const row=await c.query("UPDATE followup.consulting_meta_policy SET enabled=$3,enabled_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END WHERE unit=$1 AND event_type=$2 AND enabled IS DISTINCT FROM $3 RETURNING event_type",[unit,eventType,enabled]);
    if(!enabled)await c.query("UPDATE followup.consulting_meta_events SET production_state='excluded',production_result=$3::jsonb WHERE unit=$1 AND event_type=$2 AND production_state IN ('queued','preparing')",[unit,eventType,JSON.stringify({reason:"Tipo de evento pausado; sem backfill."})]);
    if(row.rowCount)await c.query("INSERT INTO followup.meta_admin_audit(unit,action,actor,event_type) VALUES($1,$2,$3,$4)",[unit,enabled?"consulting_enable_type":"consulting_disable_type",actor,eventType]);
    return {enabled};
  });
}

// Both ingestion and delivery enforce cutoff, synthetic exclusion, policies and exact activation generation.
const eligibleSql=`e.production_eligible AND NOT e.is_synthetic AND NOT i.is_synthetic
 AND e.test_state='new' AND i.test_state='new' AND s.production_enabled AND p.enabled
 AND e.production_activation_at=s.production_enabled_at
 AND e.occurred_at>=s.production_enabled_at AND e.created_at>=s.production_enabled_at
 AND i.occurred_at>=s.production_enabled_at AND i.created_at>=s.production_enabled_at
 AND e.occurred_at>=p.enabled_at AND e.created_at>=p.enabled_at`;
const joins=`JOIN followup.consulting_meta_events i ON i.id=COALESCE(e.conversation_id,e.id) AND i.unit=e.unit
 JOIN followup.consulting_meta_settings s ON s.unit=e.unit
 JOIN followup.consulting_meta_policy p ON p.unit=e.unit AND p.event_type=e.event_type`;

export async function dispatchConsultingProduction(limit=5) {
  const summary={processed:0,accepted:0,failed:0,unknown:0,retried:0};
  if(process.env.CONSULTING_META_PRODUCTION!=="enabled")return {...summary,disabled:true};
  const db=getFollowupPool();
  // A lost response after POST is never silently replayed.
  await withTransaction(async c=>{
    const stale=await c.query(`UPDATE followup.consulting_meta_events SET production_state='unknown',production_result=$1::jsonb
      WHERE production_state='sending' AND production_started_at<now()-interval '2 minutes' RETURNING id`,[JSON.stringify({reason:"Worker interrompido após iniciar POST; conferir na Meta antes de reprocessar."})]);
    for(const row of stale.rows)await c.query("UPDATE followup.consulting_meta_delivery_attempts SET outcome='unknown',finished_at=now() WHERE event_id=$1 AND outcome='sending'",[row.id]);
    await c.query("UPDATE followup.consulting_meta_events SET production_state='queued',production_next_at=now() WHERE production_state='preparing' AND production_started_at<now()-interval '2 minutes'");
    await c.query(`UPDATE followup.consulting_meta_events e SET production_state='excluded',production_result=$1::jsonb
      WHERE e.production_state='queued' AND NOT EXISTS(SELECT 1 FROM followup.consulting_meta_events e2
        ${joins.replaceAll("e.","e2.")} WHERE e2.id=e.id AND ${eligibleSql.replaceAll("e.","e2.")})`,[JSON.stringify({reason:"Configuração, corte temporal ou elegibilidade removidos."})]);
  });
  for(let n=0;n<Math.min(Math.max(limit,1),20);n++){
    const event=await withTransaction(async c=>{
      const found=await c.query(`SELECT e.*,i.encrypted_ctwa AS click,i.source_id AS ad,i.ph_hash AS ph,i.fn_hash AS fn,i.ln_hash AS ln,
        s.page_id,s.dataset_id,s.production_enabled_at,m.encrypted_access_token FROM followup.consulting_meta_events e ${joins}
        JOIN followup.meta_unit_settings m ON m.unit=e.unit WHERE e.production_state='queued'
        AND e.production_next_at<=now() AND ${eligibleSql} ORDER BY e.production_next_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1`);
      const row=found.rows[0];if(!row)return null;
      await c.query("UPDATE followup.consulting_meta_events SET production_state='preparing',production_started_at=now(),production_preflights=production_preflights+1 WHERE id=$1",[row.id]);
      return row;
    });
    if(!event)break;
    let destination:ReturnType<typeof consultingDestination>;let payload:ReturnType<typeof consultingLivePayload>;let token:string;
    const version=process.env.META_GRAPH_API_VERSION?.trim();let transient=false;
    try{
      if(!version||!/^v\d+\.\d+$/.test(version)||!event.encrypted_access_token)throw new Error("Configure versão Graph e credencial Meta.");
      if(+event.occurred_at<Date.now()-7*86400_000)throw new Error("Evento fora da janela de sete dias.");
      token=decryptMetaSecret(event.encrypted_access_token);let ad=null;
      if(event.ad){
        const r=await fetch(`https://graph.facebook.com/${version}/${event.ad}?fields=id,tracking_specs`,{headers:{Authorization:`Bearer ${token}`},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(5000)});
        transient=r.status===429||r.status>=500;
        if(!r.ok)throw new Error(`Falha de leitura do anúncio: HTTP ${r.status}. Verifique permissões.`);
        const body=await r.json();if(body.id!==event.ad)throw new Error("ID de anúncio divergente.");ad={...body,tracking_specs:body.tracking_specs??[]};
      }
      destination=consultingDestination(ad,{pageId:event.page_id,datasetId:event.dataset_id});
      payload=consultingLivePayload({id:event.id,stage:event.event_type as MetaStage,occurredAt:event.occurred_at,value:event.value===null?null:Number(event.value)},
        {ctwa:event.click?decryptMetaSecret(event.click):"",ph:event.ph,fn:event.fn,ln:event.ln},destination.pageId);
    }catch(e){
      if(e instanceof Error&&["TimeoutError","AbortError","TypeError"].includes(e.name))transient=true;
      const retry=transient&&event.production_preflights<4;
      await db.query("UPDATE followup.consulting_meta_events SET production_state=$2,production_result=$3::jsonb,production_next_at=now()+interval '1 minute' WHERE id=$1 AND production_state='preparing'",[event.id,retry?"queued":"failed",JSON.stringify({phase:"preflight",reason:transient?"Falha transitória ao consultar o anúncio.":e instanceof Error?e.message:"Configuração inválida."})]);
      if(retry)summary.retried++;else summary.failed++;continue;
    }
    // Check policies once more after external GETs and durably record the POST attempt.
    const claim=await withTransaction(async c=>{
      await c.query("SELECT unit FROM followup.consulting_meta_settings WHERE unit=$1 FOR UPDATE",[event.unit]);
      const current=await c.query(`SELECT e.id FROM followup.consulting_meta_events e ${joins} WHERE e.id=$1 AND e.production_state='preparing' AND ${eligibleSql}`,[event.id]);
      if(!current.rowCount){await c.query("UPDATE followup.consulting_meta_events SET production_state='excluded' WHERE id=$1 AND production_state='preparing'",[event.id]);return null;}
      const row=(await c.query("UPDATE followup.consulting_meta_events SET production_state='sending',production_started_at=now(),production_attempts=production_attempts+1 WHERE id=$1 RETURNING production_attempts",[event.id])).rows[0];
      await c.query("INSERT INTO followup.consulting_meta_delivery_attempts(event_id,attempt) VALUES($1,$2)",[event.id,row.production_attempts]);
      return row.production_attempts as number;
    });
    if(claim===null)continue;
    summary.processed++;let status:number|null=null,received=0,hasError=false,code:number|null=null,subcode:number|null=null,trace:string|null=null;
    const start=Date.now();
    try{
      const r=await fetch(`https://graph.facebook.com/${version}/${destination.datasetId}/events`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
      status=r.status;const body=await r.json();received=Number(body.events_received)||0;hasError=Boolean(body.error);code=typeof body.error?.code==="number"?body.error.code:null;subcode=typeof body.error?.error_subcode==="number"?body.error.error_subcode:null;
      const value=body.fbtrace_id||body.error?.fbtrace_id;trace=typeof value==="string"?value.slice(0,100):null;
    }catch{/* Unknown delivery; never auto retry. */}
    const state=consultingProductionOutcome(status,received,hasError,claim);
    const result={state,httpStatus:status,eventsReceived:received,errorCode:code,errorSubcode:subcode,fbtraceId:trace,...destination,production:true,eventName:payload.data[0].event_name,eventId:payload.data[0].event_id,durationMs:Date.now()-start,
      reason:state==="accepted"?"Recebido pela API Meta em produção; atribuição não garantida.":state==="unknown"?"Entrega inconclusiva; conferir na Meta antes de qualquer reenvio.":state==="queued"?"Limite da Meta: rejeição explícita sem eventos recebidos; repetição limitada.":"Rejeitado pela Meta. Corrija configuração/permissões; sem reenvio automático."};
    await withTransaction(async c=>{
      await c.query("UPDATE followup.consulting_meta_events SET production_state=$2,production_result=$3::jsonb,production_next_at=CASE WHEN $2='queued' THEN now()+interval '2 minutes' ELSE NULL END WHERE id=$1",[event.id,state,JSON.stringify(result)]);
      await c.query("UPDATE followup.consulting_meta_delivery_attempts SET outcome=$3,result=$4::jsonb,finished_at=now() WHERE event_id=$1 AND attempt=$2",[event.id,claim,state,JSON.stringify(result)]);
    });
    if(state==="accepted")summary.accepted++;else if(state==="unknown")summary.unknown++;else if(state==="queued")summary.retried++;else summary.failed++;
  }
  return summary;
}

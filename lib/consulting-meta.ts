import "server-only";
import { getFollowupPool, withTransaction } from "@/lib/followup-db";
import { MetaInputError } from "@/lib/meta-events";
import { digest, type MetaUnit, type MetaStage } from "@/lib/meta-core";
import { decryptMetaSecret, encryptMetaSecret } from "@/lib/meta-secret";
import { consultingDestination, consultingEventName, consultingProductionEligible, consultingTestPayload, validateConsultingEvent } from "@/lib/consulting-meta-core";

export async function recordConsultingEvent(body: unknown, unit: MetaUnit) {
  let input: ReturnType<typeof validateConsultingEvent>;
  try { input = validateConsultingEvent(body); } catch (e) { throw new MetaInputError(e instanceof Error ? e.message : "Evento inválido."); }
  if (input.unit !== unit) throw new MetaInputError("Token de outra unidade.", 403);
  const hash = digest(JSON.stringify(input));
  return withTransaction(async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [input.chatHash]);
    const old = (await c.query("SELECT id,input_hash,test_state,production_state FROM followup.consulting_meta_events WHERE unit=$1 AND event_type=$2 AND source_event_id=$3", [unit,input.stage,input.sourceEventId])).rows[0];
    if (old) {
      if (old.input_hash !== hash) throw new MetaInputError("ID já utilizado com dados diferentes.",409);
      return {id:old.id,duplicate:true,state:old.test_state,productionState:old.production_state};
    }
    // node-postgres decodes timestamptz as Date (milliseconds). Keep the activation
    // generation as PostgreSQL text so the worker's exact equality retains microseconds.
    const settings = (await c.query("SELECT *,production_enabled_at::text AS production_activation_exact FROM followup.consulting_meta_settings WHERE unit=$1 FOR SHARE", [unit])).rows[0];
    if (!settings || input.occurredAt < settings.capture_started_at) throw new MetaInputError("Somente novos acontecimentos de consultoria após a ativação desta área; histórico antigo não é importado.",409);
    // Deliberately never query legacy meta_events/meta_clicks or source lead databases.
    const conversation = input.stage === "conversation_started" ? null : (await c.query("SELECT id,is_synthetic,created_at,occurred_at,encrypted_ctwa FROM followup.consulting_meta_events WHERE unit=$1 AND chat_hash=$2 AND event_type='conversation_started' AND occurred_at <= $3 ORDER BY occurred_at DESC LIMIT 1", [unit,input.chatHash,input.occurredAt])).rows[0];
    if (input.stage !== "conversation_started" && !conversation) throw new MetaInputError("Registre primeiro a nova conversa de consultoria. Nenhum registro antigo será utilizado.",409);
    const policy=(await c.query("SELECT enabled_at FROM followup.consulting_meta_policy WHERE unit=$1 AND event_type=$2 AND enabled",[unit,input.stage])).rows[0];
    const synthetic=Boolean(input.isSynthetic||conversation?.is_synthetic);
    const eligible=consultingProductionEligible({enabled:settings.production_enabled,enabledAt:settings.production_enabled_at,policyAt:policy?.enabled_at||null,occurredAt:input.occurredAt,synthetic,conversationAt:conversation?.occurred_at||input.occurredAt,conversationCreatedAt:conversation?.created_at||new Date(),environmentEnabled:process.env.CONSULTING_META_PRODUCTION==="enabled"});
    const productionState=!consultingEventName(input.stage)?"internal":!eligible?"excluded":!(input.ctwa||conversation?.encrypted_ctwa)?"no_ctwa":"queued";
    try {
      const row = await c.query(`INSERT INTO followup.consulting_meta_events(unit,event_type,source_event_id,input_hash,chat_hash,occurred_at,conversation_id,encrypted_ctwa,source_id,ph_hash,fn_hash,ln_hash,transaction_hash,value,attribution,is_synthetic,production_eligible,production_activation_at,production_state,production_next_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,CASE WHEN $19='queued' THEN now() ELSE NULL END) RETURNING id,test_state,production_state`,
      [unit,input.stage,input.sourceEventId,hash,input.chatHash,input.occurredAt,conversation?.id || null,input.ctwa ? encryptMetaSecret(input.ctwa) : null,input.sourceId,input.ph,input.fn,input.ln,input.transactionHash,input.value,JSON.stringify(input.attribution ?? {}),synthetic,eligible,eligible?settings.production_activation_exact:null,productionState]);
      return {id:row.rows[0].id,duplicate:false,state:row.rows[0].test_state,productionState:row.rows[0].production_state};
    } catch(e) { if ((e as {code?:string}).code === "23505") throw new MetaInputError("Evento ou transação já registrado; não gere outra compra para o mesmo sinal.",409); throw e; }
  });
}

export async function consultingOverview(unit: MetaUnit) {
  const db = getFollowupPool();
  const settings = (await db.query("SELECT page_id,dataset_id,test_code,capture_started_at,production_enabled,production_enabled_at FROM followup.consulting_meta_settings WHERE unit=$1",[unit])).rows[0];
  const policies=(await db.query("SELECT event_type,enabled,enabled_at FROM followup.consulting_meta_policy WHERE unit=$1 ORDER BY event_type",[unit])).rows;
  const events = (await db.query(`SELECT id,event_type,occurred_at,value,test_state,test_result,attribution,is_synthetic,production_eligible,production_state,production_result,substr(chat_hash,1,8) AS reference
    FROM followup.consulting_meta_events WHERE unit=$1 ORDER BY created_at DESC LIMIT 100`,[unit])).rows;
  return {mode:settings?.production_enabled?"live":"test_only",productionAvailable:process.env.CONSULTING_META_PRODUCTION==="enabled",settings,policies,events};
}

export async function saveConsultingSettings(unit: MetaUnit, input: Record<string, unknown>, actor: string) {
  const id = (key:string) => { const value=input[key]; if (typeof value !== "string" || (value.trim() && !/^\d{5,30}$/.test(value.trim()))) throw new MetaInputError(`${key} inválido.`); return value.trim() || null; };
  if (typeof input.testCode !== "string" || !/^TEST[A-Za-z0-9_-]{1,50}$/.test(input.testCode.trim())) throw new MetaInputError("Código de teste obrigatório (TEST...).");
  await withTransaction(async c => {
    const stored=(await c.query("SELECT page_id,dataset_id,production_enabled FROM followup.consulting_meta_settings WHERE unit=$1 FOR UPDATE",[unit])).rows[0];
    if(stored?.production_enabled&&(stored.page_id!==id("pageId")||stored.dataset_id!==id("datasetId")))throw new MetaInputError("Pause a produção da unidade antes de trocar Página/dataset.",409);
    await c.query("UPDATE followup.consulting_meta_settings SET page_id=$2,dataset_id=$3,test_code=$4 WHERE unit=$1",[unit,id("pageId"),id("datasetId"),(input.testCode as string).trim()]);
    await c.query("INSERT INTO followup.meta_admin_audit(unit,action,actor) VALUES($1,'consulting_test_settings',$2)",[unit,actor]);
  });
}

/** Explicit one-shot test, separate from the production queue. */
export async function sendConsultingTest(unit: MetaUnit, id: unknown, actor: string, confirmed: boolean) {
  if (!confirmed) throw new MetaInputError("Confirme a transferência de novos dados de consultoria não relacionados à saúde.");
  if (process.env.META_EXPORT_MODE === "live") throw new MetaInputError("Mantenha META_EXPORT_MODE=record_only durante a homologação.",409);
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new MetaInputError("ID inválido.");
  const db = getFollowupPool();
  const setting = (await db.query(`SELECT c.*,s.encrypted_access_token FROM followup.consulting_meta_settings c
    JOIN followup.meta_unit_settings s USING(unit) WHERE unit=$1`,[unit])).rows[0];
  if (!setting?.encrypted_access_token) throw new MetaInputError("Salve o token Meta da unidade no painel.",409);
  const version=process.env.META_GRAPH_API_VERSION?.trim();
  if (!version || !/^v\d+\.\d+$/.test(version)) throw new MetaInputError("Configure META_GRAPH_API_VERSION no servidor.",409);
  const event=(await db.query(`SELECT e.*,i.encrypted_ctwa AS click,i.source_id AS ad,i.ph_hash AS ph,i.fn_hash AS fn,i.ln_hash AS ln
    FROM followup.consulting_meta_events e JOIN followup.consulting_meta_events i ON i.id=COALESCE(e.conversation_id,e.id) AND i.unit=e.unit
    WHERE e.id=$1 AND e.unit=$2`,[id,unit])).rows[0];
  if (!event || event.occurred_at < setting.capture_started_at) throw new MetaInputError("Evento novo de consultoria não encontrado.",404);
  if (event.production_eligible) throw new MetaInputError("Registro destinado à produção; não executar teste sobre ele.",409);
  if (event.test_state !== "new") throw new MetaInputError("Este teste já foi executado ou iniciado. Confira o resultado; não há reenvio automático.",409);
  if (+event.occurred_at < Date.now()-7*86400_000) throw new MetaInputError("Evento fora da janela de sete dias.",409);
  const token = decryptMetaSecret(setting.encrypted_access_token);
  let ad: unknown = null;
  if (event.ad) {
    const response=await fetch(`https://graph.facebook.com/${version}/${event.ad}?fields=id,tracking_specs`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new MetaInputError(`Não foi possível ler o anúncio (HTTP ${response.status}). Verifique token e permissões.`,409);
    const object=await response.json();
    if (object.id!==event.ad) throw new MetaInputError("Anúncio retornado não corresponde ao registrado.",409);
    ad = {...object,tracking_specs:object.tracking_specs ?? []};
  }
  let destination: ReturnType<typeof consultingDestination>; let payload: ReturnType<typeof consultingTestPayload>;
  try {
    destination=consultingDestination(ad,{pageId:setting.page_id,datasetId:setting.dataset_id});
    payload=consultingTestPayload({id:event.id,stage:event.event_type as MetaStage,occurredAt:event.occurred_at,value:event.value===null?null:Number(event.value)},
      {ctwa:event.click?decryptMetaSecret(event.click):"",ph:event.ph,fn:event.fn,ln:event.ln},destination.pageId,setting.test_code);
  } catch(e) { throw new MetaInputError(e instanceof Error?e.message:"Configuração inválida.",409); }
  const claimed=await db.query("UPDATE followup.consulting_meta_events SET test_state='sending',tested_at=now() WHERE id=$1 AND unit=$2 AND test_state='new' RETURNING id",[id,unit]);
  if (!claimed.rowCount) throw new MetaInputError("Teste já iniciado em outra requisição.",409);
  const started=Date.now();
  let httpStatus: number | null = null;
  let result: Record<string,unknown>;
  try {
    const response=await fetch(`https://graph.facebook.com/${version}/${destination.datasetId}/events`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    httpStatus=response.status;
    const object=await response.json();
    const accepted=response.ok && Number(object.events_received)>0 && !object.error;
    result={state:accepted?"accepted":response.status>=500?"unknown":"failed",httpStatus:response.status,eventsReceived:Number(object.events_received)||0,errorCode:typeof object.error?.code==="number"?object.error.code:null,
      fbtraceId:typeof (object.fbtrace_id||object.error?.fbtrace_id)==="string"?(object.fbtrace_id||object.error.fbtrace_id).slice(0,100):null,
      reason:accepted?"Recebido pela API; confirme em Eventos de Teste. Isso não comprova atribuição ou suporte de otimização.":"Meta não confirmou o evento. Verifique código, token, permissões e compatibilidade de page_id/WhatsApp; não há fallback automático para produção."};
  } catch { result={state:"unknown",httpStatus,reason:"Resposta inconclusiva. Confira o Gerenciador antes de qualquer nova tentativa; nenhum reenvio automático será feito."}; }
  result={...result,...destination,testCode:setting.test_code,graphVersion:version,durationMs:Date.now()-started,testOnly:true,
    method:"POST",path:`/${version}/${destination.datasetId}/events`,eventName:payload.data[0].event_name};
  await withTransaction(async c => {
    await c.query("UPDATE followup.consulting_meta_events SET test_state=$2,test_result=$3::jsonb WHERE id=$1",[id,result.state,JSON.stringify(result)]);
    await c.query("INSERT INTO followup.meta_admin_audit(unit,action,actor,event_id) VALUES($1,'consulting_test_sent',$2,$3)",[unit,actor,id]);
  });
  return result;
}

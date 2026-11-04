// Narrow, explicit recovery for the confirmed millisecond/microsecond defect.
// Dry-run by default. No network requests, no general failed/unknown replay.
import { Client } from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function parseRecoveryArgs(args){
  const apply=args[0]==="--apply",dryRun=args[0]==="--dry-run";
  if(!apply&&!dryRun)throw new Error("Use --dry-run or --apply, exact activation and exactly two approved event UUIDs.");
  const [,activation,...ids]=args;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(activation||"")||!Number.isFinite(+new Date(activation))||ids.length!==2||new Set(ids).size!==2||ids.some(id=>!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)))throw new Error("Exact activation and two distinct approved UUIDs are required.");
  return {apply,activation,ids};
}
export const recoveryEligibilitySql=`SELECT e.id,e.production_activation_at::text AS previous_activation,
  s.production_enabled_at::text AS exact_activation
  FROM followup.consulting_meta_events e JOIN followup.consulting_meta_settings s USING(unit)
  JOIN followup.consulting_meta_policy p ON p.unit=e.unit AND p.event_type=e.event_type
  JOIN followup.meta_unit_settings m ON m.unit=e.unit
  WHERE e.id=ANY($1::uuid[]) AND e.unit='sender_1' AND e.event_type='conversation_started'
    AND s.production_enabled AND p.enabled AND s.production_enabled_at=$2::timestamptz
    AND m.encrypted_access_token IS NOT NULL AND s.page_id IS NOT NULL AND s.dataset_id IS NOT NULL
    AND e.production_eligible AND NOT e.is_synthetic AND e.test_state='new'
    AND e.conversation_id IS NULL AND e.encrypted_ctwa IS NOT NULL
    AND e.production_state='excluded' AND e.production_attempts=0 AND e.production_preflights=0
    AND e.production_result->>'reason'='Configuração, corte temporal ou elegibilidade removidos.'
    AND e.production_activation_at<>s.production_enabled_at
    AND e.production_activation_at=date_trunc('milliseconds',s.production_enabled_at)
    AND e.occurred_at>=s.production_enabled_at AND e.created_at>=s.production_enabled_at
    AND e.occurred_at>=p.enabled_at AND e.created_at>=p.enabled_at
    AND e.occurred_at>=s.capture_started_at AND e.occurred_at>=now()-interval '7 days' AND e.occurred_at<=now()
    AND NOT EXISTS(SELECT 1 FROM followup.consulting_meta_delivery_attempts a WHERE a.event_id=e.id)
  ORDER BY e.id FOR UPDATE OF e`;

export async function recoverConsultingActivation(client,args){
  const {apply,activation,ids}=parseRecoveryArgs(args);
  if(process.env.CONSULTING_META_PRODUCTION!=="enabled"||process.env.META_EXPORT_MODE!=="record_only")throw new Error("Consulting production must be enabled and legacy export must remain record_only.");
  await client.query("BEGIN");
  try{
    await client.query("SELECT unit FROM followup.consulting_meta_settings WHERE unit='sender_1' FOR UPDATE");
    const planned=await client.query(recoveryEligibilitySql,[ids,activation]);
    if(planned.rowCount!==2)throw new Error(`Expected exactly two still-eligible, never-attempted events; found ${planned.rowCount}. No changes applied.`);
    if(!apply){await client.query("ROLLBACK");return {dryRun:true,events:planned.rows};}
    for(const event of planned.rows){
      await client.query(`UPDATE followup.consulting_meta_events e SET
        production_activation_at=s.production_enabled_at,production_state='queued',production_next_at=now(),
        production_result=jsonb_build_object('reason','Correção de precisão da ativação; recuperação autorizada de evento elegível nunca enviado.',
          'recovery','activation_precision','previousActivation',e.production_activation_at::text,'recoveredAt',now())
        FROM followup.consulting_meta_settings s WHERE e.id=$1 AND s.unit=e.unit`,[event.id]);
      await client.query(`INSERT INTO followup.meta_admin_audit(unit,action,actor,event_id)
        VALUES('sender_1','consulting_activation_precision_recovery','deployment:explicit-two-event-recovery',$1)`,[event.id]);
    }
    await client.query("COMMIT");return {requeued:2,ids:planned.rows.map(row=>row.id)};
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const client=new Client({connectionString:process.env.DATABASE_URL});
  try{await client.connect();console.log(JSON.stringify(await recoverConsultingActivation(client,process.argv.slice(2))));}
  catch(e){console.error(e instanceof Error?e.message:"Recovery failed.");process.exitCode=1;}
  finally{await client.end().catch(()=>{});}
}

// Explicit, auditable deployment operation. Never queues history or changes legacy export mode.
import { Client } from "pg";

if(process.argv.length!==3||process.argv[2]!=="--enable-unit1-new-only"){
  console.error("Usage: node scripts/activate-consulting.mjs --enable-unit1-new-only");process.exit(1);
}
if(process.env.CONSULTING_META_PRODUCTION!=="enabled"||process.env.META_EXPORT_MODE!=="record_only"){
  console.error("Require CONSULTING_META_PRODUCTION=enabled and legacy META_EXPORT_MODE=record_only.");process.exit(1);
}
const c=new Client({connectionString:process.env.DATABASE_URL});
try{
  await c.connect();await c.query("BEGIN");
  const s=(await c.query(`SELECT c.*,m.encrypted_access_token FROM followup.consulting_meta_settings c
    JOIN followup.meta_unit_settings m USING(unit) WHERE unit='sender_1' FOR UPDATE OF c`)).rows[0];
  if(!s?.encrypted_access_token||!s.page_id||!s.dataset_id)throw new Error("Unit 1 token/page/dataset not configured.");
  if(!s.production_enabled){
    const pilots=(await c.query(`SELECT count(DISTINCT event_type)::int AS total FROM followup.consulting_meta_events
      WHERE unit='sender_1' AND test_state='accepted' AND tested_at>now()-interval '7 days'
      AND event_type IN ('conversation_started','lead_qualified','payment_requested','appointment_confirmed')
      AND test_result->>'datasetId'=$1 AND test_result->>'pageId'=$2`,[s.dataset_id,s.page_id])).rows[0].total;
    if(pilots!==4)throw new Error("Require four accepted pilot stages for Unit 1 destination within seven days.");
    await c.query(`UPDATE followup.consulting_meta_settings SET production_enabled=true,test_only=false,
      production_enabled_at=clock_timestamp() WHERE unit='sender_1'`);
    const policies=await c.query(`UPDATE followup.consulting_meta_policy SET enabled=true,
      enabled_at=(SELECT production_enabled_at FROM followup.consulting_meta_settings WHERE unit='sender_1')
      WHERE unit='sender_1' RETURNING event_type`);
    if(policies.rowCount!==4)throw new Error("Unexpected policy count; activation rolled back.");
    await c.query(`INSERT INTO followup.meta_admin_audit(unit,action,actor)
      VALUES('sender_1','consulting_enable_production','deployment:explicit-user-authorization-new-only')`);
  }
  await c.query("COMMIT");
  const state=await c.query(`SELECT unit,production_enabled,production_enabled_at,test_only FROM followup.consulting_meta_settings ORDER BY unit`);
  console.log(JSON.stringify({settings:state.rows,legacyExportMode:process.env.META_EXPORT_MODE}));
}catch(e){
  await c.query("ROLLBACK").catch(()=>{});console.error(e instanceof Error?e.message:"Activation failed.");process.exitCode=1;
}finally{await c.end().catch(()=>{});}

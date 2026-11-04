// Production-safe synthetic fixtures: record_only, no ad ID, no real lead/CTWA.
// Never replaces an existing unit token. All created fixtures are removed.
import { Client } from "pg";
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
if (process.env.META_EXPORT_MODE !== "record_only") throw new Error("Smoke exige META_EXPORT_MODE=record_only");
const db=new Client({connectionString:process.env.DATABASE_URL});
await db.connect();
const sha=(s)=>createHash("sha256").update(s).digest("hex");
const run="smoke-"+randomBytes(10).toString("hex");
const installed=[];
const chats=[];
try {
  for (const unit of ["sender_1","sender_2"]) {
    const token="mt_"+randomBytes(32).toString("base64url");
    const claim=await db.query("UPDATE followup.meta_unit_settings SET inbound_token_hash=$2 WHERE unit=$1 AND inbound_token_hash IS NULL RETURNING unit",[unit,sha(token)]);
    if (!claim.rowCount) { console.log(unit+": skipped (token existente preservado)"); continue; }
    installed.push({unit,hash:sha(token)});
    const chat=run+":"+unit; const chatHash=sha(unit+":"+chat); chats.push(chatHash);
    const time=(seconds)=>new Date(Date.now()-seconds*1000).toISOString();
    const call=async(body)=> {
      const r=await fetch("http://127.0.0.1:3000/api/integrations/n8n/meta-events",{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json","x-forwarded-proto":"https"},body:JSON.stringify(body)});
      const result=await r.json(); return {status:r.status,...result};
    };
    const phone="999"+BigInt("0x"+randomBytes(5).toString("hex")).toString().padStart(12,"0");
    const base={unit,chat_id:chat,phone,event_type:"conversation_started",occurred_at:time(120),source_event_id:run+unit+"first",ctwa_clid:"SyntheticClickIdentifierFirst",attribution:{utm_source:"synthetic",utm_campaign:"first",thumbnail_url:"https://example.com/thumb.jpg"}};
    assert.equal((await call({...base,unit:unit==="sender_1"?"sender_2":"sender_1"})).status,403);
    const first=await call(base); assert.equal(first.status,202); assert.equal(first.state,"awaiting_approval");
    assert.equal((await call(base)).status,200);
    assert.equal((await call({...base,attribution:{utm_campaign:"changed"}})).status,409);
    assert.equal((await call({...base,occurred_at:"bad"})).status,400);
    assert.equal((await call({...base,phone:phone.slice(0,-1)+(phone.endsWith("1")?"2":"1"),source_event_id:run+unit+"wrong-phone"})).status,409);
    const qualified=await call({unit,chat_id:chat,event_type:"lead_qualified",occurred_at:time(90),source_event_id:run+unit+"qualified"});
    assert.equal(qualified.status,202);
    assert.equal((await call({...base,source_event_id:run+unit+"second",occurred_at:time(60),ctwa_clid:"SyntheticClickIdentifierSecond",attribution:{utm_campaign:"second"}})).status,202);
    const payment=await call({unit,chat_id:chat,event_type:"payment_confirmed",occurred_at:time(30),source_event_id:run+unit+"payment"});
    assert.equal(payment.status,202); assert.equal(payment.state,"internal_only");
    const rows=(await db.query("SELECT id,ctwa_hash FROM followup.meta_events WHERE chat_hash=$1",[chatHash])).rows;
    assert.equal(rows.find(r=>r.id===qualified.id)?.ctwa_hash,sha(base.ctwa_clid));
    assert.equal(rows.find(r=>r.id===payment.id)?.ctwa_hash,null);
    for (const event_type of ["payment_requested","payment_pending"]) {
      const body={unit,chat_id:chat,event_type,occurred_at:time(20),source_event_id:run+unit+event_type};
      const result=await call(body);
      assert.equal(result.status,202); assert.equal(result.state,"internal_only");
      assert.equal((await call(body)).status,200);
      const storedInternal=(await db.query("SELECT ctwa_hash,encrypted_ctwa,click_id,dataset_id,page_id,source_id,export_eligible_at_ingest FROM followup.meta_events WHERE id=$1",[result.id])).rows[0];
      assert.deepEqual(storedInternal,{ctwa_hash:null,encrypted_ctwa:null,click_id:null,dataset_id:null,page_id:null,source_id:null,export_eligible_at_ingest:false});
    }
    const stored=(await db.query("SELECT attribution FROM followup.meta_events WHERE id=$1",[first.id])).rows[0];
    assert.deepEqual(stored.attribution,base.attribution);
    const clickData=(await db.query("SELECT attribution FROM followup.meta_clicks WHERE chat_hash=$1 ORDER BY observed_at",[chatHash])).rows;
    assert.equal(clickData[0].attribution.utm_campaign,"first"); assert.equal(clickData[1].attribution.utm_campaign,"second");
    const noClick=await call({unit,chat_id:chat+"empty",event_type:"conversation_started",occurred_at:time(10),source_event_id:run+unit+"empty",attribution:{utm_medium:"organic"}});
    chats.push(sha(unit+":"+chat+"empty"));
    assert.equal(noClick.status,202); assert.equal(noClick.state,"no_ctwa");
    assert.equal((await db.query("SELECT attribution FROM followup.meta_events WHERE id=$1",[noClick.id])).rows[0].attribution.utm_medium,"organic");
    const alias=chat+"alias"; chats.push(sha(unit+":"+alias));
    const shared=await call({unit,chat_id:alias,phone,event_type:"lead_qualified",occurred_at:time(10),source_event_id:run+unit+"shared"});
    assert.equal(shared.status,202);
    const flagged=(await db.query("SELECT identity_conflict FROM followup.meta_events WHERE id=$1",[shared.id])).rows[0];
    assert.equal(flagged.identity_conflict,true);
    console.log(unit+": auth, idempotência, identidade, metadados por clique e primeiro contato orgânico OK");
  }
} finally {
  await db.query("BEGIN");
  try {
    await db.query("DELETE FROM followup.meta_delivery_attempts WHERE event_id IN (SELECT id FROM followup.meta_events WHERE chat_hash=ANY($1::text[]))",[chats]);
    await db.query("DELETE FROM followup.meta_events WHERE chat_hash=ANY($1::text[])",[chats]);
    await db.query("DELETE FROM followup.meta_clicks WHERE chat_hash=ANY($1::text[])",[chats]);
    await db.query("DELETE FROM followup.meta_contacts WHERE chat_hash=ANY($1::text[])",[chats]);
    for (const row of installed) await db.query("UPDATE followup.meta_unit_settings SET inbound_token_hash=NULL WHERE unit=$1 AND inbound_token_hash=$2",[row.unit,row.hash]);
    await db.query("COMMIT"); console.log("Fixtures sintéticos removidos; nenhum evento Meta enviado.");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { await db.end(); }
}

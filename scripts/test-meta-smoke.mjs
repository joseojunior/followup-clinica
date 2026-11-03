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
    const base={unit,chat_id:chat,event_type:"conversation_started",occurred_at:time(120),source_event_id:run+unit+"first",ctwa_clid:"SyntheticClickIdentifierFirst"};
    assert.equal((await call({...base,unit:unit==="sender_1"?"sender_2":"sender_1"})).status,403);
    const first=await call(base); assert.equal(first.status,202); assert.equal(first.state,"awaiting_approval");
    assert.equal((await call(base)).status,200);
    assert.equal((await call({...base,occurred_at:"bad"})).status,400);
    const qualified=await call({unit,chat_id:chat,event_type:"lead_qualified",occurred_at:time(90),source_event_id:run+unit+"qualified"});
    assert.equal(qualified.status,202);
    assert.equal((await call({...base,source_event_id:run+unit+"second",occurred_at:time(60),ctwa_clid:"SyntheticClickIdentifierSecond"})).status,202);
    const payment=await call({unit,chat_id:chat,event_type:"payment_confirmed",occurred_at:time(30),source_event_id:run+unit+"payment"});
    assert.equal(payment.status,202); assert.equal(payment.state,"internal_only");
    const rows=(await db.query("SELECT id,ctwa_hash FROM followup.meta_events WHERE chat_hash=$1",[chatHash])).rows;
    assert.equal(rows.find(r=>r.id===qualified.id)?.ctwa_hash,sha(base.ctwa_clid));
    assert.equal(rows.find(r=>r.id===payment.id)?.ctwa_hash,sha("SyntheticClickIdentifierSecond"));
    const noClick=await call({unit,chat_id:chat+"empty",event_type:"lead_qualified",occurred_at:time(10),source_event_id:run+unit+"empty"});
    chats.push(sha(unit+":"+chat+"empty"));
    assert.equal(noClick.status,202); assert.equal(noClick.state,"no_ctwa");
    console.log(unit+": auth cruzada, duplicata, timestamp, chat novo, CTWA ausente e histórico de dois cliques OK");
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

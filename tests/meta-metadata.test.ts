import test from "node:test";
import assert from "node:assert/strict";
import { validateMetaInput, validateMetaAttribution } from "../lib/meta-core.ts";
import { META_EVENT_BODY_MAX_BYTES, readMetaEventBody } from "../lib/meta-request.ts";

test("metadados são opcionais, parciais e canônicos sem depender da ordem do JSON", () => {
  assert.deepEqual(validateMetaAttribution(undefined), {});
  assert.deepEqual(validateMetaAttribution(null), {});
  assert.deepEqual(validateMetaAttribution({ utm_campaign: null, utm_term: " ", ad_title: "" }), {});
  const a=validateMetaAttribution({utm_campaign:"  campanha  ",utm_source:"facebook"});
  const b=validateMetaAttribution({utm_source:"facebook",utm_campaign:"campanha"});
  assert.equal(JSON.stringify(a),JSON.stringify(b));
  assert.deepEqual(a,{utm_source:"facebook",utm_campaign:"campanha"});
});

test("campos livres, tipos, tamanhos e URLs inseguros são rejeitados sem acessar rede", () => {
  for (const value of [[], "string", {patient_name:"nome"}, {utm_source:42}, {utm_source:"a".repeat(257)}, {ad_title:"a".repeat(513)}, {utm_term:"bad\nvalue"}]) {
    assert.throws(()=>validateMetaAttribution(value));
  }
  for (const url of ["javascript:alert(1)", "data:image/png;base64,AAAA", "http://example.com/image", "https://user:password@example.com/image", "invalid", "https://example.com/"+"a".repeat(2048)]) {
    assert.throws(()=>validateMetaAttribution({thumbnail_url:url}));
  }
  assert.deepEqual(validateMetaAttribution({source_url:"https://example.com/?utm_source=facebook",thumbnail_url:"https://cdn.example.com/thumb.jpg"}), {source_url:"https://example.com/?utm_source=facebook",thumbnail_url:"https://cdn.example.com/thumb.jpg"});
});

test("só primeiro contato aceita metadados preenchidos, inclusive sem CTWA", () => {
  const now=Date.now();
  const base={unit:"sender_1",chat_id:"example",event_type:"conversation_started",occurred_at:new Date(now).toISOString(),source_event_id:"message-id"};
  assert.deepEqual(validateMetaInput(base,now).attribution,{});
  assert.deepEqual(validateMetaInput({...base,attribution:{utm_medium:"organic"}},now).attribution,{utm_medium:"organic"});
  assert.throws(()=>validateMetaInput({...base,event_type:"lead_qualified",attribution:{utm_source:"facebook"}},now),/primeiro contato/);
});

test("corpo limita bytes e stream mesmo sem Content-Length", async () => {
  const small=new Request("https://example.com",{method:"POST",body:JSON.stringify({attribution:{ad_title:"Campanha de ação"}})});
  assert.match(await readMetaEventBody(small),/ação/);
  await assert.rejects(()=>readMetaEventBody(new Request("https://example.com",{method:"POST",body:"á".repeat(META_EVENT_BODY_MAX_BYTES)})),RangeError);
  await assert.rejects(()=>readMetaEventBody(new Request("https://example.com",{method:"POST",headers:{"Content-Length":String(META_EVENT_BODY_MAX_BYTES+1)},body:"{}"})),RangeError);
});

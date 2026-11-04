import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONSULTING_CONTEXT,consultingEventName,consultingDestination,consultingTestPayload,consultingLivePayload,consultingProductionEligible,consultingProductionOutcome,validateConsultingEvent } from "../lib/consulting-meta-core.ts";
import { digest } from "../lib/meta-core.ts";
const now=Date.now();
const first={context:CONSULTING_CONTEXT,unit:"sender_1",chat_id:"new-consulting-chat",event_type:"conversation_started",occurred_at:new Date(now).toISOString(),source_event_id:"new-message-1",ctwa_clid:"NEWConsultingClick123",phone:"+55 (11) 99999-9999",name:"José Silva",source_id:"123456"};

test("consulting ingestion is explicit, validates fields, and keeps only identity hashes",()=>{
  const parsed=validateConsultingEvent(first,now);
  assert.equal(parsed.ph,digest("5511999999999")); assert.equal(parsed.fn,digest("jose")); assert.equal(parsed.ln,digest("silva"));
  assert.notEqual(parsed.chatHash,digest("sender_1:new-consulting-chat"));
  assert.doesNotMatch(JSON.stringify(parsed),/José|99999-9999/);
  assert.throws(()=>validateConsultingEvent({...first,context:undefined},now),/context/);
  assert.throws(()=>validateConsultingEvent({...first,context:"dermatology"},now),/context/);
  assert.throws(()=>validateConsultingEvent({...first,diagnosis:"anything"},now),/Campo/);
  assert.throws(()=>validateConsultingEvent({...first,unit:"invalid"},now),/unidade/);
  assert.throws(()=>validateConsultingEvent({...first,occurred_at:"invalid"},now),/Horário/);
  assert.throws(()=>validateConsultingEvent({...first,occurred_at:new Date(now-8*86400_000).toISOString()},now),/janela/);
});

test("consulting stages map separately, with one Purchase only at a paid appointment",()=>{
  assert.equal(consultingEventName("conversation_started"),"LeadSubmitted");
  assert.equal(consultingEventName("lead_qualified"),"QualifiedLead");
  assert.equal(consultingEventName("payment_requested"),"InitiateCheckout");
  assert.equal(consultingEventName("payment_pending"),null);
  assert.equal(consultingEventName("payment_confirmed"),null);
  assert.equal(consultingEventName("appointment_confirmed"),"Purchase");
  const appointment={context:CONSULTING_CONTEXT,unit:"sender_2",chat_id:"chat",event_type:"appointment_confirmed",occurred_at:first.occurred_at,source_event_id:"appointment-1",deposit_paid:true,transaction_id:"transaction-1"};
  const p=validateConsultingEvent(appointment,now); assert.equal(p.value,50);assert.equal(p.transactionHash,digest("transaction-1"));
  assert.throws(()=>validateConsultingEvent({...appointment,deposit_paid:false},now),/sinal/);
  assert.throws(()=>validateConsultingEvent({...appointment,transaction_id:undefined},now),/transaction_id/);
  assert.throws(()=>validateConsultingEvent({...appointment,value:"50"},now),/Valor/);
  assert.throws(()=>validateConsultingEvent({...appointment,value:50.123},now),/Valor/);
  assert.throws(()=>validateConsultingEvent({...appointment,phone:"+5511999999999"},now),/identidade/);
});

test("automatic unique ad IDs take precedence; only missing IDs use manual fallback",()=>{
  const fallback={pageId:"234567",datasetId:"345678"};
  assert.deepEqual(consultingDestination(null,fallback),{...fallback,pageOrigin:"manual",datasetOrigin:"manual"});
  assert.equal(consultingDestination({tracking_specs:[{dataset:["456789","456789"]}]},fallback).datasetId,"456789");
  assert.equal(consultingDestination({tracking_specs:[{page:["567890"],dataset:["456789"]}]},fallback).pageOrigin,"ad");
  assert.throws(()=>consultingDestination({tracking_specs:[{dataset:["456789","678901"]}]},fallback),/distintos/);
  assert.throws(()=>consultingDestination(null,{pageId:null,datasetId:null}),/ausentes/);
});

test("test payload always carries the test code, page and new conversation hashes, never WABA",()=>{
  const event={id:"new-opaque-id",stage:"appointment_confirmed" as const,occurredAt:new Date(now),value:50};
  const p=consultingTestPayload(event,{ctwa:"NEWConsultingClick123",ph:digest("5511999999999"),fn:digest("jose")},"234567","TEST28037");
  assert.equal(p.test_event_code,"TEST28037");assert.equal(p.data[0].event_name,"Purchase");
  assert.equal(p.data[0].user_data.page_id,"234567");assert.equal(p.data[0].action_source,"business_messaging");
  assert.deepEqual(p.data[0].custom_data,{currency:"BRL",value:50,content_name:"Sinal de agendamento de consultoria"});
  assert.doesNotMatch(JSON.stringify(p),/whatsapp_business_account_id|José|5511999999999|transaction-1/);
  assert.throws(()=>consultingTestPayload(event,{ctwa:"x"},"234567",""),/Código/);
  assert.throws(()=>consultingTestPayload(event,{ctwa:""},"234567","TEST28037"),/CTWA/);
  assert.throws(()=>consultingTestPayload({...event,stage:"payment_pending"},{ctwa:"x"},"234567","TEST28037"),/interna/);
});

test("backend has independent tables, capture cutoff and per-unit test claims",()=>{
  const source=readFileSync(new URL("../lib/consulting-meta.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/FROM followup\.meta_events|FROM followup\.meta_clicks|FROM public\./);
  assert.match(source,/input\.unit !== unit/); assert.match(source,/input\.occurredAt < settings\.capture_started_at/);
  assert.match(source,/WHERE id=\$1 AND unit=\$2 AND test_state='new'/);
  assert.match(source,/consultingTestPayload/); assert.doesNotMatch(source,/setInterval|mode === "live"|method:"POST".*body.*source_event_id/);
  const sql=readFileSync(new URL("../database/migrations/022_consulting_meta_tests.sql",import.meta.url),"utf8");
  assert.match(sql,/CHECK\(test_only\)/);assert.match(sql,/UNIQUE INDEX consulting_one_purchase_per_transaction/);
});

test("synthetic inputs are explicit or recognized without changing real historical hashes",()=>{
  assert.equal(validateConsultingEvent({...first,is_synthetic:false},now).isSynthetic,undefined);
  assert.equal(validateConsultingEvent({...first,is_synthetic:true},now).isSynthetic,true);
  for(const source_event_id of ["synthetic-message-1","teste:msg:1","test_1"])
    assert.equal(validateConsultingEvent({...first,source_event_id},now).isSynthetic,true);
  assert.equal(validateConsultingEvent({...first,chat_id:"CHAT_NOVO_DE_CONSULTORIA"},now).isSynthetic,true);
  assert.equal(validateConsultingEvent({...first,phone:"+12025550123"},now).isSynthetic,true);
  assert.throws(()=>validateConsultingEvent({...first,is_synthetic:"false"},now),/booleano/);
});

test("production requires both new conversation and milestone after unit and policy cutoffs",()=>{
  const cutoff=new Date(now-1000),fresh=new Date(now);
  const input={enabled:true,enabledAt:cutoff,policyAt:cutoff,occurredAt:fresh,synthetic:false,conversationAt:fresh,conversationCreatedAt:fresh,environmentEnabled:true};
  assert.equal(consultingProductionEligible(input),true);
  for(const override of [{enabled:false},{enabledAt:null},{policyAt:null},{environmentEnabled:false},{synthetic:true},
    {occurredAt:new Date(now-2000)},{conversationAt:new Date(now-2000)},{conversationCreatedAt:new Date(now-2000)},
    {policyAt:new Date(now+1000)}])assert.equal(consultingProductionEligible({...input,...override}),false);
});

test("production payload retains matching hashes but never test code or optional metadata",()=>{
  const event={id:"new-opaque-id",stage:"appointment_confirmed" as const,occurredAt:new Date(now),value:50,attribution:{utm_source:"internal-only"}};
  const identity={ctwa:"NEWConsultingClick123",ph:digest("5511999999999"),fn:digest("jose"),ln:digest("silva")};
  const p=consultingLivePayload(event,identity,"234567");
  assert.equal(p.data[0].event_id,"consulting-live:new-opaque-id");
  assert.equal(p.data[0].event_name,"Purchase");
  assert.deepEqual(p.data[0].user_data.ph,[identity.ph]);
  assert.deepEqual(p.data[0].user_data.fn,[identity.fn]);
  assert.deepEqual(p.data[0].user_data.ln,[identity.ln]);
  assert.deepEqual(p.data[0].custom_data,{currency:"BRL",value:50,content_name:"Sinal de agendamento de consultoria"});
  assert.doesNotMatch(JSON.stringify(p),/test_event_code|TEST_|consulting-test|internal-only|utm_|5511999999999/);
});

test("only explicit rate rejection with no received events can auto retry POST",()=>{
  assert.equal(consultingProductionOutcome(200,1,false,1),"accepted");
  assert.equal(consultingProductionOutcome(429,0,true,1),"queued");
  assert.equal(consultingProductionOutcome(429,0,true,3),"failed");
  assert.equal(consultingProductionOutcome(401,0,true,1),"failed");
  for(const [status,received,error] of [[null,0,false],[500,0,true],[200,0,false],[429,0,false],[429,1,true],[400,1,true]] as const)
    assert.equal(consultingProductionOutcome(status,received,error,1),"unknown");
});

test("worker and migration prevent legacy, synthetic, tested and old-generation dispatch",()=>{
  const source=readFileSync(new URL("../lib/consulting-production.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/FROM followup\.meta_events|FROM followup\.meta_clicks|FROM public\./);
  for(const guard of ["NOT e.is_synthetic","NOT i.is_synthetic","e.test_state='new'","i.test_state='new'","e.production_activation_at=s.production_enabled_at","i.created_at>=s.production_enabled_at","e.occurred_at>=p.enabled_at","SKIP LOCKED","CONSULTING_META_PRODUCTION"])
    assert.ok(source.includes(guard),guard);
  const ingest=readFileSync(new URL("../lib/consulting-meta.ts",import.meta.url),"utf8");
  assert.match(ingest,/input\.isSynthetic\|\|conversation\?\.is_synthetic/);
  const route=readFileSync(new URL("../app/api/consulting-meta/route.ts",import.meta.url),"utf8");
  assert.match(route,/\.\.\.body\.event,is_synthetic:true/);
  const sql=readFileSync(new URL("../database/migrations/024_consulting_production.sql",import.meta.url),"utf8");
  assert.match(sql,/production_eligible boolean NOT NULL DEFAULT false/);
  assert.match(sql,/production_state text NOT NULL DEFAULT 'excluded'/);
  assert.match(sql,/CHECK\(NOT is_synthetic OR NOT production_eligible\)/);
  assert.doesNotMatch(sql,/SET production_eligible=true|SET production_state='queued'/);
});

test("consulting metadata is optional and preserves the exact legacy idempotency input",()=>{
  const legacy={unit:"sender_1",stage:"conversation_started",chatHash:digest(`${CONSULTING_CONTEXT}:sender_1:new-consulting-chat`),sourceEventId:"new-message-1",occurredAt:new Date(first.occurred_at),ctwa:first.ctwa_clid,sourceId:first.source_id,ph:digest("5511999999999"),fn:digest("jose"),ln:digest("silva"),transactionHash:null,value:null};
  const original=validateConsultingEvent(first,now);
  assert.equal(JSON.stringify(original),JSON.stringify(legacy));
  for(const attribution of [undefined,null,{}, {utm_source:null,utm_medium:"",ad_title:"   ",thumbnail_url:null}]){
    const parsed=validateConsultingEvent({...first,attribution},now);
    assert.equal(JSON.stringify(parsed),JSON.stringify(legacy));
    assert.equal(digest(JSON.stringify(parsed)),digest(JSON.stringify(original)));
  }
});

test("consulting metadata normalizes deterministically and records changed metadata as a conflicting input",()=>{
  const fields={utm_source:" facebook ",utm_medium:"paid",utm_campaign:"consulting",utm_content:"creative",utm_term:"audience",ad_title:"Consultoria",source_url:"https://example.com/ad",thumbnail_url:"https://example.com/thumb.jpg"};
  const parsed=validateConsultingEvent({...first,attribution:fields},now);
  assert.equal(parsed.attribution?.utm_source,"facebook");
  assert.equal(parsed.attribution?.thumbnail_url,fields.thumbnail_url);
  const reversed=Object.fromEntries(Object.entries(fields).reverse());
  assert.equal(digest(JSON.stringify(parsed)),digest(JSON.stringify(validateConsultingEvent({...first,attribution:reversed},now))));
  assert.notEqual(digest(JSON.stringify(parsed)),digest(JSON.stringify(validateConsultingEvent({...first,attribution:{...fields,utm_campaign:"changed"}},now))));
  assert.equal(parsed.sourceId,first.source_id,"source_id continues to be stored separately");
});

test("metadata can be saved on organic first contact, but not repeated on later milestones",()=>{
  const {ctwa_clid,source_id,...organic}=first;
  const parsed=validateConsultingEvent({...organic,attribution:{utm_source:"organic"}},now);
  assert.equal(parsed.ctwa,null);assert.equal(parsed.sourceId,null);assert.equal(parsed.attribution?.utm_source,"organic");
  const next={context:CONSULTING_CONTEXT,unit:"sender_1",chat_id:first.chat_id,event_type:"lead_qualified",source_event_id:"qualified-1",occurred_at:first.occurred_at};
  assert.throws(()=>validateConsultingEvent({...next,attribution:{utm_source:"facebook"}},now),/primeiro contato/);
  assert.doesNotThrow(()=>validateConsultingEvent({...next,attribution:{}},now));
});

test("metadata rejects unknown fields, unsafe URLs, malformed types and excess lengths",()=>{
  for(const attribution of ["text",[],{unknown:"x"},{utm_source:123},{utm_source:"x".repeat(257)},{ad_title:"x".repeat(513)},{utm_term:"with\nnewline"},{source_url:"http://example.com/ad"},{thumbnail_url:"https://user:password@example.com/a"},{thumbnail_url:"javascript:alert(1)"},{source_url:"https://example.com/"+"a".repeat(2048)}]){
    assert.throws(()=>validateConsultingEvent({...first,attribution},now));
  }
  assert.doesNotThrow(()=>validateConsultingEvent({...first,attribution:{utm_source:"x".repeat(256),ad_title:"a".repeat(512)}},now));
  assert.throws(()=>validateConsultingEvent({...first,thumbnail_url:"https://example.com/thumb.jpg"},now),/Campo/);
});

test("metadata is internal only: Meta payload is unchanged when metadata is present",()=>{
  const plain={id:"opaque-id",stage:"conversation_started" as const,occurredAt:new Date(now),value:null};
  const event={...plain,attribution:{utm_source:"test-source-not-exported",ad_title:"test-title-not-exported",thumbnail_url:"https://example.com/private-thumbnail"}};
  const identity={ctwa:"NEWConsultingClick123",ph:digest("5511999999999")};
  const payload=consultingTestPayload(event,identity,"234567","TEST28037");
  assert.deepEqual(payload,consultingTestPayload(plain,identity,"234567","TEST28037"));
  assert.doesNotMatch(JSON.stringify(payload),/attribution|utm_|thumbnail|test-title-not-exported/);
  const source=readFileSync(new URL("../lib/consulting-meta.ts",import.meta.url),"utf8");
  assert.match(source,/JSON\.stringify\(input\.attribution \?\? \{\}\)/);
  const sql=readFileSync(new URL("../database/migrations/023_consulting_attribution.sql",import.meta.url),"utf8");
  assert.match(sql,/ADD COLUMN attribution jsonb NOT NULL DEFAULT/);
});

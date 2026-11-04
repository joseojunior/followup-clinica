import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONSULTING_CONTEXT,consultingEventName,consultingDestination,consultingTestPayload,validateConsultingEvent } from "../lib/consulting-meta-core.ts";
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

test("backend has independent tables, activation cutoff, per-unit claims and no production branch",()=>{
  const source=readFileSync(new URL("../lib/consulting-meta.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/FROM followup\.meta_events|FROM followup\.meta_clicks|FROM public\./);
  assert.match(source,/input\.unit !== unit/); assert.match(source,/input\.occurredAt < settings\.capture_started_at/);
  assert.match(source,/WHERE id=\$1 AND unit=\$2 AND test_state='new'/);
  assert.match(source,/consultingTestPayload/); assert.doesNotMatch(source,/setInterval|mode === "live"|method:"POST".*body.*source_event_id/);
  const sql=readFileSync(new URL("../database/migrations/022_consulting_meta_tests.sql",import.meta.url),"utf8");
  assert.match(sql,/CHECK\(test_only\)/);assert.match(sql,/UNIQUE INDEX consulting_one_purchase_per_transaction/);
});

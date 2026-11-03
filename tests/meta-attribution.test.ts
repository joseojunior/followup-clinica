import test from "node:test";
import assert from "node:assert/strict";
import { extractAdDestination, normalizeMetaPhone, protectedPhoneHash, validateMetaInput } from "../lib/meta-core.ts";

test("normaliza telefone sem assumir DDI e protege hash por unidade",()=>{
  assert.equal(normalizeMetaPhone("+55 (11) 99999-9999"),"5511999999999");
  assert.throws(()=>normalizeMetaPhone("abc5511999999999"));
  const key=Buffer.alloc(32,1);
  assert.notEqual(protectedPhoneHash("sender_1","5511999999999",key),protectedPhoneHash("sender_2","5511999999999",key));
  assert.notEqual(protectedPhoneHash("sender_1","5511999999999",key),protectedPhoneHash("sender_1","5511999999999",Buffer.alloc(32,2)));
});
test("extrai apenas destino explícito e único em tracking_specs",()=>{
  assert.deepEqual(extractAdDestination({tracking_specs:[{dataset:["123456"],page:["234567"]},{dataset:["123456"]}]}),{datasetId:"123456",pageId:"234567"});
  assert.throws(()=>extractAdDestination({tracking_specs:[{dataset:["123456","345678"],page:["234567"]}]}),/ambíguo/);
  assert.throws(()=>extractAdDestination({tracking_specs:[{dataset:"123456",page:["234567"]}]}),/inválidos/);
  assert.throws(()=>extractAdDestination({tracking_specs:[{nested:{dataset:["123456"],page:["234567"]}}]}),/ausente/);
  assert.throws(()=>extractAdDestination({tracking_specs:[]}),/ausente/);
});
test("contrato recebe dados da Uazapi, não permite escolher destino ou enviar PII extra",()=>{
  const now=Date.now();
  const body={unit:"sender_2",chat_id:"chat@s.whatsapp.net",phone:"+5511999999999",source_id:"123456",event_type:"conversation_started",occurred_at:new Date(now).toISOString(),source_event_id:"wamid-id",ctwa_clid:"ARClickIdentifier123"};
  assert.equal(validateMetaInput(body,now).phone,"5511999999999");
  assert.throws(()=>validateMetaInput({...body,dataset_id:"999999"},now),/não permitidos/);
  assert.throws(()=>validateMetaInput({...body,source_id:"not-an-ad"},now),/source_id/);
  assert.throws(()=>validateMetaInput({...body,event_type:"Purchase"},now),/etapa/);
});

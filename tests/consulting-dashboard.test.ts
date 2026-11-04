import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {parseConsultingDashboardFilters,effectiveConsultingState} from "../lib/consulting-dashboard-core.ts";
import {parseOperationalPeriod} from "../lib/operational-dashboard-core.ts";
import {buildConsultingGuideSample,buildConsultingGuideCurl} from "../lib/consulting-guide.ts";
import {validateConsultingEvent} from "../lib/consulting-meta-core.ts";

test("dashboard filters use real events by default and validate all bounded dimensions",()=>{
  assert.deepEqual(parseConsultingDashboardFilters(new URLSearchParams()),{unit:"all",days:7,scope:"real",status:"all",stage:"all",day:"",search:"",page:1});
  const f=parseConsultingDashboardFilters(new URLSearchParams("unit=sender_2&scope=tests&days=90&status=attention&stage=lead_qualified&day=2026-11-04&search=abc&page=3"));
  assert.equal(f.unit,"sender_2");assert.equal(f.scope,"tests");assert.equal(f.page,3);
  for(const input of ["unit=sender_3","unit=%27%20OR%201=1","days=1000","days=-1","page=0","page=1.5","page=4001","scope=all","status=fake","stage=__proto__","day=2026-02-31","day=bad","search="+"x".repeat(101)])
    assert.throws(()=>parseConsultingDashboardFilters(new URLSearchParams(input)),Error,input);
});
test("test outcomes never masquerade as live delivery states",()=>{
  const first={is_synthetic:true,test_state:"accepted",production_state:"excluded",event_type:"conversation_started" as const};
  assert.equal(effectiveConsultingState(first),"accepted");
  assert.equal(effectiveConsultingState({...first,test_state:"new"}),"test_ready");
  assert.equal(effectiveConsultingState({...first,is_synthetic:false,test_state:"new"}),"excluded");
  assert.equal(effectiveConsultingState({...first,is_synthetic:false,test_state:"new",production_state:"queued"}),"queued");
  assert.equal(effectiveConsultingState({...first,event_type:"payment_confirmed"}),"internal");
});
test("analytics query is read-only, paginated after aggregation and does not return identity secrets",()=>{
  const source=readFileSync(new URL("../lib/consulting-dashboard.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/\b(INSERT|UPDATE|DELETE)\s/i);
  assert.match(source,/base AS MATERIALIZED/);assert.match(source,/FROM base GROUP BY/);assert.match(source,/LIMIT 25 OFFSET \$8::int/);
  assert.match(source,/America\/Sao_Paulo/);assert.match(source,/NOT e\.is_synthetic AND e\.test_state='new'/);
  assert.doesNotMatch(source,/SELECT e\.\*|ph_hash|fn_hash|ln_hash|encrypted_access_token|decrypt/);
  const page=source.split(", page AS (")[1].split(")\nSELECT")[0].replace("substr(chat_hash,1,8)","masked_reference");assert.doesNotMatch(page,/encrypted_ctwa|chat_hash/);
  const route=readFileSync(new URL("../app/api/consulting-meta/dashboard/route.ts",import.meta.url),"utf8");assert.match(route,/requireMetaAdmin/);assert.match(route,/Cache-Control.*no-store/);
});
test("guide models validate every stage in each unit, default to synthetic and inherit identity on later events",()=>{
  const timestamp=new Date().toISOString();
  for(const unit of ["sender_1","sender_2"] as const)for(const stage of ["conversation_started","lead_qualified","payment_requested","payment_pending","payment_confirmed","appointment_confirmed"] as const){
    const sample=buildConsultingGuideSample(unit,stage,timestamp);
    assert.equal(validateConsultingEvent(sample).isSynthetic,true);
    const real=validateConsultingEvent(buildConsultingGuideSample(unit,stage,timestamp,false));assert.equal(real.isSynthetic,undefined);
    if(stage!=="conversation_started"){assert.equal(real.ph,null);assert.equal(real.ctwa,null);}
    if(stage==="appointment_confirmed")assert.equal(real.value,50);
  }
});
test("operational period never accepts invalid dates or unbounded ranges",()=>{
  assert.deepEqual(parseOperationalPeriod(new URLSearchParams()),{days:7,day:""});
  assert.deepEqual(parseOperationalPeriod(new URLSearchParams("days=30&day=2026-11-04")),{days:30,day:"2026-11-04"});
  for(const query of ["days=90","day=2026-02-31","days=NaN"])assert.throws(()=>parseOperationalPeriod(new URLSearchParams(query)));
});
test("copied cURL has clean shell continuations without diff markers and escapes quotes",()=>{
  const curl=buildConsultingGuideCurl("https://example.com/api/integrations/n8n/consulting-events",JSON.stringify({name:"D'Avila"}));
  const lines=curl.split("\n");
  assert.equal(lines.length,4);
  assert.match(lines[0],/^curl --request POST/);
  assert.match(lines[1],/^  --header 'Authorization:/);
  assert.match(lines[2],/^  --header 'Content-Type:/);
  assert.match(lines[3],/^  --data-raw /);
  assert.doesNotMatch(curl,/^\+/m);
  assert.ok(lines.slice(0,3).every(line=>line.endsWith("\\")));
  assert.ok(curl.includes("D'\\''Avila"));
});

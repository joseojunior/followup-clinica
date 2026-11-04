import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as core from "../lib/consulting-meta-core.ts";

// Exercise the actual orchestration with isolated DB/network boundaries, never real Meta requests.
function harness(options:{cancel?:boolean;ambiguous?:boolean;networkFailure?:boolean;rateLimit?:boolean;ad?:boolean}={}) {
  const writes:Array<{sql:string;params:unknown[]}> = [],requests:Array<{url:string;init:RequestInit}> = [];
  const event={id:"new-event",unit:"sender_1",event_type:"lead_qualified",occurred_at:new Date(),value:null,
    click:"cipher-click",ad:options.ad?"123456":null,ph:"phone-hash",fn:"first-hash",ln:"last-hash",
    page_id:"234567",dataset_id:"345678",encrypted_access_token:"cipher-token",production_preflights:0};
  let claimed=false;
  const db={query:async(sql:string,params:unknown[]=[])=>{
    writes.push({sql,params});
    if(sql.includes("FOR UPDATE OF e SKIP LOCKED")) { const rows=claimed?[]:[event];claimed=true;return {rows,rowCount:rows.length}; }
    if(sql.startsWith("SELECT e.id"))return {rows:options.cancel?[]:[{id:event.id}],rowCount:options.cancel?0:1};
    if(sql.includes("RETURNING production_attempts"))return {rows:[{production_attempts:1}],rowCount:1};
    return {rows:[],rowCount:0};
  }};
  const fakeFetch=async(url:string,init:RequestInit)=>{
    requests.push({url,init});
    if(init.method!=="POST")return new Response(JSON.stringify({id:event.ad,tracking_specs:options.ambiguous?[{page:["234567","456789"]}]:[{page:["234567"]},{page:["234567"]}]}),{status:200});
    if(options.networkFailure)throw new Error("lost response - never print identity");
    if(options.rateLimit)return new Response(JSON.stringify({error:{code:4,fbtrace_id:"trace-limited"}}),{status:429});
    return new Response(JSON.stringify({events_received:1,fbtrace_id:"trace-ok"}),{status:200});
  };
  const source=readFileSync(new URL("../lib/consulting-production.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{} as {dispatchConsultingProduction:(n?:number)=>Promise<Record<string,unknown>>}};
  const deps:Record<string,unknown>={"server-only":{},"@/lib/followup-db":{getFollowupPool:()=>db,withTransaction:async(fn:(c:typeof db)=>unknown)=>fn(db)},
    "@/lib/meta-secret":{decryptMetaSecret:(v:string)=>v==="cipher-click"?"new-click-123":"unit-token"},
    "@/lib/meta-events":{MetaInputError:Error},"@/lib/consulting-meta-core":core};
  new Function("require","module","exports","fetch","process",code)((name:string)=>{if(!(name in deps))throw new Error(`Unexpected dependency ${name}`);return deps[name];},module,module.exports,fakeFetch,{env:{CONSULTING_META_PRODUCTION:"enabled",META_GRAPH_API_VERSION:"v26.0"}});
  return {...module.exports,writes,requests};
}

test("production dispatcher resolves repeated ad pages and fallback dataset, then records one live POST",async()=>{
  const h=harness({ad:true});const result=await h.dispatchConsultingProduction();
  assert.equal(result.accepted,1);assert.equal(result.processed,1);
  assert.equal(h.requests.length,2);
  const post=h.requests.find(r=>r.init.method==="POST")!;
  assert.match(post.url,/v26\.0\/345678\/events$/);
  const payload=JSON.parse(String(post.init.body));
  assert.equal(payload.data[0].event_name,"QualifiedLead");
  assert.equal(payload.data[0].event_id,"consulting-live:new-event");
  assert.deepEqual(payload.data[0].user_data,{page_id:"234567",ctwa_clid:"new-click-123",ph:["phone-hash"],fn:["first-hash"],ln:["last-hash"]});
  assert.equal(payload.test_event_code,undefined);
  assert.ok(h.writes.find(q=>q.sql.includes("INSERT INTO followup.consulting_meta_delivery_attempts")));
  const finish=h.writes.find(q=>q.sql.includes("production_result=$3")&&q.params[1]==="accepted")!;
  assert.ok(finish);assert.doesNotMatch(String(finish.params[2]),/unit-token|cipher|new-click|phone-hash|first-hash/);
});

test("production dispatcher does not POST when activation/policy changes during preflight",async()=>{
  const h=harness({cancel:true});const result=await h.dispatchConsultingProduction();
  assert.equal(result.processed,0);assert.equal(h.requests.length,0);
  assert.ok(h.writes.find(q=>q.sql.includes("production_state='excluded'")&&q.params[0]==="new-event"));
});

test("production dispatcher blocks ambiguous automatic destinations instead of using fallback",async()=>{
  const h=harness({ad:true,ambiguous:true});const result=await h.dispatchConsultingProduction();
  assert.equal(result.failed,1);assert.equal(h.requests.filter(r=>r.init.method==="POST").length,0);
});

test("lost POST response is unknown, not retried or put back into queue",async()=>{
  const h=harness({networkFailure:true});const result=await h.dispatchConsultingProduction();
  assert.equal(result.unknown,1);assert.equal(result.retried,0);assert.equal(h.requests.length,1);
  const finish=h.writes.find(q=>q.sql.includes("production_result=$3")&&q.params[1]==="unknown");assert.ok(finish);
});

test("explicit Meta rate rejection without delivery records a bounded retry",async()=>{
  const h=harness({rateLimit:true});const result=await h.dispatchConsultingProduction();
  assert.equal(result.retried,1);assert.equal(result.accepted,0);assert.equal(h.requests.length,1);
  assert.ok(h.writes.find(q=>q.sql.includes("production_result=$3")&&q.params[1]==="queued"));
});

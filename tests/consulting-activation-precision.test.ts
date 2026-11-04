import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as core from "../lib/consulting-meta-core.ts";
import * as metaCore from "../lib/meta-core.ts";
// @ts-expect-error The maintenance CLI is JavaScript, exercised directly by these runtime tests.
import {parseRecoveryArgs,recoverConsultingActivation,recoveryEligibilitySql} from "../scripts/recover-consulting-activation.mjs";

function ingestion(synthetic=false){
  const activation="2026-11-04 19:29:09.408475+00";
  const queries:Array<{sql:string;params:unknown[]}> = [];
  const c={query:async(sql:string,params:unknown[]=[])=>{
    queries.push({sql,params});
    if(sql.includes("FROM followup.consulting_meta_settings"))return {rows:[{capture_started_at:new Date(0),production_enabled:true,production_enabled_at:new Date(activation),production_activation_exact:activation}]};
    if(sql.includes("FROM followup.consulting_meta_policy"))return {rows:[{enabled_at:new Date(activation)}]};
    if(sql.startsWith("INSERT INTO followup.consulting_meta_events"))return {rows:[{id:"new-id",test_state:"new",production_state:params[18]}]};
    return {rows:[]};
  }};
  const source=readFileSync(new URL("../lib/consulting-meta.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{} as {recordConsultingEvent:(input:unknown,unit:string)=>Promise<{productionState:string}>}};
  const deps:Record<string,unknown>={"server-only":{},"@/lib/followup-db":{getFollowupPool:()=>c,withTransaction:async(fn:(c:unknown)=>unknown)=>fn(c)},"@/lib/meta-events":{MetaInputError:Error},"@/lib/meta-core":metaCore,"@/lib/meta-secret":{encryptMetaSecret:()=>"cipher",decryptMetaSecret:()=>"not-used"},"@/lib/consulting-meta-core":core};
  new Function("require","module","exports","process",code)((name:string)=>{if(!(name in deps))throw new Error(`Unexpected dependency ${name}`);return deps[name];},module,module.exports,{env:{CONSULTING_META_PRODUCTION:"enabled"}});
  return {activation,queries,run:()=>module.exports.recordConsultingEvent({context:"consulting_v1",unit:"sender_1",chat_id:"precision-check-new-chat",event_type:"conversation_started",source_event_id:"precision-check-new-message",occurred_at:new Date().toISOString(),ctwa_clid:"NewConsultingClick123",is_synthetic:synthetic},"sender_1")};
}

test("ingestion preserves the exact PostgreSQL activation generation, not the rounded JS Date",async()=>{
  const h=ingestion();const result=await h.run();
  assert.equal(result.productionState,"queued");
  const insert=h.queries.find(q=>q.sql.startsWith("INSERT INTO followup.consulting_meta_events"))!;
  assert.equal(insert.params[17],h.activation);
  assert.equal(typeof insert.params[17],"string");
  assert.equal(new Date(h.activation).toISOString(),"2026-11-04T19:29:09.408Z","driver Date loses the microseconds that equality must keep");
  assert.ok(h.queries.find(q=>q.sql.includes("production_enabled_at::text AS production_activation_exact")&&q.sql.includes("FOR SHARE")));
});
test("synthetic events remain excluded with no production generation",async()=>{
  const h=ingestion(true);assert.equal((await h.run()).productionState,"excluded");
  const insert=h.queries.find(q=>q.sql.startsWith("INSERT INTO followup.consulting_meta_events"))!;
  assert.equal(insert.params[16],false);assert.equal(insert.params[17],null);
});
test("activation paths copy policy cutoff inside PostgreSQL without a Date round-trip",()=>{
  const source=readFileSync(new URL("../lib/consulting-production.ts",import.meta.url),"utf8");
  assert.match(source,/enabled_at=CASE WHEN \$2 THEN \(SELECT production_enabled_at FROM followup\.consulting_meta_settings/);
  const script=readFileSync(new URL("../scripts/activate-consulting.mjs",import.meta.url),"utf8");
  assert.match(script,/enabled_at=\(SELECT production_enabled_at FROM followup\.consulting_meta_settings/);
});

const ids=["a610184b-7eb7-4030-8d70-6c0f059f2840","bcf2a8f1-fb95-46d1-bfe1-a619c943b186"];
const activation="2026-11-04T19:29:09.408475Z";
test("recovery requires explicit mode, exact generation and two distinct approved IDs",()=>{
  assert.equal(parseRecoveryArgs(["--dry-run",activation,...ids]).apply,false);
  assert.equal(parseRecoveryArgs(["--apply",activation,...ids]).apply,true);
  for(const args of [[],["--apply",activation,ids[0]],["--apply",activation,ids[0],ids[0]],["--apply","2026-11-04T19:29:09.408Z",...ids],["--apply",activation,...ids,"other"]])assert.throws(()=>parseRecoveryArgs(args));
  for(const guard of ["e.id=ANY($1::uuid[])","e.unit='sender_1'","s.production_enabled_at=$2::timestamptz","NOT e.is_synthetic","e.test_state='new'","e.production_attempts=0","e.production_preflights=0","e.production_activation_at=date_trunc('milliseconds',s.production_enabled_at)","NOT EXISTS(SELECT 1 FROM followup.consulting_meta_delivery_attempts","e.occurred_at>=s.production_enabled_at","e.created_at>=p.enabled_at"])assert.ok(recoveryEligibilitySql.includes(guard),guard);
});
test("recovery is all-or-nothing, audited, dry-run by default and never sends to Meta",async()=>{
  const previousFlag=process.env.CONSULTING_META_PRODUCTION,previousLegacy=process.env.META_EXPORT_MODE;
  process.env.CONSULTING_META_PRODUCTION="enabled";process.env.META_EXPORT_MODE="record_only";
  try{
    for(const [apply,count] of [[false,2],[true,2],[true,1]] as const){
      const queries:Array<{sql:string;params:unknown[]}>=[];
      const client={query:async(sql:string,params:unknown[]=[])=>{queries.push({sql,params});return sql===recoveryEligibilitySql?{rowCount:count,rows:ids.slice(0,count).map(id=>({id}))}:{rowCount:0,rows:[]};}};
      if(count!==2)await assert.rejects(()=>recoverConsultingActivation(client,["--apply",activation,...ids]),/exactly two/);
      else await recoverConsultingActivation(client,[apply?"--apply":"--dry-run",activation,...ids]);
      const updates=queries.filter(q=>q.sql.startsWith("UPDATE "));
      assert.equal(updates.length,apply&&count===2?2:0);
      assert.equal(queries.at(-1)?.sql,apply&&count===2?"COMMIT":"ROLLBACK");
      if(updates.length){assert.deepEqual(updates.map(q=>q.params[0]),ids);assert.equal(queries.filter(q=>q.sql.includes("INSERT INTO followup.meta_admin_audit")).length,2);}
    }
    const source=readFileSync(new URL("../scripts/recover-consulting-activation.mjs",import.meta.url),"utf8");assert.doesNotMatch(source,/fetch\(|graph\.facebook/);
  }finally{if(previousFlag===undefined)delete process.env.CONSULTING_META_PRODUCTION;else process.env.CONSULTING_META_PRODUCTION=previousFlag;if(previousLegacy===undefined)delete process.env.META_EXPORT_MODE;else process.env.META_EXPORT_MODE=previousLegacy;}
});

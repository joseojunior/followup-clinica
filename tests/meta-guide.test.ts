import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaGuideSample } from "../lib/meta-guide.ts";
import { META_STAGES, validateMetaInput } from "../lib/meta-core.ts";

test("exemplos do guia são aceitos para cada unidade e etapa", () => {
  const now=Date.now(); const time=new Date(now).toISOString();
  for (const unit of ["sender_1","sender_2"] as const) for (const stage of META_STAGES) {
    const body=buildMetaGuideSample(unit,stage,time);
    const parsed=validateMetaInput(body,now);
    assert.equal(parsed.unit,unit); assert.equal(parsed.eventType,stage);
    assert.equal(Boolean(parsed.ctwaClid),stage==="conversation_started");
    assert.equal(Boolean(parsed.sourceId),stage==="conversation_started");
    assert.deepEqual(buildMetaGuideSample(unit,stage,time),body);
    assert.equal("dataset_id" in body,false);
    assert.equal("page_id" in body,false);
  }
});

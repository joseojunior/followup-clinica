import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMetaAssetValidation, validateMetaAssets } from "../lib/meta-asset-validation.ts";
import { readFileSync } from "node:fs";

const input = { accessToken: "SECRET-never-log", graphVersion: "v26.0", sourceId: "123456", sourceBelongsToUnit: true };
const ad = { id: "123456", tracking_specs: [{ dataset: ["345678"], page: ["234567"] }] };
function mock(responses: Array<unknown | Error>, statuses: number[] = []) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const read: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    const value = responses[calls.length - 1];
    if (value instanceof Error) throw value;
    assert.notEqual(value, undefined, "unexpected Graph call");
    return Response.json(value, { status: statuses[calls.length - 1] || 200 });
  };
  return { read, calls };
}

test("validates all assets without WABA using GETs only, never enabling export", async () => {
  const graph = mock([{ id: "999999" }, ad, { id: "234567" }, { id: "345678" }]);
  const result = await validateMetaAssets(input, graph.read);
  assert.equal(result.status, "passed");
  assert.equal(result.noEventSent, true);
  assert.equal(result.exportAuthorized, false);
  assert.equal(result.numberAssociationVerified, false);
  assert.equal(result.pageId, "234567");
  assert.equal(result.datasetId, "345678");
  assert.equal(graph.calls.length, 4);
  assert.deepEqual(result.trace.map(({ method, path, status, outcome }) => ({ method, path, status, outcome })), [
    { method: "GET", path: "me?fields=id", status: 200, outcome: "passed" },
    { method: "GET", path: "123456?fields=id,tracking_specs", status: 200, outcome: "passed" },
    { method: "GET", path: "234567?fields=id", status: 200, outcome: "passed" },
    { method: "GET", path: "345678?fields=id", status: 200, outcome: "passed" },
  ]);
  for (const { url, init } of graph.calls) {
    assert.equal(new URL(url).hostname, "graph.facebook.com");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error");
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${input.accessToken}`);
    assert.doesNotMatch(url, /SECRET|waba|phone_numbers|\/events|access_token/);
  }
  assert.doesNotMatch(JSON.stringify(result), /SECRET|999999/);
});

test("consolidates repeated tracking_specs dataset IDs and reports their counts in the trace", async () => {
  const repeated = { id: "123456", tracking_specs: [
    { dataset: ["345678"], page: ["234567"] },
    { dataset: ["345678"], page: ["234567"] },
    { dataset: ["345678"] },
  ] };
  const graph = mock([{ id: "999999" }, repeated, { id: "234567" }, { id: "345678" }]);
  const result = await validateMetaAssets(input, graph.read);
  assert.equal(result.status, "passed");
  assert.equal(result.datasetId, "345678");
  assert.deepEqual(result.trackingSpecs?.dataset, { itemCount: 3, ids: ["345678"], duplicateCount: 2 });
  assert.deepEqual(result.trackingSpecs?.page, { itemCount: 2, ids: ["234567"], duplicateCount: 1 });
  assert.match(result.checks.find(check => check.key === "destination")!.reason, /2 duplicata/);
  assert.equal(graph.calls.length, 4, "a duplicated ID is validated once");
});

test("legacy saved reports without trace remain readable without changing their original result", async () => {
  const report = await validateMetaAssets({ ...input, accessToken: null }, mock([]).read);
  const { trace, trackingSpecs, ...legacy } = report;
  const normalized = normalizeMetaAssetValidation(legacy)!;
  assert.deepEqual(normalized.trace, []);
  assert.equal(normalized.trackingSpecs, null);
  assert.equal(normalized.reason, legacy.reason);
  assert.deepEqual(normalized.checks, legacy.checks);
  assert.equal("trace" in legacy, false, "normalization does not mutate the persisted report");
  assert.equal(normalizeMetaAssetValidation(null), null);
  assert.deepEqual(normalizeMetaAssetValidation(report), report);
});

test("trace preserves received HTTP status for invalid JSON and never logs the raw response", async () => {
  const result = await validateMetaAssets(input, (async () => new Response(`bad JSON ${input.accessToken}`, { status: 502 })) as typeof fetch);
  assert.equal(result.trace.length, 1);
  assert.equal(result.trace[0].status, 502);
  assert.equal(result.trace[0].outcome, "failed");
  assert.equal(result.trace[0].path, "me?fields=id");
  assert.ok(result.trace[0].durationMs >= 0);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|bad JSON/);
});

test("trace reports distinct candidate IDs instead of hiding an ambiguous tracking_specs response", async () => {
  const graph = mock([{ id: "999999" }, { id: "123456", tracking_specs: [
    { dataset: ["345678"], page: ["234567"] },
    { dataset: ["456789"], page: ["234567"] },
  ] }]);
  const result = await validateMetaAssets(input, graph.read);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.trackingSpecs?.dataset.ids, ["345678", "456789"]);
  assert.equal(result.trackingSpecs?.dataset.duplicateCount, 0);
  assert.equal(result.trace.length, 2, "page and dataset are not checked when selection is ambiguous");
});

test("missing token or invalid Graph version produces actionable saved diagnostics without network calls", async () => {
  for (const overrides of [{ accessToken: null }, { graphVersion: null }, { graphVersion: "26" }]) {
    const graph = mock([]);
    const result = await validateMetaAssets({ ...input, ...overrides }, graph.read);
    assert.equal(result.status, "failed");
    assert.equal(result.checks[0].key, "configuration");
    assert.equal(result.checks[0].status, "failed");
    assert.equal(graph.calls.length, 0);
    assert.equal(result.checks.find((c) => c.key === "dataset")?.status, "skipped");
  }
});

test("invalid/expired token reports safe error codes without storing Graph's raw message", async () => {
  const graph = mock([{ error: { code: 190, message: input.accessToken, error_user_msg: "private profile" } }], [400]);
  const result = await validateMetaAssets(input, graph.read);
  assert.equal(result.status, "failed");
  assert.match(result.reason, /expirado/);
  assert.equal(result.checks.find((c) => c.key === "token")?.errorCode, 190);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private profile/);
  assert.equal(graph.calls.length, 1);
});

test("refuses an ad not captured for the selected unit, or no ad, without querying it", async () => {
  for (const overrides of [{ sourceBelongsToUnit: false }, { sourceId: null }, { sourceId: "../me" }]) {
    const graph = mock([{ id: "999999" }]);
    const result = await validateMetaAssets({ ...input, ...overrides }, graph.read);
    assert.equal(result.status, "failed");
    assert.equal(result.checks.find((c) => c.key === "ad")?.status, "failed");
    assert.equal(graph.calls.length, 1);
  }
});

test("fails ambiguous or missing tracking_specs without choosing a destination", async () => {
  for (const value of [
    { id: "123456" },
    { ...ad, tracking_specs: [{ dataset: ["345678", "456789"], page: ["234567"] }] },
    { ...ad, tracking_specs: [{ dataset: ["345678"], page: ["234567", "456789"] }] },
  ]) {
    const graph = mock([{ id: "999999" }, value]);
    const result = await validateMetaAssets(input, graph.read);
    assert.equal(result.status, "failed");
    assert.equal(result.datasetId, null);
    assert.equal(result.pageId, null);
    assert.equal(result.checks.find((c) => c.key === "destination")?.status, "failed");
    assert.equal(graph.calls.length, 2);
  }
});

test("reports page and dataset failures independently, including permissions and mismatched IDs", async () => {
  const graph = mock([{ id: "999999" }, ad, { error: { code: 200 } }, { id: "456789" }], [200, 200, 403, 200]);
  const result = await validateMetaAssets(input, graph.read);
  assert.equal(result.status, "failed");
  assert.match(result.checks.find((c) => c.key === "page")!.reason, /permissão/);
  assert.equal(result.checks.find((c) => c.key === "dataset")?.status, "failed");
  assert.equal(graph.calls.length, 4);
});

test("does not accept an ad with a different ID", async () => {
  const graph = mock([{ id: "999999" }, { ...ad, id: "456789" }]);
  const result = await validateMetaAssets(input, graph.read);
  assert.equal(result.checks.find((c) => c.key === "ad")?.status, "failed");
  assert.equal(graph.calls.length, 2);
});

test("handles network failure, bad JSON and Meta throttling without leaking details", async () => {
  for (const graph of [
    mock([new Error(`timeout ${input.accessToken}`)]),
    mock([{ error: { code: 4 } }], [429]),
    { read: (async () => new Response("not JSON", { status: 200 })) as typeof fetch },
  ]) {
    const result = await validateMetaAssets(input, graph.read);
    assert.equal(result.status, "failed");
    assert.equal(result.checks.find((c) => c.key === "token")?.status, "failed");
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});

test("diagnostic orchestration never changes export approval, click resolution, or event queues", () => {
  const source = readFileSync(new URL("../lib/meta-events.ts", import.meta.url), "utf8");
  const diagnostic = source.slice(source.indexOf("export async function testMetaConfiguration"), source.indexOf("function readWabaDataset"));
  assert.match(diagnostic, /mode\(\) !== "record_only"/);
  assert.match(diagnostic, /meta_clicks WHERE unit=\$1/);
  assert.match(diagnostic, /encrypted_access_token IS NOT DISTINCT FROM \$3/);
  assert.match(diagnostic, /test_assets_read_only/);
  assert.doesNotMatch(diagnostic, /SET verified_at|SET enabled|UPDATE followup.meta_events|UPDATE followup.meta_clicks|whatsapp_business_account_id|waba_id/);
});

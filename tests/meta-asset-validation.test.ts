import test from "node:test";
import assert from "node:assert/strict";
import { validateMetaAssets } from "../lib/meta-asset-validation.ts";
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

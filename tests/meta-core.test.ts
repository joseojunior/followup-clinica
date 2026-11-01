import test from "node:test";
import assert from "node:assert/strict";
import { classifyMetaDelivery, classifyMetaEvent, digest, duplicateMatches, equalDigest, metaEventName, validateMetaInput } from "../lib/meta-core.ts";

const now = Date.parse("2026-11-01T15:00:00Z");
const body = { unit: "sender_1", chat_id: "chat-1", event_type: "conversation_started", occurred_at: "2026-11-01T14:30:00Z", source_event_id: "wamid.123", ctwa_clid: "ARClickIdentifier123" };

test("validates n8n contract and stable timestamp", () => {
  const result = validateMetaInput(body, now);
  assert.equal(result.unit, "sender_1");
  assert.equal(result.occurredAt.toISOString(), "2026-11-01T14:30:00.000Z");
  assert.equal(result.ctwaClid, body.ctwa_clid);
  assert.throws(() => validateMetaInput({ ...body, occurred_at: "2026-11-01T14:30:00" }, now), /ISO 8601/);
  assert.throws(() => validateMetaInput({ ...body, occurred_at: "2026-11-02T14:30:00Z" }, now), /intervalo/);
  assert.throws(() => validateMetaInput({ ...body, telefone: "5511999999999" }, now), /não permitidos/);
  assert.throws(() => validateMetaInput({ ...body, event_type: "appointment_confirmed" }, now), /ctwa_clid/);
});

test("hash compares tokens without accepting malformed hashes", () => {
  assert.equal(equalDigest("secret-1", digest("secret-1")), true);
  assert.equal(equalDigest("secret-2", digest("secret-1")), false);
  assert.equal(equalDigest("secret-1", "not-a-hash"), false);
});

test("detects duplicate source IDs with conflicting CTWA or chat", () => {
  const stored = { chat_hash: digest("sender_1:chat-1"), occurred_at: new Date(body.occurred_at), ctwa_hash: digest(body.ctwa_clid) };
  assert.equal(duplicateMatches(stored, { chatHash: stored.chat_hash, occurredAt: stored.occurred_at, ctwaClid: body.ctwa_clid }), true);
  assert.equal(duplicateMatches(stored, { chatHash: digest("sender_2:chat-1"), occurredAt: stored.occurred_at, ctwaClid: body.ctwa_clid }), false);
  assert.equal(duplicateMatches(stored, { chatHash: stored.chat_hash, occurredAt: stored.occurred_at, ctwaClid: "AnotherClickIdentifier" }), false);
});

test("no CTWA is retained internally and approvals never bypass record-only", () => {
  const enabledAt = new Date(now - 60_000);
  const common = { hasCtwa: true, historical: false, candidate: true, live: true, unitEnabled: true, unitEnabledAt: enabledAt,
    typeApproved: true, typeEnabled: true, typeEnabledAt: enabledAt, occurredAt: new Date(now), configured: true };
  assert.equal(classifyMetaEvent({ ...common, hasCtwa: false }).state, "no_ctwa");
  assert.equal(classifyMetaEvent({ ...common, live: false }).state, "awaiting_approval");
  assert.equal(classifyMetaEvent({ ...common, historical: true }).state, "internal_only");
  assert.equal(classifyMetaEvent({ ...common, unitEnabledAt: new Date(now + 1000) }).state, "awaiting_approval");
  assert.equal(classifyMetaEvent(common).state, "queued");
  assert.equal(metaEventName("payment_confirmed"), null);
  assert.equal(metaEventName("appointment_confirmed"), null);
});

test("classifies Meta responses and bounds retries", () => {
  assert.equal(classifyMetaDelivery({ httpStatus: 200, eventsReceived: 1, errorCode: null, autoRetryCount: 0 }), "accepted");
  assert.equal(classifyMetaDelivery({ httpStatus: 200, eventsReceived: 0, errorCode: null, autoRetryCount: 0 }), "failed");
  assert.equal(classifyMetaDelivery({ httpStatus: 429, eventsReceived: 0, errorCode: "4", autoRetryCount: 0 }), "queued");
  assert.equal(classifyMetaDelivery({ httpStatus: 503, eventsReceived: 0, errorCode: "server", autoRetryCount: 4 }), "failed");
  assert.equal(classifyMetaDelivery({ httpStatus: 400, eventsReceived: 0, errorCode: "invalid", autoRetryCount: 0 }), "failed");
  assert.equal(classifyMetaDelivery({ httpStatus: null, eventsReceived: 0, errorCode: "timeout", autoRetryCount: 1 }), "queued");
});

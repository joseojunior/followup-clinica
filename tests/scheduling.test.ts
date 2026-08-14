import assert from "node:assert/strict";
import test from "node:test";
import { nextAllowedSendAt, nextCadenceStepCandidate } from "../lib/scheduling.ts";

const weekdayWindow = {
  timezone: "America/Manaus",
  allowedStartTime: "09:00:00",
  allowedEndTime: "18:00:00",
  weekdays: [1, 2, 3, 4, 5, 6],
};

test("never returns a send time in the past", () => {
  const now = new Date("2026-08-17T12:00:00.000Z"); // 08:00 em Manaus
  const result = nextAllowedSendAt(new Date("2026-08-16T10:00:00.000Z"), weekdayWindow, now);
  assert.equal(result.toISOString(), "2026-08-17T13:00:00.000Z");
});

test("preserves the interval between steps when the current step was late", () => {
  const now = new Date("2026-08-17T15:00:00.000Z");
  const result = nextCadenceStepCandidate({
    anchor: new Date("2026-08-15T12:00:00.000Z"),
    now,
    currentDelayMinutes: 360,
    nextDelayMinutes: 720,
  });
  assert.equal(result.toISOString(), "2026-08-17T21:00:00.000Z");
});

test("keeps the absolute campaign schedule when processing is on time", () => {
  const anchor = new Date("2026-08-17T12:00:00.000Z");
  const result = nextCadenceStepCandidate({
    anchor,
    now: new Date("2026-08-17T18:00:00.000Z"),
    currentDelayMinutes: 360,
    nextDelayMinutes: 720,
  });
  assert.equal(result.toISOString(), "2026-08-18T00:00:00.000Z");
});

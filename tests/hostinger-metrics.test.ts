import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMetric, normalizeMetrics } from "../lib/hostinger-metrics.ts";

test("sorts Hostinger readings and keeps the latest measurement", () => {
  const result = normalizeMetric({ unit: "%", usage: { "1730000120": 32, "1730000000": 28, "1730000060": "31" } });
  assert.equal(result.points.length, 3);
  assert.equal(result.points[0]?.value, 28);
  assert.equal(result.latest?.value, 32);
  assert.equal(result.unit, "%");
});

test("ignores invalid measurements without inventing zero readings", () => {
  const result = normalizeMetric({ unit: "GB", usage: { "1730000000": null, "1730000060": "", "bad": 12, "1730000120": 13 } });
  assert.deepEqual(result.points.map((point) => point.value), [13]);
});

test("preserves empty series for unavailable VPS metrics", () => {
  const result = normalizeMetrics({ cpu_usage: { unit: "%", usage: { "1730000000": 5 } } });
  assert.equal(result.cpu_usage.latest?.value, 5);
  assert.equal(result.ram_usage.latest, null);
  assert.equal(result.disk_space.points.length, 0);
});

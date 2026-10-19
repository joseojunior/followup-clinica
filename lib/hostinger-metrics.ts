export type MetricPoint = { at: string; value: number };
export type MetricSeries = { unit: string; points: MetricPoint[]; latest: MetricPoint | null };
export type HostingerMetricName = "cpu_usage" | "ram_usage" | "disk_space" | "incoming_traffic" | "outgoing_traffic" | "uptime";
export type HostingerMetrics = Record<HostingerMetricName, MetricSeries>;

type RawMetric = { unit?: unknown; usage?: unknown };

export function normalizeMetric(raw: RawMetric | null | undefined): MetricSeries {
  const usage = raw?.usage && typeof raw.usage === "object" && !Array.isArray(raw.usage) ? raw.usage as Record<string, unknown> : {};
  const points = Object.entries(usage).flatMap(([timestamp, value]) => {
    const seconds = Number(timestamp);
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return [];
    const amount = Number(value);
    if (!Number.isFinite(seconds) || !Number.isFinite(amount) || seconds < 0) return [];
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? [] : [{ at: date.toISOString(), value: amount }];
  }).sort((a, b) => a.at.localeCompare(b.at)).slice(-1500);
  return { unit: typeof raw?.unit === "string" ? raw.unit : "", points, latest: points.at(-1) || null };
}

export function normalizeMetrics(raw: Record<string, unknown>): HostingerMetrics {
  const names: HostingerMetricName[] = ["cpu_usage", "ram_usage", "disk_space", "incoming_traffic", "outgoing_traffic", "uptime"];
  return Object.fromEntries(names.map((name) => [name, normalizeMetric(raw[name] as RawMetric | undefined)])) as HostingerMetrics;
}

import "server-only";
import { getHostingerApiKey } from "@/lib/hostinger-settings";
import { normalizeMetrics, type HostingerMetrics } from "@/lib/hostinger-metrics";

const API_BASE = "https://developers.hostinger.com/api/vps/v1";
export type HostingerPeriod = "24h" | "7d" | "30d";

type RawVm = {
  id?: unknown;
  hostname?: unknown;
  state?: unknown;
  plan?: unknown;
  cpus?: unknown;
  memory?: unknown;
  disk?: unknown;
  ipv4?: unknown;
};
export type HostingerVm = { id: number; hostname: string; state: string; plan: string; cpus: number | null; memoryMb: number | null; diskMb: number | null; ipv4: string | null };
export type HostingerOverview = { checkedAt: string; period: HostingerPeriod; vms: HostingerVm[]; selectedVm: HostingerVm; metrics: HostingerMetrics };

export class HostingerMonitorError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
}

function normalizeVm(raw: RawVm): HostingerVm | null {
  const id = numberOrNull(raw.id);
  if (id === null || !Number.isInteger(id) || id <= 0) return null;
  const ips = Array.isArray(raw.ipv4) ? raw.ipv4 : [];
  const firstIp = ips.find((item) => item && typeof item === "object" && typeof item.address === "string");
  return {
    id,
    hostname: typeof raw.hostname === "string" && raw.hostname ? raw.hostname : `VPS ${id}`,
    state: typeof raw.state === "string" ? raw.state : "unknown",
    plan: typeof raw.plan === "string" ? raw.plan : "VPS",
    cpus: numberOrNull(raw.cpus),
    memoryMb: numberOrNull(raw.memory),
    diskMb: numberOrNull(raw.disk),
    ipv4: firstIp?.address || null,
  };
}

async function apiGet(path: string, key: string) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { accept: "application/json", Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new HostingerMonitorError("Não foi possível alcançar a API da Hostinger.", 502);
  }
  if (response.status === 401 || response.status === 403) throw new HostingerMonitorError("A Hostinger recusou o token. Verifique se ele expirou ou foi revogado.", 502);
  if (response.status === 429) throw new HostingerMonitorError("Limite de consultas da Hostinger atingido. Tente novamente em alguns minutos.", 429);
  if (!response.ok) throw new HostingerMonitorError(`A API da Hostinger respondeu com HTTP ${response.status}.`, 502);
  return response.json().catch(() => { throw new HostingerMonitorError("A Hostinger retornou dados em formato inesperado.", 502); }) as Promise<unknown>;
}

export async function listHostingerVps(key: string): Promise<HostingerVm[]> {
  const body = await apiGet("/virtual-machines", key);
  const items = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? (body as { data: RawVm[] }).data : null;
  if (!items) throw new HostingerMonitorError("A lista de VPS veio em formato inesperado.", 502);
  return (items as RawVm[]).map(normalizeVm).filter((item): item is HostingerVm => item !== null);
}

export function isHostingerPeriod(value: string | null): value is HostingerPeriod {
  return value === "24h" || value === "7d" || value === "30d";
}

export async function getHostingerOverview(period: HostingerPeriod, requestedVmId?: number): Promise<HostingerOverview> {
  const key = await getHostingerApiKey();
  if (!key) throw new HostingerMonitorError("Cadastre um token da Hostinger na configuração do painel para acompanhar a VPS.", 503);
  const vms = await listHostingerVps(key);
  if (!vms.length) throw new HostingerMonitorError("Nenhuma VPS foi encontrada na conta vinculada ao token.", 404);
  const preferredIp = process.env.HOSTINGER_VPS_IP?.trim();
  const selectedVm = requestedVmId ? vms.find((vm) => vm.id === requestedVmId) : vms.find((vm) => vm.ipv4 === preferredIp) || vms[0];
  if (!selectedVm) throw new HostingerMonitorError("A VPS selecionada não pertence à conta vinculada.", 404);
  const now = new Date();
  const hours = period === "24h" ? 24 : period === "7d" ? 168 : 720;
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const query = new URLSearchParams({ date_from: from.toISOString(), date_to: now.toISOString() });
  const body = await apiGet(`/virtual-machines/${selectedVm.id}/metrics?${query}`, key);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HostingerMonitorError("As métricas da VPS vieram em formato inesperado.", 502);
  const payload = "data" in body && body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as Record<string, unknown> : body as Record<string, unknown>;
  return { checkedAt: new Date().toISOString(), period, vms, selectedVm, metrics: normalizeMetrics(payload) };
}

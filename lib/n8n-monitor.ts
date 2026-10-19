import "server-only";
import { getN8nApiKey } from "@/lib/n8n-settings";

const PAGE_SIZE = 250;
const MAX_EXECUTION_PAGES = 2;
const MAX_WORKFLOW_PAGES = 4;

type N8nPage<T> = { data: T[]; nextCursor?: string | null };
type N8nWorkflow = { id: string; name: string; active: boolean; updatedAt?: string | null; isArchived?: boolean };
type N8nExecution = {
  id: string;
  workflowId?: string | null;
  status?: string | null;
  mode?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  finished?: boolean;
};

export type N8nOverview = {
  checkedAt: string;
  editorUrl: string;
  sample: { executions: number; executionLimit: number; hasMoreExecutions: boolean; hasMoreWorkflows: boolean };
  totals: { workflows: number; active: number; inactive: number; success: number; error: number; running: number; other: number; successRate: number | null };
  workflows: Array<{ id: string; name: string; active: boolean; updatedAt: string | null; executions: number; errors: number; lastRunAt: string | null }>;
  recent: Array<{ id: string; workflowId: string | null; workflowName: string; status: string; startedAt: string | null; stoppedAt: string | null; durationMs: number | null; mode: string | null }>;
};

export class N8nMonitorError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function configuration() {
  const rawUrl = process.env.N8N_API_BASE_URL?.trim();
  const key = await getN8nApiKey();
  if (!rawUrl || !key) throw new N8nMonitorError("Configure N8N_API_BASE_URL e N8N_API_KEY no servidor para conectar o monitor.", 503);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new N8nMonitorError("O endereço da API do n8n está inválido.", 503); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new N8nMonitorError("Use HTTPS para conectar à API do n8n.", 503);
  }
  if (url.username || url.password || url.search || url.hash || !url.pathname.replace(/\/$/, "").endsWith("/api/v1")) throw new N8nMonitorError("O endereço da API precisa terminar em /api/v1, sem parâmetros ou credenciais.", 503);
  return { baseUrl: url.toString().replace(/\/$/, ""), editorUrl: `${url.origin}${url.pathname.replace(/\/api\/v1\/?$/, "")}`, key };
}

async function getPage<T>(baseUrl: string, key: string, resource: string, cursor?: string): Promise<N8nPage<T>> {
  const url = new URL(`${baseUrl}/${resource}`);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (resource === "executions") url.searchParams.set("includeData", "false");
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, {
    headers: { accept: "application/json", "X-N8N-API-KEY": key },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => { throw new N8nMonitorError("Não foi possível alcançar a API do n8n. Verifique o endereço e a rede.", 502); });
  if (response.status === 401 || response.status === 403) throw new N8nMonitorError("O n8n recusou a chave de API ou suas permissões de leitura.", 502);
  if (!response.ok) throw new N8nMonitorError(`A API do n8n respondeu com HTTP ${response.status}.`, 502);
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || !Array.isArray((body as N8nPage<T>).data)) {
    throw new N8nMonitorError("A API do n8n retornou um formato inesperado.", 502);
  }
  return body as N8nPage<T>;
}

async function getPages<T>(baseUrl: string, key: string, resource: string, maxPages: number) {
  const data: T[] = [];
  let cursor: string | undefined;
  let hasMore = false;
  for (let index = 0; index < maxPages; index++) {
    const page = await getPage<T>(baseUrl, key, resource, cursor);
    data.push(...page.data);
    cursor = page.nextCursor || undefined;
    hasMore = Boolean(cursor);
    if (!cursor) break;
  }
  return { data, hasMore };
}

function executionStatus(item: N8nExecution) {
  if (item.status) return item.status.toLowerCase();
  return item.finished ? "success" : "unknown";
}

function durationMs(item: N8nExecution) {
  if (!item.startedAt || !item.stoppedAt) return null;
  const value = new Date(item.stoppedAt).getTime() - new Date(item.startedAt).getTime();
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function getN8nOverview(): Promise<N8nOverview> {
  const { baseUrl, editorUrl, key } = await configuration();
  const [workflowPages, executionPages] = await Promise.all([
    getPages<N8nWorkflow>(baseUrl, key, "workflows", MAX_WORKFLOW_PAGES),
    getPages<N8nExecution>(baseUrl, key, "executions", MAX_EXECUTION_PAGES),
  ]);
  const workflows = workflowPages.data.filter((item) => !item.isArchived);
  const byId = new Map(workflows.map((item) => [String(item.id), item]));
  const executions = executionPages.data.map((item) => {
    const workflowId = item.workflowId == null ? null : String(item.workflowId);
    return {
      id: String(item.id), workflowId, workflowName: workflowId ? byId.get(workflowId)?.name || "Fluxo não listado" : "Fluxo não identificado",
      status: executionStatus(item), startedAt: item.startedAt || null, stoppedAt: item.stoppedAt || null,
      durationMs: durationMs(item), mode: item.mode || null,
    };
  }).sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
  const counts = new Map<string, { executions: number; errors: number; lastRunAt: string | null }>();
  for (const item of executions) {
    if (!item.workflowId) continue;
    const value = counts.get(item.workflowId) || { executions: 0, errors: 0, lastRunAt: null };
    value.executions++;
    if (["error", "crashed"].includes(item.status)) value.errors++;
    if (!value.lastRunAt && item.startedAt) value.lastRunAt = item.startedAt;
    counts.set(item.workflowId, value);
  }
  const success = executions.filter((item) => item.status === "success").length;
  const error = executions.filter((item) => ["error", "crashed"].includes(item.status)).length;
  const running = executions.filter((item) => ["running", "waiting", "new"].includes(item.status)).length;
  const completed = success + error;
  return {
    checkedAt: new Date().toISOString(), editorUrl,
    sample: { executions: executions.length, executionLimit: PAGE_SIZE * MAX_EXECUTION_PAGES, hasMoreExecutions: executionPages.hasMore, hasMoreWorkflows: workflowPages.hasMore },
    totals: { workflows: workflows.length, active: workflows.filter((item) => item.active).length, inactive: workflows.filter((item) => !item.active).length, success, error, running, other: executions.length - success - error - running, successRate: completed ? Math.round(success / completed * 1000) / 10 : null },
    workflows: workflows.map((item) => ({ id: String(item.id), name: item.name, active: Boolean(item.active), updatedAt: item.updatedAt || null, ...counts.get(String(item.id)) || { executions: 0, errors: 0, lastRunAt: null } })).sort((a, b) => b.errors - a.errors || b.executions - a.executions || a.name.localeCompare(b.name)),
    recent: executions,
  };
}

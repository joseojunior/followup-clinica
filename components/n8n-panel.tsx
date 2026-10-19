"use client";

import { useEffect, useMemo, useState } from "react";
import type { N8nOverview } from "@/lib/n8n-monitor";

type WorkflowFilter = "all" | "active" | "inactive" | "errors";
type N8nSettings = { keyConfigured: boolean; keySource: "admin" | "environment" | null; encryptionReady: boolean; baseUrl: string | null; updatedAt: string | null };
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const timeOnly = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1).replace(".", ",")} s`;
  return `${Math.round(value / 60_000)} min`;
}

function statusLabel(status: string) {
  return ({ success: "Concluída", error: "Erro", crashed: "Interrompida", running: "Executando", waiting: "Aguardando", canceled: "Cancelada", new: "Nova" } as Record<string, string>)[status] || status;
}

export function N8nPanel() {
  const [data, setData] = useState<N8nOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<N8nSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  async function loadSettings() {
    try {
      const response = await fetch("/api/n8n/settings", { cache: "no-store" });
      const result = await response.json() as N8nSettings & { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível consultar a configuração.");
      setSettings(result);
      setSettingsError(null);
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : "Não foi possível consultar a configuração.");
    }
  }

  async function saveKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingKey(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/n8n/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
      const result = await response.json() as N8nSettings & { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar a chave.");
      setSettings(result);
      setApiKey("");
      await load();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : "Não foi possível salvar a chave.");
    } finally {
      setSavingKey(false);
    }
  }

  async function load(initial = false) {
    if (initial) setLoading(true); else setRefreshing(true);
    try {
      const response = await fetch("/api/n8n/overview", { cache: "no-store" });
      const result = await response.json() as N8nOverview & { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível consultar o n8n.");
      setData(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar o n8n.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load(true);
    void loadSettings();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const workflows = useMemo(() => data?.workflows.filter((item) => {
    if (filter === "active" && !item.active) return false;
    if (filter === "inactive" && item.active) return false;
    if (filter === "errors" && !item.errors) return false;
    return item.name.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"));
  }) || [], [data, filter, query]);
  const incidents = data?.recent.filter((item) => ["error", "crashed"].includes(item.status)).slice(0, 8) || [];
  const signal = data?.recent.slice(0, 30).reverse() || [];

  return <div className="n8n-screen">
    <section className="n8n-hero">
      <div><p className="eyebrow">OBSERVABILIDADE / N8N</p><h2>Automações sob controle<span className="n8n-hero-period">.</span></h2><p>Veja quais fluxos estão ativos, como estão executando e onde surgiram falhas. Este painel apenas lê os dados; não altera fluxos nem reexecuta mensagens.</p></div>
      <div className="n8n-hero-actions"><span className={`n8n-live ${error ? "n8n-live-error" : ""}`}><i />{error ? "Conexão indisponível" : data ? "Conectado ao n8n" : "Verificando conexão"}</span><button className="secondary-button" onClick={() => void load()} disabled={refreshing || loading}>{refreshing ? "Atualizando…" : "Atualizar agora"}</button></div>
    </section>

    <details className="n8n-settings"><summary>Configuração da API <span>{settings?.keyConfigured ? `Chave configurada · ${settings.keySource === "admin" ? "painel" : "servidor"}` : "Conexão pendente"}</span></summary><div className="n8n-settings-body"><div><strong>Conexão segura com o n8n</strong><p>A chave fica criptografada no banco e só é usada pelo servidor. O endereço da API é definido no ambiente da stack; nenhuma credencial é mostrada nesta tela.</p><small>Endpoint: {settings?.baseUrl || "N8N_API_BASE_URL não configurado"}</small>{settings?.updatedAt && <small>Chave atualizada em {formatDate(settings.updatedAt)}</small>}{!settings?.encryptionReady && <p className="n8n-settings-warning">Para salvar pelo painel, configure AI_SETTINGS_ENCRYPTION_KEY no servidor.</p>}</div><form onSubmit={(event) => void saveKey(event)}><label htmlFor="n8n-api-key">Nova chave de API</label><input id="n8n-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Cole uma chave nova do n8n" /><button className="primary-button" disabled={savingKey || !apiKey.trim() || !settings?.encryptionReady}>{savingKey ? "Salvando…" : settings?.keyConfigured ? "Trocar chave" : "Conectar n8n"}</button><small>Se a chave foi compartilhada fora do servidor, revogue-a no n8n e gere outra antes de cadastrar.</small></form></div>{settingsError && <p className="n8n-settings-warning" role="alert">{settingsError}</p>}</details>

    {error && <div className="n8n-error" role="alert"><strong>Monitor indisponível</strong><span>{error}</span>{data && <small>Os números abaixo são da última consulta bem-sucedida.</small>}</div>}
    {loading && !data && <div className="n8n-loading" role="status">Consultando fluxos e execuções do n8n…</div>}

    {data && <>
      <div className="n8n-scope"><span>ÚLTIMA LEITURA <strong>{formatDate(data.checkedAt)}</strong></span><span>AMOSTRA <strong>{data.sample.executions} execuções recentes</strong></span><span>{data.sample.hasMoreExecutions ? "Há execuções anteriores fora desta amostra" : "Todas as execuções disponíveis foram lidas"}</span></div>
      <section className="n8n-metrics" aria-label="Indicadores do n8n">
        <article><span>FLUXOS ATIVOS</span><strong>{data.totals.active}<small> / {data.totals.workflows}</small></strong><p>{data.totals.inactive} inativo{data.totals.inactive === 1 ? "" : "s"}</p></article>
        <article><span>EXECUÇÕES NA AMOSTRA</span><strong>{data.sample.executions}</strong><p>Até {data.sample.executionLimit} mais recentes</p></article>
        <article className={data.totals.error ? "n8n-metric-alert" : ""}><span>FALHAS NA AMOSTRA</span><strong>{data.totals.error}</strong><p>Erros e interrupções</p></article>
        <article><span>SUCESSO CONCLUÍDO</span><strong>{data.totals.successRate === null ? "—" : `${data.totals.successRate}%`}</strong><p>{data.totals.success} concluídas · {data.totals.running} em andamento</p></article>
      </section>
      <section className="n8n-signal" aria-label="Últimas 30 execuções">
        <div><p className="eyebrow">PULSO DA AUTOMAÇÃO</p><strong>Últimas {signal.length} execuções</strong><span>Da esquerda, mais antiga → mais recente</span></div>
        <div className="n8n-signal-bars">{signal.length ? signal.map((item) => <span key={item.id} className={`n8n-signal-bar ${["error", "crashed"].includes(item.status) ? "error" : item.status === "success" ? "success" : "other"}`} title={`${item.workflowName} · ${statusLabel(item.status)} · ${formatDate(item.startedAt)}`} />) : <em>Sem execuções recentes</em>}</div>
      </section>
      <div className="n8n-columns">
        <section className="n8n-card n8n-workflows">
          <div className="n8n-card-heading"><div><p className="eyebrow">MAPA DE FLUXOS</p><h3>Workflows</h3><span>Execuções e falhas dentro da amostra consultada</span></div><strong>{workflows.length} exibidos</strong></div>
          <div className="n8n-filters"><label><span className="sr-only">Buscar fluxo</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar fluxo por nome" /></label><label><span className="sr-only">Filtrar fluxos</span><select value={filter} onChange={(event) => setFilter(event.target.value as WorkflowFilter)}><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="errors">Com erros</option></select></label></div>
          <div className="n8n-workflow-list">{workflows.length ? workflows.map((item) => <article key={item.id}><div className="n8n-workflow-title"><span className={`n8n-workflow-dot ${item.active ? "active" : ""}`} /><div><a href={`${data.editorUrl}/workflow/${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer">{item.name} ↗</a><small>Última execução: {formatDate(item.lastRunAt)}</small></div></div><div className="n8n-workflow-stats"><span>{item.executions} <small>exec.</small></span><span className={item.errors ? "has-errors" : ""}>{item.errors} <small>erros</small></span></div></article>) : <p className="n8n-empty">Nenhum fluxo corresponde ao filtro.</p>}</div>
          {data.sample.hasMoreWorkflows && <p className="n8n-footnote">A lista de fluxos atingiu o limite de consulta; alguns podem não aparecer.</p>}
        </section>
        <section className="n8n-card n8n-incidents"><div className="n8n-card-heading"><div><p className="eyebrow">ATENÇÃO OPERACIONAL</p><h3>Falhas recentes</h3><span>Até 8 falhas da amostra consultada</span></div><strong>{incidents.length}</strong></div>
          <div className="n8n-incident-list">{incidents.length ? incidents.map((item) => <article key={item.id}><div className="n8n-incident-top"><span className="n8n-incident-tag">{statusLabel(item.status)}</span><time dateTime={item.startedAt || undefined}>{formatDate(item.startedAt)}</time></div><strong>{item.workflowName}</strong><small>Execução #{item.id} · {formatDuration(item.durationMs)}{item.mode ? ` · ${item.mode}` : ""}</small>{item.workflowId && <a href={`${data.editorUrl}/workflow/${encodeURIComponent(item.workflowId)}/executions/${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer">Abrir no n8n ↗</a>}</article>) : <div className="n8n-all-clear"><span>✓</span><strong>Nenhuma falha nesta amostra</strong><p>As execuções consultadas não trouxeram erros. Consulte o histórico completo no n8n.</p></div>}</div>
        </section>
      </div>
      <p className="n8n-footnote">A taxa de sucesso considera apenas execuções concluídas nesta amostra. O painel não consulta conteúdo de conversas, entradas de nós ou credenciais. Horários exibidos em São Paulo.</p>
    </>}
  </div>;
}

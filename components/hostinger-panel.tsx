"use client";

import { useEffect, useState } from "react";
import type { HostingerOverview, HostingerPeriod } from "@/lib/hostinger-monitor";
import type { MetricSeries } from "@/lib/hostinger-metrics";

type Settings = { keyConfigured: boolean; keySource: "admin" | "environment" | null; encryptionReady: boolean; updatedAt: string | null };
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

function formatBytes(value: number) {
  const size = Math.abs(value);
  if (size >= 1024 ** 3) return `${numberFormat.format(value / 1024 ** 3)} GB`;
  if (size >= 1024 ** 2) return `${numberFormat.format(value / 1024 ** 2)} MB`;
  if (size >= 1024) return `${numberFormat.format(value / 1024)} KB`;
  return `${numberFormat.format(value)} B`;
}

function formatMetric(series: MetricSeries) {
  const value = series.latest?.value;
  if (value === undefined) return "—";
  const unit = series.unit.trim();
  const normalized = unit.toLowerCase();
  if (["percent", "percentage", "%"].includes(normalized)) return `${numberFormat.format(value)}%`;
  if (["byte", "bytes", "b"].includes(normalized)) return formatBytes(value);
  if (["second", "seconds", "s"].includes(normalized)) {
    const days = Math.floor(value / 86_400);
    const hours = Math.floor(value % 86_400 / 3_600);
    return days ? `${days} d ${hours} h` : `${hours} h`;
  }
  return `${numberFormat.format(value)}${unit ? ` ${unit}` : ""}`;
}

function Sparkline({ series, tone = "teal" }: { series: MetricSeries; tone?: "teal" | "coral" | "sun" }) {
  const points = series.points;
  if (points.length < 2) return <div className="hostinger-chart-empty">Sem histórico neste período</div>;
  const values = points.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const path = points.map((item, index) => `${index ? "L" : "M"}${(index / (points.length - 1) * 300).toFixed(1)},${(48 - ((item.value - min) / span * 36)).toFixed(1)}`).join(" ");
  return <svg className={`hostinger-chart ${tone}`} viewBox="0 0 300 60" preserveAspectRatio="none" role="img" aria-label={`Histórico de ${points.length} medições`}><path d="M0 53 H300" className="hostinger-chart-base" /><path d={path} className="hostinger-chart-line" /></svg>;
}

function CapacityLane({ label, series, tone, note }: { label: string; series: MetricSeries; tone: "teal" | "coral" | "sun"; note?: string }) {
  const peak = series.points.length ? Math.max(...series.points.map((point) => point.value)) : null;
  return <article className="hostinger-capacity-lane"><div className="hostinger-capacity-label"><span>{label}</span><strong>{formatMetric(series)}</strong><small>{note || (peak !== null ? `Pico no período: ${numberFormat.format(peak)}${series.unit ? ` ${series.unit}` : ""}` : "Aguardando medições")}</small></div><Sparkline series={series} tone={tone} /><time dateTime={series.latest?.at}>{formatDate(series.latest?.at || null)}</time></article>;
}

export function HostingerPanel() {
  const [data, setData] = useState<HostingerOverview | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [period, setPeriod] = useState<HostingerPeriod>("24h");
  const [vmId, setVmId] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load(initial = false) {
    if (initial) setLoading(true); else setRefreshing(true);
    try {
      const query = new URLSearchParams({ period });
      if (vmId) query.set("vmId", String(vmId));
      const response = await fetch(`/api/hostinger/overview?${query}`, { cache: "no-store" });
      const result = await response.json() as HostingerOverview & { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível consultar a VPS.");
      setData(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar a VPS.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadSettings() {
    try {
      const response = await fetch("/api/hostinger/settings", { cache: "no-store" });
      const result = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar a configuração.");
      setSettings(result);
      setSettingsError(null);
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : "Não foi possível carregar a configuração.");
    }
  }

  async function saveKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/hostinger/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
      const result = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar o token.");
      setSettings(result);
      setApiKey("");
      await load();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : "Não foi possível salvar o token.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { void load(true); }, [period, vmId]);
  useEffect(() => {
    void loadSettings();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 300_000);
    return () => window.clearInterval(timer);
  }, [period, vmId]);

  const observedAt = data?.metrics.cpu_usage.latest?.at || data?.metrics.ram_usage.latest?.at || data?.metrics.disk_space.latest?.at || null;
  const noReadings = data && Object.values(data.metrics).every((metric) => !metric.latest);

  return <div className="hostinger-screen">
    <section className="hostinger-heading"><div><p className="eyebrow">INFRAESTRUTURA / HOSTINGER</p><h2>Saúde da VPS<span>.</span></h2><p>Capacidade e tráfego da máquina que mantém a operação no ar. Medições históricas da Hostinger; nenhuma ação de controle é executada daqui.</p></div><div className="hostinger-heading-actions"><span className={`hostinger-state ${data?.selectedVm.state === "running" ? "running" : ""}`}><i />{data ? data.selectedVm.state === "running" ? "VPS em atividade" : `VPS: ${data.selectedVm.state}` : "Aguardando conexão"}</span><button className="secondary-button" disabled={loading || refreshing} onClick={() => void load()}>{refreshing ? "Atualizando…" : "Atualizar"}</button></div></section>

    <details className="hostinger-settings"><summary>Conexão com a Hostinger <span>{settings?.keyConfigured ? `Token configurado · ${settings.keySource === "admin" ? "painel" : "servidor"}` : "Token pendente"}</span></summary><div className="hostinger-settings-body"><div><strong>Token de acesso</strong><p>O token é validado na API antes de ser salvo e fica criptografado no banco. A validade é definida no hPanel e não pode ser identificada pelo texto do token.</p><small>{settings?.updatedAt ? `Última troca: ${formatDate(settings.updatedAt)}` : "Nenhuma troca registrada no painel"}</small>{!settings?.encryptionReady && <p className="hostinger-warning">Configure AI_SETTINGS_ENCRYPTION_KEY no servidor para salvar pelo painel.</p>}</div><form onSubmit={(event) => void saveKey(event)}><label htmlFor="hostinger-api-key">Novo token da Hostinger</label><input id="hostinger-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Cole o token aqui" /><button className="primary-button" disabled={saving || !apiKey.trim() || !settings?.encryptionReady}>{saving ? "Validando…" : settings?.keyConfigured ? "Trocar token" : "Conectar Hostinger"}</button><small>Tokens compartilhados em conversas devem ser revogados após a troca.</small></form></div>{settingsError && <p className="hostinger-warning" role="alert">{settingsError}</p>}</details>

    {error && <div className="hostinger-error" role="alert"><strong>Leitura indisponível</strong><span>{error}</span>{data && <small>Os dados abaixo são da última consulta bem-sucedida.</small>}</div>}
    {loading && !data && <div className="hostinger-loading" role="status">Consultando as métricas da Hostinger…</div>}

    {data && <><div className="hostinger-toolbar"><div className="hostinger-vm-name"><span className="hostinger-vm-icon">V</span><div><strong>{data.selectedVm.hostname}</strong><small>{data.selectedVm.plan} · {data.selectedVm.ipv4 || "IP não informado"} · {data.selectedVm.cpus ?? "—"} vCPU</small></div></div><div className="hostinger-controls">{data.vms.length > 1 && <label>VPS <select value={vmId ?? data.selectedVm.id} onChange={(event) => setVmId(Number(event.target.value))}>{data.vms.map((vm) => <option key={vm.id} value={vm.id}>{vm.hostname} · {vm.ipv4 || vm.id}</option>)}</select></label>}<label>Período <select value={period} onChange={(event) => setPeriod(event.target.value as HostingerPeriod)}><option value="24h">24 horas</option><option value="7d">7 dias</option><option value="30d">30 dias</option></select></label></div></div>
      <div className="hostinger-read-time"><span>ÚLTIMA CONSULTA <strong>{formatDate(data.checkedAt)}</strong></span><span>MEDIÇÃO MAIS RECENTE <strong>{formatDate(observedAt)}</strong></span><span>Os horários das medições podem diferir do horário da consulta.</span></div>
      {noReadings && <div className="hostinger-empty">A Hostinger não retornou medições para este período. Tente 7 ou 30 dias.</div>}
      <section className="hostinger-capacity"><div className="hostinger-section-title"><p className="eyebrow">PRESSÃO DE RECURSOS</p><h3>Capacidade da máquina</h3><span>O traçado mostra a variação no período selecionado</span></div><CapacityLane label="CPU" series={data.metrics.cpu_usage} tone="teal" note={`${data.selectedVm.cpus ?? "—"} vCPU disponíveis`} /><CapacityLane label="Memória" series={data.metrics.ram_usage} tone="sun" note={data.selectedVm.memoryMb ? `Capacidade contratada: ${numberFormat.format(data.selectedVm.memoryMb / 1024)} GB` : undefined} /><CapacityLane label="Disco" series={data.metrics.disk_space} tone="coral" note={data.selectedVm.diskMb ? `Capacidade contratada: ${numberFormat.format(data.selectedVm.diskMb / 1024)} GB` : undefined} /></section>
      <section className="hostinger-secondary"><div className="hostinger-section-title"><p className="eyebrow">CONTINUIDADE</p><h3>Rede e disponibilidade</h3></div><div className="hostinger-secondary-grid"><article><span>ENTRADA</span><strong>{formatMetric(data.metrics.incoming_traffic)}</strong><Sparkline series={data.metrics.incoming_traffic} /></article><article><span>SAÍDA</span><strong>{formatMetric(data.metrics.outgoing_traffic)}</strong><Sparkline series={data.metrics.outgoing_traffic} tone="sun" /></article><article><span>UPTIME</span><strong>{formatMetric(data.metrics.uptime)}</strong><small>Conforme medição da Hostinger</small></article></div></section>
      <p className="hostinger-footnote">Este painel mostra a VPS como um todo. O consumo individual do n8n, PostgreSQL e dos serviços Swarm exige uma coleta complementar na própria máquina. Horários exibidos em São Paulo.</p>
    </>}
  </div>;
}

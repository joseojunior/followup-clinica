"use client";

import { useEffect, useState } from "react";
import type { MetaStage, MetaUnit } from "@/lib/meta-core";
import { MetaEventsGuide } from "@/components/meta-events-guide";

type Policy = { eventType: MetaStage; approved: boolean; exportEnabled: boolean; approvedBy: string | null; approvedAt: string | null };
type Unit = { unit: MetaUnit; enabled: boolean; verifiedAt: string | null; datasetId: string | null; wabaId: string | null; tokenConfigured: boolean; inboundTokenConfigured: boolean; policies: Policy[] };
type Event = { id: string; unit: MetaUnit; event_type: MetaStage; state: string; reason: string | null; occurred_at: string; attempts: number; chat_mask: string; ctwa_origin: string | null; fbtrace_id: string | null; source_id: string | null; dataset_id: string | null; page_id: string | null };
type Overview = { mode: "record_only" | "live"; encryptionReady: boolean; graphVersionConfigured: boolean; ingestUrl: string | null;
  counts: { received: number; noCtwa: number; awaitingApproval: number; queued: number; accepted: number; failed: number };
  funnel: Partial<Record<MetaStage, number>>; events: Event[]; units: Unit[] };

const stageNames: Record<MetaStage, string> = { conversation_started: "Conversa iniciada", lead_qualified: "Lead qualificado", appointment_confirmed: "Agendamento confirmado", payment_confirmed: "Pagamento confirmado" };
const stateNames: Record<string, string> = { no_ctwa: "Sem CTWA", internal_only: "Somente interno", awaiting_approval: "Aguardando aprovação", queued: "Na fila", sending: "Enviando", accepted: "Aceito pela Meta", failed: "Falhou" };
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const unitName = (unit: MetaUnit) => unit === "sender_1" ? "Unidade 1" : "Unidade 2";

export function MetaEventsPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [unit, setUnit] = useState<"all" | MetaUnit>("all");
  const [days, setDays] = useState(7);
  const [search, setSearch] = useState("");
  const [settingsUnit, setSettingsUnit] = useState<MetaUnit>("sender_1");
  const [accessToken, setAccessToken] = useState("");
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [browserOrigin, setBrowserOrigin] = useState("");
  const [sampleTime, setSampleTime] = useState("2026-11-01T14:30:00Z");

  async function load() {
    try {
      const params = new URLSearchParams({ unit, days: String(days), search });
      const response = await fetch(`/api/meta-events?${params}`, { cache: "no-store" });
      const body = await response.json() as Overview & { error?: string };
      if (!response.ok) throw new Error(body.error || "Não foi possível consultar os eventos.");
      setData(body);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha de leitura."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [unit, days, search]);
  useEffect(() => { setBrowserOrigin(window.location.origin); setSampleTime(new Date().toISOString()); }, []);
  useEffect(() => {
    setAccessToken("");
  }, [settingsUnit, data?.units]);
  useEffect(() => { setOneTimeToken(null); }, [settingsUnit]);

  async function admin(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/meta-events/admin", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ unit: settingsUnit, action, ...extra }) });
      const body = await response.json() as { error?: string; token?: string; datasetReadable?: boolean; wabaReadable?: boolean; numberMatches?: boolean };
      if (!response.ok) throw new Error(body.error || "Ação indisponível.");
      if (body.token) setOneTimeToken(body.token);
      if (action === "test") setMessage(`Leitura: dataset ${body.datasetReadable ? "OK" : "falhou"}; WABA ${body.wabaReadable ? "OK" : "falhou"}; número ${body.numberMatches ? "corresponde à unidade" : "não corresponde ou indisponível"}. Nenhum evento foi enviado.`);
      else setMessage(action === "rotate_token" ? "Token criado. Copie agora; ele não será mostrado novamente." : "Alteração salva e auditada.");
      setAccessToken("");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Ação indisponível."); }
    finally { setBusy(false); }
  }

  async function retry(event: Event) {
    setSettingsUnit(event.unit);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/meta-events/admin", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ unit: event.unit, action: "retry", eventId: event.id }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Falha no reprocessamento.");
      await load(); setMessage("Evento recolocado na fila com o mesmo identificador.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha no reprocessamento."); }
    finally { setBusy(false); }
  }

  const current = data?.units.find((item) => item.unit === settingsUnit);
  const ingestUrl = data?.ingestUrl || `${browserOrigin}/api/integrations/n8n/meta-events`;
  const maxFunnel = Math.max(1, ...Object.values(data?.funnel || {}).map(Number));
  return <div className="meta-screen">
    <section className="meta-heading"><div><h2>Eventos Meta</h2><p>Do acontecimento no n8n ao recebimento pela Meta, com trilha separada para cada número. A plataforma registra etapas mesmo quando não há clique CTWA.</p></div><span className={`meta-mode ${data?.mode === "live" ? "live" : ""}`}>{data?.mode === "live" ? "Exportação live" : "Somente registro interno"}</span></section>
    <div className="meta-toolbar"><label>Unidade<select value={unit} onChange={(event) => setUnit(event.target.value as "all" | MetaUnit)}><option value="all">Todas</option><option value="sender_1">Unidade 1</option><option value="sender_2">Unidade 2</option></select></label><label>Período<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>24 horas</option><option value={7}>7 dias</option><option value={30}>30 dias</option></select></label><label className="meta-search">Buscar por ID ou final do chat<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar evento" /></label><button className="secondary-button" onClick={() => void load()} disabled={busy}>Atualizar</button></div>
    {message && <p className="meta-feedback" role="status">{message}</p>}
    {loading && <p className="meta-empty">Carregando eventos…</p>}
    {data && <>
      <section className="meta-counts" aria-label="Resumo de eventos">{([ ["Recebidos", data.counts.received], ["Sem CTWA", data.counts.noCtwa], ["Aguardando aprovação", data.counts.awaitingApproval], ["Na fila", data.counts.queued], ["Aceitos pela Meta", data.counts.accepted], ["Falhos", data.counts.failed] ] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
      <section className="meta-funnel"><div><h3>Funil registrado</h3><p>Todas as etapas aparecem aqui; somente as aprovadas podem ser candidatas à exportação.</p></div><div className="meta-funnel-rows">{(Object.keys(stageNames) as MetaStage[]).map((stage) => <div className="meta-funnel-row" key={stage}><span>{stageNames[stage]}</span><div><i style={{ width: `${100 * (data.funnel[stage] || 0) / maxFunnel}%` }} /></div><strong>{data.funnel[stage] || 0}</strong></div>)}</div></section>
      <section className="meta-log"><div className="meta-section-head"><h3>Registro de eventos</h3><small>“Aceito” confirma a resposta da API, não atribuição publicitária.</small></div>{data.events.length ? <div className="meta-log-list">{data.events.map((event) => <article key={event.id}><time>{dateTime.format(new Date(event.occurred_at))}</time><div><strong>{stageNames[event.event_type]}</strong><small>{unitName(event.unit)} · chat {event.chat_mask} · CTWA {event.ctwa_origin === "history" ? "histórico" : event.ctwa_origin === "source" ? "da fonte" : "ausente"}</small></div><span className={`meta-state ${event.state}`}>{stateNames[event.state] || event.state}</span><small>{event.reason || (event.fbtrace_id ? `Meta trace: ${event.fbtrace_id}` : "—")}</small><span>{event.attempts} tent.</span>{event.state === "failed" && <button className="secondary-button" disabled={busy || data.mode !== "live"} onClick={() => void retry(event)}>Reprocessar</button>}</article>)}</div> : <p className="meta-empty">Nenhum acontecimento registrado neste período. Confira o nó HTTP Request no workflow.</p>}</section>
    </>}
    <section className="meta-config"><div className="meta-section-head"><div><h3>Configuração por unidade</h3><p>Credenciais e aprovações nunca são compartilhadas entre números. Não é necessário informar IDs da Meta para receber e armazenar eventos.</p></div><select aria-label="Unidade para configuração" value={settingsUnit} onChange={(event) => setSettingsUnit(event.target.value as MetaUnit)}><option value="sender_1">Unidade 1</option><option value="sender_2">Unidade 2</option></select></div>
      <div className="meta-config-grid"><div className="meta-config-form">
        <h4>Token de acesso Meta</h4>
        <p>A chave fica criptografada no servidor. Salvá-la não habilita envios nem comprova permissão para exportar dados.</p>
        <label>Token de acesso Meta<input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="new-password" placeholder={current?.tokenConfigured ? "Configurado · cole para trocar" : "Cole o token"} /></label>
        <div className="meta-actions"><button className="primary-button" disabled={busy || !data?.encryptionReady || !accessToken.trim()} onClick={() => void admin("save_unit", { accessToken })}>Salvar token</button></div>
        <small>A exportação sem WABA ainda está em revisão técnica e de privacidade. Remover os campos do formulário não remove as validações do servidor nem libera o envio de eventos clínicos. A captação interna pelo n8n permanece disponível.</small>
        <label className="meta-toggle"><input type="checkbox" checked={current?.enabled || false} disabled={busy || !current?.enabled} onChange={(event) => void admin("save_unit", { enabled: event.target.checked })} />Unidade habilitada para exportação</label>
        <small>O modo global “somente registro” continua impedindo qualquer envio real. Nenhum ID já armazenado é apagado ao salvar o token.</small>
      </div>
      <div className="meta-policies"><h4>Revisão de eventos</h4><p>Dados de saúde exigem avaliação dos Termos da Meta e privacidade antes de cada liberação. Nome genérico ou hashing não torna o envio automaticamente permitido.</p><label className="meta-toggle"><input type="checkbox" checked={privacyChecked} onChange={(event) => setPrivacyChecked(event.target.checked)} />Confirmo que revisei a finalidade, os dados e os <a href="https://www.facebook.com/legal/technology_terms" target="_blank" rel="noreferrer">Termos das Ferramentas de Negócios</a>.</label>{current?.policies.map((policy) => <div className="meta-policy" key={policy.eventType}><div><strong>{stageNames[policy.eventType]}</strong><small>{policy.approved ? `Aprovado · ${policy.approvedAt ? dateTime.format(new Date(policy.approvedAt)) : "data indisponível"}` : "Não aprovado"}{policy.eventType === "payment_confirmed" || policy.eventType === "appointment_confirmed" ? " · apenas interno" : ""}</small></div>{policy.eventType === "conversation_started" || policy.eventType === "lead_qualified" ? <div>{!policy.approved && <button className="secondary-button" disabled={busy || !privacyChecked} onClick={() => void admin("policy", { eventType: policy.eventType, policyAction: "approve", privacyReviewConfirmed: true })}>Aprovar</button>}<button className="secondary-button" disabled={busy || (!policy.approved && !policy.exportEnabled)} onClick={() => void admin("policy", { eventType: policy.eventType, policyAction: policy.exportEnabled ? "disable" : "enable" })}>{policy.exportEnabled ? "Desabilitar" : "Habilitar"}</button></div> : <span>Interno</span>}</div>)}</div></div>
    </section>
    <section className="meta-guide"><div className="meta-section-head"><div><h3>Guia do n8n · {unitName(settingsUnit)}</h3><p>Crie uma credencial Bearer exclusiva para esta unidade e use-a no nó HTTP Request.</p></div><button className="secondary-button" disabled={busy} onClick={() => void admin("rotate_token")}>{current?.inboundTokenConfigured ? "Rotacionar token" : "Criar token"}</button></div>{oneTimeToken && <div className="meta-one-time"><strong>Copie agora — não aparecerá novamente</strong><code>{oneTimeToken}</code><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(oneTimeToken)}>Copiar token</button></div>}
      <MetaEventsGuide unit={settingsUnit} url={ingestUrl} timestamp={sampleTime} />
    </section>
  </div>;
}

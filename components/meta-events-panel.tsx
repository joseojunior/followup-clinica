"use client";

import { useEffect, useState } from "react";
import type { MetaStage, MetaUnit } from "@/lib/meta-core";
import type { MetaAssetValidation, AssetCheck } from "@/lib/meta-asset-validation";
import { MetaEventsGuide } from "@/components/meta-events-guide";
import { ConsultingMetaPanel } from "@/components/consulting-meta-panel";

type Policy = { eventType: MetaStage; approved: boolean; exportEnabled: boolean; approvedBy: string | null; approvedAt: string | null };
type Unit = { unit: MetaUnit; enabled: boolean; verifiedAt: string | null; datasetId: string | null; wabaId: string | null; tokenConfigured: boolean; inboundTokenConfigured: boolean; policies: Policy[]; assetValidation: MetaAssetValidation | null };
type Event = { id: string; unit: MetaUnit; event_type: MetaStage; state: string; reason: string | null; occurred_at: string; attempts: number; chat_mask: string; ctwa_origin: string | null; fbtrace_id: string | null; source_id: string | null; dataset_id: string | null; page_id: string | null };
type Overview = { mode: "record_only" | "live"; encryptionReady: boolean; graphVersionConfigured: boolean; ingestUrl: string | null;
  counts: { received: number; noCtwa: number; awaitingApproval: number; queued: number; accepted: number; failed: number };
  funnel: Partial<Record<MetaStage, number>>; events: Event[]; units: Unit[] };

const stageNames: Record<MetaStage, string> = { conversation_started: "Conversa iniciada", lead_qualified: "Lead qualificado", payment_requested: "Pedido de sinal", payment_pending: "Pagamento pendente", payment_confirmed: "Pagamento confirmado", appointment_confirmed: "Agendamento confirmado" };
const stateNames: Record<string, string> = { no_ctwa: "Sem CTWA", internal_only: "Somente interno", awaiting_approval: "Aguardando aprovação", queued: "Na fila", sending: "Enviando", accepted: "Aceito pela Meta", failed: "Falhou" };
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const unitName = (unit: MetaUnit) => unit === "sender_1" ? "Unidade 1" : "Unidade 2";
const checkNames: Record<AssetCheck["key"], string> = { configuration: "Configuração", token: "Token", ad: "Anúncio", destination: "Destino do anúncio", page: "Página", dataset: "Dataset" };
const checkStates = { passed: "Confirmado", failed: "Falhou", skipped: "Não consultado" };

export function MetaEventsPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [unit, setUnit] = useState<"all" | MetaUnit>("all");
  const [days, setDays] = useState(7);
  const [search, setSearch] = useState("");
  const [settingsUnit, setSettingsUnit] = useState<MetaUnit>("sender_1");
  const [accessToken, setAccessToken] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [testing, setTesting] = useState(false);
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
  useEffect(() => { setOneTimeToken(null); setSourceId(""); }, [settingsUnit]);

  async function admin(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setTesting(action === "test"); setMessage("");
    try {
      const response = await fetch("/api/meta-events/admin", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ unit: settingsUnit, action, ...extra }) });
      const body = await response.json() as { error?: string; token?: string; reason?: string };
      if (!response.ok) throw new Error(body.error || "Ação indisponível.");
      if (body.token) setOneTimeToken(body.token);
      if (action === "test") setMessage(body.reason || "Teste concluído. Confira o diagnóstico por recurso abaixo. Nenhum evento foi enviado.");
      else setMessage(action === "rotate_token" ? "Token criado. Copie agora; ele não será mostrado novamente." : "Alteração salva e auditada.");
      setAccessToken("");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Ação indisponível."); }
    finally { setBusy(false); setTesting(false); }
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
    <section className="meta-config"><div className="meta-section-head"><div><h3>Configuração por unidade</h3><p>Credenciais e aprovações nunca são compartilhadas entre números. Não é necessário informar IDs da Meta para receber e armazenar eventos.</p></div><select aria-label="Unidade para configuração" value={settingsUnit} disabled={busy} onChange={(event) => setSettingsUnit(event.target.value as MetaUnit)}><option value="sender_1">Unidade 1</option><option value="sender_2">Unidade 2</option></select></div>
      <div className="meta-config-grid"><div className="meta-config-form">
        <h4>Token de acesso Meta</h4>
        <p>A chave fica criptografada no servidor. Salvá-la não habilita envios nem comprova permissão para exportar dados.</p>
        <label>Token de acesso Meta<input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="new-password" placeholder={current?.tokenConfigured ? "Configurado · cole para trocar" : "Cole o token"} /></label>
        <div className="meta-actions"><button className="primary-button" disabled={busy || !data?.encryptionReady || !accessToken.trim()} onClick={() => void admin("save_unit", { accessToken })}>Salvar token</button></div>
        <h4>Teste de acesso sem WABA</h4>
        <p>Consulta somente token, anúncio, Página e dataset. Não envia CTWA nem eventos e não autoriza exportação.</p>
        <label>ID do anúncio (source_id) · opcional<input inputMode="numeric" value={sourceId} onChange={(event) => setSourceId(event.target.value)} maxLength={30} placeholder="Usar o último anúncio capturado nesta unidade" aria-describedby="meta-test-help" disabled={busy} /></label>
        <small id="meta-test-help">O anúncio precisa ter sido recebido pelo n8n nesta unidade. Página e dataset são descobertos automaticamente; não é necessário informá-los.</small>
        <div className="meta-actions"><button className="secondary-button" disabled={busy || !data || data.mode !== "record_only" || Boolean(accessToken.trim())} onClick={() => void admin("test", { sourceId })}>{testing ? "Consultando a Meta…" : "Testar acesso aos ativos"}</button></div>
        {accessToken.trim() && <small>Salve o novo token antes de testar. O teste utiliza a credencial guardada no servidor.</small>}
        {data?.mode === "live" && <small>Para este diagnóstico, configure META_EXPORT_MODE=record_only no servidor.</small>}
        <div className="meta-asset-result" aria-busy={testing}>
          {current?.assetValidation ? <>
            <strong>{current.assetValidation.status === "passed" ? "Acesso de leitura confirmado" : "Verificação com pendências"}</strong>
            <small>Último teste · {dateTime.format(new Date(current.assetValidation.checkedAt))} · Graph {current.assetValidation.graphVersion || "não configurada"}</small>
            <p>{current.assetValidation.reason}</p>
            <dl className="meta-asset-ids"><dt>Anúncio</dt><dd>{current.assetValidation.sourceId || "Não disponível"}</dd><dt>page_id</dt><dd>{current.assetValidation.pageId || "Não descoberto"}</dd><dt>dataset_id</dt><dd>{current.assetValidation.datasetId || "Não descoberto"}</dd></dl>
            {current.assetValidation.trackingSpecs && <div className="meta-tracking-summary"><strong>IDs do tracking_specs (repetidos consolidados)</strong><span>Dataset · {current.assetValidation.trackingSpecs.dataset.itemCount} ocorrência(s), {current.assetValidation.trackingSpecs.dataset.ids.length} distinto(s), {current.assetValidation.trackingSpecs.dataset.duplicateCount} duplicata(s)</span><small>{current.assetValidation.trackingSpecs.dataset.ids.join(", ") || "Nenhum ID"}</small><span>Página · {current.assetValidation.trackingSpecs.page.itemCount} ocorrência(s), {current.assetValidation.trackingSpecs.page.ids.length} distinto(s), {current.assetValidation.trackingSpecs.page.duplicateCount} duplicata(s)</span><small>{current.assetValidation.trackingSpecs.page.ids.join(", ") || "Nenhum ID"}</small></div>}
            <ul className="meta-asset-checks">{current.assetValidation.checks.map((check) => <li key={check.key}><div><strong>{checkNames[check.key]}</strong><span className={`meta-state ${check.status === "passed" ? "accepted" : check.status === "failed" ? "failed" : ""}`}>{checkStates[check.status]}</span></div><p>{check.reason}{check.httpStatus ? ` HTTP ${check.httpStatus}.` : ""}{check.errorCode !== undefined ? ` Código Meta ${check.errorCode}.` : ""}</p></li>)}</ul>
            <details className="meta-trace"><summary>Trace das consultas à Meta · {current.assetValidation.trace?.length ?? 0}</summary><div className="meta-trace-list">{(current.assetValidation.trace ?? []).map((entry, index) => <article key={`${entry.path}-${index}`}><strong>{entry.method} · {entry.path}</strong><span>{entry.status ?? "sem resposta"} · {entry.durationMs} ms · {entry.outcome === "passed" ? "OK" : "falhou"}{entry.errorCode !== undefined ? ` · erro ${entry.errorCode}` : ""}</span>{entry.fbtraceId && <small>fbtrace_id · {entry.fbtraceId}</small>}</article>)}{!current.assetValidation.trace?.length && <p>Este resultado não contém trace. Execute um novo teste para registrar as consultas.</p>}</div></details>
          </> : <p>Nenhum teste salvo para esta credencial. Execute o teste para ver o diagnóstico de cada recurso.</p>}
          <small>Mesmo com acesso confirmado, o vínculo ao número WhatsApp e a compatibilidade de envio sem WABA não estão comprovados. Nenhum evento é enviado neste teste.</small>
        </div>
        <label className="meta-toggle"><input type="checkbox" checked={current?.enabled || false} disabled={busy || !current?.enabled} onChange={(event) => void admin("save_unit", { enabled: event.target.checked })} />Unidade habilitada para exportação</label>
        <small>O modo global “somente registro” bloqueia o envio automático desta área anterior. A nova área de consultoria possui testes manuais explícitos, sem liberação de produção. Nenhum ID já armazenado é apagado ao salvar o token.</small>
      </div>
      <div className="meta-policies"><h4>Revisão de eventos</h4><p>Dados de saúde exigem avaliação dos Termos da Meta e privacidade antes de cada liberação. Nome genérico ou hashing não torna o envio automaticamente permitido.</p><label className="meta-toggle"><input type="checkbox" checked={privacyChecked} onChange={(event) => setPrivacyChecked(event.target.checked)} />Confirmo que revisei a finalidade, os dados e os <a href="https://www.facebook.com/legal/technology_terms" target="_blank" rel="noreferrer">Termos das Ferramentas de Negócios</a>.</label>{current?.policies.map((policy) => <div className="meta-policy" key={policy.eventType}><div><strong>{stageNames[policy.eventType]}</strong><small>{policy.approved ? `Aprovado · ${policy.approvedAt ? dateTime.format(new Date(policy.approvedAt)) : "data indisponível"}` : "Não aprovado"}{policy.eventType === "payment_confirmed" || policy.eventType === "appointment_confirmed" ? " · apenas interno" : ""}</small></div>{policy.eventType === "conversation_started" || policy.eventType === "lead_qualified" ? <div>{!policy.approved && <button className="secondary-button" disabled={busy || !privacyChecked} onClick={() => void admin("policy", { eventType: policy.eventType, policyAction: "approve", privacyReviewConfirmed: true })}>Aprovar</button>}<button className="secondary-button" disabled={busy || (!policy.approved && !policy.exportEnabled)} onClick={() => void admin("policy", { eventType: policy.eventType, policyAction: policy.exportEnabled ? "disable" : "enable" })}>{policy.exportEnabled ? "Desabilitar" : "Habilitar"}</button></div> : <span>Interno</span>}</div>)}</div></div>
    </section>
    <ConsultingMetaPanel key={settingsUnit} unit={settingsUnit} />
    <section className="meta-guide"><div className="meta-section-head"><div><h3>Guia do n8n · {unitName(settingsUnit)}</h3><p>Crie uma credencial Bearer exclusiva para esta unidade e use-a no nó HTTP Request.</p></div><button className="secondary-button" disabled={busy} onClick={() => void admin("rotate_token")}>{current?.inboundTokenConfigured ? "Rotacionar token" : "Criar token"}</button></div>{oneTimeToken && <div className="meta-one-time"><strong>Copie agora — não aparecerá novamente</strong><code>{oneTimeToken}</code><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(oneTimeToken)}>Copiar token</button></div>}
      <MetaEventsGuide unit={settingsUnit} url={ingestUrl} timestamp={sampleTime} />
    </section>
  </div>;
}

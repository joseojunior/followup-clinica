import { digest, isMetaStage, isMetaUnit, normalizeMetaPhone, inspectAdDestinations, type MetaStage } from "./meta-core.ts";

export const CONSULTING_CONTEXT = "consulting_v1";
export const consultingEventName = (stage: MetaStage) => ({ conversation_started: "LeadSubmitted", lead_qualified: "QualifiedLead", payment_requested: "InitiateCheckout", payment_pending: null, payment_confirmed: null, appointment_confirmed: "Purchase" } as const)[stage];

export function validateConsultingEvent(value: unknown, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON inválido.");
  const b = value as Record<string, unknown>;
  const allowed = ["context", "unit", "chat_id", "event_type", "source_event_id", "occurred_at", "ctwa_clid", "source_id", "phone", "name", "deposit_paid", "transaction_id", "value"];
  if (Object.keys(b).some(k => !allowed.includes(k))) throw new Error("Campo não permitido; não envie dados de saúde ou histórico antigo.");
  if (b.context !== CONSULTING_CONTEXT || !isMetaUnit(b.unit) || !isMetaStage(b.event_type)) throw new Error("Informe context=consulting_v1, unidade e etapa válidas.");
  const text = (key: string, max = 180) => {
    const raw = b[key];
    if (typeof raw !== "string" || !raw.trim() || raw.length > max || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error(`${key} inválido.`);
    return raw.trim();
  };
  const occurred = text("occurred_at", 60);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(occurred)) throw new Error("Horário ISO 8601 com fuso obrigatório.");
  const occurredAt = new Date(occurred);
  if (!Number.isFinite(+occurredAt) || +occurredAt > now + 300_000 || +occurredAt < now - 7 * 86400_000) throw new Error("Horário fora da janela de sete dias.");
  const first = b.event_type === "conversation_started";
  if (!first && ["ctwa_clid", "source_id", "phone", "name"].some(k => b[k] !== undefined)) throw new Error("CTWA, anúncio e identidade somente na nova conversa de consultoria.");
  const ctwa = b.ctwa_clid === undefined ? null : text("ctwa_clid", 1000);
  if (ctwa && !/^[!-~]{12,1000}$/.test(ctwa)) throw new Error("CTWA inválido.");
  const sourceId = b.source_id === undefined ? null : text("source_id", 30);
  if (sourceId && !/^\d{5,30}$/.test(sourceId)) throw new Error("source_id deve ser numérico.");
  const ph = b.phone === undefined ? null : digest(normalizeMetaPhone(b.phone));
  const name = b.name === undefined ? null : text("name", 160).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  if (name && !/^[\p{L} '\-]+$/u.test(name)) throw new Error("Nome inválido.");
  const names = name?.split(" ") || [];
  if (b.deposit_paid !== undefined && typeof b.deposit_paid !== "boolean") throw new Error("deposit_paid deve ser booleano.");
  const purchase = b.event_type === "appointment_confirmed";
  if (!purchase && ["deposit_paid", "transaction_id", "value"].some(k => b[k] !== undefined)) throw new Error("Dados de sinal somente no agendamento confirmado.");
  if (purchase && b.deposit_paid !== true) throw new Error("Purchase exige confirmação efetiva do sinal: deposit_paid=true.");
  const transactionHash = purchase ? digest(text("transaction_id")) : null;
  const amount = b.value === undefined ? 50 : b.value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new Error("Valor BRL inválido; use número com até duas casas decimais.");
  return { unit: b.unit, stage: b.event_type, chatHash: digest(`${CONSULTING_CONTEXT}:${b.unit}:${text("chat_id")}`),
    sourceEventId: text("source_event_id"), occurredAt, ctwa, sourceId, ph,
    fn: names.length ? digest(names[0]) : null, ln: names.length > 1 ? digest(names.slice(1).join(" ")) : null,
    transactionHash, value: purchase ? amount : null };
}

/** Fallback only for missing IDs, never to hide two distinct automatic destinations. */
export function consultingDestination(ad: unknown | null, fallback: { pageId: string | null; datasetId: string | null }) {
  const summary = ad === null ? null : inspectAdDestinations(ad);
  if (summary && (summary.page.ids.length > 1 || summary.dataset.ids.length > 1)) throw new Error("Destinos automáticos distintos; revise o anúncio antes de testar.");
  const pageId = summary?.page.ids[0] || fallback.pageId;
  const datasetId = summary?.dataset.ids[0] || fallback.datasetId;
  if (!pageId || !datasetId || !/^\d{5,30}$/.test(pageId) || !/^\d{5,30}$/.test(datasetId)) throw new Error("Página/dataset ausentes. Configure os IDs manuais para fallback.");
  return { pageId, datasetId, pageOrigin: summary?.page.ids.length ? "ad" : "manual", datasetOrigin: summary?.dataset.ids.length ? "ad" : "manual" };
}

export function consultingTestPayload(event: { id: string; stage: MetaStage; occurredAt: Date; value: number | null }, identity: { ctwa: string; ph?: string | null; fn?: string | null; ln?: string | null }, pageId: string, testCode: string) {
  if (!/^TEST[A-Za-z0-9_-]{1,50}$/.test(testCode)) throw new Error("Código de teste obrigatório (TEST...).");
  const eventName = consultingEventName(event.stage);
  if (!eventName) throw new Error("Esta etapa permanece interna; não possui evento Meta.");
  if (!identity.ctwa) throw new Error("Nova conversa sem CTWA; envio atribuído indisponível.");
  return { test_event_code: testCode, data: [{ event_name: eventName, event_time: Math.floor(+event.occurredAt / 1000), event_id: `consulting-test:${event.id}`,
    action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { page_id: pageId, ctwa_clid: identity.ctwa,
      ...(identity.ph ? { ph: [identity.ph] } : {}), ...(identity.fn ? { fn: [identity.fn] } : {}), ...(identity.ln ? { ln: [identity.ln] } : {}) },
    ...(eventName === "Purchase" ? { custom_data: { currency: "BRL", value: event.value, content_name: "Sinal de agendamento de consultoria" } } : {}) }] };
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const META_UNITS = ["sender_1", "sender_2"] as const;
export const META_STAGES = ["conversation_started", "lead_qualified", "payment_requested", "payment_pending", "payment_confirmed", "appointment_confirmed"] as const;
export type MetaUnit = typeof META_UNITS[number];
export type MetaStage = typeof META_STAGES[number];

export function isMetaUnit(value: unknown): value is MetaUnit { return META_UNITS.includes(value as MetaUnit); }
export function isMetaStage(value: unknown): value is MetaStage { return META_STAGES.includes(value as MetaStage); }
export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function equalDigest(value: string, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(digest(value), "hex"), Buffer.from(expected, "hex"));
}
export function validateMetaInput(value: unknown, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Corpo JSON inválido.");
  const body = value as Record<string, unknown>;
  const allowed = new Set(["unit", "chat_id", "phone", "source_id", "event_type", "occurred_at", "source_event_id", "ctwa_clid", "attribution"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("O corpo contém campos não permitidos.");
  if (!isMetaUnit(body.unit) || !isMetaStage(body.event_type)) throw new Error("Unidade ou etapa inválida.");
  for (const field of ["chat_id", "source_event_id"] as const) {
    if (typeof body[field] !== "string" || !body[field].trim() || body[field].length > 180) throw new Error(`${field} inválido.`);
  }
  if (typeof body.occurred_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(body.occurred_at)) throw new Error("occurred_at deve ser ISO 8601 com fuso horário.");
  const timestamp = Date.parse(body.occurred_at);
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - 30 * 86_400_000) throw new Error("occurred_at fora do intervalo permitido de 30 dias.");
  if (body.ctwa_clid !== undefined && (body.event_type !== "conversation_started" || typeof body.ctwa_clid !== "string" || !/^[!-~]{12,1000}$/.test(body.ctwa_clid))) throw new Error("ctwa_clid inválido ou enviado fora da primeira conversa.");
  const phone = body.phone === undefined ? null : normalizeMetaPhone(body.phone);
  if (body.source_id !== undefined && (typeof body.source_id !== "string" || !/^\d{5,30}$/.test(body.source_id) || body.event_type !== "conversation_started")) throw new Error("source_id deve ser o ID do anúncio na primeira mensagem.");
  const attribution = validateMetaAttribution(body.attribution);
  if (Object.keys(attribution).length && body.event_type !== "conversation_started") throw new Error("attribution só pode ser enviado no primeiro contato (conversation_started).");
  return {
    unit: body.unit, eventType: body.event_type, chatId: (body.chat_id as string).trim(),
    occurredAt: new Date(timestamp), sourceEventId: (body.source_event_id as string).trim(),
    ctwaClid: (body.ctwa_clid as string | undefined) || null,
    phone, sourceId: (body.source_id as string | undefined) || null, attribution,
  };
}

const attributionFields = {
  utm_source: 256, utm_medium: 256, utm_campaign: 256, utm_content: 256, utm_term: 256,
  ad_title: 512, source_url: 2048, thumbnail_url: 2048,
} as const;
export type MetaAttribution = Partial<Record<keyof typeof attributionFields, string>>;

/** Canonical order makes idempotency independent of JSON property order. No URL is fetched. */
export function validateMetaAttribution(value: unknown): MetaAttribution {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("attribution deve ser um objeto.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !Object.hasOwn(attributionFields, key))) throw new Error("attribution contém campos não permitidos.");
  const result: MetaAttribution = {};
  for (const field of Object.keys(attributionFields) as Array<keyof typeof attributionFields>) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string") throw new Error(`attribution.${field} deve ser texto.`);
    const text = raw.trim();
    if (!text) continue;
    if (text.length > attributionFields[field] || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`attribution.${field} excede o limite ou contém caracteres inválidos.`);
    if (field.endsWith("_url")) {
      let url: URL;
      try { url = new URL(text); } catch { throw new Error(`attribution.${field} deve ser uma URL HTTPS válida.`); }
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error(`attribution.${field} deve ser HTTPS e não pode conter credenciais.`);
    }
    result[field] = text;
  }
  return result;
}

export function normalizeMetaPhone(value: unknown) {
  if (typeof value !== "string" || !/^\+?[\d ()-]+$/.test(value)) throw new Error("phone inválido; envie telefone internacional com DDI.");
  const phone = value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error("phone inválido; envie telefone internacional com DDI.");
  return phone;
}

export function protectedPhoneHash(unit: MetaUnit, phone: string, key: Buffer) {
  return createHmac("sha256", key).update(`meta-phone-v1:${unit}:${phone}`).digest("hex");
}

/** Summarize explicit tracking_specs IDs; retain counts so duplicate IDs are observable. */
export function inspectAdDestinations(value: unknown) {
  const specs = (value as { tracking_specs?: unknown } | null)?.tracking_specs;
  if (!Array.isArray(specs)) throw new Error("tracking_specs ausente");
  const datasets: string[] = []; const pages: string[] = [];
  for (const spec of specs) {
    if (!spec || typeof spec !== "object") continue;
    for (const [field, target] of [["dataset", datasets], ["page", pages]] as const) {
      const ids = (spec as Record<string, unknown>)[field];
      if (ids === undefined) continue;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !/^\d{5,30}$/.test(id))) throw new Error("IDs inválidos em tracking_specs");
      ids.forEach((id) => target.push(id));
    }
  }
  const summarize = (ids: string[]) => ({ itemCount: ids.length, ids: [...new Set(ids)], duplicateCount: ids.length - new Set(ids).size });
  return { dataset: summarize(datasets), page: summarize(pages) };
}

/** Only documented tracking_specs entries; identical IDs are intentionally deduplicated. */
export function extractAdDestination(value: unknown) {
  const destinations = inspectAdDestinations(value);
  if (destinations.dataset.ids.length !== 1 || destinations.page.ids.length !== 1) throw new Error("Dataset/página ausente ou ambíguo");
  return { datasetId: destinations.dataset.ids[0], pageId: destinations.page.ids[0] };
}

export function metaEventName(stage: MetaStage): "LeadSubmitted" | "QualifiedLead" | null {
  if (stage === "conversation_started") return "LeadSubmitted";
  if (stage === "lead_qualified") return "QualifiedLead";
  return null;
}

export function duplicateMatches(stored: { chat_hash: string; occurred_at: Date | string; ctwa_hash: string | null }, input: { chatHash: string; occurredAt: Date; ctwaClid: string | null }) {
  return stored.chat_hash === input.chatHash && new Date(stored.occurred_at).getTime() === input.occurredAt.getTime() &&
    (!input.ctwaClid || stored.ctwa_hash === digest(input.ctwaClid));
}

export function classifyMetaEvent(input: { hasCtwa: boolean; historical: boolean; candidate: boolean; live: boolean; unitEnabled: boolean; unitEnabledAt: Date | null; typeApproved: boolean; typeEnabled: boolean; typeEnabledAt: Date | null; occurredAt: Date; configured: boolean }) {
  if (!input.candidate) return { state: "internal_only", reason: "Etapa somente interna" } as const;
  if (!input.hasCtwa) return { state: "no_ctwa", reason: "Sem CTWA" } as const;
  if (input.historical) return { state: "internal_only", reason: "Fora da janela de exportação ou anterior à ativação" } as const;
  if (input.live && input.unitEnabled && input.unitEnabledAt && input.occurredAt >= input.unitEnabledAt && input.typeApproved && input.typeEnabled && input.typeEnabledAt && input.occurredAt >= input.typeEnabledAt && input.configured) return { state: "queued", reason: null } as const;
  return { state: "awaiting_approval", reason: input.live ? "Exportação não aprovada ou unidade desativada" : "Modo somente registro" } as const;
}

export function classifyMetaDelivery(input: { httpStatus: number | null; eventsReceived: number; errorCode: string | null; autoRetryCount: number }) {
  if (input.httpStatus !== null && input.httpStatus >= 200 && input.httpStatus < 300 && input.eventsReceived > 0) return "accepted" as const;
  const transient = input.httpStatus === 429 || (input.httpStatus !== null && input.httpStatus >= 500) ||
    (input.httpStatus === null && input.errorCode !== "outside_meta_window" && !input.errorCode?.startsWith("Configure META_GRAPH"));
  return transient && input.autoRetryCount < 4 ? "queued" as const : "failed" as const;
}

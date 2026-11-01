import { createHash, timingSafeEqual } from "node:crypto";

export const META_UNITS = ["sender_1", "sender_2"] as const;
export const META_STAGES = ["conversation_started", "lead_qualified", "appointment_confirmed", "payment_confirmed"] as const;
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
  const allowed = new Set(["unit", "chat_id", "event_type", "occurred_at", "source_event_id", "ctwa_clid"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("O corpo contém campos não permitidos.");
  if (!isMetaUnit(body.unit) || !isMetaStage(body.event_type)) throw new Error("Unidade ou etapa inválida.");
  for (const field of ["chat_id", "source_event_id"] as const) {
    if (typeof body[field] !== "string" || !body[field].trim() || body[field].length > 180) throw new Error(`${field} inválido.`);
  }
  if (typeof body.occurred_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(body.occurred_at)) throw new Error("occurred_at deve ser ISO 8601 com fuso horário.");
  const timestamp = Date.parse(body.occurred_at);
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - 30 * 86_400_000) throw new Error("occurred_at fora do intervalo permitido de 30 dias.");
  if (body.ctwa_clid !== undefined && (body.event_type !== "conversation_started" || typeof body.ctwa_clid !== "string" || !/^[!-~]{12,1000}$/.test(body.ctwa_clid))) throw new Error("ctwa_clid inválido ou enviado fora da primeira conversa.");
  return {
    unit: body.unit, eventType: body.event_type, chatId: (body.chat_id as string).trim(),
    occurredAt: new Date(timestamp), sourceEventId: (body.source_event_id as string).trim(),
    ctwaClid: (body.ctwa_clid as string | undefined) || null,
  };
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
  if (!input.hasCtwa) return { state: "no_ctwa", reason: "Sem CTWA" } as const;
  if (input.historical) return { state: "internal_only", reason: "Fora da janela de exportação ou anterior à ativação" } as const;
  if (!input.candidate) return { state: "internal_only", reason: "Etapa somente interna" } as const;
  if (input.live && input.unitEnabled && input.unitEnabledAt && input.occurredAt >= input.unitEnabledAt && input.typeApproved && input.typeEnabled && input.typeEnabledAt && input.occurredAt >= input.typeEnabledAt && input.configured) return { state: "queued", reason: null } as const;
  return { state: "awaiting_approval", reason: input.live ? "Exportação não aprovada ou unidade desativada" : "Modo somente registro" } as const;
}

export function classifyMetaDelivery(input: { httpStatus: number | null; eventsReceived: number; errorCode: string | null; autoRetryCount: number }) {
  if (input.httpStatus !== null && input.httpStatus >= 200 && input.httpStatus < 300 && input.eventsReceived > 0) return "accepted" as const;
  const transient = input.httpStatus === 429 || (input.httpStatus !== null && input.httpStatus >= 500) ||
    (input.httpStatus === null && input.errorCode !== "outside_meta_window" && !input.errorCode?.startsWith("Configure META_GRAPH"));
  return transient && input.autoRetryCount < 4 ? "queued" as const : "failed" as const;
}

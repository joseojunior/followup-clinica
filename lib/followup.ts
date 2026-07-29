export type LeadSnapshot = {
  chatId: string;
  leadId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  transferred: boolean | null;
  booked: boolean | null;
  followupAllowed: boolean | null;
  conversationStatus: string | null;
  treatment: string | null;
  qualificationStatus: string | null;
  location: string | null;
  appointmentType: string | null;
  lastAiMessageAt: string | null;
  createdAt: string | null;
  sourceFollowupStage?: number | null;
  sourceLegacyFollowupStage?: string | null;
  sourceFollowupDate?: string | null;
};

export type Eligibility = {
  eligible: boolean;
  reason: string | null;
};

export function normalizeBrazilPhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 12 && digits.length <= 13 && digits.startsWith("55") ? digits : null;
}

/**
 * A regra é conservadora: qualquer situação que indique atendimento humano ou
 * ausência de telefone bloqueia o envio. A campanha decide se followup=null
 * pode participar; o padrão do motor é exigir followup=true.
 */
export function getLeadEligibility(
  lead: LeadSnapshot,
  options: { requireFollowupFlag?: boolean } = {},
): Eligibility {
  if (!lead.chatId) return { eligible: false, reason: "Lead sem chat_id" };
  if (!normalizeBrazilPhone(lead.phone)) return { eligible: false, reason: "Telefone inválido ou ausente" };
  if (lead.booked === true) return { eligible: false, reason: "Lead já agendado" };
  if (lead.transferred === true) return { eligible: false, reason: "Lead transferido para atendimento" };
  if (options.requireFollowupFlag !== false && lead.followupAllowed !== true) {
    return { eligible: false, reason: "Follow-up não autorizado na fonte" };
  }
  return { eligible: true, reason: null };
}

export function renderTemplate(
  template: string,
  lead: LeadSnapshot,
  overrides: Record<string, string | null | undefined> = {},
) {
  const values: Record<string, string | null | undefined> = {
    nome: lead.name,
    tratamento_principal: lead.treatment,
    localizacao: lead.location,
    tipo_atendimento: lead.appointmentType,
    ...overrides,
  };

  return template.replace(/{{\s*([a-z_]+)(?:\s*\|\s*["']([^"']*)["'])?\s*}}/gi, (_, key, fallback) => {
    const value = values[key];
    return value?.trim() || fallback || "";
  }).replace(/\s{2,}/g, " ").trim();
}

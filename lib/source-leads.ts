import { Pool } from "pg";
import type { LeadSnapshot } from "@/lib/followup";

export const sourceDefinitions = {
  usuarios_sdr: {
    table: "public.usuarios_sdr",
    environmentVariable: "SOURCE_USUARIOS_SDR_DATABASE_URL",
    label: "Usuários SDR",
  },
  clinica_nova: {
    table: "public.usuarios_sdr_clinica_nova",
    environmentVariable: "SOURCE_CLINICA_NOVA_DATABASE_URL",
    label: "Clínica nova",
  },
} as const;

export type SourceKey = keyof typeof sourceDefinitions;

const sourcePools = new Map<SourceKey, Pool>();

function getSourcePool(sourceKey: SourceKey) {
  const source = sourceDefinitions[sourceKey];
  const connectionString = process.env[source.environmentVariable];
  if (!connectionString) throw new Error(`${source.environmentVariable} não configurada.`);

  let pool = sourcePools.get(sourceKey);
  if (!pool) {
    pool = new Pool({ connectionString, max: 3, application_name: `followup-reader-${sourceKey}` });
    sourcePools.set(sourceKey, pool);
  }
  return pool;
}

function sourceControlColumns(sourceKey: SourceKey) {
  return sourceKey === "usuarios_sdr"
    ? `followup_stage, "followUp_stag"::text AS legacy_followup_stage, followup_date`
    : "followup_stage, NULL::text AS legacy_followup_stage, NULL::timestamptz AS followup_date";
}

function toSnapshot(row: Record<string, unknown>): LeadSnapshot {
  const asIso = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
  return {
    chatId: String(row.chat_id ?? ""),
    leadId: typeof row.lead_id === "string" ? row.lead_id : null,
    name: typeof row.nome === "string" ? row.nome : null,
    phone: typeof row.telefone === "string" ? row.telefone : null,
    email: typeof row.email === "string" ? row.email : null,
    transferred: typeof row.transferido === "boolean" ? row.transferido : null,
    booked: typeof row.agendado === "boolean" ? row.agendado : null,
    followupAllowed: typeof row.followup === "boolean" ? row.followup : null,
    conversationStatus: typeof row.status_conversa === "string" ? row.status_conversa : null,
    treatment: typeof row.tratamento_principal === "string" ? row.tratamento_principal : null,
    qualificationStatus: typeof row.status_qualificacao === "string" ? row.status_qualificacao : null,
    location: typeof row.localizacao === "string" ? row.localizacao : null,
    appointmentType: typeof row.tipo_atendimento === "string" ? row.tipo_atendimento : null,
    lastAiMessageAt: asIso(row.last_ai_message_data),
    createdAt: asIso(row.created_at),
    sourceFollowupStage: typeof row.followup_stage === "number" ? row.followup_stage : null,
    sourceLegacyFollowupStage: typeof row.legacy_followup_stage === "string" ? row.legacy_followup_stage : null,
    sourceFollowupDate: asIso(row.followup_date),
    sourceEventAt: typeof row.source_event_at === "string" ? row.source_event_at : null,
  };
}

/** Lê a fonte sem modificá-la. Nunca use este pool para INSERT/UPDATE/DELETE. */
export async function findSourceLead(sourceKey: SourceKey, chatId: string): Promise<LeadSnapshot | null> {
  const source = sourceDefinitions[sourceKey];
  const result = await getSourcePool(sourceKey).query(
    `SELECT
      chat_id, lead_id, nome, telefone, email, transferido, agendado, followup,
      status_conversa, tratamento_principal, status_qualificacao, localizacao,
      tipo_atendimento, last_ai_message_data, created_at, ${sourceControlColumns(sourceKey)}
    FROM ${source.table}
    WHERE chat_id = $1
    LIMIT 1`,
    [chatId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return toSnapshot(row);
}

export async function listEligibleSourceLeads(
  sourceKey: SourceKey,
  options: { limit?: number; requireFollowupFlag?: boolean } = {},
): Promise<LeadSnapshot[]> {
  const source = sourceDefinitions[sourceKey];
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const requireFollowupFlag = options.requireFollowupFlag !== false;
  const result = await getSourcePool(sourceKey).query(
    `SELECT
      chat_id, lead_id, nome, telefone, email, transferido, agendado, followup,
      status_conversa, tratamento_principal, status_qualificacao, localizacao,
      tipo_atendimento, last_ai_message_data, created_at, ${sourceControlColumns(sourceKey)}
    FROM ${source.table}
    WHERE COALESCE(agendado, false) = false
      AND COALESCE(transferido, false) = false
      AND ($1::boolean = false OR followup = true)
    ORDER BY created_at ASC
    LIMIT $2`,
    [requireFollowupFlag, limit],
  );

  return result.rows.map(toSnapshot);
}

export async function listEligibleSourceLeadsAfter(
  sourceKey: SourceKey,
  options: {
    limit?: number;
    requireFollowupFlag?: boolean;
    after: string;
    afterChatId?: string | null;
  },
): Promise<LeadSnapshot[]> {
  const source = sourceDefinitions[sourceKey];
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const requireFollowupFlag = options.requireFollowupFlag !== false;
  const anchor = "COALESCE(NULLIF(last_ai_message_data::text, '')::timestamptz, created_at)";
  const result = await getSourcePool(sourceKey).query(
    `SELECT
      chat_id, lead_id, nome, telefone, email, transferido, agendado, followup,
      status_conversa, tratamento_principal, status_qualificacao, localizacao,
      tipo_atendimento, last_ai_message_data, created_at, ${anchor}::text AS source_event_at,
      ${sourceControlColumns(sourceKey)}
    FROM ${source.table}
    WHERE COALESCE(agendado, false) = false
      AND COALESCE(transferido, false) = false
      AND ($1::boolean = false OR followup = true)
      AND (${anchor} > $2::timestamptz
        OR (${anchor} = $2::timestamptz AND chat_id > $3::text))
    ORDER BY ${anchor} ASC, chat_id ASC
    LIMIT $4`,
    [requireFollowupFlag, options.after, options.afterChatId ?? "", limit],
  );

  return result.rows.map(toSnapshot);
}

export async function listSourceLeadsPage(
  sourceKey: SourceKey,
  options: { limit?: number; afterChatId?: string } = {},
): Promise<LeadSnapshot[]> {
  const source = sourceDefinitions[sourceKey];
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1_000);
  const result = await getSourcePool(sourceKey).query(
    `SELECT
      chat_id, lead_id, nome, telefone, email, transferido, agendado, followup,
      status_conversa, tratamento_principal, status_qualificacao, localizacao,
      tipo_atendimento, last_ai_message_data, created_at, ${sourceControlColumns(sourceKey)}
    FROM ${source.table}
    WHERE ($1::text IS NULL OR chat_id > $1)
      AND (NULLIF(last_ai_message_data, '') IS NOT NULL OR created_at IS NOT NULL)
    ORDER BY chat_id ASC
    LIMIT $2`,
    [options.afterChatId ?? null, limit],
  );
  return result.rows.map(toSnapshot);
}

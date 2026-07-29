import { createHash, randomUUID } from "node:crypto";
import { getLeadEligibility, normalizeBrazilPhone, type LeadSnapshot } from "@/lib/followup";
import { getFollowupPool, withTransaction } from "@/lib/followup-db";
import { listSourceLeadsPage, sourceDefinitions, type SourceKey } from "@/lib/source-leads";

export type LeadOrigin = "database" | "csv";

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function referenceAt(lead: LeadSnapshot) {
  for (const value of [lead.lastAiMessageAt, lead.createdAt]) {
    const valid = validDate(value);
    if (valid) return new Date(valid);
  }
  return new Date();
}

export async function syncDatabaseLeads(sourceKey?: SourceKey) {
  const sourceKeys = sourceKey ? [sourceKey] : Object.keys(sourceDefinitions) as SourceKey[];
  let synchronized = 0;

  for (const key of sourceKeys) {
    const sourceResult = await getFollowupPool().query("SELECT id FROM followup.sources WHERE code = $1", [key]);
    if (!sourceResult.rowCount) throw new Error(`Fonte ${key} não cadastrada.`);
    let afterChatId: string | undefined;

    while (true) {
      const leads = await listSourceLeadsPage(key, { limit: 500, afterChatId });
      if (!leads.length) break;
      const rows = leads.flatMap((lead) => {
        const externalId = lead.chatId || lead.leadId;
        if (!externalId) return [];
        const eligibility = getLeadEligibility(lead, { requireFollowupFlag: false });
        return [{
          external_id: externalId,
          source_chat_id: lead.chatId,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          reference_at: referenceAt(lead).toISOString(),
          is_eligible: eligibility.eligible,
          eligibility_reason: eligibility.reason,
          source_payload: lead,
          source_followup_enabled: lead.followupAllowed,
          source_stage: lead.sourceFollowupStage ?? null,
          source_legacy_stage: lead.sourceLegacyFollowupStage ?? null,
          source_followup_date: validDate(lead.sourceFollowupDate),
          source_last_message_at: validDate(lead.lastAiMessageAt),
          source_created_at: validDate(lead.createdAt),
        }];
      });

      if (rows.length) {
        await getFollowupPool().query(
          `WITH input AS (
             SELECT * FROM jsonb_to_recordset($2::jsonb) AS data(
               external_id text, source_chat_id text, name text, phone text, email text,
               reference_at timestamptz, is_eligible boolean, eligibility_reason text,
               source_payload jsonb, source_followup_enabled boolean, source_stage integer,
               source_legacy_stage text, source_followup_date timestamptz,
               source_last_message_at timestamptz, source_created_at timestamptz
             )
           ), upserted AS (
             INSERT INTO followup.leads
               (source_id, origin_kind, external_id, source_chat_id, name, phone, email, reference_at,
                is_eligible, eligibility_reason, source_payload)
             SELECT $1, 'database', external_id, source_chat_id, name, phone, email, reference_at,
               is_eligible, eligibility_reason, source_payload
             FROM input
             ON CONFLICT (source_id, origin_kind, external_id) DO UPDATE SET
               source_chat_id = EXCLUDED.source_chat_id, name = EXCLUDED.name, phone = EXCLUDED.phone,
               email = EXCLUDED.email, reference_at = EXCLUDED.reference_at,
               is_eligible = EXCLUDED.is_eligible, eligibility_reason = EXCLUDED.eligibility_reason,
               source_payload = EXCLUDED.source_payload
             RETURNING id, external_id
           )
           INSERT INTO followup.lead_followup_control
             (lead_id, source_id, source_chat_id, source_followup_enabled, source_stage,
              source_legacy_stage, source_followup_date, source_last_message_at,
              source_created_at, anchor_at, control_stage)
           SELECT u.id, $1, i.source_chat_id, i.source_followup_enabled, i.source_stage,
             i.source_legacy_stage, i.source_followup_date, i.source_last_message_at,
             i.source_created_at, i.reference_at, GREATEST(COALESCE(i.source_stage, 0), 0)
           FROM upserted u JOIN input i USING (external_id)
           ON CONFLICT (lead_id) DO UPDATE SET
             source_chat_id = EXCLUDED.source_chat_id,
             source_followup_enabled = EXCLUDED.source_followup_enabled,
             source_stage = EXCLUDED.source_stage,
             source_legacy_stage = EXCLUDED.source_legacy_stage,
             source_followup_date = EXCLUDED.source_followup_date,
             source_last_message_at = EXCLUDED.source_last_message_at,
             source_created_at = EXCLUDED.source_created_at,
             anchor_at = EXCLUDED.anchor_at,
             last_source_sync_at = NOW()`,
          [sourceResult.rows[0].id, JSON.stringify(rows)],
        );
        synchronized += rows.length;
      }
      afterChatId = leads[leads.length - 1].chatId;
      if (leads.length < 500) break;
    }
  }
  return { synchronized, sources: sourceKeys.length };
}

export async function listCatalogLeads(origin?: LeadOrigin) {
  const result = await getFollowupPool().query(
    `SELECT l.id, l.origin_kind, l.external_id, l.source_chat_id, l.name, l.phone, l.email,
      l.reference_at, l.is_eligible, l.eligibility_reason, l.updated_at, s.code AS source_code,
      s.name AS source_name, ci.filename AS import_filename,
      e.state, e.current_step_order, e.next_send_at, c.name AS campaign_name,
      fc.source_stage, fc.source_legacy_stage, fc.source_followup_enabled,
      fc.source_last_message_at, fc.source_created_at, fc.anchor_at,
      fc.control_status, fc.control_stage, fc.followup_count,
      fc.last_followup_at, fc.next_followup_at
     FROM followup.leads l
     JOIN followup.sources s ON s.id = l.source_id
     LEFT JOIN followup.csv_imports ci ON ci.id = l.csv_import_id
     LEFT JOIN LATERAL (
       SELECT enrollment.* FROM followup.enrollments enrollment
       WHERE enrollment.lead_id = l.id
       ORDER BY enrollment.created_at DESC LIMIT 1
     ) e ON true
     LEFT JOIN followup.campaigns c ON c.id = e.campaign_id
     LEFT JOIN followup.lead_followup_control fc ON fc.lead_id = l.id
     WHERE ($1::text IS NULL OR l.origin_kind = $1)
     ORDER BY l.updated_at DESC LIMIT 500`,
    [origin ?? null],
  );
  return result.rows;
}

export async function findOperationalLead(
  origin: LeadOrigin,
  sourceKey: SourceKey,
  sourceChatId: string,
  leadId: string | null,
): Promise<LeadSnapshot | null> {
  if (origin === "database") {
    const { findSourceLead } = await import("@/lib/source-leads");
    return findSourceLead(sourceKey, sourceChatId);
  }
  if (!leadId) return null;
  const result = await getFollowupPool().query(
    `SELECT id, name, phone, email, reference_at
     FROM followup.leads
     WHERE id = $1 AND origin_kind = 'csv' AND is_eligible = true`,
    [leadId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    chatId: sourceChatId,
    leadId: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    transferred: false,
    booked: false,
    followupAllowed: true,
    conversationStatus: null,
    treatment: null,
    qualificationStatus: null,
    location: null,
    appointmentType: null,
    lastAiMessageAt: row.reference_at?.toISOString?.() ?? row.reference_at,
    createdAt: row.reference_at?.toISOString?.() ?? row.reference_at,
  };
}

export type CsvLead = { name?: string; phone: string; email?: string; referenceAt?: string };

export async function importCsvLeads(
  sourceKey: SourceKey,
  filename: string,
  rows: CsvLead[],
  rejected: Array<{ row: number; error: string }>,
) {
  return withTransaction(async (client) => {
    const source = await client.query("SELECT id FROM followup.sources WHERE code = $1", [sourceKey]);
    if (!source.rowCount) throw new Error("Unidade inválida.");
    const importResult = await client.query(
      `INSERT INTO followup.csv_imports
        (source_id, filename, status, total_rows, imported_rows, rejected_rows, errors, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW()) RETURNING id`,
      [source.rows[0].id, filename, rejected.length ? "completed_with_errors" : "completed",
        rows.length + rejected.length, rows.length, rejected.length, JSON.stringify(rejected.slice(0, 100))],
    );
    const importId = importResult.rows[0].id;

    for (const row of rows) {
      const phone = normalizeBrazilPhone(row.phone);
      if (!phone) throw new Error("A importação contém telefone inválido.");
      const reference = row.referenceAt ? new Date(row.referenceAt) : new Date();
      const referenceIso = Number.isNaN(reference.valueOf()) ? new Date().toISOString() : reference.toISOString();
      const externalId = createHash("sha256").update(`${importId}:${phone}:${randomUUID()}`).digest("hex");
      const leadResult = await client.query(
        `INSERT INTO followup.leads
          (source_id, origin_kind, external_id, name, phone, email, reference_at, csv_import_id, source_payload)
         VALUES ($1, 'csv', $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id`,
        [source.rows[0].id, externalId, row.name ?? null, phone, row.email ?? null,
          referenceIso, importId, JSON.stringify(row)],
      );
      await client.query(
        `INSERT INTO followup.lead_followup_control
          (lead_id, source_id, source_chat_id, anchor_at)
         VALUES ($1, $2, $3, $4)`,
        [leadResult.rows[0].id, source.rows[0].id, `csv:${leadResult.rows[0].id}`, referenceIso],
      );
    }
    return { importId, imported: rows.length, rejected: rejected.length };
  });
}

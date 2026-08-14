import { getLeadEligibility, renderTemplate, type LeadSnapshot } from "@/lib/followup";
import { getFollowupPool, withTransaction } from "@/lib/followup-db";
import { listEligibleSourceLeadsAfter, type SourceKey } from "@/lib/source-leads";
import { nextAllowedSendAt } from "@/lib/scheduling";
import { findOperationalLead, type LeadOrigin } from "@/lib/lead-catalog";

type ActiveCampaignRow = {
  id: string;
  source_id: string;
  source_code: SourceKey;
  source_followup_required: boolean;
  max_send_attempts: number;
  first_delay_minutes: number;
  timezone: string;
  allowed_start_time: string;
  allowed_end_time: string;
  weekdays: number[];
  auto_enroll_cursor_at: string;
  auto_enroll_cursor_chat_id: string | null;
};

function eventAnchor(lead: LeadSnapshot) {
  const candidates = [lead.lastAiMessageAt, lead.createdAt];
  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date;
  }
  return new Date();
}

export async function enrollActiveCampaigns(limitPerCampaign = 100) {
  const campaigns = await getFollowupPool().query<ActiveCampaignRow>(
    `SELECT c.id, c.source_id, s.code AS source_code, c.source_followup_required,
      c.max_send_attempts, first_step.delay_minutes AS first_delay_minutes,
      c.timezone, c.allowed_start_time::text, c.allowed_end_time::text, c.weekdays,
      COALESCE(c.auto_enroll_cursor_at, c.auto_enroll_from, c.updated_at)::text AS auto_enroll_cursor_at,
      c.auto_enroll_cursor_chat_id
     FROM followup.campaigns c
     JOIN followup.sources s ON s.id = c.source_id
     JOIN followup.campaign_steps first_step ON first_step.campaign_id = c.id AND first_step.step_order = 1
     WHERE c.status = 'active' AND c.auto_enroll = true AND c.trigger_mode = 'eligible_source_lead'`,
  );

  let enrolled = 0;
  let pendingData = 0;
  for (const campaign of campaigns.rows) {
    const candidates = await listEligibleSourceLeadsAfter(campaign.source_code, {
      limit: limitPerCampaign,
      requireFollowupFlag: campaign.source_followup_required,
      after: campaign.auto_enroll_cursor_at,
      afterChatId: campaign.auto_enroll_cursor_chat_id,
    });

    for (const lead of candidates) {
      const eligibility = getLeadEligibility(lead, { requireFollowupFlag: campaign.source_followup_required });
      const state = eligibility.eligible ? "active" : "pending_data";
      const anchorAt = eventAnchor(lead);
      const nextSendAt = eligibility.eligible
        ? nextAllowedSendAt(
            new Date(anchorAt.valueOf() + campaign.first_delay_minutes * 60_000),
            {
              timezone: campaign.timezone,
              allowedStartTime: campaign.allowed_start_time,
              allowedEndTime: campaign.allowed_end_time,
              weekdays: campaign.weekdays,
            },
          ).toISOString()
        : null;
      const leadResult = await getFollowupPool().query(
        `INSERT INTO followup.leads
          (source_id, origin_kind, external_id, source_chat_id, name, phone, email, reference_at,
           is_eligible, eligibility_reason, source_payload)
         VALUES ($1, 'database', $2, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (source_id, origin_kind, external_id) DO UPDATE SET
           name = EXCLUDED.name, phone = EXCLUDED.phone, email = EXCLUDED.email,
           reference_at = EXCLUDED.reference_at, is_eligible = EXCLUDED.is_eligible,
           eligibility_reason = EXCLUDED.eligibility_reason, source_payload = EXCLUDED.source_payload
         RETURNING id`,
        [campaign.source_id, lead.chatId, lead.name, lead.phone, lead.email, anchorAt.toISOString(),
          eligibility.eligible, eligibility.reason, JSON.stringify(lead)],
      );
      await getFollowupPool().query(
        `INSERT INTO followup.lead_followup_control
          (lead_id, source_id, source_chat_id, source_followup_enabled, source_stage,
           source_legacy_stage, source_followup_date, source_last_message_at,
           source_created_at, anchor_at, control_stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, GREATEST(COALESCE($5, 0), 0))
         ON CONFLICT (lead_id) DO UPDATE SET
           source_followup_enabled = EXCLUDED.source_followup_enabled,
           source_stage = EXCLUDED.source_stage,
           source_legacy_stage = EXCLUDED.source_legacy_stage,
           source_followup_date = EXCLUDED.source_followup_date,
           source_last_message_at = EXCLUDED.source_last_message_at,
           source_created_at = EXCLUDED.source_created_at,
           anchor_at = EXCLUDED.anchor_at,
           last_source_sync_at = NOW()`,
        [leadResult.rows[0].id, campaign.source_id, lead.chatId, lead.followupAllowed,
          lead.sourceFollowupStage ?? null, lead.sourceLegacyFollowupStage ?? null,
          lead.sourceFollowupDate ?? null, lead.lastAiMessageAt ?? null, lead.createdAt ?? null,
          anchorAt.toISOString()],
      );
      const result = await getFollowupPool().query(
        `INSERT INTO followup.enrollments
          (source_id, source_chat_id, source_lead_id, campaign_id, state, next_send_at,
           last_error, source_snapshot, lead_id, origin_kind, anchor_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'database', $10
         WHERE NOT EXISTS (
           SELECT 1 FROM followup.enrollments existing
           WHERE existing.source_id = $1 AND existing.source_chat_id = $2 AND existing.campaign_id = $4
         )
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [campaign.source_id, lead.chatId, lead.leadId, campaign.id, state, nextSendAt,
          eligibility.reason, JSON.stringify(lead), leadResult.rows[0].id, anchorAt.toISOString()],
      );
      if (result.rowCount) {
        await getFollowupPool().query(
          `UPDATE followup.lead_followup_control
           SET control_status = $2, next_followup_at = $3
           WHERE lead_id = $1`,
          [leadResult.rows[0].id, state === "active" ? "in_progress" : "blocked", nextSendAt],
        );
        if (state === "active") enrolled += 1;
        else pendingData += 1;
      }
    }
    const lastCandidate = candidates.at(-1);
    if (lastCandidate) {
      await getFollowupPool().query(
        `UPDATE followup.campaigns
         SET auto_enroll_cursor_at = $2, auto_enroll_cursor_chat_id = $3
         WHERE id = $1`,
        [campaign.id, lastCandidate.sourceEventAt ?? eventAnchor(lastCandidate).toISOString(), lastCandidate.chatId],
      );
    }
  }
  return { campaigns: campaigns.rowCount ?? 0, enrolled, pendingData };
}

type DueEnrollment = {
  id: string;
  source_id: string;
  source_code: SourceKey;
  source_chat_id: string;
  lead_id: string | null;
  origin_kind: LeadOrigin;
  source_followup_required: boolean;
  current_step_order: number;
  campaign_id: string;
  campaign_max_attempts: number;
  step_id: string;
  step_order: number;
  content_mode: string;
  sender_rule: string;
  rotation_rule: string;
  default_sender_id: string | null;
};

async function findVariant(enrollmentId: string, stepId: string, rotationRule: string) {
  const order = rotationRule === "random" ? "RANDOM()" : "variant_order ASC";
  let result = await getFollowupPool().query(
    `SELECT v.id, v.content_type, v.text_template, v.media_url, 1 AS rotation_cycle
     FROM followup.content_variants v
     WHERE v.step_id = $1 AND v.is_active = true
       AND ($2 <> 'no_repeat' OR NOT EXISTS (
         SELECT 1 FROM followup.variant_usage u
         WHERE u.enrollment_id = $3 AND u.step_id = $1 AND u.variant_id = v.id
       ))
     ORDER BY ${order}
     LIMIT 1`,
    [stepId, rotationRule, enrollmentId],
  );
  if (result.rowCount || rotationRule !== "no_repeat") return result.rows[0] ?? null;

  result = await getFollowupPool().query(
    `SELECT v.id, v.content_type, v.text_template, v.media_url,
      COALESCE((SELECT MAX(rotation_cycle) + 1 FROM followup.variant_usage WHERE enrollment_id = $2 AND step_id = $1), 1) AS rotation_cycle
     FROM followup.content_variants v
     WHERE v.step_id = $1 AND v.is_active = true
     ORDER BY variant_order ASC
     LIMIT 1`,
    [stepId, enrollmentId],
  );
  return result.rows[0] ?? null;
}

async function resolveSenderId(senderRule: string, defaultSenderId: string | null) {
  if (senderRule === "balanced") return defaultSenderId;
  const code = senderRule === "sender_1" ? "sender_1" : "sender_2";
  const result = await getFollowupPool().query("SELECT id FROM followup.senders WHERE code = $1 AND is_active = true", [code]);
  return result.rows[0]?.id ?? null;
}

export async function queueDueMessages(limit = 50) {
  const due = await getFollowupPool().query<DueEnrollment>(
    `SELECT e.id, e.source_id, s.code AS source_code, e.source_chat_id, e.lead_id, e.origin_kind,
      c.source_followup_required, e.current_step_order, e.campaign_id,
      c.max_send_attempts AS campaign_max_attempts, cs.id AS step_id, cs.step_order, cs.content_mode,
      cs.sender_rule, cs.rotation_rule, s.default_sender_id
     FROM followup.enrollments e
     JOIN followup.campaigns c ON c.id = e.campaign_id AND c.status = 'active'
     JOIN followup.sources s ON s.id = e.source_id
     JOIN followup.campaign_steps cs ON cs.campaign_id = e.campaign_id AND cs.step_order = e.current_step_order AND cs.is_active = true
     WHERE e.state = 'active' AND e.next_send_at <= NOW()
       AND (e.dispatch_lock_at IS NULL OR e.dispatch_lock_at < NOW() - INTERVAL '10 minutes')
     ORDER BY e.next_send_at ASC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );

  let queued = 0;
  let blocked = 0;
  let waitingContent = 0;
  for (const row of due.rows) {
    const lead = await findOperationalLead(row.origin_kind, row.source_code, row.source_chat_id, row.lead_id);
    if (!lead) {
      await getFollowupPool().query(
        "UPDATE followup.enrollments SET state = 'blocked', last_error = 'Lead não encontrado na fonte', source_checked_at = NOW(), dispatch_lock_at = NULL WHERE id = $1",
        [row.id],
      );
      await getFollowupPool().query(
        "UPDATE followup.lead_followup_control SET control_status = 'blocked', next_followup_at = NULL WHERE lead_id = $1",
        [row.lead_id],
      );
      blocked += 1;
      continue;
    }
    const eligibility = getLeadEligibility(lead, { requireFollowupFlag: row.source_followup_required });
    if (!eligibility.eligible) {
      await getFollowupPool().query(
        "UPDATE followup.enrollments SET state = 'blocked', last_error = $2, source_checked_at = NOW(), dispatch_lock_at = NULL WHERE id = $1",
        [row.id, eligibility.reason],
      );
      await getFollowupPool().query(
        "UPDATE followup.lead_followup_control SET control_status = 'blocked', next_followup_at = NULL WHERE lead_id = $1",
        [row.lead_id],
      );
      blocked += 1;
      continue;
    }

    const variant = await findVariant(row.id, row.step_id, row.rotation_rule);
    const senderId = await resolveSenderId(row.sender_rule, row.default_sender_id);
    if (!variant || !senderId) {
      await getFollowupPool().query(
        "UPDATE followup.enrollments SET last_error = $2, next_send_at = NOW() + INTERVAL '1 hour', dispatch_lock_at = NULL WHERE id = $1",
        [row.id, !variant ? "Etapa sem conteúdo ativo" : "Unidade remetente indisponível"],
      );
      await getFollowupPool().query(
        "UPDATE followup.lead_followup_control SET next_followup_at = NOW() + INTERVAL '1 hour' WHERE lead_id = $1",
        [row.lead_id],
      );
      waitingContent += 1;
      continue;
    }

    const contactResult = await getFollowupPool().query(
      "SELECT preferred_name, interest, custom_data FROM followup.contact_data WHERE source_id = $1 AND source_chat_id = $2",
      [row.source_id, row.source_chat_id],
    );
    const localData = contactResult.rows[0] ?? {};
    const text = renderTemplate(variant.text_template ?? "", lead, {
      nome: localData.preferred_name,
      interesse: localData.interest,
      ...(localData.custom_data ?? {}),
    });
    const idempotencyKey = `${row.id}:${row.step_order}`;

    const result = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO followup.messages
          (enrollment_id, step_id, variant_id, sender_id, phone, content_snapshot, scheduled_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), $7)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [row.id, row.step_id, variant.id, senderId, lead.phone, JSON.stringify({ type: variant.content_type, text, mediaUrl: variant.media_url, rotationCycle: variant.rotation_cycle, maxAttempts: row.campaign_max_attempts }), idempotencyKey],
      );
      if (inserted.rowCount) {
        await client.query("UPDATE followup.enrollments SET next_send_at = NULL, dispatch_lock_at = NOW(), source_checked_at = NOW(), last_error = NULL WHERE id = $1", [row.id]);
      }
      return Boolean(inserted.rowCount);
    });
    if (result) queued += 1;
  }
  return { due: due.rowCount ?? 0, queued, blocked, waitingContent };
}

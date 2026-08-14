import { getLeadEligibility } from "@/lib/followup";
import { getFollowupPool, withTransaction } from "@/lib/followup-db";
import { type SourceKey } from "@/lib/source-leads";
import { sendWithUazapi } from "@/lib/uazapi";
import { reserveSenderSlot } from "@/lib/sender-throttle";
import { nextAllowedSendAt, nextCadenceStepCandidate } from "@/lib/scheduling";
import { findOperationalLead, type LeadOrigin } from "@/lib/lead-catalog";

type ClaimedMessage = {
  id: string;
  enrollment_id: string;
  step_id: string;
  variant_id: string | null;
  sender_id: string;
  phone: string;
  content_snapshot: { type: string; text?: string; mediaUrl?: string; rotationCycle?: number };
  attempt_count: number;
  max_send_attempts: number;
  source_id: string;
  source_code: SourceKey;
  source_chat_id: string;
  lead_id: string | null;
  origin_kind: LeadOrigin;
  current_step_order: number;
  credential_key: string;
  source_followup_required: boolean;
};

async function claimMessages(limit: number) {
  return withTransaction(async (client) => {
    const result = await client.query<ClaimedMessage>(
      `WITH selected AS (
        SELECT m.id
        FROM followup.messages m
        JOIN followup.enrollments selected_enrollment ON selected_enrollment.id = m.enrollment_id
        JOIN followup.campaigns selected_campaign ON selected_campaign.id = selected_enrollment.campaign_id
        WHERE m.state = 'scheduled'
          AND m.scheduled_at <= NOW()
          AND (m.next_retry_at IS NULL OR m.next_retry_at <= NOW())
          AND selected_enrollment.state = 'active'
          AND selected_campaign.status = 'active'
        ORDER BY m.scheduled_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE followup.messages m
      SET state = 'sending', attempt_count = m.attempt_count + 1, reserved_at = NOW()
      FROM selected, followup.enrollments e, followup.campaigns c, followup.sources so, followup.senders se
      WHERE m.id = selected.id
        AND e.id = m.enrollment_id
        AND c.id = e.campaign_id
        AND so.id = e.source_id
        AND se.id = m.sender_id
      RETURNING m.id, m.enrollment_id, m.step_id, m.variant_id, m.sender_id, m.phone, m.content_snapshot,
        m.attempt_count, c.max_send_attempts, e.source_id, so.code AS source_code, e.source_chat_id,
        e.current_step_order, e.lead_id, e.origin_kind, se.credential_key, c.source_followup_required`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows;
  });
}

async function markSuccess(message: ClaimedMessage, providerMessageId: string | null, providerResponse: unknown) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE followup.messages
       SET state = 'sent', sent_at = NOW(), provider_message_id = $2,
         provider_response = $3::jsonb, error_message = NULL, next_retry_at = NULL
       WHERE id = $1`,
      [message.id, providerMessageId, JSON.stringify(providerResponse)],
    );
    if (message.variant_id) {
      await client.query(
        `INSERT INTO followup.variant_usage (enrollment_id, step_id, variant_id, rotation_cycle)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [message.enrollment_id, message.step_id, message.variant_id, message.content_snapshot.rotationCycle ?? 1],
      );
    }
    const nextStep = await client.query(
      `SELECT cs.delay_minutes, current_step.delay_minutes AS current_delay_minutes,
        c.timezone, c.allowed_start_time::text,
        c.allowed_end_time::text, c.weekdays, enrollment.anchor_at
       FROM followup.campaign_steps cs
       JOIN followup.campaigns c ON c.id = cs.campaign_id
       JOIN followup.enrollments enrollment ON enrollment.id = $1
       JOIN followup.campaign_steps current_step ON current_step.id = $3
       WHERE cs.campaign_id = (SELECT campaign_id FROM followup.enrollments WHERE id = $1)
         AND cs.step_order = $2 AND cs.is_active = true`,
      [message.enrollment_id, message.current_step_order + 1, message.step_id],
    );
    if (!nextStep.rowCount) {
      await client.query("UPDATE followup.enrollments SET state = 'completed', completed_at = NOW(), dispatch_lock_at = NULL WHERE id = $1", [message.enrollment_id]);
      await client.query(
        `UPDATE followup.lead_followup_control
         SET control_status = 'completed', control_stage = control_stage + 1,
           followup_count = followup_count + 1, last_followup_at = NOW(),
           next_followup_at = NULL, last_message_id = $2, completed_at = NOW()
         WHERE lead_id = $1`,
        [message.lead_id, message.id],
      );
    } else {
      const step = nextStep.rows[0];
      const now = new Date();
      const nextSendAt = nextAllowedSendAt(
        nextCadenceStepCandidate({
          anchor: new Date(step.anchor_at),
          now,
          currentDelayMinutes: step.current_delay_minutes,
          nextDelayMinutes: step.delay_minutes,
        }),
        {
          timezone: step.timezone,
          allowedStartTime: step.allowed_start_time,
          allowedEndTime: step.allowed_end_time,
          weekdays: step.weekdays,
        },
      );
      await client.query(
        "UPDATE followup.enrollments SET current_step_order = current_step_order + 1, next_send_at = $2, dispatch_lock_at = NULL WHERE id = $1",
        [message.enrollment_id, nextSendAt.toISOString()],
      );
      await client.query(
        `UPDATE followup.lead_followup_control
         SET control_status = 'in_progress', control_stage = control_stage + 1,
           followup_count = followup_count + 1, last_followup_at = NOW(),
           next_followup_at = $2, last_message_id = $3
         WHERE lead_id = $1`,
        [message.lead_id, nextSendAt.toISOString(), message.id],
      );
    }
  });
}

async function rescheduleForSenderLimit(message: ClaimedMessage, availableAt: Date, reason: string) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE followup.messages
       SET state = 'scheduled', reserved_at = NULL, error_message = $2, next_retry_at = $3, scheduled_at = $3
       WHERE id = $1`,
      [message.id, reason, availableAt.toISOString()],
    );
    await client.query(
      "UPDATE followup.enrollments SET dispatch_lock_at = NULL, last_error = $2 WHERE id = $1",
      [message.enrollment_id, reason],
    );
    await client.query(
      "UPDATE followup.lead_followup_control SET next_followup_at = $2 WHERE lead_id = $1",
      [message.lead_id, availableAt.toISOString()],
    );
  });
}

async function markFailure(message: ClaimedMessage, error: Error) {
  const shouldRetry = message.attempt_count < message.max_send_attempts;
  const retryMinutes = Math.min(60, 5 * 2 ** Math.max(0, message.attempt_count - 1));
  await withTransaction(async (client) => {
    if (shouldRetry) {
      await client.query(
        `UPDATE followup.messages SET state = 'scheduled', error_message = $2,
          next_retry_at = NOW() + ($3 * INTERVAL '1 minute'), scheduled_at = NOW() + ($3 * INTERVAL '1 minute')
         WHERE id = $1`,
        [message.id, error.message, retryMinutes],
      );
        await client.query("UPDATE followup.enrollments SET dispatch_lock_at = NULL, last_error = $2 WHERE id = $1", [message.enrollment_id, error.message]);
        await client.query(
          `UPDATE followup.lead_followup_control
           SET control_status = 'in_progress',
             next_followup_at = NOW() + ($2 * INTERVAL '1 minute')
           WHERE lead_id = $1`,
          [message.lead_id, retryMinutes],
        );
    } else {
      await client.query("UPDATE followup.messages SET state = 'failed', error_message = $2 WHERE id = $1", [message.id, error.message]);
      await client.query("UPDATE followup.enrollments SET state = 'paused', paused_reason = 'Falha no envio', dispatch_lock_at = NULL, last_error = $2 WHERE id = $1", [message.enrollment_id, error.message]);
      await client.query(
        "UPDATE followup.lead_followup_control SET control_status = 'paused', next_followup_at = NULL WHERE lead_id = $1",
        [message.lead_id],
      );
    }
  });
}

export async function dispatchScheduledMessages(limit = 5) {
  if (process.env.FOLLOWUP_SEND_MODE !== "live") {
    const held = await getFollowupPool().query(
      `SELECT COUNT(*)::int AS count
       FROM followup.messages message
       JOIN followup.enrollments enrollment ON enrollment.id = message.enrollment_id
       JOIN followup.campaigns campaign ON campaign.id = enrollment.campaign_id
       WHERE message.state = 'scheduled' AND message.scheduled_at <= NOW()
         AND enrollment.state = 'active' AND campaign.status = 'active'`,
    );
    return { claimed: 0, sent: 0, simulated: 0, cancelled: 0, failed: 0, held: held.rows[0].count };
  }
  const messages = await claimMessages(limit);
  let sent = 0;
  let simulated = 0;
  let cancelled = 0;
  let failed = 0;

  for (const message of messages) {
    const lead = await findOperationalLead(message.origin_kind, message.source_code, message.source_chat_id, message.lead_id);
    const eligibility = lead
      ? getLeadEligibility(lead, { requireFollowupFlag: message.source_followup_required })
      : { eligible: false, reason: "Lead não encontrado na fonte" };
    if (!eligibility.eligible) {
      await withTransaction(async (client) => {
        await client.query("UPDATE followup.messages SET state = 'cancelled', cancelled_at = NOW(), cancel_reason = $2 WHERE id = $1", [message.id, eligibility.reason]);
        await client.query("UPDATE followup.enrollments SET state = 'blocked', last_error = $2, dispatch_lock_at = NULL WHERE id = $1", [message.enrollment_id, eligibility.reason]);
        await client.query(
          "UPDATE followup.lead_followup_control SET control_status = 'blocked', next_followup_at = NULL WHERE lead_id = $1",
          [message.lead_id],
        );
      });
      cancelled += 1;
      continue;
    }

    try {
      const slot = await reserveSenderSlot(message.sender_id);
      if (!slot.allowed) {
        await rescheduleForSenderLimit(message, slot.availableAt, slot.reason ?? "Aguardando a unidade remetente");
        continue;
      }
      const token = process.env[message.credential_key];
      if (!token) throw new Error(`Credencial ${message.credential_key} ausente.`);
      const result = await sendWithUazapi(token, message.phone, message.content_snapshot);
      await markSuccess(message, result.providerMessageId, result.response);
      sent += 1;
    } catch (error) {
      await markFailure(message, error instanceof Error ? error : new Error("Falha de envio desconhecida."));
      failed += 1;
    }
  }
  return { claimed: messages.length, sent, simulated, cancelled, failed };
}

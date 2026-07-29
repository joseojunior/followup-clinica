import { NextResponse } from "next/server";
import { getFollowupPool } from "@/lib/followup-db";
import { nextAllowedSendAt } from "@/lib/scheduling";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { leadId?: string; campaignId?: string };
    if (!body.leadId || !body.campaignId) {
      return NextResponse.json({ error: "Informe o lead e a campanha." }, { status: 400 });
    }
    const result = await getFollowupPool().query(
      `SELECT l.id, l.source_id, l.origin_kind, l.external_id, l.source_chat_id, l.reference_at,
        l.name, l.phone, l.email, l.is_eligible, l.eligibility_reason,
        c.id AS campaign_id, c.timezone, c.allowed_start_time::text, c.allowed_end_time::text,
        c.weekdays, cs.delay_minutes
       FROM followup.leads l
       JOIN followup.campaigns c ON c.id = $2 AND c.source_id = l.source_id
       JOIN followup.campaign_steps cs ON cs.campaign_id = c.id AND cs.step_order = 1 AND cs.is_active = true
       WHERE l.id = $1 AND c.status = 'active'`,
      [body.leadId, body.campaignId],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Lead ou campanha ativa não encontrado para esta unidade." }, { status: 404 });
    }
    const row = result.rows[0];
    if (!row.is_eligible) {
      return NextResponse.json({ error: row.eligibility_reason ?? "Lead não elegível." }, { status: 409 });
    }
    const anchor = new Date(row.reference_at);
    const nextSendAt = nextAllowedSendAt(
      new Date(anchor.valueOf() + row.delay_minutes * 60_000),
      {
        timezone: row.timezone,
        allowedStartTime: row.allowed_start_time,
        allowedEndTime: row.allowed_end_time,
        weekdays: row.weekdays,
      },
    );
    const sourceChatId = row.source_chat_id || `csv:${row.id}`;
    const snapshot = {
      chatId: sourceChatId, leadId: row.id, name: row.name, phone: row.phone, email: row.email,
      transferred: false, booked: false, followupAllowed: true, lastAiMessageAt: row.reference_at,
    };
    const enrollment = await getFollowupPool().query(
      `INSERT INTO followup.enrollments
        (source_id, source_chat_id, source_lead_id, campaign_id, state, next_send_at,
         source_snapshot, lead_id, origin_kind, anchor_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6::jsonb, $3, $7, $8)
       ON CONFLICT DO NOTHING RETURNING id, next_send_at`,
      [row.source_id, sourceChatId, row.id, row.campaign_id, nextSendAt.toISOString(),
        JSON.stringify(snapshot), row.origin_kind, anchor.toISOString()],
    );
    if (!enrollment.rowCount) {
      return NextResponse.json({ error: "Este lead já está nesta campanha." }, { status: 409 });
    }
    await getFollowupPool().query(
      `UPDATE followup.lead_followup_control
       SET control_status = 'in_progress', next_followup_at = $2, completed_at = NULL
       WHERE lead_id = $1`,
      [row.id, nextSendAt.toISOString()],
    );
    return NextResponse.json({ enrollment: enrollment.rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao incluir o lead." }, { status: 500 });
  }
}

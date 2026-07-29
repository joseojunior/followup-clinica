import { NextResponse } from "next/server";
import { getFollowupPool } from "@/lib/followup-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getFollowupPool();
    const [campaigns, enrollments, messages, recent, controls] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active FROM followup.campaigns"),
      db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE state = 'active')::int AS active, COUNT(*) FILTER (WHERE state IN ('paused', 'blocked', 'pending_data'))::int AS attention FROM followup.enrollments"),
      db.query("SELECT COUNT(*) FILTER (WHERE state = 'sent' AND sent_at >= date_trunc('day', NOW()))::int AS sent_today, COUNT(*) FILTER (WHERE state = 'scheduled')::int AS queued, COUNT(*) FILTER (WHERE state = 'failed')::int AS failed FROM followup.messages"),
      db.query(`SELECT m.state, m.scheduled_at, m.sent_at, e.source_chat_id, s.name AS source_name
        FROM followup.messages m JOIN followup.enrollments e ON e.id = m.enrollment_id
        JOIN followup.sources s ON s.id = e.source_id ORDER BY COALESCE(m.sent_at, m.scheduled_at) DESC LIMIT 5`),
      db.query(
        `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE control_status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE control_status = 'in_progress')::int AS in_progress,
          COUNT(*) FILTER (WHERE control_status = 'completed')::int AS completed,
          COALESCE(SUM(followup_count), 0)::int AS followups_done,
          COUNT(*) FILTER (WHERE source_stage IS NOT NULL)::int AS with_source_stage,
          COALESCE(SUM(GREATEST(COALESCE(source_stage, 0), 0)), 0)::int AS source_stages_observed
         FROM followup.lead_followup_control`,
      ),
    ]);
    return NextResponse.json({
      campaigns: campaigns.rows[0],
      enrollments: enrollments.rows[0],
      messages: messages.rows[0],
      controls: controls.rows[0],
      recent: recent.rows,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar o painel." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getFollowupPool } from "@/lib/followup-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await getFollowupPool().query(
      `SELECT m.id, m.state, m.scheduled_at, m.sent_at, m.error_message, m.content_snapshot,
        e.source_chat_id, s.name AS source_name, c.name AS campaign_name
       FROM followup.messages m
       JOIN followup.enrollments e ON e.id = m.enrollment_id
       JOIN followup.sources s ON s.id = e.source_id
       JOIN followup.campaigns c ON c.id = e.campaign_id
       ORDER BY COALESCE(m.sent_at, m.scheduled_at) DESC LIMIT 100`,
    );
    return NextResponse.json({ messages: result.rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar histórico." }, { status: 500 });
  }
}

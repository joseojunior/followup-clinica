import { NextResponse } from "next/server";
import { getFollowupPool } from "@/lib/followup-db";
import { parseOperationalPeriod } from "@/lib/operational-dashboard-core";

export const runtime = "nodejs";

export async function GET(request:Request) {
  let filters;
  try{filters=parseOperationalPeriod(new URL(request.url).searchParams);}catch{return NextResponse.json({error:"Período ou dia inválido."},{status:400});}
  try {
    const db = getFollowupPool();
    const [campaigns, enrollments, messages, recent, controls, daily] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active FROM followup.campaigns"),
      db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE state = 'active')::int AS active, COUNT(*) FILTER (WHERE state IN ('paused', 'blocked', 'pending_data'))::int AS attention FROM followup.enrollments"),
      db.query("SELECT COUNT(*) FILTER (WHERE state = 'sent' AND sent_at >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo'))::int AS sent_today, COUNT(*) FILTER (WHERE state = 'scheduled')::int AS queued, COUNT(*) FILTER (WHERE state = 'failed')::int AS failed FROM followup.messages"),
      db.query(`SELECT m.id,m.state, m.scheduled_at, m.sent_at, e.source_chat_id, s.name AS source_name,c.name AS campaign_name,COALESCE(m.sent_at,m.updated_at) AS activity_at
        FROM followup.messages m JOIN followup.enrollments e ON e.id = m.enrollment_id
        JOIN followup.sources s ON s.id = e.source_id JOIN followup.campaigns c ON c.id=e.campaign_id
        WHERE ($1='' OR (COALESCE(m.sent_at,m.updated_at) AT TIME ZONE 'America/Sao_Paulo')::date=NULLIF($1,'')::date)
        ORDER BY COALESCE(m.sent_at,m.updated_at) DESC,m.id DESC LIMIT 10`,[filters.day]),
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
      db.query(`WITH days AS (SELECT generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date-($1::int-1),(now() AT TIME ZONE 'America/Sao_Paulo')::date,interval '1 day')::date AS day),
        counts AS (SELECT (COALESCE(sent_at,updated_at) AT TIME ZONE 'America/Sao_Paulo')::date AS day,
          count(*) FILTER(WHERE state='sent')::int AS sent,count(*) FILTER(WHERE state='failed')::int AS failed,count(*) FILTER(WHERE state='simulated')::int AS simulated
          FROM followup.messages WHERE state IN ('sent','failed','simulated') AND COALESCE(sent_at,updated_at)>=(((now() AT TIME ZONE 'America/Sao_Paulo')::date-($1::int-1))::timestamp AT TIME ZONE 'America/Sao_Paulo') GROUP BY 1)
        SELECT d.day::text,COALESCE(c.sent,0) AS sent,COALESCE(c.failed,0) AS failed,COALESCE(c.simulated,0) AS simulated FROM days d LEFT JOIN counts c USING(day) ORDER BY d.day`,[filters.days]),
    ]);
    return NextResponse.json({
      campaigns: campaigns.rows[0],
      enrollments: enrollments.rows[0],
      messages: messages.rows[0],
      controls: controls.rows[0],
      recent: recent.rows,
      daily:daily.rows,sendMode:process.env.FOLLOWUP_SEND_MODE==="live"?"live":"dry_run",updatedAt:new Date().toISOString(),
    },{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar o painel." }, { status: 500 });
  }
}

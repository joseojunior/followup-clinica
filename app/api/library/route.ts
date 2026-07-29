import { NextResponse } from "next/server";
import { getFollowupPool } from "@/lib/followup-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await getFollowupPool().query(
      `SELECT cv.id, cv.content_type, cv.text_template, cv.media_url, cv.is_active,
        cv.variant_order, cs.step_order, c.name AS campaign_name, s.name AS unit_name
       FROM followup.content_variants cv
       JOIN followup.campaign_steps cs ON cs.id = cv.step_id
       JOIN followup.campaigns c ON c.id = cs.campaign_id
       JOIN followup.sources s ON s.id = c.source_id
       WHERE c.status <> 'archived'
       ORDER BY c.name ASC, cs.step_order ASC, cv.variant_order ASC`,
    );
    return NextResponse.json({ items: result.rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar a biblioteca." }, { status: 500 });
  }
}

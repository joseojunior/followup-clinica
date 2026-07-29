import { NextResponse } from "next/server";
import { getFollowupPool } from "@/lib/followup-db";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await context.params;
    const result = await getFollowupPool().query(
      `SELECT cs.step_order, cv.id, cv.variant_order, cv.content_type, cv.text_template, cv.media_url, cv.weight, cv.is_active
       FROM followup.campaign_steps cs
       LEFT JOIN followup.content_variants cv ON cv.step_id = cs.id
       WHERE cs.campaign_id = $1
       ORDER BY cs.step_order, cv.variant_order`,
      [campaignId],
    );
    return NextResponse.json({ content: result.rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar conteúdo." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await context.params;
    const body = await request.json() as { stepOrder?: number; textTemplate?: string; mediaUrl?: string; weight?: number };
    const stepOrder = Number(body.stepOrder);
    const textTemplate = body.textTemplate?.trim() || null;
    const mediaUrl = body.mediaUrl?.trim() || null;
    if (!Number.isInteger(stepOrder) || stepOrder < 1 || (!textTemplate && !mediaUrl)) {
      return NextResponse.json({ error: "Informe etapa, texto ou mídia." }, { status: 400 });
    }
    const step = await getFollowupPool().query(
      "SELECT id, content_mode FROM followup.campaign_steps WHERE campaign_id = $1 AND step_order = $2",
      [campaignId, stepOrder],
    );
    if (!step.rowCount) return NextResponse.json({ error: "Etapa não encontrada." }, { status: 404 });
    const contentType = step.rows[0].content_mode === "text" ? "text" : step.rows[0].content_mode === "sticker_text" ? "sticker" : step.rows[0].content_mode === "image_text" ? "image" : "sequence";
    const variant = await getFollowupPool().query(
      `INSERT INTO followup.content_variants (step_id, variant_order, content_type, text_template, media_url, weight)
       VALUES ($1, (SELECT COALESCE(MAX(variant_order), 0) + 1 FROM followup.content_variants WHERE step_id = $1), $2, $3, $4, $5)
       RETURNING id, variant_order`,
      [step.rows[0].id, contentType, textTemplate, mediaUrl, Math.max(1, Math.min(100, Number(body.weight) || 1))],
    );
    return NextResponse.json({ variant: variant.rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao criar variação." }, { status: 500 });
  }
}


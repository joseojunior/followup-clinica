import { NextResponse } from "next/server";
import { getFollowupPool } from "@/lib/followup-db";
import { normalizeBrazilPhone, renderTemplate, type LeadSnapshot } from "@/lib/followup";
import { sendWithUazapi } from "@/lib/uazapi";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await context.params;
    const [campaign, senders, steps, recent] = await Promise.all([
      getFollowupPool().query(
        "SELECT id, name, status FROM followup.campaigns WHERE id = $1 AND status <> 'archived'",
        [campaignId],
      ),
      getFollowupPool().query(
        `SELECT code, name, whatsapp_number
         FROM followup.senders WHERE is_active = true ORDER BY code`,
      ),
      getFollowupPool().query(
        `SELECT cs.step_order, cs.content_mode,
          COALESCE(jsonb_agg(jsonb_build_object(
            'id', cv.id, 'textTemplate', cv.text_template, 'mediaUrl', cv.media_url,
            'contentType', cv.content_type, 'variantOrder', cv.variant_order
          ) ORDER BY cv.variant_order) FILTER (WHERE cv.id IS NOT NULL), '[]'::jsonb) AS variants
         FROM followup.campaign_steps cs
         LEFT JOIN followup.content_variants cv ON cv.step_id = cs.id AND cv.is_active = true
         WHERE cs.campaign_id = $1 AND cs.is_active = true
         GROUP BY cs.id ORDER BY cs.step_order`,
        [campaignId],
      ),
      getFollowupPool().query(
        `SELECT id, recipient_phone, step_order, send_mode, state, error_message, created_at
         FROM followup.campaign_test_runs WHERE campaign_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [campaignId],
      ),
    ]);
    if (!campaign.rowCount) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    return NextResponse.json({
      campaign: campaign.rows[0],
      senders: senders.rows,
      steps: steps.rows,
      recent: recent.rows,
      sendMode: process.env.FOLLOWUP_SEND_MODE === "live" ? "live" : "dry_run",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao preparar teste." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  let testRunId: string | null = null;
  try {
    const body = await request.json() as {
      phone?: string;
      senderCode?: string;
      stepOrder?: number;
      variantId?: string;
      recipientName?: string;
      confirmLive?: boolean;
    };
    const phone = normalizeBrazilPhone(body.phone ?? "");
    if (!phone) return NextResponse.json({ error: "Informe o número com DDI e DDD." }, { status: 400 });
    if (!/^sender_[12]$/.test(body.senderCode ?? "")) {
      return NextResponse.json({ error: "Escolha um número remetente válido." }, { status: 400 });
    }
    const stepOrder = Number(body.stepOrder);
    if (!Number.isInteger(stepOrder) || stepOrder < 1) {
      return NextResponse.json({ error: "Escolha uma etapa válida." }, { status: 400 });
    }
    const sendMode = process.env.FOLLOWUP_SEND_MODE === "live" ? "live" : "dry_run";
    if (sendMode === "live" && body.confirmLive !== true) {
      return NextResponse.json({ error: "Confirmação de envio real ausente." }, { status: 409 });
    }

    const result = await getFollowupPool().query(
      `SELECT c.name AS campaign_name, sender.id AS sender_id, sender.name AS sender_name,
        sender.credential_key, sender.provider_status, variant.id AS variant_id, variant.content_type,
        variant.text_template, variant.media_url
       FROM followup.campaigns c
       JOIN followup.campaign_steps step ON step.campaign_id = c.id
         AND step.step_order = $2 AND step.is_active = true
       JOIN followup.content_variants variant ON variant.step_id = step.id
         AND variant.is_active = true
         AND ($4::uuid IS NULL OR variant.id = $4)
       JOIN followup.senders sender ON sender.code = $3 AND sender.is_active = true
       WHERE c.id = $1 AND c.status <> 'archived'
       ORDER BY variant.variant_order
       LIMIT 1`,
      [campaignId, stepOrder, body.senderCode, body.variantId || null],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Campanha, etapa, conteúdo ou remetente não encontrado." }, { status: 404 });
    }
    const row = result.rows[0];
    if (sendMode === "live" && row.provider_status !== "connected") {
      return NextResponse.json({ error: `${row.sender_name} está desconectada. Reconecte o WhatsApp antes do teste.` }, { status: 409 });
    }
    const lead: LeadSnapshot = {
      chatId: `test:${phone}`,
      leadId: null,
      name: body.recipientName?.trim() || "Teste",
      phone,
      email: null,
      transferred: false,
      booked: false,
      followupAllowed: true,
      conversationStatus: null,
      treatment: null,
      qualificationStatus: null,
      location: null,
      appointmentType: null,
      lastAiMessageAt: null,
      createdAt: new Date().toISOString(),
    };
    const content = {
      type: row.content_type,
      text: renderTemplate(row.text_template ?? "", lead),
      mediaUrl: row.media_url ?? undefined,
    };
    const testRun = await getFollowupPool().query(
      `INSERT INTO followup.campaign_test_runs
        (campaign_id, campaign_name, sender_id, sender_name, recipient_phone, step_order,
         variant_id, content_snapshot, send_mode, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'prepared')
       RETURNING id`,
      [campaignId, row.campaign_name, row.sender_id, row.sender_name, phone, stepOrder,
        row.variant_id, JSON.stringify(content), sendMode],
    );
    testRunId = testRun.rows[0].id;
    const token = process.env[row.credential_key];
    if (!token) throw new Error(`Credencial ${row.credential_key} ausente.`);
    const provider = await sendWithUazapi(token, phone, content);
    const state = sendMode === "live" ? "sent" : "simulated";
    await getFollowupPool().query(
      `UPDATE followup.campaign_test_runs
       SET state = $2, provider_message_id = $3, provider_response = $4::jsonb, completed_at = NOW()
       WHERE id = $1`,
      [testRunId, state, provider.providerMessageId, JSON.stringify(provider.response)],
    );
    return NextResponse.json({ testRunId, state, sendMode, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no teste.";
    if (testRunId) {
      await getFollowupPool().query(
        "UPDATE followup.campaign_test_runs SET state = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1",
        [testRunId, message],
      ).catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

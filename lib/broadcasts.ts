import { getLeadEligibility, renderTemplate } from "@/lib/followup";
import { getFollowupPool, withTransaction } from "@/lib/followup-db";
import { findOperationalLead, type LeadOrigin } from "@/lib/lead-catalog";
import { type SourceKey } from "@/lib/source-leads";
import { sendWithUazapi } from "@/lib/uazapi";
import { reserveSenderSlot } from "@/lib/sender-throttle";

type CreateBroadcastInput = {
  name?: string;
  senderCode?: string;
  leadIds?: string[];
  text?: string;
  mediaUrl?: string;
  contentType?: "text" | "sticker" | "image";
  scheduledAt?: string;
};

export async function listBroadcastSetup() {
  const [senders, broadcasts] = await Promise.all([
    getFollowupPool().query("SELECT code, name, whatsapp_number FROM followup.senders WHERE is_active = true ORDER BY code"),
    getFollowupPool().query(
      `SELECT b.id, b.name, b.status, b.scheduled_at, b.created_at,
        COUNT(r.id)::int AS recipients,
        COUNT(r.id) FILTER (WHERE r.state = 'sent')::int AS sent,
        COUNT(r.id) FILTER (WHERE r.state = 'failed')::int AS failed
       FROM followup.broadcast_campaigns b
       LEFT JOIN followup.broadcast_recipients r ON r.broadcast_campaign_id = b.id
       GROUP BY b.id ORDER BY b.created_at DESC LIMIT 20`,
    ),
  ]);
  return { senders: senders.rows, broadcasts: broadcasts.rows };
}

export async function createBroadcast(value: CreateBroadcastInput) {
  const name = value.name?.trim();
  const text = value.text?.trim() || null;
  const mediaUrl = value.mediaUrl?.trim() || null;
  const contentType = value.contentType ?? "text";
  const leadIds = [...new Set(value.leadIds?.filter(Boolean) ?? [])];
  const scheduledAt = value.scheduledAt ? new Date(value.scheduledAt) : new Date();

  if (!name || name.length > 120) throw new Error("Informe um nome para o disparo.");
  if (!/^sender_[12]$/.test(value.senderCode ?? "")) throw new Error("Escolha a unidade remetente.");
  if (!text && !mediaUrl) throw new Error("Escreva uma mensagem ou adicione uma mídia.");
  if (!leadIds.length) throw new Error("Selecione pelo menos um contato.");
  if (leadIds.length > 500) throw new Error("Selecione no máximo 500 contatos por disparo.");
  if (!Number.isFinite(scheduledAt.valueOf())) throw new Error("Informe uma data válida para o envio.");

  return withTransaction(async (client) => {
    const sender = await client.query("SELECT id FROM followup.senders WHERE code = $1 AND is_active = true", [value.senderCode]);
    if (!sender.rowCount) throw new Error("A unidade remetente não está disponível.");
    const leads = await client.query(
      `SELECT id, source_id, source_chat_id, origin_kind, name, phone, email, is_eligible, eligibility_reason
       FROM followup.leads WHERE id = ANY($1::uuid[])`,
      [leadIds],
    );
    if (leads.rowCount !== leadIds.length) throw new Error("Um ou mais contatos não foram encontrados.");
    const unavailable = leads.rows.find((lead) => !lead.phone || !lead.is_eligible);
    if (unavailable) throw new Error(unavailable.eligibility_reason ?? "Há um contato selecionado sem número disponível.");

    const campaign = await client.query(
      `INSERT INTO followup.broadcast_campaigns
        (name, sender_id, content_type, text_template, media_url, status, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, 'scheduled', $6)
       RETURNING id, status, scheduled_at`,
      [name, sender.rows[0].id, contentType, text, mediaUrl, scheduledAt.toISOString()],
    );
    for (const lead of leads.rows) {
      await client.query(
        `INSERT INTO followup.broadcast_recipients
          (broadcast_campaign_id, lead_id, source_id, source_chat_id, origin_kind, phone, recipient_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [campaign.rows[0].id, lead.id, lead.source_id, lead.source_chat_id,
          lead.origin_kind, lead.phone, JSON.stringify({ name: lead.name, email: lead.email })],
      );
    }
    return { ...campaign.rows[0], recipients: leads.rowCount };
  });
}

type ClaimedRecipient = {
  id: string; broadcast_campaign_id: string; lead_id: string; source_id: string; source_chat_id: string;
  origin_kind: LeadOrigin; phone: string; recipient_snapshot: { name?: string }; source_code: SourceKey;
  sender_id: string; credential_key: string; content_type: "text" | "sticker" | "image"; text_template: string | null; media_url: string | null;
};

export async function dispatchBroadcasts(limit = 5) {
  const claimed = await withTransaction(async (client) => {
    const result = await client.query<ClaimedRecipient>(
      `WITH candidates AS (
         SELECT r.id FROM followup.broadcast_recipients r
         JOIN followup.broadcast_campaigns b ON b.id = r.broadcast_campaign_id
         JOIN followup.senders selected_sender ON selected_sender.id = b.sender_id
         WHERE r.state = 'scheduled' AND b.status = 'scheduled' AND b.scheduled_at <= NOW()
           AND selected_sender.provider_status = 'connected'
         ORDER BY b.scheduled_at, r.created_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE followup.broadcast_recipients r SET state = 'sending'
       FROM candidates, followup.broadcast_campaigns b, followup.senders sender, followup.sources source
       WHERE r.id = candidates.id AND b.id = r.broadcast_campaign_id
         AND sender.id = b.sender_id AND source.id = r.source_id
       RETURNING r.id, r.broadcast_campaign_id, r.lead_id, r.source_id, r.source_chat_id, r.origin_kind,
         r.phone, r.recipient_snapshot, source.code AS source_code, sender.id AS sender_id, sender.credential_key,
         b.content_type, b.text_template, b.media_url`,
      [Math.min(Math.max(limit, 1), 200)],
    );
    return result.rows;
  });

  let sent = 0; let simulated = 0; let failed = 0; let cancelled = 0;
  for (const recipient of claimed) {
    try {
      const lead = await findOperationalLead(recipient.origin_kind, recipient.source_code, recipient.source_chat_id, recipient.lead_id);
      const eligibility = lead ? getLeadEligibility(lead, { requireFollowupFlag: false }) : { eligible: false, reason: "Contato não encontrado" };
      if (!eligibility.eligible) {
        await getFollowupPool().query("UPDATE followup.broadcast_recipients SET state = 'cancelled', error_message = $2 WHERE id = $1", [recipient.id, eligibility.reason]);
        cancelled += 1;
        continue;
      }
      const token = process.env[recipient.credential_key];
      if (!token) throw new Error("Credencial da unidade remetente ausente.");
      if (!lead) throw new Error("Contato não encontrado.");
      if (process.env.FOLLOWUP_SEND_MODE === "live") {
        const slot = await reserveSenderSlot(recipient.sender_id);
        if (!slot.allowed) {
          await getFollowupPool().query(
            "UPDATE followup.broadcast_recipients SET state = 'scheduled', error_message = $2 WHERE id = $1",
            [recipient.id, slot.reason ?? "Aguardando a unidade remetente"],
          );
          continue;
        }
      }
      const result = await sendWithUazapi(token, recipient.phone, {
        type: recipient.content_type,
        text: renderTemplate(recipient.text_template ?? "", lead),
        mediaUrl: recipient.media_url ?? undefined,
      });
      const state = process.env.FOLLOWUP_SEND_MODE === "live" ? "sent" : "simulated";
      await getFollowupPool().query(
        `UPDATE followup.broadcast_recipients
         SET state = $2, provider_message_id = $3, provider_response = $4::jsonb, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE NULL END
         WHERE id = $1`,
        [recipient.id, state, result.providerMessageId, JSON.stringify(result.response)],
      );
      if (state === "sent") sent += 1;
      else simulated += 1;
    } catch (error) {
      await getFollowupPool().query("UPDATE followup.broadcast_recipients SET state = 'failed', error_message = $2 WHERE id = $1", [recipient.id, error instanceof Error ? error.message : "Falha no disparo"]);
      failed += 1;
    }
  }
  await getFollowupPool().query(
    `UPDATE followup.broadcast_campaigns b
     SET status = 'completed', completed_at = NOW()
     WHERE b.status = 'scheduled' AND NOT EXISTS (
       SELECT 1 FROM followup.broadcast_recipients r WHERE r.broadcast_campaign_id = b.id AND r.state IN ('scheduled', 'sending')
     )`,
  );
  return { claimed: claimed.length, sent, simulated, failed, cancelled };
}

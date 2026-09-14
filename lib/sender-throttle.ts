import { withTransaction } from "@/lib/followup-db";

type SenderSlot = { allowed: boolean; availableAt: Date; reason?: string };

export async function reserveSenderSlot(senderId: string): Promise<SenderSlot> {
  return withTransaction(async (client) => {
    const sender = await client.query(
      "SELECT daily_limit, min_interval_seconds, timezone FROM followup.senders WHERE id = $1 AND is_active = true",
      [senderId],
    );
    if (!sender.rowCount) return { allowed: false, availableAt: new Date(Date.now() + 60 * 60 * 1_000), reason: "Unidade remetente indisponível" };

    await client.query(
      "INSERT INTO followup.sender_dispatch_slots (sender_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [senderId],
    );
    const slot = await client.query(
      "SELECT next_available_at FROM followup.sender_dispatch_slots WHERE sender_id = $1 FOR UPDATE",
      [senderId],
    );
    const now = new Date();
    const nextAvailableAt = new Date(slot.rows[0].next_available_at);
    if (nextAvailableAt > now) {
      return { allowed: false, availableAt: nextAvailableAt, reason: "Intervalo mínimo entre mensagens" };
    }

    const sentToday = await client.query(
      `SELECT (
        (SELECT COUNT(*) FROM followup.messages
         WHERE sender_id = $1 AND state = 'sent'
           AND sent_at >= (date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2)) +
        (SELECT COUNT(*) FROM followup.broadcast_recipients recipient
         JOIN followup.broadcast_campaigns campaign ON campaign.id = recipient.broadcast_campaign_id
         WHERE campaign.sender_id = $1 AND recipient.state = 'sent'
           AND recipient.sent_at >= (date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2))
      )::int AS count`,
      [senderId, sender.rows[0].timezone],
    );
    if (sentToday.rows[0].count >= sender.rows[0].daily_limit) {
      return {
        allowed: false,
        availableAt: new Date(now.valueOf() + 24 * 60 * 60 * 1_000),
        reason: "Limite diário da unidade atingido",
      };
    }

    const availableAt = new Date(now.valueOf() + sender.rows[0].min_interval_seconds * 1_000);
    await client.query(
      "UPDATE followup.sender_dispatch_slots SET next_available_at = $2 WHERE sender_id = $1",
      [senderId, availableAt.toISOString()],
    );
    return { allowed: true, availableAt };
  });
}

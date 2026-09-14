import { getFollowupPool } from "@/lib/followup-db";

export type SenderDeliverySettings = {
  code: "sender_1" | "sender_2";
  name: string;
  dailyLimit: number;
  minIntervalSeconds: number;
  timezone: string;
  sentToday: number;
  remainingToday: number;
};

type SenderSettingsInput = {
  code?: unknown;
  dailyLimit?: unknown;
  minIntervalSeconds?: unknown;
};

function toWholeNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}

export async function listSenderDeliverySettings(): Promise<SenderDeliverySettings[]> {
  const result = await getFollowupPool().query<{
    code: SenderDeliverySettings["code"];
    name: string;
    daily_limit: number;
    min_interval_seconds: number;
    timezone: string;
    sent_today: number;
  }>(
    `SELECT s.code, s.name, s.daily_limit, s.min_interval_seconds, s.timezone,
      (
        (SELECT COUNT(*) FROM followup.messages m
         WHERE m.sender_id = s.id AND m.state = 'sent'
           AND m.sent_at >= (date_trunc('day', NOW() AT TIME ZONE s.timezone) AT TIME ZONE s.timezone))
        +
        (SELECT COUNT(*) FROM followup.broadcast_recipients r
         JOIN followup.broadcast_campaigns b ON b.id = r.broadcast_campaign_id
         WHERE b.sender_id = s.id AND r.state = 'sent'
           AND r.sent_at >= (date_trunc('day', NOW() AT TIME ZONE s.timezone) AT TIME ZONE s.timezone))
      )::int AS sent_today
     FROM followup.senders s
     WHERE s.is_active = true
     ORDER BY s.code`,
  );

  return result.rows.map((sender) => ({
    code: sender.code,
    name: sender.name,
    dailyLimit: sender.daily_limit,
    minIntervalSeconds: sender.min_interval_seconds,
    timezone: sender.timezone,
    sentToday: sender.sent_today,
    remainingToday: Math.max(0, sender.daily_limit - sender.sent_today),
  }));
}

export async function updateSenderDeliverySettings(input: SenderSettingsInput) {
  const code = input.code;
  const dailyLimit = toWholeNumber(input.dailyLimit);
  const minIntervalSeconds = toWholeNumber(input.minIntervalSeconds);

  if (code !== "sender_1" && code !== "sender_2") throw new Error("Unidade remetente inválida.");
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10_000) {
    throw new Error("O limite diário deve estar entre 1 e 10.000 mensagens.");
  }
  if (!Number.isInteger(minIntervalSeconds) || minIntervalSeconds < 0 || minIntervalSeconds > 3_600) {
    throw new Error("O intervalo deve estar entre 0 e 3.600 segundos.");
  }

  const result = await getFollowupPool().query(
    `UPDATE followup.senders
     SET daily_limit = $2, min_interval_seconds = $3
     WHERE code = $1 AND is_active = true
     RETURNING code`,
    [code, dailyLimit, minIntervalSeconds],
  );
  if (!result.rowCount) throw new Error("Unidade remetente não encontrada.");

  return listSenderDeliverySettings();
}

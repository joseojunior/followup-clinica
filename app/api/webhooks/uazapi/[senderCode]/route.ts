import { NextResponse } from "next/server";
import { getFollowupPool, withTransaction } from "@/lib/followup-db";

export const runtime = "nodejs";

function stringAt(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

function booleanAt(value: unknown, path: string[]): boolean | null {
  let current: unknown = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "boolean" ? current : null;
}

function extractChatId(payload: unknown) {
  return stringAt(payload, ["chat_id"]) ?? stringAt(payload, ["chatId"]) ?? stringAt(payload, ["data", "chat_id"])
    ?? stringAt(payload, ["data", "chatId"]) ?? stringAt(payload, ["data", "key", "remoteJid"]);
}

function isInbound(payload: unknown) {
  const fromMe = booleanAt(payload, ["fromMe"]) ?? booleanAt(payload, ["data", "fromMe"]) ?? booleanAt(payload, ["data", "key", "fromMe"]);
  return fromMe !== true;
}

export async function POST(request: Request, context: { params: Promise<{ senderCode: string }> }) {
  const secret = process.env.UAZAPI_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const { senderCode } = await context.params;
    if (!/^sender_[12]$/.test(senderCode)) return NextResponse.json({ error: "Remetente inválido." }, { status: 400 });
    const payload = await request.json();
    const sender = await getFollowupPool().query("SELECT id FROM followup.senders WHERE code = $1", [senderCode]);
    if (!sender.rowCount) return NextResponse.json({ error: "Unidade não cadastrada." }, { status: 404 });
    const chatId = extractChatId(payload);
    const eventType = stringAt(payload, ["event"]) ?? stringAt(payload, ["type"]) ?? "uazapi.unknown";
    const providerEventId = stringAt(payload, ["eventId"]) ?? stringAt(payload, ["id"]) ?? stringAt(payload, ["data", "key", "id"]);
    const result = await withTransaction(async (client) => {
      const stored = await client.query(
        `INSERT INTO followup.provider_events (sender_id, provider_event_id, event_type, source_chat_id, payload, processed_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [sender.rows[0].id, providerEventId, eventType, chatId, JSON.stringify(payload)],
      );
      if (!stored.rowCount || !chatId || !isInbound(payload)) return { stored: Boolean(stored.rowCount), paused: 0 };
      const paused = await client.query(
        `UPDATE followup.enrollments e SET state = 'paused', paused_reason = 'Resposta recebida', dispatch_lock_at = NULL
         FROM followup.sources so
         WHERE e.source_id = so.id AND so.default_sender_id = $1 AND e.source_chat_id = $2 AND e.state = 'active'`,
        [sender.rows[0].id, chatId],
      );
      await client.query(
        `UPDATE followup.lead_followup_control control
         SET control_status = 'paused', next_followup_at = NULL
         FROM followup.enrollments enrollment
         JOIN followup.sources source ON source.id = enrollment.source_id
         WHERE control.lead_id = enrollment.lead_id
           AND source.default_sender_id = $1
           AND enrollment.source_chat_id = $2
           AND enrollment.state = 'paused'`,
        [sender.rows[0].id, chatId],
      );
      await client.query(
        "INSERT INTO followup.audit_log (entity_type, entity_id, action, metadata) VALUES ('lead', $1, 'paused_on_inbound', $2::jsonb)",
        [chatId, JSON.stringify({ senderCode, eventType })],
      );
      return { stored: true, paused: paused.rowCount ?? 0 };
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao registrar evento." }, { status: 500 });
  }
}

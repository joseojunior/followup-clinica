import { NextResponse } from "next/server";
import { dispatchScheduledMessages } from "@/lib/dispatch";
import { dispatchBroadcasts } from "@/lib/broadcasts";
import { enrollActiveCampaigns, queueDueMessages } from "@/lib/control-plane";
import { refreshAllSenderConnections } from "@/lib/uazapi-connections";

export const runtime = "nodejs";

function authorized(request: Request) {
  const key = process.env.WORKER_API_KEY;
  return Boolean(key && request.headers.get("x-worker-key") === key);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; limit?: number };
    const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(200, Number(body.limit))) : undefined;
    if (body.action === "connections") return NextResponse.json({ connections: await refreshAllSenderConnections() });
    if (body.action === "enroll") return NextResponse.json(await enrollActiveCampaigns(limit));
    if (body.action === "queue") return NextResponse.json(await queueDueMessages(limit));
    if (body.action === "dispatch") return NextResponse.json(await dispatchScheduledMessages(limit));
    if (body.action === "broadcast") return NextResponse.json(await dispatchBroadcasts(limit));
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no worker.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

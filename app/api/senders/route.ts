import { NextResponse } from "next/server";
import { listSenderDeliverySettings, updateSenderDeliverySettings } from "@/lib/sender-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ senders: await listSenderDeliverySettings() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar os limites de envio." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    return NextResponse.json({ senders: await updateSenderDeliverySettings(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar os limites de envio." }, { status: 400 });
  }
}

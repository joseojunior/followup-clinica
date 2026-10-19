import { NextResponse } from "next/server";
import { getN8nSettings, saveN8nApiKey } from "@/lib/n8n-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await getN8nSettings(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Não foi possível consultar a configuração do n8n." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { apiKey?: unknown };
    if (typeof body.apiKey !== "string") return NextResponse.json({ error: "Informe uma chave de API do n8n." }, { status: 400 });
    return NextResponse.json(await saveN8nApiKey(body.apiKey), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error && (error.message.startsWith("Informe") || error.message.startsWith("Configure")) ? error.message : "Não foi possível salvar a chave do n8n.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

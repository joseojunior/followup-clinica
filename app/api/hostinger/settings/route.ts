import { NextResponse } from "next/server";
import { getHostingerSettings, saveHostingerApiKey } from "@/lib/hostinger-settings";
import { HostingerMonitorError, listHostingerVps } from "@/lib/hostinger-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await getHostingerSettings(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Não foi possível consultar a configuração da Hostinger." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { apiKey?: unknown };
    if (typeof body.apiKey !== "string" || body.apiKey.trim().length < 30 || /\s/.test(body.apiKey.trim())) {
      return NextResponse.json({ error: "Informe um token válido da Hostinger." }, { status: 400 });
    }
    await listHostingerVps(body.apiKey.trim());
    return NextResponse.json(await saveHostingerApiKey(body.apiKey), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof HostingerMonitorError ? error.message : error instanceof Error && error.message.startsWith("Configure") ? error.message : "Não foi possível salvar o token da Hostinger.";
    const status = error instanceof HostingerMonitorError ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

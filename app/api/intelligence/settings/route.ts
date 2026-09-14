import { NextResponse } from "next/server";
import { getAISettings, saveAISettings } from "@/lib/ai-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await getAISettings()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar a configuração." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { apiKey?: string; defaultModel?: string };
    return NextResponse.json(await saveAISettings({ apiKey: body.apiKey, defaultModel: body.defaultModel }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao salvar a configuração." }, { status: 400 });
  }
}

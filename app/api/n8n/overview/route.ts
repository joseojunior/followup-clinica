import { NextResponse } from "next/server";
import { getN8nOverview, N8nMonitorError } from "@/lib/n8n-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getN8nOverview(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof N8nMonitorError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível carregar o monitor do n8n." }, { status: 500 });
  }
}

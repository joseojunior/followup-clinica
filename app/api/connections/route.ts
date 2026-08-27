import { NextResponse } from "next/server";
import { refreshAllSenderConnections } from "@/lib/uazapi-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ connections: await refreshAllSenderConnections() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar as conexões." }, { status: 500 });
  }
}

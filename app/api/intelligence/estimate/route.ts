import { NextResponse } from "next/server";
import { estimateLeadAnalysis } from "@/lib/operational-intelligence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { leadId?: string; model?: string };
    if (!body.leadId) throw new Error("Escolha um lead para estimar a análise.");
    return NextResponse.json(await estimateLeadAnalysis(body.leadId, body.model));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao calcular a estimativa." }, { status: 400 });
  }
}

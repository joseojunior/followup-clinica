import { NextResponse } from "next/server";
import { analyzeLeadConversation } from "@/lib/operational-intelligence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { leadId?: string };
    if (!body.leadId) throw new Error("Escolha um lead para analisar.");
    return NextResponse.json(await analyzeLeadConversation(body.leadId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao analisar a conversa." }, { status: 400 });
  }
}

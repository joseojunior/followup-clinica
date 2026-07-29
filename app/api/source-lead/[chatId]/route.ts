import { NextResponse } from "next/server";
import { getLeadEligibility } from "@/lib/followup";
import { findSourceLead, sourceDefinitions, type SourceKey } from "@/lib/source-leads";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ chatId: string }> }) {
  try {
    const { chatId } = await context.params;
    const requestedSource = new URL(request.url).searchParams.get("source") ?? "usuarios_sdr";
    if (!(requestedSource in sourceDefinitions)) {
      return NextResponse.json({ error: "Fonte inválida" }, { status: 400 });
    }
    const sourceKey = requestedSource as SourceKey;
    const lead = await findSourceLead(sourceKey, chatId);
    if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    return NextResponse.json({ source: sourceKey, lead, eligibility: getLeadEligibility(lead) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar a fonte";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

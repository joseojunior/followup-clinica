import { NextResponse } from "next/server";
import { createCampaign, listCampaigns, validateCampaignInput } from "@/lib/campaigns";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ campaigns: await listCampaigns() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao listar campanhas.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const input = validateCampaignInput(await request.json());
    const campaign = await createCampaign(input);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar campanha.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { deleteCampaign, getCampaign, setCampaignStatus, updateCampaign, validateCampaignInput } from "@/lib/campaigns";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await context.params;
    const campaign = await getCampaign(campaignId);
    if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao visualizar campanha." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await context.params;
    const body = await request.json();
    const input = validateCampaignInput(body);
    const campaign = await updateCampaign(campaignId, {
      ...input,
      metadataOnly: body?.metadataOnly === true,
    });
    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao editar campanha." }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await context.params;
    const body = await request.json() as { status?: string };
    if (body.status !== "active" && body.status !== "paused") {
      return NextResponse.json({ error: "Informe se a campanha deve ficar ativa ou pausada." }, { status: 400 });
    }
    return NextResponse.json({ campaign: await setCampaignStatus(campaignId, body.status) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao alterar a campanha." }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    const { campaignId } = await context.params;
    return NextResponse.json(await deleteCampaign(campaignId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao excluir campanha." }, { status: 400 });
  }
}

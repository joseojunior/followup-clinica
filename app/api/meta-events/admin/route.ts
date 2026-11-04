import { NextResponse } from "next/server";
import { requireMetaAdmin } from "@/lib/meta-admin";
import { MetaInputError, retryMetaEvent, rotateInboundToken, saveMetaUnit, setMetaPolicy, testMetaConfiguration } from "@/lib/meta-events";
import { isMetaStage, isMetaUnit } from "@/lib/meta-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await requireMetaAdmin();
  if (!actor) return NextResponse.json({ error: "Entre no painel para executar esta ação." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!isMetaUnit(body.unit) || typeof body.action !== "string") throw new MetaInputError("Unidade ou ação inválida.");
    let result: unknown = { ok: true };
    if (body.action === "rotate_token") result = { token: await rotateInboundToken(body.unit, actor) };
    else if (body.action === "save_unit") await saveMetaUnit(body.unit, body, actor);
    else if (body.action === "test") result = await testMetaConfiguration(body.unit, actor, body.sourceId);
    else if (body.action === "policy") {
      if (!isMetaStage(body.eventType) || !["approve", "enable", "disable"].includes(String(body.policyAction))) throw new MetaInputError("Etapa ou ação inválida.");
      await setMetaPolicy(body.unit, body.eventType, body.policyAction as "approve" | "enable" | "disable", actor, body.privacyReviewConfirmed === true);
    } else if (body.action === "retry") {
      if (typeof body.eventId !== "string") throw new MetaInputError("Evento inválido.");
      result = await retryMetaEvent(body.eventId, actor);
    } else throw new MetaInputError("Ação inválida.");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MetaInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Ação administrativa indisponível." }, { status: 503 });
  }
}

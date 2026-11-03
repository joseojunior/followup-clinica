import { NextResponse } from "next/server";
import { authenticateN8nToken, consumeIngestQuota, MetaInputError, recordMetaEvent } from "@/lib/meta-events";
import { readMetaEventBody } from "@/lib/meta-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get("x-forwarded-proto");
    if (process.env.NODE_ENV === "production" && forwarded !== "https" && new URL(request.url).protocol !== "https:") {
      return NextResponse.json({ error: "HTTPS obrigatório." }, { status: 403 });
    }
    const unit = await authenticateN8nToken(request.headers.get("authorization"));
    if (!unit) return NextResponse.json({ error: "Token inválido." }, { status: 401 });
    if (!await consumeIngestQuota(unit)) return NextResponse.json({ error: "Limite de 120 requisições por minuto excedido." }, { status: 429, headers: { "Retry-After": "60" } });
    let raw: string;
    try { raw = await readMetaEventBody(request); }
    catch (error) {
      if (error instanceof RangeError) return NextResponse.json({ error: "Corpo excede 16 KB." }, { status: 413 });
      throw error;
    }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
    const result = await recordMetaEvent(body, unit);
    return NextResponse.json({ ...result, message: result.duplicate ? "Evento já registrado." : "Registrado na plataforma; não significa entrega à Meta." },
      { status: result.duplicate ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MetaInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível registrar o evento." }, { status: 503 });
  }
}

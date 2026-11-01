import { NextResponse } from "next/server";
import { getMetaOverview } from "@/lib/meta-events";
import { isMetaUnit } from "@/lib/meta-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const value = url.searchParams.get("unit") || "all";
    if (value !== "all" && !isMetaUnit(value)) return NextResponse.json({ error: "Unidade inválida." }, { status: 400 });
    const days = Number(url.searchParams.get("days") || 7);
    if (![1, 7, 30].includes(days)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });
    return NextResponse.json(await getMetaOverview(value, days, url.searchParams.get("search") || ""), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Não foi possível consultar os eventos Meta." }, { status: 503 }); }
}

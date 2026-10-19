import { NextResponse } from "next/server";
import { getHostingerOverview, HostingerMonitorError, isHostingerPeriod } from "@/lib/hostinger-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const period = url.searchParams.get("period");
    const vmText = url.searchParams.get("vmId");
    const vmId = vmText && /^\d+$/.test(vmText) ? Number(vmText) : undefined;
    if (vmText && (!vmId || !Number.isSafeInteger(vmId))) return NextResponse.json({ error: "Escolha uma VPS válida." }, { status: 400 });
    return NextResponse.json(await getHostingerOverview(isHostingerPeriod(period) ? period : "24h", vmId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof HostingerMonitorError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível carregar as métricas da VPS." }, { status: 500 });
  }
}

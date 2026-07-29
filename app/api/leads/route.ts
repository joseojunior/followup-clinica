import { NextResponse } from "next/server";
import { listCatalogLeads, type LeadOrigin } from "@/lib/lead-catalog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const requested = new URL(request.url).searchParams.get("origin");
    const origin = requested === "database" || requested === "csv" ? requested as LeadOrigin : undefined;
    const leads = await listCatalogLeads(origin);
    return NextResponse.json({
      leads,
      databaseLeads: leads.filter((lead) => lead.origin_kind === "database"),
      csvLeads: leads.filter((lead) => lead.origin_kind === "csv"),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar leads." }, { status: 500 });
  }
}

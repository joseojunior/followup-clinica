import { NextResponse } from "next/server";
import { sourceDefinitions, type SourceKey } from "@/lib/source-leads";
import { syncDatabaseLeads } from "@/lib/lead-catalog";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { sourceCode?: string };
    if (body.sourceCode && !(body.sourceCode in sourceDefinitions)) {
      return NextResponse.json({ error: "Unidade inválida." }, { status: 400 });
    }
    return NextResponse.json(await syncDatabaseLeads(body.sourceCode as SourceKey | undefined));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na sincronização." }, { status: 500 });
  }
}

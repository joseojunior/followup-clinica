import { NextResponse } from "next/server";
import { intelligenceDashboard } from "@/lib/operational-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await intelligenceDashboard());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar a inteligência operacional." }, { status: 500 });
  }
}

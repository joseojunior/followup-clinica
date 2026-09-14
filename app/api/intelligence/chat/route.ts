import { NextResponse } from "next/server";
import { askAboutBottleneck } from "@/lib/operational-intelligence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { question?: string };
    return NextResponse.json(await askAboutBottleneck(body.question ?? ""));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao conversar sobre o gargalo." }, { status: 400 });
  }
}

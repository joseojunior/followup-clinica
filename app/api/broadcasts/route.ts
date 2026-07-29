import { NextResponse } from "next/server";
import { createBroadcast, listBroadcastSetup } from "@/lib/broadcasts";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listBroadcastSetup());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar os disparos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json({ broadcast: await createBroadcast(await request.json()) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível agendar o disparo." }, { status: 400 });
  }
}

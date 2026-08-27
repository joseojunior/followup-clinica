import { NextResponse } from "next/server";
import { connectSender } from "@/lib/uazapi-connections";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ senderCode: string }> }) {
  try {
    const { senderCode } = await context.params;
    if (!/^sender_[12]$/.test(senderCode)) return NextResponse.json({ error: "Clínica inválida." }, { status: 400 });
    const connection = await connectSender(senderCode);
    if (connection.status === "unavailable") return NextResponse.json({ connection, error: connection.error }, { status: 502 });
    return NextResponse.json({ connection });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao iniciar a conexão." }, { status: 500 });
  }
}

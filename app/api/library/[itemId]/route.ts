import { NextResponse } from "next/server";
import { archiveLibraryItem } from "@/lib/library";

export const runtime = "nodejs";

export async function DELETE(_: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await context.params;
    return NextResponse.json(await archiveLibraryItem(itemId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível arquivar o conteúdo." }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { createLibraryItem, listLibraryItems, validateLibraryItem } from "@/lib/library";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ items: await listLibraryItems() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar a biblioteca." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = validateLibraryItem(await request.json());
    return NextResponse.json({ item: await createLibraryItem(input) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o conteúdo." }, { status: 400 });
  }
}

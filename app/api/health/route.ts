import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    service: "followup-clinica",
    status: "ok",
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    sourceConfigured: Boolean(
      process.env.SOURCE_USUARIOS_SDR_DATABASE_URL &&
      process.env.SOURCE_CLINICA_NOVA_DATABASE_URL
    ),
  });
}

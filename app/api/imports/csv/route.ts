import { NextResponse } from "next/server";
import { importCsvLeads, type CsvLead } from "@/lib/lead-catalog";
import { normalizeBrazilPhone } from "@/lib/followup";
import { sourceDefinitions, type SourceKey } from "@/lib/source-leads";

export const runtime = "nodejs";

function parseLine(line: string, separator: string) {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === separator && !quoted) {
      fields.push(value.trim());
      value = "";
    } else value += character;
  }
  fields.push(value.trim());
  return fields;
}

function parseReference(value: string | undefined) {
  if (!value) return undefined;
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (br) {
    const [, day, month, year, hour = "00", minute = "00"] = br;
    return `${year}-${month}-${day}T${hour}:${minute}:00-04:00`;
  }
  return value;
}

function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("O CSV precisa ter cabeçalho e pelo menos uma linha.");
  if (lines.length > 5_001) throw new Error("O limite por arquivo é de 5.000 leads.");
  const separator = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseLine(lines[0], separator).map((header) => header.toLowerCase().trim());
  const column = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const nameIndex = column(["nome", "name"]);
  const phoneIndex = column(["telefone", "phone", "celular", "whatsapp"]);
  const emailIndex = column(["email", "e-mail"]);
  const referenceIndex = column(["data_referencia", "reference_at", "data", "ultima_interacao"]);
  if (phoneIndex < 0) throw new Error("Cabeçalho obrigatório ausente: telefone.");

  const rows: CsvLead[] = [];
  const rejected: Array<{ row: number; error: string }> = [];
  lines.slice(1).forEach((line, index) => {
    const values = parseLine(line, separator);
    const phone = normalizeBrazilPhone(values[phoneIndex] ?? "");
    if (!phone) {
      rejected.push({ row: index + 2, error: "Telefone inválido; use DDI + DDD + número." });
      return;
    }
    rows.push({
      name: nameIndex >= 0 ? values[nameIndex] : undefined,
      phone,
      email: emailIndex >= 0 ? values[emailIndex] : undefined,
      referenceAt: referenceIndex >= 0 ? parseReference(values[referenceIndex]) : undefined,
    });
  });
  return { rows, rejected };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const sourceCode = String(form.get("sourceCode") ?? "");
    if (!(sourceCode in sourceDefinitions)) {
      return NextResponse.json({ error: "Selecione uma unidade válida." }, { status: 400 });
    }
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Envie um arquivo CSV." }, { status: 400 });
    }
    if (file.size > 2_000_000) {
      return NextResponse.json({ error: "O arquivo deve ter no máximo 2 MB." }, { status: 400 });
    }
    const parsed = parseCsv(await file.text());
    if (!parsed.rows.length) {
      return NextResponse.json({ error: "Nenhuma linha válida encontrada.", rejected: parsed.rejected }, { status: 400 });
    }
    return NextResponse.json(await importCsvLeads(sourceCode as SourceKey, file.name, parsed.rows, parsed.rejected));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao importar CSV." }, { status: 500 });
  }
}

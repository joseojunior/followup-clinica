import { getFollowupPool } from "@/lib/followup-db";
import { readSourceConversation, type ConversationEvent, type SourceKey } from "@/lib/source-leads";

type Bottleneck = { type: string; severity: "low" | "medium" | "high"; detail: string };
type InsightAnalysis = {
  summary: string;
  funnelStage: string;
  intent: string;
  needsHuman: boolean;
  nextAction: string;
  bottlenecks: Bottleneck[];
  evidence: string[];
};

export type IntelligenceInsight = {
  id: string;
  leadId: string;
  leadName: string | null;
  sourceName: string;
  status: string;
  analyzedAt: string;
  messageCount: number;
  toolCallCount: number;
  toolFailureCount: number;
  analysis: InsightAnalysis;
};

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "funnelStage", "intent", "needsHuman", "nextAction", "bottlenecks", "evidence"],
  properties: {
    summary: { type: "string" },
    funnelStage: { type: "string", enum: ["novo", "qualificacao", "interesse", "agenda", "confirmacao", "encaminhado_humano", "encerrado", "indefinido"] },
    intent: { type: "string", enum: ["alto", "medio", "baixo", "negativo", "indefinido"] },
    needsHuman: { type: "boolean" },
    nextAction: { type: "string" },
    bottlenecks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "severity", "detail"],
        properties: {
          type: { type: "string", enum: ["agenda", "ferramenta", "oferta", "qualificacao", "sem_resposta", "encaminhamento", "outro"] },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          detail: { type: "string" },
        },
      },
    },
    evidence: { type: "array", items: { type: "string" } },
  },
} as const;

function aiConfiguration() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("A IA ainda não está configurada. Adicione OPENAI_API_KEY nas variáveis da Stack.");
  return { key, model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini" };
}

function transcript(events: ConversationEvent[]) {
  const relevant = events.filter((event) => event.type === "human" || event.type === "ai" || event.type === "tool");
  const clipped = relevant.map((event) => {
    const speaker = event.type === "human" ? "LEAD" : event.type === "ai" ? "ATENDIMENTO" : "FERRAMENTA";
    return `[${speaker}] ${event.text || (event.toolNames.length ? `Chamada: ${event.toolNames.join(", ")}` : "Evento sem texto")}`;
  }).join("\n");
  return clipped.slice(-28_000);
}

async function requestStructuredAnalysis(events: ConversationEvent[]) {
  const { key, model } = aiConfiguration();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: "developer", content: [{ type: "input_text", text: "Você analisa conversas de atendimento de clínica para melhoria operacional. Não faça diagnóstico, aconselhamento médico ou afirmações clínicas. Baseie-se somente no histórico; quando não houver evidência, diga indefinido. Identifique gargalos que prejudicam o agendamento e o uso de ferramentas. Seja objetivo, em português do Brasil." }] },
        { role: "user", content: [{ type: "input_text", text: `Analise esta conversa:\n\n${transcript(events)}` }] },
      ],
      text: { format: { type: "json_schema", name: "conversation_insight", strict: true, schema: analysisSchema } },
    }),
  });
  const payload = await response.json() as { output_text?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "A IA não conseguiu analisar a conversa.");
  if (!payload.output_text) throw new Error("A IA não retornou uma análise válida.");
  try {
    return { model, analysis: JSON.parse(payload.output_text) as InsightAnalysis };
  } catch {
    throw new Error("A IA retornou uma análise em formato inválido.");
  }
}

export async function analyzeLeadConversation(leadId: string) {
  const leadResult = await getFollowupPool().query<{ id: string; source_id: string; source_chat_id: string | null; origin_kind: string; source_code: string }>(
    `SELECT l.id, l.source_id, l.source_chat_id, l.origin_kind, s.code AS source_code
     FROM followup.leads l JOIN followup.sources s ON s.id = l.source_id
     WHERE l.id = $1`,
    [leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead) throw new Error("Lead não encontrado.");
  if (lead.origin_kind !== "database" || !lead.source_chat_id) throw new Error("Este lead não possui histórico de conversa na fonte.");

  const conversation = await readSourceConversation(lead.source_code as SourceKey, lead.source_chat_id);
  if (!conversation.events.length) throw new Error("Nenhuma conversa foi encontrada para este lead.");
  const existing = await getFollowupPool().query<{ id: string; source_hash: string; analysis: unknown }>(
    "SELECT id, source_hash, analysis FROM followup.conversation_insights WHERE lead_id = $1 AND status = 'completed'",
    [lead.id],
  );
  if (existing.rows[0]?.source_hash === conversation.sourceHash) {
    return { id: existing.rows[0].id, analysis: parseAnalysis(existing.rows[0].analysis), unchanged: true };
  }
  const { analysis, model } = await requestStructuredAnalysis(conversation.events);
  const saved = await getFollowupPool().query<{ id: string }>(
    `INSERT INTO followup.conversation_insights
      (lead_id, source_id, source_chat_id, session_id, source_hash, status, model,
       message_count, human_message_count, ai_message_count, tool_call_count, tool_failure_count, analysis, analyzed_at, error_message)
     VALUES ($1, $2, $3, $3, $4, 'completed', $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NULL)
     ON CONFLICT (lead_id) DO UPDATE SET
       source_chat_id = EXCLUDED.source_chat_id, session_id = EXCLUDED.session_id, source_hash = EXCLUDED.source_hash,
       status = 'completed', model = EXCLUDED.model, message_count = EXCLUDED.message_count,
       human_message_count = EXCLUDED.human_message_count, ai_message_count = EXCLUDED.ai_message_count,
       tool_call_count = EXCLUDED.tool_call_count, tool_failure_count = EXCLUDED.tool_failure_count,
       analysis = EXCLUDED.analysis, analyzed_at = NOW(), error_message = NULL
     RETURNING id`,
    [lead.id, lead.source_id, lead.source_chat_id, conversation.sourceHash, model,
      conversation.events.length, conversation.humanMessageCount, conversation.aiMessageCount,
      conversation.toolCallCount, conversation.toolFailureCount, JSON.stringify(analysis)],
  );
  return { id: saved.rows[0].id, analysis, unchanged: false };
}

function parseAnalysis(value: unknown): InsightAnalysis {
  const fallback: InsightAnalysis = { summary: "Análise indisponível.", funnelStage: "indefinido", intent: "indefinido", needsHuman: false, nextAction: "Reanalisar a conversa.", bottlenecks: [], evidence: [] };
  if (!value || typeof value !== "object") return fallback;
  const analysis = value as Partial<InsightAnalysis>;
  return { ...fallback, ...analysis, bottlenecks: Array.isArray(analysis.bottlenecks) ? analysis.bottlenecks : [], evidence: Array.isArray(analysis.evidence) ? analysis.evidence : [] };
}

export async function intelligenceDashboard() {
  const result = await getFollowupPool().query<{
    id: string; lead_id: string; lead_name: string | null; source_name: string; status: string; analyzed_at: Date;
    message_count: number; tool_call_count: number; tool_failure_count: number; analysis: unknown;
  }>(
    `SELECT insight.id, insight.lead_id, lead.name AS lead_name, source.name AS source_name, insight.status,
      insight.analyzed_at, insight.message_count, insight.tool_call_count, insight.tool_failure_count, insight.analysis
     FROM followup.conversation_insights insight
     JOIN followup.leads lead ON lead.id = insight.lead_id
     JOIN followup.sources source ON source.id = insight.source_id
     ORDER BY insight.analyzed_at DESC LIMIT 60`,
  );
  const insights: IntelligenceInsight[] = result.rows.map((row) => ({
    id: row.id, leadId: row.lead_id, leadName: row.lead_name, sourceName: row.source_name,
    status: row.status, analyzedAt: new Date(row.analyzed_at).toISOString(), messageCount: row.message_count,
    toolCallCount: row.tool_call_count, toolFailureCount: row.tool_failure_count, analysis: parseAnalysis(row.analysis),
  }));
  const highPriority = insights.reduce((count, insight) => count + insight.analysis.bottlenecks.filter((item) => item.severity === "high").length, 0);
  return {
    aiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
    overview: {
      analyzed: insights.length,
      highPriority,
      toolCalls: insights.reduce((sum, item) => sum + item.toolCallCount, 0),
      toolFailures: insights.reduce((sum, item) => sum + item.toolFailureCount, 0),
    },
    insights: insights.slice(0, 20),
  };
}

export async function askAboutBottleneck(question: string) {
  const trimmed = question.trim();
  if (!trimmed || trimmed.length > 1_500) throw new Error("Escreva uma pergunta de até 1.500 caracteres.");
  const { key, model } = aiConfiguration();
  const dashboard = await intelligenceDashboard();
  const context = dashboard.insights.slice(0, 20).map((insight) => ({
    source: insight.sourceName, stage: insight.analysis.funnelStage, intent: insight.analysis.intent,
    summary: insight.analysis.summary, bottlenecks: insight.analysis.bottlenecks, nextAction: insight.analysis.nextAction,
    toolCalls: insight.toolCallCount, toolFailures: insight.toolFailureCount,
  }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: "developer", content: [{ type: "input_text", text: "Você é um analista operacional de atendimento de clínica. Responda em português, com clareza e foco em gargalos de agendamento, processo e ferramentas. Não forneça orientação médica nem invente fatos. Diferencie evidência de hipótese e sugira passos concretos." }] },
        { role: "user", content: [{ type: "input_text", text: `Resumo das análises disponíveis:\n${JSON.stringify(context)}\n\nPergunta do operador: ${trimmed}` }] },
      ],
    }),
  });
  const payload = await response.json() as { output_text?: string; error?: { message?: string } };
  if (!response.ok || !payload.output_text) throw new Error(payload.error?.message || "A IA não conseguiu responder agora.");
  await getFollowupPool().query(
    "INSERT INTO followup.intelligence_chat_messages (question, answer, context, model) VALUES ($1, $2, $3::jsonb, $4)",
    [trimmed, payload.output_text, JSON.stringify({ analyzed: dashboard.overview.analyzed, highPriority: dashboard.overview.highPriority }), model],
  );
  return { answer: payload.output_text };
}

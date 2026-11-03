import type { MetaStage, MetaUnit } from "./meta-core.ts";

export function buildMetaGuideSample(unit: MetaUnit, stage: MetaStage, occurredAt: string) {
  return {
    unit,
    chat_id: "5511999999999@s.whatsapp.net",
    phone: "+5511999999999",
    event_type: stage,
    occurred_at: occurredAt,
    source_event_id: stage === "conversation_started" ? "ID_REAL_DA_MENSAGEM"
      : stage === "appointment_confirmed" ? "ID_REAL_DO_AGENDAMENTO"
      : `CHAT_EXEMPLO:${stage}`,
    ...(stage === "conversation_started" ? {
      ctwa_clid: "CTWA_REAL_DO_REFERRAL", source_id: "123456789012345",
      attribution: {
        utm_source: "facebook", utm_medium: "paid", utm_campaign: "campanha_exemplo",
        utm_content: "criativo_01", utm_term: "publico_exemplo",
        ad_title: "Título do anúncio", source_url: "https://exemplo.com/anuncio",
        thumbnail_url: "https://exemplo.com/imagem.jpg",
      },
    } : {}),
  };
}

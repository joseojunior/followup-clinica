"use client";

import { useState } from "react";
import type { MetaStage, MetaUnit } from "@/lib/meta-core";
import { buildMetaGuideSample } from "@/lib/meta-guide";

const stages: Record<MetaStage, string> = {
  conversation_started: "Primeiro contato / CTWA",
  lead_qualified: "Lead qualificado",
  appointment_confirmed: "Agendamento confirmado — interno",
  payment_confirmed: "Pagamento confirmado — interno",
};

export function MetaEventsGuide({ unit, url, timestamp }: { unit: MetaUnit; url: string; timestamp: string }) {
  const [stage, setStage] = useState<MetaStage>("conversation_started");
  const [feedback, setFeedback] = useState("");
  const sample = JSON.stringify(buildMetaGuideSample(unit, stage, timestamp), null, 2);
  const headers = JSON.stringify({ Authorization: "Bearer SEU_TOKEN_DA_UNIDADE", "Content-Type": "application/json" }, null, 2);
  const curl = `curl --request POST '${url}' \\\n  --header 'Authorization: Bearer SEU_TOKEN_DA_UNIDADE' \\\n  --header 'Content-Type: application/json' \\\n  --data-raw '${sample}'`;
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setFeedback(`${label} copiado. Substitua os valores ilustrativos antes de enviar.`); }
    catch { setFeedback("Não foi possível copiar. Selecione o texto abaixo e copie manualmente."); }
  }
  return <>
    <div className="meta-guide-steps">
      <div><strong>1. Criar a credencial</strong><p>Selecione a unidade acima e clique em Criar token. No n8n, crie uma credencial <code>Header Auth</code>, nome <code>Authorization</code>, valor <code>Bearer SEU_TOKEN</code>. Use uma credencial diferente para cada unidade. O token Meta é outra chave e fica no painel; não o use no HTTP Request do n8n.</p></div>
      <div><strong>2. Configurar HTTP Request</strong><p>Método POST, autenticação Generic Credential Type → Header Auth, Send Body ativado, JSON, timeout 15000 ms. Não é necessário login do painel nesta chamada.</p><code className="meta-url">{url}</code><button className="secondary-button" onClick={() => void copy(url, "URL")}>Copiar URL</button></div>
      <div><strong>3. Conectar e conferir</strong><p>Primeiro contato: após salvar a mensagem recebida/referral do lead. Outros marcos: após persistir a mudança. Preserve os nós Postgres legados. O evento aparecerá no registro acima; clique em Atualizar. Em somente registro, nenhum POST de evento vai para a Meta.</p></div>
    </div>
    <div className="meta-sample">
      <div className="meta-toolbar"><label>Exemplo para enviar<select aria-label="Etapa do exemplo n8n" value={stage} onChange={(event) => { setStage(event.target.value as MetaStage); setFeedback(""); }}>{(Object.keys(stages) as MetaStage[]).map((key) => <option key={key} value={key}>{stages[key]}</option>)}</select></label><button className="secondary-button" onClick={() => void copy(sample, "JSON")}>Copiar JSON</button><button className="secondary-button" onClick={() => void copy(curl, "cURL")}>Copiar cURL</button></div>
      <pre aria-label="Exemplo do corpo JSON">{sample}</pre>
      <small>Exemplo ilustrativo da {unit === "sender_1" ? "Unidade 1" : "Unidade 2"}. Troque chat, telefone, IDs e horário pelo acontecimento real. Copiar o exemplo não envia nada.</small>
      {feedback && <p className="meta-feedback" role="status">{feedback}</p>}
      <details className="meta-guide-detail"><summary>Cabeçalhos da requisição</summary><pre>{headers}</pre><button className="secondary-button" onClick={() => void copy(headers, "Cabeçalhos")}>Copiar cabeçalhos</button></details>
      <details className="meta-guide-detail"><summary>O que colocar em cada campo</summary>
        <dl>
          <dt>unit</dt><dd>sender_1 ou sender_2. Deve corresponder à unidade do Bearer token.</dd>
          <dt>chat_id</dt><dd>remoteJid/identificador estável do chat. Use o mesmo valor em todos os marcos desse lead.</dd>
          <dt>phone</dt><dd>Telefone internacional com DDI. É normalizado e armazenado como hash protegido, não como telefone puro.</dd>
          <dt>occurred_at</dt><dd>Data real da mensagem/mudança em ISO 8601, com Z ou fuso. Em retries, preserve o horário original.</dd>
          <dt>source_event_id</dt><dd>Primeiro contato: ID real da mensagem WhatsApp. Agendamento: id_agendamento. Qualificação/pagamento únicos por chat: chave persistida chat + etapa. Não use ID da execução n8n, valor aleatório ou um novo horário a cada retry.</dd>
          <dt>ctwa_clid e source_id</dt><dd>Somente no primeiro contato: identificador bruto do clique e ID do anúncio. Não aplique hash no CTWA. A plataforma consulta dataset/página no backend; não envie dataset_id ou page_id no JSON.</dd>
          <dt>attribution (opcional)</dt><dd>Somente no primeiro contato: UTMs, ad_title, source_url e thumbnail_url. Envie apenas os campos recebidos ou omita o bloco inteiro. Ficam no banco para futuros dashboards, mesmo sem CTWA; não são enviados à Meta. Não inclua dados do paciente, credenciais ou conversa em UTMs/URLs. UTMs: até 256 caracteres cada; título: 512; URLs: 2048, HTTPS sem credenciais. Nenhuma URL/imagem é baixada.</dd>
        </dl>
        <p>Qualificação prepara QualifiedLead para revisão. Agendamento e pagamento permanecem internos; pagamento sem ID de transação não gera Purchase e representa apenas um marco por chat. Não envie nome, e-mail, tratamento, conversa ou token Meta.</p>
      </details>
      <details className="meta-guide-detail"><summary>Mapeamento dos webhooks Uazapi dos seus fluxos</summary>
        <dl>
          <dt>Telefone</dt><dd><code>body.Payload.Content.Contact.PhoneNumber</code></dd>
          <dt>CTWA</dt><dd><code>body.Payload.Content.LastMessage.Ad.CTWaCLId</code></dd>
          <dt>Anúncio (source_id)</dt><dd><code>body.Payload.Content.LastMessage.Ad.SourceId</code></dd>
          <dt>Chat no outro formato</dt><dd><code>body.data.key.remoteJid</code></dd>
          <dt>ID da mensagem no outro formato</dt><dd><code>body.data.key.id</code></dd>
          <dt>Timestamp no outro formato</dt><dd><code>body.data.messageTimestamp</code> está em segundos Unix; converta para ISO com <code>new Date(timestamp * 1000).toISOString()</code>.</dd>
          <dt>Metadados opcionais</dt><dd>Título: <code>body.Payload.Content.LastMessage.Ad.Title</code>; URL: <code>body.Payload.Content.LastMessage.Ad.SourceUrl</code>; thumb: <code>body.Payload.Content.LastMessage.Ad.ThumbnailUrl</code>. UTMs somente se realmente vierem no webhook/URL; a plataforma não as deduz do CTWA.</dd>
        </dl>
        <p>São formatos diferentes de webhook. Confirme o caminho na saída real do seu nó antes de mapear; não misture caminhos dos dois exemplos. O primeiro export não tem amostra do ID do chat/mensagem. Trate ausência de anúncio/CTWA como contato orgânico: omita esses campos, não envie string vazia.</p>
      </details>
      <details className="meta-guide-detail"><summary>Respostas, retries e diagnóstico</summary>
        <dl>
          <dt>202</dt><dd>Registrado na plataforma. Não significa aceito nem atribuído pela Meta.</dd>
          <dt>200</dt><dd>Mesmo evento já registrado; nenhuma nova linha é criada.</dd>
          <dt>400 / 403 / 409</dt><dd>Corrija campos/horário; confira token da unidade; verifique ID reutilizado com dados diferentes ou telefone divergente no chat.</dd>
          <dt>401 / 413</dt><dd>Confira Bearer token / reduza o corpo para até 16 KB.</dd>
          <dt>429 / rede / 5xx</dt><dd>Repita com atraso e limite de tentativas. Em 429 respeite Retry-After. Preserve o mesmo corpo, source_event_id e occurred_at. Limite da API: 120 requisições/minuto/unidade.</dd>
        </dl>
        <p>Sem CTWA: marco interno, sem atribuição a anúncio. Sem destino válido: revisar source_id, acesso do token ao anúncio, WABA e versão Graph. Dataset manual é opcional; vazio permite descoberta. Testar leitura verifica WABA/dataset/número; leitura do anúncio é testada durante a descoberta.</p>
        <p>Antes de habilitar exportação na plataforma, desative o HTTP direto à Meta correspondente no n8n para não duplicar. Liberação real exige revisão de privacidade e piloto aprovado; não há backfill dos eventos recebidos em somente registro.</p>
      </details>
    </div>
  </>;
}

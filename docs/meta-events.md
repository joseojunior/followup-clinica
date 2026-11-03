# Rastreamento Uazapi → n8n → plataforma → Meta

O banco followup é o registro oficial, sem Google Sheets. A API não exige que o chat já exista nas tabelas-fonte. A tabela legada rastreio_whats.whatsapp_anuncio e seus consumidores não são modificados pela plataforma.

## Configuração

Em Eventos Meta, gere um token diferente por unidade (mostrado uma vez, armazenado como hash). No n8n use HTTPS e Authorization: Bearer TOKEN_DA_UNIDADE. O token identifica a unidade; divergência no corpo retorna 403. Login Supabase é necessário apenas para configurar o painel.

Token Meta é outra credencial: pode ser cadastrado no painel, criptografado, sem preencher WABA ou dataset. Esses dois campos foram removidos apenas da interface; salvar token não apaga IDs já existentes nem remove as validações do backend. Receber e armazenar eventos não depende desses IDs.

A exportação sem WABA ainda requer revisão técnica e de privacidade; não está habilitada por essa mudança de formulário. O servidor continua em META_EXPORT_MODE=record_only. Não reenvie eventos clínicos reais para validação de entrega. Qualquer futuro teste externo deve usar um cenário não sensível aprovado, sem CTWA de paciente.

AI_SETTINGS_ENCRYPTION_KEY protege tokens/CTWA e deriva o HMAC de telefone com domínio separado. Preserve a chave em backup seguro. Telefone puro não é armazenado. Chat usa hash separado por unidade. Telefone repetido em chats diferentes sinaliza revisão, nunca merge; telefone divergente no mesmo chat retorna 409.

## HTTP Request

POST https://followapi.leticiaatd.online/api/integrations/n8n/meta-events

Content-Type: application/json; Authorization: Bearer TOKEN; timeout 15 segundos.

```json
{
  "unit": "sender_1",
  "chat_id": "5511999999999@s.whatsapp.net",
  "phone": "+5511999999999",
  "event_type": "conversation_started",
  "occurred_at": "2026-11-03T12:00:00Z",
  "source_event_id": "ID_REAL_ESTAVEL_DA_MENSAGEM",
  "ctwa_clid": "CTWA_REAL_DO_REFERRAL",
  "source_id": "123456789012345"
}
```

Troque valores ilustrativos, inclusive horário. Unidade 2 usa sender_2 e outro token. Campos antigos sem phone/source_id continuam aceitos, mas não há descoberta/exportação sem anúncio. Não envie dataset, página, nome, e-mail, mensagem ou tratamento: campos extras são rejeitados.

No primeiro anexo: telefone = body.Payload.Content.Contact.PhoneNumber; CTWA = body.Payload.Content.LastMessage.Ad.CTWaCLId; anúncio = body.Payload.Content.LastMessage.Ad.SourceId. No outro formato: chat = body.data.key.remoteJid; ID de mensagem = body.data.key.id; timestamp = body.data.messageTimestamp (Unix em segundos: converter para ISO). O primeiro anexo não tem amostra dos IDs de chat/mensagem: mapeie os campos reais, não invente ID pela execução n8n.

Importe o exemplo docs/n8n/meta-events-http.json e alimente-o com os campos normalizados acima. Escolha Header Auth no n8n, nome Authorization, valor Bearer TOKEN. O arquivo não contém credenciais/pinData e não ativa workflows.

202 = registrado aqui, não entregue à Meta; 200 = duplicata. Corrija 400/403/409. Em rede/5xx repita o mesmo corpo, horário e source_event_id. Em 429 aguarde Retry-After. Limite: 120/min/unidade.

## Outros marcos

### Metadados opcionais no primeiro envio

No corpo conversation_started, pode acrescentar attribution:

```json
{
  "attribution": {
    "utm_source": "facebook",
    "utm_medium": "paid",
    "utm_campaign": "campanha_exemplo",
    "utm_content": "criativo_01",
    "utm_term": "publico_exemplo",
    "ad_title": "Título do anúncio",
    "source_url": "https://exemplo.com/anuncio",
    "thumbnail_url": "https://exemplo.com/imagem.jpg"
  }
}
```

É um fragmento para adicionar ao corpo, não uma requisição completa. O bloco inteiro e cada campo são opcionais; null/vazio é omitido. Sem o bloco, o contrato antigo continua válido. Não adicione attribution preenchido aos demais marcos. Campos desconhecidos/tipos inválidos retornam 400.

Armazenamento interno: followup.meta_events.attribution preserva o primeiro contato (inclusive orgânico sem CTWA); followup.meta_clicks.attribution preserva metadados do clique quando há CTWA. Um novo clique cria seu próprio histórico. Não sobrescrevemos metadados de um clique já capturado; retry deve manter o mesmo conteúdo/horário/IDs, ou retorna 409. Alterar a ordem das propriedades não altera a idempotência.

UTMs têm limite de 256 caracteres cada; título, 512; URLs, 2048, apenas HTTPS sem credenciais. Corpo total: até 16 KB em bytes. A plataforma não baixa thumbnails nem acessa source_url; não extrai UTMs automaticamente nem envia esses campos à Meta. Envie somente dados de marketing, nunca informações do paciente, tokens ou texto da conversa em UTMs/URLs.

No webhook dos anexos, Title/SourceUrl/ThumbnailUrl ficam em body.Payload.Content.LastMessage.Ad; o n8n pode mapeá-los para ad_title/source_url/thumbnail_url. UTMs devem vir de dados efetivamente disponíveis, não podem ser deduzidas do CTWA.

### Eventos posteriores

Envie unit/chat/phone, horário real, event_type e source_event_id estáveis. Remova ctwa_clid/source_id: usa o último clique anterior ao marco.

| Marco | event_type | source_event_id |
|---|---|---|
| Qualificação | lead_qualified | ID da mudança; se única por lead, chat + ":lead_qualified" |
| Agendamento | appointment_confirmed | id_agendamento |
| Pagamento interno | payment_confirmed | chat + ":payment_confirmed" |

Sem ID de transação não há Purchase/receita. Pagamento é somente um marco por chat; pagamentos múltiplos não são distinguidos. O parser “Negócio Fechado” pode emitir esse marco interno sem inferir compra automaticamente. Para idempotência de um marco único, persista também o horário original: retry não usa agora.

## Descoberta, entrega e corte

O worker faz GET /source_id?fields=tracking_specs, exige um único dataset e página nos arrays explícitos, e compara com GET /waba_id/dataset. Não escolhe o primeiro destino arbitrariamente. Ausência, ambiguidade ou permissão insuficiente fica registrada sem envio. Rede/429/5xx têm até cinco tentativas de descoberta. Salvar token/WABA e testar com sucesso permite repetir descobertas em revisão.

Descoberta faz somente GET inclusive em record_only. POST de eventos exige live, unidade/tipo aprovados e habilitados antes do acontecimento, identidade não ambígua e destino validado. Conversa/qualificação são candidatos a LeadSubmitted/QualifiedLead; agendamento/pagamento somente internos. Não há backfill dos acontecimentos recebidos em record_only. A Meta recebe CTWA/WABA, nunca ph/fn/ln/em ou texto clínico. Aceitação API não garante atribuição.

Preserve nós Postgres legados; adicione primeiro o HTTP da plataforma em paralelo, record_only, e compare contadores por unidade. Antes de qualquer live, desative os HTTP diretos à Meta correspondentes no n8n para não duplicar. A mudança para live exige revisão de privacidade e piloto aprovado. Não habilite Purchase nesta versão.

Se a apikey nos dados fixados do export for ativa, revogue/rotacione no provedor e remova pinData antes de compartilhar. Não copie credenciais dos anexos para o Git.

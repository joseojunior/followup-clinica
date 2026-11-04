# Rastreamento Uazapi → n8n → plataforma → Meta

O banco followup é o registro oficial, sem Google Sheets. A API não exige que o chat já exista nas tabelas-fonte. A tabela legada rastreio_whats.whatsapp_anuncio e seus consumidores não são modificados pela plataforma.

## Configuração

Em Eventos Meta, gere um token diferente por unidade (mostrado uma vez, armazenado como hash). No n8n use HTTPS e Authorization: Bearer TOKEN_DA_UNIDADE. O token identifica a unidade; divergência no corpo retorna 403. Login Supabase é necessário apenas para configurar o painel.

Token Meta é outra credencial: pode ser cadastrado no painel, criptografado, sem preencher WABA ou dataset. O diagnóstico de acesso a anúncio/Página/dataset também não depende de WABA. Salvar token não apaga IDs já existentes nem remove as validações do exportador. Receber e armazenar eventos não depende desses IDs.

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

#### Marcos operacionais internos

`payment_requested` registra a geração/envio do pedido de sinal e `payment_pending` registra um pagamento ainda não confirmado. Use o ID persistido da cobrança como source_event_id, o mesmo chat_id e o horário real de cada mudança. `payment_confirmed` registra somente a confirmação efetiva (use o ID da transação) e `appointment_confirmed` registra a confirmação da agenda (use o ID do agendamento). Não presuma pagamento pelo simples agendamento.

Esses quatro marcos ficam em internal_only mesmo sem CTWA e não consultam/copiam o histórico de cliques, nem preparam Purchase/AddToCart/InitiateCheckout, fila ou payload para a Meta. Os novos tipos têm bloqueios adicionais no banco contra habilitação e exportação. Os exemplos do guia omitem telefone para os marcos internos. Não há envio externo nem contabilização de receita nesta etapa: valores/transações detalhadas exigem uma implementação financeira interna separada.

Exemplo de pedido de sinal (substitua o horário e os identificadores):

```json
{
  "unit": "sender_1",
  "chat_id": "ID_INTERNO_DO_CHAT",
  "event_type": "payment_requested",
  "occurred_at": "2026-11-04T14:30:00Z",
  "source_event_id": "ID_DA_COBRANCA"
}
```

Envie unit/chat_id, horário real, event_type e source_event_id estáveis. phone é opcional e desnecessário nos exemplos internos. Remova ctwa_clid/source_id: somente a qualificação pode consultar o último clique; os marcos internos não o herdam.

| Marco | event_type | source_event_id |
|---|---|---|
| Qualificação | lead_qualified | ID da mudança; se única por lead, chat + ":lead_qualified" |
| Agendamento | appointment_confirmed | id_agendamento |
| Pedido de sinal | payment_requested | ID da cobrança |
| Pagamento pendente | payment_pending | ID da cobrança |
| Pagamento interno | payment_confirmed | ID da transação |

Esses registros não geram Purchase ou contabilização de receita. IDs reais de transação distinguem confirmações diferentes; repetir o mesmo ID/etapa não cria outra linha. Uma integração antiga que use chat + etapa continuará representando somente um marco por chat. Não infira pagamento a partir de “Negócio Fechado”. Preserve também o horário original: retry não usa agora.

## Descoberta, entrega e corte

### Diagnóstico de ativos sem WABA (somente leitura)

No painel Eventos Meta, escolha a unidade, salve seu token e clique em **Testar acesso aos ativos**. O ID do anúncio é opcional: vazio usa o último source_id capturado pelo n8n naquela unidade. Se preenchido, ele também precisa existir no histórico de cliques dessa unidade. Não existe consulta arbitrária de anúncios de outra unidade.

O servidor exige META_EXPORT_MODE=record_only e META_GRAPH_API_VERSION no formato vNN.N, com uma versão suportada pela Meta. O teste consulta apenas GET /me?fields=id, GET /source_id?fields=id,tracking_specs e GET /page_id?fields=id e GET /dataset_id?fields=id. Não exige WABA, não transmite CTWA/telefone/eventos e não cria datasets. Exige exatamente uma Página e um dataset nos arrays explícitos de tracking_specs; destinos ausentes ou ambíguos não são escolhidos.

O último relatório fica salvo em followup.meta_unit_settings.asset_validation, separado por unidade, com horário, versão, IDs, cada etapa e motivo de falha (token expirado, recurso sem acesso, destino ausente/ambíguo, rede, limite de consultas etc.). O trace lista método, caminho consultado, status, duração e, se houver, código/ID de rastreio da Meta; nunca guarda Authorization, token, corpo bruto ou perfil do /me. O resumo de tracking_specs mostra total de ocorrências, IDs distintos e duplicatas por tipo. IDs repetidos são consolidados e consultados apenas uma vez; IDs distintos permanecem explícitos no painel para revisão. Trocar token invalida o relatório; uma rotação durante o teste impede salvar o resultado antigo. A execução é auditada como test_assets_read_only.

“Acesso de leitura confirmado” comprova somente os IDs referenciados pelo anúncio e sua leitura com a credencial. **Não comprova propriedade, vínculo Página/número WhatsApp, suporte à exportação sem WABA, aceitação de eventos nem atribuição.** O teste não altera verified_at/verified_number, aprovações, habilitações, cliques ou a fila de eventos. O exportador existente continua separado e bloqueado pelas validações anteriores; nenhum resultado deste diagnóstico o libera.

### Exportador existente (não habilitado pelo diagnóstico)

O worker legado faz GET /source_id?fields=tracking_specs, exige um único dataset e página nos arrays explícitos, e compara com GET /waba_id/dataset. Não escolhe o primeiro destino arbitrariamente. Ausência, ambiguidade ou permissão insuficiente fica registrada sem envio. Rede/429/5xx têm até cinco tentativas de descoberta. O diagnóstico novo não executa nem libera essa descoberta e não preenche sua verificação de WABA/número.

Descoberta faz somente GET inclusive em record_only. POST de eventos exige live, unidade/tipo aprovados e habilitados antes do acontecimento, identidade não ambígua e destino validado. Conversa/qualificação são candidatos a LeadSubmitted/QualifiedLead; agendamento/pagamento somente internos. Não há backfill dos acontecimentos recebidos em record_only. A Meta recebe CTWA/WABA, nunca ph/fn/ln/em ou texto clínico. Aceitação API não garante atribuição.

Preserve nós Postgres legados; adicione primeiro o HTTP da plataforma em paralelo, record_only, e compare contadores por unidade. Antes de qualquer live, desative os HTTP diretos à Meta correspondentes no n8n para não duplicar. A mudança para live exige revisão de privacidade e piloto aprovado. Não habilite Purchase nesta versão.

Se a apikey nos dados fixados do export for ativa, revogue/rotacione no provedor e remova pinData antes de compartilhar. Não copie credenciais dos anexos para o Git.

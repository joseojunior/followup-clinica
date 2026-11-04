# Consultoria → Meta: testes e produção isolada

Esta área atende somente **novos agendamentos de consultoria não relacionados à saúde**, sem reutilizar registros antigos de dermatologia. Tabelas próprias: `followup.consulting_meta_settings` e `followup.consulting_meta_events`. Não há importação, consulta a leads antigos ou backfill. A captura começa na aplicação da migração 022; horários anteriores são rejeitados. Aplique as migrações até 024 antes do deploy: 023 adiciona metadados opcionais, 024 adiciona a fila e os controles de produção.

## Contrato do n8n

POST HTTPS `/api/integrations/n8n/consulting-events`, com `Authorization: Bearer TOKEN_DA_UNIDADE` (o token n8n existente daquela unidade, nunca o token Meta). Limite compartilhado de 120/min/unidade e corpo até 16 KB. `202` registra, `200` é duplicata, `403` é unidade divergente, `409` exige correção de identidade de evento/transação ou ausência de uma nova conversa. Retry de rede/5xx mantém corpo, horário e IDs originais. A resposta significa **registrado, não entregue à Meta**. `productionState` informa a elegibilidade/fila. Só há envio automático para unidade e tipo liberados, com conversa nova após o corte de produção.

Primeiro contato novo:

```json
{
  "context": "consulting_v1",
  "unit": "sender_1",
  "chat_id": "CHAT_NOVO_DE_CONSULTORIA",
  "event_type": "conversation_started",
  "source_event_id": "ID_REAL_DA_MENSAGEM_NOVA",
  "occurred_at": "2026-11-04T15:30:00Z",
  "ctwa_clid": "CTWA_DA_NOVA_CONVERSA",
  "source_id": "123456789012345",
  "phone": "+5511999999999",
  "name": "Nome Exemplo"
}
```

Substitua todos os exemplos. Identidade, anúncio e CTWA são opcionais no registro orgânico; sem CTWA o teste atribuído fica bloqueado. Phone/nome são aceitos só na nova conversa e armazenados apenas como hashes SHA-256; CTWA criptografado. Hashes são identificadores de correspondência, não anonimização. Não há e-mail, texto livre de conversa ou dados de saúde no contrato.

### Metadados opcionais para relatórios internos

Após aplicar a migração 023, acrescente opcionalmente `attribution` ao corpo de **conversation_started**:

```json
{
  "attribution": {
    "utm_source": "facebook",
    "utm_medium": "paid",
    "utm_campaign": "consultoria_exemplo",
    "utm_content": "criativo_exemplo",
    "utm_term": "publico_exemplo",
    "ad_title": "Título do anúncio de consultoria",
    "source_url": "https://example.com/anuncio",
    "thumbnail_url": "https://example.com/thumbnail.jpg"
  }
}
```

Este é somente o fragmento opcional, não uma requisição completa. O bloco inteiro e cada campo podem ser omitidos. Bloco null, vazio ou campos null/vazios são tratados como ausentes; o contrato e a idempotência das requisições antigas permanecem iguais. Campos preenchidos são aceitos somente na primeira conversa e guardados em `followup.consulting_meta_events.attribution` (JSONB), inclusive quando o contato é orgânico e não tem CTWA. `source_id` continua no local e com a regra anteriores, separado de attribution.

UTMs: até 256 caracteres cada; ad_title: 512; URLs: 2048, HTTPS sem credenciais no endereço. Não inclua informações pessoais, texto de conversa ou tokens. A plataforma só armazena as URLs; não baixa thumbnails, não acessa source_url e não deduz UTMs do CTWA. Nenhum campo desse bloco é enviado à Meta.

Os metadados aparecem no objeto do primeiro evento retornado por `GET /api/consulting-meta?unit=sender_1` para relatórios futuros. Os eventos seguintes mantêm o vínculo `conversation_id` à primeira conversa, sem exigir reenvio desse bloco. Não há novo dashboard nesta alteração. Retry deve preservar conteúdo, IDs e horário originais; mudar metadados no mesmo source_event_id retorna 409. A ordem dos campos não importa. Não há atualização retroativa nem mistura com as tabelas antigas.

| Momento real | event_type | Evento Meta |
|---|---|---|
| Nova conversa | conversation_started | LeadSubmitted |
| Interesse em agendar confirmado | lead_qualified | QualifiedLead |
| Pedido de pagamento efetivamente enviado | payment_requested | InitiateCheckout |
| Pagamento ainda pendente | payment_pending | Somente interno |
| Pagamento efetivamente confirmado | payment_confirmed | Somente interno; não duplica a compra |
| Consultoria agendada e sinal pago | appointment_confirmed | Purchase |

Os próximos marcos usam context, unit, chat_id, event_type, source_event_id e occurred_at, **sem reenviar CTWA/nome/telefone/anúncio**. Vinculam-se somente à conversa nova desta área, anterior ao marco. Agendamento para Purchase exige adicionalmente `deposit_paid: true`, `transaction_id` estável e `value` numérico opcional (padrão 50). BRL e produto “Sinal de agendamento de consultoria”. Não presuma pagamento pelo agendamento. O ID da transação é guardado como hash e impede duplicar Purchase em dois agendamentos na mesma unidade.

## Teste no painel

1. Escolha unidade, configure token Meta na área existente e confirme Graph `v26.0` no servidor. Mantenha `META_EXPORT_MODE=record_only`.
2. No bloco “Consultoria”, mantenha `TEST28037` ou substitua pelo código atual do Gerenciador. Pode informar Página e dataset/pixel manualmente para fallback. Não compartilhe credenciais entre unidades.
3. Registre uma conversa nova (preferencialmente um contato próprio de teste) e seus marcos. O formulário marca todos os registros como sintéticos. No n8n, envie `is_synthetic: true` para qualquer teste; omita ou use false somente em acontecimentos reais. Nunca use os placeholders do exemplo em produção. Prefixos test/teste/synthetic nos IDs de origem e o chat de exemplo também são excluídos automaticamente.
4. Marque a confirmação e clique **Enviar teste à Meta** para um registro elegível. A consulta ao anúncio deduplica IDs iguais; IDs distintos bloqueiam. IDs automáticos únicos têm prioridade. Só IDs ausentes usam fallback manual. Erros de permissão no anúncio não são mascarados por fallback.
5. O POST para `/{dataset_id}/events` contém `test_event_code` na raiz, `data` em array, business_messaging/whatsapp e page_id/CTWA/identidade com hash. Nenhuma WABA é inferida ou exigida nesta área. Compatibilidade é verificada pela resposta real, não presumida.
6. Consulte status HTTP, events_received, código de erro, fbtrace_id, duração e origem dos destinos no resultado. Compare com Eventos de Teste. Aceitação não garante atribuição, otimização ou ausência de restrições de conta.

**A Meta recebe os dados mesmo com test_event_code, e pode usá-los em mensuração/direcionamento. Não é sandbox isolada.** A ação exige confirmação explícita; não rode automaticamente em registros de terceiros sem a devida autorização. Esta implementação não disparou nenhum teste real durante o desenvolvimento.

Cada registro permite somente uma tentativa manual de teste, protegida contra duplo clique concorrente. Eventos elegíveis para produção não podem ser usados no botão de teste. Em timeout/erro inconclusivo o estado é unknown; em queda após início pode ficar sending. Confira o Gerenciador antes de reprocessar; não se presume deduplicação da Meta.

## Liberação de produção sem histórico

1. Mantenha `META_EXPORT_MODE=record_only`: isso bloqueia a área antiga. Configure **separadamente** `CONSULTING_META_PRODUCTION=enabled` no serviço web. Esse sinal sozinho não habilita nenhuma unidade.
2. Conclua os quatro testes (LeadSubmitted, QualifiedLead, InitiateCheckout e Purchase) na mesma unidade e no destino configurado. O painel exige aceite nos últimos sete dias, token e IDs de fallback salvos.
3. Confirme novos serviços sem saúde e clique em **Liberar envio automático nesta unidade**. A operação grava um novo `production_enabled_at`, habilita os quatro tipos e registra auditoria. Para a implantação autorizada da Unidade 1, a operação equivalente é `node scripts/activate-consulting.mjs --enable-unit1-new-only`, dentro do container web. Ela não habilita a Unidade 2 nem atualiza eventos antigos.
4. Só conversas **ocorridas e criadas depois desse instante**, com CTWA e sem marca sintética, poderão originar produção. O marco também precisa ser posterior ao corte da unidade e ao corte do tipo. Eventos anteriores, testes já enviados e todas as conversas anteriores continuam excluídos, inclusive os próximos marcos dessas conversas. Não há backfill.
5. O n8n deve inserir a nova conversa primeiro e aguardar seu registro antes dos marcos seguintes. Reenvios conservam `source_event_id`, corpo e horário. Nos testes, `is_synthetic: true` é herdado da primeira conversa pelos marcos seguintes, mesmo quando omitido.
6. O worker existente chama a ação interna `meta` a cada ciclo; ela processa a fila isolada da consultoria sem liberar a fila antiga. Payload de produção: `{ "data": [...] }`, sem test_event_code, ID estável `consulting-live:<uuid>`, mesmos hashes e CTWA da conversa armazenada. Metadados internos nunca entram no payload.
7. Pausar a unidade ou um tipo exclui sua fila pendente. Reativar cria novo corte e não recupera filas antigas. Página/dataset só podem ser trocados enquanto a unidade estiver pausada. Uma chamada já iniciada à Meta pode terminar depois da pausa.

Estados: `excluded` (fora do corte/teste/desativado), `internal` (sem mapeamento), `no_ctwa`, `queued`, `preparing`, `sending`, `accepted`, `failed` e `unknown`. Consultas GET ao anúncio podem repetir falhas transitórias até cinco tentativas. POST só repete rejeição explícita HTTP 429 sem eventos recebidos, no máximo três tentativas e sempre com o mesmo event_id. Timeout, 5xx ou entrega inconclusiva ficam em revisão, **sem reenvio automático**. Tentativas persistidas em `followup.consulting_meta_delivery_attempts`; respostas sanitizadas, sem token/CTWA/identidade.

Antes de encerrar a implantação, confira: Unidade 1 ativa com corte atual, Unidade 2 desativada, zero eventos anteriores/sintéticos elegíveis, zero histórico enfileirado e modo legado ainda record_only. Não crie um novo teste na fila de produção para verificar entrega. Acompanhe o próximo acontecimento real posterior ao corte no painel e no Gerenciador da Meta.

Referências: [CAPI Business Messaging](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/), [test_event_code](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/).

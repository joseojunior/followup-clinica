# Consultoria → Meta: homologação separada

Esta área atende somente **novos agendamentos de consultoria não relacionados à saúde**, sem reutilizar registros antigos de dermatologia. Tabelas próprias: `followup.consulting_meta_settings` e `followup.consulting_meta_events`. Não há importação, consulta a leads antigos ou backfill. A captura começa na aplicação da migração 022; horários anteriores são rejeitados. Migrações 021 e 022 devem ser aplicadas antes do deploy.

## Contrato do n8n

POST HTTPS `/api/integrations/n8n/consulting-events`, com `Authorization: Bearer TOKEN_DA_UNIDADE` (o token n8n existente daquela unidade, nunca o token Meta). Limite compartilhado de 120/min/unidade e corpo até 16 KB. `202` registra, `200` é duplicata, `403` é unidade divergente, `409` exige correção de identidade de evento/transação ou ausência de uma nova conversa. Retry de rede/5xx mantém corpo, horário e IDs originais. Isso **não envia automaticamente à Meta**.

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
2. No bloco “Consultoria · somente testes”, mantenha `TEST28037` ou substitua pelo código atual do Gerenciador. Pode informar Página e dataset/pixel manualmente para fallback. Não compartilhe credenciais entre unidades.
3. Registre uma conversa nova (preferencialmente um contato próprio de teste) e os marcos reais. O formulário cria apenas registro interno.
4. Marque a confirmação e clique **Enviar teste à Meta** para um registro elegível. A consulta ao anúncio deduplica IDs iguais; IDs distintos bloqueiam. IDs automáticos únicos têm prioridade. Só IDs ausentes usam fallback manual. Erros de permissão no anúncio não são mascarados por fallback.
5. O POST para `/{dataset_id}/events` contém `test_event_code` na raiz, `data` em array, business_messaging/whatsapp e page_id/CTWA/identidade com hash. Nenhuma WABA é inferida ou exigida nesta área. Compatibilidade é verificada pela resposta real, não presumida.
6. Consulte status HTTP, events_received, código de erro, fbtrace_id, duração e origem dos destinos no resultado. Compare com Eventos de Teste. Aceitação não garante atribuição, otimização ou ausência de restrições de conta.

**A Meta recebe os dados mesmo com test_event_code, e pode usá-los em mensuração/direcionamento. Não é sandbox isolada.** A ação exige confirmação explícita; não rode automaticamente em registros de terceiros sem a devida autorização. Esta implementação não disparou nenhum teste real durante o desenvolvimento.

Não há worker para esta área, alteração de políticas antigas ou botão que habilite produção. O botão de produção permanece desativado e o banco exige test_only=true. Cada registro permite somente uma tentativa de teste, protegida contra duplo clique concorrente. Em timeout/erro inconclusivo o estado é unknown; em queda após início pode ficar sending. Verifique o Gerenciador antes de qualquer reprocessamento manual: a integração não assume deduplicação da Meta nem repete requisições automaticamente.

Referências: [CAPI Business Messaging](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/), [test_event_code](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/).

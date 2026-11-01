# Eventos WhatsApp → Meta

## Estado inicial

A integração começa em `META_EXPORT_MODE=record_only`. Nenhum evento é enviado à Meta nesse modo, mesmo que uma unidade/tipo esteja marcado como habilitado. A migração `017_meta_events.sql` cria configurações por unidade, histórico de CTWA, eventos, tentativas, limite de entrada e auditoria. Eventos anteriores à migração permanecem internos; não há backfill.

Para permitir configuração no painel, defina `META_ADMIN_EMAILS` com os e-mails dos administradores autenticados pelo Supabase, separados por vírgula. Defina também `AI_SETTINGS_ENCRYPTION_KEY` (32 bytes em base64), `META_GRAPH_API_VERSION` vigente e `META_INGEST_PUBLIC_URL` HTTPS. Sem allowlist, alterações administrativas são negadas. O token Meta é criptografado no banco; o token de entrada n8n é gerado pelo painel, armazenado como hash e mostrado uma única vez.

## Nó HTTP Request no n8n

Crie uma credencial Bearer **diferente para cada unidade** em **Eventos Meta → Guia do n8n**. Use `POST` para `META_INGEST_PUBLIC_URL`, corpo JSON, `Content-Type: application/json` e timeout de 15 segundos. O token determina a unidade; um corpo com unidade diferente recebe `403`.

```json
{
  "unit": "sender_1",
  "chat_id": "ID_DO_CHAT_NA_FONTE",
  "event_type": "conversation_started",
  "occurred_at": "2026-11-01T14:30:00Z",
  "source_event_id": "ID_ESTAVEL_DA_PRIMEIRA_MENSAGEM",
  "ctwa_clid": "CTWA_CLID_DO_REFERRAL"
}
```

Use `sender_2` para a Unidade 2. Coloque o nó após persistir a primeira mensagem/referral (`conversation_started`), após confirmar a qualificação (`lead_qualified`), após confirmar o agendamento (`appointment_confirmed`) e após marcar o pagamento (`payment_confirmed`). `ctwa_clid` é aceito somente na primeira mensagem. Em agendamento, `source_event_id` **deve** ser o `id_agendamento` da fonte. Nas demais etapas, escolha um ID de mudança de negócio estável; nunca o ID da execução do n8n. Não envie nome, telefone, tratamento, conteúdo da conversa, nem token Meta.

`202` significa registrado **na plataforma**, não entregue à Meta; `200` é duplicata idempotente. Corrija `400`, `403`, `404` e `409`. Repita falhas de rede, `429` e `5xx` com o mesmo `source_event_id`, respeitando `Retry-After` em `429`. Há limite de 120 requisições/minuto por token. A lista no painel mostra o estado após a ingestão e as tentativas do worker.

## Privacidade e piloto

As quatro etapas aparecem no funil. `payment_confirmed` e `appointment_confirmed` são apenas internas nesta versão. `conversation_started` e `lead_qualified` são candidatas, mas começam desabilitadas. Antes de habilitar um tipo, revise os dados e os [Termos das Ferramentas de Negócios da Meta](https://www.facebook.com/legal/technology_terms) para o contexto clínico; a aprovação no painel registra usuário e horário, mas não substitui a avaliação. Em seguida, teste os IDs e o número da WABA; só então habilite unidade e tipo. O teste de configuração é de leitura e não envia conversão.

Para o piloto técnico, altere `META_EXPORT_MODE=live` **somente após** aprovação de privacidade e autorização operacional. Use um novo caso consentido e aprovado. O worker envia para `/{dataset_id}/events` com `action_source=business_messaging`, `messaging_channel=whatsapp`, `ctwa_clid` bruto em `user_data` e `whatsapp_business_account_id`. `LeadSubmitted` e `QualifiedLead` são os únicos nomes exportáveis nesta versão. O mesmo UUID de evento é reutilizado em retries; uma interrupção após aceitação pode causar reenvio, por isso a verificação no Gerenciador de Eventos é indispensável. O painel registra `events_received` e `fbtrace_id` como **aceitação da API**, não atribuição de campanha.

Compare o número de alterações no n8n com os eventos recebidos na plataforma e os eventos aceitos no Gerenciador de Eventos. Revise falhas permanentes antes de clicar em **Reprocessar**. Um novo clique no mesmo chat é associado pelo horário do evento; quando só existir o CTWA atual na fonte, o painel indica “CTWA da fonte”.

# Controle operacional de follow-up

## Estados

`enrollments` controla o ciclo do lead:

- `active`: pode ser enfileirado.
- `pending_data`: falta telefone ou requisito essencial.
- `paused`: foi pausado pelo admin, resposta recebida ou falha definitiva.
- `blocked`: revalidação detectou agendamento, transferência ou origem indisponível.
- `completed`: recebeu a última etapa.

`messages` controla cada tentativa: `scheduled`, `sending`, `sent`, `failed` ou `cancelled`.

## Gatilhos e worker

O worker protegido por `WORKER_API_KEY` possui três ações:

1. `enroll`: inclui leads elegíveis em campanhas ativas com `auto_enroll` ligado.
2. `queue`: revalida o lead na tabela fonte e cria uma mensagem idempotente para a etapa vencida.
3. `dispatch`: revalida novamente e envia ou simula o disparo.

O endpoint interno é `POST /api/internal/control`, com header `x-worker-key`. Nunca o exponha sem esse segredo.

## Proteções

- A fonte é consultada antes de enfileirar e antes de disparar.
- `agendado = true` ou `transferido = true` bloqueiam a inscrição local.
- A chave `enrollment:step` impede duplicidade.
- Falhas fazem retentativa exponencial; no limite, o lead é pausado.
- `FOLLOWUP_SEND_MODE=dry_run` simula todo o fluxo e não chama a UazAPI.
- O webhook UazAPI grava o evento e pausa inscrições ativas quando identifica mensagem recebida.

## Antes do envio real

1. Configure `WORKER_API_KEY` e `UAZAPI_WEBHOOK_SECRET` em `.env.local` e no ambiente de produção.
2. Aponte o webhook de cada unidade para `/api/webhooks/uazapi/sender_1` e `/api/webhooks/uazapi/sender_2`, enviando o segredo no header `x-webhook-secret`.
3. Execute uma campanha em `dry_run` e confira `followup.messages`, `followup.provider_events` e `followup.audit_log`.
4. Só então mude para `FOLLOWUP_SEND_MODE=live` para um piloto pequeno e autorizado.

# Correção da precisão da ativação

## Causa

`production_enabled_at` é timestamptz com microssegundos. O driver pg o convertia em Date JavaScript (milissegundos); a ingestão gravava esse Date como `production_activation_at`. A igualdade exata de geração do worker falhava, excluindo eventos elegíveis antes de qualquer consulta ao anúncio ou POST à Meta.

## Correção

A ingestão lê adicionalmente `production_enabled_at::text` sob o lock compartilhado existente e usa esse texto como parâmetro timestamptz no INSERT. A cópia da ativação para as políticas também acontece diretamente no PostgreSQL. Não há truncamento da configuração, tolerância na igualdade, mudança do corte ou liberação de histórico.

Regressões cobrem precisão submilissegundo, exclusão de sintéticos, cópia das políticas sem round-trip Date e recuperação transacional. A correção não precisa de migração.

## Recuperação excepcional

O script `scripts/recover-consulting-activation.mjs` exige `--dry-run` ou `--apply`, a ativação exata com seis casas decimais em UTC e exatamente dois UUIDs distintos explicitamente autorizados. Não é um reprocessador genérico nem um mecanismo de backfill.

Exemplo estrutural (substituir somente com IDs e ativação aprovados):

```text
node scripts/recover-consulting-activation.mjs --dry-run ATIVACAO_EXATA_UTC UUID_APROVADO_1 UUID_APROVADO_2
node scripts/recover-consulting-activation.mjs --apply ATIVACAO_EXATA_UTC UUID_APROVADO_1 UUID_APROVADO_2
```

Aplicar somente depois de publicar a ingestão corrigida. O script exige Unidade 1 ativa, legado record_only, política ativa, conversa nova com CTWA posterior ao corte e dentro de sete dias. Só aceita `excluded` com o motivo específico do bug, marcador de geração igual ao truncamento de milissegundos da ativação atual, nenhuma tentativa de produção ou preflight e nenhum registro de tentativa durável. Não aceita testes, históricos anteriores, failed, unknown, sending ou eventos já recuperados.

Se ambos não forem elegíveis, rollback integral. Se forem, corrige apenas a marca de ativação, recoloca os dois na fila e registra auditoria individual. Não muda CTWA, hashes, payload de entrada, horário original, source_event_id ou UUID/event_id. O script não chama a Meta: o worker normal faz o envio e registra o resultado. Um POST inconclusivo continua sem repetição automática.

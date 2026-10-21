# Acesso ao banco fonte

O sistema de follow-up precisa de uma credencial PostgreSQL exclusiva, com leitura apenas na tabela de leads. A aplicação não executa `INSERT`, `UPDATE`, `DELETE` ou DDL no banco fonte.

## Usuário recomendado

Execute no banco principal como administrador, substituindo a senha fora de repositórios e conversas:

```sql
CREATE ROLE followup_reader LOGIN PASSWORD 'defina-uma-senha-segura';
GRANT CONNECT ON DATABASE nome_do_banco TO followup_reader;
GRANT USAGE ON SCHEMA public TO followup_reader;
GRANT SELECT ON TABLE public.usuarios_sdr TO followup_reader;
GRANT SELECT ON TABLE public.usuarios_sdr_clinica_nova TO followup_reader;
GRANT SELECT ON TABLE public.n8n_chat_histories TO followup_reader;
```

O último `GRANT` é opcional e somente será usado quando uma etapa optar por personalização por IA.

## Política de validação

O worker relê o lead pelo `chat_id` e pela fonte correta imediatamente antes de enviar. Ele cancela a mensagem local e bloqueia a cadência se encontrar `agendado = true`, `id_agendamento` preenchido, `status_conversa` indicando agendamento/encerramento/desqualificação/encaminhamento humano/tratamento ou `status_qualificacao = qualificado_agendado`/`desqualificado`. `transferido = true` também bloqueia. Nenhuma coluna em `public.usuarios_sdr*` é modificada.

`tratamento_principal` descreve o procedimento de interesse, não comprova que o paciente já está em tratamento. O status genérico `em_atendimento` também pode ser uma conversa ativa com um lead de follow-up; por isso não é tratado como prova de tratamento. Para bloquear com certeza pacientes já em tratamento, o n8n ou a clínica deve registrar um status explícito como `em_tratamento` na fonte.

## Observação sobre respostas

As tabelas apresentadas não têm um campo explícito de "lead respondeu". Na primeira versão, a pausa automática é garantida para agendamento e transferência. A regra de resposta será conectada quando for confirmado qual campo/evento da fonte representa uma nova mensagem do lead.

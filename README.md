# Follow-up Clínica

Sistema independente para configurar cadências de follow-up por campanha e enviar mensagens pelos dois números de WhatsApp.

## Princípios

- O banco do sistema principal é somente leitura.
- A agenda, conteúdo, logs e pausas vivem exclusivamente no schema `followup`.
- Uma mensagem só é enviada após validação do estado atual do lead.
- Cada tentativa usa idempotência para evitar duplicidade.

## Desenvolvimento

1. Preencha as URLs de conexão apenas em `.env.local` (o arquivo já é ignorado pelo Git).
2. Valide o acesso: `npm run config:check`.
3. Crie o schema próprio do follow-up: `npm run db:migrate`.
4. Informe os tokens das Unidades 1 e 2 em `.env.local` e rode `npm run senders:sync`.
5. Rode `npm run dev`.

Em outro terminal do Windows, mantenha o processador de horários ativo:

```powershell
npm run worker:run
```

O banco guarda `next_send_at` em UTC. O worker verifica vencimentos a cada 15 segundos
(configurável por `WORKER_POLL_MS`) e respeita fuso, dias e janela de envio da campanha.

O painel inicial usa dados demonstrativos até a conexão do banco ser configurada.

Consulte [o controle operacional](docs/operation-control.md) antes de ativar qualquer envio real.

## Leads do banco e CSV

- Em **Leads**, selecione a unidade e use **Sincronizar banco**. A operação lê `public.*`,
  mas grava somente no catálogo `followup.leads`.
- Para listas externas, importe CSV com `nome,telefone,email,data_referencia`.
  Vírgula e ponto e vírgula são aceitos; `telefone` é obrigatório.
- Banco e CSV aparecem separados. Selecione uma campanha ativa e clique em **Incluir**
  para calcular o primeiro `next_send_at`. Importar não envia mensagens automaticamente.

## Controle de follow-up

A tabela `followup.lead_followup_control` mantém um registro por lead:

- `source_last_message_at`, `source_created_at` e `anchor_at`: datas observadas na fonte;
- `source_stage` e `source_legacy_stage`: estágios espelhados do sistema principal;
- `control_stage`, `control_status` e `followup_count`: execução deste sistema;
- `last_followup_at`, `next_followup_at` e `last_message_id`: comprovação e agenda.

A sincronização pode atualizar os campos `source_*`, mas nunca aumenta `followup_count`.
Esse contador só aumenta quando uma mensagem do nosso histórico termina com estado `sent`.

## Teste de campanha

Na lista de campanhas, use **Testar** para escolher:

- número destinatário com DDI e DDD;
- número remetente da Unidade 1 ou Unidade 2;
- etapa e variação de conteúdo;
- nome usado na personalização da mensagem.

Os testes são registrados em `followup.campaign_test_runs` e não criam lead,
não avançam estágio e não entram nas métricas oficiais. Em `dry_run`, o teste é
somente simulado. Em `live`, a interface e a API exigem confirmação explícita.

## Biblioteca de conteúdos e Supabase Storage

- A migração `011_content_library.sql` cria o catálogo `followup.library_items` e o bucket público
  `followup-library` com limite de 10 MB por arquivo.
- Somente usuários autenticados podem enviar, substituir ou excluir arquivos; a leitura é pública
  para que o provedor de WhatsApp consiga recuperar a mídia pela URL.
- A Biblioteca aceita texto, PNG, JPG, WEBP e GIF. Ao montar uma campanha, use o seletor
  **Usar conteúdo da biblioteca** para copiar texto e mídia para a etapa.
- Arquivar um item remove-o do catálogo, mas preserva o arquivo e as campanhas que já o utilizam.

## Duas fontes de leads

Cada fonte possui campanhas, inscrições, conteúdo e número remetente próprios:

- `usuarios_sdr` → `public.usuarios_sdr`
- `clinica_nova` → `public.usuarios_sdr_clinica_nova`

As duas podem usar o mesmo Supabase; nesse caso, configure a mesma URL de leitura nas duas variáveis de ambiente. O número de cada unidade será obtido da conexão UazAPI vinculada ao token, não digitado manualmente.

O usuário do banco fonte deve ter somente `SELECT` nessas tabelas e, opcionalmente, em `public.n8n_chat_histories`.
## Docker e Portainer

O arquivo `docker-compose.portainer.yml` sobe dois serviços da mesma imagem:

- `web`: painel e API na porta 3000;
- `worker`: agenda e processa a fila, sem expor porta.

No Portainer, crie uma Stack usando esse arquivo e cadastre as variáveis do `.env.example`
na área de variáveis da Stack. Não envie `.env.local` para a imagem. As variáveis
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` também precisam ser
informadas como Build arguments da Stack, pois são usadas pela tela de login.

### Docker Swarm

Para Docker Swarm, use `docker-stack.swarm.yml`. Ele cria `followup_web`,
`followup_worker` e um job `followup_migrate`, todos na rede overlay externa
`LeticiaAtdNet`, com Traefik somente no serviço web.

Antes de criar a Stack, publique a imagem no registry que todos os nós do Swarm
conseguem acessar e defina `FOLLOWUP_IMAGE`, por exemplo
`ghcr.io/sua-organizacao/followup-clinica:1.0.0`. Cadastre também
`FOLLOWUP_APP_HOST`, `FOLLOWUP_API_HOST` e as demais variáveis do `.env.example`
no Portainer. Não coloque tokens ou senhas
diretamente no YAML.

O workflow `.github/workflows/publish-container.yml` publica automaticamente no GHCR
após cada push na `main`. Configure no repositório as Actions Variables
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; a imagem será
publicada como `ghcr.io/joseojunior/followup-clinica:latest`.

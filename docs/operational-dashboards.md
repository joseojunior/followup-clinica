# Dashboards operacionais

## Visão geral

A tela inicial reúne cadências, capacidade de envio das unidades, campanhas e um resumo da consultoria na Meta. O modo real/simulação vem de `FOLLOWUP_SEND_MODE`, não de um texto fixo. Os indicadores mostram explicitamente sua abrangência: envios de cadência hoje (Brasília), fila atual, follow-ups acumulados e inscrições com pendências. Os limites por unidade incluem também disparos únicos e usam o fuso configurado de cada remetente.

O gráfico de 7/30 dias separa enviados, falhas e simulados. Enviados usam `sent_at`; falhas/simulações usam a última atualização do registro, não uma série histórica imutável de todas as tentativas. Clicar no dia filtra as últimas movimentações, sem alterar os indicadores acumulados. Não inclui disparos únicos. O filtro de campanhas é local sobre a lista carregada. Os atalhos abrem as telas correspondentes; não ativam campanhas, reconectam números ou reprocessam mensagens.

O resumo Meta usa somente eventos reais da área de consultoria nos últimos sete dias. n8n e VPS são atalhos, não indicadores de saúde presumidos.

## Eventos Meta

A navegação separa Acompanhamento, Configuração e testes, Integração n8n e Registros anteriores. A área anterior preserva suas ações e seu endpoint; seus registros não se somam à consultoria. O novo guia usa `/api/integrations/n8n/consulting-events`, o contexto consulting_v1 e os mapeamentos atuais, com JSON e cURL copiáveis. Os exemplos começam com `is_synthetic=true`.

`GET /api/consulting-meta/dashboard` exige sessão autenticada e não modifica dados. Filtros aceitos:

- `unit`: all, sender_1 ou sender_2;
- `days`: 1 (hoje), 7, 30 ou 90, por dias de calendário em Brasília;
- `scope`: real (padrão) ou tests, nunca os dois somados;
- `status`: all, accepted, pending, attention, no_ctwa, excluded ou internal;
- `stage`: all ou uma das seis etapas;
- `day`: YYYY-MM-DD válido;
- `search`: até 100 caracteres, por ID de evento, referência mascarada ou ID do anúncio;
- `page`: a partir de 1, até 4.000, com 25 registros por página.

Totais, série diária, etapas e origens usam o período completo no banco. Estado, etapa, dia e busca filtram a lista, não mudam os gráficos gerais: os filtros ativos aparecem acima dos registros. Paginação ocorre depois da agregação. Requisições anteriores são canceladas quando os filtros mudam, evitando respostas antigas sobrescreverem a seleção atual.

Eventos reais são os não marcados como sintéticos e ainda não utilizados em teste. Eventos de teste usam `test_state`; reais usam `production_state`. Recebido pela Meta significa resposta confirmada da API, não atribuição ou otimização garantidas. `attention` inclui falha e entrega inconclusiva. `pending` inclui fila/validação/envio e, em testes, registros prontos para teste. Sem CTWA é uma contagem transversal e pode sobrepor outros estados. O valor dos sinais soma somente agendamentos aceitos na API, no ambiente selecionado, não receita conciliada ou previsão de faturamento.

As etapas contam conversas únicas por unidade em cada etapa no período, não conversão por coorte. A evolução é agrupada pela data do acontecimento, não pelo dia de aceite da Meta. Origens mostram até oito combinações mais frequentes de unidade, anúncio e utm_campaign. Um marco posterior herda os metadados de sua conversa; ausência de UTM não é preenchida artificialmente. Nenhuma thumbnail/URL é acessada pelo dashboard.

Detalhes exibem referências mascaradas, metadados internos e respostas já sanitizadas; não retornam CTWA bruto, hashes de identidade ou tokens. Não há botão de envio/reprocessamento no acompanhamento. Os controles continuam na configuração, com confirmação para pausar a fila e para rotacionar a chave n8n.

## Verificação desta atualização

Testes de filtros, datas, separação real/teste, guia por etapa/unidade e cópia de cURL; typecheck e build. Smoke de 13 consultas reais em transação `READ ONLY`, com rollback e sem dados de contato nos logs. Teste de navegador desktop 1440/mobile 390 com APIs simuladas: filtros, paginação, detalhes, campanhas, estados vazio/erro/retry e navegação, sem erros JavaScript ou escritas de API. Capturas de QA têm dados ilustrativos, não resultados de produção.

Esta alteração não muda o worker, as políticas de envio ou o corte de ativação. Não requer nova migração além das 023/024 já aplicadas. Publicação da interface é uma operação separada.

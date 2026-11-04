---
version: 1
slug: "components-meta-events-panel-tsx"
primary_target: "components/meta-events-panel.tsx"
related_targets: ["components/consulting-meta-panel.tsx","components/consulting-events-dashboard.tsx","components/operational-overview.tsx","components/followup-dashboard.tsx"]
---

# Eventos Meta · extensão da tela existente

Modo: Operate. Gestor acompanha eventos do n8n, entende fila/falhas e consulta testes sem confundi-los com produção. O usuário confirmou também a Visão geral: mostrar operação, campanhas, capacidade das unidades e atalhos sem inventar estados de n8n/VPS. Preservar regras de envio, autenticação, isolamento por unidade e a identidade atual.

## Direction contract

THESIS: acompanhamento primeiro, manutenção sob demanda. A tela deixa de exigir leitura de formulários para descobrir o estado dos envios.

OWN-WORLD: herdar teal #0c716e, ink #163336, canvas #edf1ec, superfícies brancas e fontes existentes. Dados e controles em sans; títulos serifados com moderação, sem novo hero.

STORY: escolher unidade/período/ambiente, ler recebimentos e pendências, clicar no gráfico/etapa/estado para investigar um evento e seu trace. Configurações, testes e integração ficam em abas separadas; histórico anterior nunca se soma à consultoria.

FIRST VIEWPORT: Eventos Meta traz navegação de tarefas, filtros, estado por unidade e faixa compacta de indicadores. Abaixo, evolução diária ao lado das etapas; registros pesquisáveis em seguida. A Visão geral mostra modo real/simulação do servidor, fila e pendências, com processamento diário e capacidade das linhas. Atualizar é a ação principal, sem botões de envio nos dashboards.

FORM: refinamento e extensão de superfície existente, composição operacional definida pelo escopo; sem concept-seed ou troca de mundo visual. Interação assinatura: seleção de barras/etapas atualiza a lista e exibe filtros removíveis. Sem animação de entrada; mudanças de estado discretas e acessíveis.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Verificação: desktop 1440 e mobile 390, estados vazio/carregando/erro, filtros, paginação e cópia de exemplos. Nenhum evento será enviado como parte do QA. Extensão não cria nem substitui DESIGN.md global.

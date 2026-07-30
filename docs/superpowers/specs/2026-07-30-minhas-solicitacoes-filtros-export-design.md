# Filtros + Exportação na aba "Minhas Solicitações"

**Projeto:** `solicitação-manuntenções` (projectId `solicitação-manuntenções`)
**Data:** 2026-07-30

## Objetivo

Levar para a aba pública **"Minhas Solicitações"** (`#login-section`, busca por CPF) a
mesma capacidade de **filtragem/ordenação** e **exportação completa** que hoje só existe na
área administrativa. Assim o solicitante, após buscar seus pedidos pelo CPF, pode organizar
os resultados na tela e exportar um relatório (CSV / Excel / PDF), com um popup que pergunta
o recorte desejado (status — concluídas ou não —, período, prioridade).

## Estado atual

- `buscarPedidos()` consulta por CPF e guarda os resultados em `allPedidosUser`, renderizando
  cards via `gerarCardPedido()` em `#pedidos-cards`.
- A área admin já possui: `filter-bar` inline (status/prioridade), modal `#modal-exportar`
  (`abrirModalExportar`) com período rápido + intervalo custom + filtros + prévia de contagem,
  e `exportarCSV` / `exportarExcel` operando sobre `allSolicitacoes`.
- Funções reaproveitáveis já genéricas: `prepararDadosExport(registros)`, `formatarDataArquivo()`,
  `formatarCPF()`, `parsearComentarios()`, `escapeHtml()`.
- CDNs já carregados: XLSX. **Falta jsPDF + jspdf-autotable** para o PDF.

## Decisões (aprovadas)

1. **Filtros + ordenação inline** na aba do usuário (status, período, ordenar por data/prioridade).
2. Popup de exportação oferece **CSV + Excel + PDF**.
3. Popup usa **seletor de status completo** (Todas / Em Andamento / Realizadas / Sem Solução).
4. PDF é uma **tabela simples** (título, data, prioridade, status) — sem imagens/comentários.
5. Ordenação inline inclui **prioridade** além de data.

## Componentes

### 1. Barra de filtros inline (`#login-section`)
Inserida dentro de `#pedidos-lista` (só visível quando há resultados). Reutiliza a classe
`filter-bar`. Campos:
- `#user-filtro-status` — Todas / Em Andamento (`pendente`) / Realizadas (`realizado`) / Sem Solução (`sem-solucao`)
- `#user-filtro-periodo` — Todo período / Hoje / Semana / Mês / Personalizado (mostra `#user-periodo-range` com `#user-data-de` / `#user-data-ate`)
- `#user-ordenar` — Data ↓ (recente) / Data ↑ (antiga) / Prioridade
- Botão **Exportar** → `abrirModalExportarUser()`
- Contador `#user-count-info` ("X de Y solicitações")

`onchange` de cada campo → `renderizarPedidosUser()`.

### 2. Modal `#modal-exportar-user`
Clona o visual de `#modal-exportar` (classes `modal-box--export`, `export-*`), com IDs próprios:
`export-user-quick-btn` (data-range), `#export-user-date-range`, `#export-user-data-de/ate`,
`#export-user-filtro-status`, `#export-user-filtro-prioridade`, `#export-user-count`,
`#btn-export-user-csv/excel/pdf`. Botões de formato: CSV, Excel, PDF.

### 3. JS — refactor leve para reúso
Generalizar a lógica de intervalo/filtragem para receber a fonte e os IDs:
- `obterIntervaloDeCampos(rangeMode, idDe, idAte)` — extraído de `obterIntervaloExport()`.
- `filtrarRegistros(fonte, { inicio, fim, status, prioridade })` — núcleo compartilhado.
- Admin (`filtrarParaExport`) e usuário (`filtrarPedidosUser`) chamam o núcleo.

Novas funções:
- `renderizarPedidosUser()` — aplica filtros/ordenação da barra sobre `allPedidosUser` e
  re-renderiza `#pedidos-cards` + atualiza contador.
- `abrirModalExportarUser()` / `fecharModalExportarUser()`
- `aplicarFiltroRapidoUser(btn, range)`
- `atualizarPreviewExportUser()`
- `filtrarParaExportUser()` — usa os campos do modal-user sobre `allPedidosUser`.
- `exportarUserCSV()` / `exportarUserExcel()` / `exportarUserPDF()`.

`exportarUserPDF()`: jsPDF + autotable; cabeçalho "Minhas Solicitações — CPF <formatado>",
data de geração, tabela com colunas #, Título, Data/Hora, Prioridade, Status.
Nome do arquivo: `minhas_solicitacoes_<AAAAMMDD_HHMM>.<ext>`.

### 4. Wiring
- Fechar modal-user por clique no overlay e Esc (adicionar aos handlers globais existentes).
- 2 tags `<script>` CDN (jsPDF + jspdf-autotable) no `index.html` antes de `js/app.js`.

## Ordenação por prioridade
Mapa de peso: `critico=3, medio=2, basico=1`; ordena desc.

## Segurança / escopo
- Opera só sobre `allPedidosUser` (já restrito ao CPF buscado). Nenhuma leitura ampla nova,
  nada gravado. Nenhuma regra Firebase muda.
- Toda renderização reusa `gerarCardPedido()` (já com escapes) e `escapeHtml()`.
- Sem guards JS por role (é aba pública de consulta por CPF).

## Arquivos alterados
- `projetos/solicitação-manuntenções/index.html` — barra de filtros, modal-user, 2 CDNs.
- `projetos/solicitação-manuntenções/js/app.js` — funções novas + refactor de export.
- `projetos/solicitação-manuntenções/css/style.css` — ajustes mínimos (provável nenhum).

## Fora de escopo (YAGNI)
- PDF com imagens/comentários.
- Filtros/export na aba de cadastro ou no admin (admin já tem).
- Persistir preferências de filtro.

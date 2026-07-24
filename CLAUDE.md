# HubAudicom — Convenções do Projeto

## Stack
- Firebase Auth + Firestore (sem backend próprio)
- Vanilla JS + HTML/CSS (sem frameworks)
- FontAwesome 6 para ícones

## Roles
| role | pode fazer |
|---|---|
| `user` | acessa os projetos liberados em `projects`; dentro de cada projeto, o que pode fazer é definido pelas **permissões granulares** (`users/{uid}.permissions`) |
| `admin` | acesso total a tudo, **incluindo apagar permanentemente** |
| `superadmin` | idem admin + papel irrevogável, gerencia admins e cria usuários admin |

## Modelo de segurança

**Firebase Rules** (`firebase.rules`, publicadas manualmente pelo Console — não há Firebase CLI/`firebase.json` no repo): o acesso ao Firestore **não** é concedido só por estar autenticado. O modelo é em camadas e boa parte é imposta **no banco**, não só na UI:
1. **Membro ativo** — só acessa quem possui `users/{uid}` **e** não está `bloqueado: true`. Usuário excluído/bloqueado perde acesso na hora (a conta Auth pode continuar existindo; o front não apaga Auth de terceiros). Exceção: o usuário sempre lê o **próprio** doc, para o front detectar o bloqueio e deslogar.
2. **Isolamento por projeto** — só lê/escreve as coleções de um projeto quem tem `projects[proj] == true` (admin sempre). Um cliente de um projeto **não** enxerga outro.
3. **Proteção do próprio doc `users`** — usuário comum **não** pode alterar campos sensíveis do próprio doc (`role`, `permissions`, `projects`, `bloqueado`…); só campos neutros (hoje `cpf`). Isso impede auto-promoção a admin / auto-desbloqueio via console. Criar/apagar/rebaixar usuário = **só admin**. Gestão de clientes da ronda (`rondaCallinkCliente/Locais`, `rondaLinkcallCliente/Locais`) exige `gerenciarClientes` e limita os campos tocados. **Exceção à regra "criar usuário = só admin":** quem tem `gerenciarClientes` de uma ronda também pode **criar** contas de cliente pela aba "Acessos de Clientes" (helper `podeCriarClienteRonda`) — mas o doc criado é estritamente limitado (`role:'user'`, `projects` só daquela ronda, `rondaXxxCliente:true`, **sem** `permissions`), o que impede escalonar para admin/outros sistemas. Excluir conta continua **só admin**.
4. **Permissões granulares no banco** — o que dá para distinguir com segurança é imposto: `adicionar/criar` (create), `apagarPermanente` (delete nas `lixeira-*`) e **cliente-externo da ronda = somente leitura**. Globais (`config`, `projetos-lista`, `categorias-usuarios`): leitura p/ membros, escrita só admin.

**Limitação conhecida (fica na UI):** dentro de um projeto que o usuário **já acessa**, `editar` / `reordenar` / `moverLixeira` são o mesmo `update` de documento (às vezes em arrays), então o banco não separa a intenção sem quebrar fluxos — essas sub-ações continuam controladas visualmente. **Todo projeto novo deve adicionar seu próprio `match` block em `firebase.rules`** (isolamento + create/permanente); o catch-all final libera apenas admin, então coleção nova não mapeada fica inacessível a usuários comuns.

**Não recriar doc de usuário no cliente**: `index.html` (login) e `requireAuth`/`requireAdmin` (`shared/auth-guard.js`) **nunca** devem auto-criar `users/{uid}` — isso ressuscitaria usuários excluídos. Se o doc não existir ou `bloqueado === true`, fazer `auth.signOut()` e mandar para `index.html?bloqueado=1`. Contas são criadas pelo admin (`admin.html` via app secundário) — ou, exceção controlada, contas de **cliente de ronda** por quem tem `gerenciarClientes` (ver `podeCriarClienteRonda`). Reativar um usuário excluído continua proibido no cliente.

**Portão de acesso no `index.html`**: o `onAuthStateChanged` do index **nunca** deve redirecionar cegamente ao hub (`if (user) location='hub.html'`). Ele precisa verificar o doc (`exists` + `!bloqueado`) **antes** de ir ao hub; se inválido, `signOut()` e permanecer no login. Sem essa checagem, um usuário excluído/bloqueado entra em loop index↔hub (index manda pro hub → guard desloga → volta pro index → repete), queimando leituras do Firestore. Usa a flag `_checandoAcesso` para não reprocessar.

**UI (HTML/JS)**: as restrições de role e de permissões granulares são aplicadas **apenas visualmente** — mostrando ou ocultando botões no HTML. Funções JS **não** devem ter `if (!window._isAdmin) return;` no corpo. (Única exceção documentada: o guard de navegação `showSection('admin-section')` em solicitação-manutenções.)

## Permissões granulares (`window._can`)

Catálogo central em `shared/permissions.js` (`PERMISSOES_CATALOGO` + `resolverPermissoes`). Modelo no Firestore:
```js
users/{uid}.permissions = {
  'suporte-roteadores':      { adicionar, editar, moverLixeira, restaurar, apagarPermanente },
  'suporte-operacoes':       { adicionar, editar, reordenarItens, reordenarAbas, moverLixeira, restaurar, apagarPermanente, migrar },
  'agregador-links':         { adicionar, editar, reordenarItens, reordenarAbas, moverLixeira, restaurar, apagarPermanente },
  'solicitacao-manutencoes': { criar, painelAdm },
  'solicitacao-equipamentos':{ criar, gerenciarProdutos, gerenciarStatus, verTodos, moverLixeira, restaurar, apagarPermanente },
  'sistema-chamados':        { hubsoftConsultar },
  'ronda-callink':           { visualizar, registrarRonda, editar, gerenciarLocais, gerenciarProdutos, gerenciarClientes, moverLixeira, restaurar, apagarPermanente },
  'ronda-linkcall':          { visualizar, registrarRonda, editar, gerenciarLocais, gerenciarProdutos, gerenciarClientes, moverLixeira, restaurar, apagarPermanente },
  'frota-veiculos':          { visualizar, adicionar, gerenciarVeiculos, usarIA, editar, moverLixeira, restaurar, apagarPermanente }
}
```
Regras do resolver:
- role `admin`/`superadmin` → tudo `true` (acesso total)
- chave salva em `permissions[projId]` → usa o valor salvo
- `painelAdm` ausente → fallback legado `adminProjects['solicitacao-manutencoes']`
- chave ausente → default do catálogo (= comportamento legado do projeto)
- `apagarPermanente: true` **implica** `moverLixeira: true` (auto-check na UI do admin + garantia no resolver)

O painel `admin.html` grava `permissions` apenas para role `user` (não grava/apaga para admin — preserva para eventual rebaixamento) e espelha `painelAdm` de volta em `adminProjects` (compat). **Todo projeto novo deve registrar suas chaves no `PERMISSOES_CATALOGO`** e carregar `shared/permissions.js` após o auth-guard.

## Padrão de projeto (OBRIGATÓRIO)

Todo projeto novo deve seguir este padrão — já aplicado em `suporte-roteadores` e `suporte-operacoes`.

### Lixeira (soft-delete)
- **Mover para lixeira**: `window._can.moverLixeira` (default: liberado)
- **Restaurar**: `window._can.restaurar` (default: liberado)
- **Apagar permanentemente**: `window._can.apagarPermanente` (default: negado para `user`; admin/superadmin sempre podem)
- Itens já restaurados só aparecem na lista para quem tem `apagarPermanente`
- A lixeira de cada projeto fica em uma coleção top-level: `lixeira-{nome-projeto}`

### Firebase Rules (template p/ projeto novo)
As regras completas ficam em `firebase.rules` (helpers `isMembroAtivo`, `isAdmin`, `temProjeto`, `pode`, `apenasCampos`). **Todo projeto novo adiciona seu próprio `match` block** — o catch-all final só libera admin, então coleção não mapeada fica bloqueada p/ usuário comum. Padrão:
```
// Conteúdo do projeto (sob projetos/{proj}/… ou coleção top-level própria):
match /projetos/nome-projeto/{document=**} {
  allow read:           if temProjeto('nome-projeto');
  allow create:         if pode('nome-projeto', 'adicionar', true); // ou 'criar'/'registrarRonda'
  allow update, delete: if temProjeto('nome-projeto');             // editar/reordenar = UI
}
// Lixeira top-level do projeto:
match /lixeira-nome-projeto/{id} {
  allow read:   if temProjeto('nome-projeto');
  allow create: if pode('nome-projeto', 'moverLixeira', true);
  allow update: if pode('nome-projeto', 'restaurar', true);
  allow delete: if pode('nome-projeto', 'apagarPermanente', false); // permanente = teeth no banco
}
```
`pode(proj, cap, default)` espelha `resolverPermissoes` (admin → sempre `true`). Use `default` = o mesmo default do `PERMISSOES_CATALOGO`. Para projetos com cliente somente-leitura (ronda), condicione escritas a `!isClienteXxx()`.

### Rastreamento de criador (OBRIGATÓRIO em todo item novo)
Todo documento ou item de array criado deve incluir:
```js
criadoPor: window._userEmail || ''
criadoEm: firebase.firestore.FieldValue.serverTimestamp() // docs Firestore
// OU para itens em array (serverTimestamp não funciona dentro de array):
criadoEm: new Date().toISOString()
```

### Variáveis globais de sessão (definidas no init de cada página)
```js
window._isAdmin      // admin ou superadmin
window._isSuperAdmin // só superadmin
window._userEmail    // email do usuário logado
window._can          // permissões granulares resolvidas para o projeto
```

### Padrão de init em cada página
```js
requireAuth('nome-projeto').then(({ user, userData }) => {
    window._isAdmin      = userData.role === 'superadmin' || userData.role === 'admin';
    window._isSuperAdmin = userData.role === 'superadmin';
    window._userEmail    = user.email;
    window._can          = resolverPermissoes(userData, 'nome-projeto');
    // ...
});
```

### UI: botões de ação por permissão (apenas visual — sem guards JS no corpo da função)
- **Adicionar** (novo item, conteúdo, ou nova aba/tutorial): mostrar se `window._can.adicionar`. `criadoPor: window._userEmail` obrigatório
- **Reordenar cards/itens** (↑↓ dentro de uma aba): mostrar se `window._can.reordenarItens`
- **Editar conteúdo existente**: mostrar botão apenas se `window._can.editar`
- **Reordenar abas/seções** (ordem da navegação lateral): mostrar se `window._can.reordenarAbas`
- **Lixeira (soft-delete)**: mostrar se `window._can.moverLixeira`; restaurar se `window._can.restaurar`
- **Apagar permanente (na lixeira)**: mostrar botão apenas se `window._can.apagarPermanente`
- Botões fixos no HTML (ex.: lixeira/nova aba na sidebar) começam com `display:none` e são revelados no init conforme `window._can`

### Ordem obrigatória no soft-delete
Sempre gravar na lixeira **PRIMEIRO**, depois marcar `deletado: true` no doc original:
```js
// ✅ correto — se a lixeira falhar, o item não some
await LIXEIRA_REF().add({ ..., deletadoEm, deletadoPor });
await COL().doc(id).update({ deletado: true, deletadoEm, deletadoPor });
```
Envolver em try/catch e chamar `mostrarNotificacao()` em caso de erro.

### Restaurar da lixeira
- Para docs Firestore: marca `restaurado: true` no doc da lixeira (não move dados — os dados ficam no lugar, só marcados como `deletado: true`)
- Usuários comuns não precisam de permissão de delete na lixeira — só update
- Ao restaurar e re-adicionar ao array local, verificar duplicata antes de fazer `.push()`:
```js
if (!arrayCarregados.find(a => a.id === snap.id)) arrayCarregados.push(dado);
```

### Segurança: XSS (OBRIGATÓRIO)
Todo dado vindo do Firestore renderizado via `innerHTML` deve passar por `escapeHTML()`. Incluir esta função em todo projeto:
```js
function escapeHTML(str) {
    return String(str == null ? '' : str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
```
Para atributos em `onclick` (ex: nomes passados como argumento de string), usar `escaparAttr()` que também escapa `\n` e `\r`:
```js
function escaparAttr(str) {
    return String(str || '')
        .replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;')
        .replace(/\n/g,'\\n').replace(/\r/g,'\\r');
}
```
Evitar `innerHTML +=` com dados externos — preferir `createElement` + `textContent`.

## Estrutura Firestore
```
users/{uid}                       → inclui `categoria` (id da categoria/setor; ausente = Genérica)
config/{chave}
hubsoft/credenciais               → { url, client_id, client_secret, username, password } — API HubSoft (coleção protegida, NÃO em config/)
chamados-historico/{id}           → log imutável de aberturas do sistema-chamados (read/create p/ quem tem o projeto; update/delete negados)
projetos-lista/{id}
categorias-usuarios/{id}          → { nome, ordem, criadoPor, criadoEm } — setores p/ organizar usuários no admin
projetos/{projectId}/...          → conteúdo de cada projeto
lixeira-{projectId}/{id}          → itens deletados (soft-delete)
```

**Solicitação de Equipamentos e Produtos** (projectId `solicitacao-equipamentos`, pasta `projetos/solicitacao-equipamentos`) — sistema de requisição de equipamentos/produtos com fluxo de aprovação e chat. Usa coleção top-level própria:
```
solicitacoes-equipamentos/{id}            → { titulo, categoria, prioridade, descricao,
                                              itens:[{nome,qtd,valorUnit,link}], valorTotal,
                                              imagens:[{base64,nome}], aprovadores:[{uid,nome,email,status,comentario,em}],
                                              status, nMensagens, criadoPor/Nome/Uid, criadoEm, deletado }
solicitacoes-equipamentos/{id}/mensagens/{id} → chat + LOG IMUTÁVEL { tipo?:'log', texto, logIcon?, anexo:{tipo:'image'|'pdf',base64,nome}, autorNome/Email/Uid, autorAdmin, criadoEm }
produtos-equipamentos/{id}                → catálogo p/ reuso { nome, valorRef, categoria, link, criadoPor, criadoEm }
lixeira-solicitacao-equipamentos/{id}     → { refId, titulo, restaurado }
```
`status` = `pendente`|`aprovada`|`reprovada`|`comprada`|`recebida`|`cancelada`. Aprovada/reprovada/pendente são **derivados** dos `aprovadores` (qualquer reprovado→reprovada; todos aprovados→aprovada); comprada/recebida/cancelada são **manuais** (permissão `gerenciarStatus`) e sobrepõem o derivado até "Reabrir". A aba **"Todos os Chats"** (permissão `verTodos`, admin sempre) lista todas as solicitações; senão o usuário vê só as que criou ou é aprovador.
**Participação vs visibilidade:** só quem é **participante** (dono ou aprovador) pode AGIR (chat, editar, status, lixeira, aprovar). Admin que apenas observa via "Todos os Chats" (não está no nome dele) tem **somente leitura** — banner explícito no detalhe + aviso no lugar do input do chat; nenhum botão de ação. Mensagens de admin levam `autorAdmin:true` e exibem o selo **"adm"** (respondido via perfil de visibilidade total). Cada aprovador vê Aprovar/Reprovar só se estiver na lista e pendente (só UI).
**Seleção de aprovadores** é por **pesquisa** (campo de busca → nomes filtrados → chips), não lista fixa. **Itens** têm autocomplete via `<datalist>` do catálogo `produtos-equipamentos` (escolher um produto preenche valor/link vazios). O catálogo é gerido no modal "Produtos cadastrados" (permissão `gerenciarProdutos`). **Cards** mostram **De:** (criador) e **Para:** (todos os aprovadores/destinatários).
**Auditoria no chat:** TODA ação vira uma mensagem de sistema (`tipo:'log'`) na mesma subcoleção `mensagens`, renderizada como linha central — abrir/criar, editar, aprovar, reprovar (com motivo), aprovada/reprovada final, alterar status, reabrir, mover p/ lixeira e restaurar. Cada log guarda quem fez e quando (`autorUid`+`criadoEm`); é imutável (rules `update/delete:false`). `registrarLog(solId, texto, icon)` grava; `nMensagens` conta só mensagens humanas. Abertura/fechamento do modal de visualização **não** é logado (evita ruído/escritas). Chat aceita imagem (comprimida via `compressImage`) e PDF (cap ~900KB/anexo p/ caber em 1 doc <1MB); mensagens são imutáveis nas rules. Imagens abrem em lightbox. **Restrição "minhas vs todos" e "participante vs observador" são só de UI** — as rules permitem `read`/`update` a qualquer membro com o projeto.

**Ronda Callink** (projectId `ronda-callink`) — usa coleções top-level próprias (não `projetos/…`):
```
ronda-callink-locais/{id}                    → { nome, endereco, contato, intervaloRondaDias(15), observacoes, ativo }
ronda-callink-locais/{id}/catracas/{id}      → equipamentos fixos do local { nome, tipo, ativa }
ronda-callink-produtos/{id}                  → catálogo de peças { nome, categoria, codigo, fotoBase64(reduzida ~500px) } — COMPARTILHADO por TODAS as rondas (fonte única)
ronda-callink-rondas/{id}                    → registro leve { localId, tecnico*, dataRonda, localVisto, piso, catracas[], pecasTrocadas[], demaisInfos, nFotos }
ronda-callink-rondas/{id}/fotos/{id}         → 1 foto por doc { base64(~1024px), secao, legenda } (evita estourar 1MB/doc)
lixeira-ronda-callink/{id}                   → { tipoItem:'ronda'|'local'|'produto', refId, titulo, restaurado }
```
Cliente externo (somente leitura, vê só os locais vinculados): `users/{uid}.rondaCallinkCliente=true` + `users/{uid}.rondaCallinkLocais=[localId]`, gravados na aba "Acessos de Clientes" do próprio projeto. Nessa aba, quem tem `gerenciarClientes` pode **criar a conta do cliente** ali mesmo (`abrirModalNovoCliente`/`criarCliente` no `js/app.js`, via app secundário do Firebase — mesmo padrão do `admin.html`, mas gravando um doc de cliente limitado autorizado por `podeCriarClienteRonda` nas rules). Imagens são reduzidas via canvas (`comprimirImagem` em `js/app.js`) antes de virar base64. **Restrição por local é só de UI** enquanto as rules do Firebase não forem endurecidas para este projeto.

**Ronda Linkcall** (projectId `ronda-linkcall`, pasta `projetos/ronda-linkcall`) é um **clone totalmente independente** do Ronda Callink: mesmo código, mas com todas as coleções, permissões e campos de cliente com o prefixo trocado (`ronda-linkcall-*`, `lixeira-ronda-linkcall`, `users/{uid}.rondaLinkcallCliente` / `rondaLinkcallLocais`). Os dois não compartilham dados **exceto o catálogo de produtos/peças**: todas as rondas (callink, linkcall, barueri, jundiai) usam a coleção única `ronda-callink-produtos` (o `COL_PRODUTOS` de todas aponta para ela). A rule dessa coleção libera leitura p/ membro de qualquer ronda (`temAlgumaRonda`) e escrita p/ quem gerencia produtos/lixeira em qualquer ronda (`podeGerirProdutoCompart`/`podeApagarProdutoCompart`), nunca cliente externo. As coleções `ronda-{linkcall,barueri,jundiai}-produtos` ficaram órfãs (não são mais lidas/escritas). Ao alterar o comportamento de um, replicar no outro.

**Frota de Veículos** (projectId `frota-veiculos`, pasta `projetos/frota-veiculos`) — gestão de manutenção de veículos com **alertas inteligentes** e gráficos de custo. **Frota compartilhada**: todo membro com o projeto vê todos os veículos/manutenções (ações restritas por permissão só na UI). Usa coleções top-level próprias:
```
frota-veiculos-carros/{id}        → { apelido, marca, modelo, ano, placa, cor, kmAtual, combustivel, renavam, chassi, fotoBase64,
                                      planoManutencao:[{id,item,categoria,intervaloKm,intervaloMeses,ultimaKm,ultimaData}],
                                      documentos:[{id,tipo,numero,vencimento,valor}], ativo, criadoPor/Uid/Em, deletado }
frota-veiculos-manutencoes/{id}   → { carroId, tipo(preventiva|corretiva|revisao|outro), data, km, descricao, descricaoLonga, oficina,
                                      itens:[{nome,categoria,valorPeca,valorMaoObra}], valorTotal,
                                      notaFiscal:{tipo:'image'|'pdf',base64,nome}, planoItensAtendidos:[planoItemId], criadoPor/Uid/Em, deletado }
lixeira-frota-veiculos/{id}       → { tipoItem:'carro'|'manutencao', refId, titulo, dados, restaurado, deletadoPor/Em }
```
**Plano de manutenção por IA:** ao cadastrar/editar um veículo, o botão "Buscar plano com IA" (permissão `usarIA`) chama `chamarIA()` com **fallback automático Gemini → OpenAI (GPT) → API local** (lê `config/gemini-api-key`, `config/openai-api-key`, `config/api-url-interna` — mesmo padrão de fallback do `sistema-chamados`; usa a que estiver configurada no admin) para pesquisar o plano recomendado do fabricante daquele modelo e preencher a tabela editável (`intervaloKm`/`intervaloMeses` por item); o usuário revisa/ajusta antes de salvar. Fallback: botão "Usar plano padrão" (`PLANO_PADRAO` no `js/app.js`). **Alertas** (view Alertas + badge na sidebar) são calculados no cliente: por **km** (`ultimaKm + intervaloKm − kmAtual ≤ 1.000` = atenção, `< 0` = vencida), por **tempo** (`ultimaData + intervaloMeses` vs hoje, ≤ 30 dias = atenção) e por **documentos** (IPVA/licenciamento/seguro/CNH — vencimento por data). Registrar uma manutenção com "Itens do plano atendidos" marcados **reinicia** `ultimaKm`/`ultimaData` daqueles itens (zera o alerta) e atualiza `kmAtual` se maior. **Dashboard** usa **Chart.js** (CDN, carregado no `index.html`): gasto mensal (12m), gasto por veículo, gasto por categoria e preventiva×corretiva. Nota fiscal aceita imagem (comprimida) ou PDF (cap ~900KB). Tudo pensado para **mobile** (mesmo `shared/mobile-sidebar.js` + CSS responsivo). Rules: `read`=`temProjeto`, criar carro=`gerenciarVeiculos`, criar manutenção=`adicionar`, lixeira `create/update/delete`=`moverLixeira`/`restaurar`/`apagarPermanente`.

**Histórico de chamados** (`sistema-chamados`, aba "Histórico") — log de auditoria **IMUTÁVEL** de todas as aberturas na coleção **top-level** `chamados-historico/{id}` (fora da regra ampla do projeto, de propósito, p/ negar update/delete). Rule dedicada: `read/create = temProjeto('sistema-chamados')` (create só com `criadoPorUid == auth.uid`), `update, delete: if false` — ninguém edita/apaga (o catch-all ainda dá override a admin via console = break-glass; na UI **não há** editar/apagar p/ ninguém). Clientes de ronda não leem. `js/historico.js`: `salvarHistoricoChamado()` grava **uma vez** ao chegar na etapa **Resultado** (`codigo/cliente/falha/... + criadoPor + criadoPorUid + criadoEm`), com trava **por sessão/chamado** `_histDocAtual`+`_histSalvando` (à prova de clique-duplo e corrida — nunca duplica); `novoChamadoHistorico()` (Novo/Limpar) libera o próximo registro, então o mesmo cliente num chamado futuro gera novo registro. `carregarHistorico()` lista em cards expansíveis (avatar por iniciais, tempo relativo, busca client-side); "Copiar chamado" usa o mesmo formato do `gerarChamadoCompleto`.

**Abertura de chamado em etapas** (`sistema-chamados`) — a aba Dashboard é um **wizard de 5 etapas sem rolagem de janela**, controlado por `js/wizard.js` (`window.chamadoWizard`): **HubSoft → James → Dados → Resumo → Resultado**. A etapa Resultado monta o texto final (`sistemaChamados.gerarChamadoCompleto()` + resumo de `#resumoContent`) em `#cwResultado`, oferece copiar tudo/só chamado/só resumo e **registra no histórico** ao entrar. O wizard não reimplementa lógica; orquestra as etapas e chama os métodos existentes de `window.sistemaChamados` (`processarComIA` no James→Dados, `atualizarResumo` no Dados→Resumo, `copiarChamado` no fim). Layout: `.cw` ocupa `calc(100vh - 124px)`, cada `.cw-pane` aparece por vez (as demais `display:none`); só o pane rola internamente se precisar. **IDs do `app.js` foram preservados** (inclusive `processarIABtn`/`copiarChamadoBtn` mantidos ocultos via `.cw-hidden` para o `bindEvents` não quebrar).

**Integração HubSoft** (etapa 1 do wizard) — consulta **somente-leitura** à API HubSoft (OAuth2 grant `password`). Módulo em `js/hubsoft.js` (`window.hsWizard`). Apenas 2 requisições permitidas: `POST /oauth/token` e `GET /api/v1/integracao/cliente` (**nunca** POST/PUT/PATCH/DELETE). A etapa 1 tem 2 modos: **Buscar por código** (abre o console `#hs-wizard` via `chamadoWizard.consultarApi()`) ou **Colar dados** (textarea + Audinha IA). O console `hsWizard` é ele mesmo um mini-wizard (Localizar → Ponto → Selecionar) com terminal de log ao vivo: autentica (fallback de 3 Content-Types; token em cache, TTL 25 dias, invalidado em 401), busca o cliente, mostra **cada campo com checkbox** (mapeados marcados) + alertas; >1 serviço = etapa de seleção de ponto. Em "Aplicar", os mapeados preenchem `cliente/telefone/ponto/localCliente/codigo`, os extras (login/senha PPPoE, MAC, etc.) viram o bloco `DADOS HUBSOFT ────>` no campo **Falha** (com 2 quebras de linha em cima, reservando o topo p/ a descrição da falha), e o fluxo avança para a etapa **James** (não pula) — a IA do James complementa só os campos vazios, inserindo a falha extraída ACIMA do bloco. O modo "Buscar" só aparece se `window._can.hubsoftConsultar` (senão fica só "Colar dados"). Fonte monoespaçada (JetBrains Mono) nos dados técnicos.
**Segurança das credenciais (crítico):** ficam em `hubsoft/credenciais` — coleção **própria, FORA de `config/`** (que é legível por qualquer membro ativo, inclusive clientes de ronda). Rule: `read` só p/ `isAdmin()` **ou** `temProjeto('sistema-chamados') && pode('sistema-chamados','hubsoftConsultar', false)`; `write` só admin. Gravadas no card "Integração HubSoft" da aba **Ferramentas** do `admin.html`. Limitação inerente ao front-only: quem tem `hubsoftConsultar` lê o secret no navegador — a blindagem impede que qualquer outro (clientes) chegue ao doc.

**Categorias de usuários** (admin.html): filtros `Todos` (todos) e `Genérica` (sem categoria) são virtuais; as demais vêm de `categorias-usuarios`. Admins/superadmins seguem a mesma lógica de categoria dos usuários comuns (aparecem no setor atribuído ou em `Genérica`). Excluir uma categoria devolve seus usuários para Genérica (limpa `users/{uid}.categoria` em batch).

## Projetos existentes
| pasta | projectId | lixeira |
|---|---|---|
| `projetos/suporte-roteadores` | `suporte-roteadores` | `lixeira-roteadores` |
| `projetos/suporte-operacoes` | `suporte-operacoes` | `lixeira-operacoes` |
| `projetos/sistema-chamados` | `sistema-chamados` | (ainda sem lixeira) |
| `projetos/solicitação-manuntenções` | `solicitação-manuntenções` | (ainda sem lixeira) |
| `projetos/solicitacao-equipamentos` | `solicitacao-equipamentos` | `lixeira-solicitacao-equipamentos` |
| `projetos/agregador-links` | `agregador-links` | `lixeira-links` |
| `projetos/ronda-callink` | `ronda-callink` | `lixeira-ronda-callink` |
| `projetos/ronda-linkcall` | `ronda-linkcall` | `lixeira-ronda-linkcall` |
| `projetos/frota-veiculos` | `frota-veiculos` | `lixeira-frota-veiculos` |

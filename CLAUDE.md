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

**Firebase Rules**: o acesso ao Firestore **não** é concedido só por estar autenticado. Só acessa quem é **membro ativo**: possui o doc `users/{uid}` **e** não está com `bloqueado: true`. Um usuário excluído (doc apagado) ou bloqueado perde acesso ao banco imediatamente, mesmo que a conta do Firebase Auth continue existindo (o front não consegue apagar a conta Auth de outro usuário — exigiria Admin SDK/backend). Exceção nas rules: o usuário sempre pode ler o **próprio** doc, para o front detectar o bloqueio e encerrar a sessão. Não há restrição por **role** no banco — role continua sendo só de UI.

**Não recriar doc de usuário no cliente**: `index.html` (login) e `requireAuth`/`requireAdmin` (`shared/auth-guard.js`) **nunca** devem auto-criar `users/{uid}` — isso ressuscitaria usuários excluídos. Se o doc não existir ou `bloqueado === true`, fazer `auth.signOut()` e mandar para `index.html?bloqueado=1`. Contas são criadas **apenas** pelo admin (`admin.html` via app secundário).

**UI (HTML/JS)**: as restrições de role e de permissões granulares são aplicadas **apenas visualmente** — mostrando ou ocultando botões no HTML. Funções JS **não** devem ter `if (!window._isAdmin) return;` no corpo. (Única exceção documentada: o guard de navegação `showSection('admin-section')` em solicitação-manutenções.)

## Permissões granulares (`window._can`)

Catálogo central em `shared/permissions.js` (`PERMISSOES_CATALOGO` + `resolverPermissoes`). Modelo no Firestore:
```js
users/{uid}.permissions = {
  'suporte-roteadores':      { adicionar, editar, moverLixeira, restaurar, apagarPermanente },
  'suporte-operacoes':       { adicionar, editar, reordenarItens, reordenarAbas, moverLixeira, restaurar, apagarPermanente, migrar },
  'agregador-links':         { adicionar, editar, reordenarItens, reordenarAbas, moverLixeira, restaurar, apagarPermanente },
  'solicitacao-manutencoes': { criar, painelAdm },
  'ronda-callink':           { visualizar, registrarRonda, editar, gerenciarLocais, gerenciarProdutos, gerenciarClientes, moverLixeira, restaurar, apagarPermanente },
  'ronda-linkcall':          { visualizar, registrarRonda, editar, gerenciarLocais, gerenciarProdutos, gerenciarClientes, moverLixeira, restaurar, apagarPermanente }
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

### Firebase Rules (template)
```
// Membro ativo = autenticado + doc users/{uid} existe + não bloqueado
function isMembroAtivo() {
  return request.auth != null
    && exists(/databases/$(database)/documents/users/$(request.auth.uid))
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('bloqueado', false) != true;
}
// Usuário sempre lê o próprio doc (p/ o front detectar bloqueio e deslogar)
match /users/{uid} {
  allow read: if request.auth != null && request.auth.uid == uid;
}
// Regra global: só membros ativos leem/escrevem
match /{document=**} {
  allow read, write: if isMembroAtivo();
}
```

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
projetos-lista/{id}
categorias-usuarios/{id}          → { nome, ordem, criadoPor, criadoEm } — setores p/ organizar usuários no admin
projetos/{projectId}/...          → conteúdo de cada projeto
lixeira-{projectId}/{id}          → itens deletados (soft-delete)
```

**Ronda Callink** (projectId `ronda-callink`) — usa coleções top-level próprias (não `projetos/…`):
```
ronda-callink-locais/{id}                    → { nome, endereco, contato, intervaloRondaDias(15), observacoes, ativo }
ronda-callink-locais/{id}/catracas/{id}      → equipamentos fixos do local { nome, tipo, ativa }
ronda-callink-produtos/{id}                  → catálogo de peças { nome, categoria, codigo, fotoBase64(reduzida ~500px) }
ronda-callink-rondas/{id}                    → registro leve { localId, tecnico*, dataRonda, localVisto, piso, catracas[], pecasTrocadas[], demaisInfos, nFotos }
ronda-callink-rondas/{id}/fotos/{id}         → 1 foto por doc { base64(~1024px), secao, legenda } (evita estourar 1MB/doc)
lixeira-ronda-callink/{id}                   → { tipoItem:'ronda'|'local'|'produto', refId, titulo, restaurado }
```
Cliente externo (somente leitura, vê só os locais vinculados): `users/{uid}.rondaCallinkCliente=true` + `users/{uid}.rondaCallinkLocais=[localId]`, gravados na aba "Acessos de Clientes" do próprio projeto. Imagens são reduzidas via canvas (`comprimirImagem` em `js/app.js`) antes de virar base64. **Restrição por local é só de UI** enquanto as rules do Firebase não forem endurecidas para este projeto.

**Ronda Linkcall** (projectId `ronda-linkcall`, pasta `projetos/ronda-linkcall`) é um **clone totalmente independente** do Ronda Callink: mesmo código, mas com todas as coleções, permissões e campos de cliente com o prefixo trocado (`ronda-linkcall-*`, `lixeira-ronda-linkcall`, `users/{uid}.rondaLinkcallCliente` / `rondaLinkcallLocais`). Os dois não compartilham dados. Ao alterar o comportamento de um, replicar no outro.

**Categorias de usuários** (admin.html): filtros `Todos` (todos) e `Genérica` (sem categoria) são virtuais; as demais vêm de `categorias-usuarios`. Admins/superadmins seguem a mesma lógica de categoria dos usuários comuns (aparecem no setor atribuído ou em `Genérica`). Excluir uma categoria devolve seus usuários para Genérica (limpa `users/{uid}.categoria` em batch).

## Projetos existentes
| pasta | projectId | lixeira |
|---|---|---|
| `projetos/suporte-roteadores` | `suporte-roteadores` | `lixeira-roteadores` |
| `projetos/suporte-operacoes` | `suporte-operacoes` | `lixeira-operacoes` |
| `projetos/sistema-chamados` | `sistema-chamados` | (ainda sem lixeira) |
| `projetos/solicitação-manuntenções` | `solicitação-manuntenções` | (ainda sem lixeira) |
| `projetos/agregador-links` | `agregador-links` | `lixeira-links` |
| `projetos/ronda-callink` | `ronda-callink` | `lixeira-ronda-callink` |
| `projetos/ronda-linkcall` | `ronda-linkcall` | `lixeira-ronda-linkcall` |

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

**Firebase Rules**: qualquer usuário autenticado (login + senha) tem acesso total ao Firestore. Não há restrição por role no banco.

**UI (HTML/JS)**: as restrições de role e de permissões granulares são aplicadas **apenas visualmente** — mostrando ou ocultando botões no HTML. Funções JS **não** devem ter `if (!window._isAdmin) return;` no corpo. (Única exceção documentada: o guard de navegação `showSection('admin-section')` em solicitação-manutenções.)

## Permissões granulares (`window._can`)

Catálogo central em `shared/permissions.js` (`PERMISSOES_CATALOGO` + `resolverPermissoes`). Modelo no Firestore:
```js
users/{uid}.permissions = {
  'suporte-roteadores':      { adicionar, editar, moverLixeira, restaurar, apagarPermanente },
  'suporte-operacoes':       { adicionar, editar, reordenarItens, reordenarAbas, moverLixeira, restaurar, apagarPermanente, migrar },
  'agregador-links':         { adicionar, editar, reordenarItens, reordenarAbas, moverLixeira, restaurar, apagarPermanente },
  'solicitacao-manutencoes': { criar, painelAdm }
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
// Regra global: qualquer autenticado pode ler e escrever tudo
match /{document=**} {
  allow read, write: if request.auth != null;
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
users/{uid}
config/{chave}
projetos-lista/{id}
projetos/{projectId}/...          → conteúdo de cada projeto
lixeira-{projectId}/{id}          → itens deletados (soft-delete)
```

## Projetos existentes
| pasta | projectId | lixeira |
|---|---|---|
| `projetos/suporte-roteadores` | `suporte-roteadores` | `lixeira-roteadores` |
| `projetos/suporte-operacoes` | `suporte-operacoes` | `lixeira-operacoes` |
| `projetos/sistema-chamados` | `sistema-chamados` | (ainda sem lixeira) |
| `projetos/solicitação-manuntenções` | `solicitação-manuntenções` | (ainda sem lixeira) |
| `projetos/agregador-links` | `agregador-links` | `lixeira-links` |

# HubAudicom — Convenções do Projeto

## Stack
- Firebase Auth + Firestore (sem backend próprio)
- Vanilla JS + HTML/CSS (sem frameworks)
- FontAwesome 6 para ícones

## Roles
| role | pode fazer |
|---|---|
| `user` | lê os projetos que têm acesso, pode soft-delete |
| `admin` | lê e escreve em tudo, não pode apagar permanente |
| `superadmin` | tudo, incluindo apagar permanentemente |

## Modelo de segurança

**Firebase Rules**: qualquer usuário autenticado (login + senha) tem acesso total ao Firestore. Não há restrição por role no banco.

**UI (HTML/JS)**: as restrições de role (user/admin/superadmin) são aplicadas **apenas visualmente** — mostrando ou ocultando botões no HTML. Funções JS **não** devem ter `if (!window._isAdmin) return;` no corpo.

## Padrão de projeto (OBRIGATÓRIO)

Todo projeto novo deve seguir este padrão — já aplicado em `suporte-roteadores` e `suporte-operacoes`.

### Lixeira (soft-delete)
- Qualquer usuário com acesso ao projeto pode **mover para lixeira**
- Qualquer usuário pode **restaurar** da lixeira
- Apenas **superadmin** pode **apagar permanentemente**
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
```

### Padrão de init em cada página
```js
requireAuth('nome-projeto').then(({ user, userData }) => {
    window._isAdmin      = userData.role === 'superadmin' || userData.role === 'admin';
    window._isSuperAdmin = userData.role === 'superadmin';
    window._userEmail    = user.email;
    // ...
});
```

### UI: botões de ação por permissão (apenas visual — sem guards JS no corpo da função)
- **Adicionar** (novo item, conteúdo, ou nova aba/tutorial): todos os usuários — sem condicional. `criadoPor: window._userEmail` obrigatório
- **Reordenar cards/itens** (↑↓ dentro de uma aba): todos os usuários — sem condicional
- **Editar conteúdo existente**: mostrar botão apenas se `window._isAdmin` (mas sem `return` no corpo da função)
- **Reordenar abas/seções** (ordem da navegação lateral): mostrar botão apenas se `window._isAdmin`
- **Lixeira (soft-delete)**: todos os usuários — sem condicional
- **Apagar permanente (na lixeira)**: mostrar botão apenas se `window._isSuperAdmin`

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

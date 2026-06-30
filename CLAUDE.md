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

## Padrão de segurança por projeto (OBRIGATÓRIO)

Todo projeto novo deve seguir este padrão — já aplicado em `suporte-roteadores` e `suporte-operacoes`.

### Lixeira (soft-delete)
- Qualquer usuário com acesso ao projeto pode **mover para lixeira**
- Qualquer usuário pode **restaurar** da lixeira
- Apenas **superadmin** pode **apagar permanentemente**
- A lixeira de cada projeto fica em uma coleção top-level: `lixeira-{nome-projeto}`

### Firebase Rules (template)
```
// Projeto: qualquer usuário com acesso pode ler e escrever
match /projetos/{nome-projeto}/{document=**} {
  allow read, write: if hasProjectAccess('{nome-projeto}');
}

// Lixeira: create/read/update para usuários com acesso; delete só superadmin
match /lixeira-{nome-projeto}/{docId} {
  allow read, create, update: if hasProjectAccess('{nome-projeto}');
  allow delete: if isSuperAdmin();
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

### UI: botões de ação por permissão
- **Adicionar** (novo item, conteúdo, ou nova aba/tutorial): todos os usuários com acesso — sem condicional. `criadoPor: window._userEmail` obrigatório
- **Reordenar cards/itens** (↑↓ dentro de uma aba): todos os usuários com acesso — sem condicional
- **Editar conteúdo existente**: `window._isAdmin`
- **Reordenar abas/seções** (ordem da navegação lateral): `window._isAdmin`
- **Lixeira (soft-delete)**: todos os usuários com acesso — sem condicional
- **Apagar permanente (na lixeira)**: `window._isSuperAdmin`

> **Nota:** funções de editar e reordenar estrutura devem ter `if (!window._isAdmin) return;` no corpo além de ocultar o botão na UI (defesa em profundidade).

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

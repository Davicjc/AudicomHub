# AudicomHub

Portal interno da Audicom Telecom para gerenciamento de projetos e suporte técnico.

## Stack

- **Frontend:** Vanilla JS + HTML/CSS
- **Backend:** Firebase Auth + Firestore
- **Ícones:** FontAwesome 6

## Projetos

| Projeto | Descrição |
|---|---|
| `suporte-roteadores` | Base de conhecimento para suporte de roteadores |
| `suporte-operacoes` | Documentação de operações internas |
| `sistema-chamados` | Gerenciamento de chamados |
| `solicitação-manuntenções` | Solicitações de manutenção |

## Estrutura de arquivos

```
index.html              → Login
hub.html                → Hub principal (lista de projetos)
admin.html              → Painel de administração
shared/                 → Scripts e estilos compartilhados
projetos/               → Cada projeto em sua subpasta
firebase.rules          → Regras de segurança do Firestore
```

## Roles

| Role | Permissões |
|---|---|
| `user` | Lê projetos com acesso, pode mover para lixeira |
| `admin` | Lê e escreve em tudo |
| `superadmin` | Tudo, incluindo apagar permanentemente |

## Como rodar

Abra o `iniciar.bat` ou sirva os arquivos com qualquer servidor HTTP local.
O projeto usa Firebase diretamente no frontend — não há backend próprio.

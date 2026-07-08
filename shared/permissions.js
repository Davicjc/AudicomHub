// ================================================================
// PERMISSÕES GRANULARES — catálogo por projeto + resolver
// Enforcement é apenas visual (mostrar/ocultar botões).
// Todo projeto novo deve registrar suas chaves aqui.
// ================================================================

// default = comportamento legado (usuário sem o campo `permissions`)
// implica  = chaves habilitadas automaticamente junto com esta
// legado   = campo antigo em users/{uid} usado como fallback
const PERMISSOES_CATALOGO = {
  'suporte-roteadores': {
    adicionar:        { label: 'Adicionar itens',           default: true  },
    editar:           { label: 'Editar itens',              default: false },
    moverLixeira:     { label: 'Apagar: mover p/ lixeira',  default: true  },
    restaurar:        { label: 'Restaurar da lixeira',      default: true  },
    apagarPermanente: { label: 'Apagar: permanentemente',   default: false, implica: ['moverLixeira'] }
  },
  'suporte-operacoes': {
    adicionar:        { label: 'Adicionar (abas, imagens, conteúdo)', default: true  },
    editar:           { label: 'Editar (abas e passos)',    default: false },
    reordenarItens:   { label: 'Reordenar passos',          default: true  },
    reordenarAbas:    { label: 'Reordenar abas',            default: false },
    moverLixeira:     { label: 'Apagar: mover p/ lixeira',  default: true  },
    restaurar:        { label: 'Restaurar da lixeira',      default: true  },
    apagarPermanente: { label: 'Apagar: permanentemente',   default: false, implica: ['moverLixeira'] },
    migrar:           { label: 'Migrar imagens p/ nuvem',   default: false }
  },
  'agregador-links': {
    adicionar:        { label: 'Adicionar (abas e links)',  default: true  },
    editar:           { label: 'Editar (abas e links)',     default: false },
    reordenarItens:   { label: 'Reordenar links',           default: true  },
    reordenarAbas:    { label: 'Reordenar abas',            default: true  },
    moverLixeira:     { label: 'Apagar: mover p/ lixeira',  default: true  },
    restaurar:        { label: 'Restaurar da lixeira',      default: true  },
    apagarPermanente: { label: 'Apagar: permanentemente',   default: false, implica: ['moverLixeira'] }
  },
  'solicitacao-manutencoes': {
    criar:            { label: 'Criar solicitação',         default: true  },
    painelAdm:        { label: 'Ver painel administrativo', default: false, legado: 'adminProjects' }
  },
  'ronda-callink': {
    visualizar:        { label: 'Visualizar rondas e dashboard', default: true  },
    visualizarLogs:    { label: 'Visualizar logs',               default: false },
    registrarRonda:    { label: 'Registrar rondas',              default: true  },
    editar:            { label: 'Editar rondas finalizadas',                 default: false },
    gerenciarLocais:   { label: 'Cadastrar locais e catracas',   default: false },
    gerenciarProdutos: { label: 'Cadastrar produtos/peças',      default: false },
    gerenciarClientes: { label: 'Gerenciar acessos de clientes', default: false },
    moverLixeira:      { label: 'Apagar: mover p/ lixeira',      default: true  },
    restaurar:         { label: 'Restaurar da lixeira',          default: true  },
    apagarPermanente:  { label: 'Apagar: permanentemente',       default: false, implica: ['moverLixeira'] }
  },
  'ronda-linkcall': {
    visualizar:        { label: 'Visualizar rondas e dashboard', default: true  },
    visualizarLogs:    { label: 'Visualizar logs',               default: false },
    registrarRonda:    { label: 'Registrar rondas',              default: true  },
    editar:            { label: 'Editar rondas finalizadas',                 default: false },
    gerenciarLocais:   { label: 'Cadastrar locais e catracas',   default: false },
    gerenciarProdutos: { label: 'Cadastrar produtos/peças',      default: false },
    gerenciarClientes: { label: 'Gerenciar acessos de clientes', default: false },
    moverLixeira:      { label: 'Apagar: mover p/ lixeira',      default: true  },
    restaurar:         { label: 'Restaurar da lixeira',          default: true  },
    apagarPermanente:  { label: 'Apagar: permanentemente',       default: false, implica: ['moverLixeira'] }
  },
  'sistema-chamados': {} // sem opções granulares — só acesso sim/não
};

// Resolve as permissões efetivas de um usuário em um projeto.
// admin/superadmin → tudo true. user → valor salvo em
// users/{uid}.permissions[projectId], senão fallback legado, senão default.
function resolverPermissoes(userData, projectId) {
  const cat = PERMISSOES_CATALOGO[projectId] || {};
  const isAdmin = !!userData && (userData.role === 'admin' || userData.role === 'superadmin');
  const salvas = (userData && userData.permissions && userData.permissions[projectId]) || null;
  const can = {};

  Object.keys(cat).forEach(k => {
    if (isAdmin) { can[k] = true; return; }
    if (salvas && Object.prototype.hasOwnProperty.call(salvas, k)) { can[k] = !!salvas[k]; return; }
    if (cat[k].legado === 'adminProjects') {
      can[k] = !!(userData && userData.adminProjects && userData.adminProjects[projectId]);
      return;
    }
    can[k] = !!cat[k].default;
  });

  // implicações (ex.: apagarPermanente habilita moverLixeira)
  Object.keys(cat).forEach(k => {
    if (can[k] && cat[k].implica) cat[k].implica.forEach(dep => { can[dep] = true; });
  });

  return can;
}

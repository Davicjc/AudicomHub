/* ================================================================
   RONDA LINKCALL — lógica do projeto
   Padrões do Hub: permissões granulares (window._can), lixeira
   soft-delete, rastreamento de criador, escapeHTML/escaparAttr.
   ================================================================ */

/* ── Referências de coleções ──────────────────────── */
const COL_LOCAIS   = () => db.collection('ronda-linkcall-locais');
const COL_PRODUTOS = () => db.collection('ronda-linkcall-produtos');
const COL_RONDAS   = () => db.collection('ronda-linkcall-rondas');
const COL_LIXEIRA  = () => db.collection('lixeira-ronda-linkcall');
const COL_LOGS     = () => db.collection('ronda-linkcall-logs');
const SUB_CATRACAS = (localId) => COL_LOCAIS().doc(localId).collection('catracas');
const SUB_FOTOS    = (rondaId) => COL_RONDAS().doc(rondaId).collection('fotos');

const LOG_TIPOS = {
  acesso:       { label: 'Acesso',       icon: 'fa-right-to-bracket', color: '#22c55e' },
  navegacao:    { label: 'Navegação',    icon: 'fa-route',            color: '#3b82f6' },
  criacao:      { label: 'Criação',      icon: 'fa-plus',             color: '#10b981' },
  edicao:       { label: 'Edição',       icon: 'fa-pen',              color: '#60a5fa' },
  lixeira:      { label: 'Lixeira',      icon: 'fa-trash',            color: '#f59e0b' },
  restauracao:  { label: 'Restauração',  icon: 'fa-rotate-left',      color: '#06b6d4' },
  exclusao:     { label: 'Exclusão',     icon: 'fa-skull',            color: '#ef4444' },
  visualizacao: { label: 'Visualização', icon: 'fa-eye',              color: '#a855f7' },
  relatorio:    { label: 'Relatório',    icon: 'fa-file-pdf',         color: '#f97316' },
  cliente:      { label: 'Cliente',      icon: 'fa-user-shield',      color: '#14b8a6' },
};

/* ── Estado em memória ────────────────────────────── */
let _locais   = [];
let _produtos = [];
let _rondas   = [];   // documentos "leves" (sem fotos)
let _tecnicos = null; // cache lazy p/ admin escolher técnico
let _viewAtual = 'dashboard';
let _logsFiltroTipo = 'todos';
let _logsFiltroUsuario = 'todos';
let _logsFiltroPeriodo = 'todos';
let _logsDataInicio = '';
let _logsDataFim = '';

// estado do formulário de ronda aberto
let _rondaEdit = null;
let _fotosRonda = [];          // { id?, base64, secao, legenda, _nova, _removida }
let _estadosCatraca = {};      // { catracaId: 'ok' | 'problema' }
let _catracasForm = [];        // catracas carregadas do local selecionado
let _rondaEraRascunho = false;
let _autosaveRondaTimer = null;
let _autosaveRondaAtivo = false;
let _autosaveRondaSalvando = false;
let _autosaveRondaPendente = false;

/* ================================================================
   UTILITÁRIOS
   ================================================================ */
function escapeHTML(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escaparAttr(str) {
  return String(str == null ? '' : str)
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;')
    .replace(/\n/g,'\\n').replace(/\r/g,'\\r');
}

let _notifTimer = null;
function mostrarNotificacao(msg, tipo = 'sucesso') {
  const el = document.getElementById('notification');
  el.querySelector('span').textContent = msg;
  el.classList.toggle('erro', tipo === 'erro');
  el.querySelector('i').className = tipo === 'erro' ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';
  el.classList.add('show');
  clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function tsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'string') return new Date(v).getTime() || 0;
  if (v.seconds) return v.seconds * 1000;
  return new Date(v).getTime() || 0;
}
function formatarData(v) {
  const ms = tsMs(v); if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString('pt-BR');
}
function formatarDataHora(v) {
  const ms = tsMs(v); if (!ms) return '—';
  return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function dataInputLocal(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function dataHoraInputLocal(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function hojeInput() {
  return dataInputLocal(new Date());
}
function timestampDataHoraInput(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : firebase.firestore.Timestamp.fromDate(d);
}
function formatarHora(v) {
  const ms = tsMs(v); if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function mesmoMes(ms) {
  if (!ms) return false;
  const d = new Date(ms), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}

function rondaConcluida(r) { return !r.status || r.status === 'concluida'; }
function rondaVisivelParaUsuario(r) {
  if (rondaConcluida(r)) return true;
  if (window._isClienteExterno) return false;
  if (window._isAdmin || window._isSuperAdmin) return true;
  return r.tecnicoUid === window._userUid || r.criadoPorUid === window._userUid;
}
function podeEditarRonda(r) {
  if (window._isClienteExterno) return false;
  if (window._can.editar) return true;
  return r.status === 'rascunho' && (r.tecnicoUid === window._userUid || r.criadoPorUid === window._userUid);
}
function rondasConcluidas() { return _rondas.filter(rondaConcluida); }
function ordenarRondas(a, b) {
  const dataB = tsMs(b.dataRonda) || tsMs(b.horaInicio) || tsMs(b.criadoEmLocal);
  const dataA = tsMs(a.dataRonda) || tsMs(a.horaInicio) || tsMs(a.criadoEmLocal);
  return dataB - dataA;
}

function perfilUsuarioAtual() {
  if (window._isSuperAdmin) return 'superadmin';
  if (window._isAdmin) return 'admin';
  if (window._isClienteExterno) return 'cliente';
  return 'user';
}

function metaLogSegura(meta) {
  const out = {};
  Object.keys(meta || {}).forEach(k => {
    const v = meta[k];
    if (v == null) return;
    if (typeof v === 'string') out[k] = v.slice(0, 500);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  });
  return out;
}

function registrarLog(tipo, acao, detalhe = '', meta = {}) {
  if (!window._userUid) return;
  COL_LOGS().add({
    projeto: 'ronda-linkcall',
    tipo,
    tipoLabel: (LOG_TIPOS[tipo] || {}).label || tipo,
    acao,
    detalhe,
    meta: metaLogSegura(meta),
    view: _viewAtual || '',
    usuarioUid: window._userUid || '',
    usuarioNome: window._userNome || '',
    usuarioEmail: window._userEmail || '',
    perfil: perfilUsuarioAtual(),
    clienteExterno: !!window._isClienteExterno,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoEmLocal: new Date().toISOString(),
  }).catch(e => console.warn('Falha ao registrar log:', e.message));
}

function nomeViewLog(view) {
  return ({
    dashboard: 'Dashboard', rondas: 'Rondas', locais: 'Locais', produtos: 'Produtos / Peças',
    clientes: 'Acessos de Clientes', logs: 'Logs', lixeira: 'Lixeira'
  })[view] || view;
}

function limiteDia(dataStr, fim = false) {
  if (!dataStr) return null;
  const d = new Date(dataStr + (fim ? 'T23:59:59.999' : 'T00:00:00.000'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function intervaloLogsAtual() {
  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  if (_logsFiltroPeriodo === 'hoje') return { inicio: inicioHoje, fim: null };
  if (_logsFiltroPeriodo === '7d') return { inicio: new Date(inicioHoje.getTime() - 6 * 86400000), fim: null };
  if (_logsFiltroPeriodo === '30d') return { inicio: new Date(inicioHoje.getTime() - 29 * 86400000), fim: null };
  if (_logsFiltroPeriodo === 'mesAtual') return { inicio: new Date(agora.getFullYear(), agora.getMonth(), 1), fim: null };
  if (_logsFiltroPeriodo === 'mesPassado') {
    return {
      inicio: new Date(agora.getFullYear(), agora.getMonth() - 1, 1),
      fim: new Date(agora.getFullYear(), agora.getMonth(), 0, 23, 59, 59, 999),
    };
  }
  if (_logsFiltroPeriodo === 'manual') return { inicio: limiteDia(_logsDataInicio), fim: limiteDia(_logsDataFim, true) };
  return { inicio: null, fim: null };
}

function setFiltroPeriodoLogs(valor) {
  _logsFiltroPeriodo = valor;
  const manual = valor === 'manual';
  const campos = document.getElementById('logsDatasManuais');
  if (campos) campos.style.display = manual ? 'flex' : 'none';
  renderListaLogs();
}

/* ── Compressão de imagem → base64 JPEG ───────────── */
function comprimirImagem(file, maxLado = 1024, qualidade = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxLado) { height = Math.round(height * maxLado / width); width = maxLado; }
        else if (height >= width && height > maxLado) { width = Math.round(width * maxLado / height); height = maxLado; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        let q = qualidade;
        let dataUrl = canvas.toDataURL('image/jpeg', q);
        // reduz a qualidade até caber com folga no limite de 1MB/doc do Firestore
        while (dataUrl.length > 720 * 1024 && q > 0.3) { q -= 0.1; dataUrl = canvas.toDataURL('image/jpeg', q); }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    reader.readAsDataURL(file);
  });
}

/* ── Modais / lightbox ────────────────────────────── */
function abrirModal(inner, tamanho = '') {
  document.getElementById('modalRoot').innerHTML =
    `<div class="modal-overlay" onclick="if(event.target===this)fecharModal()">
       <div class="modal ${tamanho}">${inner}</div>
     </div>`;
}
function fecharModal() { document.getElementById('modalRoot').innerHTML = ''; }
function abrirFotoSrc(src) {
  const d = document.createElement('div');
  d.className = 'lightbox';
  d.onclick = () => d.remove();
  const img = document.createElement('img');
  img.src = src;
  d.appendChild(img);
  document.body.appendChild(d);
}

/* ================================================================
   INIT + ROUTER
   ================================================================ */
async function iniciarApp() {
  const can = window._can;

  // rodapé com identificação
  const papel = window._isClienteExterno ? 'Cliente · visualização'
              : window._isAdmin ? 'Administrador' : 'Técnico';
  document.getElementById('sidebarUser').innerHTML =
    `<b>${escapeHTML(window._userNome)}</b><br>${papel}`;

  // revela navegação conforme permissões
  const show = id => { const e = document.getElementById(id); if (e) e.style.display = ''; };
  if (can.gerenciarLocais)   show('navLocais');
  if (can.gerenciarProdutos) show('navProdutos');
  if (can.gerenciarClientes) show('navClientes');
  if (can.gerenciarLocais || can.gerenciarProdutos || can.gerenciarClientes) show('labelCadastros');
  if (can.visualizarLogs) show('navLogs');
  if (can.moverLixeira || can.restaurar || can.apagarPermanente) show('navLixeira');
  if (can.visualizarLogs || can.moverLixeira || can.restaurar || can.apagarPermanente) show('labelFerramentas');

  // zoom de fotos por delegação (evita handlers inline gigantes)
  document.addEventListener('click', e => {
    if (e.target.classList && e.target.classList.contains('zoomable')) abrirFotoSrc(e.target.src);
  });

  try {
    await Promise.all([carregarBase(), carregarRondas()]);
  } catch (e) {
    mostrarNotificacao('Erro ao carregar dados: ' + e.message, 'erro');
  }
  registrarLog('acesso', 'Entrou no projeto', 'Acessou a página da Ronda Linkcall.');
  irPara('dashboard');
}

async function carregarBase() {
  const [ls, ps] = await Promise.all([COL_LOCAIS().get(), COL_PRODUTOS().get()]);
  _locais   = ls.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => !l.deletado);
  _produtos = ps.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.deletado);
  if (window._isClienteExterno) {
    const ok = new Set(window._locaisCliente);
    _locais = _locais.filter(l => ok.has(l.id));
  }
  _locais.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  _produtos.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
}

async function carregarRondas() {
  let docs = [];
  if (window._isAdmin || window._isSuperAdmin) {
    const rs = await COL_RONDAS().get();
    docs = rs.docs;
    normalizarStatusRondasLegado(docs);
  } else {
    const snaps = [await COL_RONDAS().where('status', '==', 'concluida').get()];
    if (!window._isClienteExterno && window._userUid) {
      snaps.push(await COL_RONDAS().where('tecnicoUid', '==', window._userUid).get());
      snaps.push(await COL_RONDAS().where('criadoPorUid', '==', window._userUid).get());
    }
    const porId = new Map();
    snaps.forEach(snap => snap.docs.forEach(d => porId.set(d.id, d)));
    docs = Array.from(porId.values());
  }
  _rondas = docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !r.deletado && rondaVisivelParaUsuario(r));
  if (window._isClienteExterno) {
    const ok = new Set(window._locaisCliente);
    _rondas = _rondas.filter(r => ok.has(r.localId));
  }
  _rondas.sort(ordenarRondas);
}

function normalizarStatusRondasLegado(docs) {
  if (!(window._isAdmin || window._isSuperAdmin)) return;
  const pendentes = docs.filter(d => !d.data().status).slice(0, 400);
  if (!pendentes.length) return;
  Promise.all(pendentes.map(d => d.ref.update({
    status: 'concluida',
    statusMigradoEm: firebase.firestore.FieldValue.serverTimestamp(),
    statusMigradoEmLocal: new Date().toISOString(),
  }).catch(e => console.warn('Falha ao normalizar status da ronda:', d.id, e.message))));
}

function irPara(view) {
  // guarda de navegação (exceção documentada — não é guard de ação)
  const bloqueio = {
    locais:   () => window._can.gerenciarLocais,
    produtos: () => window._can.gerenciarProdutos,
    clientes: () => window._can.gerenciarClientes,
    logs:     () => window._can.visualizarLogs,
    lixeira:  () => window._can.moverLixeira || window._can.restaurar || window._can.apagarPermanente,
  };
  if (bloqueio[view] && !bloqueio[view]()) view = 'dashboard';

  const viewAnterior = _viewAtual;
  _viewAtual = view;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const root = document.getElementById('viewRoot');
  root.innerHTML = '';
  ({
    dashboard: renderDashboard,
    rondas:    renderRondas,
    locais:    renderLocais,
    produtos:  renderProdutos,
    clientes:  renderClientes,
    logs:      renderLogs,
    lixeira:   renderLixeira,
  }[view] || renderDashboard)(root);
  if (view !== viewAnterior) registrarLog('navegacao', 'Entrou na aba', `Acessou a aba ${nomeViewLog(view)}.`, { view, origem: viewAnterior });
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function statusLocal(local) {
  const rondasLocal = rondasConcluidas().filter(r => r.localId === local.id);
  const intervalo = local.intervaloRondaDias || 15;
  if (!rondasLocal.length)
    return { classe: 's-nunca', badge: 'badge-neutro', texto: 'Nunca realizada', ordem: -1, ultima: null };
  const ultima = rondasLocal[0]; // _rondas está em ordem desc
  const dias = Math.floor((Date.now() - tsMs(ultima.dataRonda)) / 86400000);
  const restante = intervalo - dias;
  if (restante < 0)   return { classe: 's-vencida', badge: 'badge-vencida', texto: `Vencida há ${-restante}d`, ordem: 1000 - restante, ultima };
  if (restante <= 3)  return { classe: 's-alerta',  badge: 'badge-alerta',  texto: `Vence em ${restante}d`,   ordem: 500 - restante, ultima };
  return { classe: 's-ok', badge: 'badge-ok', texto: `Em dia · ${restante}d`, ordem: restante, ultima };
}

function renderDashboard(root) {
  const rondasOk = rondasConcluidas();
  const rondasMes = rondasOk.filter(r => mesmoMes(tsMs(r.dataRonda)));
  const status = _locais.map(l => ({ local: l, st: statusLocal(l) }));
  const vencidas = status.filter(s => s.st.classe === 's-vencida').length;
  const pecasMes = rondasMes.reduce((acc, r) => acc + (r.pecasTrocadas || []).reduce((a, p) => a + (Number(p.quantidade) || 1), 0), 0);

  const cabecalho = `
    <div class="view-header">
      <div class="view-title">
        <h2><i class="fas fa-chart-line"></i> Dashboard</h2>
        <p>${window._isClienteExterno ? 'Acompanhamento das rondas do seu local.' : 'Visão geral das rondas técnicas.'}</p>
      </div>
    </div>`;

  const stats = `
    <div class="grid grid-stats">
      ${statCard('si-blue','fas fa-building', _locais.length, window._isClienteExterno ? 'Meus locais' : 'Locais')}
      ${statCard('si-green','fas fa-clipboard-check', rondasMes.length, 'Rondas no mês')}
      ${statCard('si-red','fas fa-triangle-exclamation', vencidas, 'Locais vencidos')}
      ${statCard('si-purple','fas fa-screwdriver-wrench', pecasMes, 'Peças trocadas (mês)')}
    </div>`;

  // Semáforo (vencidas/próximas)
  status.sort((a, b) => b.st.ordem - a.st.ordem);
  const semaforo = status.length ? status.map(s => `
    <div class="semaforo-item ${s.st.classe}">
      <div class="lr-main">
        <div class="lr-title">${escapeHTML(s.local.nome)}</div>
        <div class="lr-sub">${s.st.ultima ? 'Última ronda: ' + formatarData(s.st.ultima.dataRonda) : 'Sem rondas registradas'} · ciclo ${s.local.intervaloRondaDias || 15}d</div>
      </div>
      <span class="badge ${s.st.badge}">${s.st.texto}</span>
      <button class="btn btn-sm" onclick="verHistoricoLocal('${s.local.id}')"><i class="fas fa-clock-rotate-left"></i> Histórico</button>
    </div>`).join('') : `<div class="empty"><i class="fas fa-building"></i>Nenhum local cadastrado.</div>`;

  // Produtividade por técnico (mês) — oculto para cliente externo
  let produtividade = '';
  if (!window._isClienteExterno) {
    const porTec = {};
    rondasMes.forEach(r => { const k = r.tecnicoNome || r.tecnicoEmail || '—'; porTec[k] = (porTec[k] || 0) + 1; });
    const arr = Object.entries(porTec).sort((a, b) => b[1] - a[1]);
    produtividade = `
      <div class="section">
        <div class="section-head"><h3><i class="fas fa-user-gear"></i> Produtividade por técnico (mês)</h3></div>
        <div class="list">
          ${arr.length ? arr.map(([t, n]) => `
            <div class="list-row">
              <div class="lr-main"><div class="lr-title">${escapeHTML(t)}</div></div>
              <span class="badge badge-neutro">${n} ronda${n > 1 ? 's' : ''}</span>
            </div>`).join('') : `<div class="empty"><i class="fas fa-user-gear"></i>Nenhuma ronda neste mês.</div>`}
        </div>
      </div>`;
  }

  // Peças mais trocadas (todas as rondas do escopo)
  const porPeca = {};
  rondasOk.forEach(r => (r.pecasTrocadas || []).forEach(p => {
    const k = p.produtoNome || '—';
    porPeca[k] = (porPeca[k] || 0) + (Number(p.quantidade) || 1);
  }));
  const pecasArr = Object.entries(porPeca).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const pecas = `
    <div class="section">
      <div class="section-head"><h3><i class="fas fa-screwdriver-wrench"></i> Peças mais trocadas</h3></div>
      <div class="list">
        ${pecasArr.length ? pecasArr.map(([nome, q]) => `
          <div class="list-row">
            <div class="lr-main"><div class="lr-title">${escapeHTML(nome)}</div></div>
            <span class="badge badge-neutro">${q}x</span>
          </div>`).join('') : `<div class="empty"><i class="fas fa-screwdriver-wrench"></i>Nenhuma peça registrada ainda.</div>`}
      </div>
    </div>`;

  root.innerHTML = cabecalho + stats + `
    <div class="section">
      <div class="section-head"><h3><i class="fas fa-traffic-light"></i> Situação dos locais (ciclo de ronda)</h3></div>
      <div class="list">${semaforo}</div>
    </div>` + produtividade + pecas;
}

function statCard(cor, icone, valor, label) {
  return `<div class="card stat-card">
    <div class="stat-icon ${cor}"><i class="${icone}"></i></div>
    <div class="stat-value">${valor}</div>
    <div class="stat-label">${escapeHTML(label)}</div>
  </div>`;
}

/* ================================================================
   RONDAS — lista, detalhe, registrar/editar
   ================================================================ */
function renderRondas(root) {
  const podeRegistrar = window._can.registrarRonda && !window._isClienteExterno;
  const opcoesLocais = ['<option value="">Todos os locais</option>']
    .concat(_locais.map(l => `<option value="${l.id}">${escapeHTML(l.nome)}</option>`)).join('');

  root.innerHTML = `
    <div class="view-header">
      <div class="view-title">
        <h2><i class="fas fa-clipboard-check"></i> Rondas</h2>
        <p>Registros de visitas técnicas realizadas.</p>
      </div>
      <div class="view-actions">
        <select class="input" id="filtroLocalRonda" style="width:auto" onchange="renderListaRondas()">${opcoesLocais}</select>
        ${podeRegistrar ? `<button class="btn btn-primary" onclick="abrirFormRonda()"><i class="fas fa-plus"></i> Registrar ronda</button>` : ''}
      </div>
    </div>
    <div class="ronda-selbar" id="rondaSelbar" style="display:none">
      <label class="checkline"><input type="checkbox" id="rondaSelAll" onchange="toggleTodasRondas(this.checked)"> Selecionar todas</label>
      <span class="ronda-sel-count" id="rondaSelCount">Nenhuma ronda selecionada</span>
      <button class="btn btn-primary btn-sm" id="btnGerarPdf" disabled onclick="gerarRelatorioSelecionadas()"><i class="fas fa-file-pdf"></i> Gerar relatório PDF</button>
    </div>
    <div class="list" id="listaRondas"></div>`;
  renderListaRondas();
}

function renderListaRondas() {
  const filtro = (document.getElementById('filtroLocalRonda') || {}).value || '';
  const lista = _rondas.filter(r => !filtro || r.localId === filtro);
  const box = document.getElementById('listaRondas');
  const selbar = document.getElementById('rondaSelbar');
  if (!lista.length) {
    if (selbar) selbar.style.display = 'none';
    box.innerHTML = `<div class="empty"><i class="fas fa-clipboard"></i>Nenhuma ronda registrada.</div>`;
    return;
  }

  const podeLixeira = window._can.moverLixeira && !window._isClienteExterno;

  box.innerHTML = lista.map(r => {
    const catProblema = (r.catracas || []).filter(c => c.estado === 'problema').length;
    const nPecas = (r.pecasTrocadas || []).length;
    const concluida = rondaConcluida(r);
    const periodo = r.horaInicio || r.horaTermino
      ? `${formatarData(r.dataRonda)} · ${formatarHora(r.horaInicio)} - ${formatarHora(r.horaTermino)}`
      : formatarData(r.dataRonda);
    const resumo = [
      !concluida ? `<span class="badge badge-alerta"><i class="fas fa-floppy-disk"></i> Rascunho</span>` : '',
      `<i class="fas fa-user"></i> ${escapeHTML(r.tecnicoNome || r.tecnicoEmail || '—')}`,
      catProblema ? `<span class="badge badge-problema">${catProblema} catraca(s) c/ problema</span>` : '',
      nPecas ? `<span class="badge badge-neutro">${nPecas} peça(s)</span>` : '',
      r.nFotos ? `<span class="badge badge-neutro"><i class="fas fa-camera"></i> ${r.nFotos}</span>` : '',
    ].filter(Boolean).join(' &nbsp; ');
    return `
      <div class="list-row">
        <label class="ronda-check-wrap"><input type="checkbox" class="ronda-check" value="${r.id}" ${concluida ? '' : 'disabled'} onchange="atualizarSelecaoRondas()"></label>
        <div class="lr-main">
          <div class="lr-title">${escapeHTML(r.localNome || '—')} · ${periodo}</div>
          <div class="lr-sub">${resumo}</div>
        </div>
        <div class="lr-actions">
          <button class="btn btn-sm" onclick="verRonda('${r.id}')"><i class="fas fa-eye"></i> Ver</button>
          ${podeEditarRonda(r) ? `<button class="btn btn-sm" onclick="abrirFormRonda('${r.id}')"><i class="fas fa-pen"></i> ${concluida ? '' : 'Continuar'}</button>` : ''}
          ${podeLixeira ? `<button class="btn btn-sm btn-danger" onclick="moverRondaLixeira('${r.id}')"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>`;
  }).join('');

  if (selbar) selbar.style.display = 'flex';
  const selAll = document.getElementById('rondaSelAll');
  if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
  atualizarSelecaoRondas();
}

/* ── Seleção + relatório PDF ───────────────────────── */
function atualizarSelecaoRondas() {
  const checks = Array.from(document.querySelectorAll('.ronda-check:not(:disabled)'));
  const sel = checks.filter(c => c.checked);
  const count = document.getElementById('rondaSelCount');
  const btn = document.getElementById('btnGerarPdf');
  const selAll = document.getElementById('rondaSelAll');
  if (count) count.textContent = sel.length ? `${sel.length} ronda(s) selecionada(s)` : 'Nenhuma ronda selecionada';
  if (btn) btn.disabled = sel.length === 0;
  if (selAll) {
    selAll.checked = sel.length > 0 && sel.length === checks.length;
    selAll.indeterminate = sel.length > 0 && sel.length < checks.length;
  }
}

function toggleTodasRondas(marcar) {
  document.querySelectorAll('.ronda-check:not(:disabled)').forEach(c => { c.checked = marcar; });
  atualizarSelecaoRondas();
}

async function gerarRelatorioSelecionadas() {
  const ids = Array.from(document.querySelectorAll('.ronda-check:checked')).map(c => c.value);
  if (!ids.length) return mostrarNotificacao('Selecione ao menos uma ronda.', 'erro');
  await gerarRelatorioRondas(ids);
}

async function gerarRelatorioRondas(ids) {
  const btn = document.getElementById('btnGerarPdf');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando…'; }
  try {
    const rondas = ids.map(id => _rondas.find(r => r.id === id)).filter(Boolean)
      .filter(rondaConcluida)
      .sort((a, b) => tsMs(a.dataRonda) - tsMs(b.dataRonda));
    if (!rondas.length) { mostrarNotificacao('Selecione ao menos uma ronda concluída.', 'erro'); return; }
    // busca as fotos de cada ronda (subcoleção)
    const fotosPorRonda = {};
    await Promise.all(rondas.map(async r => {
      try { const snap = await SUB_FOTOS(r.id).get(); fotosPorRonda[r.id] = snap.docs.map(d => d.data()); }
      catch (e) { fotosPorRonda[r.id] = []; }
    }));
    const win = window.open('', '_blank');
    if (!win) { mostrarNotificacao('Permita pop-ups para gerar o relatório.', 'erro'); return; }
    win.document.open();
    win.document.write(montarHTMLRelatorio(rondas, fotosPorRonda));
    win.document.close();
    registrarLog('relatorio', 'Gerou relatório PDF', `Gerou relatório com ${rondas.length} ronda(s).`, { quantidade: rondas.length });
  } catch (e) {
    mostrarNotificacao('Erro ao gerar relatório: ' + e.message, 'erro');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-pdf"></i> Gerar relatório PDF'; }
  }
}

function montarHTMLRelatorio(rondas, fotosPorRonda) {
  const projNome = ((document.querySelector('.sidebar-brand h1') || {}).textContent || 'Rondas').trim();
  const geradoEm = new Date().toLocaleString('pt-BR');
  const esc = escapeHTML;

  const datas = rondas.map(r => tsMs(r.dataRonda)).filter(Boolean).sort((a, b) => a - b);
  const periodo = datas.length ? `${formatarData(datas[0])} — ${formatarData(datas[datas.length - 1])}` : '—';
  const totalProblema = rondas.reduce((a, r) => a + (r.catracas || []).filter(c => c.estado === 'problema').length, 0);
  const totalPecas = rondas.reduce((a, r) => a + (r.pecasTrocadas || []).reduce((s, p) => s + (Number(p.quantidade) || 1), 0), 0);

  const pill = (txt, cls) => `<span class="pill ${cls}">${esc(txt)}</span>`;
  const thumb = f => `<figure class="ph"><img src="${f.base64}" alt="foto">${(f.secao || f.legenda) ? `<figcaption>${esc((f.secao || '') + (f.legenda ? ' · ' + f.legenda : ''))}</figcaption>` : ''}</figure>`;
  const pecasTabela = (pecas) => `
    <table class="pecas">
      <thead><tr><th>Peça</th><th class="c">Qtd</th><th>Observação</th></tr></thead>
      <tbody>${pecas.map(p => `<tr><td>${esc(p.produtoNome || '—')}</td><td class="c">${esc(String(p.quantidade || 1))}</td><td>${esc(p.obs || '')}</td></tr>`).join('')}</tbody>
    </table>`;

  const rondaSec = (r, i) => {
    const fotos = fotosPorRonda[r.id] || [];
    const fotosDe = cid => fotos.filter(f => (f.catracaId || null) === cid);
    const fotosGerais = fotos.filter(f => !f.catracaId);
    const cats = (r.catracas || []);
    const catProblema = cats.filter(c => c.estado === 'problema').length;
    const catracasHTML = cats.length ? cats.map(c => {
      const pecas = Array.isArray(c.pecas) ? c.pecas : [];
      const cf = fotosDe(c.catracaId);
      return `
        <div class="cat">
          <div class="cat-h">
            <span class="cat-n">${esc(c.nome)}</span>
            ${c.estado === 'problema' ? pill('Problema', 'bad') : pill('OK', 'ok')}
          </div>
          ${c.obs ? `<div class="obs">${esc(c.obs)}</div>` : ''}
          ${pecas.length ? `<div class="sub"><div class="sub-t">Peças trocadas</div>${pecasTabela(pecas)}</div>` : ''}
          ${cf.length ? `<div class="sub"><div class="sub-t">Fotos da catraca</div><div class="grid">${cf.map(thumb).join('')}</div></div>` : ''}
        </div>`;
    }).join('') : '<div class="muted">Sem catracas registradas.</div>';

    const pecasSemCat = (r.pecasTrocadas || []).filter(p => !p.catracaId);

    return `
      <section class="ronda ${i > 0 ? 'brk' : ''}">
        <div class="r-head">
          <div>
            <div class="r-local">${esc(r.localNome || '—')}</div>
            <div class="r-meta">${formatarData(r.dataRonda)} &nbsp;·&nbsp; ${formatarHora(r.horaInicio)} - ${formatarHora(r.horaTermino)} &nbsp;·&nbsp; <i>Técnico:</i> ${esc(r.tecnicoNome || r.tecnicoEmail || '—')}</div>
          </div>
          <div class="r-tags">${catProblema ? pill(catProblema + ' catraca(s) c/ problema', 'bad') : pill('Catracas OK', 'ok')}</div>
        </div>

        <div class="cols">
          <div class="info"><span class="info-k">Local visto:</span>${r.localVisto && r.localVisto.ok ? pill('OK', 'ok') : pill('Com ressalva', 'warn')}</div>
        </div>
        ${(r.localVisto && r.localVisto.obs) ? `<div class="obs">${esc(r.localVisto.obs)}</div>` : ''}

        <h3 class="blk-t">Catracas</h3>
        ${catracasHTML}
        ${pecasSemCat.length ? `<h3 class="blk-t">Peças trocadas (sem catraca)</h3>${pecasTabela(pecasSemCat)}` : ''}
        ${r.demaisInfos ? `<h3 class="blk-t">Demais informações</h3><div class="obs pre">${esc(r.demaisInfos)}</div>` : ''}
        ${fotosGerais.length ? `<h3 class="blk-t">Fotos gerais</h3><div class="grid">${fotosGerais.map(thumb).join('')}</div>` : ''}
      </section>`;
  };

  const css = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; color:#1f2937; font-size:12px; line-height:1.5; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .muted { color:#6b7280; font-size:11px; }
    .cover { padding:34px 40px 26px; border-bottom:3px solid #3b82f6; }
    .brand { font-size:22px; font-weight:800; letter-spacing:.5px; color:#0f172a; }
    .brand span { color:#3b82f6; font-weight:600; margin-left:5px; }
    .cover h1 { font-size:26px; margin-top:18px; color:#0f172a; }
    .cover-sub { font-size:14px; color:#3b82f6; font-weight:600; margin-top:2px; }
    .cover-meta { display:flex; gap:28px; margin-top:22px; flex-wrap:wrap; }
    .cover-meta > div { display:flex; flex-direction:column; }
    .cover-meta span { font-size:9.5px; text-transform:uppercase; letter-spacing:.06em; color:#6b7280; }
    .cover-meta b { font-size:16px; color:#0f172a; margin-top:3px; font-weight:700; }
    .cover-foot { margin-top:18px; font-size:10.5px; color:#9ca3af; }
    .ronda { padding:24px 40px; }
    .ronda.brk { break-before:page; }
    .r-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:1px solid #e5e7eb; padding-bottom:12px; margin-bottom:14px; }
    .r-local { font-size:17px; font-weight:700; color:#0f172a; }
    .r-meta { font-size:11.5px; color:#6b7280; margin-top:3px; }
    .r-meta i { font-style:normal; color:#9ca3af; }
    .blk-t { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#3b82f6; font-weight:700; margin:16px 0 8px; }
    .cols { display:flex; gap:26px; flex-wrap:wrap; }
    .info { display:flex; align-items:center; gap:8px; }
    .info-k { font-size:11.5px; color:#6b7280; }
    .cat { border:1px solid #e5e7eb; border-radius:10px; padding:12px 14px; margin-bottom:10px; break-inside:avoid; }
    .cat-h { display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .cat-n { font-weight:700; font-size:13px; color:#111827; }
    .sub { margin-top:10px; }
    .sub-t { font-size:9.5px; text-transform:uppercase; letter-spacing:.05em; color:#6b7280; font-weight:700; margin-bottom:5px; }
    .obs { font-size:11.5px; color:#374151; margin-top:6px; background:#f9fafb; border-left:3px solid #cbd5e1; padding:6px 10px; border-radius:0 6px 6px 0; }
    .obs.pre { white-space:pre-wrap; }
    .pill { display:inline-block; font-size:9.5px; font-weight:700; padding:2px 9px; border-radius:999px; }
    .pill.ok { background:#dcfce7; color:#166534; }
    .pill.bad { background:#fee2e2; color:#991b1b; }
    .pill.warn { background:#fef3c7; color:#92400e; }
    table.pecas { width:100%; border-collapse:collapse; font-size:11px; margin-top:2px; }
    table.pecas th { text-align:left; background:#f3f4f6; color:#4b5563; font-weight:700; padding:6px 9px; font-size:9.5px; text-transform:uppercase; letter-spacing:.03em; }
    table.pecas td { padding:6px 9px; border-bottom:1px solid #eef0f2; }
    table.pecas .c { text-align:center; width:52px; }
    .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
    .ph { border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; break-inside:avoid; background:#f9fafb; }
    .ph img { width:100%; height:118px; object-fit:cover; display:block; }
    .ph figcaption { font-size:9px; color:#6b7280; padding:4px 6px; text-transform:capitalize; }
    .pg-foot { text-align:center; font-size:9.5px; color:#9ca3af; padding:16px 40px 26px; border-top:1px solid #e5e7eb; margin-top:12px; }
    @page { size:A4; margin:14mm 0; }
    @media print { .ronda,.cat,.ph { break-inside:avoid; } }`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório de Rondas — ${esc(projNome)}</title>
<style>${css}</style></head>
<body>
  <header class="cover">
    <div class="brand">AUDICOM<span>Telecom</span></div>
    <h1>Relatório de Rondas</h1>
    <div class="cover-sub">${esc(projNome)}</div>
    <div class="cover-meta">
      <div><span>Rondas</span><b>${rondas.length}</b></div>
      <div><span>Período</span><b>${esc(periodo)}</b></div>
      <div><span>Catracas c/ problema</span><b>${totalProblema}</b></div>
      <div><span>Peças trocadas</span><b>${totalPecas}</b></div>
    </div>
    <div class="cover-foot">Gerado em ${esc(geradoEm)}</div>
  </header>
  ${rondas.map(rondaSec).join('')}
  <footer class="pg-foot">AUDICOM Telecom · Relatório de Rondas · ${esc(projNome)}</footer>
  <script>
    window.addEventListener('load', function () {
      var imgs = Array.prototype.slice.call(document.images);
      Promise.all(imgs.map(function (img) {
        return img.complete ? Promise.resolve() : new Promise(function (res) { img.onload = img.onerror = res; });
      })).then(function () { setTimeout(function () { window.print(); }, 250); });
    });
  <\/script>
</body></html>`;
}

async function verRonda(id) {
  const r = _rondas.find(x => x.id === id);
  if (!r) return;
  registrarLog('visualizacao', 'Visualizou ronda', `Visualizou a ronda de ${r.localNome || 'local'} em ${formatarData(r.dataRonda)}.`, { itemTipo: 'ronda', itemId: id, localId: r.localId || '' });
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-clipboard-check"></i> Ronda — ${escapeHTML(r.localNome || '')}</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body" id="detalheRonda"><div class="loading-inline">Carregando fotos…</div></div>
  `, 'modal-lg');

  // carrega fotos da subcoleção e agrupa por catraca
  let fotos = [];
  try { const snap = await SUB_FOTOS(id).get(); fotos = snap.docs.map(d => d.data()); }
  catch (e) { fotos = null; }

  const box = document.getElementById('detalheRonda');
  const linha = (label, val) => `<div class="ronda-block"><div class="rb-title">${label}</div>${val}</div>`;
  const thumb = f => `<div class="foto-thumb"><img class="zoomable" src="${f.base64}" alt="foto">${f.secao ? '<span class="foto-sec-tag">' + escapeHTML(f.secao) + (f.legenda ? ' · ' + escapeHTML(f.legenda) : '') + '</span>' : ''}</div>`;
  const pecaRow = p => `<div class="list-row"><div class="lr-main"><div class="lr-title">${escapeHTML(p.produtoNome)}</div>${p.obs ? '<div class="lr-sub">' + escapeHTML(p.obs) + '</div>' : ''}</div><span class="badge badge-neutro">${escapeHTML(String(p.quantidade || 1))}x</span></div>`;
  const fotosOK = Array.isArray(fotos);
  const fotosDaCatraca = cid => fotosOK ? fotos.filter(f => (f.catracaId || null) === cid) : [];
  const fotosGerais = fotosOK ? fotos.filter(f => !f.catracaId) : [];

  const catracasHtml = (r.catracas || []).length
    ? (r.catracas || []).map(c => {
        const pecas = Array.isArray(c.pecas) ? c.pecas : [];
        const cf = fotosDaCatraca(c.catracaId);
        return `<div class="catraca-card">
          <div class="catraca-head">
            <div class="catraca-nome">${escapeHTML(c.nome)}</div>
            <span class="badge ${c.estado === 'problema' ? 'badge-problema' : 'badge-ok'}">${c.estado === 'problema' ? 'Problema' : 'OK'}</span>
          </div>
          ${c.obs ? '<div class="lr-sub" style="margin-top:6px">' + escapeHTML(c.obs) + '</div>' : ''}
          ${pecas.length ? '<div class="cat-sub"><div class="cat-sub-label">Peças trocadas</div><div class="list">' + pecas.map(pecaRow).join('') + '</div></div>' : ''}
          ${cf.length ? '<div class="cat-sub"><div class="cat-sub-label">Fotos</div><div class="foto-grid">' + cf.map(thumb).join('') + '</div></div>' : ''}
        </div>`;
      }).join('')
    : '<span style="color:var(--muted)">Sem catracas registradas.</span>';

  // compat: rondas antigas com peças não vinculadas a catraca
  const pecasSemCatraca = (r.pecasTrocadas || []).filter(p => !p.catracaId);
  const pecasLegadoHtml = pecasSemCatraca.length
    ? linha('<i class="fas fa-screwdriver-wrench"></i> Peças trocadas (sem catraca)', '<div class="list">' + pecasSemCatraca.map(pecaRow).join('') + '</div>')
    : '';

  const geraisHtml = !fotosOK
    ? '<span style="color:var(--danger)">Erro ao carregar fotos.</span>'
    : (fotosGerais.length ? '<div class="foto-grid">' + fotosGerais.map(thumb).join('') + '</div>' : '<span style="color:var(--muted)">Sem fotos gerais.</span>');

  box.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${rondaConcluida(r) ? '<span class="badge badge-ok"><i class="fas fa-check"></i> Concluída</span>' : '<span class="badge badge-alerta"><i class="fas fa-floppy-disk"></i> Rascunho</span>'}
      <span class="badge badge-neutro"><i class="fas fa-calendar"></i> ${formatarData(r.dataRonda)}</span>
      <span class="badge badge-neutro"><i class="fas fa-clock"></i> Início: ${formatarDataHora(r.horaInicio)}</span>
      <span class="badge badge-neutro"><i class="fas fa-flag-checkered"></i> Término: ${formatarDataHora(r.horaTermino)}</span>
      <span class="badge badge-neutro"><i class="fas fa-user"></i> ${escapeHTML(r.tecnicoNome || r.tecnicoEmail || '—')}</span>
    </div>
    ${linha('<i class="fas fa-eye"></i> Local visto', (r.localVisto && r.localVisto.ok ? '<span class="badge badge-ok">OK</span>' : '<span class="badge badge-alerta">Com ressalva</span>') + (r.localVisto && r.localVisto.obs ? '<div class="lr-sub" style="margin-top:8px">' + escapeHTML(r.localVisto.obs) + '</div>' : ''))}
    ${linha('<i class="fas fa-door-closed"></i> Catracas', catracasHtml)}
    ${pecasLegadoHtml}
    ${r.demaisInfos ? linha('<i class="fas fa-note-sticky"></i> Demais informações', '<div style="white-space:pre-wrap">' + escapeHTML(r.demaisInfos) + '</div>') : ''}
    ${linha('<i class="fas fa-camera"></i> Fotos gerais', geraisHtml)}`;
}

/* ── Formulário de ronda (registrar / editar) ─────── */
async function abrirFormRonda(id = null) {
  _rondaEdit = id;
  _fotosRonda = [];
  _estadosCatraca = {};
  _catracasForm = [];
  _rondaEraRascunho = false;
  _autosaveRondaAtivo = false;
  _autosaveRondaPendente = false;
  clearTimeout(_autosaveRondaTimer);

  const r = id ? _rondas.find(x => x.id === id) : null;
  _rondaEraRascunho = !!(r && r.status === 'rascunho');
  const inicioValor = r && r.horaInicio ? dataHoraInputLocal(new Date(tsMs(r.horaInicio))).slice(11,16) : dataHoraInputLocal(new Date()).slice(11,16);
  const terminoValor = r && r.horaTermino ? dataHoraInputLocal(new Date(tsMs(r.horaTermino))).slice(11,16) : '';

  // técnicos (admin pode escolher outro)
  let tecOptions = '';
  if (window._isAdmin) {
    const tecs = await carregarTecnicos();
    const selUid = r ? r.tecnicoUid : window._userUid;
    tecOptions = tecs.map(t => `<option value="${t.id}" ${t.id === selUid ? 'selected' : ''}>${escapeHTML(t.name || t.email)}</option>`).join('');
  }

  const opcoesLocais = _locais.map(l => `<option value="${l.id}" ${r && r.localId === l.id ? 'selected' : ''}>${escapeHTML(l.nome)}</option>`).join('');

  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-clipboard-check"></i> ${r ? 'Editar' : 'Registrar'} ronda</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body" id="formRondaBody">
      <div class="form-row">
        <div class="form-group">
          <label class="field-label">Local *</label>
          <select class="input" id="rLocal" onchange="carregarCatracasForm()">
            <option value="">Selecione…</option>${opcoesLocais}
          </select>
        </div>
        <div class="form-group">
          <label class="field-label">Data da ronda *</label>
          <input type="date" class="input" id="rData" value="${r ? new Date(tsMs(r.dataRonda)).toISOString().slice(0,10) : hojeInput()}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="field-label">Hora de início *</label>
          <input type="time" class="input" id="rHoraInicio" value="${inicioValor}">
        </div>
        <div class="form-group">
          <label class="field-label">Hora de término</label>
          <input type="time" class="input" id="rHoraTermino" value="${terminoValor}">
        </div>
      </div>
      ${window._isAdmin ? `<div class="form-group"><label class="field-label">Técnico responsável</label><select class="input" id="rTecnico">${tecOptions}</select></div>` : ''}

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-eye"></i> Local visto</div>
        <label class="checkline"><input type="checkbox" id="rLocalOk" ${!r || (r.localVisto && r.localVisto.ok) ? 'checked' : ''}> Tudo certo no local</label>
        <div class="form-group" style="margin-top:10px"><textarea class="input" id="rLocalObs" placeholder="Observações do local…">${r && r.localVisto ? escapeHTML(r.localVisto.obs || '') : ''}</textarea></div>
      </div>

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-door-closed"></i> Catracas</div>
        <div class="rb-hint">Para cada catraca: estado, peças trocadas e fotos específicas dela.</div>
        <div id="catracasBox"><span style="color:var(--muted)">Selecione um local para carregar as catracas.</span></div>
      </div>

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-note-sticky"></i> Demais informações</div>
        <textarea class="input" id="rInfos" placeholder="Outras observações da ronda…">${r ? escapeHTML(r.demaisInfos || '') : ''}</textarea>
      </div>

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-camera"></i> Fotos gerais</div>
        <div class="rb-hint">Fotos do local e visão geral. As fotos de cada catraca ficam dentro dela, acima.</div>
        <div style="display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap">
          <label class="field-label" style="margin:0">Seção da próxima foto:</label>
          <select class="input" id="fotoSecao" style="width:auto"><option value="geral">Geral</option><option value="local">Local</option></select>
        </div>
        <div class="foto-grid" id="fotosBox"></div>
        <input type="file" id="fotoInput" accept="image/*" multiple style="display:none" onchange="adicionarFotos(this.files)">
      </div>
    </div>
    <div class="modal-footer">
      <span id="rAutosaveStatus" class="autosave-status"><i class="fas fa-floppy-disk"></i> Preparando rascunho…</span>
      <button class="btn" onclick="fecharModal()">Fechar</button>
      <button class="btn btn-primary" id="btnSalvarRonda" onclick="salvarRonda()"><i class="fas fa-check"></i> ${r ? 'Salvar alterações' : 'Registrar'}</button>
    </div>
  `, 'modal-lg');

  prepararAutosaveRonda();
  if (!r) await garantirDocumentoRascunhoRonda();
  else setAutosaveRondaStatus(r.status === 'rascunho' ? 'Rascunho recuperado.' : 'Alterações serão salvas automaticamente.');
  _autosaveRondaAtivo = true;

  // fotos existentes (edição) — carregadas ANTES das catracas p/ vincular cada foto à sua catraca
  if (r) {
    try {
      const snap = await SUB_FOTOS(id).get();
      _fotosRonda = snap.docs.map(d => ({ id: d.id, base64: d.data().base64, secao: d.data().secao || 'geral', legenda: d.data().legenda || '', catracaId: d.data().catracaId || null, catracaNome: d.data().catracaNome || '', _nova: false, _removida: false }));
    } catch (e) { /* silencioso */ }
  }
  renderFotosGerais();
  // catracas do local — peças e fotos ficam DENTRO de cada catraca (carregadas lá)
  if (r && r.localId) await carregarCatracasForm();
}

function setAutosaveRondaStatus(txt, erro = false) {
  const el = document.getElementById('rAutosaveStatus');
  if (!el) return;
  el.style.color = erro ? 'var(--danger)' : 'var(--muted)';
  el.innerHTML = `<i class="fas ${erro ? 'fa-triangle-exclamation' : 'fa-floppy-disk'}"></i> ${escapeHTML(txt)}`;
}

function prepararAutosaveRonda() {
  const body = document.getElementById('formRondaBody');
  if (!body) return;
  body.addEventListener('input', agendarAutosaveRonda);
  body.addEventListener('change', agendarAutosaveRonda);
}

function agendarAutosaveRonda() {
  if (!_autosaveRondaAtivo) return;
  clearTimeout(_autosaveRondaTimer);
  setAutosaveRondaStatus('Alterações pendentes…');
  _autosaveRondaTimer = setTimeout(executarAutosaveRonda, 1200);
}

async function garantirDocumentoRascunhoRonda() {
  if (_rondaEdit) return _rondaEdit;
  const dados = coletarDadosFormRonda('rascunho');
  dados.criadoPor = window._userEmail || '';
  dados.criadoPorUid = window._userUid || '';
  dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
  dados.criadoEmLocal = new Date().toISOString();
  try {
    const ref = await COL_RONDAS().add(dados);
    _rondaEdit = ref.id;
    _rondaEraRascunho = true;
    setAutosaveRondaStatus('Rascunho iniciado e salvo.');
    return ref.id;
  } catch (e) {
    setAutosaveRondaStatus('Falha ao iniciar rascunho: ' + e.message, true);
    throw e;
  }
}

function tecnicoSelecionadoRonda(rExist) {
  let tecnicoUid  = rExist ? rExist.tecnicoUid   : window._userUid;
  let tecnicoNome = rExist ? rExist.tecnicoNome  : window._userNome;
  let tecnicoEmail= rExist ? rExist.tecnicoEmail : window._userEmail;
  if (window._isAdmin && document.getElementById('rTecnico')) {
    const uid = document.getElementById('rTecnico').value;
    const t = (_tecnicos || []).find(x => x.id === uid);
    if (t) { tecnicoUid = t.id; tecnicoNome = t.name || t.email; tecnicoEmail = t.email; }
  }
  return { tecnicoUid, tecnicoNome, tecnicoEmail };
}

function coletarCatracasFormRonda() {
  return _catracasForm.map(c => {
    const pecasCat = [];
    document.querySelectorAll('#catPecas_' + c.id + ' .peca-linha').forEach(div => {
      const pid = div.querySelector('.peca-produto').value;
      if (!pid) return;
      const prod = _produtos.find(p => p.id === pid);
      pecasCat.push({ produtoId: pid, produtoNome: prod ? prod.nome : '', quantidade: Number(div.querySelector('.peca-qtd').value) || 1, obs: div.dataset.obs || '' });
    });
    return {
      catracaId: c.id, nome: c.nome,
      estado: _estadosCatraca[c.id] || 'ok',
      obs: (document.getElementById('catObs_' + c.id) || {}).value || '',
      pecas: pecasCat
    };
  });
}

function coletarDadosFormRonda(status) {
  const localId = (document.getElementById('rLocal') || {}).value || '';
  const dataStr = (document.getElementById('rData') || {}).value || '';
  const local = _locais.find(l => l.id === localId);
  const rExist = _rondaEdit ? _rondas.find(x => x.id === _rondaEdit) : null;
  const tecnico = tecnicoSelecionadoRonda(rExist);
  const catracas = coletarCatracasFormRonda();
  const pecasTrocadas = [];
  catracas.forEach(c => (c.pecas || []).forEach(p => pecasTrocadas.push({ ...p, catracaId: c.catracaId, catracaNome: c.nome })));
  if (rExist && Array.isArray(rExist.pecasTrocadas)) {
    rExist.pecasTrocadas.filter(p => !p.catracaId).forEach(p => pecasTrocadas.push(p));
  }
  return {
    localId, localNome: local ? local.nome : '',
    ...tecnico,
    dataRonda: dataStr ? firebase.firestore.Timestamp.fromDate(new Date(dataStr + 'T12:00:00')) : null,
    horaInicio: (() => { const h = (document.getElementById('rHoraInicio') || {}).value || ''; return h ? timestampDataHoraInput(dataStr + 'T' + h) : null; })(),
    horaTermino: (() => { const h = (document.getElementById('rHoraTermino') || {}).value || ''; return h ? timestampDataHoraInput(dataStr + 'T' + h) : null; })(),
    horaInicioLocal: (() => { const h = (document.getElementById('rHoraInicio') || {}).value || ''; return h ? dataStr + 'T' + h : ''; })(),
    horaTerminoLocal: (() => { const h = (document.getElementById('rHoraTermino') || {}).value || ''; return h ? dataStr + 'T' + h : ''; })(),
    localVisto: { ok: !!(document.getElementById('rLocalOk') || {}).checked, obs: ((document.getElementById('rLocalObs') || {}).value || '').trim() },
    catracas, pecasTrocadas,
    demaisInfos: ((document.getElementById('rInfos') || {}).value || '').trim(),
    status,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    atualizadoEmLocal: new Date().toISOString(),
  };
}

async function carregarTecnicos() {
  if (_tecnicos) return _tecnicos;
  const s = await db.collection('users').get();
  _tecnicos = s.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => !u.rondaLinkcallCliente && (u.role === 'admin' || u.role === 'superadmin' || (u.projects && u.projects['ronda-linkcall'])))
    .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  return _tecnicos;
}

async function carregarCatracasForm() {
  const localId = document.getElementById('rLocal').value;
  const box = document.getElementById('catracasBox');
  if (!localId) { box.innerHTML = '<span style="color:var(--muted)">Selecione um local para carregar as catracas.</span>'; agendarAutosaveRonda(); return; }
  box.innerHTML = '<div class="loading-inline">Carregando catracas…</div>';
  try {
    const snap = await SUB_CATRACAS(localId).get();
    _catracasForm = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.ativa !== false);
    // pré-carrega estados salvos (edição)
    const r = _rondaEdit ? _rondas.find(x => x.id === _rondaEdit) : null;
    _estadosCatraca = {};
    _catracasForm.forEach(c => {
      const salvo = r && (r.catracas || []).find(x => x.catracaId === c.id);
      _estadosCatraca[c.id] = salvo ? salvo.estado : 'ok';
    });
    if (!_catracasForm.length) { box.innerHTML = '<span style="color:var(--muted)">Este local não tem catracas cadastradas.</span>'; agendarAutosaveRonda(); return; }
    box.innerHTML = _catracasForm.map(c => {
      const est = _estadosCatraca[c.id];
      const obsSalvo = r ? ((r.catracas || []).find(x => x.catracaId === c.id) || {}).obs || '' : '';
      return `<div class="catraca-card" id="catCard_${c.id}">
        <div class="catraca-head">
          <div class="catraca-nome">${escapeHTML(c.nome)}</div>
          <div class="estado-toggle" id="toggle_${c.id}">
            <button type="button" class="${est === 'ok' ? 'on-ok' : ''}" onclick="setEstadoCatraca('${c.id}','ok')">OK</button>
            <button type="button" class="${est === 'problema' ? 'on-problema' : ''}" onclick="setEstadoCatraca('${c.id}','problema')">Problema</button>
          </div>
        </div>
        <input class="input" style="margin-top:10px;font-size:13px;padding:8px 10px" id="catObs_${c.id}" placeholder="Observação (opcional)" value="${escaparAttr(obsSalvo)}">
        <div class="cat-sub">
          <div class="cat-sub-label"><i class="fas fa-screwdriver-wrench"></i> Peças trocadas nesta catraca</div>
          <div id="catPecas_${c.id}"></div>
          <button class="btn btn-sm" type="button" onclick="addPecaLinhaCatraca('${c.id}')" style="margin-top:6px"><i class="fas fa-plus"></i> Adicionar peça</button>
        </div>
        <div class="cat-sub">
          <div class="cat-sub-label"><i class="fas fa-camera"></i> Fotos desta catraca</div>
          <div class="foto-grid" id="catFotos_${c.id}"></div>
          <input type="file" id="catFotoInput_${c.id}" accept="image/*" multiple style="display:none" onchange="adicionarFotosCatraca('${c.id}', this.files)">
        </div>
      </div>`;
    }).join('');
    // preenche peças salvas e renderiza fotos de cada catraca
    _catracasForm.forEach(c => {
      const salvo = r ? (r.catracas || []).find(x => x.catracaId === c.id) : null;
      const pecasSalvas = salvo && Array.isArray(salvo.pecas) ? salvo.pecas : [];
      pecasSalvas.forEach(p => addPecaLinhaCatraca(c.id, p));
      renderFotosCatraca(c.id);
    });
    agendarAutosaveRonda();
  } catch (e) {
    box.innerHTML = '<span style="color:var(--danger)">Erro ao carregar catracas.</span>';
  }
}

function setEstadoCatraca(id, estado) {
  _estadosCatraca[id] = estado;
  const t = document.getElementById('toggle_' + id);
  if (!t) return;
  const [bOk, bPb] = t.querySelectorAll('button');
  bOk.className = estado === 'ok' ? 'on-ok' : '';
  bPb.className = estado === 'problema' ? 'on-problema' : '';
  agendarAutosaveRonda();
}

function addPecaLinhaCatraca(catracaId, dados = null) {
  const box = document.getElementById('catPecas_' + catracaId);
  if (!box) return;
  const idLinha = 'peca_' + Math.random().toString(36).slice(2, 8);
  const opts = _produtos.map(p => `<option value="${p.id}" ${dados && dados.produtoId === p.id ? 'selected' : ''}>${escapeHTML(p.nome)}</option>`).join('');
  const div = document.createElement('div');
  div.className = 'peca-linha';
  div.id = idLinha;
  div.innerHTML = `
    <select class="input peca-produto">${_produtos.length ? '<option value="">Selecione a peça…</option>' + opts : '<option value="">Nenhum produto cadastrado</option>'}</select>
    <input type="number" min="1" class="input peca-qtd" value="${dados ? (dados.quantidade || 1) : 1}" placeholder="Qtd">
    <button class="btn btn-sm btn-danger" type="button" onclick="document.getElementById('${idLinha}').remove();agendarAutosaveRonda()"><i class="fas fa-times"></i></button>`;
  box.appendChild(div);
  if (dados && dados.obs) div.dataset.obs = dados.obs; // preserva obs (persistência simples)
  if (!dados) agendarAutosaveRonda();
}

function adicionarFotos(files) {
  const secao = (document.getElementById('fotoSecao') || {}).value || 'geral';
  const arr = Array.from(files);
  const btn = document.getElementById('btnSalvarRonda');
  if (btn) btn.disabled = true;
  Promise.all(arr.map(f => comprimirImagem(f, 1024, 0.65)
    .then(base64 => _fotosRonda.push({ base64, secao, legenda: '', catracaId: null, catracaNome: '', _nova: true, _removida: false }))
    .catch(() => mostrarNotificacao('Falha ao processar uma imagem', 'erro'))
  )).then(() => { if (btn) btn.disabled = false; renderFotosGerais(); agendarAutosaveRonda(); });
  document.getElementById('fotoInput').value = '';
}

function adicionarFotosCatraca(catracaId, files) {
  const cat = _catracasForm.find(c => c.id === catracaId);
  const arr = Array.from(files);
  const btn = document.getElementById('btnSalvarRonda');
  if (btn) btn.disabled = true;
  Promise.all(arr.map(f => comprimirImagem(f, 1024, 0.65)
    .then(base64 => _fotosRonda.push({ base64, secao: 'catraca', legenda: '', catracaId, catracaNome: cat ? cat.nome : '', _nova: true, _removida: false }))
    .catch(() => mostrarNotificacao('Falha ao processar uma imagem', 'erro'))
  )).then(() => { if (btn) btn.disabled = false; renderFotosCatraca(catracaId); agendarAutosaveRonda(); });
  const input = document.getElementById('catFotoInput_' + catracaId);
  if (input) input.value = '';
}

// monta os thumbs (com botão remover) + tile de upload de um conjunto de fotos
function _fotoThumbsHTML(fotos, uploadOnclick) {
  return fotos.map(f => {
      const idx = _fotosRonda.indexOf(f);
      return `<div class="foto-thumb">
        <img class="zoomable" src="${f.base64}" alt="foto">
        <button class="foto-del" type="button" onclick="removerFotoRonda(${idx})"><i class="fas fa-times"></i></button>
        <span class="foto-sec-tag">${escapeHTML(f.secao || 'geral')}</span>
      </div>`;
    }).join('') +
    `<div class="foto-upload" onclick="${uploadOnclick}">
       <i class="fas fa-camera"></i><span>Adicionar foto</span>
     </div>`;
}

function renderFotosGerais() {
  const box = document.getElementById('fotosBox');
  if (!box) return;
  const visiveis = _fotosRonda.filter(f => !f._removida && !f.catracaId);
  box.innerHTML = _fotoThumbsHTML(visiveis, "document.getElementById('fotoInput').click()");
}

function renderFotosCatraca(catracaId) {
  const box = document.getElementById('catFotos_' + catracaId);
  if (!box) return;
  const visiveis = _fotosRonda.filter(f => !f._removida && f.catracaId === catracaId);
  box.innerHTML = _fotoThumbsHTML(visiveis, `document.getElementById('catFotoInput_${catracaId}').click()`);
}

function removerFotoRonda(idx) {
  const f = _fotosRonda[idx];
  if (!f) return;
  // marca como removida SEM dar splice — assim os índices dos demais thumbs (geral
  // e de outras catracas) não se deslocam. Novas removidas são ignoradas ao salvar.
  f._removida = true;
  if (f.catracaId) renderFotosCatraca(f.catracaId); else renderFotosGerais();
  agendarAutosaveRonda();
}

async function sincronizarFotosRonda(rondaId) {
  if (!rondaId) return { novas: 0, removidas: 0 };
  const novas = _fotosRonda.filter(f => f._nova && !f._removida);
  const removidas = _fotosRonda.filter(f => f._removida && f.id);
  let novasSalvas = 0;
  let removidasSalvas = 0;
  await Promise.all(novas.map(async f => {
    const ref = await SUB_FOTOS(rondaId).add({
      base64: f.base64,
      secao: f.secao || 'geral',
      legenda: f.legenda || '',
      catracaId: f.catracaId || null,
      catracaNome: f.catracaNome || '',
      criadoEm: new Date().toISOString(),
      criadoPor: window._userEmail || ''
    });
    f.id = ref.id;
    f._nova = false;
    novasSalvas++;
  }));
  await Promise.all(removidas.map(async f => {
    await SUB_FOTOS(rondaId).doc(f.id).delete();
    removidasSalvas++;
  }));
  _fotosRonda = _fotosRonda.filter(f => !(f._removida && (f.id || !f._nova)));
  const totalFotos = _fotosRonda.filter(f => !f._removida).length;
  await COL_RONDAS().doc(rondaId).set({ nFotos: totalFotos, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(), atualizadoEmLocal: new Date().toISOString() }, { merge: true });
  return { novas: novasSalvas, removidas: removidasSalvas };
}

async function executarAutosaveRonda() {
  if (!_autosaveRondaAtivo || !document.getElementById('formRondaBody')) return;
  if (_autosaveRondaSalvando) { _autosaveRondaPendente = true; return; }
  _autosaveRondaSalvando = true;
  _autosaveRondaPendente = false;
  setAutosaveRondaStatus('Salvando automaticamente…');
  try {
    const rondaId = await garantirDocumentoRascunhoRonda();
    const rExist = _rondas.find(x => x.id === rondaId);
    const statusAtual = _rondaEraRascunho ? 'rascunho' : ((rExist && rExist.status) || 'concluida');
    const dados = coletarDadosFormRonda(statusAtual);
    dados.piso = firebase.firestore.FieldValue.delete();
    await COL_RONDAS().doc(rondaId).set(dados, { merge: true });
    await sincronizarFotosRonda(rondaId);
    setAutosaveRondaStatus('Salvo automaticamente às ' + formatarHora(new Date()));
  } catch (e) {
    setAutosaveRondaStatus('Falha no autosave: ' + e.message, true);
  } finally {
    _autosaveRondaSalvando = false;
    if (_autosaveRondaPendente) agendarAutosaveRonda();
  }
}

function validarRondaCompleta() {
  if (!document.getElementById('rLocal').value) return 'Selecione o local.';
  if (!document.getElementById('rData').value) return 'Informe a data da ronda.';
  if (!document.getElementById('rHoraInicio').value) return 'Informe a hora de início.';
  return '';
}

async function salvarRonda() {
  const localId = document.getElementById('rLocal').value;
  const dataStr = document.getElementById('rData').value;
  const erroValidacao = validarRondaCompleta();
  if (erroValidacao) return mostrarNotificacao(erroValidacao, 'erro');

  const local = _locais.find(l => l.id === localId);
  const btn = document.getElementById('btnSalvarRonda');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando…';
  clearTimeout(_autosaveRondaTimer);
  if (!document.getElementById('rHoraTermino').value) { const _n = new Date(); document.getElementById('rHoraTermino').value = String(_n.getHours()).padStart(2,'0') + ':' + String(_n.getMinutes()).padStart(2,'0'); }
  const rExist = _rondaEdit ? _rondas.find(x => x.id === _rondaEdit) : null;
  const eraCriacao = !_rondaEdit || _rondaEraRascunho || (rExist && rExist.status === 'rascunho');
  const dados = coletarDadosFormRonda('concluida');
  dados.piso = firebase.firestore.FieldValue.delete();
  dados.finalizadaEm = firebase.firestore.FieldValue.serverTimestamp();
  dados.finalizadaEmLocal = new Date().toISOString();

  try {
    let rondaId = await garantirDocumentoRascunhoRonda();
    if (!rondaId) {
      dados.criadoPor = window._userEmail || '';
      dados.criadoPorUid = window._userUid || '';
      dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await COL_RONDAS().add(dados);
      rondaId = ref.id;
    } else {
      await COL_RONDAS().doc(rondaId).set(dados, { merge: true });
    }

    const fotosSync = await sincronizarFotosRonda(rondaId);
    registrarLog(eraCriacao ? 'criacao' : 'edicao', eraCriacao ? 'Criou ronda' : 'Editou ronda', `${eraCriacao ? 'Registrou' : 'Editou'} ronda de ${local ? local.nome : 'local'} em ${formatarData(dados.dataRonda)}.`, {
      itemTipo: 'ronda', itemId: rondaId, localId, fotosAdicionadas: fotosSync.novas, fotosRemovidas: fotosSync.removidas
    });

    _autosaveRondaAtivo = false;
    mostrarNotificacao(eraCriacao ? 'Ronda registrada com sucesso.' : 'Ronda atualizada.');
    fecharModal();
    await carregarRondas();
    irPara('rondas');
  } catch (e) {
    mostrarNotificacao('Erro ao salvar: ' + e.message, 'erro');
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Salvar';
  }
}

async function moverRondaLixeira(id) {
  const r = _rondas.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`Mover a ronda de "${r.localNome}" (${formatarData(r.dataRonda)}) para a lixeira?`)) return;
  try {
    await COL_LIXEIRA().add({
      tipoItem: 'ronda', refId: id,
      titulo: `Ronda · ${r.localNome} · ${formatarData(r.dataRonda)}`,
      deletadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      deletadoPor: window._userEmail || '', restaurado: false,
    });
    await COL_RONDAS().doc(id).update({ deletado: true, deletadoEm: firebase.firestore.FieldValue.serverTimestamp(), deletadoPor: window._userEmail || '' });
    registrarLog('lixeira', 'Moveu ronda para lixeira', `Moveu a ronda de ${r.localNome || 'local'} (${formatarData(r.dataRonda)}) para a lixeira.`, { itemTipo: 'ronda', itemId: id, localId: r.localId || '' });
    mostrarNotificacao('Ronda movida para a lixeira.');
    await carregarRondas();
    renderListaRondas();
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

/* ── Histórico por local (timeline) ───────────────── */
async function verHistoricoLocal(localId) {
  const local = _locais.find(l => l.id === localId);
  const rondasLocal = _rondas.filter(r => r.localId === localId && (rondaConcluida(r) || !window._isClienteExterno));
  registrarLog('visualizacao', 'Visualizou histórico do local', `Visualizou o histórico de ${local ? local.nome : 'local'}.`, { itemTipo: 'local', itemId: localId });
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-clock-rotate-left"></i> Histórico — ${escapeHTML(local ? local.nome : '')}</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      ${rondasLocal.length ? `<div class="timeline">${rondasLocal.map(r => {
        const catP = (r.catracas || []).filter(c => c.estado === 'problema').length;
        return `<div class="tl-item">
          <div class="card card-hover" onclick="fecharModal();verRonda('${r.id}')" style="cursor:pointer">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div><b>${formatarData(r.dataRonda)}</b> · ${formatarHora(r.horaInicio)} - ${formatarHora(r.horaTermino)} · ${escapeHTML(r.tecnicoNome || '—')}</div>
              <div style="display:flex;gap:6px">
                ${rondaConcluida(r) ? '' : '<span class="badge badge-alerta">Rascunho</span>'}
                ${catP ? `<span class="badge badge-problema">${catP} problema(s)</span>` : '<span class="badge badge-ok">Sem problemas</span>'}
                ${r.nFotos ? `<span class="badge badge-neutro"><i class="fas fa-camera"></i> ${r.nFotos}</span>` : ''}
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}</div>` : `<div class="empty"><i class="fas fa-clipboard"></i>Nenhuma ronda registrada para este local.</div>`}
    </div>`, 'modal-lg');
}

/* ================================================================
   LOCAIS + CATRACAS
   ================================================================ */
function renderLocais(root) {
  root.innerHTML = `
    <div class="view-header">
      <div class="view-title"><h2><i class="fas fa-building"></i> Locais</h2><p>Locais atendidos e suas catracas.</p></div>
      <div class="view-actions"><button class="btn btn-primary" onclick="abrirFormLocal()"><i class="fas fa-plus"></i> Novo local</button></div>
    </div>
    <div class="list" id="listaLocais"></div>`;
  const box = document.getElementById('listaLocais');
  if (!_locais.length) { box.innerHTML = `<div class="empty"><i class="fas fa-building"></i>Nenhum local cadastrado.</div>`; return; }
  box.innerHTML = _locais.map(l => `
    <div class="list-row">
      <div class="lr-main">
        <div class="lr-title">${escapeHTML(l.nome)}</div>
        <div class="lr-sub">${escapeHTML(l.endereco || 'Sem endereço')} · ciclo ${l.intervaloRondaDias || 15}d</div>
        ${l.criadoPor ? `<div class="item-autor">Criado por ${escapeHTML(l.criadoPor)}</div>` : ''}
      </div>
      <div class="lr-actions">
        <button class="btn btn-sm" onclick="gerenciarCatracas('${l.id}')"><i class="fas fa-door-closed"></i> Catracas</button>
        <button class="btn btn-sm" onclick="abrirFormLocal('${l.id}')"><i class="fas fa-pen"></i></button>
        ${window._can.moverLixeira ? `<button class="btn btn-sm btn-danger" onclick="moverLocalLixeira('${l.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>`).join('');
}

function abrirFormLocal(id = null) {
  const l = id ? _locais.find(x => x.id === id) : null;
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-building"></i> ${l ? 'Editar' : 'Novo'} local</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="field-label">Nome *</label><input class="input" id="lNome" value="${l ? escaparAttr(l.nome) : ''}" placeholder="Ex.: Shopping Central"></div>
      <div class="form-group"><label class="field-label">Endereço</label><input class="input" id="lEndereco" value="${l ? escaparAttr(l.endereco || '') : ''}" placeholder="Rua, nº, bairro, cidade"></div>
      <div class="form-row">
        <div class="form-group"><label class="field-label">Contato</label><input class="input" id="lContato" value="${l ? escaparAttr(l.contato || '') : ''}" placeholder="Responsável / telefone"></div>
        <div class="form-group"><label class="field-label">Intervalo da ronda (dias)</label><input type="number" min="1" class="input" id="lIntervalo" value="${l ? (l.intervaloRondaDias || 15) : 15}"></div>
      </div>
      <div class="form-group"><label class="field-label">Observações</label><textarea class="input" id="lObs" placeholder="Notas gerais do local…">${l ? escapeHTML(l.observacoes || '') : ''}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="fecharModal()">Cancelar</button>
      <button class="btn btn-primary" id="btnSalvarLocal" onclick="salvarLocal('${id || ''}')"><i class="fas fa-check"></i> Salvar</button>
    </div>`);
}

async function salvarLocal(id) {
  const nome = document.getElementById('lNome').value.trim();
  if (!nome) return mostrarNotificacao('Informe o nome do local.', 'erro');
  const dados = {
    nome,
    endereco: document.getElementById('lEndereco').value.trim(),
    contato: document.getElementById('lContato').value.trim(),
    intervaloRondaDias: Number(document.getElementById('lIntervalo').value) || 15,
    observacoes: document.getElementById('lObs').value.trim(),
    ativo: true,
  };
  const btn = document.getElementById('btnSalvarLocal'); btn.disabled = true;
  try {
    if (id) {
      await COL_LOCAIS().doc(id).update(dados);
      registrarLog('edicao', 'Editou local', `Editou o local ${nome}.`, { itemTipo: 'local', itemId: id });
    } else {
      dados.criadoPor = window._userEmail || '';
      dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await COL_LOCAIS().add(dados);
      registrarLog('criacao', 'Criou local', `Criou o local ${nome}.`, { itemTipo: 'local', itemId: ref.id });
    }
    mostrarNotificacao('Local salvo.');
    fecharModal();
    await carregarBase();
    renderLocais(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); btn.disabled = false; }
}

async function moverLocalLixeira(id) {
  const l = _locais.find(x => x.id === id);
  if (!l) return;
  if (!confirm(`Mover o local "${l.nome}" para a lixeira? As rondas dele continuam registradas.`)) return;
  try {
    await COL_LIXEIRA().add({ tipoItem: 'local', refId: id, titulo: `Local · ${l.nome}`, deletadoEm: firebase.firestore.FieldValue.serverTimestamp(), deletadoPor: window._userEmail || '', restaurado: false });
    await COL_LOCAIS().doc(id).update({ deletado: true, deletadoEm: firebase.firestore.FieldValue.serverTimestamp(), deletadoPor: window._userEmail || '' });
    registrarLog('lixeira', 'Moveu local para lixeira', `Moveu o local ${l.nome} para a lixeira.`, { itemTipo: 'local', itemId: id });
    mostrarNotificacao('Local movido para a lixeira.');
    await carregarBase();
    renderLocais(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

async function gerenciarCatracas(localId) {
  const local = _locais.find(l => l.id === localId);
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-door-closed"></i> Catracas — ${escapeHTML(local ? local.nome : '')}</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      <div id="catracasLista"><div class="loading-inline">Carregando…</div></div>
      <div class="ronda-block" style="margin-top:14px">
        <div class="rb-title"><i class="fas fa-plus"></i> Adicionar catraca</div>
        <div class="form-row">
          <div class="form-group"><label class="field-label">Nome / identificação *</label><input class="input" id="cNome" placeholder="Ex.: Catraca 01"></div>
          <div class="form-group"><label class="field-label">Tipo</label><input class="input" id="cTipo" placeholder="Ex.: Torniquete"></div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="addCatraca('${localId}')"><i class="fas fa-plus"></i> Adicionar</button>
      </div>
    </div>`, '');
  listarCatracas(localId);
}

async function listarCatracas(localId) {
  const box = document.getElementById('catracasLista');
  try {
    const snap = await SUB_CATRACAS(localId).get();
    const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    box.innerHTML = cats.length ? '<div class="list">' + cats.map(c => `
      <div class="list-row">
        <div class="lr-main"><div class="lr-title">${escapeHTML(c.nome)}</div><div class="lr-sub">${escapeHTML(c.tipo || 'Catraca')}</div></div>
        <div class="lr-actions"><button class="btn btn-sm btn-danger" onclick="removerCatraca('${localId}','${c.id}')"><i class="fas fa-trash"></i></button></div>
      </div>`).join('') + '</div>' : '<span style="color:var(--muted)">Nenhuma catraca cadastrada ainda.</span>';
  } catch (e) { box.innerHTML = '<span style="color:var(--danger)">Erro ao carregar.</span>'; }
}

async function addCatraca(localId) {
  const nome = document.getElementById('cNome').value.trim();
  if (!nome) return mostrarNotificacao('Informe o nome da catraca.', 'erro');
  try {
    const local = _locais.find(l => l.id === localId);
    const ref = await SUB_CATRACAS(localId).add({ nome, tipo: document.getElementById('cTipo').value.trim(), ativa: true, criadoPor: window._userEmail || '', criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
    registrarLog('criacao', 'Criou catraca', `Criou a catraca ${nome}${local ? ' em ' + local.nome : ''}.`, { itemTipo: 'catraca', itemId: ref.id, localId });
    document.getElementById('cNome').value = ''; document.getElementById('cTipo').value = '';
    mostrarNotificacao('Catraca adicionada.');
    listarCatracas(localId);
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

async function removerCatraca(localId, catracaId) {
  if (!confirm('Remover esta catraca? As rondas anteriores mantêm o registro.')) return;
  try {
    const local = _locais.find(l => l.id === localId);
    await SUB_CATRACAS(localId).doc(catracaId).delete();
    registrarLog('exclusao', 'Removeu catraca', `Removeu uma catraca${local ? ' de ' + local.nome : ''}.`, { itemTipo: 'catraca', itemId: catracaId, localId });
    mostrarNotificacao('Catraca removida.');
    listarCatracas(localId);
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

/* ================================================================
   PRODUTOS / PEÇAS
   ================================================================ */
let _fotoProdutoTmp = null;

function renderProdutos(root) {
  root.innerHTML = `
    <div class="view-header">
      <div class="view-title"><h2><i class="fas fa-box"></i> Produtos / Peças</h2><p>Catálogo de peças para registrar nas rondas.</p></div>
      <div class="view-actions"><button class="btn btn-primary" onclick="abrirFormProduto()"><i class="fas fa-plus"></i> Novo produto</button></div>
    </div>
    <div class="grid grid-auto" id="listaProdutos"></div>`;
  const box = document.getElementById('listaProdutos');
  if (!_produtos.length) { box.innerHTML = `<div class="empty"><i class="fas fa-box"></i>Nenhum produto cadastrado.</div>`; return; }
  box.innerHTML = _produtos.map(p => `
    <div class="card card-hover">
      <div style="display:flex;gap:14px;align-items:center">
        ${p.fotoBase64 ? `<img class="lr-thumb zoomable" src="${p.fotoBase64}" style="width:60px;height:60px">` : `<div class="lr-thumb" style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;color:var(--muted)"><i class="fas fa-box"></i></div>`}
        <div style="flex:1;min-width:0">
          <div class="lr-title">${escapeHTML(p.nome)}</div>
          <div class="lr-sub">${escapeHTML(p.categoria || 'Sem categoria')}${p.codigo ? ' · ' + escapeHTML(p.codigo) : ''}</div>
        </div>
      </div>
      <div class="lr-actions" style="margin-top:12px;justify-content:flex-end">
        <button class="btn btn-sm" onclick="abrirFormProduto('${p.id}')"><i class="fas fa-pen"></i> Editar</button>
        ${window._can.moverLixeira ? `<button class="btn btn-sm btn-danger" onclick="moverProdutoLixeira('${p.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>`).join('');
}

function abrirFormProduto(id = null) {
  const p = id ? _produtos.find(x => x.id === id) : null;
  _fotoProdutoTmp = p ? (p.fotoBase64 || null) : null;
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-box"></i> ${p ? 'Editar' : 'Novo'} produto</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div style="text-align:center">
          <div id="prodFotoPreview" style="width:110px;height:110px;border-radius:11px;border:1px solid var(--border);background:var(--bg-2);display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${_fotoProdutoTmp ? `<img class="zoomable" src="${_fotoProdutoTmp}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fas fa-camera" style="color:var(--muted);font-size:24px"></i>'}
          </div>
          <button class="btn btn-sm" style="margin-top:8px" onclick="document.getElementById('prodFotoInput').click()">Foto</button>
          <input type="file" id="prodFotoInput" accept="image/*" style="display:none" onchange="selecionarFotoProduto(this.files[0])">
        </div>
        <div style="flex:1;min-width:200px">
          <div class="form-group"><label class="field-label">Nome *</label><input class="input" id="pNome" value="${p ? escaparAttr(p.nome) : ''}" placeholder="Ex.: Fonte 12V"></div>
          <div class="form-row">
            <div class="form-group"><label class="field-label">Categoria</label><input class="input" id="pCategoria" value="${p ? escaparAttr(p.categoria || '') : ''}" placeholder="Ex.: Catraca"></div>
            <div class="form-group"><label class="field-label">Código</label><input class="input" id="pCodigo" value="${p ? escaparAttr(p.codigo || '') : ''}" placeholder="SKU / ref"></div>
          </div>
        </div>
      </div>
      <div class="form-group"><label class="field-label">Observações</label><textarea class="input" id="pObs" placeholder="Detalhes da peça…">${p ? escapeHTML(p.observacoes || '') : ''}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="fecharModal()">Cancelar</button>
      <button class="btn btn-primary" id="btnSalvarProduto" onclick="salvarProduto('${id || ''}')"><i class="fas fa-check"></i> Salvar</button>
    </div>`);
}

async function selecionarFotoProduto(file) {
  if (!file) return;
  try {
    _fotoProdutoTmp = await comprimirImagem(file, 500, 0.6);
    document.getElementById('prodFotoPreview').innerHTML = `<img class="zoomable" src="${_fotoProdutoTmp}" style="width:100%;height:100%;object-fit:cover">`;
  } catch (e) { mostrarNotificacao('Falha ao processar a imagem', 'erro'); }
}

async function salvarProduto(id) {
  const nome = document.getElementById('pNome').value.trim();
  if (!nome) return mostrarNotificacao('Informe o nome do produto.', 'erro');
  const dados = {
    nome,
    categoria: document.getElementById('pCategoria').value.trim(),
    codigo: document.getElementById('pCodigo').value.trim(),
    observacoes: document.getElementById('pObs').value.trim(),
    fotoBase64: _fotoProdutoTmp || '',
    ativo: true,
  };
  const btn = document.getElementById('btnSalvarProduto'); btn.disabled = true;
  try {
    if (id) {
      await COL_PRODUTOS().doc(id).update(dados);
      registrarLog('edicao', 'Editou produto', `Editou o produto ${nome}.`, { itemTipo: 'produto', itemId: id });
    } else {
      dados.criadoPor = window._userEmail || '';
      dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await COL_PRODUTOS().add(dados);
      registrarLog('criacao', 'Criou produto', `Criou o produto ${nome}.`, { itemTipo: 'produto', itemId: ref.id });
    }
    mostrarNotificacao('Produto salvo.');
    fecharModal();
    await carregarBase();
    renderProdutos(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); btn.disabled = false; }
}

async function moverProdutoLixeira(id) {
  const p = _produtos.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Mover o produto "${p.nome}" para a lixeira?`)) return;
  try {
    await COL_LIXEIRA().add({ tipoItem: 'produto', refId: id, titulo: `Produto · ${p.nome}`, deletadoEm: firebase.firestore.FieldValue.serverTimestamp(), deletadoPor: window._userEmail || '', restaurado: false });
    await COL_PRODUTOS().doc(id).update({ deletado: true, deletadoEm: firebase.firestore.FieldValue.serverTimestamp(), deletadoPor: window._userEmail || '' });
    registrarLog('lixeira', 'Moveu produto para lixeira', `Moveu o produto ${p.nome} para a lixeira.`, { itemTipo: 'produto', itemId: id });
    mostrarNotificacao('Produto movido para a lixeira.');
    await carregarBase();
    renderProdutos(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

/* ================================================================
   ACESSOS DE CLIENTES
   ================================================================ */
async function renderClientes(root) {
  root.innerHTML = `
    <div class="view-header">
      <div class="view-title"><h2><i class="fas fa-user-shield"></i> Acessos de Clientes</h2><p>Defina quais usuários são clientes (somente leitura) e a quais locais têm acesso.</p></div>
    </div>
    <div id="listaClientes"><div class="loading-inline">Carregando usuários…</div></div>`;
  try {
    const snap = await db.collection('users').get();
    const usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.role === 'user' && (u.rondaLinkcallCliente || (u.projects && u.projects['ronda-linkcall'])))
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
    const box = document.getElementById('listaClientes');
    if (!usuarios.length) { box.innerHTML = `<div class="empty"><i class="fas fa-user-shield"></i>Nenhum usuário com acesso ao projeto.<br><span style="font-size:12px">Libere o acesso ao projeto pelo painel Admin primeiro.</span></div>`; return; }
    box.innerHTML = '<div class="list">' + usuarios.map(u => {
      const vinculados = new Set(Array.isArray(u.rondaLinkcallLocais) ? u.rondaLinkcallLocais : []);
      const checkboxes = _locais.map(l => `<label class="checkline" style="font-size:13px"><input type="checkbox" class="cliLocal" value="${l.id}" ${vinculados.has(l.id) ? 'checked' : ''}> ${escapeHTML(l.nome)}</label>`).join('');
      return `
        <div class="card" id="cli_${u.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div><div class="lr-title">${escapeHTML(u.name || u.email)}</div><div class="lr-sub">${escapeHTML(u.email)}</div></div>
            <label class="checkline"><input type="checkbox" id="ehCli_${u.id}" ${u.rondaLinkcallCliente ? 'checked' : ''}> É cliente externo (somente leitura)</label>
          </div>
          <div style="margin-top:12px">
            <label class="field-label">Locais visíveis para este cliente</label>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;margin-top:6px">${checkboxes || '<span style="color:var(--muted)">Nenhum local cadastrado.</span>'}</div>
          </div>
          <div style="text-align:right;margin-top:12px"><button class="btn btn-primary btn-sm" onclick="salvarCliente('${u.id}')"><i class="fas fa-check"></i> Salvar</button></div>
        </div>`;
    }).join('') + '</div>';
  } catch (e) {
    document.getElementById('listaClientes').innerHTML = '<span style="color:var(--danger)">Erro ao carregar usuários.</span>';
  }
}

async function salvarCliente(uid) {
  const card = document.getElementById('cli_' + uid);
  const ehCliente = card.querySelector('#ehCli_' + uid).checked;
  const locais = Array.from(card.querySelectorAll('.cliLocal:checked')).map(cb => cb.value);
  try {
    await db.collection('users').doc(uid).update({ rondaLinkcallCliente: ehCliente, rondaLinkcallLocais: locais });
    const nome = ((card.querySelector('.lr-title') || {}).textContent || uid).trim();
    registrarLog('cliente', 'Atualizou acesso de cliente', `Atualizou o acesso de cliente de ${nome}.`, { usuarioAlvoUid: uid, clienteExterno: ehCliente, locais: locais.length });
    mostrarNotificacao('Acesso do cliente atualizado.');
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

/* ================================================================
   LOGS
   ================================================================ */
async function renderLogs(root) {
  const opcoes = ['<option value="todos">Todos os tipos</option>']
    .concat(Object.keys(LOG_TIPOS).map(k => `<option value="${k}" ${_logsFiltroTipo === k ? 'selected' : ''}>${escapeHTML(LOG_TIPOS[k].label)}</option>`))
    .join('');
  root.innerHTML = `
    <div class="view-header">
      <div class="view-title"><h2><i class="fas fa-list-alt"></i> Logs</h2><p>Histórico de acessos, navegação e ações realizadas na Ronda Linkcall.</p></div>
      <div class="view-actions">
        <select class="input" id="filtroTipoLog" style="width:auto" onchange="_logsFiltroTipo=this.value;renderListaLogs()">${opcoes}</select>
        <select class="input" id="filtroUsuarioLog" style="width:auto" onchange="_logsFiltroUsuario=this.value;renderListaLogs()"><option value="todos">Todos os usuários</option></select>
        <select class="input" id="filtroPeriodoLog" style="width:auto" onchange="setFiltroPeriodoLogs(this.value)">
          <option value="todos" ${_logsFiltroPeriodo === 'todos' ? 'selected' : ''}>Todo o período</option>
          <option value="hoje" ${_logsFiltroPeriodo === 'hoje' ? 'selected' : ''}>Hoje</option>
          <option value="7d" ${_logsFiltroPeriodo === '7d' ? 'selected' : ''}>Últimos 7 dias</option>
          <option value="30d" ${_logsFiltroPeriodo === '30d' ? 'selected' : ''}>Últimos 30 dias</option>
          <option value="mesAtual" ${_logsFiltroPeriodo === 'mesAtual' ? 'selected' : ''}>Este mês</option>
          <option value="mesPassado" ${_logsFiltroPeriodo === 'mesPassado' ? 'selected' : ''}>Mês passado</option>
          <option value="manual" ${_logsFiltroPeriodo === 'manual' ? 'selected' : ''}>Manual</option>
        </select>
        <div class="logs-manual-dates" id="logsDatasManuais" style="display:${_logsFiltroPeriodo === 'manual' ? 'flex' : 'none'}">
          <input type="date" class="input" id="logDataInicio" value="${escapeHTML(_logsDataInicio)}" onchange="_logsDataInicio=this.value;renderListaLogs()">
          <span>até</span>
          <input type="date" class="input" id="logDataFim" value="${escapeHTML(_logsDataFim)}" onchange="_logsDataFim=this.value;renderListaLogs()">
        </div>
        <button class="btn" onclick="renderListaLogs()"><i class="fas fa-rotate"></i> Atualizar</button>
      </div>
    </div>
    <div id="listaLogs"><div class="loading-inline">Carregando logs…</div></div>
    <footer class="logs-footer">by <a href="https://www.paulogfribeiro.lat/" target="_blank" rel="noopener noreferrer">Paulo Gabriel</a></footer>`;
  renderListaLogs();
}

async function renderListaLogs() {
  const box = document.getElementById('listaLogs');
  if (!box) return;
  if (!window._can.visualizarLogs) {
    box.innerHTML = `<div class="empty"><i class="fas fa-lock"></i>Acesso aos logs não liberado.</div>`;
    return;
  }
  box.innerHTML = '<div class="loading-inline">Carregando logs…</div>';
  try {
    const intervalo = intervaloLogsAtual();
    let query = COL_LOGS();
    if (intervalo.inicio) query = query.where('criadoEm', '>=', firebase.firestore.Timestamp.fromDate(intervalo.inicio));
    if (intervalo.fim) query = query.where('criadoEm', '<=', firebase.firestore.Timestamp.fromDate(intervalo.fim));
    const snap = await query.orderBy('criadoEm', 'desc').limit(500).get();
    let logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    atualizarFiltroUsuariosLogs(logs);
    if (_logsFiltroTipo !== 'todos') logs = logs.filter(l => l.tipo === _logsFiltroTipo);
    if (_logsFiltroUsuario !== 'todos') logs = logs.filter(l => (l.usuarioUid || l.usuarioEmail || '') === _logsFiltroUsuario);
    if (!logs.length) { box.innerHTML = `<div class="empty"><i class="fas fa-list-alt"></i>Nenhum log encontrado.</div>`; return; }
    box.innerHTML = '<div class="list">' + logs.map(l => {
      const meta = LOG_TIPOS[l.tipo] || { label: l.tipo || 'Log', icon: 'fa-check', color: '#9ca3af' };
      const usuario = l.usuarioNome || l.usuarioEmail || '—';
      const perfil = l.perfil === 'superadmin' ? 'Super Admin' : l.perfil === 'admin' ? 'Admin' : l.perfil === 'cliente' ? 'Cliente' : 'Usuário';
      const quando = formatarDataHora(l.criadoEm) !== '—' ? formatarDataHora(l.criadoEm) : formatarDataHora(l.criadoEmLocal);
      return `
        <div class="list-row log-row">
          <div class="log-type" style="color:${meta.color};background:${meta.color}1f;border-color:${meta.color}55"><i class="fas ${meta.icon}"></i></div>
          <div class="lr-main">
            <div class="lr-title">${escapeHTML(l.acao || meta.label)} <span class="log-chip" style="color:${meta.color};border-color:${meta.color}55">${escapeHTML(meta.label)}</span></div>
            <div class="lr-sub">${escapeHTML(l.detalhe || '')}</div>
            <div class="item-autor"><i class="fas fa-user"></i> ${escapeHTML(usuario)} · ${escapeHTML(perfil)} · ${escapeHTML(l.usuarioEmail || '')}</div>
          </div>
          <div class="log-date">${escapeHTML(quando)}</div>
        </div>`;
    }).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<span style="color:var(--danger)">Erro ao carregar logs: ' + escapeHTML(e.message) + '</span>';
  }
}

function atualizarFiltroUsuariosLogs(logs) {
  const sel = document.getElementById('filtroUsuarioLog');
  if (!sel) return;
  const usuarios = [];
  const vistos = new Set();
  logs.forEach(l => {
    const chave = l.usuarioUid || l.usuarioEmail || '';
    if (!chave || vistos.has(chave)) return;
    vistos.add(chave);
    usuarios.push({ chave, nome: l.usuarioNome || l.usuarioEmail || chave, email: l.usuarioEmail || '' });
  });
  usuarios.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  if (_logsFiltroUsuario !== 'todos' && !vistos.has(_logsFiltroUsuario)) _logsFiltroUsuario = 'todos';
  sel.innerHTML = '<option value="todos">Todos os usuários</option>' + usuarios.map(u =>
    `<option value="${escapeHTML(u.chave)}" ${_logsFiltroUsuario === u.chave ? 'selected' : ''}>${escapeHTML(u.nome)}${u.email && u.email !== u.nome ? ' · ' + escapeHTML(u.email) : ''}</option>`
  ).join('');
  sel.value = _logsFiltroUsuario;
}

/* ================================================================
   LIXEIRA
   ================================================================ */
async function renderLixeira(root) {
  root.innerHTML = `
    <div class="view-header">
      <div class="view-title"><h2><i class="fas fa-trash-alt"></i> Lixeira</h2><p>Itens removidos. Restaure ou apague em definitivo.</p></div>
    </div>
    <div id="listaLixeira"><div class="loading-inline">Carregando…</div></div>`;
  try {
    const snap = await COL_LIXEIRA().get();
    let itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    itens.sort((a, b) => tsMs(b.deletadoEm) - tsMs(a.deletadoEm));
    // itens já restaurados só aparecem para quem pode apagar permanentemente
    if (!window._can.apagarPermanente) itens = itens.filter(i => !i.restaurado);
    const box = document.getElementById('listaLixeira');
    if (!itens.length) { box.innerHTML = `<div class="empty"><i class="fas fa-trash"></i>Lixeira vazia.</div>`; return; }
    box.innerHTML = '<div class="list">' + itens.map(i => `
      <div class="list-row ${i.restaurado ? 'lixeira-row--restaurado' : ''}">
        <div class="lr-main">
          <div class="lr-title">${escapeHTML(i.titulo || i.tipoItem)} ${i.restaurado ? '<span class="tag-restaurado">restaurado</span>' : ''}</div>
          <div class="lr-sub">Removido por ${escapeHTML(i.deletadoPor || '—')} em ${formatarData(i.deletadoEm)}</div>
        </div>
        <div class="lr-actions">
          ${!i.restaurado && window._can.restaurar ? `<button class="btn btn-sm btn-success" onclick="restaurarItem('${i.id}')"><i class="fas fa-rotate-left"></i> Restaurar</button>` : ''}
          ${window._can.apagarPermanente ? `<button class="btn btn-sm btn-danger" onclick="apagarPermanente('${i.id}')"><i class="fas fa-times"></i> Apagar</button>` : ''}
        </div>
      </div>`).join('') + '</div>';
  } catch (e) {
    document.getElementById('listaLixeira').innerHTML = '<span style="color:var(--danger)">Erro ao carregar a lixeira.</span>';
  }
}

function colDoTipo(tipo) {
  return tipo === 'ronda' ? COL_RONDAS() : tipo === 'local' ? COL_LOCAIS() : COL_PRODUTOS();
}

async function restaurarItem(lixeiraId) {
  try {
    const doc = await COL_LIXEIRA().doc(lixeiraId).get();
    const it = doc.data();
    await colDoTipo(it.tipoItem).doc(it.refId).update({ deletado: false });
    await COL_LIXEIRA().doc(lixeiraId).update({ restaurado: true });
    registrarLog('restauracao', 'Restaurou item', `Restaurou ${it.titulo || it.tipoItem || 'item'} da lixeira.`, { itemTipo: it.tipoItem || '', itemId: it.refId || '', lixeiraId });
    mostrarNotificacao('Item restaurado.');
    await Promise.all([carregarBase(), carregarRondas()]);
    renderLixeira(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro ao restaurar: ' + e.message, 'erro'); }
}

async function apagarPermanente(lixeiraId) {
  if (!confirm('Apagar este item PERMANENTEMENTE? Esta ação não pode ser desfeita.')) return;
  try {
    const doc = await COL_LIXEIRA().doc(lixeiraId).get();
    const it = doc.data();
    // ronda: apaga também as fotos da subcoleção
    if (it.tipoItem === 'ronda') {
      const fotos = await SUB_FOTOS(it.refId).get();
      await Promise.all(fotos.docs.map(f => f.ref.delete()));
    }
    await colDoTipo(it.tipoItem).doc(it.refId).delete();
    await COL_LIXEIRA().doc(lixeiraId).delete();
    registrarLog('exclusao', 'Apagou permanentemente', `Apagou permanentemente ${it.titulo || it.tipoItem || 'item'}.`, { itemTipo: it.tipoItem || '', itemId: it.refId || '', lixeiraId });
    mostrarNotificacao('Item apagado permanentemente.');
    await Promise.all([carregarBase(), carregarRondas()]);
    renderLixeira(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro ao apagar: ' + e.message, 'erro'); }
}

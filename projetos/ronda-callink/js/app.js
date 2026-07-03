/* ================================================================
   RONDA CALLINK — lógica do projeto
   Padrões do Hub: permissões granulares (window._can), lixeira
   soft-delete, rastreamento de criador, escapeHTML/escaparAttr.
   ================================================================ */

/* ── Referências de coleções ──────────────────────── */
const COL_LOCAIS   = () => db.collection('ronda-callink-locais');
const COL_PRODUTOS = () => db.collection('ronda-callink-produtos');
const COL_RONDAS   = () => db.collection('ronda-callink-rondas');
const COL_LIXEIRA  = () => db.collection('lixeira-ronda-callink');
const SUB_CATRACAS = (localId) => COL_LOCAIS().doc(localId).collection('catracas');
const SUB_FOTOS    = (rondaId) => COL_RONDAS().doc(rondaId).collection('fotos');

/* ── Estado em memória ────────────────────────────── */
let _locais   = [];
let _produtos = [];
let _rondas   = [];   // documentos "leves" (sem fotos)
let _tecnicos = null; // cache lazy p/ admin escolher técnico
let _viewAtual = 'dashboard';

// estado do formulário de ronda aberto
let _rondaEdit = null;
let _fotosRonda = [];          // { id?, base64, secao, legenda, _nova, _removida }
let _estadosCatraca = {};      // { catracaId: 'ok' | 'problema' }
let _catracasForm = [];        // catracas carregadas do local selecionado

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
function hojeInput() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function mesmoMes(ms) {
  if (!ms) return false;
  const d = new Date(ms), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
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
  if (can.moverLixeira || can.restaurar || can.apagarPermanente) { show('navLixeira'); show('labelFerramentas'); }

  // zoom de fotos por delegação (evita handlers inline gigantes)
  document.addEventListener('click', e => {
    if (e.target.classList && e.target.classList.contains('zoomable')) abrirFotoSrc(e.target.src);
  });

  try {
    await Promise.all([carregarBase(), carregarRondas()]);
  } catch (e) {
    mostrarNotificacao('Erro ao carregar dados: ' + e.message, 'erro');
  }
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
  const rs = await COL_RONDAS().get();
  _rondas = rs.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !r.deletado);
  if (window._isClienteExterno) {
    const ok = new Set(window._locaisCliente);
    _rondas = _rondas.filter(r => ok.has(r.localId));
  }
  _rondas.sort((a, b) => tsMs(b.dataRonda) - tsMs(a.dataRonda));
}

function irPara(view) {
  // guarda de navegação (exceção documentada — não é guard de ação)
  const bloqueio = {
    locais:   () => window._can.gerenciarLocais,
    produtos: () => window._can.gerenciarProdutos,
    clientes: () => window._can.gerenciarClientes,
    lixeira:  () => window._can.moverLixeira || window._can.restaurar || window._can.apagarPermanente,
  };
  if (bloqueio[view] && !bloqueio[view]()) view = 'dashboard';

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
    lixeira:   renderLixeira,
  }[view] || renderDashboard)(root);
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function statusLocal(local) {
  const rondasLocal = _rondas.filter(r => r.localId === local.id);
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
  const rondasMes = _rondas.filter(r => mesmoMes(tsMs(r.dataRonda)));
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
  _rondas.forEach(r => (r.pecasTrocadas || []).forEach(p => {
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
    <div class="list" id="listaRondas"></div>`;
  renderListaRondas();
}

function renderListaRondas() {
  const filtro = (document.getElementById('filtroLocalRonda') || {}).value || '';
  const lista = _rondas.filter(r => !filtro || r.localId === filtro);
  const box = document.getElementById('listaRondas');
  if (!lista.length) { box.innerHTML = `<div class="empty"><i class="fas fa-clipboard"></i>Nenhuma ronda registrada.</div>`; return; }

  const podeEditar = window._can.editar && !window._isClienteExterno;
  const podeLixeira = window._can.moverLixeira && !window._isClienteExterno;

  box.innerHTML = lista.map(r => {
    const catProblema = (r.catracas || []).filter(c => c.estado === 'problema').length;
    const nPecas = (r.pecasTrocadas || []).length;
    const resumo = [
      `<i class="fas fa-user"></i> ${escapeHTML(r.tecnicoNome || r.tecnicoEmail || '—')}`,
      catProblema ? `<span class="badge badge-problema">${catProblema} catraca(s) c/ problema</span>` : '',
      nPecas ? `<span class="badge badge-neutro">${nPecas} peça(s)</span>` : '',
      r.nFotos ? `<span class="badge badge-neutro"><i class="fas fa-camera"></i> ${r.nFotos}</span>` : '',
    ].filter(Boolean).join(' &nbsp; ');
    return `
      <div class="list-row">
        <div class="lr-main">
          <div class="lr-title">${escapeHTML(r.localNome || '—')} · ${formatarData(r.dataRonda)}</div>
          <div class="lr-sub">${resumo}</div>
        </div>
        <div class="lr-actions">
          <button class="btn btn-sm" onclick="verRonda('${r.id}')"><i class="fas fa-eye"></i> Ver</button>
          ${podeEditar ? `<button class="btn btn-sm" onclick="abrirFormRonda('${r.id}')"><i class="fas fa-pen"></i></button>` : ''}
          ${podeLixeira ? `<button class="btn btn-sm btn-danger" onclick="moverRondaLixeira('${r.id}')"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function verRonda(id) {
  const r = _rondas.find(x => x.id === id);
  if (!r) return;
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-clipboard-check"></i> Ronda — ${escapeHTML(r.localNome || '')}</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body" id="detalheRonda"><div class="loading-inline">Carregando fotos…</div></div>
  `, 'modal-lg');

  const box = document.getElementById('detalheRonda');
  const linha = (label, val) => `<div class="ronda-block"><div class="rb-title">${label}</div>${val}</div>`;

  const catracasHtml = (r.catracas || []).length
    ? (r.catracas || []).map(c => `<div class="catraca-row"><div>${escapeHTML(c.nome)} ${c.obs ? '· <span style="color:var(--muted)">' + escapeHTML(c.obs) + '</span>' : ''}</div>
        <span class="badge ${c.estado === 'problema' ? 'badge-problema' : 'badge-ok'}">${c.estado === 'problema' ? 'Problema' : 'OK'}</span></div>`).join('')
    : '<span style="color:var(--muted)">Sem catracas registradas.</span>';

  const pecasHtml = (r.pecasTrocadas || []).length
    ? '<div class="list">' + (r.pecasTrocadas || []).map(p => `<div class="list-row"><div class="lr-main"><div class="lr-title">${escapeHTML(p.produtoNome)}</div>${p.obs ? '<div class="lr-sub">' + escapeHTML(p.obs) + '</div>' : ''}</div><span class="badge badge-neutro">${escapeHTML(String(p.quantidade || 1))}x</span></div>`).join('') + '</div>'
    : '<span style="color:var(--muted)">Nenhuma peça trocada.</span>';

  box.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <span class="badge badge-neutro"><i class="fas fa-calendar"></i> ${formatarData(r.dataRonda)}</span>
      <span class="badge badge-neutro"><i class="fas fa-user"></i> ${escapeHTML(r.tecnicoNome || r.tecnicoEmail || '—')}</span>
    </div>
    ${linha('<i class="fas fa-eye"></i> Local visto', (r.localVisto && r.localVisto.ok ? '<span class="badge badge-ok">OK</span>' : '<span class="badge badge-alerta">Com ressalva</span>') + (r.localVisto && r.localVisto.obs ? '<div class="lr-sub" style="margin-top:8px">' + escapeHTML(r.localVisto.obs) + '</div>' : ''))}
    ${r.piso && r.piso.possui ? linha('<i class="fas fa-layer-group"></i> Piso', (r.piso.ok ? '<span class="badge badge-ok">OK</span>' : '<span class="badge badge-alerta">Com ressalva</span>') + (r.piso.obs ? '<div class="lr-sub" style="margin-top:8px">' + escapeHTML(r.piso.obs) + '</div>' : '')) : ''}
    ${linha('<i class="fas fa-door-closed"></i> Catracas', catracasHtml)}
    ${linha('<i class="fas fa-screwdriver-wrench"></i> Peças trocadas', pecasHtml)}
    ${r.demaisInfos ? linha('<i class="fas fa-note-sticky"></i> Demais informações', '<div style="white-space:pre-wrap">' + escapeHTML(r.demaisInfos) + '</div>') : ''}
    <div class="ronda-block"><div class="rb-title"><i class="fas fa-camera"></i> Fotos</div><div class="foto-grid" id="fotosDetalhe"><div class="loading-inline">Carregando…</div></div></div>`;

  // carrega fotos da subcoleção
  try {
    const snap = await SUB_FOTOS(id).get();
    const fotos = snap.docs.map(d => d.data());
    const grid = document.getElementById('fotosDetalhe');
    grid.innerHTML = fotos.length
      ? fotos.map(f => `<div class="foto-thumb"><img class="zoomable" src="${f.base64}" alt="foto">${f.secao ? '<span class="foto-sec-tag">' + escapeHTML(f.secao) + (f.legenda ? ' · ' + escapeHTML(f.legenda) : '') + '</span>' : ''}</div>`).join('')
      : '<span style="color:var(--muted)">Sem fotos.</span>';
  } catch (e) {
    document.getElementById('fotosDetalhe').innerHTML = '<span style="color:var(--danger)">Erro ao carregar fotos.</span>';
  }
}

/* ── Formulário de ronda (registrar / editar) ─────── */
async function abrirFormRonda(id = null) {
  _rondaEdit = id;
  _fotosRonda = [];
  _estadosCatraca = {};
  _catracasForm = [];

  const r = id ? _rondas.find(x => x.id === id) : null;

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
    <div class="modal-body">
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
      ${window._isAdmin ? `<div class="form-group"><label class="field-label">Técnico responsável</label><select class="input" id="rTecnico">${tecOptions}</select></div>` : ''}

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-eye"></i> Local visto</div>
        <label class="checkline"><input type="checkbox" id="rLocalOk" ${!r || (r.localVisto && r.localVisto.ok) ? 'checked' : ''}> Tudo certo no local</label>
        <div class="form-group" style="margin-top:10px"><textarea class="input" id="rLocalObs" placeholder="Observações do local…">${r && r.localVisto ? escapeHTML(r.localVisto.obs || '') : ''}</textarea></div>
      </div>

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-layer-group"></i> Piso</div>
        <label class="checkline"><input type="checkbox" id="rPisoPossui" ${r && r.piso && r.piso.possui ? 'checked' : ''} onchange="document.getElementById('rPisoDetalhe').style.display=this.checked?'block':'none'"> Este local possui piso</label>
        <div id="rPisoDetalhe" style="display:${r && r.piso && r.piso.possui ? 'block' : 'none'};margin-top:10px">
          <label class="checkline"><input type="checkbox" id="rPisoOk" ${!r || (r.piso && r.piso.ok) ? 'checked' : ''}> Piso em bom estado</label>
          <div class="form-group" style="margin-top:10px"><textarea class="input" id="rPisoObs" placeholder="Observações do piso…">${r && r.piso ? escapeHTML(r.piso.obs || '') : ''}</textarea></div>
        </div>
      </div>

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-door-closed"></i> Catracas</div>
        <div id="catracasBox"><span style="color:var(--muted)">Selecione um local para carregar as catracas.</span></div>
      </div>

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-screwdriver-wrench"></i> Peças trocadas</div>
        <div id="pecasBox"></div>
        <button class="btn btn-sm" onclick="addPecaLinha()" style="margin-top:8px"><i class="fas fa-plus"></i> Adicionar peça</button>
      </div>

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-note-sticky"></i> Demais informações</div>
        <textarea class="input" id="rInfos" placeholder="Outras observações da ronda…">${r ? escapeHTML(r.demaisInfos || '') : ''}</textarea>
      </div>

      <div class="ronda-block">
        <div class="rb-title"><i class="fas fa-camera"></i> Fotos</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <label class="field-label" style="margin:0">Seção da próxima foto:</label>
          <select class="input" id="fotoSecao" style="width:auto"><option value="geral">Geral</option><option value="local">Local</option><option value="piso">Piso</option><option value="catraca">Catraca</option><option value="peca">Peça</option></select>
        </div>
        <div class="foto-grid" id="fotosBox"></div>
        <input type="file" id="fotoInput" accept="image/*" multiple style="display:none" onchange="adicionarFotos(this.files)">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="fecharModal()">Cancelar</button>
      <button class="btn btn-primary" id="btnSalvarRonda" onclick="salvarRonda()"><i class="fas fa-check"></i> ${r ? 'Salvar alterações' : 'Registrar'}</button>
    </div>
  `, 'modal-lg');

  // peças existentes
  if (r && (r.pecasTrocadas || []).length) r.pecasTrocadas.forEach(p => addPecaLinha(p));
  // fotos existentes (edição)
  if (r) {
    try {
      const snap = await SUB_FOTOS(id).get();
      _fotosRonda = snap.docs.map(d => ({ id: d.id, base64: d.data().base64, secao: d.data().secao || 'geral', legenda: d.data().legenda || '', _nova: false, _removida: false }));
      renderFotosBox();
    } catch (e) { /* silencioso */ }
  } else {
    renderFotosBox();
  }
  // catracas do local (edição já tem local)
  if (r && r.localId) carregarCatracasForm();
}

async function carregarTecnicos() {
  if (_tecnicos) return _tecnicos;
  const s = await db.collection('users').get();
  _tecnicos = s.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => !u.rondaCallinkCliente && (u.role === 'admin' || u.role === 'superadmin' || (u.projects && u.projects['ronda-callink'])))
    .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  return _tecnicos;
}

async function carregarCatracasForm() {
  const localId = document.getElementById('rLocal').value;
  const box = document.getElementById('catracasBox');
  if (!localId) { box.innerHTML = '<span style="color:var(--muted)">Selecione um local para carregar as catracas.</span>'; return; }
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
    if (!_catracasForm.length) { box.innerHTML = '<span style="color:var(--muted)">Este local não tem catracas cadastradas.</span>'; return; }
    box.innerHTML = _catracasForm.map(c => {
      const est = _estadosCatraca[c.id];
      const obsSalvo = r ? ((r.catracas || []).find(x => x.catracaId === c.id) || {}).obs || '' : '';
      return `<div class="catraca-row">
        <div>
          <div style="font-weight:600">${escapeHTML(c.nome)}</div>
          <input class="input" style="margin-top:6px;font-size:13px;padding:6px 10px" id="catObs_${c.id}" placeholder="Observação (opcional)" value="${escaparAttr(obsSalvo)}">
        </div>
        <div class="estado-toggle" id="toggle_${c.id}">
          <button type="button" class="${est === 'ok' ? 'on-ok' : ''}" onclick="setEstadoCatraca('${c.id}','ok')">OK</button>
          <button type="button" class="${est === 'problema' ? 'on-problema' : ''}" onclick="setEstadoCatraca('${c.id}','problema')">Problema</button>
        </div>
      </div>`;
    }).join('');
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
}

function addPecaLinha(dados = null) {
  const box = document.getElementById('pecasBox');
  const idLinha = 'peca_' + Math.random().toString(36).slice(2, 8);
  const opts = _produtos.map(p => `<option value="${p.id}" ${dados && dados.produtoId === p.id ? 'selected' : ''}>${escapeHTML(p.nome)}</option>`).join('');
  const div = document.createElement('div');
  div.className = 'peca-linha';
  div.id = idLinha;
  div.innerHTML = `
    <select class="input peca-produto">${_produtos.length ? '<option value="">Selecione a peça…</option>' + opts : '<option value="">Nenhum produto cadastrado</option>'}</select>
    <input type="number" min="1" class="input peca-qtd" value="${dados ? (dados.quantidade || 1) : 1}" placeholder="Qtd">
    <button class="btn btn-sm btn-danger" onclick="document.getElementById('${idLinha}').remove()"><i class="fas fa-times"></i></button>`;
  box.appendChild(div);
  if (dados && dados.obs) {
    // guarda obs num data-attr da linha para persistência simples
    div.dataset.obs = dados.obs;
  }
}

function adicionarFotos(files) {
  const secao = (document.getElementById('fotoSecao') || {}).value || 'geral';
  const arr = Array.from(files);
  const btn = document.getElementById('btnSalvarRonda');
  if (btn) btn.disabled = true;
  Promise.all(arr.map(f => comprimirImagem(f, 1024, 0.65)
    .then(base64 => _fotosRonda.push({ base64, secao, legenda: '', _nova: true, _removida: false }))
    .catch(() => mostrarNotificacao('Falha ao processar uma imagem', 'erro'))
  )).then(() => { if (btn) btn.disabled = false; renderFotosBox(); });
  document.getElementById('fotoInput').value = '';
}

function renderFotosBox() {
  const box = document.getElementById('fotosBox');
  if (!box) return;
  const visiveis = _fotosRonda.filter(f => !f._removida);
  box.innerHTML =
    visiveis.map(f => {
      const idx = _fotosRonda.indexOf(f);
      return `<div class="foto-thumb">
        <img class="zoomable" src="${f.base64}" alt="foto">
        <button class="foto-del" onclick="removerFotoRonda(${idx})"><i class="fas fa-times"></i></button>
        <span class="foto-sec-tag">${escapeHTML(f.secao || 'geral')}</span>
      </div>`;
    }).join('') +
    `<div class="foto-upload" onclick="document.getElementById('fotoInput').click()">
       <i class="fas fa-camera"></i><span>Adicionar foto</span>
     </div>`;
}

function removerFotoRonda(idx) {
  const f = _fotosRonda[idx];
  if (!f) return;
  if (f._nova) _fotosRonda.splice(idx, 1); // ainda não salva → descarta
  else f._removida = true;                  // existente → marca p/ deletar ao salvar
  renderFotosBox();
}

async function salvarRonda() {
  const localId = document.getElementById('rLocal').value;
  const dataStr = document.getElementById('rData').value;
  if (!localId) return mostrarNotificacao('Selecione o local.', 'erro');
  if (!dataStr)  return mostrarNotificacao('Informe a data da ronda.', 'erro');

  const local = _locais.find(l => l.id === localId);
  const btn = document.getElementById('btnSalvarRonda');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando…';

  // técnico: em edição preserva o original; em nova ronda é o logado; admin pode escolher
  const rExist = _rondaEdit ? _rondas.find(x => x.id === _rondaEdit) : null;
  let tecnicoUid  = rExist ? rExist.tecnicoUid   : window._userUid;
  let tecnicoNome = rExist ? rExist.tecnicoNome  : window._userNome;
  let tecnicoEmail= rExist ? rExist.tecnicoEmail : window._userEmail;
  if (window._isAdmin && document.getElementById('rTecnico')) {
    const uid = document.getElementById('rTecnico').value;
    const t = (_tecnicos || []).find(x => x.id === uid);
    if (t) { tecnicoUid = t.id; tecnicoNome = t.name || t.email; tecnicoEmail = t.email; }
  }

  // catracas
  const catracas = _catracasForm.map(c => ({
    catracaId: c.id, nome: c.nome,
    estado: _estadosCatraca[c.id] || 'ok',
    obs: (document.getElementById('catObs_' + c.id) || {}).value || ''
  }));

  // peças
  const pecas = [];
  document.querySelectorAll('#pecasBox .peca-linha').forEach(div => {
    const pid = div.querySelector('.peca-produto').value;
    if (!pid) return;
    const prod = _produtos.find(p => p.id === pid);
    pecas.push({ produtoId: pid, produtoNome: prod ? prod.nome : '', quantidade: Number(div.querySelector('.peca-qtd').value) || 1, obs: div.dataset.obs || '' });
  });

  const dados = {
    localId, localNome: local ? local.nome : '',
    tecnicoUid, tecnicoNome, tecnicoEmail,
    dataRonda: firebase.firestore.Timestamp.fromDate(new Date(dataStr + 'T12:00:00')),
    localVisto: { ok: document.getElementById('rLocalOk').checked, obs: document.getElementById('rLocalObs').value.trim() },
    piso: {
      possui: document.getElementById('rPisoPossui').checked,
      ok: document.getElementById('rPisoOk') ? document.getElementById('rPisoOk').checked : false,
      obs: document.getElementById('rPisoObs') ? document.getElementById('rPisoObs').value.trim() : ''
    },
    catracas, pecasTrocadas: pecas,
    demaisInfos: document.getElementById('rInfos').value.trim(),
    status: 'concluida',
  };

  try {
    let rondaId = _rondaEdit;
    if (_rondaEdit) {
      await COL_RONDAS().doc(_rondaEdit).update(dados);
    } else {
      dados.criadoPor = window._userEmail || '';
      dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await COL_RONDAS().add(dados);
      rondaId = ref.id;
    }

    // sincroniza fotos
    const novas = _fotosRonda.filter(f => f._nova && !f._removida);
    const removidas = _fotosRonda.filter(f => f._removida && f.id);
    await Promise.all([
      ...novas.map(f => SUB_FOTOS(rondaId).add({ base64: f.base64, secao: f.secao || 'geral', legenda: f.legenda || '', criadoEm: new Date().toISOString(), criadoPor: window._userEmail || '' })),
      ...removidas.map(f => SUB_FOTOS(rondaId).doc(f.id).delete()),
    ]);

    // atualiza contador de fotos
    const totalFotos = _fotosRonda.filter(f => !f._removida).length;
    await COL_RONDAS().doc(rondaId).update({ nFotos: totalFotos });

    mostrarNotificacao(_rondaEdit ? 'Ronda atualizada.' : 'Ronda registrada com sucesso.');
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
    mostrarNotificacao('Ronda movida para a lixeira.');
    await carregarRondas();
    renderListaRondas();
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

/* ── Histórico por local (timeline) ───────────────── */
async function verHistoricoLocal(localId) {
  const local = _locais.find(l => l.id === localId);
  const rondasLocal = _rondas.filter(r => r.localId === localId);
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-clock-rotate-left"></i> Histórico — ${escapeHTML(local ? local.nome : '')}</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      ${rondasLocal.length ? `<div class="timeline">${rondasLocal.map(r => {
        const catP = (r.catracas || []).filter(c => c.estado === 'problema').length;
        return `<div class="tl-item">
          <div class="card card-hover" onclick="fecharModal();verRonda('${r.id}')" style="cursor:pointer">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div><b>${formatarData(r.dataRonda)}</b> · ${escapeHTML(r.tecnicoNome || '—')}</div>
              <div style="display:flex;gap:6px">
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
    } else {
      dados.criadoPor = window._userEmail || '';
      dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      await COL_LOCAIS().add(dados);
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
    await SUB_CATRACAS(localId).add({ nome, tipo: document.getElementById('cTipo').value.trim(), ativa: true, criadoPor: window._userEmail || '', criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
    document.getElementById('cNome').value = ''; document.getElementById('cTipo').value = '';
    mostrarNotificacao('Catraca adicionada.');
    listarCatracas(localId);
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

async function removerCatraca(localId, catracaId) {
  if (!confirm('Remover esta catraca? As rondas anteriores mantêm o registro.')) return;
  try {
    await SUB_CATRACAS(localId).doc(catracaId).delete();
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
    } else {
      dados.criadoPor = window._userEmail || '';
      dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      await COL_PRODUTOS().add(dados);
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
      .filter(u => u.role === 'user' && (u.rondaCallinkCliente || (u.projects && u.projects['ronda-callink'])))
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
    const box = document.getElementById('listaClientes');
    if (!usuarios.length) { box.innerHTML = `<div class="empty"><i class="fas fa-user-shield"></i>Nenhum usuário com acesso ao projeto.<br><span style="font-size:12px">Libere o acesso ao projeto pelo painel Admin primeiro.</span></div>`; return; }
    box.innerHTML = '<div class="list">' + usuarios.map(u => {
      const vinculados = new Set(Array.isArray(u.rondaCallinkLocais) ? u.rondaCallinkLocais : []);
      const checkboxes = _locais.map(l => `<label class="checkline" style="font-size:13px"><input type="checkbox" class="cliLocal" value="${l.id}" ${vinculados.has(l.id) ? 'checked' : ''}> ${escapeHTML(l.nome)}</label>`).join('');
      return `
        <div class="card" id="cli_${u.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div><div class="lr-title">${escapeHTML(u.name || u.email)}</div><div class="lr-sub">${escapeHTML(u.email)}</div></div>
            <label class="checkline"><input type="checkbox" id="ehCli_${u.id}" ${u.rondaCallinkCliente ? 'checked' : ''}> É cliente externo (somente leitura)</label>
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
    await db.collection('users').doc(uid).update({ rondaCallinkCliente: ehCliente, rondaCallinkLocais: locais });
    mostrarNotificacao('Acesso do cliente atualizado.');
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
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
    mostrarNotificacao('Item apagado permanentemente.');
    await Promise.all([carregarBase(), carregarRondas()]);
    renderLixeira(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro ao apagar: ' + e.message, 'erro'); }
}

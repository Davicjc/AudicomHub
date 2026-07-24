/* ================================================================
   FROTA DE VEÍCULOS — lógica do projeto
   Padrões do Hub: permissões granulares (window._can), lixeira
   soft-delete, rastreamento de criador, escapeHTML/escaparAttr.
   Frota COMPARTILHADA: todo membro com o projeto vê todos os
   veículos e manutenções (ações restritas por permissão só na UI).
   ================================================================ */

/* ── Referências de coleções ──────────────────────── */
const COL_CARROS  = () => db.collection('frota-veiculos-carros');
const COL_MANUT   = () => db.collection('frota-veiculos-manutencoes');
const COL_LIXEIRA = () => db.collection('lixeira-frota-veiculos');

/* ── Limiares de alerta ───────────────────────────── */
const LIMITE_KM_ALERTA   = 1000;   // faltando <= 1.000 km => alerta
const LIMITE_DIAS_ALERTA = 30;     // faltando <= 30 dias  => alerta

/* ── Categorias de itens de manutenção ────────────── */
const CATEGORIAS = [
  'Óleo/Filtros', 'Freios', 'Correia/Corrente', 'Arrefecimento',
  'Suspensão', 'Pneus', 'Elétrica/Bateria', 'Transmissão',
  'Revisão geral', 'Outros'
];

/* Plano padrão (fallback quando a IA não está disponível/recusada) */
const PLANO_PADRAO = [
  { item: 'Troca de óleo do motor e filtro de óleo', categoria: 'Óleo/Filtros',    intervaloKm: 10000, intervaloMeses: 12 },
  { item: 'Filtro de ar do motor',                    categoria: 'Óleo/Filtros',    intervaloKm: 20000, intervaloMeses: 24 },
  { item: 'Filtro de combustível',                    categoria: 'Óleo/Filtros',    intervaloKm: 20000, intervaloMeses: 24 },
  { item: 'Filtro do ar-condicionado (cabine)',       categoria: 'Óleo/Filtros',    intervaloKm: 15000, intervaloMeses: 12 },
  { item: 'Velas de ignição',                         categoria: 'Elétrica/Bateria',intervaloKm: 40000, intervaloMeses: 48 },
  { item: 'Fluido de freio',                          categoria: 'Freios',          intervaloKm: 0,     intervaloMeses: 24 },
  { item: 'Pastilhas de freio dianteiras',            categoria: 'Freios',          intervaloKm: 30000, intervaloMeses: 0  },
  { item: 'Líquido de arrefecimento',                 categoria: 'Arrefecimento',   intervaloKm: 0,     intervaloMeses: 48 },
  { item: 'Correia dentada / corrente',               categoria: 'Correia/Corrente',intervaloKm: 60000, intervaloMeses: 60 },
  { item: 'Alinhamento e balanceamento',              categoria: 'Pneus',           intervaloKm: 10000, intervaloMeses: 12 },
  { item: 'Rodízio dos pneus',                        categoria: 'Pneus',           intervaloKm: 10000, intervaloMeses: 0  },
  { item: 'Revisão geral programada',                 categoria: 'Revisão geral',   intervaloKm: 10000, intervaloMeses: 12 },
];

const TIPOS_DOC = ['IPVA', 'Licenciamento', 'Seguro', 'Revisão programada', 'CNH do condutor', 'Multa/Outros'];

/* ── Estado em memória ────────────────────────────── */
let _carros = [];
let _manut  = [];
let _viewAtual = 'dashboard';
let _detalheId = null;
let _detalheSubtab = 'geral';
let _charts = {};                 // Chart.js instances por id
let _planoEdit = [];              // plano em edição no modal de veículo
let _docsEdit = [];              // documentos em edição no modal de veículo
let _itensManut = [];            // itens em edição no modal de manutenção
let _nfManut = null;             // { base64, nome, tipo } nota fiscal em edição
let _fotoVeiculo = null;         // base64 da foto em edição
let _filtroManutTexto = '';
let _filtroManutVeiculo = 'todos';
let _filtroVeicTexto = '';

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
function uidLocal() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

let _notifTimer = null;
function mostrarNotificacao(msg, tipo = 'sucesso') {
  const el = document.getElementById('notification');
  el.querySelector('span').textContent = msg;
  el.classList.toggle('erro', tipo === 'erro');
  el.querySelector('i').className = tipo === 'erro' ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';
  el.classList.add('show');
  clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => el.classList.remove('show'), 3400);
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
  return new Date(ms).toLocaleDateString('pt-BR');
}
function hojeInput() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function isoParaInput(iso) {
  if (!iso) return '';
  const ms = tsMs(iso); if (!ms) return '';
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function addMeses(date, n) {
  const d = new Date(date.getTime());
  const dia = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < dia) d.setDate(0); // corrige overflow de mês
  return d;
}
function formatBRL(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatKm(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR') + ' km';
}
function numero(v) { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; }
function mesmoMes(ms) {
  if (!ms) return false;
  const d = new Date(ms), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}

/* ── Compressão de imagem (cabe em 1 doc <1MB) ────── */
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
function lerPdfBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Falha ao ler o PDF'));
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
   INTEGRAÇÃO IA — reusa as chaves do Hub (config/*), com fallback
   automático Gemini → OpenAI (GPT) → API local (OpenAI-compatível).
   Usa o que estiver configurado no admin.html.
   ================================================================ */
async function carregarConfigsIA() {
  if (window._aiConfigs) return window._aiConfigs;
  try {
    const [g, o, l] = await Promise.all([
      db.collection('config').doc('gemini-api-key').get(),
      db.collection('config').doc('openai-api-key').get(),
      db.collection('config').doc('api-url-interna').get(),
    ]);
    window._aiConfigs = {
      gemini: g.exists ? (g.data().value || null) : null,
      openai: o.exists ? (o.data().value || null) : null,
      local:  l.exists ? (l.data().value || null) : null,
    };
  } catch (e) { window._aiConfigs = { gemini: null, openai: null, local: null }; }
  return window._aiConfigs;
}

// Chama a IA e retorna texto. Tenta Gemini, depois OpenAI, depois API local.
async function chamarIA(prompt) {
  const c = await carregarConfigsIA();
  if (!c.gemini && !c.openai && !c.local)
    throw new Error('Nenhuma IA configurada — defina a chave do Gemini ou da OpenAI no admin.');
  let ultimoErro = null;

  // 1) Gemini
  if (c.gemini) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': c.gemini },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } })
      });
      if (res.ok) {
        const data = await res.json();
        const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (txt) { window._aiProvider = 'Gemini'; return txt; }
        ultimoErro = new Error('Gemini retornou vazio');
      } else ultimoErro = new Error('Gemini HTTP ' + res.status);
    } catch (e) { ultimoErro = e; }
  }

  // 2) OpenAI / GPT
  if (c.openai) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.openai },
        body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, messages: [{ role: 'user', content: prompt }] })
      });
      if (res.ok) {
        const data = await res.json();
        const txt = data?.choices?.[0]?.message?.content?.trim();
        if (txt) { window._aiProvider = 'GPT'; return txt; }
        ultimoErro = new Error('OpenAI retornou vazio');
      } else ultimoErro = new Error('OpenAI HTTP ' + res.status);
    } catch (e) { ultimoErro = e; }
  }

  // 3) API local (OpenAI-compatível, ex: Ollama/LM Studio)
  if (c.local) {
    try {
      const base = c.local.replace(/\/$/, '');
      const res = await fetch(base + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'local', temperature: 0.2, messages: [{ role: 'user', content: prompt }] })
      });
      if (res.ok) {
        const data = await res.json();
        const txt = data?.choices?.[0]?.message?.content?.trim();
        if (txt) { window._aiProvider = 'Local'; return txt; }
        ultimoErro = new Error('IA local retornou vazio');
      } else ultimoErro = new Error('IA local HTTP ' + res.status);
    } catch (e) { ultimoErro = e; }
  }

  throw new Error('Falha na IA' + (ultimoErro ? ': ' + ultimoErro.message : ''));
}
function extrairJSON(txt) {
  let t = txt.trim();
  if (t.startsWith('```json')) t = t.replace(/^```json\s*/i, '').replace(/```$/,'');
  else if (t.startsWith('```')) t = t.replace(/^```\s*/, '').replace(/```$/,'');
  // pega do primeiro [ ou { até o último ] ou }
  const ini = Math.min(...['[','{'].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  const fim = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (ini !== Infinity && fim > ini) t = t.slice(ini, fim + 1);
  return JSON.parse(t);
}

async function buscarPlanoIA(marca, modelo, ano) {
  const prompt =
`Você é um especialista em manutenção automotiva. Para o veículo ${marca} ${modelo} ${ano || ''}, liste o plano de manutenção preventiva recomendado pelo fabricante (revisões programadas por quilometragem e/ou tempo).
Responda EXCLUSIVAMENTE com um JSON array válido, sem nenhum texto antes ou depois, no formato:
[{"item":"Troca de óleo do motor e filtro de óleo","categoria":"Óleo/Filtros","intervaloKm":10000,"intervaloMeses":12}]
Regras:
- "categoria" deve ser exatamente uma de: ${JSON.stringify(CATEGORIAS)}.
- "intervaloKm": inteiro de quilômetros entre trocas (0 se for só por tempo).
- "intervaloMeses": inteiro de meses entre trocas (0 se for só por km).
- Inclua de 8 a 14 itens comuns (óleo, filtros de ar/combustível/cabine, velas, correia dentada ou corrente, fluido de freio, líquido de arrefecimento, pastilhas de freio, alinhamento, rodízio de pneus, revisão geral).
- Use valores realistas para este modelo específico; se não tiver certeza, use os padrões do segmento do carro.`;
  const txt = await chamarIA(prompt);
  const arr = extrairJSON(txt);
  if (!Array.isArray(arr)) throw new Error('IA não retornou uma lista');
  return arr.map(x => ({
    id: uidLocal(),
    item: String(x.item || '').slice(0, 120),
    categoria: CATEGORIAS.includes(x.categoria) ? x.categoria : 'Outros',
    intervaloKm: Math.max(0, parseInt(x.intervaloKm, 10) || 0),
    intervaloMeses: Math.max(0, parseInt(x.intervaloMeses, 10) || 0),
    ultimaKm: null,
    ultimaData: null,
  })).filter(x => x.item);
}

/* ================================================================
   CÁLCULO DE ALERTAS
   ================================================================ */
// Retorna { nivel, ordem, texto } — nivel: 'vencida'|'alerta'|'ok'|'neutro'
function statusPlanoItem(item, kmAtual) {
  const partes = [];
  let pior = { nivel: 'neutro', ordem: 0 };
  const registra = (nivel, ordem, texto) => {
    partes.push(texto);
    const rank = { neutro: 0, ok: 1, alerta: 2, vencida: 3 };
    if (rank[nivel] > rank[pior.nivel] || (rank[nivel] === rank[pior.nivel] && ordem > pior.ordem))
      pior = { nivel, ordem };
  };

  const temKm = item.intervaloKm > 0 && item.ultimaKm != null && Number.isFinite(Number(item.ultimaKm));
  const temTempo = item.intervaloMeses > 0 && item.ultimaData;

  if (temKm) {
    const proxKm = Number(item.ultimaKm) + Number(item.intervaloKm);
    const falta = proxKm - Number(kmAtual || 0);
    if (falta < 0)      registra('vencida', 100000 - falta, `Vencida há ${formatKm(-falta)}`);
    else if (falta <= LIMITE_KM_ALERTA) registra('alerta', 50000 - falta, `Faltam ${formatKm(falta)}`);
    else                registra('ok', falta, `Faltam ${formatKm(falta)}`);
  }
  if (temTempo) {
    const prox = addMeses(new Date(tsMs(item.ultimaData)), Number(item.intervaloMeses));
    const faltaDias = Math.ceil((prox.getTime() - Date.now()) / 86400000);
    if (faltaDias < 0)       registra('vencida', 100000 - faltaDias, `Vencida há ${-faltaDias} dia(s)`);
    else if (faltaDias <= LIMITE_DIAS_ALERTA) registra('alerta', 50000 - faltaDias, `Vence em ${faltaDias} dia(s)`);
    else                     registra('ok', faltaDias, `Vence em ${faltaDias} dia(s)`);
  }

  if (!temKm && !temTempo) return { nivel: 'neutro', ordem: 0, texto: 'Sem base — registre a última troca' };
  return { nivel: pior.nivel, ordem: pior.ordem, texto: partes.join(' · ') };
}

function statusDocumento(doc) {
  if (!doc.vencimento) return { nivel: 'neutro', ordem: 0, texto: 'Sem data de vencimento' };
  const faltaDias = Math.ceil((tsMs(doc.vencimento) - Date.now()) / 86400000);
  if (faltaDias < 0)       return { nivel: 'vencida', ordem: 100000 - faltaDias, texto: `Vencido há ${-faltaDias} dia(s)` };
  if (faltaDias <= LIMITE_DIAS_ALERTA) return { nivel: 'alerta', ordem: 50000 - faltaDias, texto: `Vence em ${faltaDias} dia(s)` };
  return { nivel: 'ok', ordem: faltaDias, texto: `Vence em ${faltaDias} dia(s)` };
}

// Lista de alertas (plano + documentos) de um veículo
function alertasDoVeiculo(carro) {
  const out = [];
  (carro.planoManutencao || []).forEach(item => {
    const st = statusPlanoItem(item, carro.kmAtual);
    if (st.nivel === 'vencida' || st.nivel === 'alerta')
      out.push({ carro, tipo: 'plano', item, nivel: st.nivel, ordem: st.ordem, titulo: item.item, texto: st.texto });
  });
  (carro.documentos || []).forEach(doc => {
    const st = statusDocumento(doc);
    if (st.nivel === 'vencida' || st.nivel === 'alerta')
      out.push({ carro, tipo: 'documento', item: doc, nivel: st.nivel, ordem: st.ordem, titulo: `${doc.tipo}${doc.numero ? ' · ' + doc.numero : ''}`, texto: st.texto });
  });
  return out;
}
function todosAlertas() {
  return _carros.flatMap(alertasDoVeiculo).sort((a, b) => b.ordem - a.ordem);
}
// Pior status geral do veículo (para a cor do card)
function statusVeiculo(carro) {
  let pior = 'neutro';
  const rank = { neutro: 0, ok: 1, alerta: 2, vencida: 3 };
  const consid = st => { if (rank[st] > rank[pior]) pior = st; };
  (carro.planoManutencao || []).forEach(i => consid(statusPlanoItem(i, carro.kmAtual).nivel));
  (carro.documentos || []).forEach(d => consid(statusDocumento(d).nivel));
  return pior;
}
function badgeNivel(nivel) {
  return { vencida: 'badge-vencida', alerta: 'badge-alerta', ok: 'badge-ok', neutro: 'badge-neutro' }[nivel] || 'badge-neutro';
}
function classeNivel(nivel) {
  return { vencida: 's-vencida', alerta: 's-alerta', ok: 's-ok', neutro: 's-neutro' }[nivel] || 's-neutro';
}

/* ================================================================
   INIT + ROUTER
   ================================================================ */
async function iniciarApp() {
  const can = window._can;
  const papel = window._isAdmin ? 'Administrador' : 'Usuário';
  document.getElementById('sidebarUser').innerHTML =
    `<b>${escapeHTML(window._userNome)}</b><br>${papel}`;

  if (can.moverLixeira || can.restaurar || can.apagarPermanente) {
    const l = document.getElementById('navLixeira'); if (l) l.style.display = '';
    const f = document.getElementById('labelFerramentas'); if (f) f.style.display = '';
  }

  document.addEventListener('click', e => {
    if (e.target.classList && e.target.classList.contains('zoomable')) abrirFotoSrc(e.target.src);
  });

  // Pré-carrega as chaves de IA (silencioso) para acelerar o 1º uso
  carregarConfigsIA();

  try {
    await carregarDados();
  } catch (e) {
    mostrarNotificacao('Erro ao carregar dados: ' + e.message, 'erro');
  }
  atualizarBadgeAlertas();
  irPara('dashboard');
}

async function carregarDados() {
  const [cs, ms] = await Promise.all([COL_CARROS().get(), COL_MANUT().get()]);
  _carros = cs.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.deletado);
  _manut  = ms.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => !m.deletado);
  _carros.sort((a, b) => (a.apelido || a.modelo || '').localeCompare(b.apelido || b.modelo || ''));
  _manut.sort((a, b) => tsMs(b.data) - tsMs(a.data));
}

function atualizarBadgeAlertas() {
  const n = todosAlertas().length;
  const el = document.getElementById('badgeAlertas');
  if (!el) return;
  el.textContent = n;
  el.style.display = n ? 'inline-flex' : 'none';
}

function irPara(view) {
  const bloqueio = {
    lixeira: () => window._can.moverLixeira || window._can.restaurar || window._can.apagarPermanente,
  };
  if (bloqueio[view] && !bloqueio[view]()) view = 'dashboard';

  _viewAtual = view;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const root = document.getElementById('viewRoot');
  destruirCharts();
  root.innerHTML = '';
  ({
    dashboard:   renderDashboard,
    veiculos:    renderVeiculos,
    manutencoes: renderManutencoes,
    alertas:     renderAlertas,
    lixeira:     renderLixeira,
    detalhe:     renderDetalhe,
  }[view] || renderDashboard)(root);
}

function statCard(cor, icon, valor, label) {
  return `<div class="card stat-card">
    <div class="stat-icon ${cor}"><i class="${icon}"></i></div>
    <div class="stat-value">${valor}</div>
    <div class="stat-label">${label}</div>
  </div>`;
}
function vazio(icon, msg) { return `<div class="empty"><i class="fas ${icon}"></i>${escapeHTML(msg)}</div>`; }

/* ================================================================
   DASHBOARD
   ================================================================ */
function manutMes() { return _manut.filter(m => mesmoMes(tsMs(m.data))); }
function gastoTotal(lista) { return lista.reduce((a, m) => a + (Number(m.valorTotal) || 0), 0); }

function renderDashboard(root) {
  const alertas = todosAlertas();
  const vencidos = alertas.filter(a => a.nivel === 'vencida');
  const mMes = manutMes();

  root.innerHTML = `
    <div class="view-header">
      <div class="view-title">
        <h2><i class="fas fa-chart-line"></i> Dashboard</h2>
        <p>Visão geral da frota, alertas e custos de manutenção.</p>
      </div>
      <div class="view-actions">
        ${window._can.gerenciarVeiculos ? `<button class="btn btn-primary" onclick="abrirModalVeiculo()"><i class="fas fa-plus"></i> Novo veículo</button>` : ''}
        ${window._can.adicionar ? `<button class="btn" onclick="abrirModalManutencao()"><i class="fas fa-screwdriver-wrench"></i> Registrar manutenção</button>` : ''}
      </div>
    </div>

    <div class="grid grid-stats">
      ${statCard('si-blue','fas fa-car-side', _carros.length, 'Veículos na frota')}
      ${statCard('si-green','fas fa-screwdriver-wrench', mMes.length, 'Manutenções no mês')}
      ${statCard('si-purple','fas fa-money-bill-wave', formatBRL(gastoTotal(mMes)), 'Gasto no mês')}
      ${statCard(vencidos.length ? 'si-red' : 'si-amber','fas fa-triangle-exclamation', alertas.length, 'Alertas ativos')}
    </div>

    <div class="section">
      <div class="section-head"><h3><i class="fas fa-bell"></i> Alertas prioritários</h3>
        ${alertas.length ? `<button class="btn btn-sm" onclick="irPara('alertas')">Ver todos (${alertas.length})</button>` : ''}
      </div>
      ${alertas.length ? `<div class="list">${alertas.slice(0, 6).map(alertaRow).join('')}</div>`
                       : `<div class="card" style="text-align:center;color:var(--muted)"><i class="fas fa-circle-check" style="color:var(--success);margin-right:8px"></i>Nenhum alerta — toda a frota está em dia.</div>`}
    </div>

    <div class="section">
      <div class="section-head"><h3><i class="fas fa-chart-pie"></i> Custos e indicadores</h3></div>
      <div class="charts-grid">
        <div class="chart-card"><h4><i class="fas fa-chart-column"></i> Gasto mensal (12 meses)</h4><div class="chart-wrap"><canvas id="chartMensal"></canvas></div></div>
        <div class="chart-card"><h4><i class="fas fa-car"></i> Gasto por veículo</h4><div class="chart-wrap"><canvas id="chartVeiculo"></canvas></div></div>
        <div class="chart-card"><h4><i class="fas fa-tags"></i> Gasto por categoria</h4><div class="chart-wrap"><canvas id="chartCategoria"></canvas></div></div>
        <div class="chart-card"><h4><i class="fas fa-wrench"></i> Preventiva x Corretiva</h4><div class="chart-wrap"><canvas id="chartTipo"></canvas></div></div>
      </div>
    </div>`;

  renderGraficos();
}

function alertaRow(a) {
  const icon = a.tipo === 'documento' ? 'fa-file-contract' : 'fa-oil-can';
  const cor = a.nivel === 'vencida' ? 'si-red' : 'si-amber';
  return `<div class="semaforo-item ${classeNivel(a.nivel)}" onclick="abrirDetalhe('${a.carro.id}')" style="cursor:pointer">
    <div class="lr-icon ${cor}"><i class="fas ${icon}"></i></div>
    <div class="lr-main">
      <div class="lr-title">${escapeHTML(a.titulo)}</div>
      <div class="lr-sub">${escapeHTML(nomeCarro(a.carro))} · ${escapeHTML(a.texto)}</div>
    </div>
    <span class="badge ${badgeNivel(a.nivel)}">${a.nivel === 'vencida' ? 'Vencido' : 'Atenção'}</span>
  </div>`;
}
function nomeCarro(c) { return c.apelido || `${c.marca || ''} ${c.modelo || ''}`.trim() || 'Veículo'; }

/* ── Gráficos (Chart.js) ──────────────────────────── */
function destruirCharts() { Object.values(_charts).forEach(c => { try { c.destroy(); } catch (e) {} }); _charts = {}; }
function temaChart() {
  if (window.Chart) {
    Chart.defaults.color = 'rgba(255,255,255,0.55)';
    Chart.defaults.font.family = "'Barlow', system-ui, sans-serif";
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  }
}
const PALETA = ['#3b82f6','#22c55e','#f59e0b','#a855f7','#ef4444','#06b6d4','#ec4899','#84cc16','#f97316','#14b8a6'];

function renderGraficos() {
  if (!window.Chart) return;
  temaChart();

  // 1) Gasto mensal (últimos 12 meses)
  const meses = [], labels = [];
  const base = new Date(); base.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    meses.push({ y: d.getFullYear(), m: d.getMonth(), total: 0 });
  }
  _manut.forEach(mn => {
    const d = new Date(tsMs(mn.data));
    const slot = meses.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
    if (slot) slot.total += Number(mn.valorTotal) || 0;
  });
  criarChart('chartMensal', 'bar', {
    labels,
    datasets: [{ label: 'Gasto (R$)', data: meses.map(x => x.total), backgroundColor: '#3b82f6', borderRadius: 5 }]
  }, { scales: { y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v } } }, plugins: { legend: { display: false } } });

  // 2) Gasto por veículo (top 8)
  const porVeic = _carros.map(c => ({ nome: nomeCarro(c), total: gastoTotal(_manut.filter(m => m.carroId === c.id)) }))
    .filter(x => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
  if (porVeic.length) criarChart('chartVeiculo', 'bar', {
    labels: porVeic.map(x => x.nome),
    datasets: [{ label: 'Gasto (R$)', data: porVeic.map(x => x.total), backgroundColor: '#22c55e', borderRadius: 5 }]
  }, { indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v } } }, plugins: { legend: { display: false } } });
  else marcarChartVazio('chartVeiculo');

  // 3) Gasto por categoria (itens)
  const cat = {};
  _manut.forEach(mn => (mn.itens || []).forEach(it => {
    const c = it.categoria || 'Outros';
    cat[c] = (cat[c] || 0) + (Number(it.valorPeca) || 0) + (Number(it.valorMaoObra) || 0);
  }));
  const catE = Object.entries(cat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (catE.length) criarChart('chartCategoria', 'doughnut', {
    labels: catE.map(x => x[0]),
    datasets: [{ data: catE.map(x => x[1]), backgroundColor: PALETA, borderWidth: 0 }]
  }, { plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 10 } } } });
  else marcarChartVazio('chartCategoria');

  // 4) Preventiva x Corretiva (por quantidade)
  const tipos = { preventiva: 0, corretiva: 0, revisao: 0, outro: 0 };
  _manut.forEach(mn => { tipos[mn.tipo] = (tipos[mn.tipo] || 0) + 1; });
  const tipoE = Object.entries(tipos).filter(([, v]) => v > 0);
  const rotuloTipo = { preventiva: 'Preventiva', corretiva: 'Corretiva', revisao: 'Revisão', outro: 'Outros' };
  if (tipoE.length) criarChart('chartTipo', 'doughnut', {
    labels: tipoE.map(x => rotuloTipo[x[0]] || x[0]),
    datasets: [{ data: tipoE.map(x => x[1]), backgroundColor: ['#22c55e','#ef4444','#3b82f6','#a855f7'], borderWidth: 0 }]
  }, { plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 10 } } } });
  else marcarChartVazio('chartTipo');
}
function criarChart(id, type, data, options) {
  const el = document.getElementById(id);
  if (!el) return;
  _charts[id] = new Chart(el.getContext('2d'), { type, data, options: { responsive: true, maintainAspectRatio: false, ...options } });
}
function marcarChartVazio(id) {
  const el = document.getElementById(id);
  if (el && el.parentElement) el.parentElement.innerHTML = `<div class="chart-empty">Sem dados suficientes ainda.</div>`;
}

/* ================================================================
   VEÍCULOS (grid de cards)
   ================================================================ */
function renderVeiculos(root) {
  const termo = _filtroVeicTexto.trim().toLowerCase();
  let lista = _carros;
  if (termo) lista = lista.filter(c => `${nomeCarro(c)} ${c.marca||''} ${c.modelo||''} ${c.placa||''}`.toLowerCase().includes(termo));

  root.innerHTML = `
    <div class="view-header">
      <div class="view-title">
        <h2><i class="fas fa-car-side"></i> Veículos</h2>
        <p>${_carros.length} veículo(s) na frota.</p>
      </div>
      <div class="view-actions">
        ${window._can.gerenciarVeiculos ? `<button class="btn btn-primary" onclick="abrirModalVeiculo()"><i class="fas fa-plus"></i> Novo veículo</button>` : ''}
      </div>
    </div>
    <div class="filtros-bar">
      <input class="input busca" placeholder="Buscar por nome, marca, modelo ou placa…" value="${escapeHTML(_filtroVeicTexto)}"
             oninput="_filtroVeicTexto=this.value; renderVeiculos(document.getElementById('viewRoot'))">
    </div>
    ${lista.length ? `<div class="grid grid-auto">${lista.map(cardVeiculo).join('')}</div>`
                   : vazio('fa-car', _carros.length ? 'Nenhum veículo encontrado com esse filtro.' : 'Nenhum veículo cadastrado ainda.')}`;
}

function cardVeiculo(c) {
  const st = statusVeiculo(c);
  const nAlertas = alertasDoVeiculo(c).length;
  const foto = c.fotoBase64
    ? `<img class="vc-foto" src="${c.fotoBase64}" alt="">`
    : `<div class="vc-foto-ph"><i class="fas fa-car-side"></i></div>`;
  return `<div class="veiculo-card ${classeNivel(st)}" onclick="abrirDetalhe('${c.id}')">
    ${foto}
    <div class="vc-body">
      <div class="vc-top">
        <div>
          <div class="vc-nome">${escapeHTML(nomeCarro(c))}</div>
          <div class="vc-sub">${escapeHTML([c.marca, c.modelo, c.ano].filter(Boolean).join(' · '))}</div>
        </div>
        ${nAlertas ? `<span class="badge ${badgeNivel(st)}">${nAlertas} alerta(s)</span>`
                   : `<span class="badge badge-ok">Em dia</span>`}
      </div>
      ${c.placa ? `<span class="vc-placa">${escapeHTML(c.placa)}</span>` : ''}
      <div class="vc-meta">
        <span><i class="fas fa-gauge-high"></i> <b>${formatKm(c.kmAtual)}</b></span>
        <span><i class="fas fa-screwdriver-wrench"></i> <b>${_manut.filter(m => m.carroId === c.id).length}</b> manut.</span>
      </div>
    </div>
  </div>`;
}

/* ================================================================
   DETALHE DO VEÍCULO
   ================================================================ */
function abrirDetalhe(id) { _detalheId = id; _detalheSubtab = 'geral'; irPara('detalhe'); }

function renderDetalhe(root) {
  const c = _carros.find(x => x.id === _detalheId);
  if (!c) { irPara('veiculos'); return; }
  const st = statusVeiculo(c);
  const manuts = _manut.filter(m => m.carroId === c.id).sort((a, b) => tsMs(b.data) - tsMs(a.data));
  const foto = c.fotoBase64
    ? `<img class="det-foto zoomable" src="${c.fotoBase64}" alt="">`
    : `<div class="det-foto-ph"><i class="fas fa-car-side"></i></div>`;

  const tag = (label, valor) => `<div class="det-tag"><span>${label}</span><b>${escapeHTML(valor || '—')}</b></div>`;

  root.innerHTML = `
    <div class="view-header">
      <div class="view-title">
        <h2><i class="fas fa-car-side"></i> ${escapeHTML(nomeCarro(c))}</h2>
        <p><a href="#" onclick="irPara('veiculos');return false" style="color:var(--muted)"><i class="fas fa-arrow-left"></i> Voltar aos veículos</a></p>
      </div>
      <div class="view-actions">
        ${window._can.adicionar ? `<button class="btn btn-primary" onclick="abrirModalManutencao('${c.id}')"><i class="fas fa-screwdriver-wrench"></i> Registrar manutenção</button>` : ''}
        ${window._can.gerenciarVeiculos ? `<button class="btn" onclick="abrirModalKm('${c.id}')"><i class="fas fa-gauge-high"></i> Atualizar KM</button>` : ''}
        ${window._can.gerenciarVeiculos ? `<button class="btn" onclick="abrirModalVeiculo('${c.id}')"><i class="fas fa-pen"></i> Editar</button>` : ''}
        ${window._can.moverLixeira ? `<button class="btn btn-danger" onclick="moverVeiculoLixeira('${c.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>

    <div class="det-hero">
      ${foto}
      <div class="det-info">
        <h2>${escapeHTML(nomeCarro(c))} <span class="badge ${badgeNivel(st)}">${st === 'vencida' ? 'Manutenção vencida' : st === 'alerta' ? 'Atenção' : st === 'ok' ? 'Em dia' : 'Sem alertas'}</span></h2>
        <div class="det-marca">${escapeHTML([c.marca, c.modelo, c.ano].filter(Boolean).join(' · '))}</div>
        <div class="det-tags">
          ${tag('Placa', c.placa)}
          ${tag('KM atual', formatKm(c.kmAtual))}
          ${tag('Cor', c.cor)}
          ${tag('Combustível', c.combustivel)}
          ${c.renavam ? tag('Renavam', c.renavam) : ''}
          ${c.chassi ? tag('Chassi', c.chassi) : ''}
        </div>
      </div>
    </div>

    <div class="subtabs">
      <button class="subtab ${_detalheSubtab==='geral'?'active':''}" onclick="mudarSubtab('geral')"><i class="fas fa-list"></i> Visão geral</button>
      <button class="subtab ${_detalheSubtab==='plano'?'active':''}" onclick="mudarSubtab('plano')"><i class="fas fa-clipboard-list"></i> Plano de manutenção</button>
      <button class="subtab ${_detalheSubtab==='docs'?'active':''}" onclick="mudarSubtab('docs')"><i class="fas fa-file-contract"></i> Documentos</button>
      <button class="subtab ${_detalheSubtab==='hist'?'active':''}" onclick="mudarSubtab('hist')"><i class="fas fa-clock-rotate-left"></i> Histórico (${manuts.length})</button>
    </div>
    <div id="subtabRoot"></div>`;

  renderSubtab(c, manuts);
}
function mudarSubtab(s) {
  _detalheSubtab = s;
  const c = _carros.find(x => x.id === _detalheId);
  if (!c) return;
  const ordem = { geral: 0, plano: 1, docs: 2, hist: 3 };
  const btns = document.querySelectorAll('.subtab');
  btns.forEach(b => b.classList.remove('active'));
  if (btns[ordem[s]]) btns[ordem[s]].classList.add('active');
  renderSubtab(c, _manut.filter(m => m.carroId === c.id).sort((a, b) => tsMs(b.data) - tsMs(a.data)));
}

function renderSubtab(c, manuts) {
  const root = document.getElementById('subtabRoot');
  if (_detalheSubtab === 'plano') return renderSubtabPlano(root, c);
  if (_detalheSubtab === 'docs')  return renderSubtabDocs(root, c);
  if (_detalheSubtab === 'hist')  return renderSubtabHist(root, c, manuts);
  return renderSubtabGeral(root, c, manuts);
}

function renderSubtabGeral(root, c, manuts) {
  const alertas = alertasDoVeiculo(c);
  const gasto = gastoTotal(manuts);
  root.innerHTML = `
    <div class="grid grid-stats">
      ${statCard('si-blue','fas fa-screwdriver-wrench', manuts.length, 'Manutenções')}
      ${statCard('si-purple','fas fa-money-bill-wave', formatBRL(gasto), 'Gasto total')}
      ${statCard(alertas.length ? 'si-red' : 'si-green','fas fa-triangle-exclamation', alertas.length, 'Alertas ativos')}
      ${statCard('si-amber','fas fa-calendar-check', manuts[0] ? formatarData(manuts[0].data) : '—', 'Última manutenção')}
    </div>
    <div class="section">
      <div class="section-head"><h3><i class="fas fa-bell"></i> Alertas deste veículo</h3></div>
      ${alertas.length ? `<div class="list">${alertas.sort((a,b)=>b.ordem-a.ordem).map(alertaRow).join('')}</div>`
                       : `<div class="card" style="text-align:center;color:var(--muted)"><i class="fas fa-circle-check" style="color:var(--success);margin-right:8px"></i>Sem alertas — veículo em dia.</div>`}
    </div>`;
}

function renderSubtabPlano(root, c) {
  const plano = c.planoManutencao || [];
  const linhas = plano.map(item => {
    const st = statusPlanoItem(item, c.kmAtual);
    const prox = [];
    if (item.intervaloKm > 0) prox.push(`${formatKm(item.intervaloKm)}`);
    if (item.intervaloMeses > 0) prox.push(`${item.intervaloMeses} m`);
    return `<tr class="${st.nivel==='vencida'?'linha-vencida':st.nivel==='alerta'?'linha-alerta':''}">
      <td>${escapeHTML(item.item)}</td>
      <td>${escapeHTML(item.categoria || '—')}</td>
      <td>${prox.join(' / ') || '—'}</td>
      <td>${item.ultimaKm != null ? formatKm(item.ultimaKm) : '—'}${item.ultimaData ? ' · ' + formatarData(item.ultimaData) : ''}</td>
      <td class="plano-status-td"><span class="badge ${badgeNivel(st.nivel)}">${escapeHTML(st.texto)}</span></td>
    </tr>`;
  }).join('');

  root.innerHTML = `
    <div class="section-head">
      <h3><i class="fas fa-clipboard-list"></i> Plano de manutenção do fabricante</h3>
      ${window._can.gerenciarVeiculos ? `<button class="btn btn-sm" onclick="abrirModalVeiculo('${c.id}')"><i class="fas fa-pen"></i> Editar plano</button>` : ''}
    </div>
    ${plano.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Item</th><th>Categoria</th><th>Intervalo</th><th>Última troca</th><th>Situação</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>`
      : vazio('fa-clipboard', 'Nenhum item no plano. Edite o veículo para gerar com IA ou adicionar manualmente.')}`;
}

function renderSubtabDocs(root, c) {
  const docs = c.documentos || [];
  const linhas = docs.map(d => {
    const st = statusDocumento(d);
    return `<div class="semaforo-item ${classeNivel(st.nivel)}">
      <div class="lr-icon ${st.nivel==='vencida'?'si-red':st.nivel==='alerta'?'si-amber':'si-blue'}"><i class="fas fa-file-contract"></i></div>
      <div class="lr-main">
        <div class="lr-title">${escapeHTML(d.tipo)}${d.numero ? ' · ' + escapeHTML(d.numero) : ''}</div>
        <div class="lr-sub">${d.vencimento ? 'Vence em ' + formatarData(d.vencimento) : 'Sem vencimento'} · ${escapeHTML(st.texto)}${d.valor ? ' · ' + formatBRL(d.valor) : ''}</div>
      </div>
      <span class="badge ${badgeNivel(st.nivel)}">${st.nivel==='vencida'?'Vencido':st.nivel==='alerta'?'Atenção':st.nivel==='ok'?'Em dia':'—'}</span>
    </div>`;
  }).join('');
  root.innerHTML = `
    <div class="section-head">
      <h3><i class="fas fa-file-contract"></i> Documentos e vencimentos</h3>
      ${window._can.gerenciarVeiculos ? `<button class="btn btn-sm" onclick="abrirModalVeiculo('${c.id}')"><i class="fas fa-pen"></i> Editar documentos</button>` : ''}
    </div>
    ${docs.length ? `<div class="list">${linhas}</div>` : vazio('fa-file', 'Nenhum documento cadastrado (IPVA, licenciamento, seguro…).')}`;
}

function renderSubtabHist(root, c, manuts) {
  root.innerHTML = `
    <div class="section-head">
      <h3><i class="fas fa-clock-rotate-left"></i> Histórico de manutenções</h3>
      ${window._can.adicionar ? `<button class="btn btn-sm btn-primary" onclick="abrirModalManutencao('${c.id}')"><i class="fas fa-plus"></i> Nova</button>` : ''}
    </div>
    ${manuts.length ? `<div class="list">${manuts.map(manutRow).join('')}</div>` : vazio('fa-screwdriver-wrench', 'Nenhuma manutenção registrada para este veículo.')}`;
}

/* ================================================================
   MANUTENÇÕES (lista global)
   ================================================================ */
function renderManutencoes(root) {
  let lista = _manut.slice();
  if (_filtroManutVeiculo !== 'todos') lista = lista.filter(m => m.carroId === _filtroManutVeiculo);
  const termo = _filtroManutTexto.trim().toLowerCase();
  if (termo) lista = lista.filter(m => `${m.descricao||''} ${m.oficina||''} ${nomeCarro(carroDe(m))}`.toLowerCase().includes(termo));

  const opcoes = _carros.map(c => `<option value="${c.id}" ${_filtroManutVeiculo===c.id?'selected':''}>${escapeHTML(nomeCarro(c))}</option>`).join('');

  root.innerHTML = `
    <div class="view-header">
      <div class="view-title">
        <h2><i class="fas fa-screwdriver-wrench"></i> Manutenções</h2>
        <p>${_manut.length} registro(s) · ${formatBRL(gastoTotal(_manut))} no total.</p>
      </div>
      <div class="view-actions">
        ${window._can.adicionar ? `<button class="btn btn-primary" onclick="abrirModalManutencao()"><i class="fas fa-plus"></i> Registrar manutenção</button>` : ''}
      </div>
    </div>
    <div class="filtros-bar">
      <input class="input busca" placeholder="Buscar por descrição, oficina ou veículo…" value="${escapeHTML(_filtroManutTexto)}"
             oninput="_filtroManutTexto=this.value; renderManutencoes(document.getElementById('viewRoot'))">
      <select class="input" onchange="_filtroManutVeiculo=this.value; renderManutencoes(document.getElementById('viewRoot'))">
        <option value="todos">Todos os veículos</option>${opcoes}
      </select>
    </div>
    ${lista.length ? `<div class="list">${lista.map(manutRow).join('')}</div>` : vazio('fa-screwdriver-wrench', 'Nenhuma manutenção encontrada.')}`;
}
function carroDe(m) { return _carros.find(c => c.id === m.carroId) || { marca: '', modelo: '', apelido: 'Veículo removido' }; }

function manutRow(m) {
  const badges = { preventiva: 'badge-preventiva', corretiva: 'badge-corretiva', revisao: 'badge-revisao', outro: 'badge-outro' };
  const rot = { preventiva: 'Preventiva', corretiva: 'Corretiva', revisao: 'Revisão', outro: 'Outro' };
  const c = carroDe(m);
  const nf = m.notaFiscal ? `<i class="fas fa-receipt" title="Com nota fiscal" style="color:var(--muted)"></i>` : '';
  return `<div class="list-row">
    <div class="lr-icon ${m.tipo==='corretiva'?'si-red':m.tipo==='preventiva'?'si-green':'si-blue'}"><i class="fas fa-wrench"></i></div>
    <div class="lr-main" onclick="abrirDetalheManutencao('${m.id}')" style="cursor:pointer">
      <div class="lr-title">${escapeHTML(m.descricao || 'Manutenção')} <span class="badge ${badges[m.tipo]||'badge-outro'}">${rot[m.tipo]||'Outro'}</span> ${nf}</div>
      <div class="lr-sub">${escapeHTML(nomeCarro(c))} · ${formatarData(m.data)} · ${formatKm(m.km)}${m.oficina ? ' · ' + escapeHTML(m.oficina) : ''}</div>
      ${m.criadoPor ? `<div class="item-autor">Registrado por ${escapeHTML(m.criadoPor)}</div>` : ''}
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-weight:700;font-size:15px">${formatBRL(m.valorTotal)}</div>
      <div class="lr-actions" style="margin-top:6px">
        ${window._can.moverLixeira ? `<button class="btn btn-sm btn-danger btn-icon" onclick="moverManutLixeira('${m.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>
  </div>`;
}

function abrirDetalheManutencao(id) {
  const m = _manut.find(x => x.id === id); if (!m) return;
  const c = carroDe(m);
  const rot = { preventiva: 'Preventiva', corretiva: 'Corretiva', revisao: 'Revisão', outro: 'Outro' };
  const itensHTML = (m.itens || []).length
    ? `<div class="tbl-wrap" style="margin-top:6px"><table class="tbl"><thead><tr><th>Item</th><th>Categoria</th><th>Peça</th><th>Mão de obra</th></tr></thead><tbody>
        ${m.itens.map(it => `<tr><td>${escapeHTML(it.nome)}</td><td>${escapeHTML(it.categoria||'—')}</td><td>${formatBRL(it.valorPeca)}</td><td>${formatBRL(it.valorMaoObra)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="hint">Sem itens detalhados.</p>';
  let nfHTML = '';
  if (m.notaFiscal) {
    nfHTML = m.notaFiscal.tipo === 'pdf'
      ? `<a class="nf-pdf" href="${m.notaFiscal.base64}" target="_blank" rel="noopener"><i class="fas fa-file-pdf"></i> ${escapeHTML(m.notaFiscal.nome || 'Nota fiscal.pdf')}</a>`
      : `<img class="nf-thumb zoomable" src="${m.notaFiscal.base64}" alt="Nota fiscal">`;
  }
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-wrench"></i> ${escapeHTML(m.descricao || 'Manutenção')}</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      <div class="det-tags" style="margin-bottom:16px">
        <div class="det-tag"><span>Veículo</span><b>${escapeHTML(nomeCarro(c))}</b></div>
        <div class="det-tag"><span>Tipo</span><b>${rot[m.tipo]||'Outro'}</b></div>
        <div class="det-tag"><span>Data</span><b>${formatarData(m.data)}</b></div>
        <div class="det-tag"><span>KM</span><b>${formatKm(m.km)}</b></div>
        <div class="det-tag"><span>Oficina</span><b>${escapeHTML(m.oficina||'—')}</b></div>
        <div class="det-tag"><span>Total</span><b>${formatBRL(m.valorTotal)}</b></div>
      </div>
      ${m.descricaoLonga ? `<p style="margin-bottom:14px">${escapeHTML(m.descricaoLonga)}</p>` : ''}
      <div class="form-block"><div class="fb-title"><i class="fas fa-list"></i> Itens / serviços</div>${itensHTML}</div>
      ${nfHTML ? `<div class="form-block"><div class="fb-title"><i class="fas fa-receipt"></i> Nota fiscal</div>${nfHTML}</div>` : ''}
      ${m.criadoPor ? `<p class="hint">Registrado por ${escapeHTML(m.criadoPor)} em ${formatarData(m.criadoEmLocal || m.data)}</p>` : ''}
    </div>
    <div class="modal-footer"><button class="btn" onclick="fecharModal()">Fechar</button></div>
  `, 'modal-lg');
}

/* ================================================================
   ALERTAS (view dedicada)
   ================================================================ */
function renderAlertas(root) {
  const alertas = todosAlertas();
  const venc = alertas.filter(a => a.nivel === 'vencida');
  const aten = alertas.filter(a => a.nivel === 'alerta');
  root.innerHTML = `
    <div class="view-header">
      <div class="view-title">
        <h2><i class="fas fa-bell"></i> Alertas de manutenção</h2>
        <p>Trocas e documentos vencidos ou próximos do vencimento (${LIMITE_KM_ALERTA.toLocaleString('pt-BR')} km ou ${LIMITE_DIAS_ALERTA} dias).</p>
      </div>
    </div>
    <div class="grid grid-stats">
      ${statCard('si-red','fas fa-circle-exclamation', venc.length, 'Vencidos')}
      ${statCard('si-amber','fas fa-clock', aten.length, 'Próximos do vencimento')}
      ${statCard('si-green','fas fa-circle-check', _carros.length - new Set(alertas.map(a=>a.carro.id)).size, 'Veículos em dia')}
    </div>
    ${venc.length ? `<div class="section"><div class="section-head"><h3><i class="fas fa-circle-exclamation"></i> Vencidos</h3></div><div class="list">${venc.map(alertaRow).join('')}</div></div>` : ''}
    ${aten.length ? `<div class="section"><div class="section-head"><h3><i class="fas fa-clock"></i> Próximos do vencimento</h3></div><div class="list">${aten.map(alertaRow).join('')}</div></div>` : ''}
    ${!alertas.length ? `<div class="card" style="text-align:center;color:var(--muted);padding:40px"><i class="fas fa-circle-check" style="color:var(--success);font-size:32px;display:block;margin-bottom:12px"></i>Toda a frota está em dia!</div>` : ''}`;
}

/* ================================================================
   MODAL DE VEÍCULO (criar/editar) + IA
   ================================================================ */
function abrirModalVeiculo(id) {
  const c = id ? _carros.find(x => x.id === id) : null;
  _planoEdit = c ? (c.planoManutencao || []).map(p => ({ ...p })) : [];
  _docsEdit  = c ? (c.documentos || []).map(d => ({ ...d })) : [];
  _fotoVeiculo = c ? (c.fotoBase64 || null) : null;

  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-car-side"></i> ${c ? 'Editar veículo' : 'Novo veículo'}</h3>
      <button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      <input type="hidden" id="veicId" value="${c ? c.id : ''}">
      <div class="form-block">
        <div class="fb-title"><i class="fas fa-info-circle"></i> Dados do veículo</div>
        <div class="form-group"><label class="field-label">Apelido / identificação (ex: "Fiorino da entrega")</label>
          <input class="input" id="vApelido" value="${escapeHTML(c?.apelido)}" placeholder="Opcional"></div>
        <div class="form-row-3">
          <div class="form-group"><label class="field-label">Marca *</label><input class="input" id="vMarca" value="${escapeHTML(c?.marca)}" placeholder="Ex: Fiat"></div>
          <div class="form-group"><label class="field-label">Modelo *</label><input class="input" id="vModelo" value="${escapeHTML(c?.modelo)}" placeholder="Ex: Strada"></div>
          <div class="form-group"><label class="field-label">Ano</label><input class="input" id="vAno" type="number" value="${escapeHTML(c?.ano)}" placeholder="2022"></div>
        </div>
        <div class="form-row-3">
          <div class="form-group"><label class="field-label">Placa</label><input class="input input-mono" id="vPlaca" value="${escapeHTML(c?.placa)}" placeholder="ABC1D23" style="text-transform:uppercase"></div>
          <div class="form-group"><label class="field-label">KM atual</label><input class="input" id="vKm" type="number" value="${c?.kmAtual ?? ''}" placeholder="0"></div>
          <div class="form-group"><label class="field-label">Cor</label><input class="input" id="vCor" value="${escapeHTML(c?.cor)}" placeholder="Branco"></div>
        </div>
        <div class="form-row-3">
          <div class="form-group"><label class="field-label">Combustível</label>
            <select class="input" id="vComb">${['','Flex','Gasolina','Etanol','Diesel','GNV','Híbrido','Elétrico'].map(o => `<option ${c?.combustivel===o?'selected':''}>${o}</option>`).join('')}</select></div>
          <div class="form-group"><label class="field-label">Renavam</label><input class="input input-mono" id="vRenavam" value="${escapeHTML(c?.renavam)}"></div>
          <div class="form-group"><label class="field-label">Chassi</label><input class="input input-mono" id="vChassi" value="${escapeHTML(c?.chassi)}"></div>
        </div>
        <div class="form-group"><label class="field-label">Foto do veículo</label>
          <div id="vFotoWrap">${renderFotoVeiculo()}</div>
          <input type="file" id="vFotoInput" accept="image/*" style="display:none" onchange="selecionarFotoVeiculo(this)">
        </div>
      </div>

      <div class="form-block">
        <div class="fb-title"><i class="fas fa-robot"></i> Plano de manutenção do fabricante</div>
        ${window._can.usarIA ? `<div class="ia-box">
          <div class="ia-head"><i class="fas fa-wand-magic-sparkles"></i> Preenchimento automático por IA</div>
          <p>Informe marca, modelo e ano acima e clique abaixo. A IA pesquisa o plano recomendado pelo fabricante e preenche a tabela. Depois é só revisar e ajustar.</p>
          <button type="button" class="btn btn-ia" style="margin-top:10px" id="btnIaPlano" onclick="acaoBuscarPlanoIA()"><i class="fas fa-wand-magic-sparkles"></i> Buscar plano com IA</button>
          <button type="button" class="btn btn-sm" style="margin-top:10px" onclick="carregarPlanoPadrao()"><i class="fas fa-list"></i> Usar plano padrão</button>
          <div class="ia-status" id="iaStatus" style="display:none"></div>
        </div>` : ''}
        <div id="planoEditWrap">${renderPlanoEdit()}</div>
        <button type="button" class="btn btn-sm" style="margin-top:10px" onclick="addLinhaPlano()"><i class="fas fa-plus"></i> Adicionar item</button>
      </div>

      <div class="form-block">
        <div class="fb-title"><i class="fas fa-file-contract"></i> Documentos e vencimentos</div>
        <div id="docsEditWrap">${renderDocsEdit()}</div>
        <button type="button" class="btn btn-sm" style="margin-top:10px" onclick="addLinhaDoc()"><i class="fas fa-plus"></i> Adicionar documento</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="fecharModal()">Cancelar</button>
      <button class="btn btn-primary" id="btnSalvarVeic" onclick="salvarVeiculo()"><i class="fas fa-check"></i> Salvar veículo</button>
    </div>
  `, 'modal-lg');
}

function renderFotoVeiculo() {
  if (_fotoVeiculo) return `<div style="display:flex;gap:10px;align-items:center">
      <img class="nf-thumb" src="${_fotoVeiculo}" style="max-width:140px;max-height:100px">
      <button type="button" class="btn btn-sm btn-danger" onclick="removerFotoVeiculo()"><i class="fas fa-trash"></i> Remover</button>
    </div>`;
  return `<div class="upload-box" onclick="document.getElementById('vFotoInput').click()"><i class="fas fa-camera"></i> Toque para adicionar uma foto</div>`;
}
async function selecionarFotoVeiculo(input) {
  const f = input.files[0]; if (!f) return;
  try { _fotoVeiculo = await comprimirImagem(f, 1024, 0.7); document.getElementById('vFotoWrap').innerHTML = renderFotoVeiculo(); }
  catch (e) { mostrarNotificacao('Falha ao processar imagem', 'erro'); }
}
function removerFotoVeiculo() { _fotoVeiculo = null; document.getElementById('vFotoWrap').innerHTML = renderFotoVeiculo(); }

function renderPlanoEdit() {
  if (!_planoEdit.length) return `<p class="hint">Nenhum item ainda. Use a IA, o plano padrão ou adicione manualmente.</p>`;
  const catOpts = v => CATEGORIAS.map(c => `<option ${c===v?'selected':''}>${c}</option>`).join('');
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Item</th><th>Categoria</th><th class="col-num">Intervalo km</th><th class="col-num">Interv. meses</th><th class="col-num">Última km</th><th>Última data</th><th class="col-act"></th></tr></thead>
    <tbody>${_planoEdit.map((p, i) => `<tr>
      <td><input class="tbl-input" value="${escapeHTML(p.item)}" oninput="_planoEdit[${i}].item=this.value"></td>
      <td><select class="tbl-input" onchange="_planoEdit[${i}].categoria=this.value">${catOpts(p.categoria)}</select></td>
      <td><input class="tbl-input" type="number" value="${p.intervaloKm||0}" oninput="_planoEdit[${i}].intervaloKm=parseInt(this.value)||0"></td>
      <td><input class="tbl-input" type="number" value="${p.intervaloMeses||0}" oninput="_planoEdit[${i}].intervaloMeses=parseInt(this.value)||0"></td>
      <td><input class="tbl-input" type="number" value="${p.ultimaKm ?? ''}" placeholder="—" oninput="_planoEdit[${i}].ultimaKm=this.value===''?null:parseInt(this.value)||0"></td>
      <td><input class="tbl-input" type="date" value="${isoParaInput(p.ultimaData)}" oninput="_planoEdit[${i}].ultimaData=this.value?new Date(this.value).toISOString():null"></td>
      <td class="col-act"><button type="button" class="item-del" onclick="removerLinhaPlano(${i})"><i class="fas fa-times"></i></button></td>
    </tr>`).join('')}</tbody></table></div>`;
}
function addLinhaPlano() { _planoEdit.push({ id: uidLocal(), item: '', categoria: 'Outros', intervaloKm: 0, intervaloMeses: 0, ultimaKm: null, ultimaData: null }); document.getElementById('planoEditWrap').innerHTML = renderPlanoEdit(); }
function removerLinhaPlano(i) { _planoEdit.splice(i, 1); document.getElementById('planoEditWrap').innerHTML = renderPlanoEdit(); }
function carregarPlanoPadrao() {
  if (_planoEdit.length && !confirm('Substituir o plano atual pelo plano padrão?')) return;
  _planoEdit = PLANO_PADRAO.map(p => ({ ...p, id: uidLocal(), ultimaKm: null, ultimaData: null }));
  document.getElementById('planoEditWrap').innerHTML = renderPlanoEdit();
  mostrarNotificacao('Plano padrão carregado — revise antes de salvar');
}

async function acaoBuscarPlanoIA() {
  const marca = document.getElementById('vMarca').value.trim();
  const modelo = document.getElementById('vModelo').value.trim();
  const ano = document.getElementById('vAno').value.trim();
  if (!marca || !modelo) { mostrarNotificacao('Preencha marca e modelo primeiro', 'erro'); return; }
  const btn = document.getElementById('btnIaPlano');
  const status = document.getElementById('iaStatus');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando IA…';
  status.style.display = 'inline-flex'; status.innerHTML = '<i class="fas fa-robot"></i> A IA está pesquisando o plano do fabricante…';
  try {
    const plano = await buscarPlanoIA(marca, modelo, ano);
    if (!plano.length) throw new Error('A IA não retornou itens');
    if (_planoEdit.length && !confirm(`A IA encontrou ${plano.length} itens para ${marca} ${modelo}. Substituir o plano atual?`)) {
      // mescla: mantém os atuais + adiciona os novos
      _planoEdit = _planoEdit.concat(plano);
    } else {
      _planoEdit = plano;
    }
    document.getElementById('planoEditWrap').innerHTML = renderPlanoEdit();
    status.innerHTML = `<i class="fas fa-circle-check" style="color:var(--success)"></i> Plano preenchido (${plano.length} itens)${window._aiProvider ? ' via ' + escapeHTML(window._aiProvider) : ''}. Revise e ajuste se necessário.`;
    mostrarNotificacao('Plano preenchido pela IA — revise e ajuste');
  } catch (e) {
    status.innerHTML = `<i class="fas fa-circle-exclamation" style="color:var(--danger)"></i> ${escapeHTML(e.message)}`;
    mostrarNotificacao('Falha na IA: ' + e.message, 'erro');
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Buscar plano com IA';
  }
}

function renderDocsEdit() {
  if (!_docsEdit.length) return `<p class="hint">Nenhum documento. Adicione IPVA, licenciamento, seguro, etc.</p>`;
  const tipoOpts = v => TIPOS_DOC.map(t => `<option ${t===v?'selected':''}>${t}</option>`).join('');
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Tipo</th><th>Número/obs</th><th>Vencimento</th><th class="col-num">Valor</th><th class="col-act"></th></tr></thead>
    <tbody>${_docsEdit.map((d, i) => `<tr>
      <td><select class="tbl-input" onchange="_docsEdit[${i}].tipo=this.value">${tipoOpts(d.tipo)}</select></td>
      <td><input class="tbl-input" value="${escapeHTML(d.numero)}" oninput="_docsEdit[${i}].numero=this.value"></td>
      <td><input class="tbl-input" type="date" value="${isoParaInput(d.vencimento)}" oninput="_docsEdit[${i}].vencimento=this.value?new Date(this.value).toISOString():null"></td>
      <td><input class="tbl-input" type="number" step="0.01" value="${d.valor ?? ''}" oninput="_docsEdit[${i}].valor=parseFloat(this.value)||0"></td>
      <td class="col-act"><button type="button" class="item-del" onclick="removerLinhaDoc(${i})"><i class="fas fa-times"></i></button></td>
    </tr>`).join('')}</tbody></table></div>`;
}
function addLinhaDoc() { _docsEdit.push({ id: uidLocal(), tipo: 'IPVA', numero: '', vencimento: null, valor: 0 }); document.getElementById('docsEditWrap').innerHTML = renderDocsEdit(); }
function removerLinhaDoc(i) { _docsEdit.splice(i, 1); document.getElementById('docsEditWrap').innerHTML = renderDocsEdit(); }

async function salvarVeiculo() {
  const id = document.getElementById('veicId').value;
  const marca = document.getElementById('vMarca').value.trim();
  const modelo = document.getElementById('vModelo').value.trim();
  if (!marca || !modelo) { mostrarNotificacao('Marca e modelo são obrigatórios', 'erro'); return; }

  const dados = {
    apelido: document.getElementById('vApelido').value.trim(),
    marca, modelo,
    ano: document.getElementById('vAno').value.trim(),
    placa: document.getElementById('vPlaca').value.trim().toUpperCase(),
    kmAtual: parseInt(document.getElementById('vKm').value, 10) || 0,
    cor: document.getElementById('vCor').value.trim(),
    combustivel: document.getElementById('vComb').value,
    renavam: document.getElementById('vRenavam').value.trim(),
    chassi: document.getElementById('vChassi').value.trim(),
    fotoBase64: _fotoVeiculo || '',
    planoManutencao: _planoEdit.map(p => ({
      id: p.id || uidLocal(), item: p.item, categoria: p.categoria || 'Outros',
      intervaloKm: p.intervaloKm || 0, intervaloMeses: p.intervaloMeses || 0,
      ultimaKm: p.ultimaKm ?? null, ultimaData: p.ultimaData || null,
    })).filter(p => p.item.trim()),
    documentos: _docsEdit.map(d => ({
      id: d.id || uidLocal(), tipo: d.tipo, numero: d.numero || '',
      vencimento: d.vencimento || null, valor: d.valor || 0,
    })),
    ativo: true,
  };

  const btn = document.getElementById('btnSalvarVeic');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando…';
  try {
    if (id) {
      await COL_CARROS().doc(id).update(dados);
      mostrarNotificacao('Veículo atualizado');
    } else {
      dados.criadoPor = window._userEmail || '';
      dados.criadoPorUid = window._userUid || '';
      dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      dados.criadoEmLocal = new Date().toISOString();
      dados.deletado = false;
      const ref = await COL_CARROS().add(dados);
      _detalheId = ref.id;
      mostrarNotificacao('Veículo cadastrado');
    }
    await carregarDados();
    atualizarBadgeAlertas();
    fecharModal();
    if (id && _viewAtual === 'detalhe') renderDetalhe(document.getElementById('viewRoot'));
    else irPara(_viewAtual === 'detalhe' ? 'detalhe' : 'veiculos');
  } catch (e) {
    mostrarNotificacao('Erro ao salvar: ' + e.message, 'erro');
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Salvar veículo';
  }
}

/* ── Atualizar KM rápido ──────────────────────────── */
function abrirModalKm(id) {
  const c = _carros.find(x => x.id === id); if (!c) return;
  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-gauge-high"></i> Atualizar KM</h3><button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      <p style="margin-bottom:12px;color:var(--muted)">${escapeHTML(nomeCarro(c))} — atual: <b style="color:var(--text)">${formatKm(c.kmAtual)}</b></p>
      <div class="form-group"><label class="field-label">Nova quilometragem</label><input class="input" id="novoKm" type="number" value="${c.kmAtual||0}"></div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarKm('${id}')"><i class="fas fa-check"></i> Salvar</button></div>
  `);
}
async function salvarKm(id) {
  const km = parseInt(document.getElementById('novoKm').value, 10) || 0;
  try {
    await COL_CARROS().doc(id).update({ kmAtual: km });
    await carregarDados(); atualizarBadgeAlertas(); fecharModal();
    renderDetalhe(document.getElementById('viewRoot'));
    mostrarNotificacao('KM atualizado');
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

/* ================================================================
   MODAL DE MANUTENÇÃO
   ================================================================ */
function abrirModalManutencao(carroId) {
  if (!_carros.length) { mostrarNotificacao('Cadastre um veículo primeiro', 'erro'); return; }
  _itensManut = [{ id: uidLocal(), nome: '', categoria: 'Óleo/Filtros', valorPeca: 0, valorMaoObra: 0 }];
  _nfManut = null;
  const opts = _carros.map(c => `<option value="${c.id}" ${carroId===c.id?'selected':''}>${escapeHTML(nomeCarro(c))} ${c.placa?'· '+escapeHTML(c.placa):''}</option>`).join('');

  abrirModal(`
    <div class="modal-header"><h3><i class="fas fa-screwdriver-wrench"></i> Registrar manutenção</h3><button class="modal-close" onclick="fecharModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-block">
        <div class="fb-title"><i class="fas fa-info-circle"></i> Dados gerais</div>
        <div class="form-group"><label class="field-label">Veículo *</label>
          <select class="input" id="mCarro" onchange="atualizarChecklistPlano()">${opts}</select></div>
        <div class="form-row-3">
          <div class="form-group"><label class="field-label">Tipo</label>
            <select class="input" id="mTipo">
              <option value="preventiva">Preventiva</option>
              <option value="corretiva">Corretiva</option>
              <option value="revisao">Revisão programada</option>
              <option value="outro">Outro</option>
            </select></div>
          <div class="form-group"><label class="field-label">Data *</label><input class="input" id="mData" type="date" value="${hojeInput()}"></div>
          <div class="form-group"><label class="field-label">KM na manutenção *</label><input class="input" id="mKm" type="number" placeholder="0"></div>
        </div>
        <div class="form-group"><label class="field-label">Resumo *</label><input class="input" id="mDesc" placeholder="Ex: Troca de óleo e filtros"></div>
        <div class="form-row">
          <div class="form-group"><label class="field-label">Oficina / fornecedor</label><input class="input" id="mOficina" placeholder="Ex: Auto Center X"></div>
          <div class="form-group"><label class="field-label">Observações</label><input class="input" id="mObs" placeholder="Detalhes adicionais"></div>
        </div>
      </div>

      <div class="form-block">
        <div class="fb-title"><i class="fas fa-list"></i> Itens / serviços e custos</div>
        <div id="itensManutWrap">${renderItensManut()}</div>
        <button type="button" class="btn btn-sm" style="margin-top:8px" onclick="addItemManut()"><i class="fas fa-plus"></i> Adicionar item</button>
        <div style="text-align:right;margin-top:12px;font-size:16px;font-weight:700">Total: <span id="mTotal">${formatBRL(0)}</span></div>
      </div>

      <div class="form-block">
        <div class="fb-title"><i class="fas fa-clipboard-check"></i> Itens do plano atendidos <span class="hint" style="font-weight:400">(reinicia o alerta destes itens)</span></div>
        <div id="checklistPlano">${renderChecklistPlano(carroId || (_carros[0] && _carros[0].id))}</div>
      </div>

      <div class="form-block">
        <div class="fb-title"><i class="fas fa-receipt"></i> Nota fiscal (imagem ou PDF)</div>
        <div id="nfWrap">${renderNfManut()}</div>
        <input type="file" id="nfInput" accept="image/*,application/pdf" style="display:none" onchange="selecionarNf(this)">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="fecharModal()">Cancelar</button>
      <button class="btn btn-primary" id="btnSalvarManut" onclick="salvarManutencao()"><i class="fas fa-check"></i> Registrar</button>
    </div>
  `, 'modal-lg');
}

function renderItensManut() {
  const catOpts = v => CATEGORIAS.map(c => `<option ${c===v?'selected':''}>${c}</option>`).join('');
  return _itensManut.map((it, i) => `<div class="item-linha">
    <input class="input" placeholder="Item/serviço (ex: Óleo 5W30)" value="${escapeHTML(it.nome)}" oninput="_itensManut[${i}].nome=this.value">
    <select class="input" onchange="_itensManut[${i}].categoria=this.value">${catOpts(it.categoria)}</select>
    <input class="input" type="number" step="0.01" placeholder="Peça R$" value="${it.valorPeca||''}" oninput="_itensManut[${i}].valorPeca=parseFloat(this.value)||0; recalcTotal()">
    <input class="input" type="number" step="0.01" placeholder="M. obra R$" value="${it.valorMaoObra||''}" oninput="_itensManut[${i}].valorMaoObra=parseFloat(this.value)||0; recalcTotal()">
    <button type="button" class="item-del" onclick="removerItemManut(${i})"><i class="fas fa-times"></i></button>
  </div>`).join('');
}
function addItemManut() { _itensManut.push({ id: uidLocal(), nome: '', categoria: 'Outros', valorPeca: 0, valorMaoObra: 0 }); document.getElementById('itensManutWrap').innerHTML = renderItensManut(); }
function removerItemManut(i) { _itensManut.splice(i, 1); if (!_itensManut.length) addItemManut(); else document.getElementById('itensManutWrap').innerHTML = renderItensManut(); recalcTotal(); }
function totalManut() { return _itensManut.reduce((a, it) => a + (Number(it.valorPeca)||0) + (Number(it.valorMaoObra)||0), 0); }
function recalcTotal() { const el = document.getElementById('mTotal'); if (el) el.textContent = formatBRL(totalManut()); }

function renderChecklistPlano(carroId) {
  const c = _carros.find(x => x.id === carroId);
  const plano = (c && c.planoManutencao) || [];
  if (!plano.length) return `<p class="hint">Este veículo não tem plano de manutenção cadastrado.</p>`;
  return plano.map(p => `<label class="checkline" style="margin-bottom:8px">
    <input type="checkbox" class="chk-plano" value="${p.id}"> ${escapeHTML(p.item)} <span class="hint">(${escapeHTML(p.categoria||'')})</span>
  </label>`).join('');
}
function atualizarChecklistPlano() {
  const carroId = document.getElementById('mCarro').value;
  document.getElementById('checklistPlano').innerHTML = renderChecklistPlano(carroId);
}

function renderNfManut() {
  if (_nfManut) {
    if (_nfManut.tipo === 'pdf') return `<div style="display:flex;gap:10px;align-items:center"><a class="nf-pdf" href="${_nfManut.base64}" target="_blank"><i class="fas fa-file-pdf"></i> ${escapeHTML(_nfManut.nome)}</a><button type="button" class="btn btn-sm btn-danger" onclick="removerNf()"><i class="fas fa-trash"></i></button></div>`;
    return `<div style="display:flex;gap:10px;align-items:center"><img class="nf-thumb" src="${_nfManut.base64}"><button type="button" class="btn btn-sm btn-danger" onclick="removerNf()"><i class="fas fa-trash"></i> Remover</button></div>`;
  }
  return `<div class="upload-box" onclick="document.getElementById('nfInput').click()"><i class="fas fa-receipt"></i> Toque para anexar a nota fiscal (foto ou PDF)</div>`;
}
async function selecionarNf(input) {
  const f = input.files[0]; if (!f) return;
  try {
    if (f.type === 'application/pdf') {
      if (f.size > 900 * 1024) { mostrarNotificacao('PDF muito grande (máx ~900KB)', 'erro'); return; }
      _nfManut = { tipo: 'pdf', base64: await lerPdfBase64(f), nome: f.name };
    } else {
      _nfManut = { tipo: 'image', base64: await comprimirImagem(f, 1280, 0.7), nome: f.name };
    }
    document.getElementById('nfWrap').innerHTML = renderNfManut();
  } catch (e) { mostrarNotificacao('Falha ao anexar: ' + e.message, 'erro'); }
}
function removerNf() { _nfManut = null; document.getElementById('nfWrap').innerHTML = renderNfManut(); }

async function salvarManutencao() {
  const carroId = document.getElementById('mCarro').value;
  const data = document.getElementById('mData').value;
  const km = parseInt(document.getElementById('mKm').value, 10);
  const desc = document.getElementById('mDesc').value.trim();
  if (!carroId || !data || !Number.isFinite(km) || !desc) {
    mostrarNotificacao('Preencha veículo, data, KM e resumo', 'erro'); return;
  }
  const itens = _itensManut.filter(it => it.nome.trim() || it.valorPeca || it.valorMaoObra)
    .map(it => ({ nome: it.nome.trim(), categoria: it.categoria || 'Outros', valorPeca: Number(it.valorPeca)||0, valorMaoObra: Number(it.valorMaoObra)||0 }));
  const planoAtendidos = Array.from(document.querySelectorAll('.chk-plano:checked')).map(el => el.value);

  const dados = {
    carroId, tipo: document.getElementById('mTipo').value,
    data: new Date(data).toISOString(),
    km, descricao: desc,
    descricaoLonga: document.getElementById('mObs').value.trim(),
    oficina: document.getElementById('mOficina').value.trim(),
    itens, valorTotal: totalManut(),
    notaFiscal: _nfManut || null,
    planoItensAtendidos: planoAtendidos,
    criadoPor: window._userEmail || '',
    criadoPorUid: window._userUid || '',
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoEmLocal: new Date().toISOString(),
    deletado: false,
  };

  const btn = document.getElementById('btnSalvarManut');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando…';
  try {
    await COL_MANUT().add(dados);
    // Atualiza plano (reinicia alertas) + kmAtual do veículo
    const carro = _carros.find(c => c.id === carroId);
    if (carro) {
      const plano = (carro.planoManutencao || []).map(p =>
        planoAtendidos.includes(p.id) ? { ...p, ultimaKm: km, ultimaData: new Date(data).toISOString() } : p);
      const upd = { planoManutencao: plano };
      if (km > (carro.kmAtual || 0)) upd.kmAtual = km;
      await COL_CARROS().doc(carroId).update(upd);
    }
    await carregarDados(); atualizarBadgeAlertas(); fecharModal();
    mostrarNotificacao('Manutenção registrada');
    irPara(_viewAtual === 'detalhe' ? 'detalhe' : _viewAtual === 'dashboard' ? 'dashboard' : 'manutencoes');
  } catch (e) {
    mostrarNotificacao('Erro ao registrar: ' + e.message, 'erro');
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Registrar';
  }
}

/* ================================================================
   LIXEIRA (soft-delete) — grava na lixeira PRIMEIRO, depois marca
   ================================================================ */
async function moverVeiculoLixeira(id) {
  const c = _carros.find(x => x.id === id); if (!c) return;
  if (!confirm(`Mover "${nomeCarro(c)}" para a lixeira? As manutenções continuam registradas.`)) return;
  try {
    await COL_LIXEIRA().add({
      tipoItem: 'carro', refId: id, titulo: nomeCarro(c), dados: c, restaurado: false,
      deletadoPor: window._userEmail || '', deletadoPorUid: window._userUid || '',
      deletadoEm: firebase.firestore.FieldValue.serverTimestamp(), deletadoEmLocal: new Date().toISOString(),
    });
    await COL_CARROS().doc(id).update({ deletado: true });
    await carregarDados(); atualizarBadgeAlertas();
    mostrarNotificacao('Veículo movido para a lixeira');
    irPara('veiculos');
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}
async function moverManutLixeira(id) {
  const m = _manut.find(x => x.id === id); if (!m) return;
  if (!confirm('Mover esta manutenção para a lixeira?')) return;
  try {
    await COL_LIXEIRA().add({
      tipoItem: 'manutencao', refId: id, titulo: (m.descricao || 'Manutenção') + ' · ' + nomeCarro(carroDe(m)), dados: m, restaurado: false,
      deletadoPor: window._userEmail || '', deletadoPorUid: window._userUid || '',
      deletadoEm: firebase.firestore.FieldValue.serverTimestamp(), deletadoEmLocal: new Date().toISOString(),
    });
    await COL_MANUT().doc(id).update({ deletado: true });
    await carregarDados(); atualizarBadgeAlertas();
    mostrarNotificacao('Manutenção movida para a lixeira');
    irPara(_viewAtual);
  } catch (e) { mostrarNotificacao('Erro: ' + e.message, 'erro'); }
}

async function renderLixeira(root) {
  root.innerHTML = `<div class="view-header"><div class="view-title"><h2><i class="fas fa-trash-alt"></i> Lixeira</h2>
    <p>Itens removidos. Restaurar volta o item; apagar permanente${window._can.apagarPermanente ? '' : ' (sem permissão)'} é irreversível.</p></div></div>
    <div class="loading-inline"><i class="fas fa-spinner fa-spin"></i> Carregando…</div>`;
  try {
    const snap = await COL_LIXEIRA().get();
    let itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // itens já restaurados só aparecem para quem pode apagar permanente
    if (!window._can.apagarPermanente) itens = itens.filter(i => !i.restaurado);
    itens.sort((a, b) => tsMs(b.deletadoEm) - tsMs(a.deletadoEm));

    const rows = itens.map(i => `<div class="list-row ${i.restaurado ? 'lixeira-row--restaurado' : ''}">
      <div class="lr-icon si-red"><i class="fas ${i.tipoItem==='carro'?'fa-car-side':'fa-wrench'}"></i></div>
      <div class="lr-main">
        <div class="lr-title">${escapeHTML(i.titulo)} ${i.restaurado ? '<span class="tag-restaurado">restaurado</span>' : ''}</div>
        <div class="lr-sub">${i.tipoItem==='carro'?'Veículo':'Manutenção'} · removido por ${escapeHTML(i.deletadoPor||'—')} · ${formatarData(i.deletadoEmLocal || i.deletadoEm)}</div>
      </div>
      <div class="lr-actions">
        ${window._can.restaurar && !i.restaurado ? `<button class="btn btn-sm btn-success" onclick="restaurarLixeira('${i.id}')"><i class="fas fa-rotate-left"></i> Restaurar</button>` : ''}
        ${window._can.apagarPermanente ? `<button class="btn btn-sm btn-danger" onclick="apagarPermanente('${i.id}')"><i class="fas fa-skull"></i> Apagar</button>` : ''}
      </div>
    </div>`).join('');
    root.querySelector('.loading-inline').outerHTML = itens.length ? `<div class="list">${rows}</div>` : vazio('fa-trash', 'Lixeira vazia.');
  } catch (e) {
    root.innerHTML += vazio('fa-triangle-exclamation', 'Erro ao carregar lixeira: ' + e.message);
  }
}

async function restaurarLixeira(lixId) {
  try {
    const doc = await COL_LIXEIRA().doc(lixId).get();
    if (!doc.exists) return;
    const d = doc.data();
    const col = d.tipoItem === 'carro' ? COL_CARROS() : COL_MANUT();
    await col.doc(d.refId).update({ deletado: false });
    await COL_LIXEIRA().doc(lixId).update({ restaurado: true, restauradoPor: window._userEmail || '', restauradoEm: firebase.firestore.FieldValue.serverTimestamp() });
    await carregarDados(); atualizarBadgeAlertas();
    mostrarNotificacao('Item restaurado');
    renderLixeira(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro ao restaurar: ' + e.message, 'erro'); }
}
async function apagarPermanente(lixId) {
  if (!confirm('Apagar PERMANENTEMENTE? Esta ação não pode ser desfeita.')) return;
  try {
    const doc = await COL_LIXEIRA().doc(lixId).get();
    if (doc.exists) {
      const d = doc.data();
      const col = d.tipoItem === 'carro' ? COL_CARROS() : COL_MANUT();
      try { await col.doc(d.refId).delete(); } catch (e) { /* pode já não existir */ }
    }
    await COL_LIXEIRA().doc(lixId).delete();
    await carregarDados(); atualizarBadgeAlertas();
    mostrarNotificacao('Item apagado permanentemente');
    renderLixeira(document.getElementById('viewRoot'));
  } catch (e) { mostrarNotificacao('Erro ao apagar: ' + e.message, 'erro'); }
}

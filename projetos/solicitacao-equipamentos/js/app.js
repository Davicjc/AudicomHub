// ================================================================
// SOLICITAÇÃO DE EQUIPAMENTOS E PRODUTOS
// Firestore-only. Cada solicitação tem itens (com link/valor),
// imagens, aprovadores e um chat (imagens + PDF) em subcoleção.
// ================================================================

const COL_NAME     = 'solicitacoes-equipamentos';
const LIXEIRA_NAME = 'lixeira-solicitacao-equipamentos';
const PROD_NAME    = 'produtos-equipamentos';
const COL     = () => db.collection(COL_NAME);
const LIXEIRA = () => db.collection(LIXEIRA_NAME);
const PROD    = () => db.collection(PROD_NAME);
const MSGS    = (id) => COL().doc(id).collection('mensagens');

// Anexo máximo (base64) — mantém cada doc de mensagem abaixo de ~1MB.
const MAX_ANEXO_KB = 900;

let _todas   = [];          // todas as solicitações carregadas (não deletadas)
let _aba     = 'minhas';    // 'minhas' | 'todos' | 'metricas'
let _filtro  = 'todos';     // status
let _metPeriodo = 'all';    // '30'|'90'|'180'|'365'|'all' — janela do painel de métricas
let _metDemo    = false;    // painel com dados fictícios (só em memória, não grava no banco)
let _demoCache  = null;     // dataset demo memoizado
let _usuarios = [];         // lista p/ escolher aprovadores
let _produtos = [];         // catálogo de produtos cadastrados
let _editId  = null;        // id em edição (modal nova)
let _imagensNovas = [];     // {base64, nome} da solicitação em criação/edição
let _aprovSel = [];         // aprovadores escolhidos no form {uid,nome,email,status,comentario,em}
let _detId   = null;        // id aberto no detalhe
let _chatUnsub = null;      // listener do chat aberto
let _chatAnexo = null;      // {tipo, base64, nome, sizeKB}
let _listaUnsub = null;
let _prodEditId = null;     // produto em edição no catálogo
let _prodErro   = null;     // mensagem de erro ao carregar o catálogo

// ── Status ────────────────────────────────────────────────────
const STATUS_LABEL = {
    pendente:  'Pendente',
    aprovada:  'Aprovada',
    reprovada: 'Reprovada',
    comprada:  'Comprada',
    recebida:  'Recebida',
    cancelada: 'Cancelada'
};
const STATUS_ICON = {
    pendente:  'fa-clock', aprovada: 'fa-circle-check', reprovada: 'fa-circle-xmark',
    comprada:  'fa-cart-shopping', recebida: 'fa-box-open', cancelada: 'fa-ban'
};
const PRIOR_LABEL = { baixa:'Baixa', media:'Média', alta:'Alta', urgente:'Urgente' };
// Estados finais definidos manualmente por quem tem gerenciarStatus.
const STATUS_MANUAIS = ['comprada', 'recebida', 'cancelada'];

// ================================================================
// SEGURANÇA — escape
// ================================================================
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

// ================================================================
// HELPERS
// ================================================================
function moeda(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}
function iniciais(nome) {
    const p = String(nome || '?').trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length-1][0] : '')).toUpperCase() || '?';
}
function tempoRelativo(ts) {
    if (!ts) return 'agora';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const seg = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seg < 60) return 'agora mesmo';
    if (seg < 3600) return `há ${Math.floor(seg/60)} min`;
    if (seg < 86400) return `há ${Math.floor(seg/3600)} h`;
    if (seg < 604800) return `há ${Math.floor(seg/86400)} d`;
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function horaCurta(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function totalSolicitacao(sol) {
    return (sol.itens || []).reduce((s, it) => s + (Number(it.valorUnit)||0) * (Number(it.qtd)||0), 0);
}
// Deriva o status a partir dos aprovadores (a menos que esteja em estado manual).
function statusEfetivo(sol) {
    if (STATUS_MANUAIS.includes(sol.status)) return sol.status;
    const aprovs = sol.aprovadores || [];
    if (aprovs.some(a => a.status === 'reprovado')) return 'reprovada';
    if (aprovs.length && aprovs.every(a => a.status === 'aprovado')) return 'aprovada';
    return 'pendente';
}
function souAprovadorPendente(sol) {
    return (sol.aprovadores || []).some(a => a.uid === window._userUid && a.status === 'pendente');
}
function souDono(sol) {
    return sol.criadoPorUid === window._userUid;
}
function souAprovador(sol) {
    return (sol.aprovadores || []).some(a => a.uid === window._userUid);
}
// Participante = está envolvido na solicitação (dono ou aprovador).
// Só participantes podem AGIR (chat, editar, status, lixeira). Admin que
// apenas observa via "Todos os Chats" tem visibilidade sem ações.
function souParticipante(sol) {
    return souDono(sol) || souAprovador(sol);
}

// ================================================================
// INIT
// ================================================================
function iniciarApp() {
    carregarUsuarios();
    carregarProdutos();
    // Escuta em tempo real todas as solicitações (ordenadas por data).
    _listaUnsub = COL().orderBy('criadoEm', 'desc').onSnapshot(snap => {
        _todas = [];
        snap.forEach(doc => {
            const d = doc.data();
            if (d.deletado === true) return;
            _todas.push({ id: doc.id, ...d });
        });
        atualizarContadores();
        renderLista();
        if (_aba === 'metricas') renderMetricas();  // painel ao vivo
        renderProdutosDatalist();  // inclui itens já solicitados nas sugestões
        if (document.getElementById('modalProdutos').classList.contains('aberto')) renderProdutosLista();
        // Se um detalhe está aberto, atualiza SÓ o painel de informações
        // (não o chat) para não apagar o que o usuário está digitando.
        if (_detId && document.getElementById('detalheMain')) {
            const atual = _todas.find(s => s.id === _detId);
            if (atual) renderDetalheMain(atual);
        }
    }, err => {
        console.error('Erro ao carregar solicitações:', err);
        document.getElementById('solGrid').innerHTML =
            `<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Erro ao carregar: ${escapeHTML(err.message)}</p></div>`;
    });
}

async function carregarUsuarios() {
    try {
        const snap = await db.collection('users').get();
        _usuarios = [];
        snap.forEach(doc => {
            const d = doc.data();
            if (d.bloqueado === true) return;
            _usuarios.push({ uid: doc.id, nome: d.name || d.email, email: d.email || '' });
        });
        _usuarios.sort((a, b) => a.nome.localeCompare(b.nome));
    } catch (err) {
        console.warn('Não foi possível carregar a lista de usuários:', err);
    }
}

function carregarProdutos() {
    PROD().orderBy('nome').onSnapshot(snap => {
        _prodErro = null;
        _produtos = [];
        snap.forEach(d => _produtos.push({ id: d.id, ...d.data() }));
        renderProdutosDatalist();
        if (document.getElementById('modalProdutos').classList.contains('aberto')) renderProdutosLista();
    }, err => {
        console.error('Catálogo de produtos indisponível:', err);
        _prodErro = err.message || String(err);
        if (document.getElementById('modalProdutos').classList.contains('aberto')) renderProdutosLista();
        showToast('Não foi possível carregar o catálogo de produtos. Verifique as regras do Firebase.', 'error');
    });
}
// Sugestões = catálogo cadastrado + itens já usados em solicitações anteriores
// (assim não é preciso cadastrar tudo no catálogo para reaproveitar).
function renderProdutosDatalist() {
    const dl = document.getElementById('produtosDatalist');
    if (!dl) return;
    const vistos = new Set();
    const nomes = [];
    _produtos.forEach(p => {
        const k = (p.nome || '').trim();
        if (k && !vistos.has(k.toLowerCase())) { vistos.add(k.toLowerCase()); nomes.push(k); }
    });
    _todas.forEach(s => (s.itens || []).forEach(it => {
        const k = (it.nome || '').trim();
        if (k && !vistos.has(k.toLowerCase())) { vistos.add(k.toLowerCase()); nomes.push(k); }
    }));
    nomes.sort((a, b) => a.localeCompare(b));
    dl.innerHTML = nomes.map(n => `<option value="${escapeHTML(n)}"></option>`).join('');
}

// Lista unificada de produtos disponíveis para escolher como item:
// catálogo cadastrado + itens já usados em solicitações (sem duplicar nome).
function catalogoParaItens() {
    const vistos = new Set();
    const lista = [];
    _produtos.forEach(p => {
        const k = (p.nome || '').trim();
        if (!k || vistos.has(k.toLowerCase())) return;
        vistos.add(k.toLowerCase());
        lista.push({ nome: k, valorRef: p.valorRef, link: p.link || '', categoria: p.categoria || '', origem: 'catálogo' });
    });
    _todas.forEach(s => (s.itens || []).forEach(it => {
        const k = (it.nome || '').trim();
        if (!k || vistos.has(k.toLowerCase())) return;
        vistos.add(k.toLowerCase());
        lista.push({ nome: k, valorRef: it.valorUnit, link: it.link || '', categoria: '', origem: 'já solicitado' });
    }));
    lista.sort((a, b) => a.nome.localeCompare(b.nome));
    return lista;
}

let _catItensCache = [];
function abrirListaProdutos() {
    document.getElementById('listaProdBusca').value = '';
    document.getElementById('modalListaProd').classList.add('aberto');
    renderListaProdutos();
    document.getElementById('listaProdBusca').focus();
}
function fecharListaProdutos() {
    document.getElementById('modalListaProd').classList.remove('aberto');
}
function renderListaProdutos() {
    const termo = (document.getElementById('listaProdBusca').value || '').toLowerCase().trim();
    _catItensCache = catalogoParaItens();
    let lista = _catItensCache;
    if (termo) lista = lista.filter(p => p.nome.toLowerCase().includes(termo) || (p.categoria || '').toLowerCase().includes(termo));

    const wrap = document.getElementById('listaProdWrap');
    if (!lista.length) {
        wrap.innerHTML = `<div style="text-align:center;color:var(--text-3);padding:24px">
            <i class="fas fa-box-open" style="font-size:26px;opacity:.3;display:block;margin-bottom:8px"></i>
            ${termo ? 'Nenhum produto encontrado.' : 'Nenhum produto no catálogo nem em solicitações anteriores.'}
        </div>`;
        return;
    }
    wrap.innerHTML = lista.map(p => {
        const idx = _catItensCache.indexOf(p);
        return `
        <div class="prod-item" style="cursor:pointer" onclick="escolherProdutoItem(${idx})">
            <div class="pi-info">
                <div class="pi-nome">${escapeHTML(p.nome)}</div>
                <div class="pi-meta">
                    <span><i class="fas fa-layer-group"></i> ${escapeHTML(p.origem)}</span>
                    ${p.categoria ? `<span><i class="fas fa-tag"></i> ${escapeHTML(p.categoria)}</span>` : ''}
                    ${p.link ? `<span><i class="fas fa-link"></i> com link</span>` : ''}
                </div>
            </div>
            <div class="pi-val">${p.valorRef != null && p.valorRef !== '' ? moeda(p.valorRef) : '—'}</div>
            <div class="pi-acts"><span class="pi-btn" title="Adicionar"><i class="fas fa-plus"></i></span></div>
        </div>`;
    }).join('');
}
function escolherProdutoItem(idx) {
    const p = _catItensCache[idx];
    if (!p) return;
    addItemRow({ nome: p.nome, qtd: 1, valorUnit: (p.valorRef != null && p.valorRef !== '') ? p.valorRef : '', link: p.link || '' });
    recalcularTotalForm();
    showToast(`"${p.nome}" adicionado ✓`, 'success');
    // Mantém o seletor aberto para adicionar vários; foca a busca de novo.
    document.getElementById('listaProdBusca').focus();
}

// ── Abas / filtros ─────────────────────────────────────────────
function trocarAba(aba) {
    _aba = aba;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === aba));
    const title = document.getElementById('pageTitle');
    const sub   = document.getElementById('pageSubtitle');
    const areaSol = document.getElementById('solicitacoesArea');
    const areaMet = document.getElementById('metricasArea');

    if (aba === 'metricas') {
        title.textContent = 'Relatórios & Métricas';
        sub.textContent   = 'Painel de indicadores: quem mais pede, gasto por mês, produtos recorrentes e muito mais.';
        areaSol.style.display = 'none';
        areaMet.style.display = '';
        renderMetricas();
        return;
    }

    areaSol.style.display = '';
    areaMet.style.display = 'none';
    if (aba === 'todos') {
        title.textContent = 'Visão Adm';
        sub.textContent   = 'Todas as solicitações e chats de todos os funcionarios — visão administrativa (somente leitura).';
    } else {
        title.textContent = 'Minhas Solicitações';
        sub.textContent   = 'Solicitações que você criou ou nas quais é aprovador.';
    }
    renderLista();
}
function setFiltro(f) {
    _filtro = f;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filtro === f));
    renderLista();
}
function atualizarContadores() {
    const minhas = _todas.filter(pertenceAMim).length;
    document.getElementById('countMinhas').textContent = minhas;
    const elTodos = document.getElementById('countTodos');
    if (elTodos) elTodos.textContent = _todas.length;
}
function pertenceAMim(sol) {
    return souDono(sol) || (sol.aprovadores || []).some(a => a.uid === window._userUid);
}

// ================================================================
// LISTA
// ================================================================
function renderLista() {
    const grid  = document.getElementById('solGrid');
    const busca = (document.getElementById('buscaInput').value || '').toLowerCase().trim();

    let lista = (_aba === 'todos' && window._can.verTodos)
        ? _todas.slice()
        : _todas.filter(pertenceAMim);

    if (_filtro !== 'todos') lista = lista.filter(s => statusEfetivo(s) === _filtro);

    if (busca) {
        lista = lista.filter(s => {
            const alvo = [
                s.titulo, s.descricao, s.categoria, s.criadoPorNome, s.criadoPor,
                ...(s.itens || []).map(i => i.nome)
            ].join(' ').toLowerCase();
            return alvo.includes(busca);
        });
    }

    if (!lista.length) {
        grid.innerHTML = `<div class="empty-state">
            <i class="fas fa-box-open"></i>
            <p>Nenhuma solicitação encontrada.</p>
        </div>`;
        return;
    }

    grid.innerHTML = lista.map(cardHTML).join('');
}

function cardHTML(sol) {
    const st = statusEfetivo(sol);
    const total = totalSolicitacao(sol);
    const nItens = (sol.itens || []).length;
    const aprovs = sol.aprovadores || [];
    const aprovOk = aprovs.filter(a => a.status === 'aprovado').length;
    const progresso = aprovs.length ? `${aprovOk}/${aprovs.length} aprovações` : 'Sem aprovadores';
    const destinatarios = aprovs.length
        ? aprovs.map(a => escapeHTML(a.nome || a.email)).join(', ')
        : '<i style="color:var(--text-3)">ninguém definido</i>';

    return `
    <div class="sol-card stc-${st}" onclick="abrirDetalhe('${sol.id}')">
        <div class="sol-card-top">
            <div class="sol-card-title">${escapeHTML(sol.titulo || 'Sem título')}</div>
            <span class="badge pr-${escapeHTML(sol.prioridade||'media')}">${escapeHTML(PRIOR_LABEL[sol.prioridade]||'Média')}</span>
        </div>
        ${sol.descricao ? `<div class="sol-card-desc">${escapeHTML(sol.descricao)}</div>` : ''}
        <div class="sol-card-dest">
            <div><i class="fas fa-user-pen"></i> <b>De:</b> ${escapeHTML(sol.criadoPorNome || sol.criadoPor || '—')}</div>
            <div><i class="fas fa-user-check"></i> <b>Para:</b> ${destinatarios}</div>
        </div>
        <div class="sol-card-meta">
            <span><i class="fas fa-cubes"></i> ${nItens} ${nItens === 1 ? 'item' : 'itens'}</span>
            <span><i class="fas fa-circle-check"></i> ${escapeHTML(progresso)}</span>
        </div>
        <div class="sol-card-foot">
            <div class="sol-badges">
                <span class="badge st-${st}"><i class="fas ${STATUS_ICON[st]}"></i> ${STATUS_LABEL[st]}</span>
                ${sol.nMensagens ? `<span class="chat-pill"><i class="fas fa-comment"></i> ${sol.nMensagens}</span>` : ''}
            </div>
            <div class="sol-total">${moeda(total)}</div>
        </div>
    </div>`;
}

// ================================================================
// MODAL: NOVA / EDITAR
// ================================================================
function abrirModalNova(sol = null) {
    _editId = sol ? sol.id : null;
    _imagensNovas = sol ? (sol.imagens || []).slice() : [];
    document.getElementById('modalNovaTitle').innerHTML = sol
        ? '<i class="fas fa-pen"></i> Editar Solicitação'
        : '<i class="fas fa-plus"></i> Nova Solicitação';

    document.getElementById('fTitulo').value     = sol?.titulo || '';
    document.getElementById('fCategoria').value  = sol?.categoria || 'Equipamento';
    document.getElementById('fPrioridade').value = sol?.prioridade || 'media';
    document.getElementById('fDescricao').value  = sol?.descricao || '';

    // Itens
    document.getElementById('itensWrap').innerHTML = '';
    const itens = sol?.itens?.length ? sol.itens : [{}];
    itens.forEach(addItemRow);
    recalcularTotalForm();

    // Imagens
    renderThumbs();

    // Aprovadores (preserva decisões anteriores em edição)
    _aprovSel = (sol?.aprovadores || []).map(a => ({ ...a }));
    document.getElementById('aprovBusca').value = '';
    document.getElementById('aprovDrop').classList.remove('show');
    renderAprovChips();

    document.getElementById('modalNova').classList.add('aberto');
}
function fecharModalNova() {
    document.getElementById('modalNova').classList.remove('aberto');
    _editId = null; _imagensNovas = [];
}

function addItemRow(item = {}) {
    const wrap = document.getElementById('itensWrap');
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
        <input type="text"   class="item-nome"  list="produtosDatalist" placeholder="Pesquise ou digite o produto" value="${escapeHTML(item.nome||'')}" onchange="autofillProduto(this)">
        <input type="number" class="item-qtd"   placeholder="1" min="1" step="1" value="${item.qtd!=null?escapeHTML(item.qtd):1}" oninput="recalcularTotalForm()">
        <input type="number" class="item-valor" placeholder="0,00" min="0" step="0.01" value="${item.valorUnit!=null?escapeHTML(item.valorUnit):''}" oninput="recalcularTotalForm()">
        <input type="text"   class="item-link"  placeholder="https://link-de-compra…" value="${escapeHTML(item.link||'')}">
        <button type="button" class="item-del" onclick="this.parentElement.remove();recalcularTotalForm()"><i class="fas fa-trash"></i></button>
    `;
    wrap.appendChild(row);
}
// Ao escolher/digitar um produto conhecido, preenche valor e link se vazios.
// Procura primeiro no catálogo; se não achar, no histórico de solicitações
// (item mais recente com o mesmo nome — _todas já vem ordenado por data desc).
function autofillProduto(inputNome) {
    const nome = inputNome.value.trim().toLowerCase();
    if (!nome) return;
    let valorRef = null, link = '';
    const prod = _produtos.find(p => (p.nome || '').toLowerCase() === nome);
    if (prod) {
        valorRef = prod.valorRef; link = prod.link || '';
    } else {
        for (const s of _todas) {
            const it = (s.itens || []).find(i => (i.nome || '').toLowerCase() === nome);
            if (it) { valorRef = it.valorUnit; link = it.link || ''; break; }
        }
    }
    const row = inputNome.closest('.item-row');
    const valorEl = row.querySelector('.item-valor');
    const linkEl  = row.querySelector('.item-link');
    if (!valorEl.value && valorRef != null && valorRef !== '') valorEl.value = valorRef;
    if (!linkEl.value && link) linkEl.value = link;
    recalcularTotalForm();
}
function lerItensForm() {
    return [...document.querySelectorAll('#itensWrap .item-row')].map(r => ({
        nome:      r.querySelector('.item-nome').value.trim(),
        qtd:       Number(r.querySelector('.item-qtd').value) || 0,
        valorUnit: Number(r.querySelector('.item-valor').value) || 0,
        link:      r.querySelector('.item-link').value.trim()
    })).filter(i => i.nome);
}
function recalcularTotalForm() {
    const total = [...document.querySelectorAll('#itensWrap .item-row')].reduce((s, r) => {
        const q = Number(r.querySelector('.item-qtd').value) || 0;
        const v = Number(r.querySelector('.item-valor').value) || 0;
        return s + q * v;
    }, 0);
    document.getElementById('itensTotal').textContent = moeda(total);
}

async function onImagensSelecionadas(ev) {
    const files = [...ev.target.files];
    ev.target.value = '';
    for (const f of files) {
        try {
            const { base64 } = await compressImage(f, 1200, 0.72);
            _imagensNovas.push({ base64, nome: f.name });
        } catch (err) {
            showToast('Falha ao processar imagem: ' + err.message, 'error');
        }
    }
    renderThumbs();
}
function renderThumbs() {
    const wrap = document.getElementById('thumbsWrap');
    wrap.innerHTML = _imagensNovas.map((img, i) => `
        <div class="thumb">
            <img src="${img.base64}" alt="">
            <button class="thumb-del" onclick="removerImagemNova(${i})"><i class="fas fa-times"></i></button>
        </div>`).join('');
}
function removerImagemNova(i) { _imagensNovas.splice(i, 1); renderThumbs(); }

// ── Seletor de aprovadores por pesquisa ────────────────────────
function renderAprovChips() {
    const box = document.getElementById('aprovChips');
    box.innerHTML = _aprovSel.map(a => `
        <span class="chip">
            ${escapeHTML(a.nome || a.email)}
            <button type="button" class="chip-x" onclick="removerAprovador('${escaparAttr(a.uid)}')"><i class="fas fa-times"></i></button>
        </span>`).join('');
}
function filtrarAprovadores() {
    const termo = (document.getElementById('aprovBusca').value || '').toLowerCase().trim();
    const drop = document.getElementById('aprovDrop');

    // Só mostra a lista depois de digitar ao menos 1 letra.
    if (!termo) { drop.classList.remove('show'); drop.innerHTML = ''; return; }

    const jaSel = new Set(_aprovSel.map(a => a.uid));
    let lista = _usuarios
        .filter(u => !jaSel.has(u.uid))
        .filter(u => (u.nome + ' ' + u.email).toLowerCase().includes(termo))
        .slice(0, 8);

    if (!_usuarios.length) {
        drop.innerHTML = `<div class="picker-opt vazio">Carregando usuários…</div>`;
    } else if (!lista.length) {
        drop.innerHTML = `<div class="picker-opt vazio">Nenhum usuário encontrado.</div>`;
    } else {
        drop.innerHTML = lista.map(u => `
            <div class="picker-opt" onclick="event.stopPropagation();adicionarAprovador('${escaparAttr(u.uid)}')">
                <div class="po-av">${escapeHTML(iniciais(u.nome))}</div>
                <div><div class="po-nome">${escapeHTML(u.nome)}</div><div class="po-mail">${escapeHTML(u.email)}</div></div>
            </div>`).join('');
    }
    drop.classList.add('show');
}
function adicionarAprovador(uid) {
    if (_aprovSel.some(a => a.uid === uid)) return;
    const u = _usuarios.find(x => x.uid === uid);
    if (!u) return;
    _aprovSel.push({ uid: u.uid, nome: u.nome || '', email: u.email || '', status: 'pendente', comentario: '', em: '' });
    document.getElementById('aprovBusca').value = '';
    renderAprovChips();
    filtrarAprovadores();
    document.getElementById('aprovBusca').focus();
}
function removerAprovador(uid) {
    _aprovSel = _aprovSel.filter(a => a.uid !== uid);
    renderAprovChips();
}
// Fecha o dropdown ao clicar fora dele.
document.addEventListener('click', e => {
    const picker = e.target.closest('.search-picker');
    const drop = document.getElementById('aprovDrop');
    if (drop && !picker) drop.classList.remove('show');
});

async function salvarSolicitacao() {
    const titulo = document.getElementById('fTitulo').value.trim();
    const itens  = lerItensForm();
    if (!titulo)      return showToast('Informe o título da solicitação.', 'error');
    if (!itens.length) return showToast('Adicione ao menos um item.', 'error');

    const btn = document.getElementById('btnSalvarNova');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch spin"></i> Salvando…';

    try {
        const dados = {
            titulo,
            categoria:  document.getElementById('fCategoria').value,
            prioridade: document.getElementById('fPrioridade').value,
            descricao:  document.getElementById('fDescricao').value.trim(),
            itens,
            valorTotal: itens.reduce((s, i) => s + i.qtd * i.valorUnit, 0),
            imagens:    _imagensNovas,
            aprovadores: _aprovSel.map(a => ({ ...a })),
            atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (_editId) {
            await COL().doc(_editId).update(dados);
            await registrarLog(_editId, 'editou os dados da solicitação', 'fa-pen');
            showToast('Solicitação atualizada ✓', 'success');
        } else {
            const ref = await COL().add({
                ...dados,
                status: 'pendente',
                deletado: false,
                nMensagens: 0,
                criadoPor:    window._userEmail || '',
                criadoPorNome: window._userNome || '',
                criadoPorUid: window._userUid || '',
                criadoEm: firebase.firestore.FieldValue.serverTimestamp()
            });
            const nomesAprov = _aprovSel.map(a => a.nome || a.email).join(', ');
            await registrarLog(ref.id, `abriu a solicitação${nomesAprov ? ` e enviou para: ${nomesAprov}` : ''}`, 'fa-flag-checkered');
            showToast('Solicitação criada ✓', 'success');
        }
        fecharModalNova();
    } catch (err) {
        console.error(err);
        showToast('Erro ao salvar: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Salvar solicitação';
    }
}

// ================================================================
// DETALHE
// ================================================================
function abrirDetalhe(id) {
    const sol = _todas.find(s => s.id === id);
    if (!sol) return;
    _detId = id;
    _chatAnexo = null;
    document.getElementById('detTitulo').innerHTML =
        `<i class="fas fa-box-open"></i> ${escapeHTML(sol.titulo || 'Solicitação')}`;

    // Só participantes (dono/aprovador) escrevem no chat. Admin observando
    // via "Todos os Chats" tem apenas visibilidade (somente leitura).
    const participa = souParticipante(sol);
    const chatInputHTML = participa ? `
            <div class="chat-input">
                <div class="chat-attach-preview" id="chatAttachPreview"></div>
                <div class="chat-input-row">
                    <button class="chat-btn-icon" onclick="document.getElementById('chatFile').click()" title="Anexar imagem ou PDF"><i class="fas fa-paperclip"></i></button>
                    <input type="file" id="chatFile" accept="image/*,application/pdf" style="display:none" onchange="onChatAnexo(event)">
                    <textarea id="chatInput" rows="1" placeholder="Escreva uma mensagem…" oninput="autoGrow(this)" onkeydown="chatKeydown(event)"></textarea>
                    <button class="chat-btn-icon chat-btn-send" id="chatSendBtn" onclick="enviarMensagem()"><i class="fas fa-paper-plane"></i></button>
                </div>
            </div>` : `
            <div class="chat-input">
                <div class="readonly-banner" style="margin:0"><i class="fas fa-eye"></i>
                    <span>Somente leitura — você está visualizando com <b>perfil de visibilidade total</b>. Para responder, é preciso ser o solicitante ou um aprovador desta solicitação.</span>
                </div>
            </div>`;

    // Monta o esqueleto UMA vez: painel de info (atualizável) + chat (fixo).
    document.getElementById('detalheConteudo').innerHTML = `
    <div class="detail-layout">
        <div class="detail-main" id="detalheMain"></div>
        <div class="chat-panel">
            <div class="chat-head"><i class="fas fa-comments"></i> Chat da solicitação</div>
            <div class="chat-msgs" id="chatMsgs"><div class="chat-empty"><i class="fas fa-circle-notch spin"></i></div></div>
            ${chatInputHTML}
        </div>
    </div>`;

    renderDetalheMain(sol);
    document.getElementById('modalDetalhe').classList.add('aberto');

    // Chat em tempo real
    if (_chatUnsub) _chatUnsub();
    _chatUnsub = MSGS(id).orderBy('criadoEm', 'asc').onSnapshot(snap => {
        const msgs = [];
        snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
        renderChat(msgs);
    }, err => console.error('Erro no chat:', err));
}
function fecharDetalhe() {
    document.getElementById('modalDetalhe').classList.remove('aberto');
    if (_chatUnsub) { _chatUnsub(); _chatUnsub = null; }
    _detId = null; _chatAnexo = null;
}

// Renderiza SOMENTE o painel esquerdo (informações da solicitação).
function renderDetalheMain(sol) {
    const st = statusEfetivo(sol);
    const total = totalSolicitacao(sol);
    const participa = souParticipante(sol);
    const podeEditar = (souDono(sol) && st === 'pendente') || (window._isAdmin && participa);

    const itensRows = (sol.itens || []).map(it => `
        <tr>
            <td>${escapeHTML(it.nome)}</td>
            <td class="num">${escapeHTML(it.qtd)}</td>
            <td class="num">${moeda(it.valorUnit)}</td>
            <td class="num">${moeda((Number(it.qtd)||0)*(Number(it.valorUnit)||0))}</td>
            <td>${it.link ? `<a class="link-open" href="${escapeHTML(it.link)}" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Abrir</a>` : '<span style="color:var(--text-3)">—</span>'}</td>
        </tr>`).join('');

    const galeria = (sol.imagens || []).length
        ? `<div class="detail-block"><h4><i class="fas fa-images"></i> Imagens</h4>
             <div class="gallery">${sol.imagens.map(img =>
               `<img src="${img.base64}" onclick="abrirLightbox('${escaparAttr(img.base64)}')" alt="">`).join('')}</div></div>`
        : '';

    // Aprovadores
    const aprovItens = (sol.aprovadores || []).map(a => {
        const tag = a.status === 'aprovado'
            ? '<span class="badge st-aprovada"><i class="fas fa-check"></i> Aprovado</span>'
            : a.status === 'reprovado'
            ? '<span class="badge st-reprovada"><i class="fas fa-xmark"></i> Reprovado</span>'
            : '<span class="badge st-pendente"><i class="fas fa-clock"></i> Pendente</span>';
        return `<div class="aprov-item">
            <div class="aprov-avatar">${escapeHTML(iniciais(a.nome))}</div>
            <div class="aprov-info">
                <div class="an">${escapeHTML(a.nome || a.email)}</div>
                <div class="ac">${a.comentario ? escapeHTML(a.comentario) : (a.em ? 'Respondido ' + tempoRelativo(a.em) : 'Aguardando resposta')}</div>
            </div>
            ${tag}
        </div>`;
    }).join('') || '<div style="color:var(--text-3);font-size:13px">Nenhum aprovador definido.</div>';

    const acoesAprov = souAprovadorPendente(sol) ? `
        <div class="aprov-acts">
            <button class="btn-aprovar" onclick="responderAprovacao('${sol.id}','aprovado')"><i class="fas fa-check"></i> Aprovar</button>
            <button class="btn-reprovar" onclick="responderAprovacao('${sol.id}','reprovado')"><i class="fas fa-xmark"></i> Reprovar</button>
        </div>` : '';

    // Controle de status — só participante com gerenciarStatus (observador não age).
    const controlesStatus = (window._can.gerenciarStatus && participa) ? `
        <div class="detail-block">
            <h4><i class="fas fa-flag"></i> Atualizar status</h4>
            <div class="status-controls">
                <button onclick="definirStatus('${sol.id}','comprada')">Marcar como comprada</button>
                <button onclick="definirStatus('${sol.id}','recebida')">Marcar como recebida</button>
                <button onclick="definirStatus('${sol.id}','cancelada')">Cancelar</button>
                ${STATUS_MANUAIS.includes(sol.status) ? `<button onclick="definirStatus('${sol.id}','')">Reabrir (voltar às aprovações)</button>` : ''}
            </div>
        </div>` : '';

    const podeExcluir = window._can.moverLixeira && (souDono(sol) || (window._isAdmin && participa));
    const acoesTopo = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">
            <button class="lixeira-btn-action" onclick="preVisualizar('${sol.id}')"><i class="fas fa-up-right-from-square"></i> Pré-visualizar</button>
            ${podeEditar ? `<button class="lixeira-btn-action" onclick="editarSolicitacao('${sol.id}')"><i class="fas fa-pen"></i> Editar</button>` : ''}
            ${podeExcluir ? `<button class="lixeira-btn-action lixeira-btn-del" onclick="moverParaLixeira('${sol.id}')"><i class="fas fa-trash"></i> Mover p/ lixeira</button>` : ''}
        </div>`;

    const bannerReadonly = !participa ? `
        <div class="readonly-banner"><i class="fas fa-eye"></i>
            <span>Você está visualizando esta solicitação com <b>perfil de visibilidade total (admin)</b>. Como ela não está no seu nome, você tem <b>somente leitura</b> — nenhuma ação disponível.</span>
        </div>` : '';

    const main = document.getElementById('detalheMain');
    if (!main) return;
    main.innerHTML = `
        ${bannerReadonly}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
            <span class="badge st-${st}"><i class="fas ${STATUS_ICON[st]}"></i> ${STATUS_LABEL[st]}</span>
            <span class="badge pr-${escapeHTML(sol.prioridade||'media')}">${escapeHTML(PRIOR_LABEL[sol.prioridade]||'Média')}</span>
            <span class="badge st-cancelada"><i class="fas fa-tag"></i> ${escapeHTML(sol.categoria||'—')}</span>
        </div>

        <div style="font-size:12px;color:var(--text-3);margin-bottom:18px">
            Solicitado por <b style="color:var(--text-2)">${escapeHTML(sol.criadoPorNome||sol.criadoPor||'—')}</b> · ${horaCurta(sol.criadoEm)}
        </div>

        ${acoesTopo}

        ${sol.descricao ? `<div class="detail-block"><h4><i class="fas fa-align-left"></i> Descrição</h4><div class="detail-desc">${escapeHTML(sol.descricao)}</div></div>` : ''}

        <div class="detail-block">
            <h4><i class="fas fa-cubes"></i> Itens solicitados</h4>
            <table class="itens-table">
                <thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Valor unit.</th><th class="num">Subtotal</th><th>Link</th></tr></thead>
                <tbody>${itensRows || '<tr><td colspan="5" style="color:var(--text-3)">Sem itens.</td></tr>'}</tbody>
                <tfoot><tr><td colspan="3"></td><td class="num">${moeda(total)}</td><td></td></tr></tfoot>
            </table>
        </div>

        ${galeria}

        <div class="detail-block">
            <h4><i class="fas fa-user-check"></i> Aprovadores</h4>
            <div class="aprov-list">${aprovItens}</div>
            ${acoesAprov}
        </div>

        ${controlesStatus}`;
}

function editarSolicitacao(id) {
    const sol = _todas.find(s => s.id === id);
    if (!sol) return;
    fecharDetalhe();
    abrirModalNova(sol);
}

// ── Aprovações ─────────────────────────────────────────────────
async function responderAprovacao(id, decisao) {
    const sol = _todas.find(s => s.id === id);
    if (!sol) return;
    let comentario = '';
    if (decisao === 'reprovado') {
        comentario = (prompt('Motivo da reprovação (opcional):') || '').trim();
    }
    const aprovadores = (sol.aprovadores || []).map(a =>
        a.uid === window._userUid
            ? { ...a, status: decisao, comentario, em: new Date().toISOString() }
            : a);

    const patch = { aprovadores };
    // Recalcula status se não estiver em estado manual.
    if (!STATUS_MANUAIS.includes(sol.status)) {
        patch.status = statusEfetivo({ ...sol, aprovadores });
    }
    try {
        await COL().doc(id).update(patch);
        const logTxt = decisao === 'aprovado'
            ? 'aprovou a solicitação'
            : `reprovou a solicitação${comentario ? ` — motivo: ${comentario}` : ''}`;
        await registrarLog(id, logTxt, decisao === 'aprovado' ? 'fa-circle-check' : 'fa-circle-xmark');
        // Se a decisão fechou o ciclo, registra o resultado final também.
        if (patch.status === 'aprovada') await registrarLog(id, 'solicitação totalmente APROVADA (todos os aprovadores aprovaram)', 'fa-thumbs-up');
        if (patch.status === 'reprovada') await registrarLog(id, 'solicitação REPROVADA', 'fa-ban');
        showToast(decisao === 'aprovado' ? 'Você aprovou a solicitação ✓' : 'Você reprovou a solicitação', decisao === 'aprovado' ? 'success' : 'info');
    } catch (err) {
        showToast('Erro ao registrar: ' + err.message, 'error');
    }
}

async function definirStatus(id, status) {
    try {
        // status vazio = reabrir (volta ao fluxo de aprovações)
        const novo = status || statusEfetivo({ ..._todas.find(s => s.id === id), status: '' });
        await COL().doc(id).update({ status: novo });
        const logTxt = status
            ? `alterou o status para "${STATUS_LABEL[novo] || novo}"`
            : 'reabriu a solicitação (voltou ao fluxo de aprovações)';
        await registrarLog(id, logTxt, STATUS_ICON[novo] || 'fa-flag');
        showToast('Status atualizado ✓', 'success');
    } catch (err) {
        showToast('Erro ao atualizar status: ' + err.message, 'error');
    }
}

// ================================================================
// LOG DE AUDITORIA — registra TODA ação como mensagem de sistema no
// próprio chat da solicitação (tipo:'log'). Imutável pelas rules.
// ================================================================
async function registrarLog(solId, texto, icon = 'fa-circle-info') {
    if (!solId) return;
    try {
        await MSGS(solId).add({
            tipo: 'log',
            texto,
            logIcon: icon,
            anexo: null,
            autorNome:  window._userNome || '',
            autorEmail: window._userEmail || '',
            autorUid:   window._userUid || '',
            autorAdmin: !!window._isAdmin,
            criadoEm:   firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.warn('Falha ao registrar log:', err);
    }
}

// ================================================================
// CHAT
// ================================================================
function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
function chatKeydown(ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviarMensagem(); }
}
function renderChat(msgs) {
    const box = document.getElementById('chatMsgs');
    if (!box) return;
    if (!msgs.length) {
        box.innerHTML = `<div class="chat-empty"><i class="fas fa-comment-dots"></i>Nenhuma mensagem ainda.<br>Inicie a conversa.</div>`;
        return;
    }
    box.innerHTML = msgs.map(m => {
        // Mensagens de sistema (auditoria) — renderizadas como linha central.
        if (m.tipo === 'log') {
            const admTag = m.autorAdmin ? '<span class="adm-tag"><i class="fas fa-shield-halved"></i> adm</span> ' : '';
            return `<div class="msg-log">
                <i class="fas ${escapeHTML(m.logIcon || 'fa-circle-info')}"></i>
                <span>${admTag}<b>${escapeHTML(m.autorNome || m.autorEmail || 'Sistema')}</b> ${escapeHTML(m.texto)} <span class="msg-log-time">· ${horaCurta(m.criadoEm)}</span></span>
            </div>`;
        }
        const mine = m.autorUid === window._userUid;
        let anexo = '';
        if (m.anexo) {
            if (m.anexo.tipo === 'image') {
                anexo = `<img class="msg-anexo-img" src="${m.anexo.base64}" onclick="abrirLightbox('${escaparAttr(m.anexo.base64)}')" alt="">`;
            } else {
                anexo = `<a class="msg-anexo-pdf" href="${m.anexo.base64}" download="${escapeHTML(m.anexo.nome||'documento.pdf')}"><i class="fas fa-file-pdf"></i> ${escapeHTML(m.anexo.nome||'documento.pdf')}</a>`;
            }
        }
        const admTag = m.autorAdmin ? '<span class="adm-tag" title="Respondido via perfil de visibilidade total"><i class="fas fa-shield-halved"></i> adm</span> ' : '';
        return `<div class="msg ${mine ? 'mine' : ''}">
            <div class="msg-autor">${admTag}${escapeHTML(m.autorNome || m.autorEmail || '—')}</div>
            ${m.texto ? `<div class="msg-bubble">${escapeHTML(m.texto)}</div>` : ''}
            ${anexo}
            <div class="msg-time">${horaCurta(m.criadoEm)}</div>
        </div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
}

async function onChatAnexo(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
        if (file.type.startsWith('image/')) {
            const { base64, sizeKB } = await compressImage(file, 1400, 0.72);
            _chatAnexo = { tipo: 'image', base64, nome: file.name, sizeKB };
        } else if (file.type === 'application/pdf') {
            const base64 = await lerArquivoBase64(file);
            const sizeKB = Math.round((base64.length * 3 / 4) / 1024);
            if (sizeKB > MAX_ANEXO_KB) {
                showToast(`PDF muito grande (${(sizeKB/1024).toFixed(1)}MB). Máximo ~${(MAX_ANEXO_KB/1024).toFixed(1)}MB.`, 'error');
                return;
            }
            _chatAnexo = { tipo: 'pdf', base64, nome: file.name, sizeKB };
        } else {
            showToast('Envie apenas imagens ou PDF.', 'error');
            return;
        }
        renderChatAttachPreview();
    } catch (err) {
        showToast('Falha ao anexar: ' + err.message, 'error');
    }
}
function lerArquivoBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Erro ao ler arquivo'));
        r.readAsDataURL(file);
    });
}
function renderChatAttachPreview() {
    const el = document.getElementById('chatAttachPreview');
    if (!el) return;
    if (!_chatAnexo) { el.className = 'chat-attach-preview'; el.innerHTML = ''; return; }
    el.className = 'chat-attach-preview show';
    const icone = _chatAnexo.tipo === 'image'
        ? `<img src="${_chatAnexo.base64}" alt="">`
        : `<i class="fas fa-file-pdf" style="font-size:20px;color:var(--primary-lt)"></i>`;
    el.innerHTML = `${icone}<span class="cap-name">${escapeHTML(_chatAnexo.nome)}</span>
        <button onclick="cancelarAnexo()"><i class="fas fa-times"></i></button>`;
}
function cancelarAnexo() { _chatAnexo = null; renderChatAttachPreview(); }

async function enviarMensagem() {
    if (!_detId) return;
    const input = document.getElementById('chatInput');
    const texto = (input.value || '').trim();
    if (!texto && !_chatAnexo) return;

    const btn = document.getElementById('chatSendBtn');
    btn.disabled = true;

    const msg = {
        texto,
        anexo: _chatAnexo || null,
        autorNome:  window._userNome || '',
        autorEmail: window._userEmail || '',
        autorUid:   window._userUid || '',
        autorAdmin: !!window._isAdmin,  // marca respostas via perfil de visibilidade total
        criadoEm:   firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
        await MSGS(_detId).add(msg);
        // Contador para o preview do card (best-effort).
        await COL().doc(_detId).update({ nMensagens: firebase.firestore.FieldValue.increment(1) }).catch(()=>{});
        input.value = ''; autoGrow(input);
        _chatAnexo = null; renderChatAttachPreview();
    } catch (err) {
        showToast('Erro ao enviar: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ================================================================
// LIXEIRA (soft-delete)
// ================================================================
async function moverParaLixeira(id) {
    const sol = _todas.find(s => s.id === id);
    if (!sol) return;
    if (!confirm('Mover esta solicitação para a lixeira?')) return;
    const deletadoEm  = firebase.firestore.FieldValue.serverTimestamp();
    const deletadoPor = window._userEmail || '';
    try {
        // Ordem obrigatória: grava na lixeira PRIMEIRO, depois marca deletado.
        await LIXEIRA().add({
            refId: id,
            titulo: sol.titulo || '(sem título)',
            deletadoEm, deletadoPor, restaurado: false
        });
        await registrarLog(id, 'moveu a solicitação para a lixeira', 'fa-trash');
        await COL().doc(id).update({ deletado: true, deletadoEm, deletadoPor });
        showToast('Movido para a lixeira ✓', 'success');
        fecharDetalhe();
    } catch (err) {
        showToast('Erro ao mover para lixeira: ' + err.message, 'error');
    }
}

async function abrirLixeira() {
    document.getElementById('modalLixeira').classList.add('aberto');
    const cont = document.getElementById('lixeiraContent');
    cont.innerHTML = `<div class="loading-center" style="height:120px"><i class="fas fa-circle-notch spin"></i></div>`;
    try {
        const snap = await LIXEIRA().orderBy('deletadoEm', 'desc').get();
        const itens = [];
        snap.forEach(d => itens.push({ id: d.id, ...d.data() }));
        // Já restaurados só aparecem para quem pode apagar permanentemente.
        const visiveis = itens.filter(i => !i.restaurado || window._can.apagarPermanente);
        if (!visiveis.length) {
            cont.innerHTML = `<div style="text-align:center;color:var(--text-3);padding:30px"><i class="fas fa-trash-alt" style="font-size:28px;opacity:.3;display:block;margin-bottom:10px"></i>Lixeira vazia.</div>`;
            return;
        }
        cont.innerHTML = visiveis.map(i => `
            <div class="lixeira-item ${i.restaurado ? 'lixeira-item--restaurado' : ''}">
                <div class="lixeira-info">
                    <div class="lixeira-nome">${escapeHTML(i.titulo)} ${i.restaurado ? '<span class="lixeira-tag-restaurado">restaurado</span>' : ''}</div>
                    <div class="lixeira-meta">Excluído por ${escapeHTML(i.deletadoPor||'—')} · ${horaCurta(i.deletadoEm)}</div>
                </div>
                <div class="lixeira-actions">
                    ${(!i.restaurado && window._can.restaurar) ? `<button class="lixeira-btn-action" onclick="restaurarItem('${i.id}','${escaparAttr(i.refId)}')"><i class="fas fa-rotate-left"></i> Restaurar</button>` : ''}
                    ${window._can.apagarPermanente ? `<button class="lixeira-btn-action lixeira-btn-del" onclick="apagarPermanente('${i.id}','${escaparAttr(i.refId)}')"><i class="fas fa-trash"></i> Apagar</button>` : ''}
                </div>
            </div>`).join('');
    } catch (err) {
        cont.innerHTML = `<div style="color:var(--error);padding:20px">Erro: ${escapeHTML(err.message)}</div>`;
    }
}
function fecharLixeira() { document.getElementById('modalLixeira').classList.remove('aberto'); }

async function restaurarItem(lixId, refId) {
    try {
        await COL().doc(refId).update({ deletado: false });
        await LIXEIRA().doc(lixId).update({ restaurado: true });
        await registrarLog(refId, 'restaurou a solicitação da lixeira', 'fa-rotate-left');
        showToast('Solicitação restaurada ✓', 'success');
        abrirLixeira();
    } catch (err) {
        showToast('Erro ao restaurar: ' + err.message, 'error');
    }
}
async function apagarPermanente(lixId, refId) {
    if (!confirm('Apagar PERMANENTEMENTE? Esta ação não pode ser desfeita.')) return;
    try {
        // Remove as mensagens do chat, depois o doc e o registro da lixeira.
        const msgsSnap = await MSGS(refId).get();
        const batch = db.batch();
        msgsSnap.forEach(m => batch.delete(m.ref));
        await batch.commit();
        await COL().doc(refId).delete().catch(()=>{});
        await LIXEIRA().doc(lixId).delete();
        showToast('Apagado permanentemente ✓', 'success');
        abrirLixeira();
    } catch (err) {
        showToast('Erro ao apagar: ' + err.message, 'error');
    }
}

// ================================================================
// CATÁLOGO DE PRODUTOS
// ================================================================
function abrirModalProdutos() {
    document.getElementById('modalProdutos').classList.add('aberto');
    cancelarFormProduto();
    renderProdutosLista();
}
function fecharModalProdutos() {
    document.getElementById('modalProdutos').classList.remove('aberto');
}
function renderProdutosLista() {
    const cont = document.getElementById('produtosLista');
    let html = '';

    // Aviso (não bloqueante) se o catálogo estiver indisponível — mas ainda
    // mostramos os produtos vindos das solicitações abaixo.
    if (_prodErro) {
        html += `<div style="padding:14px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:10px;color:#f87171;font-size:12.5px;line-height:1.5;margin-bottom:14px">
            <b><i class="fas fa-triangle-exclamation"></i> Catálogo indisponível:</b> ${escapeHTML(_prodErro)}<br>
            <span style="color:var(--text-3);font-size:12px">Publique a regra <code>produtos-equipamentos</code> no Console. Abaixo mostramos os produtos já usados em solicitações.</span>
        </div>`;
    }

    // 1) Catálogo cadastrado (editável/excluível — têm doc próprio)
    if (_produtos.length) {
        html += `<div class="prod-secao">Catálogo cadastrado</div>`;
        html += _produtos.map(p => `
            <div class="prod-item">
                <div class="pi-info">
                    <div class="pi-nome">${escapeHTML(p.nome)}</div>
                    <div class="pi-meta">
                        ${p.categoria ? `<span><i class="fas fa-tag"></i> ${escapeHTML(p.categoria)}</span>` : ''}
                        ${p.link ? `<a href="${escapeHTML(p.link)}" target="_blank" rel="noopener"><i class="fas fa-link"></i> Link</a>` : ''}
                    </div>
                </div>
                <div class="pi-val">${p.valorRef != null && p.valorRef !== '' ? moeda(p.valorRef) : '—'}</div>
                <div class="pi-acts">
                    <button class="pi-btn" onclick="editarProdutoForm('${p.id}')" title="Editar"><i class="fas fa-pen"></i></button>
                    <button class="pi-btn del" onclick="excluirProduto('${p.id}')" title="Excluir"><i class="fas fa-trash"></i></button>
                </div>
            </div>`).join('');
    }

    // 2) Produtos usados em solicitações que NÃO estão no catálogo
    const nomesCat = new Set(_produtos.map(p => (p.nome || '').toLowerCase()));
    const vistos = new Set(nomesCat);
    const hist = [];
    _todas.forEach(s => (s.itens || []).forEach(it => {
        const k = (it.nome || '').trim();
        if (!k || vistos.has(k.toLowerCase())) return;
        vistos.add(k.toLowerCase());
        hist.push({ nome: k, valorRef: it.valorUnit, link: it.link || '', de: s.titulo || '' });
    }));

    if (hist.length) {
        html += `<div class="prod-secao">Usados em solicitações (não cadastrados no catálogo)</div>`;
        html += hist.map(p => `
            <div class="prod-item">
                <div class="pi-info">
                    <div class="pi-nome">${escapeHTML(p.nome)}</div>
                    <div class="pi-meta">
                        <span><i class="fas fa-file-lines"></i> de: ${escapeHTML(p.de || '—')}</span>
                        ${p.link ? `<a href="${escapeHTML(p.link)}" target="_blank" rel="noopener"><i class="fas fa-link"></i> Link</a>` : ''}
                    </div>
                </div>
                <div class="pi-val">${p.valorRef != null && p.valorRef !== '' ? moeda(p.valorRef) : '—'}</div>
                <div class="pi-acts">
                    ${window._can.gerenciarProdutos ? `<button class="pi-btn" onclick="adicionarAoCatalogo('${escaparAttr(p.nome)}', ${Number(p.valorRef)||0}, '${escaparAttr(p.link)}')" title="Salvar no catálogo"><i class="fas fa-plus"></i></button>` : ''}
                </div>
            </div>`).join('');
    }

    if (!html || (!_produtos.length && !hist.length && !_prodErro)) {
        cont.innerHTML = `<div style="text-align:center;color:var(--text-3);padding:24px"><i class="fas fa-box-open" style="font-size:26px;opacity:.3;display:block;margin-bottom:8px"></i>Nenhum produto cadastrado nem usado em solicitações ainda.</div>`;
        return;
    }
    cont.innerHTML = html;
}

// Salva no catálogo um produto que só existia dentro de solicitações.
async function adicionarAoCatalogo(nome, valorRef, link) {
    try {
        await PROD().add({
            nome, valorRef: valorRef || null, categoria: '', link: link || '',
            criadoPor: window._userEmail || '',
            criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast(`"${nome}" adicionado ao catálogo ✓`, 'success');
    } catch (err) {
        const perm = /permission|insufficient/i.test(err.message || '');
        showToast('Erro ao salvar: ' + err.message + (perm ? ' — publique as regras do Firebase.' : ''), 'error');
    }
}
function novoProdutoForm() {
    _prodEditId = null;
    document.getElementById('pNome').value = '';
    document.getElementById('pValor').value = '';
    document.getElementById('pCategoria').value = '';
    document.getElementById('pLink').value = '';
    const dup = document.getElementById('prodDupAlerta'); if (dup) dup.innerHTML = '';
    document.getElementById('prodForm').style.display = '';
    document.getElementById('btnNovoProd').style.display = 'none';
    document.getElementById('pNome').focus();
}
function editarProdutoForm(id) {
    const p = _produtos.find(x => x.id === id);
    if (!p) return;
    _prodEditId = id;
    document.getElementById('pNome').value = p.nome || '';
    document.getElementById('pValor').value = p.valorRef != null ? p.valorRef : '';
    document.getElementById('pCategoria').value = p.categoria || '';
    document.getElementById('pLink').value = p.link || '';
    const dup = document.getElementById('prodDupAlerta'); if (dup) dup.innerHTML = '';
    document.getElementById('prodForm').style.display = '';
    document.getElementById('btnNovoProd').style.display = 'none';
    document.getElementById('pNome').focus();
}
function cancelarFormProduto() {
    _prodEditId = null;
    const dup = document.getElementById('prodDupAlerta'); if (dup) dup.innerHTML = '';
    document.getElementById('prodForm').style.display = 'none';
    document.getElementById('btnNovoProd').style.display = '';
}
async function salvarProduto() {
    const nome = document.getElementById('pNome').value.trim();
    if (!nome) return showToast('Informe o nome do produto.', 'error');
    const valorRaw = document.getElementById('pValor').value;
    const dados = {
        nome,
        valorRef:  valorRaw === '' ? null : Number(valorRaw),
        categoria: document.getElementById('pCategoria').value.trim(),
        link:      document.getElementById('pLink').value.trim()
    };
    const btn = document.getElementById('btnSalvarProd');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch spin"></i> Salvando…';
    try {
        if (_prodEditId) {
            await PROD().doc(_prodEditId).update(dados);
            showToast('Produto atualizado ✓', 'success');
        } else {
            await PROD().add({
                ...dados,
                criadoPor: window._userEmail || '',
                criadoEm: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('Produto cadastrado ✓', 'success');
        }
        cancelarFormProduto();
    } catch (err) {
        console.error('salvarProduto:', err);
        const perm = /permission|insufficient/i.test(err.message || '');
        showToast('Erro ao salvar produto: ' + err.message + (perm ? ' — publique as regras do Firebase (produtos-equipamentos).' : ''), 'error');
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Salvar produto';
    }
}
// Alerta ao vivo de duplicata enquanto o usuário digita o nome do produto.
// Procura no catálogo e também nos itens já usados em solicitações.
function checarProdutoDuplicado() {
    const el = document.getElementById('prodDupAlerta');
    if (!el) return;
    const nome = (document.getElementById('pNome').value || '').trim().toLowerCase();
    if (!nome || nome.length < 2) { el.innerHTML = ''; return; }

    // Ignora o próprio produto quando está editando.
    const noCatalogo = _produtos.find(p =>
        (p.nome || '').trim().toLowerCase() === nome && p.id !== _prodEditId);
    let ondeSolicitado = null;
    if (!noCatalogo) {
        for (const s of _todas) {
            if ((s.itens || []).some(it => (it.nome || '').trim().toLowerCase() === nome)) {
                ondeSolicitado = s.titulo || '(sem título)';
                break;
            }
        }
    }

    if (noCatalogo) {
        el.innerHTML = `<div class="dup-alerta dup-alerta--erro">
            <i class="fas fa-circle-exclamation"></i>
            <span><b>Este produto já existe no catálogo</b>${noCatalogo.valorRef != null && noCatalogo.valorRef !== '' ? ` (ref. ${escapeHTML(moeda(noCatalogo.valorRef))})` : ''}. Não cadastre de novo — use o existente para não duplicar as métricas.</span>
        </div>`;
    } else if (ondeSolicitado) {
        el.innerHTML = `<div class="dup-alerta dup-alerta--aviso">
            <i class="fas fa-lightbulb"></i>
            <span>Um produto com este nome já foi pedido em <b>“${escapeHTML(ondeSolicitado)}”</b>. Você pode cadastrá-lo no catálogo, mas mantenha o <b>mesmo nome</b> para agrupar corretamente o histórico.</span>
        </div>`;
    } else {
        el.innerHTML = `<div class="dup-alerta dup-alerta--ok">
            <i class="fas fa-circle-check"></i>
            <span>Nenhum produto com este nome encontrado — pode cadastrar.</span>
        </div>`;
    }
}

async function excluirProduto(id) {
    if (!confirm('Remover este produto do catálogo?')) return;
    try {
        await PROD().doc(id).delete();
        showToast('Produto removido ✓', 'success');
    } catch (err) {
        showToast('Erro ao remover: ' + err.message, 'error');
    }
}

// ================================================================
// RELATÓRIOS & MÉTRICAS
// Todos os cálculos derivam de _todas (solicitações em tempo real) e
// _produtos (catálogo). Escopo respeita a permissão: quem tem verTodos
// analisa TODAS as solicitações; os demais, apenas as suas.
// ================================================================
const STATUS_COR = {
    pendente:'#f59e0b', aprovada:'#10b981', reprovada:'#ef4444',
    comprada:'#3b82f6', recebida:'#818cf8', cancelada:'#94a3b8'
};
const MESES_ABREV = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function dataDe(sol) {
    const ts = sol.criadoEm;
    if (!ts) return null;                       // serverTimestamp ainda pendente
    return ts.toDate ? ts.toDate() : new Date(ts);
}
function mesLabel(key) {
    const [y, m] = key.split('-');
    return `${MESES_ABREV[Number(m) - 1]}/${y.slice(2)}`;
}
function plural(n, sing, plur) { return `${n} ${n === 1 ? sing : plur}`; }
// Moeda compacta p/ os cards KPI (evita cortar valores grandes).
// >= 1 milhão → "R$ 1,2 mi"; >= 10 mil → "R$ 172,0 mil"; abaixo → valor cheio.
function moedaKpi(v) {
    const n = Number(v) || 0;
    if (n >= 1e6)   return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mi';
    if (n >= 10000) return 'R$ ' + (n / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mil';
    return moeda(n);
}
function fmtDias(d) {
    const n = Math.round(d);
    if (n <= 0) return 'hoje';
    if (n === 1) return '1 dia';
    if (n < 30) return `${n} dias`;
    const meses = Math.round(n / 30);
    return meses === 1 ? '~1 mês' : `~${meses} meses`;
}

function setPeriodoMetricas(p) {
    _metPeriodo = p;
    document.querySelectorAll('#metPeriodo .filter-chip')
        .forEach(c => c.classList.toggle('active', c.dataset.periodo === p));
    renderMetricas();
}

function renderMetricas() {
    const body = document.getElementById('metricasBody');
    if (!body) return;

    // ── Escopo (permissão) ou modo demo ────────────────────────
    let base;
    const scopeEl = document.getElementById('metScope');
    if (_metDemo) {
        if (!_demoCache) _demoCache = gerarSolicitacoesDemo();
        base = _demoCache.slice();
        if (scopeEl) scopeEl.innerHTML =
            `<i class="fas fa-flask" style="color:#c084fc"></i> <b style="color:#c084fc">Modo demonstração</b> — ${base.length} solicitações fictícias (não estão salvas no banco)`;
    } else {
        const podeTudo = !!window._can.verTodos;
        base = podeTudo ? _todas.slice() : _todas.filter(pertenceAMim);
        if (scopeEl) scopeEl.innerHTML = podeTudo
            ? `<i class="fas fa-globe"></i> Analisando <b>todas as solicitações</b> da equipe`
            : `<i class="fas fa-user"></i> Analisando <b>apenas as suas solicitações</b>`;
    }

    // ── Filtro de período ──────────────────────────────────────
    const dias  = _metPeriodo === 'all' ? null : Number(_metPeriodo);
    const corte = dias ? Date.now() - dias * 86400000 : null;
    const sols  = base.filter(s => {
        if (!corte) return true;
        const d = dataDe(s);
        return d && d.getTime() >= corte;
    });

    if (!sols.length) {
        body.innerHTML = `<div class="empty-state" style="grid-column:auto">
            <i class="fas fa-chart-pie"></i>
            <p>Nenhuma solicitação ${dias ? 'neste período' : 'ainda'} para gerar métricas.</p>
        </div>`;
        return;
    }

    // ── Cálculos ───────────────────────────────────────────────
    const totalSol   = sols.length;
    const valorTotal = sols.reduce((a, s) => a + totalSolicitacao(s), 0);
    const ticket     = totalSol ? valorTotal / totalSol : 0;

    const porStatus = {};
    sols.forEach(s => { const st = statusEfetivo(s); porStatus[st] = (porStatus[st] || 0) + 1; });
    const aprovadas  = (porStatus.aprovada || 0) + (porStatus.comprada || 0) + (porStatus.recebida || 0);
    const decididas  = aprovadas + (porStatus.reprovada || 0);
    const taxaAprov  = decididas ? (aprovadas / decididas * 100) : 0;
    const pendentes  = porStatus.pendente || 0;
    const valorEfetivado = sols
        .filter(s => ['comprada', 'recebida'].includes(statusEfetivo(s)))
        .reduce((a, s) => a + totalSolicitacao(s), 0);

    // Por usuário
    const porUser = {};
    sols.forEach(s => {
        const k = s.criadoPorUid || s.criadoPor || 'desconhecido';
        if (!porUser[k]) porUser[k] = { nome: s.criadoPorNome || s.criadoPor || '—', n: 0, valor: 0 };
        porUser[k].n++;
        porUser[k].valor += totalSolicitacao(s);
    });
    const usuarios = Object.values(porUser).sort((a, b) => b.n - a.n || b.valor - a.valor);

    // Por mês
    const porMes = {};
    sols.forEach(s => {
        const d = dataDe(s); if (!d) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!porMes[key]) porMes[key] = { valor: 0, n: 0 };
        porMes[key].valor += totalSolicitacao(s);
        porMes[key].n++;
    });
    const meses = Object.keys(porMes).sort().slice(-12);  // no máx. 12 colunas

    // Por categoria
    const porCat = {};
    sols.forEach(s => {
        const c = s.categoria || '—';
        if (!porCat[c]) porCat[c] = { n: 0, valor: 0 };
        porCat[c].n++; porCat[c].valor += totalSolicitacao(s);
    });
    const categorias = Object.entries(porCat)
        .map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.valor - a.valor);

    // Produtos (top + recorrência)
    const prodMap = {};
    sols.forEach(s => {
        const d = dataDe(s);
        const vistoNaSol = new Set();
        (s.itens || []).forEach(it => {
            const nome = (it.nome || '').trim(); if (!nome) return;
            const k = nome.toLowerCase();
            if (!prodMap[k]) prodMap[k] = { nome, vezes: 0, qtd: 0, valor: 0, datas: [] };
            const p = prodMap[k];
            p.qtd   += Number(it.qtd) || 0;
            p.valor += (Number(it.qtd) || 0) * (Number(it.valorUnit) || 0);
            if (!vistoNaSol.has(k)) {                 // conta 1x por solicitação
                vistoNaSol.add(k);
                p.vezes++;
                if (d) p.datas.push(d.getTime());
            }
        });
    });
    const produtos = Object.values(prodMap).sort((a, b) => b.vezes - a.vezes || b.qtd - a.qtd);

    // Recorrência: produtos pedidos 2+ vezes → intervalo médio entre pedidos
    const recorrentes = produtos
        .filter(p => p.datas.length >= 2)
        .map(p => {
            const ds = p.datas.slice().sort((a, b) => a - b);
            let soma = 0;
            for (let i = 1; i < ds.length; i++) soma += (ds[i] - ds[i - 1]);
            const mediaDias   = soma / (ds.length - 1) / 86400000;
            const desdeUltimo = (Date.now() - ds[ds.length - 1]) / 86400000;
            return { ...p, mediaDias, desdeUltimo, previsto: mediaDias - desdeUltimo };
        })
        .sort((a, b) => a.mediaDias - b.mediaDias);

    // ── Render ─────────────────────────────────────────────────
    body.innerHTML =
        kpiGridHTML({ totalSol, valorTotal, ticket, taxaAprov, pendentes, valorEfetivado, nProdutos: produtos.length }) +
        `<div class="met-row">
            ${metCard('Valor solicitado por mês', 'fa-chart-column', colunasMesesHTML(meses, porMes))}
            ${metCard('Distribuição por status', 'fa-chart-pie', donutStatusHTML(porStatus, totalSol))}
         </div>` +
        `<div class="met-row">
            ${metCard('Quem mais solicita', 'fa-ranking-star', rankUsuariosHTML(usuarios))}
            ${metCard('Por categoria', 'fa-tags', barrasCategoriaHTML(categorias, valorTotal))}
         </div>` +
        metCard('Produtos mais solicitados', 'fa-box', tabelaProdutosHTML(produtos), 'met-card--full') +
        metCard('Produtos recorrentes — de quanto em quanto tempo são pedidos', 'fa-repeat', tabelaRecorrenciaHTML(recorrentes), 'met-card--full');
}

// ── Componentes de render ──────────────────────────────────────
function metCard(titulo, icon, conteudo, extra = '') {
    return `<div class="met-card ${extra}">
        <h3><i class="fas ${icon}"></i> ${escapeHTML(titulo)}</h3>
        ${conteudo}
    </div>`;
}

function kpiGridHTML(k) {
    const cards = [
        { icon:'fa-file-invoice',  cor:'#818cf8', bg:'rgba(129,140,248,.14)', label:'Solicitações',      val: String(k.totalSol) },
        { icon:'fa-sack-dollar',   cor:'#10b981', bg:'rgba(16,185,129,.14)',  label:'Valor solicitado',  val: moedaKpi(k.valorTotal),     full: moeda(k.valorTotal) },
        { icon:'fa-cart-shopping', cor:'#3b82f6', bg:'rgba(59,130,246,.14)',  label:'Efetivado (compr./receb.)', val: moedaKpi(k.valorEfetivado), full: moeda(k.valorEfetivado) },
        { icon:'fa-receipt',       cor:'#c084fc', bg:'rgba(192,132,252,.14)', label:'Ticket médio',      val: moedaKpi(k.ticket),         full: moeda(k.ticket) },
        { icon:'fa-thumbs-up',     cor:'#34d399', bg:'rgba(52,211,153,.14)',  label:'Taxa de aprovação', val: `${k.taxaAprov.toFixed(0)}%` },
        { icon:'fa-clock',         cor:'#f59e0b', bg:'rgba(245,158,11,.14)',  label:'Pendentes',         val: String(k.pendentes) },
        { icon:'fa-box',           cor:'#a5b4fc', bg:'rgba(165,180,252,.14)', label:'Produtos distintos', val: String(k.nProdutos) },
    ];
    return `<div class="kpi-grid">${cards.map(c => `
        <div class="kpi-card">
            <div class="kpi-icon" style="color:${c.cor};background:${c.bg}"><i class="fas ${c.icon}"></i></div>
            <div class="kpi-body">
                <div class="kpi-val" title="${escapeHTML(c.full || c.val)}">${escapeHTML(c.val)}</div>
                <div class="kpi-label">${escapeHTML(c.label)}</div>
            </div>
        </div>`).join('')}</div>`;
}

function colunasMesesHTML(meses, porMes) {
    if (!meses.length) return semDados();
    const max = Math.max(...meses.map(m => porMes[m].valor)) || 1;
    return `<div class="col-chart">${meses.map(m => {
        const v = porMes[m].valor;
        const h = Math.max(4, Math.round(v / max * 100));
        const rot = v >= 1000 ? 'R$ ' + (v / 1000).toFixed(1).replace('.', ',') + 'k' : moeda(v);
        return `<div class="col-item" title="${escapeHTML(mesLabel(m))}: ${escapeHTML(moeda(v))} · ${plural(porMes[m].n,'pedido','pedidos')}">
            <div class="col-val">${escapeHTML(rot)}</div>
            <div class="col-bar" style="height:${h}%"></div>
            <div class="col-lbl">${escapeHTML(mesLabel(m))}</div>
        </div>`;
    }).join('')}</div>`;
}

function donutStatusHTML(porStatus, total) {
    const ordem = ['pendente','aprovada','reprovada','comprada','recebida','cancelada'];
    let acc = 0;
    const segs = [];
    ordem.forEach(st => {
        const n = porStatus[st] || 0; if (!n) return;
        const frac = n / total;
        segs.push(`${STATUS_COR[st]} ${(acc*360).toFixed(2)}deg ${((acc+frac)*360).toFixed(2)}deg`);
        acc += frac;
    });
    const grad = segs.length ? `conic-gradient(${segs.join(',')})` : 'var(--surface-3)';
    const legenda = ordem.filter(st => porStatus[st]).map(st => `
        <div class="donut-leg-item">
            <span class="donut-dot" style="background:${STATUS_COR[st]}"></span>
            <span class="donut-leg-lbl">${STATUS_LABEL[st]}</span>
            <span class="donut-leg-val">${porStatus[st]} · ${(porStatus[st]/total*100).toFixed(0)}%</span>
        </div>`).join('');
    return `<div class="donut-wrap">
        <div class="donut" style="background:${grad}"><div class="donut-hole"><b>${total}</b><span>total</span></div></div>
        <div class="donut-legend">${legenda}</div>
    </div>`;
}

function rankUsuariosHTML(usuarios) {
    if (!usuarios.length) return semDados();
    const max = usuarios[0].n || 1;
    return `<div class="rank-list">${usuarios.slice(0, 10).map((u, i) => `
        <div class="rank-item">
            <div class="rank-pos">${i + 1}</div>
            <div class="rank-av">${escapeHTML(iniciais(u.nome))}</div>
            <div class="rank-main">
                <div class="rank-nome">${escapeHTML(u.nome)}</div>
                <div class="rank-bar-track"><div class="rank-bar" style="width:${Math.max(6, u.n/max*100)}%"></div></div>
            </div>
            <div class="rank-vals">
                <div class="rank-n">${plural(u.n, 'pedido', 'pedidos')}</div>
                <div class="rank-val">${moeda(u.valor)}</div>
            </div>
        </div>`).join('')}</div>`;
}

function barrasCategoriaHTML(categorias, valorTotal) {
    if (!categorias.length) return semDados();
    const max = Math.max(...categorias.map(c => c.valor)) || 1;
    return `<div class="cat-list">${categorias.map(c => `
        <div class="cat-item">
            <div class="cat-top">
                <span class="cat-nome">${escapeHTML(c.nome)}</span>
                <span class="cat-val">${moeda(c.valor)} <span class="cat-n">· ${plural(c.n,'item','itens')}</span></span>
            </div>
            <div class="cat-bar-track"><div class="cat-bar" style="width:${Math.max(4, c.valor/max*100)}%"></div></div>
        </div>`).join('')}</div>`;
}

function tabelaProdutosHTML(produtos) {
    if (!produtos.length) return semDados();
    return `<div class="met-table-wrap"><table class="met-table">
        <thead><tr><th>#</th><th>Produto</th><th class="num">Vezes pedido</th><th class="num">Qtd total</th><th class="num">Valor total</th></tr></thead>
        <tbody>${produtos.slice(0, 20).map((p, i) => `
            <tr>
                <td class="met-rank">${i + 1}</td>
                <td>${escapeHTML(p.nome)}${p.vezes >= 3 ? ' <span class="tag-hot"><i class="fas fa-fire"></i> recorrente</span>' : ''}</td>
                <td class="num"><b>${p.vezes}</b></td>
                <td class="num">${p.qtd}</td>
                <td class="num">${moeda(p.valor)}</td>
            </tr>`).join('')}</tbody>
    </table></div>${produtos.length > 20 ? `<div class="met-more">+ ${produtos.length - 20} outros produtos</div>` : ''}`;
}

function tabelaRecorrenciaHTML(recorrentes) {
    if (!recorrentes.length) {
        return `<div class="met-hint"><i class="fas fa-circle-info"></i>
            Ainda não há produtos pedidos 2 ou mais vezes no período. Quando um item for solicitado repetidamente, a frequência média entre os pedidos aparecerá aqui.</div>`;
    }
    return `<div class="met-table-wrap"><table class="met-table">
        <thead><tr><th>Produto</th><th class="num">Nº de pedidos</th><th class="num">A cada</th><th class="num">Último pedido</th><th>Próximo previsto</th></tr></thead>
        <tbody>${recorrentes.slice(0, 25).map(p => {
            let prev, cls;
            if (p.previsto <= 0)      { prev = `<span class="prev-due"><i class="fas fa-triangle-exclamation"></i> pedir agora</span>`; }
            else if (p.previsto <= 7) { prev = `<span class="prev-soon">em ${fmtDias(p.previsto)}</span>`; }
            else                      { prev = `<span class="prev-ok">em ${fmtDias(p.previsto)}</span>`; }
            return `<tr>
                <td>${escapeHTML(p.nome)}</td>
                <td class="num"><b>${p.datas.length}</b></td>
                <td class="num"><span class="freq-badge">${fmtDias(p.mediaDias)}</span></td>
                <td class="num">${fmtDias(p.desdeUltimo)} atrás</td>
                <td>${prev}</td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>
    <div class="met-hint" style="margin-top:12px"><i class="fas fa-lightbulb"></i>
        "A cada" é o intervalo médio entre pedidos do mesmo produto. "Próximo previsto" projeta quando ele deve ser solicitado de novo — útil para antecipar compras recorrentes.</div>`;
}

function semDados() {
    return `<div class="met-hint"><i class="fas fa-circle-info"></i> Sem dados suficientes no período selecionado.</div>`;
}

// ── Modo demonstração (dados fictícios, só em memória) ─────────
function toggleMetricasDemo() {
    _metDemo = !_metDemo;
    const b = document.getElementById('btnDemo');
    if (b) {
        b.classList.toggle('ativo', _metDemo);
        b.innerHTML = _metDemo
            ? '<i class="fas fa-xmark"></i> Sair do exemplo'
            : '<i class="fas fa-flask"></i> Dados de exemplo';
    }
    if (_metDemo) showToast('Exibindo dados fictícios — nada foi salvo no banco.', 'info');
    renderMetricas();
}

// Gera um conjunto rico de solicitações fictícias com recorrência realista.
// PRNG com seed fixa → mesma "base" sempre que ligar o modo demo.
function gerarSolicitacoesDemo() {
    let seed = 20260723;
    const rnd  = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const rint = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const DAY  = 86400000;
    const now  = Date.now();

    const nomes = [
        'Ana Paula Ribeiro','Carlos Eduardo Lima','Mariana Souza','João Pedro Alves',
        'Fernanda Costa','Rafael Almeida','Juliana Martins','Bruno Carvalho',
        'Patrícia Gomes','Diego Fernandes','Camila Rocha','Thiago Barbosa'
    ];
    const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.');
    const users = nomes.map((n, i) => ({
        uid: 'demo-u' + i,
        nome: n,
        email: slug(n) + '@audicomtelecom.com.br'
    }));

    // freq = cadência típica (dias) → define o quão recorrente é o produto.
    const produtos = [
        { nome:'Roteador TP-Link Archer C6',        valor:189.90, cat:'Equipamento',         freq:20  },
        { nome:'Cabo de rede Cat6 (caixa 305m)',    valor:420.00, cat:'Material de consumo', freq:14  },
        { nome:'Conector RJ45 (pacote 100un)',      valor:55.00,  cat:'Peça / Reposição',    freq:10  },
        { nome:'ONU Fiberhome AN5506',              valor:145.00, cat:'Equipamento',         freq:25  },
        { nome:'Switch Gigabit 8 portas',           valor:230.00, cat:'Equipamento',         freq:45  },
        { nome:'Alicate de crimpar RJ45',           valor:78.00,  cat:'Ferramenta',          freq:110 },
        { nome:'Fonte chaveada 12V 2A',             valor:35.00,  cat:'Peça / Reposição',    freq:18  },
        { nome:'Fita isolante 3M (rolo)',           valor:6.50,   cat:'Material de consumo', freq:7   },
        { nome:'Abraçadeira nylon 200mm (pacote)',  valor:22.00,  cat:'Material de consumo', freq:12  },
        { nome:'Caixa de emenda óptica CEO',        valor:95.00,  cat:'Peça / Reposição',    freq:30  },
        { nome:'Splitter óptico 1x8',               valor:48.00,  cat:'Peça / Reposição',    freq:22  },
        { nome:'Notebook Dell Inspiron 15',         valor:3200.00,cat:'Equipamento',         freq:180 },
        { nome:'Parafusadeira Bosch GSR 12V',       valor:410.00, cat:'Ferramenta',          freq:150 },
        { nome:'Cordão óptico SC/APC 3m',           valor:9.90,   cat:'Peça / Reposição',    freq:9   },
        { nome:'Escada de fibra 6m',                valor:890.00, cat:'Equipamento',         freq:200 },
        { nome:'Capacete de segurança',             valor:32.00,  cat:'Outro',               freq:60  },
    ];
    const linksDemo = ['https://exemplo.com/produto', ''];
    const titPrefix = ['Compra de','Reposição de','Aquisição de','Pedido de','Estoque —'];

    const mkItem = (p) => ({
        nome: p.nome,
        qtd:  p.valor > 500 ? rint(1, 3) : rint(1, 12),
        valorUnit: Math.round(p.valor * (0.92 + rnd() * 0.16) * 100) / 100,
        link: pick(linksDemo)
    });

    const mkAprov = (n, modo) => {
        const escolhidos = [];
        const usados = new Set();
        while (escolhidos.length < n) {
            const u = pick(users);
            if (usados.has(u.uid)) continue;
            usados.add(u.uid);
            escolhidos.push(u);
        }
        return escolhidos.map((u, i) => {
            let status = 'aprovado';
            if (modo === 'reprovado')   status = i === 0 ? 'reprovado' : 'aprovado';
            if (modo === 'pendente')    status = i === 0 ? 'pendente'  : (rnd() < 0.5 ? 'aprovado' : 'pendente');
            return { uid: u.uid, nome: u.nome, email: u.email, status,
                     comentario: status === 'reprovado' ? 'Fora do orçamento do mês' : '',
                     em: status === 'pendente' ? '' : new Date().toISOString() };
        });
    };

    const sols = [];
    let idc = 0;
    produtos.forEach(prod => {
        // Mais recorrente (freq baixa) ⇒ mais pedidos ao longo de ~11 meses.
        const nPedidos = Math.min(16, Math.max(2, Math.round(310 / prod.freq)));
        let t = now - rint(3, 35) * DAY;              // último pedido recente
        for (let k = 0; k < nPedidos; k++) {
            if (t < now - 335 * DAY) break;
            const data = new Date(t);
            const u = pick(users);
            const itens = [ mkItem(prod) ];
            if (rnd() < 0.4) itens.push(mkItem(pick(produtos)));  // item extra ocasional

            // Distribuição de status/aprovadores
            const nAp = rint(1, 3);
            const r = rnd();
            let status = '', aprovadores;
            if      (r < 0.15) { aprovadores = mkAprov(nAp, 'pendente');  status = ''; }
            else if (r < 0.45) { aprovadores = mkAprov(nAp, 'aprovado');  status = ''; }
            else if (r < 0.55) { aprovadores = mkAprov(nAp, 'reprovado'); status = ''; }
            else if (r < 0.75) { aprovadores = mkAprov(nAp, 'aprovado');  status = 'comprada'; }
            else if (r < 0.90) { aprovadores = mkAprov(nAp, 'aprovado');  status = 'recebida'; }
            else               { aprovadores = mkAprov(nAp, 'aprovado');  status = 'cancelada'; }

            sols.push({
                id: 'demo-' + (idc++),
                titulo: `${pick(titPrefix)} ${prod.nome}`,
                categoria: prod.cat,
                prioridade: pick(['baixa','media','media','media','alta','urgente']),
                descricao: '',
                itens,
                aprovadores,
                status,
                criadoPorUid: u.uid,
                criadoPorNome: u.nome,
                criadoPor: u.email,
                criadoEm: data,
                _demo: true
            });

            t -= (prod.freq + rint(-3, 6)) * DAY;     // recua ~freq dias com ruído
        }
    });

    return sols;
}

// ================================================================
// PRÉ-VISUALIZAÇÃO — abre uma página limpa/imprimível em nova guia.
// Gera um HTML autossuficiente (via Blob) com os dados da solicitação.
// ================================================================
function preVisualizar(id) {
    const sol = _todas.find(s => s.id === id);
    if (!sol) return;
    const html = gerarHtmlPreview(sol);
    const win = window.open('', '_blank');
    if (!win) { showToast('Permita pop-ups para abrir a pré-visualização.', 'error'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
}

function gerarHtmlPreview(sol) {
    const st = statusEfetivo(sol);
    const total = totalSolicitacao(sol);
    const linhas = (sol.itens || []).map(it => {
        const sub = (Number(it.qtd)||0) * (Number(it.valorUnit)||0);
        return `<tr>
            <td>${escapeHTML(it.nome)}</td>
            <td class="n">${escapeHTML(it.qtd)}</td>
            <td class="n">${moeda(it.valorUnit)}</td>
            <td class="n">${moeda(sub)}</td>
            <td>${it.link ? `<a href="${escapeHTML(it.link)}" target="_blank" rel="noopener">Abrir link ↗</a>` : '—'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="5">Sem itens.</td></tr>';

    const aprovs = (sol.aprovadores || []).map(a => {
        const cor = a.status === 'aprovado' ? '#16a34a' : a.status === 'reprovado' ? '#dc2626' : '#d97706';
        const lbl = a.status === 'aprovado' ? 'Aprovado' : a.status === 'reprovado' ? 'Reprovado' : 'Pendente';
        return `<li><b>${escapeHTML(a.nome || a.email)}</b> — <span style="color:${cor}">${lbl}</span>${a.comentario ? ` · ${escapeHTML(a.comentario)}` : ''}</li>`;
    }).join('') || '<li>Nenhum aprovador definido.</li>';

    const imgs = (sol.imagens || []).map(img => `<img src="${img.base64}" alt="">`).join('');

    const stCores = { pendente:'#d97706', aprovada:'#16a34a', reprovada:'#dc2626', comprada:'#2563eb', recebida:'#6366f1', cancelada:'#6b7280' };

    return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(sol.titulo || 'Solicitação')} — Pré-visualização</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; background:#f3f4f6; color:#111827; margin:0; padding:32px; }
  .sheet { max-width:820px; margin:0 auto; background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:40px; box-shadow:0 8px 30px rgba(0,0,0,.08); }
  .top { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:2px solid #111827; padding-bottom:18px; margin-bottom:22px; }
  .brand { font-size:13px; letter-spacing:1px; text-transform:uppercase; color:#6b7280; font-weight:700; }
  h1 { font-size:24px; margin:6px 0 0; }
  .badges span { display:inline-block; font-size:12px; font-weight:700; padding:4px 10px; border-radius:6px; color:#fff; margin-left:6px; }
  .meta { font-size:13px; color:#4b5563; margin-bottom:22px; }
  .meta b { color:#111827; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:#6b7280; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin:26px 0 12px; }
  .desc { white-space:pre-wrap; font-size:14px; line-height:1.7; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#6b7280; font-size:11px; text-transform:uppercase; border-bottom:2px solid #e5e7eb; padding:8px 10px; }
  td { padding:9px 10px; border-bottom:1px solid #f0f0f0; vertical-align:top; }
  td.n, th.n { text-align:right; white-space:nowrap; }
  a { color:#4f46e5; text-decoration:none; }
  tfoot td { font-weight:800; font-size:15px; border-top:2px solid #111827; border-bottom:none; padding-top:12px; }
  ul { margin:0; padding-left:18px; font-size:14px; line-height:1.8; }
  .imgs { display:flex; flex-wrap:wrap; gap:10px; }
  .imgs img { width:150px; height:150px; object-fit:cover; border-radius:8px; border:1px solid #e5e7eb; }
  .print-btn { display:inline-flex; gap:8px; align-items:center; background:#4f46e5; color:#fff; border:none; padding:10px 18px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; margin-bottom:20px; }
  @media print { body { background:#fff; padding:0; } .sheet { border:none; box-shadow:none; } .print-btn { display:none; } }
</style></head>
<body>
  <div class="sheet">
    <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <div class="top">
      <div>
        <div class="brand">AUDICOM · Solicitação de Equipamentos</div>
        <h1>${escapeHTML(sol.titulo || 'Sem título')}</h1>
      </div>
      <div class="badges">
        <span style="background:${stCores[st] || '#6b7280'}">${(STATUS_LABEL[st] || st).toUpperCase()}</span>
        <span style="background:#374151">${escapeHTML((PRIOR_LABEL[sol.prioridade] || 'Média'))}</span>
      </div>
    </div>

    <div class="meta">
      <div><b>Categoria:</b> ${escapeHTML(sol.categoria || '—')}</div>
      <div><b>Solicitado por:</b> ${escapeHTML(sol.criadoPorNome || sol.criadoPor || '—')} · ${horaCurta(sol.criadoEm)}</div>
    </div>

    ${sol.descricao ? `<h2>Descrição / Justificativa</h2><div class="desc">${escapeHTML(sol.descricao)}</div>` : ''}

    <h2>Itens solicitados</h2>
    <table>
      <thead><tr><th>Produto</th><th class="n">Qtd</th><th class="n">Valor unit.</th><th class="n">Subtotal</th><th>Link</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td colspan="3"></td><td class="n">${moeda(total)}</td><td></td></tr></tfoot>
    </table>

    <h2>Aprovadores / Destinatários</h2>
    <ul>${aprovs}</ul>

    ${imgs ? `<h2>Imagens</h2><div class="imgs">${imgs}</div>` : ''}
  </div>
</body></html>`;
}

// ── Lightbox ───────────────────────────────────────────────────
function abrirLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('aberto');
}

// Fecha modais com ESC
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.getElementById('lightbox').classList.remove('aberto');
        if (document.getElementById('modalListaProd').classList.contains('aberto')) return fecharListaProdutos();
        if (document.getElementById('modalProdutos').classList.contains('aberto')) return fecharModalProdutos();
        if (document.getElementById('modalLixeira').classList.contains('aberto')) return fecharLixeira();
        if (document.getElementById('modalNova').classList.contains('aberto'))    return fecharModalNova();
        if (document.getElementById('modalDetalhe').classList.contains('aberto')) return fecharDetalhe();
    }
});

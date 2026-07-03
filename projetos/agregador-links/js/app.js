// Agregador de Links - AUDICOM

const PROJ_COL    = () => db.collection('projetos').doc('agregador-links').collection('abas');
const LINKS_COL   = (abaId) => PROJ_COL().doc(abaId).collection('links');
const LIXEIRA_REF = () => db.collection('lixeira-links');

let abasCarregadas = [];
let abaAtiva = null;
let _currentLinks = []; // links da aba ativa em memória (para reordenar)
let _searchTerm = '';   // termo de busca da aba ativa

// ── Segurança: escape ─────────────────────────────────────────
function escapeHTML(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escaparAttr(str) {
    return String(str || '')
        .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;')
        .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// Garante protocolo na URL (para o href funcionar)
function normalizarUrl(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    return 'https://' + u;
}

// Retorna host limpo para exibição e favicon
function hostDaUrl(url) {
    try { return new URL(normalizarUrl(url)).hostname.replace(/^www\./, ''); }
    catch { return ''; }
}

// ── Inicializar ───────────────────────────────────────────────
async function iniciarLinks() {
    try {
        const snap = await PROJ_COL().orderBy('ordem').get();
        abasCarregadas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => !a.deletado);
        renderizarAbas();
        if (abasCarregadas.length > 0) selecionarAba(abasCarregadas[0].id);
        else document.getElementById('mainContent').innerHTML = `
            <div class="empty-links">
                <i class="fas fa-folder-open"></i>
                <p>Nenhuma aba ainda. Clique em <strong>"Nova Aba"</strong> para começar.</p>
            </div>`;
    } catch (e) {
        console.error('Erro ao carregar abas:', e);
        document.getElementById('mainContent').innerHTML = `<div class="empty-links"><p style="color:var(--error)">Erro ao carregar: ${escapeHTML(e.message)}</p></div>`;
    }
}

// ── Navegação por abas ────────────────────────────────────────
function renderizarAbas() {
    const nav = document.getElementById('tabsNav');
    nav.innerHTML = '<div class="nav-section-label">Abas</div>';
    abasCarregadas.forEach((aba, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'tab-wrapper';

        const btn = document.createElement('button');
        btn.className = 'tab-btn' + (aba.id === abaAtiva ? ' active' : '');
        btn.dataset.abaId = aba.id;
        btn.innerHTML = `<div class="nav-icon"><i class="${escapeHTML(aba.icon || 'fas fa-folder')}"></i></div><span>${escapeHTML(aba.title)}</span>`;
        btn.addEventListener('click', () => selecionarAba(aba.id));

        const adm = document.createElement('div');
        adm.className = 'tab-adm-btns';
        const total = abasCarregadas.length;
        let btns = '';
        if (window._can.reordenarAbas) {
            btns += `<button class="tab-adm-icon" onclick="moverAba('${aba.id}','up')" title="Subir" ${idx === 0 ? 'disabled style="opacity:.3"' : ''}><i class="fas fa-arrow-up"></i></button>`
                  + `<button class="tab-adm-icon" onclick="moverAba('${aba.id}','down')" title="Descer" ${idx === total - 1 ? 'disabled style="opacity:.3"' : ''}><i class="fas fa-arrow-down"></i></button>`;
        }
        if (window._can.editar) {
            btns += `<button class="tab-adm-icon" onclick="editarAba('${aba.id}')" title="Editar"><i class="fas fa-pen"></i></button>`;
        }
        if (window._can.moverLixeira) {
            btns += `<button class="tab-adm-icon tab-adm-del" onclick="deletarAba('${aba.id}','${escaparAttr(aba.title)}')" title="Mover aba para lixeira"><i class="fas fa-trash"></i></button>`;
        }
        adm.innerHTML = btns;

        wrapper.appendChild(btn);
        wrapper.appendChild(adm);
        nav.appendChild(wrapper);
    });
}

async function selecionarAba(id) {
    abaAtiva = id;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.abaId === id));

    const mainEl = document.getElementById('mainContent');
    mainEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:40vh;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin" style="font-size:20px"></i></div>';

    const aba = abasCarregadas.find(a => a.id === id);
    if (!aba) return;

    const header = `
        <div class="tutorial-header">
            <div class="tutorial-header-top">
                <div class="tut-icon"><i class="${escapeHTML(aba.icon || 'fas fa-folder')}"></i></div>
                <div class="tut-title-block">
                    <h2>${escapeHTML(aba.title)}</h2>
                    <p>${escapeHTML(aba.subtitle || '')}</p>
                </div>
            </div>
            <div class="tutorial-header-actions">
                ${window._can.adicionar ? `<button class="tut-action-btn" onclick="abrirModalNovoLink('${id}')"><i class="fas fa-plus"></i> Adicionar Link</button>` : ''}
            </div>
        </div>`;

    let links = [];
    try {
        const snap = await LINKS_COL(id).orderBy('ordem').get();
        links = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => !l.deletado);
    } catch (e) {
        mainEl.innerHTML = `${header}<div class="empty-links"><p style="color:var(--error)">Erro ao carregar links: ${escapeHTML(e.message)}</p></div>`;
        return;
    }

    _currentLinks = links;
    _searchTerm = '';

    if (!links.length) {
        mainEl.innerHTML = `${header}<div class="empty-links"><i class="fas fa-link"></i><p>Nenhum link nesta aba ainda.<br>Clique em <strong>"Adicionar Link"</strong>.</p></div>`;
        return;
    }

    const searchBar = `
        <div class="links-search">
            <i class="fas fa-search"></i>
            <input type="text" id="linksSearchInput" placeholder="Pesquisar por título, descrição ou link..."
                   oninput="filtrarLinks('${id}', this.value)" autocomplete="off">
            <button class="links-search-clear" onclick="limparBuscaLinks('${id}')" title="Limpar"><i class="fas fa-times"></i></button>
        </div>`;

    mainEl.innerHTML = `${header}${searchBar}<div class="links-grid" id="linksGrid"></div>`;
    renderizarGridLinks(id);
}

// Renderiza (ou re-renderiza filtrando) o grid de links da aba ativa
function renderizarGridLinks(abaId) {
    const grid = document.getElementById('linksGrid');
    if (!grid) return;

    const termo = _searchTerm.trim().toLowerCase();
    // Filtro por título, descrição e conteúdo do link (URL)
    const visiveis = !termo ? _currentLinks : _currentLinks.filter(l =>
        (l.titulo    || '').toLowerCase().includes(termo) ||
        (l.descricao || '').toLowerCase().includes(termo) ||
        (l.url       || '').toLowerCase().includes(termo)
    );

    if (!visiveis.length) {
        grid.style.display = 'block';
        grid.innerHTML = `<div class="empty-links"><i class="fas fa-magnifying-glass"></i><p>Nenhum link encontrado para <strong>"${escapeHTML(_searchTerm.trim())}"</strong>.</p></div>`;
        return;
    }
    grid.style.display = '';

    grid.innerHTML = visiveis.map(l => {
        const href  = normalizarUrl(l.url);
        const host  = hostDaUrl(l.url);
        // Posição no array completo (para reordenar corretamente mesmo filtrando)
        const pos   = _currentLinks.findIndex(x => x.id === l.id);
        const first = pos === 0, last = pos === _currentLinks.length - 1;

        const favicon = host
            ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64" alt="" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-link\\'></i>'">`
            : `<i class="fas fa-link"></i>`;

        const overlay = `
            <div class="link-adm-overlay">
                ${window._can.reordenarItens ? `
                <button class="link-adm-btn" onclick="moverLink('${abaId}','${l.id}','up')"   title="Subir"  ${first ? 'disabled style="opacity:.3;cursor:default"' : ''}><i class="fas fa-arrow-up"></i></button>
                <button class="link-adm-btn" onclick="moverLink('${abaId}','${l.id}','down')" title="Descer" ${last ? 'disabled style="opacity:.3;cursor:default"' : ''}><i class="fas fa-arrow-down"></i></button>` : ''}
                ${window._can.editar ? `<button class="link-adm-btn" onclick="editarLink('${abaId}','${l.id}')" title="Editar"><i class="fas fa-pen"></i></button>` : ''}
                ${window._can.moverLixeira ? `<button class="link-adm-btn link-adm-del" onclick="deletarLink('${abaId}','${l.id}','${escaparAttr(l.titulo || 'Link')}')" title="Mover para lixeira"><i class="fas fa-trash"></i></button>` : ''}
            </div>`;

        return `
        <div class="link-card">
            ${overlay}
            <div class="link-card-head">
                <div class="link-favicon">${favicon}</div>
                <div class="link-title-wrap">
                    <div class="link-title">${escapeHTML(l.titulo || 'Sem título')}</div>
                    <div class="link-url"><i class="fas fa-globe" style="font-size:10px"></i> ${escapeHTML(host || l.url || '')}</div>
                </div>
            </div>
            ${l.descricao ? `<div class="link-desc">${escapeHTML(l.descricao)}</div>` : ''}
            ${href ? `<a class="link-open" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square"></i> Abrir link</a>` : ''}
            ${l.criadoPor ? `<div class="link-autor">adicionado por ${escapeHTML(l.criadoPor)}</div>` : ''}
        </div>`;
    }).join('');
}

function filtrarLinks(abaId, valor) {
    _searchTerm = valor || '';
    renderizarGridLinks(abaId);
}

function limparBuscaLinks(abaId) {
    _searchTerm = '';
    const input = document.getElementById('linksSearchInput');
    if (input) { input.value = ''; input.focus(); }
    renderizarGridLinks(abaId);
}

// ============================================================
//  ABAS — criar / editar / mover / deletar
// ============================================================
let _editAbaId = null;

function abrirModalNovaAba() {
    _editAbaId = null;
    document.getElementById('modalAbaTitle').innerHTML = '<i class="fas fa-plus"></i> Nova Aba';
    document.getElementById('abaTitulo').value = '';
    document.getElementById('abaSubtitulo').value = '';
    document.getElementById('abaIcone').value = 'fas fa-folder';
    document.getElementById('modalAba').classList.add('aberto');
}

function editarAba(id) {
    const aba = abasCarregadas.find(a => a.id === id);
    if (!aba) return;
    _editAbaId = id;
    document.getElementById('modalAbaTitle').innerHTML = '<i class="fas fa-pen"></i> Editar Aba';
    document.getElementById('abaTitulo').value = aba.title || '';
    document.getElementById('abaSubtitulo').value = aba.subtitle || '';
    document.getElementById('abaIcone').value = aba.icon || 'fas fa-folder';
    document.getElementById('modalAba').classList.add('aberto');
}

function fecharModalAba() {
    document.getElementById('modalAba').classList.remove('aberto');
    _editAbaId = null;
}

async function salvarAba() {
    const title    = document.getElementById('abaTitulo').value.trim();
    const subtitle = document.getElementById('abaSubtitulo').value.trim();
    const icon     = document.getElementById('abaIcone').value.trim() || 'fas fa-folder';
    if (!title) { alert('Digite um título.'); return; }

    try {
        if (_editAbaId) {
            const upd = { title, subtitle, icon };
            await PROJ_COL().doc(_editAbaId).update(upd);
            const aba = abasCarregadas.find(a => a.id === _editAbaId);
            if (aba) Object.assign(aba, upd);
            const abaId = _editAbaId;
            fecharModalAba();
            renderizarAbas();
            if (abaAtiva === abaId) selecionarAba(abaId);
            return;
        }

        const maxOrdem = abasCarregadas.reduce((m, a) => Math.max(m, a.ordem || 0), 0);
        const dados = {
            title, subtitle, icon, ordem: maxOrdem + 1,
            criadoPor: window._userEmail || '',
            criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        };
        const ref = await PROJ_COL().add(dados);
        abasCarregadas.push({ id: ref.id, title, subtitle, icon, ordem: maxOrdem + 1 });
        fecharModalAba();
        renderizarAbas();
        selecionarAba(ref.id);
    } catch (e) {
        mostrarNotificacao('Erro ao salvar aba: ' + e.message);
        console.error('salvarAba', e);
    }
}

async function moverAba(id, dir) {
    const idx     = abasCarregadas.findIndex(a => a.id === id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= abasCarregadas.length) return;

    const a = abasCarregadas[idx];
    const b = abasCarregadas[swapIdx];
    try {
        const batch = db.batch();
        batch.update(PROJ_COL().doc(a.id), { ordem: b.ordem });
        batch.update(PROJ_COL().doc(b.id), { ordem: a.ordem });
        await batch.commit();

        [a.ordem, b.ordem] = [b.ordem, a.ordem];
        abasCarregadas[idx]     = b;
        abasCarregadas[swapIdx] = a;
        renderizarAbas();
    } catch (e) {
        mostrarNotificacao('Erro ao reordenar: ' + e.message);
    }
}

async function deletarAba(id, title) {
    if (!confirm(`Mover a aba "${title}" (e todos os seus links) para a lixeira?`)) return;
    try {
        const aba = abasCarregadas.find(a => a.id === id);
        // lixeira PRIMEIRO — se falhar, aba não some
        await LIXEIRA_REF().add({
            tipo: 'aba', abaId: id, nome: title, categoria: 'Aba',
            abaSnapshot: { icon: aba?.icon || '', subtitle: aba?.subtitle || '' },
            deletadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            deletadoPor: window._userEmail || ''
        });
        await PROJ_COL().doc(id).update({
            deletado: true,
            deletadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            deletadoPor: window._userEmail || ''
        });
        abasCarregadas = abasCarregadas.filter(a => a.id !== id);
        renderizarAbas();
        if (abaAtiva === id) {
            if (abasCarregadas.length > 0) selecionarAba(abasCarregadas[0].id);
            else iniciarLinks();
        }
    } catch (e) {
        mostrarNotificacao('Erro ao mover para lixeira: ' + e.message);
        console.error('deletarAba', e);
    }
}

// ============================================================
//  LINKS — criar / editar / mover / deletar
// ============================================================
let _editLinkAbaId = null, _editLinkId = null;

function abrirModalNovoLink(abaId) {
    _editLinkAbaId = abaId;
    _editLinkId = null;
    document.getElementById('modalLinkTitle').innerHTML = '<i class="fas fa-link"></i> Novo Link';
    document.getElementById('linkTitulo').value = '';
    document.getElementById('linkUrl').value = '';
    document.getElementById('linkDescricao').value = '';
    document.getElementById('modalLink').classList.add('aberto');
}

async function editarLink(abaId, linkId) {
    try {
        const snap = await LINKS_COL(abaId).doc(linkId).get();
        if (!snap.exists) return;
        const l = snap.data();
        _editLinkAbaId = abaId;
        _editLinkId = linkId;
        document.getElementById('modalLinkTitle').innerHTML = '<i class="fas fa-pen"></i> Editar Link';
        document.getElementById('linkTitulo').value = l.titulo || '';
        document.getElementById('linkUrl').value = l.url || '';
        document.getElementById('linkDescricao').value = l.descricao || '';
        document.getElementById('modalLink').classList.add('aberto');
    } catch (e) {
        mostrarNotificacao('Erro ao abrir link: ' + e.message);
    }
}

function fecharModalLink() {
    document.getElementById('modalLink').classList.remove('aberto');
    _editLinkAbaId = _editLinkId = null;
}

async function salvarLink() {
    const titulo    = document.getElementById('linkTitulo').value.trim();
    const url       = document.getElementById('linkUrl').value.trim();
    const descricao = document.getElementById('linkDescricao').value.trim();
    if (!titulo) { alert('Digite um título.'); return; }
    if (!url)    { alert('Digite a URL.'); return; }

    const abaId = _editLinkAbaId;
    try {
        if (_editLinkId) {
            await LINKS_COL(abaId).doc(_editLinkId).update({ titulo, url, descricao });
        } else {
            const exist = await LINKS_COL(abaId).get();
            const maxOrdem = exist.docs.reduce((m, d) => Math.max(m, d.data().ordem || 0), 0);
            await LINKS_COL(abaId).add({
                titulo, url, descricao, ordem: maxOrdem + 1,
                criadoPor: window._userEmail || '',
                criadoEm: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        fecharModalLink();
        selecionarAba(abaId);
    } catch (e) {
        mostrarNotificacao('Erro ao salvar link: ' + e.message);
        console.error('salvarLink', e);
    }
}

async function moverLink(abaId, linkId, dir) {
    const idx     = _currentLinks.findIndex(l => l.id === linkId);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= _currentLinks.length) return;

    const a = _currentLinks[idx];
    const b = _currentLinks[swapIdx];
    try {
        const batch = db.batch();
        batch.update(LINKS_COL(abaId).doc(a.id), { ordem: b.ordem });
        batch.update(LINKS_COL(abaId).doc(b.id), { ordem: a.ordem });
        await batch.commit();

        [a.ordem, b.ordem] = [b.ordem, a.ordem];
        _currentLinks.sort((x, y) => (x.ordem || 0) - (y.ordem || 0));
        selecionarAba(abaId);
    } catch (e) {
        mostrarNotificacao('Erro ao reordenar: ' + e.message);
    }
}

async function deletarLink(abaId, linkId, nome) {
    if (!confirm(`Mover o link "${nome}" para a lixeira?`)) return;
    try {
        await LIXEIRA_REF().add({
            tipo: 'link', abaId, linkId, nome, categoria: 'Link',
            deletadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            deletadoPor: window._userEmail || ''
        });
        await LINKS_COL(abaId).doc(linkId).update({
            deletado: true,
            deletadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            deletadoPor: window._userEmail || ''
        });
        selecionarAba(abaId);
    } catch (e) {
        mostrarNotificacao('Erro ao mover para lixeira: ' + e.message);
        console.error('deletarLink', e);
    }
}

// ============================================================
//  LIXEIRA
// ============================================================
let _lixeiraItems = [];

async function abrirLixeiraLinks() {
    document.getElementById('modalLixeira').classList.add('aberto');
    await carregarLixeira();
}

function fecharLixeiraLinks() {
    document.getElementById('modalLixeira').classList.remove('aberto');
}

async function carregarLixeira() {
    try {
        const snap = await LIXEIRA_REF().orderBy('deletadoEm', 'desc').get();
        _lixeiraItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderizarLixeira();
    } catch (e) {
        document.getElementById('lixeiraContent').innerHTML = `<p style="color:var(--error);text-align:center;padding:2rem">Erro: ${escapeHTML(e.message)}</p>`;
    }
}

function renderizarLixeira() {
    const container = document.getElementById('lixeiraContent');
    const visiveis = _lixeiraItems.filter(i => !i.restaurado || window._can.apagarPermanente);
    if (!visiveis.length) {
        container.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:2rem;font-style:italic">Lixeira vazia</p>';
        return;
    }
    container.innerHTML = visiveis.map(item => {
        const data = item.deletadoEm ? item.deletadoEm.toDate().toLocaleDateString('pt-BR') : '';
        const restaurado = item.restaurado;
        return `<div class="lixeira-item${restaurado ? ' lixeira-item--restaurado' : ''}">
            <div class="lixeira-info">
                <div class="lixeira-nome">${escapeHTML(item.nome)}${restaurado ? ' <span class="lixeira-tag-restaurado">restaurado</span>' : ''}</div>
                <div class="lixeira-meta">${escapeHTML(item.categoria)} · ${data}${item.deletadoPor ? ' · ' + escapeHTML(item.deletadoPor) : ''}</div>
            </div>
            <div class="lixeira-actions">
                ${!restaurado && window._can.restaurar ? `<button class="lixeira-btn-action" onclick="restaurarItem('${item.id}')"><i class="fas fa-undo"></i> Restaurar</button>` : ''}
                ${window._can.apagarPermanente ? `<button class="lixeira-btn-action lixeira-btn-del" onclick="deletarDefinitivo('${item.id}','${escaparAttr(item.nome)}')" title="Apagar permanentemente"><i class="fas fa-skull"></i></button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function restaurarItem(id) {
    const item = _lixeiraItems.find(i => i.id === id);
    if (!item) return;
    try {
        if (item.tipo === 'aba') {
            await PROJ_COL().doc(item.abaId).update({ deletado: firebase.firestore.FieldValue.delete() });
            const snap = await PROJ_COL().doc(item.abaId).get();
            if (snap.exists) {
                const abaData = { id: snap.id, ...snap.data() };
                if (!abasCarregadas.find(a => a.id === snap.id)) abasCarregadas.push(abaData);
                abasCarregadas.sort((x, y) => (x.ordem || 0) - (y.ordem || 0));
                renderizarAbas();
            }
        } else if (item.tipo === 'link') {
            await LINKS_COL(item.abaId).doc(item.linkId).update({ deletado: firebase.firestore.FieldValue.delete() });
            if (abaAtiva === item.abaId) selecionarAba(item.abaId);
        }
        await LIXEIRA_REF().doc(id).update({ restaurado: true, restauradoEm: firebase.firestore.FieldValue.serverTimestamp() });
        mostrarNotificacao('Restaurado ✓');
        await carregarLixeira();
    } catch (e) {
        mostrarNotificacao('Erro ao restaurar: ' + e.message);
    }
}

async function deletarDefinitivo(id, nome) {
    if (!confirm(`Apagar "${nome}" PERMANENTEMENTE? Não pode ser desfeito.`)) return;
    const item = _lixeiraItems.find(i => i.id === id);
    try {
        if (item?.tipo === 'aba') {
            const linksSnap = await LINKS_COL(item.abaId).get();
            const batch = db.batch();
            linksSnap.docs.forEach(d => batch.delete(d.ref));
            batch.delete(PROJ_COL().doc(item.abaId));
            await batch.commit();
        } else if (item?.tipo === 'link') {
            await LINKS_COL(item.abaId).doc(item.linkId).delete();
        }
        await LIXEIRA_REF().doc(id).delete();
        mostrarNotificacao('Apagado permanentemente');
        await carregarLixeira();
    } catch (e) {
        mostrarNotificacao('Erro ao apagar: ' + e.message);
    }
}

// ── Notificação ───────────────────────────────────────────────
function mostrarNotificacao(msg) {
    let n = document.getElementById('notifLinks');
    if (!n) {
        n = document.createElement('div');
        n.id = 'notifLinks';
        n.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#161b27;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:12px 20px;color:#e8eaf0;font-size:14px;z-index:99999;transition:.3s;opacity:0;box-shadow:0 10px 30px rgba(0,0,0,.4)';
        document.body.appendChild(n);
    }
    n.textContent = msg;
    n.style.opacity = '1';
    clearTimeout(n._t);
    n._t = setTimeout(() => n.style.opacity = '0', 3000);
}

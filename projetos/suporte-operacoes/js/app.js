// Suporte de Operações - AUDICOM

const PROJ_COL    = () => db.collection('projetos').doc('suporte-operacoes').collection('abas');
const LIXEIRA_REF = () => db.collection('lixeira-operacoes');

let abasCarregadas = [];
let abaAtiva = null;
let pendingImgs = [];
let _currentSteps = []; // steps da aba ativa em memória (para reordenar)

// ── Inicializar ───────────────────────────────────────────────
async function iniciarOperacoes() {
    try {
        const snap = await PROJ_COL().orderBy('ordem').get();
        abasCarregadas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => !a.deletado);
        renderizarAbas();
        if (abasCarregadas.length > 0) selecionarAba(abasCarregadas[0].id);
    } catch (e) {
        console.error('Erro ao carregar abas:', e);
    }
}

// ── Navegação por abas ────────────────────────────────────────
function _escaparAttrOps(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}
function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderizarAbas() {
    const nav = document.getElementById('tabsNav');
    // mantém o label "Tutoriais" que já está no HTML, recria só os items
    nav.innerHTML = '<div class="nav-section-label">Tutoriais</div>';
    abasCarregadas.forEach(aba => {
        const wrapper = document.createElement('div');
        wrapper.className = 'tab-wrapper';

        const btn = document.createElement('button');
        btn.className = 'tab-btn' + (aba.id === abaAtiva ? ' active' : '');
        btn.dataset.abaId = aba.id;
        btn.innerHTML = `<div class="nav-icon"><i class="${escapeHTML(aba.icon || 'fas fa-cog')}"></i></div><span>${escapeHTML(aba.title)}</span>`;
        btn.addEventListener('click', () => selecionarAba(aba.id));

        const adm = document.createElement('div');
        adm.className = 'tab-adm-btns';
        const idx = abasCarregadas.indexOf(aba);
        const total = abasCarregadas.length;
        let btns = '';
        if (window._isAdmin) {
            btns += `<button class="tab-adm-icon" onclick="moverAba('${aba.id}','up')" title="Subir" ${idx===0?'disabled style="opacity:.3"':''}><i class="fas fa-arrow-up"></i></button>`
                  + `<button class="tab-adm-icon" onclick="moverAba('${aba.id}','down')" title="Descer" ${idx===total-1?'disabled style="opacity:.3"':''}><i class="fas fa-arrow-down"></i></button>`
                  + `<button class="tab-adm-icon" onclick="editarAba('${aba.id}')" title="Editar"><i class="fas fa-pen"></i></button>`;
        }
        btns += `<button class="tab-adm-icon tab-adm-del" onclick="deletarAba('${aba.id}','${_escaparAttrOps(aba.title)}')" title="Lixeira"><i class="fas fa-trash"></i></button>`;
        adm.innerHTML = btns;

        wrapper.appendChild(btn);
        wrapper.appendChild(adm);
        nav.appendChild(wrapper);
    });

    // botão migrar: detecta steps sem isBase64 via flag na aba
    if (window._isAdmin) {
        const locais = abasCarregadas.filter(a => a.folder);
        const btn = document.getElementById('btnMigrar');
        if (btn) btn.style.display = locais.length ? 'flex' : 'none';
    }
}

const _badgeIcon = t => ({ info:'info-circle', warning:'exclamation-triangle', error:'times-circle', success:'check-circle' }[t] || '');

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
                <div class="tut-icon"><i class="${escapeHTML(aba.icon || 'fas fa-cog')}"></i></div>
                <div class="tut-title-block">
                    <h2>${escapeHTML(aba.title)}</h2>
                    <p>${escapeHTML(aba.subtitle || '')}</p>
                </div>
            </div>
            <div class="tutorial-header-actions">
                <button class="tut-action-btn" onclick="abrirModalAddImg('${id}')"><i class="fas fa-plus"></i> Adicionar Imagens</button>
            </div>
        </div>`;

    if (aba.tipo === 'text') {
        const editBtn = `<div class="tutorial-header-actions">
                <button class="tut-action-btn" onclick="editarConteudoTexto('${id}')"><i class="fas fa-plus"></i> Adicionar Conteúdo</button>
               </div>`;
        const headerTexto = `
            <div class="tutorial-header">
                <div class="tutorial-header-top">
                    <div class="tut-icon"><i class="${escapeHTML(aba.icon || 'fas fa-book')}"></i></div>
                    <div class="tut-title-block">
                        <h2>${escapeHTML(aba.title)}</h2>
                        <p>${escapeHTML(aba.subtitle || '')}</p>
                    </div>
                </div>
                ${editBtn}
            </div>`;
        mainEl.innerHTML = `<section class="tab-content active">${headerTexto}<div class="manual-content">${aba.textContent || '<p style="color:var(--text-3)">Sem conteúdo ainda. Clique em "Editar Conteúdo" para adicionar.</p>'}</div></section>`;
        return;
    }

    const stepsSnap = await PROJ_COL().doc(id).collection('steps').orderBy('ordem').get();
    const steps = stepsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => !s.deletado);

    _currentSteps = steps;

    const _overlayAdm = (stepId, stepTitle, idx) => {
        const isFirst = idx === 0;
        const isLast  = idx === steps.length - 1;
        return `<div class="step-adm-overlay">
                <button class="step-adm-btn" onclick="moverStep('${id}','${stepId}','up')"   title="Subir"   ${isFirst?'disabled style="opacity:.3;cursor:default"':''}><i class="fas fa-arrow-up"></i></button>
                <button class="step-adm-btn" onclick="moverStep('${id}','${stepId}','down')" title="Descer"  ${isLast ?'disabled style="opacity:.3;cursor:default"':''}><i class="fas fa-arrow-down"></i></button>
            ${window._isAdmin ? `
                <button class="step-adm-btn" onclick="editarStep('${id}','${stepId}')"       title="Editar"><i class="fas fa-pen"></i></button>
            ` : ''}
            <button class="step-adm-btn step-adm-del" onclick="deletarStep('${id}','${stepId}','${_escaparAttrOps(stepTitle||'Passo '+(idx+1))}')" title="Lixeira"><i class="fas fa-trash"></i></button>
        </div>`;
    };

    const stepsHTML = `<div class="tutorial-steps">${steps.map((s, i) => {
        const tipo  = s.balloonType && s.balloonType !== 'default' ? s.balloonType : '';
        const badge = tipo ? `<div class="balloon-type-badge"><i class="fas fa-${_badgeIcon(tipo)}"></i> ${escapeHTML(tipo)}</div>` : '';
        return `
        <div class="step-item">
            <div class="step-left"><div class="step-num">${i + 1}</div></div>
            <div class="step-body">
                <div class="step-media">
                    <img src="${escapeHTML(s.image || '')}"
                         alt="${escapeHTML(s.title || `Passo ${i+1}`)}" loading="lazy"
                         onclick="abrirImagem(this)" title="Clique para ampliar">
                </div>
                <div class="step-balloon ${escapeHTML(s.balloonType || 'default')}">
                    <div class="balloon-content">
                        ${badge}
                        <h3>${escapeHTML(s.title || '')}</h3>
                        <p>${escapeHTML(s.description || '')}</p>
                        ${s.criadoPor ? `<div class="item-autor">por ${escapeHTML(s.criadoPor)}</div>` : ''}
                    </div>
                </div>
                ${_overlayAdm(s.id, s.title, i)}
            </div>
        </div>`;
    }).join('')}</div>`;

    mainEl.innerHTML = `<section class="tab-content active">${header}${stepsHTML}</section>`;
}

// ── Lightbox ──────────────────────────────────────────────────
function abrirImagem(imgElement) {
    const tab = imgElement.closest('.tab-content');
    const images = tab ? Array.from(tab.querySelectorAll('img[onclick="abrirImagem(this)"]')) : [imgElement];
    let idx = images.indexOf(imgElement);
    if (idx === -1) { idx = 0; }
    const total = images.length;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10000;display:flex;align-items:center;justify-content:center;user-select:none';

    const container = document.createElement('div');
    container.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%';

    const imgEl = document.createElement('img');
    imgEl.style.cssText = 'max-width:90%;max-height:90%;object-fit:contain;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.5)';

    const btnX = document.createElement('button');
    btnX.innerHTML = '×';
    btnX.style.cssText = 'position:absolute;top:20px;right:30px;background:rgba(255,255,255,.2);border:none;color:#fff;font-size:40px;width:50px;height:50px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10002';

    function render() { imgEl.src = images[idx].src; }
    render();

    container.appendChild(imgEl);

    if (total > 1) {
        const counter = document.createElement('div');
        counter.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.5);padding:5px 15px;border-radius:15px;font-size:14px';
        function renderC() { imgEl.src = images[idx].src; counter.textContent = `${idx+1} / ${total}`; }
        render = renderC; renderC();
        container.appendChild(counter);

        const mkBtn = (html, css, fn) => {
            const b = document.createElement('button');
            b.innerHTML = html;
            b.style.cssText = `position:absolute;${css}background:rgba(255,255,255,.2);color:#fff;border:none;font-size:30px;width:60px;height:60px;border-radius:50%;cursor:pointer;z-index:10001;display:flex;align-items:center;justify-content:center;transition:.2s`;
            b.onmouseover = () => b.style.background = 'rgba(255,255,255,.4)';
            b.onmouseout  = () => b.style.background = 'rgba(255,255,255,.2)';
            b.onclick = e => { e.stopPropagation(); fn(); render(); };
            return b;
        };
        container.appendChild(mkBtn('&#10094;', 'left:20px;', () => idx = (idx - 1 + total) % total));
        container.appendChild(mkBtn('&#10095;', 'right:20px;', () => idx = (idx + 1) % total));
    }

    overlay.appendChild(container);
    overlay.appendChild(btnX);
    document.body.appendChild(overlay);

    function close() {
        document.removeEventListener('keydown', kh);
        if (document.body.contains(overlay)) overlay.remove();
    }
    const kh = e => {
        if (e.key === 'Escape') close();
        else if (total > 1) {
            if (e.key === 'ArrowLeft')  { idx = (idx - 1 + total) % total; render(); }
            if (e.key === 'ArrowRight') { idx = (idx + 1) % total; render(); }
        }
    };
    document.addEventListener('keydown', kh);
    btnX.onclick = close;
    overlay.onclick = e => { if (e.target === overlay || e.target === container) close(); };
}

// ── Admin: nova/editar aba ─────────────────────────────────────
let _editAbaId = null;

function toggleNovaAbaTexto() {
    const tipo = document.getElementById('novaAbaTipo').value;
    document.getElementById('novaAbaTextoWrap').style.display = tipo === 'text' ? 'block' : 'none';
}

function abrirModalNovaAba() {
    _editAbaId = null;
    document.getElementById('modalNovaAbaH3').textContent = 'Nova Aba de Tutorial';
    document.getElementById('novaAbaTitle').value = '';
    document.getElementById('novaAbaSubtitle').value = '';
    document.getElementById('novaAbaIcon').value = 'fas fa-cog';
    document.getElementById('novaAbaTipo').value = 'gallery';
    document.getElementById('novaAbaTexto').value = '';
    document.getElementById('novaAbaTextoWrap').style.display = 'none';
    document.getElementById('modalNovaAba').style.display = 'flex';
}

function editarAba(id) {
    const aba = abasCarregadas.find(a => a.id === id);
    if (!aba) return;
    _editAbaId = id;
    document.getElementById('modalNovaAbaH3').textContent = 'Editar Aba';
    document.getElementById('novaAbaTitle').value = aba.title || '';
    document.getElementById('novaAbaSubtitle').value = aba.subtitle || '';
    document.getElementById('novaAbaIcon').value = aba.icon || 'fas fa-cog';
    document.getElementById('novaAbaTipo').value = aba.tipo || 'gallery';
    document.getElementById('novaAbaTexto').value = aba.textContent || '';
    document.getElementById('novaAbaTextoWrap').style.display = aba.tipo === 'text' ? 'block' : 'none';
    document.getElementById('modalNovaAba').style.display = 'flex';
}

function fecharModalNovaAba() {
    document.getElementById('modalNovaAba').style.display = 'none';
    _editAbaId = null;
}

async function salvarNovaAba() {
    const title       = document.getElementById('novaAbaTitle').value.trim();
    const subtitle    = document.getElementById('novaAbaSubtitle').value.trim();
    const icon        = document.getElementById('novaAbaIcon').value.trim() || 'fas fa-cog';
    const tipo        = document.getElementById('novaAbaTipo').value;
    const textContent = tipo === 'text' ? document.getElementById('novaAbaTexto').value : '';

    if (!title) { alert('Digite um título.'); return; }

    if (_editAbaId) {
        const upd = { title, subtitle, icon, tipo };
        if (tipo === 'text') upd.textContent = textContent;
        await PROJ_COL().doc(_editAbaId).update(upd);
        const aba = abasCarregadas.find(a => a.id === _editAbaId);
        if (aba) Object.assign(aba, upd);
        fecharModalNovaAba();
        renderizarAbas();
        selecionarAba(abaAtiva);
        return;
    }

    const maxOrdem = abasCarregadas.reduce((m, a) => Math.max(m, a.ordem || 0), 0);
    const dados = { title, subtitle, icon, tipo, ordem: maxOrdem + 1,
        criadoPor: window._userEmail || '',
        criadoEm: firebase.firestore.FieldValue.serverTimestamp() };
    if (tipo === 'text') dados.textContent = textContent;

    const ref = await PROJ_COL().add(dados);
    const novaAba = { id: ref.id, title, subtitle, icon, tipo, ordem: maxOrdem + 1, textContent };
    abasCarregadas.push(novaAba);

    fecharModalNovaAba();
    renderizarAbas();
    selecionarAba(ref.id);
}

// ── Editor de Blocos ──────────────────────────────────────────
let _editTextAbaId = null;
let _editorBlocks  = [];

const _ALERT_ICONS = { warning:'exclamation-triangle', info:'info-circle', success:'check-circle', error:'times-circle' };

function _newBlock(type) {
    switch (type) {
        case 'intro':   return { type, text: '' };
        case 'alert':   return { type, kind: 'warning', text: '' };
        case 'section': return { type, icon: 'fas fa-circle', title: '', steps: [''], model: '' };
        case 'code':    return { type, label: '📝 Modelo', text: '' };
        case 'kits':    return { type, sectionTitle: '', kits: [{ title: '', items: [''] }] };
        case 'html':    return { type, content: '' };
    }
}

function _blocksToHTML(blocks) {
    return blocks.map(b => {
        if (b.type === 'intro')
            return `<div class="manual-intro"><p><strong>${b.text}</strong></p></div>`;
        if (b.type === 'alert')
            return `<div class="alert-box ${b.kind}"><i class="fas fa-${_ALERT_ICONS[b.kind]}"></i><div>${b.text}</div></div>`;
        if (b.type === 'section') {
            const steps = (b.steps || []).filter(s => s.trim());
            const stepsHtml = steps.length ? `<div class="procedure-steps"><ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol></div>` : '';
            const modelHtml = b.model ? `<div class="model-example"><h5>📝 Modelo:</h5><div class="code-box">${b.model}</div></div>` : '';
            return `<div class="manual-section"><h3><i class="${b.icon || 'fas fa-circle'}"></i> ${b.title}</h3>${stepsHtml}${modelHtml}</div>`;
        }
        if (b.type === 'code')
            return `<div class="model-example">${b.label ? `<h5>${b.label}</h5>` : ''}<div class="code-box">${b.text}</div></div>`;
        if (b.type === 'kits') {
            const kitsHtml = (b.kits || []).map(k => {
                const items = (k.items || []).filter(i => i.trim());
                return `<div class="kit-box"><h4>${k.title}</h4><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
            }).join('');
            return `<div class="manual-section"><h3><i class="fas fa-clipboard-check"></i> ${b.sectionTitle || 'Kits'}</h3><div class="kit-lists">${kitsHtml}</div></div>`;
        }
        if (b.type === 'html') return b.content || '';
        return '';
    }).join('\n');
}

function _renderBlockEditor() {
    const c = document.getElementById('blockEditorContent');
    if (!c) return;
    if (_editorBlocks.length === 0) {
        c.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:32px 0">Nenhum bloco ainda.<br>Use os botões acima para adicionar.</p>';
        return;
    }
    const S = 'width:100%;padding:8px 12px;background:#0d1117;border:1px solid rgba(255,255,255,.08);border-radius:7px;color:#e8eaf0;font-family:inherit;font-size:13px;box-sizing:border-box;outline:none;resize:vertical';
    const L = 'display:block;font-size:11px;color:#6b7280;margin-bottom:4px;margin-top:10px';
    const LABELS = { intro:'📝 Introdução', alert:'⚠️ Alerta', section:'📋 Seção + Passos', code:'🖥️ Modelo/Código', kits:'📦 Kits', html:'</> HTML Bruto' };

    c.innerHTML = _editorBlocks.map((b, i) => {
        const first = i === 0, last = i === _editorBlocks.length - 1;
        const hdr = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--primary-lt);background:rgba(99,102,241,.1);padding:3px 9px;border-radius:20px">${LABELS[b.type]||b.type}</span>
            <div style="display:flex;gap:4px;margin-left:auto">
                <button class="_blk-ctrl" onclick="_moveBlock(${i},'up')"   ${first?'disabled':''}><i class="fas fa-arrow-up"></i></button>
                <button class="_blk-ctrl" onclick="_moveBlock(${i},'down')" ${last?'disabled':''}><i class="fas fa-arrow-down"></i></button>
                <button class="_blk-ctrl _blk-del" onclick="_removeBlock(${i})"><i class="fas fa-trash"></i></button>
            </div></div>`;

        let fields = '';
        if (b.type === 'intro')
            fields = `<textarea style="${S}" rows="3" placeholder="Texto de introdução / resumo..." oninput="_editorBlocks[${i}].text=this.value">${b.text}</textarea>`;
        else if (b.type === 'alert')
            fields = `<label style="${L}">Tipo</label>
                <select style="${S}" onchange="_editorBlocks[${i}].kind=this.value">
                    ${['warning','info','success','error'].map(k=>`<option value="${k}"${b.kind===k?' selected':''}>${k}</option>`).join('')}
                </select>
                <label style="${L}">Texto</label>
                <textarea style="${S}" rows="2" placeholder="Texto do alerta..." oninput="_editorBlocks[${i}].text=this.value">${b.text}</textarea>`;
        else if (b.type === 'section')
            fields = `<div style="display:grid;grid-template-columns:160px 1fr;gap:10px">
                    <div><label style="${L}">Ícone FontAwesome</label>
                        <input style="${S}" placeholder="fas fa-sync-alt" value="${b.icon||''}" oninput="_editorBlocks[${i}].icon=this.value"></div>
                    <div><label style="${L}">Título da seção</label>
                        <input style="${S}" placeholder="1. MIGRAÇÃO DE TECNOLOGIA" value="${b.title||''}" oninput="_editorBlocks[${i}].title=this.value"></div>
                </div>
                <label style="${L}">Passos numerados (um por linha)</label>
                <textarea style="${S}" rows="5" placeholder="Atualizar o cadastro do cliente no Hubsoft&#10;Receber os equipamentos antigos&#10;Realizar testes..." oninput="_editorBlocks[${i}].steps=this.value.split('\\n')">${(b.steps||['']).join('\n')}</textarea>
                <label style="${L}">Texto de modelo / exemplo (opcional)</label>
                <textarea style="${S}" rows="2" placeholder="MIGRAÇÃO | Equipamentos devolvidos: 1 roteador XXXXX + fonte" oninput="_editorBlocks[${i}].model=this.value">${b.model||''}</textarea>`;
        else if (b.type === 'code')
            fields = `<label style="${L}">Rótulo</label>
                <input style="${S}" placeholder="📝 Modelo" value="${b.label||''}" oninput="_editorBlocks[${i}].label=this.value">
                <label style="${L}">Conteúdo</label>
                <textarea style="${S}" rows="3" placeholder="CANCELAMENTO | Equipamentos devolvidos: ..." oninput="_editorBlocks[${i}].text=this.value">${b.text||''}</textarea>`;
        else if (b.type === 'kits') {
            const kitsHtml = (b.kits||[]).map((k, ki) => `
                <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:10px;margin-bottom:8px">
                    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
                        <input style="${S}" placeholder="📦 KIT FIBRA ÓPTICA" value="${k.title||''}" oninput="_editorBlocks[${i}].kits[${ki}].title=this.value">
                        <button class="_blk-ctrl _blk-del" style="flex-shrink:0" onclick="_removeKit(${i},${ki})"><i class="fas fa-times"></i></button>
                    </div>
                    <textarea style="${S}" rows="3" placeholder="1 Roteador + fonte&#10;1 ONU Loco com tampa + fonte&#10;1 Roseta" oninput="_editorBlocks[${i}].kits[${ki}].items=this.value.split('\\n')">${(k.items||['']).join('\n')}</textarea>
                </div>`).join('');
            fields = `<label style="${L}">Título da seção</label>
                <input style="${S}" placeholder="Apoio para Conferência de Equipamentos" value="${b.sectionTitle||''}" oninput="_editorBlocks[${i}].sectionTitle=this.value">
                <label style="${L}">Kits</label>
                ${kitsHtml}
                <button onclick="_addKit(${i})" style="margin-top:6px;padding:7px;background:rgba(99,102,241,.08);border:1px dashed rgba(99,102,241,.3);border-radius:7px;color:var(--primary-lt);cursor:pointer;font-size:12px;font-family:inherit;width:100%"><i class="fas fa-plus"></i> Adicionar kit</button>`;
        }
        else if (b.type === 'html')
            fields = `<textarea style="${S};font-family:monospace;font-size:12px" rows="6" placeholder="<div class=&quot;manual-section&quot;>...</div>" oninput="_editorBlocks[${i}].content=this.value">${b.content||''}</textarea>`;

        return `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px">${hdr}${fields}</div>`;
    }).join('');
}

function _addBlock(type) {
    _editorBlocks.push(_newBlock(type));
    _renderBlockEditor();
    setTimeout(() => { const c = document.getElementById('blockEditorContent'); c && (c.scrollTop = c.scrollHeight); }, 50);
}

function _moveBlock(idx, dir) {
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= _editorBlocks.length) return;
    [_editorBlocks[idx], _editorBlocks[swap]] = [_editorBlocks[swap], _editorBlocks[idx]];
    _renderBlockEditor();
}

function _removeBlock(idx) { _editorBlocks.splice(idx, 1); _renderBlockEditor(); }
function _addKit(bi)        { _editorBlocks[bi].kits.push({ title:'', items:[''] }); _renderBlockEditor(); }
function _removeKit(bi, ki) { _editorBlocks[bi].kits.splice(ki, 1); _renderBlockEditor(); }

function editarConteudoTexto(id) {
    _editTextAbaId = id;
    const aba = abasCarregadas.find(a => a.id === id);
    _editorBlocks = aba?.textBlocks ? JSON.parse(JSON.stringify(aba.textBlocks)) : [];
    _renderBlockEditor();
    document.getElementById('modalEditarTexto').classList.add('aberto');
}

function fecharModalEditarTexto() {
    document.getElementById('modalEditarTexto').classList.remove('aberto');
    _editTextAbaId = null;
}

async function salvarConteudoTexto() {
    const textBlocks = JSON.parse(JSON.stringify(_editorBlocks));
    const textContent = _blocksToHTML(textBlocks);
    await PROJ_COL().doc(_editTextAbaId).update({ textContent, textBlocks });
    const aba = abasCarregadas.find(a => a.id === _editTextAbaId);
    if (aba) { aba.textContent = textContent; aba.textBlocks = textBlocks; }
    const abaId = _editTextAbaId;
    fecharModalEditarTexto();
    selecionarAba(abaId);
    mostrarNotifOps('Conteúdo salvo ✓');
}

// ── Admin: deletar aba ────────────────────────────────────────
async function deletarAba(id, title) {
    if (!confirm(`Mover aba "${title}" para a lixeira?`)) return;
    try {
        const aba = abasCarregadas.find(a => a.id === id);
        // lixeira primeiro — se falhar, aba não some
        await LIXEIRA_REF().add({
            tipo: 'aba', abaId: id, nome: title, categoria: 'Aba',
            abaSnapshot: { tipo: aba?.tipo || 'steps', icon: aba?.icon || '', subtitle: aba?.subtitle || '' },
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
        if (abaAtiva === id && abasCarregadas.length > 0) selecionarAba(abasCarregadas[0].id);
        else if (!abasCarregadas.length) document.getElementById('mainContent').innerHTML = '';
    } catch (e) {
        mostrarNotifOps('Erro ao deletar: ' + e.message);
        console.error('deletarAba', e);
    }
}

// ── Admin: adicionar imagens a uma aba ───────────────────────
let _addImgAbaId = null;

function abrirModalAddImg(abaId) {
    _addImgAbaId = abaId;
    pendingImgs = [];
    document.getElementById('previewAddImg').innerHTML = '';
    document.getElementById('inputAddImg').value = '';
    document.getElementById('modalAddImg').style.display = 'flex';
}
function fecharModalAddImg() {
    document.getElementById('modalAddImg').style.display = 'none';
    _addImgAbaId = null;
    pendingImgs = [];
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('inputAddImg').addEventListener('change', async e => {
        const files = Array.from(e.target.files);
        e.target.value = '';
        const preview = document.getElementById('previewAddImg');
        preview.innerHTML = '<p style="color:#64748b;font-size:13px">Comprimindo...</p>';
        pendingImgs = [];
        preview.innerHTML = '';
        for (const file of files) {
            try {
                const base64 = await comprimirImagem(file);
                const idx = pendingImgs.length;
                pendingImgs.push({ base64, descricao: '' });
                const div = document.createElement('div');
                div.style.cssText = 'display:flex;gap:12px;align-items:flex-start;padding:10px;background:rgba(255,255,255,.04);border:1px solid #1e293b;border-radius:8px';
                div.innerHTML = `<img src="${base64}" style="width:80px;height:56px;object-fit:cover;border-radius:4px;flex-shrink:0">
                    <div style="flex:1">
                        <p style="font-size:11px;color:#64748b;margin:0 0 6px">${file.name}</p>
                        <input type="text" placeholder="Título/descrição (opcional)" style="width:100%;padding:6px 10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#f1f5f9;font-size:12px;font-family:inherit;box-sizing:border-box"
                            oninput="pendingImgs[${idx}].descricao=this.value">
                    </div>`;
                preview.appendChild(div);
            } catch { /* skip */ }
        }
    });
});

async function salvarImagensAdmin() {
    if (!_addImgAbaId || !pendingImgs.length) return;
    const btn = document.getElementById('btnSalvarImgAdmin');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
        const stepsRef = PROJ_COL().doc(_addImgAbaId).collection('steps');
        const exist = await stepsRef.orderBy('ordem').get();
        let maxOrdem = exist.docs.reduce((m, d) => Math.max(m, d.data().ordem || 0), 0);
        const batch = db.batch();
        pendingImgs.forEach(img => {
            batch.set(stepsRef.doc(), {
                image: img.base64,
                isBase64: true,
                descricao: img.descricao || '',
                title: img.descricao || '',
                description: '',
                balloonType: 'default',
                ordem: ++maxOrdem,
                criadoPor: window._userEmail || '',
                criadoEm: new Date().toISOString()
            });
        });
        await batch.commit();
        fecharModalAddImg();
        selecionarAba(_addImgAbaId);
    } catch (e) { alert('Erro: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Salvar'; }
}

// ── Admin: editar/deletar step ────────────────────────────────
let _editStepAbaId = null, _editStepId = null, _editStepPendingBase64 = null;

async function editarStep(abaId, stepId) {
    const snap = await PROJ_COL().doc(abaId).collection('steps').doc(stepId).get();
    if (!snap.exists) return;
    const s = snap.data();
    const aba = abasCarregadas.find(a => a.id === abaId);
    _editStepAbaId = abaId; _editStepId = stepId; _editStepPendingBase64 = null;

    const imgSrc = s.image || '';
    const LABEL = 'display:block;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px';
    const INPUT = 'width:100%;padding:9px 12px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#f1f5f9;font-family:inherit;font-size:14px;box-sizing:border-box';

    document.getElementById('editStepFields').innerHTML = `
        <div style="margin-bottom:14px">
            ${imgSrc ? `<img id="editStepImgPreview" src="${imgSrc}" style="width:100%;max-height:160px;object-fit:cover;border-radius:6px;border:1px solid #334155;margin-bottom:8px">` : ''}
            <button type="button" onclick="editStepEscolherImagem()" style="padding:8px 14px;background:rgba(99,102,241,.12);border:1px dashed rgba(99,102,241,.4);border-radius:8px;color:#818cf8;cursor:pointer;font-size:13px;width:100%"><i class="fas fa-image"></i> Substituir imagem (upload para nuvem)</button>
            <div id="editStepImgInfo" style="font-size:11px;color:#64748b;margin-top:4px"></div>
        </div>
        <div style="margin-bottom:14px"><label style="${LABEL}">Título</label><input id="editStepTitle" style="${INPUT}" value="${_escaparAttrOps(s.title||'')}"></div>
        <div style="margin-bottom:14px"><label style="${LABEL}">Descrição (HTML permitido)</label><textarea id="editStepDesc" rows="4" style="${INPUT}">${escapeHTML(s.description||'')}</textarea></div>
        <div style="margin-bottom:14px"><label style="${LABEL}">Tipo de balão</label>
            <select id="editStepBalloon" style="${INPUT}">
                ${['default','info','warning','error','success'].map(t=>`<option value="${t}"${s.balloonType===t?' selected':''}>${t}</option>`).join('')}
            </select>
        </div>
        ${s.criadoPor ? `<div class="item-autor" style="margin-top:4px">Subido por: ${escapeHTML(s.criadoPor)}${s.criadoEm ? ' em ' + new Date(s.criadoEm).toLocaleDateString('pt-BR') : ''}</div>` : ''}
    `;
    document.getElementById('modalEditStep').style.display = 'flex';
}

function editStepEscolherImagem() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        _editStepPendingBase64 = await comprimirImagem(file);
        const prev = document.getElementById('editStepImgPreview');
        if (prev) prev.src = _editStepPendingBase64;
        else {
            const img = document.createElement('img');
            img.id = 'editStepImgPreview';
            img.style.cssText = 'width:100%;max-height:160px;object-fit:cover;border-radius:6px;border:1px solid #334155;margin-bottom:8px';
            img.src = _editStepPendingBase64;
            document.getElementById('editStepFields').insertAdjacentElement('afterbegin', img);
        }
        document.getElementById('editStepImgInfo').textContent = `✓ Nova imagem: ${file.name} (será salva na nuvem)`;
    };
    input.click();
}

function fecharModalEditStep() {
    document.getElementById('modalEditStep').style.display = 'none';
    _editStepAbaId = _editStepId = _editStepPendingBase64 = null;
}

async function salvarEditStep() {
    const update = {
        title: document.getElementById('editStepTitle').value.trim(),
        description: document.getElementById('editStepDesc').value.trim(),
        balloonType: document.getElementById('editStepBalloon').value
    };
    if (_editStepPendingBase64) {
        update.image = _editStepPendingBase64;
        update.isBase64 = true;
    }
    await PROJ_COL().doc(_editStepAbaId).collection('steps').doc(_editStepId).update(update);
    fecharModalEditStep();
    selecionarAba(_editStepAbaId);
}

async function deletarStep(abaId, stepId, nome) {
    if (!confirm(`Mover "${nome}" para a lixeira?`)) return;
    try {
        await LIXEIRA_REF().add({
            tipo: 'step', abaId, stepId, nome, categoria: 'Passo / Imagem',
            deletadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            deletadoPor: window._userEmail || ''
        });
        await PROJ_COL().doc(abaId).collection('steps').doc(stepId).update({
            deletado: true,
            deletadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            deletadoPor: window._userEmail || ''
        });
        selecionarAba(abaId);
    } catch (e) {
        mostrarNotifOps('Erro ao mover para lixeira: ' + e.message);
        console.error('deletarStep', e);
    }
}

// ── Compressão de imagem ──────────────────────────────────────
function comprimirImagem(file, maxW = 1200, quality = 0.75) {
    return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onerror = rej;
        reader.onload = e => {
            const img = new Image();
            img.onerror = rej;
            img.onload = () => {
                let { width: w, height: h } = img;
                if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                res(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ── Lixeira ───────────────────────────────────────────────────
let _lixeiraOpsItems = [];

async function abrirLixeiraOps() {
    document.getElementById('lixeiraOpsModal').style.display = 'flex';
    await carregarLixeiraOps();
}

function fecharLixeiraOps() {
    document.getElementById('lixeiraOpsModal').style.display = 'none';
}

async function carregarLixeiraOps() {
    const snap = await LIXEIRA_REF().orderBy('deletadoEm', 'desc').get();
    _lixeiraOpsItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderizarLixeiraOps();
}

function renderizarLixeiraOps() {
    const container = document.getElementById('lixeiraOpsContent');
    const visiveis = _lixeiraOpsItems.filter(i => !i.restaurado || window._isSuperAdmin);
    if (!visiveis.length) {
        container.innerHTML = '<p style="color:#64748b;text-align:center;padding:2rem;font-style:italic">Lixeira vazia</p>';
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
                ${!restaurado ? `<button class="lixeira-btn-action" onclick="restaurarItemOps('${item.id}')"><i class="fas fa-undo"></i> Restaurar</button>` : ''}
                ${window._isSuperAdmin ? `<button class="lixeira-btn-action lixeira-btn-del" onclick="deletarDefinitivoOps('${item.id}','${_escaparAttrOps(item.nome)}')" title="Apagar permanentemente"><i class="fas fa-skull"></i></button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function restaurarItemOps(id) {
    const item = _lixeiraOpsItems.find(i => i.id === id);
    if (!item) return;
    try {
        if (item.tipo === 'aba') {
            await PROJ_COL().doc(item.abaId).update({ deletado: firebase.firestore.FieldValue.delete() });
            const snap = await PROJ_COL().doc(item.abaId).get();
            if (snap.exists) {
                const abaData = { id: snap.id, ...snap.data() };
                if (!abasCarregadas.find(a => a.id === snap.id)) {
                    abasCarregadas.push(abaData);
                }
                renderizarAbas();
            }
        } else if (item.tipo === 'step') {
            await PROJ_COL().doc(item.abaId).collection('steps').doc(item.stepId).update({ deletado: firebase.firestore.FieldValue.delete() });
            if (abaAtiva === item.abaId) selecionarAba(item.abaId);
        }
        await LIXEIRA_REF().doc(id).update({ restaurado: true, restauradoEm: firebase.firestore.FieldValue.serverTimestamp() });
        mostrarNotifOps('Restaurado ✓');
        await carregarLixeiraOps();
    } catch (e) {
        mostrarNotifOps('Erro: ' + e.message);
    }
}

async function deletarDefinitivoOps(id, nome) {
    if (!confirm(`Apagar "${nome}" PERMANENTEMENTE? Não pode ser desfeito.`)) return;
    const item = _lixeiraOpsItems.find(i => i.id === id);
    if (item?.tipo === 'aba') {
        const stepsSnap = await PROJ_COL().doc(item.abaId).collection('steps').get();
        const batch = db.batch();
        stepsSnap.docs.forEach(d => batch.delete(d.ref));
        batch.delete(PROJ_COL().doc(item.abaId));
        await batch.commit();
    } else if (item?.tipo === 'step') {
        await PROJ_COL().doc(item.abaId).collection('steps').doc(item.stepId).delete();
    }
    await LIXEIRA_REF().doc(id).delete();
    mostrarNotifOps('Apagado permanentemente');
    await carregarLixeiraOps();
}

// ── Reordenar steps ──────────────────────────────────────────
async function moverStep(abaId, stepId, dir) {
    const idx      = _currentSteps.findIndex(s => s.id === stepId);
    const swapIdx  = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= _currentSteps.length) return;

    const a = _currentSteps[idx];
    const b = _currentSteps[swapIdx];
    const batch = db.batch();
    const stepsCol = PROJ_COL().doc(abaId).collection('steps');
    batch.update(stepsCol.doc(a.id), { ordem: b.ordem });
    batch.update(stepsCol.doc(b.id), { ordem: a.ordem });
    await batch.commit();

    // atualiza memória e re-renderiza sem ir ao Firestore de novo
    [a.ordem, b.ordem] = [b.ordem, a.ordem];
    _currentSteps.splice(idx, 1);
    _currentSteps.splice(swapIdx, 0, a);
    // reordena pelo valor de ordem
    _currentSteps.sort((x, y) => x.ordem - y.ordem);
    selecionarAba(abaId);
}

// ── Reordenar abas ────────────────────────────────────────────
async function moverAba(id, dir) {
    const idx     = abasCarregadas.findIndex(a => a.id === id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= abasCarregadas.length) return;

    const a = abasCarregadas[idx];
    const b = abasCarregadas[swapIdx];
    const batch = db.batch();
    batch.update(PROJ_COL().doc(a.id), { ordem: b.ordem });
    batch.update(PROJ_COL().doc(b.id), { ordem: a.ordem });
    await batch.commit();

    [a.ordem, b.ordem] = [b.ordem, a.ordem];
    abasCarregadas[idx]     = b;
    abasCarregadas[swapIdx] = a;
    renderizarAbas();
}

// ── Migração de imagens locais → Firestore base64 ────────────
async function _comprimirImagem(url, maxBytes = 850000) {
    const img = await new Promise((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error(`Não encontrou: ${url}`));
        el.src = url;
    });

    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    const MAX = 1400;
    if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
    }
    canvas.width = w; canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    for (const q of [0.85, 0.72, 0.58, 0.42, 0.3]) {
        const b64 = canvas.toDataURL('image/jpeg', q);
        if (b64.length <= maxBytes) return b64;
    }
    // última tentativa: metade das dimensões
    canvas.width = Math.round(w / 2); canvas.height = Math.round(h / 2);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.55);
}

function _migLog(msg) {
    const el = document.getElementById('migLog');
    if (el) {
        const div = document.createElement('div');
        div.textContent = msg;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }
}

function _migProgresso(msg, done, total) {
    const msgEl = document.getElementById('migMsg');
    const bar   = document.getElementById('migBar');
    if (msgEl) msgEl.textContent = msg;
    if (bar)   bar.style.width = total ? `${Math.round(done / total * 100)}%` : '0%';
}

function abrirMigracao() {
    document.getElementById('migLog').innerHTML = '';
    document.getElementById('migBar').style.width = '0%';
    document.getElementById('migMsg').textContent = 'Calculando imagens locais...';
    document.getElementById('modalMigracao').classList.add('aberto');
    _executarMigracao();
}

async function _executarMigracao() {
    const abasLocais = abasCarregadas.filter(a => a.folder && a.tipo === 'steps');
    if (!abasLocais.length) {
        _migProgresso('Nenhuma imagem local encontrada!', 1, 1);
        setTimeout(() => document.getElementById('modalMigracao').classList.remove('aberto'), 1500);
        return;
    }

    // conta total de steps locais
    let total = 0;
    const filas = [];
    for (const aba of abasLocais) {
        const snap = await PROJ_COL().doc(aba.id).collection('steps').get();
        const locais = snap.docs.filter(d => !d.data().isBase64 && !d.data().deletado);
        total += locais.length;
        filas.push({ aba, docs: locais });
    }

    let done = 0, erros = 0;
    _migProgresso(`0 / ${total} imagens`, 0, total);

    for (const { aba, docs } of filas) {
        for (const doc of docs) {
            const s      = doc.data();
            const imgUrl = `${aba.folder}/${s.image}`;
            try {
                _migLog(`⏳ ${aba.title} › ${s.image}`);
                const b64 = await _comprimirImagem(imgUrl);
                const kb  = Math.round(b64.length * 0.75 / 1024);
                await doc.ref.update({ image: b64, isBase64: true });
                done++;
                _migLog(`✅ ${s.image} → ${kb} KB`);
            } catch (e) {
                erros++;
                done++;
                _migLog(`❌ ${s.image}: ${e.message}`);
            }
            _migProgresso(`${done} / ${total} imagens`, done, total);
        }

        // verifica se restou alguma imagem local nessa aba
        const restSnap = await PROJ_COL().doc(aba.id).collection('steps').where('isBase64', '!=', true).get();
        const restLocais = restSnap.docs.filter(d => !d.data().deletado);
        if (restLocais.length === 0) {
            // todas migradas — remove o folder da aba
            await PROJ_COL().doc(aba.id).update({ folder: null });
            const local = abasCarregadas.find(a => a.id === aba.id);
            if (local) local.folder = null;
        }
    }

    const msg = erros
        ? `Concluído com ${erros} erro(s). ${done - erros}/${total} migradas.`
        : `✅ ${done} imagens migradas para a nuvem!`;
    _migProgresso(msg, total, total);
    _migLog(`\n${msg}`);

    renderizarAbas();
    selecionarAba(abaAtiva);

    setTimeout(() => document.getElementById('modalMigracao').classList.remove('aberto'), 3000);
}

function mostrarNotifOps(msg) {
    let n = document.getElementById('notifOps');
    if (!n) {
        n = document.createElement('div');
        n.id = 'notifOps';
        n.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px 20px;color:#f1f5f9;font-size:14px;z-index:99999;transition:.3s;opacity:0';
        document.body.appendChild(n);
    }
    n.textContent = msg;
    n.style.opacity = '1';
    clearTimeout(n._t);
    n._t = setTimeout(() => n.style.opacity = '0', 3000);
}

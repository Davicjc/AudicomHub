// Sistema de Suporte de Roteadores - AUDICOM
// Dados carregados do Firestore (sem dados hardcoded)

const PROJ_REF    = () => db.collection('projetos').doc('suporte-roteadores');
const LIXEIRA_REF = () => db.collection('lixeira-roteadores');

let dadosApp = { dns: [], senhas: [], olts: [], vlans: [], presets: [] };
let filtroAtivo = null;

async function iniciarApp() {
    try {
        await carregarDados();
    } catch (e) {
        console.error('Erro ao carregar dados:', e);
        mostrarNotificacao('Erro ao carregar dados. Recarregue a página.');
    }
    configurarEventos();
    renderizarFiltros();
    gerarPaineis();
}

async function carregarDados() {
    const ref = PROJ_REF();
    const [dnsSnap, senhasSnap, oltsSnap, vlansSnap, presetsSnap] = await Promise.all([
        ref.collection('dns').orderBy('ordem').get(),
        ref.collection('senhas').orderBy('ordem').get(),
        ref.collection('olts').orderBy('ordem').get(),
        ref.collection('vlans').orderBy('ordem').get(),
        ref.collection('presets').orderBy('ordem').get()
    ]);
    dadosApp.dns     = dnsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    dadosApp.senhas  = senhasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    dadosApp.olts    = oltsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    dadosApp.vlans   = vlansSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    dadosApp.presets = presetsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function recarregar(msg) {
    await carregarDados();
    gerarPaineis();
    fecharModalAdmin();
    mostrarNotificacao(msg || 'Salvo ✓');
}

function configurarEventos() {
    const clearBtn = document.getElementById('clear-filters');
    if (clearBtn) clearBtn.onclick = limparFiltros;
}


// ── Filtros ──────────────────────────────────────────────────
const CATEGORIAS = [
    { key: 'dns',     icon: '🌐', label: 'DNS' },
    { key: 'senhas',  icon: '🔐', label: 'SENHA' },
    { key: 'olts',    icon: '📡', label: 'OLT' },
    { key: 'vlans',   icon: '🔗', label: 'VLAN' },
    { key: 'presets', icon: '⚙️', label: 'PRESETS' }
];

function renderizarFiltros() {
    const container = document.getElementById('category-filters');
    if (!container) return;
    container.innerHTML = '';
    CATEGORIAS.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.innerHTML = `${cat.icon} ${cat.label}`;
        btn.dataset.categoria = cat.key;
        btn.onclick = () => aplicarFiltro(cat.key, btn);
        container.appendChild(btn);
    });
}

function aplicarFiltro(categoria, button) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (filtroAtivo === categoria) {
        filtroAtivo = null;
        mostrarTodosPaineis();
    } else {
        filtroAtivo = categoria;
        button.classList.add('active');
        mostrarPainelEspecifico(categoria);
    }
}

function limparFiltros() {
    filtroAtivo = null;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    mostrarTodosPaineis();
}

function mostrarTodosPaineis() {
    document.querySelectorAll('.info-panel').forEach(p => p.classList.remove('hidden'));
}

function mostrarPainelEspecifico(categoria) {
    document.querySelectorAll('.info-panel').forEach(p => p.classList.add('hidden'));
    const painel = document.getElementById(`${categoria}-panel`);
    if (painel) painel.classList.remove('hidden');
}

// ── Painéis ──────────────────────────────────────────────────
function gerarPaineis() {
    gerarPainelDNS();
    gerarPainelSenhas();
    gerarPainelOLTs();
    gerarPainelVLANs();
    gerarPainelPresets();
}

function btnAdm(icon, label, onclick) {
    return `<button class="adm-btn ${icon==='fa-trash'?'adm-del':icon==='fa-plus'?'adm-add':''}" onclick="${onclick}" title="${label}"><i class="fas ${icon}"></i>${label?` <span>${label}</span>`:''}</button>`;
}

function gerarPainelDNS() {
    const container = document.getElementById('dns-content');
    let html = dadosApp.dns.length ? dadosApp.dns.map(dns => `
        <div class="dns-item" onclick="copiarTexto('${escaparAttr(dns.ip)}')">
            <div class="dns-info">
                <div class="dns-name">${escapeHTML(dns.nome)}</div>
                <div class="dns-ip">${escapeHTML(dns.ip)}</div>
                <div class="dns-details">${escapeHTML(dns.tipo)} - Status: ${escapeHTML(dns.status)}</div>
                ${dns.criadoPor ? `<div class="item-autor">por ${escapeHTML(dns.criadoPor)}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;align-items:center">
                <button class="btn btn-primary" onclick="event.stopPropagation();copiarTexto('${escaparAttr(dns.ip)}')"><i class="fas fa-copy"></i></button>
                ${window._can.editar ? btnAdm('fa-pen','',`event.stopPropagation();editarDNS('${dns.id}')`) : ''}
                ${window._can.moverLixeira ? btnAdm('fa-trash','',`event.stopPropagation();deletarDNS('${dns.id}','${escaparAttr(dns.nome)}')`) : ''}
            </div>
        </div>`).join('')
        : '<p class="section-description">Nenhum DNS cadastrado.</p>';
    if (window._can.adicionar) html += btnAdm('fa-plus','Adicionar DNS','adicionarDNS()');
    container.innerHTML = html;
}

function gerarPainelSenhas() {
    const container = document.getElementById('senhas-content');
    let html = dadosApp.senhas.length ? dadosApp.senhas.map(grupo => `
        <div class="senha-group">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div>
                    <div class="senha-group-title" style="margin:0">${escapeHTML(grupo.nome)}</div>
                    ${grupo.criadoPor ? `<div class="item-autor">por ${escapeHTML(grupo.criadoPor)}</div>` : ''}
                </div>
                <div style="display:flex;gap:4px">
                    ${window._can.adicionar ? btnAdm('fa-plus','',`adicionarCredencial('${grupo.id}')`) : ''} ${window._can.editar ? btnAdm('fa-pen','',`editarGrupoSenha('${grupo.id}')`) : ''}
                    ${window._can.moverLixeira ? btnAdm('fa-trash','',`deletarGrupoSenha('${grupo.id}','${escaparAttr(grupo.nome)}')`) : ''}
                </div>
            </div>
            <div class="credenciais-list">
                ${(grupo.credenciais || []).map((cred, idx) => `
                    <div class="credencial-item">
                        <div class="credencial-info">
                            <div class="credencial-user">Usuário: ${escapeHTML(cred.usuario)}</div>
                            <div class="credencial-pass">Senha: ${escapeHTML(cred.senha)}</div>
                            <div class="credencial-desc">${escapeHTML(cred.descricao || '')}</div>
                            ${cred.criadoPor ? `<div class="item-autor">por ${escapeHTML(cred.criadoPor)}</div>` : ''}
                        </div>
                        <div class="credencial-actions">
                            <button class="copy-btn copy-senha-btn" onclick="copiarApenasSenha('${escaparAttr(cred.senha)}')" title="Copiar apenas a senha">
                                <i class="fas fa-key"></i><span>Senha</span>
                            </button>
                            <button class="copy-btn copy-credencial-btn" onclick="copiarCredencial('${escaparAttr(cred.usuario)}','${escaparAttr(cred.senha)}')" title="Copiar usuário e senha">
                                <i class="fas fa-copy"></i><span>Tudo</span>
                            </button>
                            ${window._can.editar ? btnAdm('fa-pen','',`editarCredencial('${grupo.id}',${idx})`) : ''}
                            ${window._can.moverLixeira ? btnAdm('fa-trash','',`deletarCredencial('${grupo.id}',${idx})`) : ''}
                        </div>
                    </div>`).join('')}
            </div>
        </div>`).join('')
        : '<p class="section-description">Nenhum grupo de senhas cadastrado.</p>';
    if (window._can.adicionar) html += btnAdm('fa-plus','Novo Grupo','adicionarGrupoSenha()');
    container.innerHTML = html;
}

function gerarPainelOLTs() {
    const container = document.getElementById('olts-list');
    let html = dadosApp.olts.length ? dadosApp.olts.map(olt => {
        const urlSegura = /^https?:\/\//i.test(olt.url || '') ? olt.url : null;
        return `
        <div class="olt-item">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div class="olt-name">${escapeHTML(olt.nome)}</div>
                <div style="display:flex;gap:4px;flex-shrink:0">
                    ${window._can.editar ? btnAdm('fa-pen','',`editarOLT('${olt.id}')`) : ''}
                    ${window._can.moverLixeira ? btnAdm('fa-trash','',`deletarOLT('${olt.id}','${escaparAttr(olt.nome)}')`) : ''}
                </div>
            </div>
            <div class="olt-details">
                ${olt.url ? `<div class="olt-detail-item"><span class="olt-detail-label">URL:</span><span class="olt-detail-value">${escapeHTML(olt.url)}</span></div>` : ''}
                ${olt.usuario ? `<div class="olt-detail-item"><span class="olt-detail-label">Usuário:</span><span class="olt-detail-value">${escapeHTML(olt.usuario)}</span></div>` : ''}
                ${olt.senha ? `<div class="olt-detail-item">
                    <span class="olt-detail-label">Senha:</span>
                    <span class="olt-detail-value">${escapeHTML(olt.senha)}</span>
                    <button class="copy-senha-inline-btn" onclick="copiarApenasSenha('${escaparAttr(olt.senha)}')" title="Copiar senha"><i class="fas fa-key"></i></button>
                </div>` : ''}
                <div class="olt-detail-item"><span class="olt-detail-label">Local:</span><span class="olt-detail-value">${escapeHTML(olt.localizacao || '-')}</span></div>
                ${olt.criadoPor ? `<div class="item-autor" style="margin-top:6px">por ${escapeHTML(olt.criadoPor)}</div>` : ''}
            </div>
            <div class="olt-actions">
                ${urlSegura ? `<a href="${urlSegura}" target="_blank" class="btn btn-link"><i class="fas fa-external-link-alt"></i> Acessar</a>` : ''}
                <button class="btn btn-primary" onclick="copiarOltCompleto('${escaparAttr(olt.nome)}','${escaparAttr(olt.url||'')}','${escaparAttr(olt.usuario||'')}','${escaparAttr(olt.senha||'')}','${escaparAttr(olt.localizacao||'')}')">
                    <i class="fas fa-copy"></i> Copiar
                </button>
            </div>
        </div>`;
    }).join('')
        : '<p>Nenhuma OLT cadastrada.</p>';
    if (window._can.adicionar) html += btnAdm('fa-plus','Adicionar OLT','adicionarOLT()');
    container.innerHTML = html;
}

function gerarPainelVLANs() {
    const container = document.getElementById('vlans-content');
    let html = dadosApp.vlans.length ? dadosApp.vlans.map(local => `
        <div class="vlan-location-card">
            <div class="vlan-location-header">
                <div style="display:flex;align-items:center;gap:8px;flex:1">
                    <h3 style="margin:0"><i class="fas fa-map-marker-alt"></i> ${escapeHTML(local.nome)}</h3>
                    <span class="vlan-count">${(local.pons||[]).length} PONs</span>
                    ${local.criadoPor ? `<span class="item-autor" style="font-size:10px">por ${escapeHTML(local.criadoPor)}</span>` : ''}
                </div>
                <div style="display:flex;gap:4px">
                    ${window._can.adicionar ? btnAdm('fa-plus','',`adicionarPON('${local.id}')`) : ''} ${window._can.editar ? btnAdm('fa-pen','',`editarVLANLocal('${local.id}')`) : ''}
                    ${window._can.moverLixeira ? btnAdm('fa-trash','',`deletarVLANLocal('${local.id}','${escaparAttr(local.nome)}')`) : ''}
                </div>
            </div>
            <ul class="vlan-list">
                ${(local.pons||[]).map((pon, idx) => `
                    <li class="vlan-list-item">
                        <div class="vlan-item-content" onclick="copiarTexto('${escaparAttr(pon.vlan)}')" style="cursor:pointer;flex:1">
                            <span class="pon-label">${escapeHTML(pon.pon)}</span>
                            <span class="vlan-badge">VLAN ${escapeHTML(pon.vlan)}</span>
                        </div>
                        <i class="fas fa-copy vlan-copy-icon" onclick="copiarTexto('${escaparAttr(pon.vlan)}')"></i>
                        ${window._can.editar ? btnAdm('fa-pen','',`editarPON('${local.id}',${idx})`) : ''}
                        ${window._can.moverLixeira ? btnAdm('fa-trash','',`deletarPON('${local.id}',${idx})`) : ''}
                    </li>`).join('')}
            </ul>
        </div>`).join('')
        : '<p class="section-description">Nenhuma VLAN cadastrada.</p>';
    if (window._can.adicionar) html += btnAdm('fa-plus','Nova Localização','adicionarVLANLocal()');
    container.innerHTML = html;
}

function gerarPainelPresets() {
    const container = document.getElementById('presets-content');
    if (!dadosApp.presets.length) {
        container.innerHTML = '<p style="color:var(--surface-500);text-align:center;padding:2rem;font-style:italic">Nenhum preset cadastrado.</p>'
            + (window._can.adicionar ? btnAdm('fa-plus','Nova Seção','adicionarPresetFab()') : '');
        return;
    }

    const _chip = (fab, rIdx, arq, aIdx) => {
        const noFs = !(arq.base64 || arq.chunkRef);
        const label = arq.tipo || arq.nome;
        const titulo = arq.nome + (arq.tamanho ? ' · ' + arq.tamanho : '') + (noFs ? ' ⚠ arquivo local' : ' ✓ Firestore');
        return '<div class="ps-chip-wrap">'
            + '<button class="ps-chip' + (noFs ? ' ps-chip--warn' : '') + '" onclick="verInfoArquivo(\'' + fab.id + '\',' + rIdx + ',' + aIdx + ')" title="' + escaparAttr(titulo) + '">'
            + '<i class="fas fa-info-circle ps-chip-icon"></i>' + escapeHTML(label)
            + '</button>'
            + (window._can.editar ? btnAdm('fa-pen','','editarPresetArq(\'' + fab.id + '\',' + rIdx + ',' + aIdx + ')') : '')
            + (window._can.moverLixeira ? btnAdm('fa-trash','','deletarPresetArq(\'' + fab.id + '\',' + rIdx + ',' + aIdx + ')') : '')
            + '</div>';
    };

    let html = dadosApp.presets.map(fab => {
        const rots = (fab.roteadores || []).map((rot, rIdx) => {
            const chips = rot.arquivos && rot.arquivos.length
                ? rot.arquivos.map((arq, aIdx) => _chip(fab, rIdx, arq, aIdx)).join('')
                : '<span class="ps-vazio">sem arquivos</span>';
            const admRot = '<div class="ps-adm">'
                + (window._can.adicionar ? btnAdm('fa-plus','','adicionarPresetArq(\'' + fab.id + '\',' + rIdx + ')') : '') + (window._can.editar ? btnAdm('fa-pen','','editarPresetRot(\'' + fab.id + '\',' + rIdx + ')') : '')
                + (window._can.moverLixeira ? btnAdm('fa-trash','','deletarPresetRot(\'' + fab.id + '\',' + rIdx + ')') : '')
                + '</div>';
            return '<div class="ps-modelo">'
                + '<div class="ps-modelo-nome"><span class="ps-modelo-dot"></span><span class="ps-modelo-label" title="' + escaparAttr(rot.modelo) + '">' + escapeHTML(rot.modelo) + '</span></div>'
                + '<div class="ps-modelo-sep"></div>'
                + '<div class="ps-arquivos">' + chips + '</div>'
                + admRot
                + '</div>';
        }).join('');

        const admFab = '<div class="ps-adm">'
            + (window._can.adicionar ? btnAdm('fa-plus','','adicionarPresetRot(\'' + fab.id + '\')') : '') + (window._can.editar ? btnAdm('fa-pen','','editarPresetFab(\'' + fab.id + '\')') : '')
            + (window._can.moverLixeira ? btnAdm('fa-trash','','deletarPresetFab(\'' + fab.id + '\',\'' + escaparAttr(fab.nome) + '\')') : '')
            + '</div>';

        return '<div class="ps-bloco">'
            + '<div class="ps-bloco-hd">'
            + '<div class="ps-fab-info"><div class="ps-fab-icon"><i class="fas fa-industry"></i></div><span class="ps-fab-nome">' + escapeHTML(fab.nome) + '</span><span class="ps-fab-badge">' + (fab.roteadores||[]).length + ' modelos</span></div>'
            + admFab
            + '</div>'
            + '<div class="ps-modelos">' + rots + '</div>'
            + '</div>';
    }).join('');

    if (window._can.adicionar) html += btnAdm('fa-plus','Nova Seção','adicionarPresetFab()');
    container.innerHTML = html;
}


// ── Busca OLTs ───────────────────────────────────────────────
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function filtrarOLTs(termo) {
    const items = document.querySelectorAll('.olt-item');
    const termoN = normalizarTexto(termo);
    let encontrados = 0;
    items.forEach(item => {
        const match = !termoN || normalizarTexto(item.textContent).includes(termoN);
        item.classList.toggle('hidden', !match);
        item.classList.toggle('highlight', !!termoN && match);
        if (match) encontrados++;
    });
    let info = document.getElementById('olt-search-info');
    if (!info) {
        info = document.createElement('div');
        info.id = 'olt-search-info';
        info.className = 'search-results-info';
        document.querySelector('.search-container').insertAdjacentElement('afterend', info);
    }
    if (!termoN || encontrados === items.length) { info.style.display = 'none'; return; }
    info.style.display = 'block';
    info.innerHTML = `<i class="fas fa-info-circle"></i> Mostrando ${encontrados} de ${items.length} OLTs`;
}

function limparPesquisaOLT() {
    document.getElementById('olt-search').value = '';
    filtrarOLTs('');
}

// ── Cópia ────────────────────────────────────────────────────
function copiarTexto(texto) {
    navigator.clipboard.writeText(texto).then(() => mostrarNotificacao('Copiado!')).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = texto; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        mostrarNotificacao('Copiado!');
    });
}

function copiarApenasSenha(senha) { copiarTexto(senha); }
function copiarCredencial(usuario, senha) { copiarTexto(`Usuário: ${usuario}\nSenha: ${senha}`); }
function copiarOltCompleto(nome, url, usuario, senha, loc) {
    let t = `${nome}\n`;
    if (url)    t += `URL: ${url}\n`;
    if (usuario) t += `Usuário: ${usuario}\n`;
    if (senha)  t += `Senha: ${senha}\n`;
    t += `Localização: ${loc}`;
    copiarTexto(t);
}

function copiarSecao(cat) {
    let t = '';
    if (cat === 'dns') {
        t = 'Servidores DNS AUDICOM\n' + '='.repeat(22) + '\n\n';
        dadosApp.dns.forEach(d => t += `${d.nome}: ${d.ip} (${d.tipo})\n`);
    } else if (cat === 'senhas') {
        t = 'Senhas de Equipamentos\n' + '='.repeat(22) + '\n\n';
        dadosApp.senhas.forEach(g => {
            t += `${g.nome}:\n`;
            (g.credenciais||[]).forEach(c => t += `  ${c.usuario}:${c.senha}${c.descricao ? ' ('+c.descricao+')' : ''}\n`);
            t += '\n';
        });
    } else if (cat === 'olts') {
        t = 'OLTs - Equipamentos e Acessos\n' + '='.repeat(30) + '\n\n';
        dadosApp.olts.forEach(o => {
            t += `${o.nome} (${o.fabricante})\n`;
            if (o.url)    t += `URL: ${o.url}\n`;
            if (o.usuario) t += `Usuário: ${o.usuario}\n`;
            if (o.senha)  t += `Senha: ${o.senha}\n`;
            t += `Localização: ${o.localizacao}\n\n`;
        });
    } else if (cat === 'vlans') {
        t = 'VLANs por Localização\n' + '='.repeat(21) + '\n\n';
        dadosApp.vlans.forEach(v => {
            t += `${v.nome}:\n`;
            (v.pons||[]).forEach(p => t += `  ${p.pon}: VLAN ${p.vlan}\n`);
            t += '\n';
        });
    } else if (cat === 'presets') {
        t = 'Presets de Roteadores\n' + '='.repeat(21) + '\n\n';
        dadosApp.presets.forEach(f => {
            t += `${f.nome}:\n`;
            (f.roteadores||[]).forEach(r => {
                t += `  ${r.modelo}:\n`;
                (r.arquivos||[]).forEach(a => t += `    - ${a.nome} (${a.tipo}) - ${a.dataModificacao}\n`);
                if (!r.arquivos?.length) t += '    - Nenhum arquivo\n';
            });
            t += '\n';
        });
    }
    copiarTexto(t);
}

async function downloadPreset(idFab, rIdx, aIdx) {
    const arq = dadosApp.presets.find(p => p.id === idFab)?.roteadores?.[rIdx]?.arquivos?.[aIdx];
    if (!arq) return mostrarNotificacao('Arquivo não encontrado');
    let href;
    try {
        if (arq.base64) {
            href = arq.base64;
        } else if (arq.chunkRef) {
            href = await _montarChunks(arq);
        } else {
            href = `presset/${arq.nome}`;
        }
    } catch (e) {
        mostrarNotificacao('Erro ao carregar arquivo: ' + e.message);
        return;
    }
    const link = document.createElement('a');
    link.href = href;
    link.download = arq.nome;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    mostrarNotificacao(`Download: ${arq.nome}`);
}

function escaparAttr(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mostrarNotificacao(mensagem) {
    const n = document.getElementById('notification');
    if (!n) return;
    n.querySelector('span').textContent = mensagem;
    n.classList.add('show');
    setTimeout(() => n.classList.remove('show'), 3000);
}

// ── Admin Modal Genérico ──────────────────────────────────────
let _admCallback = null;

function _campo(c) {
    const val = c.value !== undefined ? String(c.value) : '';
    if (c.type === 'file-btn') {
        return `<div class="adm-field">
            <label class="adm-label">${c.label}</label>
            <button type="button" onclick="_escolherArquivoPreset()" class="adm-btn" style="width:100%;justify-content:center;padding:10px;border-style:dashed">
                <i class="fas fa-upload"></i> <span>Selecionar arquivo do computador</span>
            </button>
            <div id="admFileInfo" style="font-size:11px;margin-top:5px"></div>
        </div>`;
    }
    if (c.type === 'select') {
        const opts = c.options.map(o => `<option value="${escaparAttr(o.value||o)}"${val===(o.value||o)?'selected':''}>${o.label||o}</option>`).join('');
        return `<div class="adm-field"><label class="adm-label">${c.label}</label><select id="${c.id}" class="adm-input">${opts}</select></div>`;
    }
    if (c.type === 'textarea') {
        return `<div class="adm-field"><label class="adm-label">${c.label}</label><textarea id="${c.id}" class="adm-input" rows="${c.rows||3}" placeholder="${c.placeholder||''}">${val}</textarea></div>`;
    }
    return `<div class="adm-field"><label class="adm-label">${c.label}</label><input type="${c.type||'text'}" id="${c.id}" class="adm-input" value="${escaparAttr(val)}" placeholder="${c.placeholder||''}"></div>`;
}

let _pendingFileBase64 = null;

const _CHUNK_SIZE = 700000; // 700KB em chars base64 por chunk

function _fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function _fileToBase64(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

function _genChunkRef() {
    return 'ck_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// Salva base64 no Firestore — inline se pequeno, em chunks se grande
async function _salvarBase64(base64, chunkRef) {
    const comma  = base64.indexOf(',') + 1;
    const prefix = base64.substring(0, comma);
    const data   = base64.substring(comma);

    if (data.length <= _CHUNK_SIZE) {
        return { base64 }; // cabe num único campo
    }

    // Divide em chunks
    const chunks = [];
    for (let i = 0; i < data.length; i += _CHUNK_SIZE) {
        chunks.push(data.substring(i, i + _CHUNK_SIZE));
    }

    mostrarNotificacao(`Salvando ${chunks.length} partes no Firestore…`);

    // Grava em lotes de 400 (limite do batch)
    for (let b = 0; b < chunks.length; b += 400) {
        const batch = db.batch();
        chunks.slice(b, b + 400).forEach((chunk, j) => {
            batch.set(PROJ_REF().collection('chunks').doc(`${chunkRef}_${b + j}`), { data: chunk, idx: b + j });
        });
        await batch.commit();
    }

    return { chunkRef, chunkCount: chunks.length, mimePrefix: prefix };
}

// Monta o base64 completo lendo os chunks do Firestore
async function _montarChunks(arq) {
    mostrarNotificacao(`Carregando ${arq.nome} (${arq.chunkCount} partes)…`);
    const snaps = await Promise.all(
        Array.from({ length: arq.chunkCount }, (_, i) =>
            PROJ_REF().collection('chunks').doc(`${arq.chunkRef}_${i}`).get()
        )
    );
    const ordenados = new Array(arq.chunkCount);
    snaps.forEach(s => {
        if (!s.exists) throw new Error(`Chunk ${s.id} não encontrado no Firestore`);
        ordenados[s.data().idx] = s.data().data;
    });
    return arq.mimePrefix + ordenados.join('');
}

// Deleta os chunks do Firestore quando o arquivo é removido
async function _deletarChunks(chunkRef, chunkCount) {
    if (!chunkRef || !chunkCount) return;
    for (let b = 0; b < chunkCount; b += 400) {
        const batch = db.batch();
        for (let i = b; i < Math.min(b + 400, chunkCount); i++) {
            batch.delete(PROJ_REF().collection('chunks').doc(`${chunkRef}_${i}`));
        }
        await batch.commit();
    }
}

async function _escolherArquivoPreset() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const nomeEl = document.getElementById('pan');
        const tamEl  = document.getElementById('paz');
        if (nomeEl && !nomeEl.value) nomeEl.value = file.name;
        if (tamEl) tamEl.value = _fmtSize(file.size);
        _pendingFileBase64 = await _fileToBase64(file);
        const info = document.getElementById('admFileInfo');
        if (info) {
            const chunks = Math.ceil((_pendingFileBase64.length - _pendingFileBase64.indexOf(',')) / _CHUNK_SIZE);
            info.innerHTML = chunks > 1
                ? `<span style="color:#818cf8">✓ ${file.name} (${_fmtSize(file.size)}) — será dividido em ${chunks} partes no Firestore</span>`
                : `<span style="color:#34d399">✓ ${file.name} (${_fmtSize(file.size)}) — salvo em campo único</span>`;
        }
    };
    input.click();
}

function abrirModalAdmin(titulo, campos, onSalvar) {
    _admCallback = onSalvar;
    document.getElementById('admModalTitle').textContent = titulo;
    document.getElementById('admModalFields').innerHTML = campos.map(_campo).join('');
    document.getElementById('admModal').style.display = 'flex';
    const primeiro = document.querySelector('#admModalFields input, #admModalFields textarea, #admModalFields select');
    if (primeiro) setTimeout(() => primeiro.focus(), 50);
}

function fecharModalAdmin() {
    document.getElementById('admModal').style.display = 'none';
    _admCallback = null;
}

function confirmarModalAdmin() {
    if (_admCallback) _admCallback();
}

function _val(id) { return (document.getElementById(id)?.value || '').trim(); }

function _proximaOrdem(arr) { return arr.length ? Math.max(...arr.map(i => i.ordem || 0)) + 1 : 1; }

// ── CRUD DNS ─────────────────────────────────────────────────
function adicionarDNS() {
    abrirModalAdmin('Novo DNS', [
        { label: 'Nome',   id: 'adn', value: '' },
        { label: 'IP',     id: 'adi', value: '' },
        { label: 'Tipo',   id: 'adt', type: 'select', value: 'Primário',  options: ['Primário','Secundário','Terciário','Alternativo'] },
        { label: 'Status', id: 'ads', type: 'select', value: 'Ativo', options: ['Ativo','Inativo'] }
    ], async () => {
        const nome = _val('adn'), ip = _val('adi');
        if (!nome || !ip) return mostrarNotificacao('Nome e IP são obrigatórios');
        await PROJ_REF().collection('dns').add({ nome, ip, tipo: _val('adt'), status: _val('ads'), ordem: _proximaOrdem(dadosApp.dns), criadoPor: window._userEmail || '', criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
        await recarregar('DNS adicionado ✓');
    });
}

function editarDNS(id) {
    const item = dadosApp.dns.find(d => d.id === id);
    if (!item) return;
    abrirModalAdmin('Editar DNS', [
        { label: 'Nome',   id: 'adn', value: item.nome },
        { label: 'IP',     id: 'adi', value: item.ip },
        { label: 'Tipo',   id: 'adt', type: 'select', value: item.tipo,   options: ['Primário','Secundário','Terciário','Alternativo'] },
        { label: 'Status', id: 'ads', type: 'select', value: item.status, options: ['Ativo','Inativo'] }
    ], async () => {
        const nome = _val('adn'), ip = _val('adi');
        if (!nome || !ip) return mostrarNotificacao('Nome e IP são obrigatórios');
        await PROJ_REF().collection('dns').doc(id).update({ nome, ip, tipo: _val('adt'), status: _val('ads') });
        await recarregar('DNS atualizado ✓');
    });
}

async function deletarDNS(id, nome) {
    if (!confirm(`Mover DNS "${nome}" para a lixeira?`)) return;
    const item = dadosApp.dns.find(d => d.id === id);
    await moverParaLixeira({ nome, categoria: 'DNS', restore: { tipo: 'doc', colecao: 'dns', docId: id, dados: item } });
    await PROJ_REF().collection('dns').doc(id).delete();
    await recarregar('DNS movido para a lixeira');
}

// ── CRUD Senhas ───────────────────────────────────────────────
function adicionarGrupoSenha() {
    abrirModalAdmin('Novo Grupo de Senhas', [
        { label: 'Nome do Grupo', id: 'agn', value: '' },
        { label: 'Tipo',          id: 'agt', value: '' }
    ], async () => {
        const nome = _val('agn');
        if (!nome) return mostrarNotificacao('Nome é obrigatório');
        await PROJ_REF().collection('senhas').add({ nome, tipo: _val('agt'), credenciais: [], ordem: _proximaOrdem(dadosApp.senhas), criadoPor: window._userEmail || '', criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
        await recarregar('Grupo criado ✓');
    });
}

function editarGrupoSenha(id) {
    const item = dadosApp.senhas.find(s => s.id === id);
    if (!item) return;
    abrirModalAdmin('Editar Grupo', [
        { label: 'Nome do Grupo', id: 'agn', value: item.nome },
        { label: 'Tipo',          id: 'agt', value: item.tipo }
    ], async () => {
        const nome = _val('agn');
        if (!nome) return mostrarNotificacao('Nome é obrigatório');
        await PROJ_REF().collection('senhas').doc(id).update({ nome, tipo: _val('agt') });
        await recarregar('Grupo atualizado ✓');
    });
}

async function deletarGrupoSenha(id, nome) {
    if (!confirm(`Mover grupo "${nome}" para a lixeira?`)) return;
    const item = dadosApp.senhas.find(s => s.id === id);
    await moverParaLixeira({ nome, categoria: 'Grupo de Senhas', restore: { tipo: 'doc', colecao: 'senhas', docId: id, dados: item } });
    await PROJ_REF().collection('senhas').doc(id).delete();
    await recarregar('Grupo movido para a lixeira');
}

function adicionarCredencial(idGrupo) {
    abrirModalAdmin('Nova Credencial', [
        { label: 'Usuário',   id: 'acu', value: 'admin' },
        { label: 'Senha',     id: 'acs', value: '' },
        { label: 'Descrição', id: 'acd', value: '' }
    ], async () => {
        const usuario = _val('acu'), senha = _val('acs');
        if (!usuario || !senha) return mostrarNotificacao('Usuário e senha são obrigatórios');
        const grupo = dadosApp.senhas.find(s => s.id === idGrupo);
        const creds = [...(grupo?.credenciais || []), { usuario, senha, descricao: _val('acd'), criadoPor: window._userEmail || '', criadoEm: new Date().toISOString() }];
        await PROJ_REF().collection('senhas').doc(idGrupo).update({ credenciais: creds });
        await recarregar('Credencial adicionada ✓');
    });
}

function editarCredencial(idGrupo, idx) {
    const grupo = dadosApp.senhas.find(s => s.id === idGrupo);
    const cred = grupo?.credenciais?.[idx];
    if (!cred) return;
    abrirModalAdmin('Editar Credencial', [
        { label: 'Usuário',   id: 'acu', value: cred.usuario },
        { label: 'Senha',     id: 'acs', value: cred.senha },
        { label: 'Descrição', id: 'acd', value: cred.descricao }
    ], async () => {
        const usuario = _val('acu'), senha = _val('acs');
        if (!usuario || !senha) return mostrarNotificacao('Usuário e senha são obrigatórios');
        const creds = [...(grupo.credenciais || [])];
        creds[idx] = { ...creds[idx], usuario, senha, descricao: _val('acd') };
        await PROJ_REF().collection('senhas').doc(idGrupo).update({ credenciais: creds });
        await recarregar('Credencial atualizada ✓');
    });
}

async function deletarCredencial(idGrupo, idx) {
    if (!confirm('Mover credencial para a lixeira?')) return;
    const grupo = dadosApp.senhas.find(s => s.id === idGrupo);
    const cred = grupo?.credenciais?.[idx];
    if (!cred) return mostrarNotificacao('Credencial não encontrada — recarregue a página');
    const creds = [...(grupo?.credenciais || [])];
    creds.splice(idx, 1);
    await moverParaLixeira({
        nome: `${cred.usuario} (${grupo.nome})`,
        categoria: 'Credencial',
        restore: { tipo: 'arrayItem', colecao: 'senhas', parentId: idGrupo, campo: 'credenciais', dados: cred }
    });
    await PROJ_REF().collection('senhas').doc(idGrupo).update({ credenciais: creds });
    await recarregar('Credencial movida para a lixeira');
}

// ── CRUD OLTs ─────────────────────────────────────────────────
const FABRICANTES_OLT = ['TP-LINK','VSOL','UBIQUITI','HUAWEI','ZTE','FIBERHOME','Outro'];

function _camposOLT(item) {
    return [
        { label: 'Nome',          id: 'on',   value: item?.nome || '' },
        { label: 'Fabricante',    id: 'of',   type: 'select', value: item?.fabricante || 'TP-LINK', options: FABRICANTES_OLT },
        { label: 'URL de Acesso', id: 'ou',   value: item?.url || '' },
        { label: 'Usuário',       id: 'ouu',  value: item?.usuario || 'admin' },
        { label: 'Senha',         id: 'os',   value: item?.senha || '' },
        { label: 'Status',        id: 'ost',  type: 'select', value: item?.status || 'Ativo', options: ['Ativo','Inativo','Manutenção'] },
        { label: 'Localização',   id: 'ol',   value: item?.localizacao || '' },
        { label: 'VLANs',         id: 'ov',   value: item?.vlans || '', placeholder: 'Ex: PON1:334, PON2:335' }
    ];
}

function adicionarOLT() {
    abrirModalAdmin('Nova OLT', _camposOLT(null), async () => {
        const nome = _val('on');
        if (!nome) return mostrarNotificacao('Nome é obrigatório');
        await PROJ_REF().collection('olts').add({
            nome, fabricante: _val('of'), url: _val('ou'), usuario: _val('ouu'),
            senha: _val('os'), status: _val('ost'), localizacao: _val('ol'), vlans: _val('ov'),
            ordem: _proximaOrdem(dadosApp.olts),
            criadoPor: window._userEmail || '', criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
        await recarregar('OLT adicionada ✓');
    });
}

function editarOLT(id) {
    const item = dadosApp.olts.find(o => o.id === id);
    if (!item) return;
    abrirModalAdmin('Editar OLT', _camposOLT(item), async () => {
        const nome = _val('on');
        if (!nome) return mostrarNotificacao('Nome é obrigatório');
        await PROJ_REF().collection('olts').doc(id).update({
            nome, fabricante: _val('of'), url: _val('ou'), usuario: _val('ouu'),
            senha: _val('os'), status: _val('ost'), localizacao: _val('ol'), vlans: _val('ov')
        });
        await recarregar('OLT atualizada ✓');
    });
}

async function deletarOLT(id, nome) {
    if (!confirm(`Mover OLT "${nome}" para a lixeira?`)) return;
    const item = dadosApp.olts.find(o => o.id === id);
    await moverParaLixeira({ nome, categoria: 'OLT', restore: { tipo: 'doc', colecao: 'olts', docId: id, dados: item } });
    await PROJ_REF().collection('olts').doc(id).delete();
    await recarregar('OLT movida para a lixeira');
}

// ── CRUD VLANs ────────────────────────────────────────────────
function adicionarVLANLocal() {
    abrirModalAdmin('Nova Localização VLAN', [
        { label: 'Nome',  id: 'vln', value: '' },
        { label: 'Tipo',  id: 'vlt', type: 'select', value: 'TP-LINK', options: ['TP-LINK','UBIQUITI','VSOL','Outro'] }
    ], async () => {
        const nome = _val('vln');
        if (!nome) return mostrarNotificacao('Nome é obrigatório');
        await PROJ_REF().collection('vlans').add({ nome, tipo: _val('vlt'), pons: [], ordem: _proximaOrdem(dadosApp.vlans), criadoPor: window._userEmail || '', criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
        await recarregar('Localização criada ✓');
    });
}

function editarVLANLocal(id) {
    const item = dadosApp.vlans.find(v => v.id === id);
    if (!item) return;
    abrirModalAdmin('Editar Localização', [
        { label: 'Nome', id: 'vln', value: item.nome },
        { label: 'Tipo', id: 'vlt', type: 'select', value: item.tipo, options: ['TP-LINK','UBIQUITI','VSOL','Outro'] }
    ], async () => {
        const nome = _val('vln');
        if (!nome) return mostrarNotificacao('Nome é obrigatório');
        await PROJ_REF().collection('vlans').doc(id).update({ nome, tipo: _val('vlt') });
        await recarregar('Localização atualizada ✓');
    });
}

async function deletarVLANLocal(id, nome) {
    if (!confirm(`Mover localização "${nome}" para a lixeira?`)) return;
    const item = dadosApp.vlans.find(v => v.id === id);
    await moverParaLixeira({ nome, categoria: 'Localização VLAN', restore: { tipo: 'doc', colecao: 'vlans', docId: id, dados: item } });
    await PROJ_REF().collection('vlans').doc(id).delete();
    await recarregar('Localização movida para a lixeira');
}

function adicionarPON(idLocal) {
    abrirModalAdmin('Adicionar PON', [
        { label: 'Nome da PON', id: 'pn', value: '', placeholder: 'Ex: PON 1' },
        { label: 'VLAN',        id: 'pv', value: '', placeholder: 'Ex: 343' }
    ], async () => {
        const pon = _val('pn'), vlan = _val('pv');
        if (!pon || !vlan) return mostrarNotificacao('PON e VLAN são obrigatórios');
        const local = dadosApp.vlans.find(v => v.id === idLocal);
        const pons = [...(local?.pons || []), { pon, vlan, criadoPor: window._userEmail || '', criadoEm: new Date().toISOString() }];
        await PROJ_REF().collection('vlans').doc(idLocal).update({ pons });
        await recarregar('PON adicionada ✓');
    });
}

function editarPON(idLocal, idx) {
    const local = dadosApp.vlans.find(v => v.id === idLocal);
    const p = local?.pons?.[idx];
    if (!p) return;
    abrirModalAdmin('Editar PON', [
        { label: 'Nome da PON', id: 'pn', value: p.pon },
        { label: 'VLAN',        id: 'pv', value: p.vlan }
    ], async () => {
        const pon = _val('pn'), vlan = _val('pv');
        if (!pon || !vlan) return mostrarNotificacao('PON e VLAN são obrigatórios');
        const pons = [...(local.pons || [])];
        pons[idx] = { ...pons[idx], pon, vlan };
        await PROJ_REF().collection('vlans').doc(idLocal).update({ pons });
        await recarregar('PON atualizada ✓');
    });
}

async function deletarPON(idLocal, idx) {
    if (!confirm('Mover PON para a lixeira?')) return;
    const local = dadosApp.vlans.find(v => v.id === idLocal);
    const pon = local?.pons?.[idx];
    if (!pon) return mostrarNotificacao('PON não encontrada — recarregue a página');
    const pons = [...(local?.pons || [])];
    pons.splice(idx, 1);
    await moverParaLixeira({
        nome: `${pon.pon} - VLAN ${pon.vlan} (${local.nome})`,
        categoria: 'PON',
        restore: { tipo: 'arrayItem', colecao: 'vlans', parentId: idLocal, campo: 'pons', dados: pon }
    });
    await PROJ_REF().collection('vlans').doc(idLocal).update({ pons });
    await recarregar('PON movida para a lixeira');
}

// ── CRUD Presets ──────────────────────────────────────────────
function adicionarPresetFab() {
    abrirModalAdmin('Nova Seção de Preset', [
        { label: 'Nome da Seção', id: 'pfn', value: '' },
        { label: 'Chave (sem espaços)', id: 'pfk', value: '', placeholder: 'Ex: TP_LINK' }
    ], async () => {
        const nome = _val('pfn'), fabricanteKey = _val('pfk').replace(/\s+/g,'_').toUpperCase() || _val('pfn').replace(/\s+/g,'_').toUpperCase();
        if (!nome) return mostrarNotificacao('Nome é obrigatório');
        await PROJ_REF().collection('presets').add({ nome, fabricanteKey, roteadores: [], ordem: _proximaOrdem(dadosApp.presets), criadoPor: window._userEmail || '', criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
        await recarregar('Seção criada ✓');
    });
}

function editarPresetFab(id) {
    const item = dadosApp.presets.find(p => p.id === id);
    if (!item) return;
    abrirModalAdmin('Editar Seção', [
        { label: 'Nome da Seção', id: 'pfn', value: item.nome },
        { label: 'Chave',         id: 'pfk', value: item.fabricanteKey }
    ], async () => {
        const nome = _val('pfn');
        if (!nome) return mostrarNotificacao('Nome é obrigatório');
        await PROJ_REF().collection('presets').doc(id).update({ nome, fabricanteKey: _val('pfk') });
        await recarregar('Seção atualizada ✓');
    });
}

async function deletarPresetFab(id, nome) {
    if (!confirm(`Mover seção "${nome}" para a lixeira?`)) return;
    const item = dadosApp.presets.find(p => p.id === id);
    await moverParaLixeira({ nome, categoria: 'Seção Preset', restore: { tipo: 'doc', colecao: 'presets', docId: id, dados: item } });
    await PROJ_REF().collection('presets').doc(id).delete();
    await recarregar('Seção movida para a lixeira');
}

function adicionarPresetRot(idFab) {
    abrirModalAdmin('Novo Modelo', [
        { label: 'Modelo', id: 'prm', value: '' }
    ], async () => {
        const modelo = _val('prm');
        if (!modelo) return mostrarNotificacao('Modelo é obrigatório');
        const fab = dadosApp.presets.find(p => p.id === idFab);
        const roteadores = [...(fab?.roteadores || []), { modelo, arquivos: [], criadoPor: window._userEmail || '', criadoEm: new Date().toISOString() }];
        await PROJ_REF().collection('presets').doc(idFab).update({ roteadores });
        await recarregar('Modelo adicionado ✓');
    });
}

function editarPresetRot(idFab, rIdx) {
    const fab = dadosApp.presets.find(p => p.id === idFab);
    const rot = fab?.roteadores?.[rIdx];
    if (!rot) return;
    abrirModalAdmin('Editar Modelo', [
        { label: 'Modelo', id: 'prm', value: rot.modelo }
    ], async () => {
        const modelo = _val('prm');
        if (!modelo) return mostrarNotificacao('Modelo é obrigatório');
        const roteadores = [...(fab.roteadores || [])];
        roteadores[rIdx] = { ...rot, modelo };
        await PROJ_REF().collection('presets').doc(idFab).update({ roteadores });
        await recarregar('Modelo atualizado ✓');
    });
}

async function deletarPresetRot(idFab, rIdx) {
    if (!confirm('Mover modelo para a lixeira?')) return;
    const fab = dadosApp.presets.find(p => p.id === idFab);
    const rot = fab?.roteadores?.[rIdx];
    if (!rot) return mostrarNotificacao('Modelo não encontrado — recarregue a página');
    const roteadores = [...(fab?.roteadores || [])];
    roteadores.splice(rIdx, 1);
    await moverParaLixeira({
        nome: `${rot.modelo} (${fab.nome})`,
        categoria: 'Modelo Roteador',
        restore: { tipo: 'arrayItem', colecao: 'presets', parentId: idFab, campo: 'roteadores', dados: rot }
    });
    await PROJ_REF().collection('presets').doc(idFab).update({ roteadores });
    await recarregar('Modelo movido para a lixeira');
}

function adicionarPresetArq(idFab, rIdx) {
    _pendingFileBase64 = null;
    abrirModalAdmin('Novo Arquivo', [
        { label: 'Selecionar arquivo', id: '_fp', type: 'file-btn' },
        { label: 'Nome do Arquivo',    id: 'pan', value: '', placeholder: 'Ex: firmware.bin' },
        { label: 'Tipo',               id: 'pat', value: '', placeholder: 'Ex: Firmware, Config XML' },
        { label: 'Tamanho',            id: 'paz', value: '', placeholder: 'Ex: 7.2MB (auto ao selecionar)' },
        { label: 'Data Modificação',   id: 'pad', value: '', placeholder: 'Ex: 22/09/2025' }
    ], async () => {
        const nome = _val('pan');
        if (!nome) return mostrarNotificacao('Nome do arquivo é obrigatório');
        const fab = dadosApp.presets.find(p => p.id === idFab);
        const roteadores = [...(fab?.roteadores || [])];
        const novoArq = { nome, tipo: _val('pat'), tamanho: _val('paz'), dataModificacao: _val('pad'), criadoPor: window._userEmail || '', criadoEm: new Date().toISOString() };
        if (_pendingFileBase64) {
            Object.assign(novoArq, await _salvarBase64(_pendingFileBase64, _genChunkRef()));
        }
        roteadores[rIdx] = { ...roteadores[rIdx], arquivos: [...(roteadores[rIdx].arquivos || []), novoArq] };
        await PROJ_REF().collection('presets').doc(idFab).update({ roteadores });
        _pendingFileBase64 = null;
        await recarregar('Arquivo adicionado ✓');
    });
}

function editarPresetArq(idFab, rIdx, aIdx) {
    _pendingFileBase64 = null;
    const fab = dadosApp.presets.find(p => p.id === idFab);
    const arq = fab?.roteadores?.[rIdx]?.arquivos?.[aIdx];
    if (!arq) return;
    const temBase64 = !!(arq.base64 || arq.chunkRef);
    abrirModalAdmin('Editar Arquivo', [
        { label: `Substituir arquivo${temBase64 ? ' (já tem base64)' : ''}`, id: '_fp', type: 'file-btn' },
        { label: 'Nome do Arquivo',  id: 'pan', value: arq.nome },
        { label: 'Tipo',             id: 'pat', value: arq.tipo },
        { label: 'Tamanho',          id: 'paz', value: arq.tamanho },
        { label: 'Data Modificação', id: 'pad', value: arq.dataModificacao }
    ], async () => {
        const nome = _val('pan');
        if (!nome) return mostrarNotificacao('Nome do arquivo é obrigatório');
        const roteadores = [...(fab.roteadores || [])];
        const arquivos = [...(roteadores[rIdx].arquivos || [])];
        const atualizado = { nome, tipo: _val('pat'), tamanho: _val('paz'), dataModificacao: _val('pad') };
        if (_pendingFileBase64) {
            // Novo arquivo selecionado — apaga chunks antigos e salva novos
            if (arq.chunkRef) await _deletarChunks(arq.chunkRef, arq.chunkCount);
            Object.assign(atualizado, await _salvarBase64(_pendingFileBase64, _genChunkRef()));
        } else {
            // Mantém referência existente (inline ou chunks)
            if (arq.base64)    atualizado.base64 = arq.base64;
            if (arq.chunkRef)  { atualizado.chunkRef = arq.chunkRef; atualizado.chunkCount = arq.chunkCount; atualizado.mimePrefix = arq.mimePrefix; }
        }
        arquivos[aIdx] = atualizado;
        roteadores[rIdx] = { ...roteadores[rIdx], arquivos };
        await PROJ_REF().collection('presets').doc(idFab).update({ roteadores });
        _pendingFileBase64 = null;
        await recarregar('Arquivo atualizado ✓');
    });
}

async function deletarPresetArq(idFab, rIdx, aIdx) {
    if (!confirm('Mover arquivo para a lixeira?')) return;
    const fab = dadosApp.presets.find(p => p.id === idFab);
    const roteadores = [...(fab?.roteadores || [])];
    const arquivos = [...(roteadores[rIdx]?.arquivos || [])];
    const arq = arquivos[aIdx];
    arquivos.splice(aIdx, 1);
    roteadores[rIdx] = { ...roteadores[rIdx], arquivos };
    await moverParaLixeira({
        nome: `${arq.nome} — ${fab.roteadores[rIdx].modelo} (${fab.nome})`,
        categoria: 'Arquivo Preset',
        restore: { tipo: 'arrayItem', colecao: 'presets', parentId: idFab, campo: 'roteadores', subIdx: rIdx, subCampo: 'arquivos', dados: arq }
    });
    await PROJ_REF().collection('presets').doc(idFab).update({ roteadores });
    await recarregar('Arquivo movido para a lixeira');
}

// ── Info Arquivo (popup antes do download) ────────────────────
function verInfoArquivo(idFab, rIdx, aIdx) {
    const fab = dadosApp.presets.find(p => p.id === idFab);
    const arq = fab?.roteadores?.[rIdx]?.arquivos?.[aIdx];
    if (!arq) return;
    const fmtData = (iso) => { try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso || '—'; } };
    document.getElementById('arqInfoBody').innerHTML = [
        ['Arquivo',      arq.nome],
        ['Tipo',         arq.tipo || '—'],
        ['Tamanho',      arq.tamanho || '—'],
        ['Modificado em',arq.dataModificacao || '—'],
        ['Subido por',   arq.criadoPor || 'desconhecido'],
        ['Subido em',    arq.criadoEm ? fmtData(arq.criadoEm) : '—'],
        ['Modelo',       fab.roteadores[rIdx].modelo],
        ['Fabricante',   fab.nome],
    ].map(([l, v]) => `<div class="arq-info-row"><span class="arq-info-label">${escapeHTML(l)}</span><span class="arq-info-val">${escapeHTML(v)}</span></div>`).join('');
    document.getElementById('arqInfoDownloadBtn').onclick = () => {
        document.getElementById('arqInfoModal').style.display = 'none';
        downloadPreset(idFab, rIdx, aIdx);
    };
    document.getElementById('arqInfoModal').style.display = 'flex';
}

// ── Lixeira ──────────────────────────────────────────────────
let _lixeiraItems = [];

async function moverParaLixeira(entrada) {
    await LIXEIRA_REF().add({
        ...entrada,
        deletadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        deletadoPor: window._userEmail || ''
    });
}

async function abrirLixeira() {
    document.getElementById('lixeiraModal').style.display = 'flex';
    await carregarLixeira();
}

function fecharLixeira() {
    document.getElementById('lixeiraModal').style.display = 'none';
}

async function carregarLixeira() {
    const snap = await LIXEIRA_REF().orderBy('deletadoEm', 'desc').get();
    _lixeiraItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderizarLixeira();
}

function renderizarLixeira() {
    const container = document.getElementById('lixeiraContent');
    const visiveis = _lixeiraItems.filter(i => !i.restaurado || window._can.apagarPermanente);
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
                ${!restaurado && window._can.restaurar ? `<button class="adm-btn" onclick="restaurarItem('${item.id}')"><i class="fas fa-undo"></i> Restaurar</button>` : ''}
                ${window._can.apagarPermanente ? `<button class="adm-btn adm-del" onclick="deletarDefinitivo('${item.id}','${escaparAttr(item.nome)}')" title="Apagar permanentemente"><i class="fas fa-skull"></i></button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function restaurarItem(id) {
    const item = _lixeiraItems.find(i => i.id === id);
    if (!item) return;
    const r = item.restore;
    try {
        if (r.tipo === 'doc') {
            const { id: _id, ...dados } = r.dados;
            await PROJ_REF().collection(r.colecao).doc(r.docId).set(dados);
        } else {
            const snap = await PROJ_REF().collection(r.colecao).doc(r.parentId).get();
            if (!snap.exists) return mostrarNotificacao('Item pai não encontrado — restauração impossível');
            const doc = snap.data();
            if (r.subCampo) {
                const arr = [...(doc[r.campo] || [])];
                if (!arr[r.subIdx]) return mostrarNotificacao('Item pai não encontrado — restauração impossível');
                const sub = [...(arr[r.subIdx][r.subCampo] || []), r.dados];
                arr[r.subIdx] = { ...arr[r.subIdx], [r.subCampo]: sub };
                await PROJ_REF().collection(r.colecao).doc(r.parentId).update({ [r.campo]: arr });
            } else {
                await PROJ_REF().collection(r.colecao).doc(r.parentId).update({ [r.campo]: [...(doc[r.campo] || []), r.dados] });
            }
        }
        await LIXEIRA_REF().doc(id).update({ restaurado: true, restauradoEm: firebase.firestore.FieldValue.serverTimestamp() });
        mostrarNotificacao('Restaurado ✓');
        await carregarDados();
        gerarPaineis();
        await carregarLixeira();
    } catch (e) {
        mostrarNotificacao('Erro ao restaurar: ' + e.message);
    }
}

async function _limparChunksRecursivo(dados) {
    if (!dados) return;
    if (dados.chunkRef) await _deletarChunks(dados.chunkRef, dados.chunkCount);
    for (const rot of (dados.roteadores || [])) {
        for (const arq of (rot.arquivos || [])) {
            if (arq.chunkRef) await _deletarChunks(arq.chunkRef, arq.chunkCount);
        }
    }
    for (const arq of (dados.arquivos || [])) {
        if (arq.chunkRef) await _deletarChunks(arq.chunkRef, arq.chunkCount);
    }
}

async function deletarDefinitivo(id, nome) {
    if (!confirm(`Apagar "${nome}" PERMANENTEMENTE? Esta ação não pode ser desfeita.`)) return;
    const item = _lixeiraItems.find(i => i.id === id);
    if (item?.restore?.dados) await _limparChunksRecursivo(item.restore.dados);
    await LIXEIRA_REF().doc(id).delete();
    mostrarNotificacao('Apagado permanentemente');
    await carregarLixeira();
}


// ================================================================
// HISTÓRICO DE CHAMADOS — log de auditoria IMUTÁVEL de todas as aberturas.
//   Coleção top-level: chamados-historico/{id}
//   Rules: read/create = temProjeto('sistema-chamados'); update/delete
//   negados (nem admin edita/apaga). Clientes de ronda não enxergam.
//   Registro criado UMA vez ao chegar na etapa "Resultado".
// ================================================================
const HIST_COL = () => db.collection('chamados-historico');

let _histRegistros = [];

function _hEsc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _histFalhaTopo(f) {
    const M = 'DADOS HUBSOFT ────>';
    const p = (f || '').indexOf(M);
    return (p !== -1 ? (f || '').slice(0, p) : (f || '')).trim();
}
function _histData(ts) {
    if (!ts || !ts.toDate) return '—';
    const d = ts.toDate();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function _histRel(ts) {
    if (!ts || !ts.toDate) return '';
    const s = (Date.now() - ts.toDate().getTime()) / 1000;
    if (s < 60) return 'agora mesmo';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    if (s < 2592000) return `há ${Math.floor(s / 86400)} d`;
    return _histData(ts);
}
function _histIniciais(email) {
    const base = (email || '?').split('@')[0].replace(/[._-]+/g, ' ').trim();
    const p = base.split(' ').filter(Boolean);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

// Trava de duplicação POR SESSÃO (por chamado), não por cliente:
//   _histDocAtual  -> já registrado neste chamado (não grava de novo)
//   _histSalvando  -> gravação em andamento (barra clique-duplo / corrida)
// `novoChamadoHistorico()` (Novo/Limpar) libera para o próximo registro —
// então o MESMO cliente, num chamado futuro, gera um novo registro normal.
let _histDocAtual = null;
let _histSalvando = false;
function novoChamadoHistorico() { _histDocAtual = null; _histSalvando = false; }

// ── Salvar (ao chegar na etapa "Resultado") — grava UMA vez ───────
async function salvarHistoricoChamado() {
    if (_histDocAtual || _histSalvando) return; // já registrado (ou gravando) neste chamado
    _histSalvando = true;
    try {
        const g = id => (document.getElementById(id) && document.getElementById(id).value || '').trim();
        const reg = {
            codigo: g('codigo'), cliente: g('cliente'), ponto: g('ponto'), falha: g('falha'),
            telefone: g('telefone'), disponibilidade: g('disponibilidade'), responsavel: g('responsavel'),
            localCliente: g('localCliente'), protocolo: g('protocolo'), protocoloJames: g('protocoloJames'),
            instrucao: g('instrucao'),
            criadoPor: window._userEmail || '',
            criadoPorUid: (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.uid : '',
            criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (!reg.codigo && !reg.cliente && !reg.falha) { _histSalvando = false; return; } // não registra vazio
        const ref = await HIST_COL().add(reg);
        _histDocAtual = ref.id; // registrado — não grava de novo até "Novo"/Limpar
    } catch (e) {
        console.warn('Falha ao salvar histórico:', e.message);
    } finally {
        _histSalvando = false;
    }
}

// ── Carregar + render ─────────────────────────────────────────────
async function carregarHistorico(force) {
    const lista = document.getElementById('histLista');
    if (!lista) return;
    if (_histRegistros.length && !force) { _histRender(); return; }
    lista.innerHTML = '<div class="hist-empty"><i class="fas fa-spinner fa-spin"></i> Carregando…</div>';
    try {
        const snap = await HIST_COL().orderBy('criadoEm', 'desc').limit(300).get();
        _histRegistros = [];
        snap.forEach(d => _histRegistros.push({ id: d.id, ...d.data() }));
        _histRender();
    } catch (e) {
        lista.innerHTML = `<div class="hist-empty">Erro ao carregar: ${_hEsc(e.message)}</div>`;
    }
}

function _histRender() {
    const lista = document.getElementById('histLista');
    const count = document.getElementById('histCount');
    if (!lista) return;
    const q = (document.getElementById('histBusca') && document.getElementById('histBusca').value || '').toLowerCase().trim();
    const arr = _histRegistros.filter(r => !q ||
        [r.codigo, r.cliente, r.criadoPor, r.protocolo, r.protocoloJames].some(v => String(v || '').toLowerCase().includes(q)));

    if (count) count.textContent = `${arr.length} chamado${arr.length === 1 ? '' : 's'}`;

    if (!arr.length) {
        lista.innerHTML = `<div class="hist-empty">${_histRegistros.length ? 'Nenhum resultado para a busca.' : 'Nenhum chamado no histórico ainda.'}</div>`;
        return;
    }

    lista.innerHTML = arr.map(r => {
        const falha = _histFalhaTopo(r.falha) || '—';
        const ini = _histIniciais(r.criadoPor);
        const detId = 'histdet-' + r.id;
        const linha = (lbl, val) => val ? `<div class="hist-d"><span>${lbl}</span><b>${_hEsc(val)}</b></div>` : '';
        const bloco = (r.falha || '').includes('DADOS HUBSOFT ────>')
            ? `<pre class="hist-bloco">${_hEsc(r.falha.slice(r.falha.indexOf('DADOS HUBSOFT ────>')))}</pre>` : '';
        return `
        <article class="hist-card">
            <div class="hist-card-main" onclick="_histToggle('${r.id}')">
                <div class="hist-avatar" title="${_hEsc(r.criadoPor)}">${_hEsc(ini)}</div>
                <div class="hist-body">
                    <div class="hist-row1">
                        <span class="hist-cod">#${_hEsc(r.codigo || '—')}</span>
                        <span class="hist-cliente">${_hEsc(r.cliente || 'Sem nome')}</span>
                    </div>
                    <div class="hist-falha">${_hEsc(falha)}</div>
                    <div class="hist-tags">
                        <span class="hist-tag"><i class="fas fa-user"></i> ${_hEsc(r.criadoPor || '—')}</span>
                        <span class="hist-tag"><i class="fas fa-clock"></i> ${_hEsc(_histRel(r.criadoEm))}</span>
                        ${r.telefone ? `<span class="hist-tag"><i class="fas fa-phone"></i> ${_hEsc(r.telefone)}</span>` : ''}
                        ${r.protocolo ? `<span class="hist-tag"><i class="fas fa-file-alt"></i> ${_hEsc(r.protocolo)}</span>` : ''}
                    </div>
                </div>
                <i class="fas fa-chevron-down hist-chevron"></i>
            </div>
            <div class="hist-det" id="${detId}">
                <div class="hist-det-grid">
                    ${linha('Aberto em', _histData(r.criadoEm))}
                    ${linha('Ponto', r.ponto)}
                    ${linha('Disponibilidade', r.disponibilidade)}
                    ${linha('Recebe o técnico', r.responsavel)}
                    ${linha('Local', r.localCliente)}
                    ${linha('Protocolo James', r.protocoloJames)}
                    ${linha('Instrução', r.instrucao)}
                </div>
                ${bloco}
                <div class="hist-det-actions">
                    <button type="button" class="cw-mini" onclick="_histCopiar('${r.id}')"><i class="fas fa-copy"></i> Copiar chamado</button>
                    <span class="hist-lock"><i class="fas fa-lock"></i> registro permanente</span>
                </div>
            </div>
        </article>`;
    }).join('');
}

function _histToggle(id) {
    const el = document.getElementById('histdet-' + id);
    const card = el && el.closest('.hist-card');
    if (card) card.classList.toggle('open');
}

// Mesmo formato do chamado gerado (gerarChamadoCompleto), a partir do registro salvo.
function _histFormatarChamado(r) {
    return `🔴 Chamados 🔴

▪️ Código HubSoft: ${r.codigo || ''}
▪️ Cliente HubSoft: ${r.cliente || ''}
▪️ Ponto HubSoft: ${r.ponto || ''}

▪️ Falha: ${r.falha || ''}

▪️ Telefone: ${r.telefone || ''}
▪️ Disponibilidade: ${r.disponibilidade || ''}
▪️ Responsável pelo local: ${r.responsavel || ''}
▪️ Local: ${r.localCliente || ''}
▪️ Protocolo HubSoft: ${r.protocolo || ''}
▪️ Protocolo James: ${r.protocoloJames || ''}`;
}

function _histCopiar(id) {
    const r = _histRegistros.find(x => x.id === id);
    if (!r) return;
    navigator.clipboard.writeText(_histFormatarChamado(r)).then(() => {
        if (window.sistemaChamados && sistemaChamados.mostrarToast) sistemaChamados.mostrarToast('Chamado copiado.', 'success');
    });
}

// Ao limpar o formulário, o próximo "Resultado" vira um novo registro.
document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('limparBtn');
    if (b) b.addEventListener('click', novoChamadoHistorico);
});

window.salvarHistoricoChamado = salvarHistoricoChamado;
window.novoChamadoHistorico = novoChamadoHistorico;
window.carregarHistorico = carregarHistorico;
window._histRender = _histRender;
window._histToggle = _histToggle;
window._histCopiar = _histCopiar;

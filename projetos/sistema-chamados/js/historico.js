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
function novoChamadoHistorico() { _histDocAtual = null; window._histDocAtual = null; _histSalvando = false; }

// ── Salvar (ao chegar na etapa "Resultado") — grava UMA vez ───────
async function salvarHistoricoChamado() {
    if (_histDocAtual || _histSalvando) return; // já registrado (ou gravando) neste chamado
    _histSalvando = true;
    try {
        const g = id => (document.getElementById(id) && document.getElementById(id).value || '').trim();
        const resumoEl = document.getElementById('resumoContent');
        const resumoTxt = (resumoEl && !/Preencha|Clique em|Gerando/.test(resumoEl.textContent)) ? resumoEl.textContent.trim() : '';

        const reg = {
            codigo: g('codigo'), cliente: g('cliente'), ponto: g('ponto'), falha: g('falha'),
            telefone: g('telefone'), disponibilidade: g('disponibilidade'), responsavel: g('responsavel'),
            localCliente: g('localCliente'), protocolo: g('protocolo'), protocoloJames: g('protocoloJames'),
            instrucao: g('instrucao'),
            resumo: resumoTxt,
            publico: true, // habilita link público de visualização
            criadoPor: window._userEmail || '',
            criadoPorUid: (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.uid : '',
            criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (!reg.codigo && !reg.cliente && !reg.falha) { _histSalvando = false; return; } // não registra vazio
        
        // Gera o ID sincronamente para o link ficar disponível no mesmo instante
        const ref = HIST_COL().doc();
        _histDocAtual = ref.id; 
        window._histDocAtual = ref.id; // EXPÕE PARA O WIZARD
        
        await ref.set(reg);
    } catch (e) {
        console.warn('Falha ao salvar histórico:', e.message);
        _histDocAtual = null; // reverte em caso de falha
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
                ${r.resumo ? `<div class="hist-bloco" style="border-color:rgba(16,185,129,0.3); background:rgba(16,185,129,0.06); color:#e8eaf0;"><strong style="display:block; color:var(--success); font-size:0.72rem; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em;"><i class="fas fa-robot"></i> Resumo IA</strong>${_hEsc(r.resumo)}</div>` : ''}

                <div class="hist-comentarios-wrapper" style="margin:0 16px 16px; border-top:1px solid rgba(255,255,255,0.07); padding-top:16px;">
                    <strong style="font-size:0.8rem; color:#a8b4c7; display:flex; align-items:center; gap:6px; margin-bottom:10px;"><i class="fas fa-comments"></i> Atualizações e Comentários</strong>
                    <div id="hist-com-list-${r.id}" style="max-height:220px; overflow-y:auto; margin-bottom:12px; padding-right:4px;">
                        <div style="font-size:0.75rem; color:#8b95a8; text-align:center;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="hist-com-input-${r.id}" class="cw-input" placeholder="Adicionar comentário..." style="flex:1; padding:8px 12px; font-size:0.85rem; border-radius:8px;" onkeydown="if(event.key==='Enter') _histAddComentario('${r.id}')">
                        <button type="button" class="cw-btn" onclick="_histAddComentario('${r.id}')" style="padding:0 14px; border-radius:8px; font-size:0.85rem;"><i class="fas fa-paper-plane"></i></button>
                    </div>
                </div>

                <div class="hist-det-actions">
                    <button type="button" class="cw-mini" onclick="_histCopiar('${r.id}')"><i class="fas fa-copy"></i> Copiar chamado</button>
                    <button type="button" class="cw-mini" onclick="_histCopiarLink('${r.id}')"><i class="fas fa-link"></i> Copiar link</button>
                    <a  class="cw-mini" href="${_histLinkPublico(r.id)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none"><i class="fas fa-arrow-up-right-from-square"></i> Abrir link</a>
                    <span class="hist-lock"><i class="fas fa-lock"></i> registro permanente</span>
                </div>
            </div>
        </article>`;
    }).join('');
}

function _histToggle(id) {
    const el = document.getElementById('histdet-' + id);
    const card = el && el.closest('.hist-card');
    if (card) {
        const isOpening = !card.classList.contains('open');
        card.classList.toggle('open');
        if (isOpening) _histCarregarComentarios(id);
    }
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
    let link = '\n\n🔗 Tratativa: ' + _histLinkPublico(id);
    if (window._dicaLinkPublico) link += '\n💡 Dica: ' + window._dicaLinkPublico;
    navigator.clipboard.writeText(_histFormatarChamado(r) + link).then(() => {
        if (window.sistemaChamados && sistemaChamados.mostrarToast) sistemaChamados.mostrarToast('Chamado copiado.', 'success');
    });
}

// Gera a URL pública absoluta para um chamado do histórico
function _histLinkPublico(id) {
    const base = location.origin + location.pathname.replace(/\/[^/]*$/, ''); // pasta do projeto
    return base + '/chamado-publico.html?id=' + encodeURIComponent(id);
}

function _histCopiarLink(id) {
    let txt = _histLinkPublico(id);
    if (window._dicaLinkPublico) txt += '\n💡 Dica: ' + window._dicaLinkPublico;
    navigator.clipboard.writeText(txt).then(() => {
        if (window.sistemaChamados && sistemaChamados.mostrarToast) {
            sistemaChamados.mostrarToast('Link copiado! Compartilhe com quem for.', 'success');
        }
    });
}

// Monitora a config pública (senha/dica)
if (typeof db !== 'undefined') {
    db.collection('publico-config').doc('chamado-link').onSnapshot(snap => {
        if (snap.exists) {
            window._dicaLinkPublico = snap.data().dicaTexto || '';
            window._senhaLinkAtiva = !!snap.data().senhaHash;
        } else {
            window._dicaLinkPublico = '';
            window._senhaLinkAtiva = false;
        }
    });
}

// Ao limpar o formulário, o próximo "Resultado" vira um novo registro.
document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('limparBtn');
    if (b) b.addEventListener('click', novoChamadoHistorico);

    // Modal de senha do link público
    const closeBtn  = document.getElementById('closeSenhaModal');
    const cancelBtn = document.getElementById('cancelarSenhaBtn');
    if (closeBtn)  closeBtn.addEventListener('click',  () => { document.getElementById('senhaLinkModal').style.display = 'none'; });
    if (cancelBtn) cancelBtn.addEventListener('click', () => { document.getElementById('senhaLinkModal').style.display = 'none'; });

    // Modal de dica do link
    const closeDicaBtn  = document.getElementById('closeDicaModal');
    const cancelDicaBtn = document.getElementById('cancelarDicaBtn');
    if (closeDicaBtn)  closeDicaBtn.addEventListener('click',  () => { document.getElementById('dicaLinkModal').style.display = 'none'; });
    if (cancelDicaBtn) cancelDicaBtn.addEventListener('click', () => { document.getElementById('dicaLinkModal').style.display = 'none'; });
});

// ── Comentários (Histórico Interno) ───────────────────────────────
async function _histCarregarComentarios(docId) {
    const listEl = document.getElementById('hist-com-list-' + docId);
    if (!listEl) return;
    
    listEl.innerHTML = '<div style="font-size:0.75rem; color:#8b95a8; text-align:center;"><i class="fas fa-spinner fa-spin"></i> Carregando comentários...</div>';
    try {
        const snap = await HIST_COL().doc(docId).collection('comentarios').orderBy('criadoEm').get();
        if (snap.empty) {
            listEl.innerHTML = '<div style="font-size:0.8rem; color:#8b95a8; text-align:center;">Nenhum comentário adicionado.</div>';
            return;
        }
        
        let html = '';
        snap.forEach(doc => {
            const c = doc.data();
            html += `
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:8px; padding:10px 12px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:6px;">
                    <strong style="color:var(--primary-lt);"><i class="fas fa-user-circle"></i> ${_hEsc(c.criadoPor)}</strong>
                    <span style="color:#8b95a8;"><i class="far fa-clock"></i> ${_hEsc(_histRel(c.criadoEm))}</span>
                </div>
                <div style="font-size:0.85rem; color:#e8eaf0; white-space:pre-wrap; word-break:break-word; line-height:1.5;">${_hEsc(c.texto)}</div>
            </div>`;
        });
        listEl.innerHTML = html;
        listEl.scrollTop = listEl.scrollHeight;
    } catch(e) {
        listEl.innerHTML = '<div style="font-size:0.75rem; color:#ef4444; text-align:center;">Erro ao carregar.</div>';
    }
}

async function _histAddComentario(docId) {
    const inp = document.getElementById('hist-com-input-' + docId);
    if (!inp) return;
    const txt = inp.value.trim();
    if (!txt) return;
    
    inp.disabled = true;
    try {
        await HIST_COL().doc(docId).collection('comentarios').add({
            texto: txt,
            criadoPor: window._userEmail || (auth.currentUser ? auth.currentUser.email : 'Desconhecido'),
            criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
        inp.value = '';
        if (window.sistemaChamados && sistemaChamados.mostrarToast) sistemaChamados.mostrarToast('Comentário enviado!', 'success');
        _histCarregarComentarios(docId);
    } catch(e) {
        if (window.sistemaChamados && sistemaChamados.mostrarToast) sistemaChamados.mostrarToast('Erro ao comentar: ' + e.message, 'error');
    } finally {
        inp.disabled = false;
        inp.focus();
    }
}
window._histAddComentario = _histAddComentario;

window.salvarHistoricoChamado = salvarHistoricoChamado;
window.novoChamadoHistorico = novoChamadoHistorico;
window.carregarHistorico = carregarHistorico;
window._histRender = _histRender;
window._histToggle = _histToggle;
window._histCopiar = _histCopiar;
window._histCopiarLink = _histCopiarLink;
window._histLinkPublico = _histLinkPublico;
window._histAbrirSenhaModal = _histAbrirSenhaModal;
window._histSalvarSenha = _histSalvarSenha;

// ── Gerenciamento de senha do link público (só admin) ─────────
async function _sha256(str) {
    if (!str) return '';
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function _histAbrirSenhaModal() {
    const modal = document.getElementById('senhaLinkModal');
    if (!modal) return;
    document.getElementById('senhaLinkInput').value   = '';
    document.getElementById('senhaLinkConfirm').value = '';
    document.getElementById('senhaLinkStatus').textContent = '';
    document.getElementById('senhaLinkStatus').style.color = '';
    modal.style.display = 'flex';
}

async function _histSalvarSenha() {
    const s1 = (document.getElementById('senhaLinkInput').value   || '').trim();
    const s2 = (document.getElementById('senhaLinkConfirm').value || '').trim();
    const st = document.getElementById('senhaLinkStatus');
    const btn = document.getElementById('salvarSenhaBtn');

    if (s1 !== s2) {
        st.textContent = '⚠️ As senhas não coincidem.';
        st.style.color = '#ef4444';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando…';
    st.textContent = '';

    try {
        const hash = await _sha256(s1); // vazio = sem senha
        await db.collection('publico-config').doc('chamado-link').set({
            senhaHash: hash,
            atualizadoPor: window._userEmail || '',
            atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
        st.textContent = s1 ? '✅ Senha salva com sucesso!' : '✅ Proteção por senha removida.';
        st.style.color = '#10b981';
        setTimeout(() => { document.getElementById('senhaLinkModal').style.display = 'none'; }, 1500);
    } catch(e) {
        st.textContent = 'Erro ao salvar: ' + e.message;
        st.style.color = '#ef4444';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Salvar senha';
    }
}

// Revela os botões de configuração (senha e dica) para admins
function _histMostrarBotaoSenha() {
    const btn = document.getElementById('btnSenhaLink');
    if (btn) btn.style.display = 'inline-flex';
    const btnDica = document.getElementById('btnDicaLink');
    if (btnDica) btnDica.style.display = 'inline-flex';
}
window._histMostrarBotaoSenha = _histMostrarBotaoSenha;

// ── Gerenciamento de Dica do link público (só admin) ─────────
function _histAbrirDicaModal() {
    const modal = document.getElementById('dicaLinkModal');
    if (!modal) return;
    document.getElementById('dicaLinkInput').value = window._dicaLinkPublico || '';
    document.getElementById('dicaLinkStatus').textContent = '';
    document.getElementById('dicaLinkStatus').style.color = '';
    modal.style.display = 'flex';
}

async function _histSalvarDica() {
    const txt = (document.getElementById('dicaLinkInput').value || '').trim();
    const st = document.getElementById('dicaLinkStatus');
    const btn = document.getElementById('salvarDicaBtn');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando…';
    st.textContent = '';

    try {
        await db.collection('publico-config').doc('chamado-link').set({
            dicaTexto: txt
        }, { merge: true });
        st.textContent = txt ? '✅ Dica salva com sucesso!' : '✅ Dica removida.';
        st.style.color = '#10b981';
        setTimeout(() => { document.getElementById('dicaLinkModal').style.display = 'none'; }, 1500);
    } catch(e) {
        st.textContent = 'Erro ao salvar: ' + e.message;
        st.style.color = '#ef4444';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Salvar dica';
    }
}
window._histAbrirDicaModal = _histAbrirDicaModal;
window._histSalvarDica = _histSalvarDica;

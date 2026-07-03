// ============== SISTEMA DE SOLICITAÇÕES AUDICOM ==============
// Integrado com Firebase Firestore

// =================== VARIÁVEIS GLOBAIS ===================
let currentModalAction = null;
let currentSolicitacaoId = null;
let currentPedidoSolicitanteId = null;
let currentModalMode = 'action'; // 'action' | 'edit'
let allSolicitacoes = [];
let allPedidosUser = [];

function PROJ_COL() {
    return db.collection('projetos').doc('solicitacao-manutencoes').collection('solicitacoes');
}

// =================== INICIALIZAÇÃO ===================
document.addEventListener('DOMContentLoaded', function () {
    setupFormEvents();
    setupCPFMask();
    setupPriorityButtons();
});

// =================== NAVEGAÇÃO ENTRE SEÇÕES ===================
function showSection(sectionId) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');

    const target = document.getElementById(sectionId);
    if (!target) return;
    target.style.display = 'block';

    if (sectionId === 'admin-section') {
        if (window._can.painelAdm) {
            mostrarPainelAdmin();
            carregarSolicitacoesAdmin();
        } else {
            mostrarAcessoNegado();
        }
    }
}

// =================== CONFIGURAÇÃO DE EVENTOS ===================
function setupFormEvents() {
    const form = document.getElementById('form-cadastro');
    if (!form) return;
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        cadastrarPedido();
    });
    form.addEventListener('reset', function () {
        document.querySelectorAll('.priority-btn').forEach(btn => btn.classList.remove('active'));
    });
}

function setupCPFMask() {
    document.querySelectorAll('#cpf, #cpf-login').forEach(input => {
        input.addEventListener('input', function (e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);
            e.target.value = value;
        });
    });

    const cpfCadastro = document.getElementById('cpf');
    if (cpfCadastro) {
        cpfCadastro.addEventListener('blur', function () {
            const cpfVal = this.value.trim();
            if (cpfVal.length === 11) {
                verificarCpfLocal(cpfVal);
            } else if (cpfVal.length > 0) {
                mostrarStatusCpf(false, 'CPF deve ter 11 dígitos');
                this.dataset.cpfValido = 'false';
            }
        });
        cpfCadastro.addEventListener('input', function () {
            const statusEl = document.getElementById('cpf-status');
            if (statusEl && this.value.trim().length < 11) {
                statusEl.innerHTML = '';
                delete this.dataset.cpfValido;
            }
        });
    }
}

function setupPriorityButtons() {
    const buttons = document.querySelectorAll('.priority-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', function () {
            buttons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

// =================== INTEGRAÇÃO COM FIRESTORE ===================

async function criarSolicitacao(data) {
    try {
        const docRef = await PROJ_COL().add({
            ...data,
            status: 'pendente',
            dataHora: new Date().toISOString(),
            comentarioAdm: ''
        });
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('Erro ao criar solicitação:', error);
        return { success: false, message: 'Erro ao salvar solicitação' };
    }
}

async function buscarSolicitacoesPorCPF(cpf) {
    try {
        const snap = await PROJ_COL().where('cpf', '==', cpf).get();
        const data = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora));
        return { success: true, data };
    } catch (error) {
        console.error('Erro ao buscar por CPF:', error);
        return { success: false, message: 'Erro ao buscar solicitações', data: [] };
    }
}

async function buscarTodasSolicitacoes() {
    try {
        const snap = await PROJ_COL().orderBy('dataHora', 'desc').get();
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return { success: true, data };
    } catch (error) {
        console.error('Erro ao buscar todas:', error);
        return { success: false, message: 'Erro ao carregar solicitações' };
    }
}

async function atualizarSolicitacao(id, status, comentarioAdm) {
    try {
        await PROJ_COL().doc(id).update({ status, comentarioAdm });
        return { success: true };
    } catch (error) {
        console.error('Erro ao atualizar:', error);
        return { success: false, message: 'Erro ao atualizar solicitação' };
    }
}

// =================== CADASTRO DE PEDIDOS ===================
async function cadastrarPedido() {
    try {
        const mac = document.getElementById('mac').value.trim();
        const descricaoBase = document.getElementById('descricao').value.trim();
        const descricaoFinal = mac ? `${descricaoBase}\n\nMAC: ${mac}` : descricaoBase;

        const formData = {
            nome: document.getElementById('nome').value.trim(),
            cpf: document.getElementById('cpf').value.trim(),
            titulo: document.getElementById('titulo').value.trim(),
            descricao: descricaoFinal,
            prioridade: document.querySelector('.priority-btn.active')?.dataset.priority || '',
            destinatario: 'Weberts'
        };

        if (window._imagemBase64OS) {
            formData.imagemBase64 = window._imagemBase64OS;
        }

        if (!validarFormulario(formData)) return;

        showToast('info', 'Enviando solicitação...');

        const result = await criarSolicitacao(formData);

        if (result.success) {
            showToast('success', 'Solicitação cadastrada com sucesso!');
            document.getElementById('form-cadastro').reset();
            document.querySelectorAll('.priority-btn').forEach(btn => btn.classList.remove('active'));
            removerImagem();
        } else {
            showToast('error', result.message || 'Erro ao cadastrar solicitação. Tente novamente.');
        }
    } catch (error) {
        console.error('Erro ao cadastrar pedido:', error);
        showToast('error', 'Erro inesperado. Tente novamente.');
    }
}

function validarFormulario(data) {
    if (!data.nome) { showToast('warning', 'Nome é obrigatório'); return false; }
    if (!data.cpf) { showToast('warning', 'CPF é obrigatório'); return false; }
    if (data.cpf.length !== 11) { showToast('warning', 'CPF deve ter 11 dígitos'); return false; }
    if (!validarAlgoritmoCpf(data.cpf)) {
        showToast('warning', 'O CPF informado é inválido');
        const cpfInput = document.getElementById('cpf');
        if (cpfInput) {
            cpfInput.dataset.cpfValido = 'false';
            mostrarStatusCpf(false, 'Reprovado: O CPF informado é inválido');
        }
        return false;
    }
    if (!data.titulo) { showToast('warning', 'Título é obrigatório'); return false; }
    if (!data.descricao) { showToast('warning', 'Descrição é obrigatória'); return false; }
    if (!data.prioridade) { showToast('warning', 'Selecione uma prioridade'); return false; }
    return true;
}

// =================== BUSCA DE PEDIDOS ===================
async function buscarPedidos() {
    const cpf = document.getElementById('cpf-login').value.trim();

    if (!cpf) { showToast('warning', 'Digite seu CPF para buscar os pedidos'); return; }
    if (cpf.length !== 11) { showToast('warning', 'CPF deve ter 11 dígitos'); return; }

    try {
        showToast('info', 'Buscando suas solicitações...');

        const result = await buscarSolicitacoesPorCPF(cpf);

        const listaContainer = document.getElementById('pedidos-lista');
        const cardsContainer = document.getElementById('pedidos-cards');

        if (result.success && result.data.length === 0) {
            cardsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-inbox"></i>
                    <p>Nenhum pedido encontrado para este CPF.</p>
                </div>
            `;
        } else if (result.success) {
            allPedidosUser = result.data;
            cardsContainer.innerHTML = result.data.map(pedido => gerarCardPedido(pedido)).join('');
        } else {
            cardsContainer.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>${result.message}</p>
                </div>
            `;
        }

        listaContainer.style.display = 'block';
    } catch (error) {
        console.error('Erro ao buscar pedidos:', error);
        showToast('error', 'Erro ao buscar pedidos. Tente novamente.');
    }
}

function gerarCardPedido(pedido) {
    const id = pedido.id;
    const dataFormatada = new Date(pedido.dataHora).toLocaleString('pt-BR');
    const statusClass = `status-${pedido.status}`;
    const priorityClass = `priority-${pedido.prioridade}`;
    const statusLabelMap = { 'pendente': 'Em Andamento', 'realizado': 'Realizado', 'sem-solucao': 'Sem Solução', 'sem solucao': 'Sem Solução' };
    const statusLabel = statusLabelMap[pedido.status] || pedido.status;
    const descricaoFormatada = pedido.descricao.replace(/\n/g, '<br>');

    const imagemOsHTML = pedido.imagemBase64
        ? `<div class="os-image-block">
            <img src="${pedido.imagemBase64}" alt="Foto do equipamento" loading="lazy" onclick="abrirImagemFull('${pedido.imagemBase64}')">
            <div class="img-zoom-hint"><i class="fas fa-magnifying-glass-plus"></i></div>
           </div>`
        : '';

    let comentariosHTML = '';
    if (pedido.comentarioAdm && pedido.comentarioAdm.trim()) {
        const lista = parsearComentarios(pedido.comentarioAdm);
        comentariosHTML = lista.map((c) => {
            const isAdm = c.tipo === 'admin';
            const sepIdx = c.meta.lastIndexOf(' - ');
            const dataHora = sepIdx !== -1 ? c.meta.substring(0, sepIdx) : c.meta;
            const autorNome = sepIdx !== -1 ? c.meta.substring(sepIdx + 3) : '';
            const { textoHtml, imagemSrc } = extrairImagemDoCorpo(c.corpo);
            if (isAdm) {
                return `
                <div class="pedido-comment pedido-comment--admin">
                    <div class="pedido-comment-title">
                        <i class="fas fa-user-shield"></i>
                        <span class="pc-badge pc-badge--admin">Administrador</span>
                        ${autorNome ? `<strong>${autorNome}</strong>` : ''}
                        <span class="pc-date">${dataHora}</span>
                    </div>
                    ${textoHtml ? `<div class="pedido-comment-body">${textoHtml}</div>` : ''}
                    ${imagemSrc ? `<div class="comment-item__image" onclick="abrirImagemFull('${imagemSrc}')"><img src="${imagemSrc}" alt="Foto" loading="lazy"><div class="img-zoom-hint"><i class="fas fa-magnifying-glass-plus"></i></div></div>` : ''}
                </div>`;
            } else {
                return `
                <div class="pedido-comment pedido-comment--user">
                    <div class="pedido-comment-title">
                        <i class="fas fa-user"></i>
                        <span class="pc-badge pc-badge--user">Solicitante</span>
                        ${autorNome ? `<strong>${autorNome}</strong>` : ''}
                        <span class="pc-date">${dataHora}</span>
                    </div>
                    ${textoHtml ? `<div class="pedido-comment-body">${textoHtml}</div>` : ''}
                    ${imagemSrc ? `<div class="comment-item__image" onclick="abrirImagemFull('${imagemSrc}')"><img src="${imagemSrc}" alt="Foto" loading="lazy"><div class="img-zoom-hint"><i class="fas fa-magnifying-glass-plus"></i></div></div>` : ''}
                </div>`;
            }
        }).join('');
    }

    return `
        <div class="pedido-card">
            <div class="pedido-priority ${priorityClass}"></div>
            <div class="pedido-content">
                <div class="pedido-header">
                    <div>
                        <div class="pedido-titulo">${pedido.titulo}</div>
                        <div class="pedido-data">${dataFormatada}</div>
                    </div>
                    <div class="pedido-status ${statusClass}">${statusLabel}</div>
                </div>
                <div class="pedido-descricao">${descricaoFormatada}</div>
                ${imagemOsHTML}
                <div class="pedido-details">
                    <div><strong>Prioridade:</strong> ${pedido.prioridade}</div>
                </div>
                ${comentariosHTML ? `<div class="pedido-comments-list">${comentariosHTML}</div>` : ''}
                <div class="pedido-comment-action">
                    <button class="btn-user-comment" onclick="abrirModalComentarioSolicitante('${id}', '${escapeHtml(pedido.nome)}')">
                        <i class="fas fa-comment-medical"></i> Comentar
                    </button>
                </div>
            </div>
        </div>
    `;
}

// =================== ÁREA ADMINISTRATIVA ===================

function mostrarAcessoNegado() {
    const denied = document.getElementById('admin-denied');
    const panel = document.getElementById('admin-panel');
    if (denied) denied.style.display = 'block';
    if (panel) panel.style.display = 'none';
}

function mostrarPainelAdmin() {
    const denied = document.getElementById('admin-denied');
    const panel = document.getElementById('admin-panel');
    if (denied) denied.style.display = 'none';
    if (panel) panel.style.display = 'block';

    const nameEl = document.getElementById('admin-username-display');
    if (nameEl) nameEl.textContent = window._adminNome || 'Administrador';
}

function realizarLogoutAdmin() {
    showSection('cadastro-section');
}

// =================== PAINEL ADMIN ===================
async function carregarSolicitacoesAdmin() {
    const container = document.getElementById('admin-solicitacoes');
    container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando solicitações...</div>';

    try {
        const result = await buscarTodasSolicitacoes();
        if (result.success) {
            allSolicitacoes = result.data;
            renderizarSolicitacoesAdmin(allSolicitacoes);
        } else {
            container.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>${result.message}</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar solicitações:', error);
        container.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                Erro ao carregar solicitações. Tente novamente.
            </div>
        `;
    }
}

function renderizarSolicitacoesAdmin(solicitacoes) {
    const container = document.getElementById('admin-solicitacoes');

    if (solicitacoes.length === 0) {
        container.innerHTML = `
            <div class="no-results">
                <i class="fas fa-inbox"></i>
                <p>Nenhuma solicitação encontrada.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = solicitacoes.map(s => gerarCardAdmin(s)).join('');
}

// =================== GERAÇÃO DE PROTOCOLO ===================
function gerarProtocolo(dataHora) {
    const ts = new Date(dataHora).getTime();
    if (isNaN(ts)) return 'AUD-000000';
    const num = Math.abs(Number(BigInt(ts) % 900000n) + 100000);
    return 'AUD-' + String(num).padStart(6, '0');
}

function gerarCardAdmin(solicitacao) {
    const dataFormatada = new Date(solicitacao.dataHora).toLocaleString('pt-BR');
    const protocolo = gerarProtocolo(solicitacao.dataHora);
    const id = solicitacao.id;

    const statusMap = {
        'pendente': { label: 'Em Andamento', css: 'status-pendente' },
        'realizado': { label: 'Realizado', css: 'status-realizado' },
        'sem-solucao': { label: 'Sem Solução', css: 'status-sem-solucao' },
        'sem solucao': { label: 'Sem Solução', css: 'status-sem-solucao' }
    };
    const statusInfo = statusMap[solicitacao.status] || { label: solicitacao.status, css: `status-${solicitacao.status}` };
    const priorityClass = `priority-${solicitacao.prioridade}`;
    const descricaoFormatada = solicitacao.descricao.replace(/\n/g, '<br>');

    let actionsHTML = '';
    if (solicitacao.status === 'pendente') {
        actionsHTML = `
            <div class="admin-card-actions">
                <button class="btn-approve" onclick="abrirModalAcao('${id}', 'realizado')">
                    <i class="fas fa-check-double"></i> Realizado
                </button>
                <button class="btn-reject" onclick="abrirModalAcao('${id}', 'sem-solucao')">
                    <i class="fas fa-ban"></i> Sem Solução
                </button>
                <button class="btn-comment" onclick="abrirModalComentario('${id}')">
                    <i class="fas fa-comment-dots"></i> Comentar
                </button>
            </div>
        `;
    } else {
        actionsHTML = `
            <div class="admin-card-actions">
                <button class="btn-edit" onclick="abrirModalEdicao('${id}', '${solicitacao.status}')">
                    <i class="fas fa-pen"></i> Editar Status
                </button>
                <button class="btn-comment" onclick="abrirModalComentario('${id}')">
                    <i class="fas fa-comment-dots"></i> Comentar
                </button>
            </div>
        `;
    }

    let comentarioHTML = '';
    if (solicitacao.comentarioAdm && solicitacao.comentarioAdm.trim()) {
        const lista = parsearComentarios(solicitacao.comentarioAdm);
        const itens = lista.map((c) => {
            const isAdm = c.tipo === 'admin';
            const sepIdx = c.meta.lastIndexOf(' - ');
            const dataHora = sepIdx !== -1 ? c.meta.substring(0, sepIdx) : c.meta;
            const autorNome = sepIdx !== -1 ? c.meta.substring(sepIdx + 3) : '';
            const { textoHtml, imagemSrc } = extrairImagemDoCorpo(c.corpo);
            if (isAdm) {
                return `
                <div class="pedido-comment pedido-comment--admin">
                    <div class="pedido-comment-title">
                        <i class="fas fa-user-shield"></i>
                        <span class="pc-badge pc-badge--admin">Administrador</span>
                        ${autorNome ? `<strong>${autorNome}</strong>` : ''}
                        <span class="pc-date">${dataHora}</span>
                    </div>
                    ${textoHtml ? `<div class="pedido-comment-body">${textoHtml}</div>` : ''}
                    ${imagemSrc ? `<div class="comment-item__image" onclick="abrirImagemFull('${imagemSrc}')"><img src="${imagemSrc}" alt="Foto" loading="lazy"><div class="img-zoom-hint"><i class="fas fa-magnifying-glass-plus"></i></div></div>` : ''}
                </div>`;
            } else {
                return `
                <div class="pedido-comment pedido-comment--user">
                    <div class="pedido-comment-title">
                        <i class="fas fa-user"></i>
                        <span class="pc-badge pc-badge--user">Solicitante</span>
                        ${autorNome ? `<strong>${autorNome}</strong>` : ''}
                        <span class="pc-date">${dataHora}</span>
                    </div>
                    ${textoHtml ? `<div class="pedido-comment-body">${textoHtml}</div>` : ''}
                    ${imagemSrc ? `<div class="comment-item__image" onclick="abrirImagemFull('${imagemSrc}')"><img src="${imagemSrc}" alt="Foto" loading="lazy"><div class="img-zoom-hint"><i class="fas fa-magnifying-glass-plus"></i></div></div>` : ''}
                </div>`;
            }
        });
        comentarioHTML = itens.length ? `<div class="pedido-comments-list">${itens.join('')}</div>` : '';
    }

    const imagemOsAdminHTML = solicitacao.imagemBase64
        ? `<div class="os-image-block">
            <img src="${solicitacao.imagemBase64}" alt="Foto do equipamento" loading="lazy" onclick="abrirImagemFull('${solicitacao.imagemBase64}')">
            <div class="img-zoom-hint"><i class="fas fa-magnifying-glass-plus"></i></div>
           </div>`
        : '';

    return `
        <div class="admin-card">
            <div class="pedido-priority ${priorityClass}"></div>
            <div class="pedido-content">
                <div class="admin-card-header">
                    <div>
                        <div class="pedido-titulo">${solicitacao.titulo}</div>
                        <div class="pedido-data">${dataFormatada}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                        <div class="pedido-status ${statusInfo.css}">${statusInfo.label}</div>
                        <div class="os-protocolo" title="Protocolo da OS"><i class="fas fa-hashtag"></i>${protocolo}</div>
                    </div>
                </div>
                <div class="pedido-descricao">${descricaoFormatada}</div>
                ${imagemOsAdminHTML}
                <div class="pedido-details">
                    <div><strong>Solicitante:</strong> ${solicitacao.nome}</div>
                    <div><strong>CPF:</strong> ${formatarCPF(solicitacao.cpf)}</div>
                    <div><strong>Destinatário:</strong> ${solicitacao.destinatario || ''}</div>
                    <div><strong>Prioridade:</strong> ${solicitacao.prioridade}</div>
                </div>
                ${comentarioHTML}
                ${actionsHTML}
            </div>
        </div>
    `;
}

function filtrarSolicitacoes() {
    const filtroStatus = document.getElementById('filtro-status').value;
    const filtroPrioridade = document.getElementById('filtro-prioridade').value;
    const termoBusca = (document.getElementById('admin-busca')?.value || '').trim().toLowerCase();

    const clearBtn = document.getElementById('admin-busca-clear');
    if (clearBtn) clearBtn.style.display = termoBusca ? 'flex' : 'none';

    let filtradas = [...allSolicitacoes];

    if (filtroStatus) {
        filtradas = filtradas.filter(s => {
            const statusNorm = s.status === 'sem solucao' ? 'sem-solucao' : s.status;
            return statusNorm === filtroStatus;
        });
    }

    if (filtroPrioridade) {
        filtradas = filtradas.filter(s => s.prioridade === filtroPrioridade);
    }

    if (termoBusca) {
        filtradas = filtradas.filter(s => {
            const protocolo = gerarProtocolo(s.dataHora).toLowerCase();
            const campos = [
                s.nome || '', s.cpf || '', s.titulo || '', s.descricao || '',
                s.prioridade || '', s.status || '', s.destinatario || '',
                new Date(s.dataHora).toLocaleString('pt-BR'), protocolo
            ].join(' ').toLowerCase();
            return campos.includes(termoBusca);
        });
    }

    const container = document.getElementById('admin-solicitacoes');
    if (termoBusca && filtradas.length === 0) {
        container.innerHTML = `
            <div class="no-results">
                <i class="fas fa-magnifying-glass"></i>
                <p>Nenhuma OS encontrada para <strong>"${escapeHtml(termoBusca)}"</strong>.</p>
                <button class="btn btn--ghost btn--sm" style="margin-top:12px;" onclick="limparBusca()">
                    <i class="fas fa-rotate-left"></i> Limpar busca
                </button>
            </div>
        `;
        return;
    }

    renderizarSolicitacoesAdmin(filtradas);
}

function limparBusca() {
    const input = document.getElementById('admin-busca');
    if (input) input.value = '';
    const clearBtn = document.getElementById('admin-busca-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    filtrarSolicitacoes();
}

// =================== MODAL DE AÇÃO ADMINISTRATIVA ===================
function abrirModalAcao(solicitacaoId, acao) {
    currentSolicitacaoId = solicitacaoId;
    currentModalAction = acao;
    currentModalMode = 'action';

    const modal = document.getElementById('modal-admin');
    const title = document.getElementById('modal-title');
    const confirmBtn = document.getElementById('confirmar-acao');

    if (acao === 'realizado') {
        title.textContent = 'Marcar como Realizado';
        confirmBtn.textContent = 'Confirmar Realizado';
        confirmBtn.className = 'btn btn--primary';
        setModalHint('success', 'fas fa-circle-check', 'Marcar como Realizado', 'Esta solicitação será marcada como concluída com sucesso.');
    } else {
        title.textContent = 'Marcar Sem Solução';
        confirmBtn.textContent = 'Confirmar Sem Solução';
        confirmBtn.className = 'btn btn--primary';
        setModalHint('danger', 'fas fa-circle-xmark', 'Sem Solução', 'Esta solicitação será marcada como encerrada sem solução.');
    }

    modal.style.display = 'flex';
}

function abrirModalEdicao(solicitacaoId, statusAtual) {
    currentSolicitacaoId = solicitacaoId;
    currentModalMode = 'edit';
    currentModalAction = null;

    const modal = document.getElementById('modal-admin');
    const title = document.getElementById('modal-title');
    const confirmBtn = document.getElementById('confirmar-acao');
    const statusField = document.getElementById('modal-status-field');
    const statusSelect = document.getElementById('edit-status-select');

    title.textContent = 'Editar Status da Solicitação';
    confirmBtn.textContent = 'Salvar Alteração';
    confirmBtn.className = 'btn btn--primary';
    setModalHint('edit', 'fas fa-pen-to-square', 'Editar Status', 'Selecione o novo status desejado para esta solicitação.');

    statusField.style.display = 'block';
    statusSelect.value = statusAtual;

    modal.style.display = 'flex';
}

function abrirModalComentario(solicitacaoId) {
    currentSolicitacaoId = solicitacaoId;

    const modal = document.getElementById('modal-comentarios');
    const title = document.getElementById('modal-comentarios-title');

    const sol = allSolicitacoes.find(s => s.id === solicitacaoId);
    title.textContent = sol?.titulo ? `Comentar — ${sol.titulo}` : 'Adicionar Comentário';

    const nameEl = document.getElementById('compose-admin-name');
    if (nameEl) nameEl.textContent = window._adminNome || 'Administrador';

    document.getElementById('novo-comentario').value = '';

    modal.style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modal-admin').style.display = 'none';
    document.getElementById('modal-status-field').style.display = 'none';
    currentSolicitacaoId = null;
    currentModalAction = null;
    currentModalMode = 'action';
}

function fecharModalComentarios() {
    document.getElementById('modal-comentarios').style.display = 'none';
    document.getElementById('novo-comentario').value = '';
    removerImagemComentarioAdmin();
    currentSolicitacaoId = null;
}

function abrirModalComentarioSolicitante(pedidoId, nomeSolicitante) {
    currentPedidoSolicitanteId = pedidoId;

    const modal = document.getElementById('modal-solicitante-comentario');
    if (!modal) return;

    const pedido = allPedidosUser.find(p => p.id === pedidoId);
    const title = document.getElementById('modal-sol-title');
    if (title) title.textContent = pedido?.titulo ? `Comentar — ${pedido.titulo}` : 'Adicionar Comentário';

    document.getElementById('modal-sol-nome').textContent = nomeSolicitante || 'Solicitante';
    document.getElementById('novo-comentario-sol').value = '';
    modal.style.display = 'flex';
}

function fecharModalSolicitante() {
    document.getElementById('modal-solicitante-comentario').style.display = 'none';
    document.getElementById('novo-comentario-sol').value = '';
    removerImagemComentarioSol();
    currentPedidoSolicitanteId = null;
}

async function enviarComentarioSolicitante() {
    const texto = document.getElementById('novo-comentario-sol').value.trim();
    const temImagem = !!window._imagemBase64ComSol;
    if (!texto && !temImagem) { showToast('warning', 'Escreva um comentário ou adicione uma foto'); return; }
    if (!currentPedidoSolicitanteId) { showToast('error', 'Nenhuma solicitação selecionada'); return; }

    const pedido = allPedidosUser.find(p => p.id === currentPedidoSolicitanteId);
    const nomeSolicitante = pedido?.nome || 'Solicitante';

    const agora = new Date();
    const dia = String(agora.getDate()).padStart(2, '0');
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const ano = agora.getFullYear();
    const hora = String(agora.getHours()).padStart(2, '0');
    const min = String(agora.getMinutes()).padStart(2, '0');
    const dataFormatada = `${dia}/${mes}/${ano} ${hora}:${min}`;

    let corpoTexto = texto;
    if (temImagem) corpoTexto = (texto ? texto + '\n' : '') + `[IMAGEM:${window._imagemBase64ComSol}]`;

    const blocoNovo = `***SOLICITANTE ${dataFormatada} - ${nomeSolicitante}***\n${corpoTexto}`;
    const comentarioAtual = pedido?.comentarioAdm || '';
    const comentarioFinal = comentarioAtual ? comentarioAtual + '\n\n' + blocoNovo : blocoNovo;
    const statusAtual = pedido?.status || 'pendente';

    try {
        showToast('info', 'Enviando comentário...');
        const result = await atualizarSolicitacao(currentPedidoSolicitanteId, statusAtual, comentarioFinal);

        if (result.success) {
            showToast('success', 'Comentário adicionado!');
            if (pedido) pedido.comentarioAdm = comentarioFinal;
            fecharModalSolicitante();
            const container = document.getElementById('pedidos-cards');
            if (container) container.innerHTML = allPedidosUser.map(p => gerarCardPedido(p)).join('');
        } else {
            showToast('error', result.message || 'Erro ao enviar comentário');
        }
    } catch (error) {
        console.error('Erro ao enviar comentário do solicitante:', error);
        showToast('error', 'Erro inesperado. Tente novamente.');
    }
}

async function confirmarAcao() {
    try {
        const novoStatus = currentModalMode === 'edit'
            ? document.getElementById('edit-status-select').value
            : currentModalAction;

        const sol = allSolicitacoes.find(s => s.id === currentSolicitacaoId);
        const comentarioAtual = sol?.comentarioAdm || '';

        showToast('info', 'Atualizando status...');

        const result = await atualizarSolicitacao(currentSolicitacaoId, novoStatus, comentarioAtual);

        if (result.success) {
            showToast('success', 'Status atualizado com sucesso!');
            fecharModal();
            carregarSolicitacoesAdmin();
        } else {
            showToast('error', result.message || 'Erro ao atualizar solicitação. Tente novamente.');
        }
    } catch (error) {
        console.error('Erro ao confirmar ação:', error);
        showToast('error', 'Erro inesperado. Tente novamente.');
    }
}

function setModalHint(type, iconClass, label, desc) {
    const iconEl  = document.getElementById('modal-hint-icon');
    const labelEl = document.getElementById('modal-hint-label');
    const descEl  = document.getElementById('modal-hint-desc');
    const cardEl  = document.getElementById('modal-action-hint');
    if (!iconEl || !labelEl || !descEl || !cardEl) return;

    labelEl.textContent = label;
    descEl.textContent  = desc;
    iconEl.querySelector('i').className = iconClass;
    cardEl.classList.remove('hint--success', 'hint--danger', 'hint--edit');
    cardEl.classList.add(`hint--${type}`);
}

// =================== SISTEMA DE COMENTÁRIOS ===================
function parsearComentarios(comentarioAdm) {
    if (!comentarioAdm || !comentarioAdm.trim()) return [];
    const blocos = comentarioAdm.split(/(\*\*\*(COMENT[AÁá]RIO|SOLICITANTE) [^*]+\*\*\*)/);
    const comentarios = [];
    for (let i = 1; i < blocos.length; i += 3) {
        const cabecalho = blocos[i];
        const tipoRaw  = blocos[i + 1] || '';
        const corpo    = (blocos[i + 2] || '').trim();
        const tipo     = tipoRaw.toUpperCase().startsWith('SOLICITANTE') ? 'solicitante' : 'admin';
        const metaMatch = cabecalho.match(/\*\*\*(?:COMENT[AÁá]RIO|SOLICITANTE) (.+)\*\*\*/);
        const meta = metaMatch ? metaMatch[1] : '';
        comentarios.push({ cabecalho, tipo, meta, corpo });
    }
    return comentarios;
}

function extrairImagemDoCorpo(corpo) {
    const imgMatch = corpo.match(/\[IMAGEM:(data:image\/[^\]]+)\]/);
    if (!imgMatch) {
        return { textoHtml: escapeHtml(corpo).replace(/\n/g, '<br>'), imagemSrc: null };
    }
    const imagemSrc = imgMatch[1];
    const textoSemImg = corpo.replace(/\[IMAGEM:data:image\/[^\]]+\]/, '').trim();
    return {
        textoHtml: textoSemImg ? escapeHtml(textoSemImg).replace(/\n/g, '<br>') : '',
        imagemSrc
    };
}

async function enviarComentario() {
    const texto = document.getElementById('novo-comentario').value.trim();
    const temImagem = !!window._imagemBase64ComAdm;

    if (!texto && !temImagem) { showToast('warning', 'Escreva um comentário ou adicione uma foto'); return; }
    if (!currentSolicitacaoId) { showToast('error', 'Nenhuma solicitação selecionada'); return; }

    const agora = new Date();
    const dia = String(agora.getDate()).padStart(2, '0');
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const ano = agora.getFullYear();
    const hora = String(agora.getHours()).padStart(2, '0');
    const min = String(agora.getMinutes()).padStart(2, '0');
    const dataFormatada = `${dia}/${mes}/${ano} ${hora}:${min}`;

    const adminNome = window._adminNome || 'Administrador';

    let corpoTexto = texto;
    if (temImagem) corpoTexto = (texto ? texto + '\n' : '') + `[IMAGEM:${window._imagemBase64ComAdm}]`;

    const blocoNovo = `***COMENTÁRIO ${dataFormatada} - ${adminNome}***\n${corpoTexto}`;

    const sol = allSolicitacoes.find(s => s.id === currentSolicitacaoId);
    const comentarioAtual = sol?.comentarioAdm || '';
    const comentarioFinal = comentarioAtual ? comentarioAtual + '\n\n' + blocoNovo : blocoNovo;
    const statusAtual = sol?.status || 'pendente';

    try {
        showToast('info', 'Enviando comentário...');
        const result = await atualizarSolicitacao(currentSolicitacaoId, statusAtual, comentarioFinal);

        if (result.success) {
            document.getElementById('novo-comentario').value = '';
            removerImagemComentarioAdmin();
            showToast('success', 'Comentário adicionado!');
            if (sol) sol.comentarioAdm = comentarioFinal;
            carregarSolicitacoesAdmin();
            fecharModalComentarios();
        } else {
            showToast('error', result.message || 'Erro ao enviar comentário');
        }
    } catch (error) {
        console.error('Erro ao enviar comentário:', error);
        showToast('error', 'Erro inesperado. Tente novamente.');
    }
}

// =================== UTILITÁRIOS ===================
function formatarCPF(cpf) {
    return (cpf || '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(type, message) {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('.toast__icon');
    const messageElement = toast.querySelector('.toast__msg');

    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-circle-xmark',
        warning: 'fas fa-triangle-exclamation',
        info: 'fas fa-circle-info'
    };

    icon.className = `toast__icon fas ${(icons[type] || icons.info).split(' ')[1]}`;
    messageElement.textContent = message;

    toast.className = `toast ${type}`;
    toast.style.display = 'flex';

    setTimeout(() => { toast.style.display = 'none'; }, 5000);
}

// =================== EVENTOS GLOBAIS ===================
document.addEventListener('click', function (e) {
    const modalAdmin   = document.getElementById('modal-admin');
    const modalComents = document.getElementById('modal-comentarios');
    const modalSol     = document.getElementById('modal-solicitante-comentario');
    const modalExport  = document.getElementById('modal-exportar');
    if (e.target === modalAdmin)   fecharModal();
    if (e.target === modalComents) fecharModalComentarios();
    if (e.target === modalSol)     fecharModalSolicitante();
    if (e.target === modalExport)  fecharModalExportar();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        fecharModal();
        fecharModalComentarios();
        fecharModalSolicitante();
        fecharModalExportar();
        fecharImagemFull();
    }
});

// =================== EXPORTAÇÃO DE DADOS ===================
let exportRangeMode = 'all';

function abrirModalExportar() {
    exportRangeMode = 'all';
    document.querySelectorAll('.export-quick-btn').forEach(b => b.classList.remove('active'));
    const allBtn = document.querySelector('.export-quick-btn[data-range="all"]');
    if (allBtn) allBtn.classList.add('active');

    document.getElementById('export-date-range').style.display = 'none';
    document.getElementById('export-filtro-status').value = '';
    document.getElementById('export-filtro-prioridade').value = '';
    document.getElementById('export-data-de').value = '';
    document.getElementById('export-data-ate').value = '';

    atualizarPreviewExport();
    document.getElementById('modal-exportar').style.display = 'flex';
}

function fecharModalExportar() {
    document.getElementById('modal-exportar').style.display = 'none';
}

function aplicarFiltroRapido(btn, range) {
    exportRangeMode = range;
    document.querySelectorAll('.export-quick-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const rangeContainer = document.getElementById('export-date-range');
    if (range === 'custom') {
        rangeContainer.style.display = 'flex';
    } else {
        rangeContainer.style.display = 'none';
        document.getElementById('export-data-de').value = '';
        document.getElementById('export-data-ate').value = '';
    }

    atualizarPreviewExport();
}

function obterIntervaloExport() {
    const hoje = new Date();
    hoje.setHours(23, 59, 59, 999);
    let inicio = null;
    let fim = hoje;

    if (exportRangeMode === 'today') {
        inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    } else if (exportRangeMode === 'week') {
        inicio = new Date(); inicio.setDate(inicio.getDate() - 6); inicio.setHours(0, 0, 0, 0);
    } else if (exportRangeMode === 'month') {
        inicio = new Date(); inicio.setDate(inicio.getDate() - 29); inicio.setHours(0, 0, 0, 0);
    } else if (exportRangeMode === 'custom') {
        const deVal  = document.getElementById('export-data-de').value;
        const ateVal = document.getElementById('export-data-ate').value;
        if (deVal)  inicio = new Date(deVal + 'T00:00:00');
        if (ateVal) fim    = new Date(ateVal + 'T23:59:59');
    }

    return { inicio, fim };
}

function filtrarParaExport() {
    const { inicio, fim } = obterIntervaloExport();
    const filtroStatus = document.getElementById('export-filtro-status').value;
    const filtroPrioridade = document.getElementById('export-filtro-prioridade').value;

    return allSolicitacoes.filter(s => {
        const data = new Date(s.dataHora);
        if (inicio && data < inicio) return false;
        if (fim && data > fim) return false;
        if (filtroStatus) {
            const statusNorm = s.status === 'sem solucao' ? 'sem-solucao' : s.status;
            if (statusNorm !== filtroStatus) return false;
        }
        if (filtroPrioridade && s.prioridade !== filtroPrioridade) return false;
        return true;
    });
}

function atualizarPreviewExport() {
    const registros = filtrarParaExport();
    const countEl = document.getElementById('export-count');
    if (countEl) countEl.textContent = registros.length;

    const csvBtn = document.getElementById('btn-export-csv');
    const xlsBtn = document.getElementById('btn-export-excel');
    if (csvBtn) csvBtn.disabled = registros.length === 0;
    if (xlsBtn) xlsBtn.disabled = registros.length === 0;
}

function prepararDadosExport(registros) {
    const statusLabel = { pendente: 'Em Andamento', realizado: 'Realizado', 'sem solucao': 'Sem Solução', 'sem-solucao': 'Sem Solução' };
    const prioridadeLabel = { basico: 'Básico', medio: 'Médio', critico: 'Crítico' };

    return registros.map((s, i) => ({
        '#': i + 1,
        'Título': s.titulo || '',
        'Solicitante': s.nome || '',
        'CPF': formatarCPF(s.cpf || ''),
        'Data/Hora': s.dataHora ? new Date(s.dataHora).toLocaleString('pt-BR') : '',
        'Prioridade': prioridadeLabel[s.prioridade] || s.prioridade || '',
        'Status': statusLabel[s.status] || s.status || '',
        'Descrição': (s.descricao || '').replace(/\n/g, ' '),
        'Comentários': s.comentarioAdm
            ? parsearComentarios(s.comentarioAdm)
                .map(c => {
                    const tipo = c.tipo === 'admin' ? 'ADM' : 'SOLICITANTE';
                    return `[${tipo} ${c.meta}]: ${c.corpo.replace(/\n/g, ' ')}`;
                })
                .join(' | ')
            : ''
    }));
}

function exportarCSV() {
    const registros = filtrarParaExport();
    if (registros.length === 0) { showToast('warning', 'Nenhum registro para exportar'); return; }

    const dados = prepararDadosExport(registros);
    const cabecalho = Object.keys(dados[0]);

    const escaparCSV = (val) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };

    const linhas = [
        cabecalho.join(','),
        ...dados.map(row => cabecalho.map(col => escaparCSV(row[col])).join(','))
    ];

    const bom = '﻿';
    const blob = new Blob([bom + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manutencoes_${formatarDataArquivo()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('success', `${registros.length} registros exportados em CSV`);
    fecharModalExportar();
}

function exportarExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('error', 'Biblioteca de Excel não carregada. Tente recarregar a página.');
        return;
    }

    const registros = filtrarParaExport();
    if (registros.length === 0) { showToast('warning', 'Nenhum registro para exportar'); return; }

    const dados = prepararDadosExport(registros);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dados);

    ws['!cols'] = [
        { wch: 4 }, { wch: 36 }, { wch: 24 }, { wch: 16 },
        { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 50 }, { wch: 60 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Solicitações');
    XLSX.writeFile(wb, `manutencoes_${formatarDataArquivo()}.xlsx`);

    showToast('success', `${registros.length} registros exportados em Excel`);
    fecharModalExportar();
}

function formatarDataArquivo() {
    const d = new Date();
    const dd  = String(d.getDate()).padStart(2, '0');
    const mm  = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh  = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${min}`;
}

// =================== VERIFICAÇÃO DE CPF ===================
function mostrarStatusCpf(valido, mensagem) {
    const cpfInput = document.getElementById('cpf');
    if (!cpfInput) return;

    let statusEl = document.getElementById('cpf-status');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'cpf-status';
        statusEl.style.fontSize = '0.78rem';
        statusEl.style.marginTop = '6px';
        cpfInput.parentNode.appendChild(statusEl);
    }

    if (valido) {
        statusEl.innerHTML = '<i class="fas fa-check-circle"></i> ' + mensagem;
        statusEl.style.color = 'var(--green)';
    } else {
        statusEl.innerHTML = '<i class="fas fa-times-circle"></i> ' + mensagem;
        statusEl.style.color = 'var(--red)';
    }
}

function verificarCpfLocal(cpf) {
    const cpfInput = document.getElementById('cpf');
    if (validarAlgoritmoCpf(cpf)) {
        mostrarStatusCpf(true, 'Aprovado: CPF Válido');
        cpfInput.dataset.cpfValido = 'true';
    } else {
        mostrarStatusCpf(false, 'Reprovado: CPF Inválido');
        cpfInput.dataset.cpfValido = 'false';
    }
}

function validarAlgoritmoCpf(cpf) {
    if (cpf === '00000000000') return false;
    let sum = 0, rest;
    for (let i = 1; i <= 9; i++) sum += parseInt(cpf.substring(i - 1, i)) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(cpf.substring(9, 10))) return false;
    sum = 0;
    for (let i = 1; i <= 10; i++) sum += parseInt(cpf.substring(i - 1, i)) * (12 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(cpf.substring(10, 11))) return false;
    return true;
}

// =================== CORREÇÃO DE TEXTO COM IA ===================
async function corrigirTextoIA() {
    const tituloInput = document.getElementById('titulo');
    const descricaoInput = document.getElementById('descricao');
    const btnIa = document.getElementById('btn-corrigir-ia');

    const titulo = tituloInput.value.trim();
    const descricao = descricaoInput.value.trim();

    if (!titulo && !descricao) {
        showToast('warning', 'Preencha o título ou a descrição antes de corrigir');
        return;
    }

    if (!window.CHAT_API_CONFIG || !window.CHAT_API_CONFIG.url) {
        showToast('error', 'API de IA não configurada');
        return;
    }

    try {
        btnIa.disabled = true;
        btnIa.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Corrigindo...';
        showToast('info', 'Analisando texto com IA...');

        const systemPrompt = `Você é um assistente de correção ortográfica.
Sua tarefa é corrigir APENAS erros de gramática, pontuação e ortografia dos campos fornecidos, mantendo exatamente o mesmo sentido original.
Não adicione informações novas.
Responda EXCLUSIVAMENTE com um JSON válido com o seguinte formato:
{ "titulo": "titulo corrigido", "descricao": "descricao corrigida" }`;

        const userMessage = `Por favor, corrija o seguinte:\nTitulo: ${titulo}\nDescricao: ${descricao}`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ];

        const response = await fetch(window.CHAT_API_CONFIG.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': window.CHAT_API_CONFIG.apiKey
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: JSON.stringify({ messages }) }] }]
            })
        });

        if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);

        const data = await response.json();
        let respostaTexto = '';
        try {
            respostaTexto = data.candidates[0].content.parts[0].text;
        } catch (e) {
            if (typeof data?.output_text === 'string') respostaTexto = data.output_text;
            else throw new Error('Formato de resposta não reconhecido');
        }

        let cleanJsonText = respostaTexto.trim();
        if (cleanJsonText.startsWith('```json')) {
            cleanJsonText = cleanJsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (cleanJsonText.startsWith('```')) {
            cleanJsonText = cleanJsonText.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const jsonCorrigido = JSON.parse(cleanJsonText);
        if (jsonCorrigido.titulo) tituloInput.value = jsonCorrigido.titulo;
        if (jsonCorrigido.descricao) descricaoInput.value = jsonCorrigido.descricao;

        showToast('success', 'Texto corrigido com IA!');
    } catch (error) {
        console.error('Erro ao corrigir com IA:', error);
        showToast('error', 'Falha ao conectar com a IA. Verifique as configurações.');
    } finally {
        if (btnIa) {
            btnIa.disabled = false;
            btnIa.innerHTML = '<i class="fas fa-magic"></i> Corrigir Texto';
        }
    }
}

// =================== SUPORTE A IMAGENS ===================
window._imagemBase64OS     = null;
window._imagemBase64ComAdm = null;
window._imagemBase64ComSol = null;

function comprimirImagem(file, maxW = 800, maxH = 800, quality = 0.6) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxW || h > maxH) {
                    const ratio = Math.min(maxW / w, maxH / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const base64 = canvas.toDataURL('image/jpeg', quality);
                resolve({ base64, w, h, kb: Math.round(base64.length * 0.75 / 1024) });
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        showToast('info', 'Comprimindo imagem...');
        const { base64, w, h, kb } = await comprimirImagem(file);
        window._imagemBase64OS = base64;
        document.getElementById('imagem-preview-thumb').src = base64;
        document.getElementById('image-upload-placeholder').style.display = 'none';
        document.getElementById('image-upload-preview').style.display = 'flex';
        document.getElementById('image-upload-info').textContent = `${w}×${h}px · ${kb}KB`;
        showToast('success', `Imagem adicionada (${kb}KB)`);
    } catch (err) {
        showToast('error', 'Erro ao processar imagem');
        console.error(err);
    }
}

function removerImagem(event) {
    if (event) event.stopPropagation();
    window._imagemBase64OS = null;
    const input = document.getElementById('imagem-upload');
    if (input) input.value = '';
    const placeholder = document.getElementById('image-upload-placeholder');
    const preview = document.getElementById('image-upload-preview');
    if (placeholder) placeholder.style.display = 'flex';
    if (preview) preview.style.display = 'none';
}

async function handleImageComentarioAdmin(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        showToast('info', 'Comprimindo imagem...');
        const { base64, kb } = await comprimirImagem(file);
        window._imagemBase64ComAdm = base64;
        const thumb   = document.getElementById('compose-image-thumb');
        const preview = document.getElementById('compose-image-preview');
        if (thumb)   thumb.src = base64;
        if (preview) preview.style.display = 'flex';
        showToast('success', `Foto anexada (${kb}KB)`);
    } catch (err) {
        showToast('error', 'Erro ao processar imagem');
    }
}

function removerImagemComentarioAdmin() {
    window._imagemBase64ComAdm = null;
    const input = document.getElementById('comentario-imagem-input');
    if (input) input.value = '';
    const preview = document.getElementById('compose-image-preview');
    if (preview) preview.style.display = 'none';
}

async function handleImageComentarioSol(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        showToast('info', 'Comprimindo imagem...');
        const { base64, kb } = await comprimirImagem(file);
        window._imagemBase64ComSol = base64;
        const thumb   = document.getElementById('compose-image-thumb-sol');
        const preview = document.getElementById('compose-image-preview-sol');
        if (thumb)   thumb.src = base64;
        if (preview) preview.style.display = 'flex';
        showToast('success', `Foto anexada (${kb}KB)`);
    } catch (err) {
        showToast('error', 'Erro ao processar imagem');
    }
}

function removerImagemComentarioSol() {
    window._imagemBase64ComSol = null;
    const input = document.getElementById('comentario-imagem-sol-input');
    if (input) input.value = '';
    const preview = document.getElementById('compose-image-preview-sol');
    if (preview) preview.style.display = 'none';
}

function abrirImagemFull(src) {
    const modal = document.getElementById('modal-imagem-full');
    const img   = document.getElementById('modal-imagem-full-img');
    if (!modal || !img) return;
    img.src = src;
    modal.style.display = 'flex';
}

function fecharImagemFull() {
    const modal = document.getElementById('modal-imagem-full');
    if (modal) modal.style.display = 'none';
}


// Função de Associação de CPF
async function salvarAssociacaoCPF() {
    const cpf = document.getElementById('assoc-cpf').value.trim();
    if (!cpf || cpf.length < 11) {
        showToast('error', 'Informe um CPF válido (11 dígitos).');
        return;
    }
    
    const btn = document.getElementById('btn-salvar-assoc');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';

    try {
        await db.collection('users').doc(window._currentUser.uid).update({ cpf });

        window._userData.cpf = cpf;
        document.getElementById('cpf').value = cpf;
        document.getElementById('cpf-login').value = cpf;

        showToast('success', 'CPF associado com sucesso!');
    } catch (e) {
        console.error('Erro ao associar CPF:', e);
        showToast('error', 'Erro ao salvar associação.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Salvar Associação';
    }
}

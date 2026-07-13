// ================================================================
// INTEGRAÇÃO HUBSOFT — consulta de cliente (SOMENTE LEITURA)
//   Apenas 2 requisições são permitidas:
//     POST /oauth/token                    (autenticação OAuth2 password)
//     GET  /api/v1/integracao/cliente      (leitura de cliente)
//   NUNCA implementar POST/PUT/PATCH/DELETE em endpoint HubSoft.
//
//   Credenciais em hubsoft/credenciais (coleção protegida — só quem
//   tem sistema-chamados + permissão `hubsoftConsultar` lê).
//   A lupa só aparece se window._can.hubsoftConsultar.
//
//   UI: console/wizard em etapas (Localizar → Ponto → Selecionar),
//   controlado por `hsWizard`.
// ================================================================

const _HS_TTL = 25 * 24 * 3600 * 1000; // 25 dias
let _hubsoftToken = null;
let _hubsoftTokenTs = 0;

/* ─── helpers ──────────────────────────────────────────────── */
function _hsEscapeHTML(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _hsV(x) {
    if (x == null) return '';
    return String(x).trim();
}
function _hsFormatarTelefone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return String(raw || '');
}
function _hsBadgeClasse(prefixo) {
    if (prefixo === 'servico_habilitado') return 'on';
    if (prefixo && prefixo.indexOf('suspenso') === 0) return 'off';
    return 'off';
}
function _hsSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function _hsReduzMovimento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function _hsToast(msg, tipo) {
    if (window.sistemaChamados && typeof window.sistemaChamados.mostrarToast === 'function') {
        window.sistemaChamados.mostrarToast(msg, tipo || 'info');
    } else { console.log('[HubSoft]', msg); }
}

/* ─── Credenciais / Token ──────────────────────────────────── */
async function _hsCarregarCredenciais() {
    const snap = await db.collection('hubsoft').doc('credenciais').get();
    if (!snap.exists) return null;
    const c = snap.data();
    if (!c || !c.url) return null;
    return c;
}

async function _hsObterToken(cfg) {
    const raw = JSON.stringify({
        client_id: cfg.client_id, client_secret: cfg.client_secret,
        username: cfg.username, password: cfg.password, grant_type: 'password'
    });
    const falhou = r => (r.status === 401 || r.status === 400 || r.status === 415);

    // 1) sem Content-Type (padrão do exemplo oficial HubSoft)
    let r = await fetch(cfg.url + '/oauth/token', { method: 'POST', body: raw, redirect: 'follow' });
    // 2) application/json
    if (falhou(r)) {
        r = await fetch(cfg.url + '/oauth/token', {
            method: 'POST', body: raw, redirect: 'follow',
            headers: { 'Content-Type': 'application/json' }
        });
    }
    // 3) x-www-form-urlencoded
    if (falhou(r)) {
        r = await fetch(cfg.url + '/oauth/token', {
            method: 'POST', redirect: 'follow',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: cfg.client_id, client_secret: cfg.client_secret,
                username: cfg.username, password: cfg.password, grant_type: 'password'
            })
        });
    }
    if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const e = await r.json(); msg = e.msg || e.message || e.error || msg; } catch (_) {}
        throw new Error(msg);
    }
    const d = await r.json();
    if (!d.access_token) throw new Error(d.msg || d.message || d.error || 'Token não retornado pela API');
    return d.access_token;
}

/* ─── Mapeamento de campos ─────────────────────────────────── */
// target = id do input do formulário (mapeado) | null = vai p/ bloco na Instrução
const _HS_LABELS = {
    email: 'E-mail', status: 'Status', velocidade: 'Velocidade', conexao: 'Conexão',
    ultimoIp: 'Último IP', habilitacao: 'Habilitação', pop: 'POP de conexão',
    equipConexao: 'E. de conexão', interface: 'Interface', mac: 'MAC', login: 'Login',
    senha: 'Senha', dataVenda: 'Data de venda', coordenadas: 'Coordenadas', anotacoes: 'Anotações'
};

function _hsCampos(cliente, svc, total, codigo) {
    svc = svc || {};
    const endereco = (svc.endereco_instalacao && svc.endereco_instalacao.completo)
        || (cliente.endereco_instalacao && cliente.endereco_instalacao.completo) || '';
    const coord = (svc.endereco_instalacao && svc.endereco_instalacao.coordenadas)
        || (cliente.endereco_instalacao && cliente.endereco_instalacao.coordenadas) || null;
    const coordStr = (coord && coord.latitude != null && coord.longitude != null)
        ? `${coord.latitude}, ${coord.longitude}` : '';
    const conexao = (svc.ultima_conexao && (svc.ultima_conexao.status_txt_resumido
        || (svc.ultima_conexao.conectado ? 'CONECTADO' : 'DESCONECTADO'))) || '';
    const ultimoIp = (svc.ultima_conexao && svc.ultima_conexao.ultimo_ipv4) || '';
    const velocidade = [svc.velocidade_download, svc.velocidade_upload].filter(Boolean).join(' / ');
    const pontoNome = (total > 1 && svc.numero_plano != null) ? `(${svc.numero_plano}) ${svc.nome || ''}` : (svc.nome || '');
    const cpes = (svc.cpes || []).map(c => c && c.phy_addr).filter(Boolean);

    const campos = [
        { key: 'codigo',       label: 'Código',              valor: _hsV(codigo),                                        target: 'codigo' },
        { key: 'cliente',      label: 'Cliente',             valor: _hsV(cliente.nome_razaosocial || cliente.nome_fantasia), target: 'cliente' },
        { key: 'telefone',     label: 'Telefone',            valor: _hsFormatarTelefone(cliente.telefone_primario || cliente.telefone_secundario), target: 'telefone' },
        { key: 'ponto',        label: 'Ponto / Plano',       valor: _hsV(pontoNome),                                     target: 'ponto' },
        { key: 'localCliente', label: 'Endereço',            valor: _hsV(endereco),                                      target: 'localCliente' },
        { key: 'email',        label: 'E-mail',              valor: _hsV(cliente.email_principal),                       target: null },
        { key: 'status',       label: 'Status',              valor: _hsV(svc.status),                                    target: null },
        { key: 'velocidade',   label: 'Velocidade',          valor: _hsV(velocidade),                                    target: null },
        { key: 'conexao',      label: 'Conexão',             valor: _hsV(conexao),                                       target: null },
        { key: 'ultimoIp',     label: 'Último IP',           valor: _hsV(ultimoIp),                                      target: null },
        { key: 'habilitacao',  label: 'Habilitação',         valor: _hsV(svc.data_habilitacao_br),                       target: null },
        { key: 'pop',          label: 'POP de conexão',      valor: _hsV(svc.porta_atendimento && svc.porta_atendimento.nome), target: null },
        { key: 'equipConexao', label: 'E. de conexão',       valor: _hsV(svc.equipamento_conexao && svc.equipamento_conexao.nome), target: null },
        { key: 'interface',    label: 'Interface',           valor: _hsV(svc.interface && svc.interface.nome),           target: null },
        { key: 'mac',          label: 'MAC',                 valor: _hsV(svc.mac_addr),                                  target: null },
        { key: 'login',        label: 'Login',               valor: _hsV(svc.login),                                     target: null },
        { key: 'senha',        label: 'Senha',               valor: _hsV(svc.senha),                                     target: null },
        { key: 'dataVenda',    label: 'Data de venda',       valor: _hsV(svc.data_venda),                                target: null },
        { key: 'coordenadas',  label: 'Coordenadas',         valor: _hsV(coordStr),                                      target: null },
        { key: 'anotacoes',    label: 'Anotações',           valor: _hsV(svc.anotacoes),                                 target: null },
        { key: 'equipamentos', label: 'Equipamentos (CPEs)', valor: cpes.join(' , '),                                    target: null, lista: cpes }
    ];
    return campos.filter(c => c.valor && String(c.valor).length);
}

/* ─── Alertas ──────────────────────────────────────────────── */
const _HS_STATUS_ALERTAS = {
    suspenso_debito: 'Suspenso por Débito',
    suspenso_pedido_cliente: 'Suspenso a pedido do cliente',
    suspenso_parcialmente: 'Suspensão parcial',
    franquia_excedida: 'Franquia de dados excedida',
    aguardando_instalacao: 'Aguardando instalação',
    agendado_para_instalacao: 'Instalação agendada',
    aguardando_assinatura_contrato: 'Aguardando assinatura de contrato',
    aguardando_configuracao: 'Aguardando configuração',
    aguardando_liberacao_ti: 'Aguardando liberação TI',
    aguardando_migracao: 'Aguardando migração',
    inativo: 'Serviço inativo'
};
function _hsAlertas(cliente, svc) {
    const out = [];
    const pref = svc && svc.status_prefixo;
    if (pref && _HS_STATUS_ALERTAS[pref]) {
        out.push({ tipo: 'aviso', icon: 'fa-triangle-exclamation', texto: _HS_STATUS_ALERTAS[pref] });
    }
    const outrosSusp = (cliente.servicos || []).some(s => s !== svc && s.status_prefixo === 'suspenso_debito');
    if (outrosSusp) {
        out.push({ tipo: 'aviso', icon: 'fa-circle-exclamation', texto: 'Outro serviço deste cliente está suspenso por débito' });
    }
    const fim = svc && svc.data_fim_contrato;
    if (fim && /^\d{2}\/\d{2}\/\d{4}$/.test(fim)) {
        const [dd, mm, yyyy] = fim.split('/').map(Number);
        const dataFim = new Date(yyyy, mm - 1, dd);
        const diasRest = Math.floor((dataFim - new Date()) / (1000 * 60 * 60 * 24));
        if (diasRest < 0) out.push({ tipo: 'erro', icon: 'fa-file-circle-xmark', texto: `Contrato vencido em ${fim}` });
        else if (diasRest <= 30) out.push({ tipo: 'aviso', icon: 'fa-file-signature', texto: `Contrato vence em ${diasRest} dia(s) (${fim})` });
    }
    return out;
}

/* ════════════════════════════════════════════════════════════
   WIZARD — controlador de etapas
   ════════════════════════════════════════════════════════════ */
const _HS_STEP_META = {
    localizar:  { label: 'Localizar' },
    ponto:      { label: 'Ponto' },
    selecionar: { label: 'Selecionar' }
};

const hsWizard = {
    passos: ['localizar', 'selecionar'],
    atual: 0,
    buscando: false,
    codigo: '',
    cliente: null, svcs: [], svc: null, total: 0,
    campos: [], sel: {},
    logs: [],

    abrir(autoBuscar) {
        this.buscando = false;
        this.passos = ['localizar', 'selecionar'];
        this.atual = 0;
        this.cliente = null; this.svcs = []; this.svc = null; this.total = 0;
        this.campos = []; this.sel = {}; this.logs = [];
        this.codigo = (document.getElementById('codigo').value || '').trim();
        this._conn('idle', 'standby');
        this._render();
        document.getElementById('hs-wizard').classList.add('open');
        // já veio com código (atendente clicou "Consultar" na etapa 1): busca direto
        if (autoBuscar && this.codigo) { this.buscar(); return; }
        setTimeout(() => { const i = document.getElementById('hsw-codigo'); if (i) i.focus(); }, 60);
    },

    fechar() { document.getElementById('hs-wizard').classList.remove('open'); },

    _conn(estado, texto) {
        const el = document.getElementById('hsw-conn');
        if (!el) return;
        el.className = 'hsw-conn ' + estado;
        document.getElementById('hsw-conn-txt').textContent = texto;
    },

    _log(tipo, msg) {
        this.logs.push({ tipo, msg });
        this._renderConsole();
    },

    _renderConsole() {
        const body = document.getElementById('hsw-console-body');
        if (!body) return;
        if (!this.logs.length) {
            body.innerHTML = '<div class="hsw-console-empty">› aguardando consulta…</div>';
            return;
        }
        const arrow = { run: '›', ok: '✓', err: '✗' };
        body.innerHTML = this.logs.map((l, i) => {
            const ultimoRun = (i === this.logs.length - 1 && l.tipo === 'run');
            const caret = ultimoRun ? ' <span class="caret">▍</span>' : '';
            return `<div class="hsw-log ${l.tipo}"><span class="t">${arrow[l.tipo] || '›'}</span> <span class="m">${_hsEscapeHTML(l.msg)}${caret}</span></div>`;
        }).join('');
        body.scrollTop = body.scrollHeight;
    },

    voltar() {
        const nome = this.passos[this.atual];
        if (nome === 'selecionar') this._irNome(this.passos.includes('ponto') ? 'ponto' : 'localizar');
        else if (nome === 'ponto') this._irNome('localizar');
    },

    _irNome(nome) {
        const i = this.passos.indexOf(nome);
        if (i >= 0) { this.atual = i; this._render(); }
    },

    async buscar() {
        if (this.buscando) return;
        const inp = document.getElementById('hsw-codigo');
        this.codigo = (inp ? inp.value : this.codigo || '').trim();
        if (!this.codigo) { this._log('err', 'informe um código de cliente'); return; }

        this.buscando = true;
        this.logs = [];
        this._conn('busy', 'consultando');
        this._renderFooter();
        this._renderConsole();

        try {
            this._log('run', 'lendo credenciais');
            const cfg = await _hsCarregarCredenciais();
            if (!cfg) { this._log('err', 'api não configurada — fale com o admin'); this._conn('err', 'sem config'); return; }
            let host = cfg.url; try { host = new URL(cfg.url).host; } catch (_) {}
            this.logs.pop(); this._log('ok', 'credenciais ok · ' + host);

            if (!_hubsoftToken || Date.now() - _hubsoftTokenTs > _HS_TTL) {
                this._log('run', 'autenticando · oauth2 (grant password)');
                _hubsoftToken = await _hsObterToken(cfg);
                _hubsoftTokenTs = Date.now();
                this.logs.pop(); this._log('ok', 'token ativo');
            } else {
                this._log('ok', 'token em cache');
            }

            const params = new URLSearchParams({
                busca: 'codigo_cliente', termo_busca: this.codigo, cancelado: 'nao',
                ultima_conexao: 'sim',
                relacoes: 'endereco_instalacao,equipamento_conexao,interface,cpes,porta_atendimento'
            });
            this._log('run', 'GET /cliente · código ' + this.codigo);
            let r = await fetch(cfg.url + '/api/v1/integracao/cliente?' + params, {
                method: 'GET', headers: { 'Authorization': 'Bearer ' + _hubsoftToken }
            });
            if (r.status === 401) {
                this.logs.pop(); this._log('run', 'token expirado · renovando');
                _hubsoftToken = await _hsObterToken(cfg);
                _hubsoftTokenTs = Date.now();
                this.logs.pop(); this._log('run', 'GET /cliente · código ' + this.codigo);
                r = await fetch(cfg.url + '/api/v1/integracao/cliente?' + params, {
                    method: 'GET', headers: { 'Authorization': 'Bearer ' + _hubsoftToken }
                });
            }
            if (!r.ok) throw new Error('HTTP ' + r.status);

            const data = await r.json();
            if (data.status !== 'success') throw new Error(data.msg || 'erro na api');
            if (!data.clientes || !data.clientes.length) {
                this.logs.pop(); this._log('err', 'nenhum cliente para o código ' + this.codigo);
                this._conn('err', 'vazio');
                return;
            }

            const cliente = data.clientes[0];
            const ativos = (cliente.servicos || []).filter(s => s.status_prefixo !== 'cancelado');
            const svcs = ativos.length ? ativos : (cliente.servicos || []);
            this.logs.pop();
            const nome = cliente.nome_razaosocial || cliente.nome_fantasia || 'cliente';
            this._log('ok', `${nome} · ${svcs.length} serviço(s)`);
            this._conn('ok', 'online');

            this.cliente = cliente;
            this.svcs = svcs;

            if (!_hsReduzMovimento()) await _hsSleep(420);

            if (svcs.length > 1) {
                this.passos = ['localizar', 'ponto', 'selecionar'];
                this.total = svcs.length;
                this._irNome('ponto');
            } else {
                this.passos = ['localizar', 'selecionar'];
                this.svc = svcs[0] || {};
                this.total = svcs.length;
                this._prepararSelecao();
                this._irNome('selecionar');
            }
        } catch (err) {
            console.error('Erro HubSoft:', err);
            const last = this.logs[this.logs.length - 1];
            if (last && last.tipo === 'run') this.logs.pop();
            this._log('err', 'falha: ' + (err.message || err));
            this._conn('err', 'falha');
        } finally {
            this.buscando = false;
            this._renderFooter();
        }
    },

    escolherPonto(i) {
        this.svc = this.svcs[i] || {};
        this._prepararSelecao();
        this._irNome('selecionar');
    },

    _prepararSelecao() {
        this.campos = _hsCampos(this.cliente, this.svc, this.total, this.codigo);
        this.sel = {};
        // padrão: campos do formulário marcados; extras (nota) desmarcados
        this.campos.forEach(c => { this.sel[c.key] = !!c.target; });
    },

    toggleCampo(key) {
        this.sel[key] = !this.sel[key];
        const el = document.querySelector(`.hsw-field[data-key="${key}"]`);
        if (el) el.classList.toggle('sel', this.sel[key]);
        this._atualizarContador();
    },

    marcarGrupo(grupo, valor) {
        this.campos.forEach(c => {
            const g = c.target ? 'form' : 'nota';
            if (g === grupo) this.sel[c.key] = valor;
        });
        this._renderPane(); this._renderFooter();
    },

    _atualizarContador() {
        const el = document.getElementById('hsw-count');
        if (!el) return;
        let nf = 0, nn = 0;
        this.campos.forEach(c => { if (this.sel[c.key]) { c.target ? nf++ : nn++; } });
        el.innerHTML = `<b>${nf}</b> no formulário · <b>${nn}</b> na nota`;
    },

    aplicar() {
        // Limpa TODOS os campos antes de aplicar o novo cliente — evita mistura
        const camposForm = ['codigo','cliente','ponto','falha','telefone',
                            'disponibilidade','responsavel','localCliente',
                            'protocolo','protocoloJames','instrucao'];
        camposForm.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('field-error', 'field-popped'); }
        });
        // Limpa também o textarea do James e reseta o registro do histórico
        const jamesEl = document.getElementById('jamesData');
        if (jamesEl) jamesEl.value = '';
        if (typeof novoChamadoHistorico === 'function') novoChamadoHistorico();

        // Aplica os campos do HubSoft selecionados
        const marcadoBloco = [];
        let cpesLista = null, nCampos = 0;
        this.campos.forEach(c => {
            if (!this.sel[c.key]) return;
            if (c.target) {
                const el = document.getElementById(c.target);
                if (el) { el.value = c.valor; _hsPop(el); nCampos++; }
            } else if (c.key === 'equipamentos' && c.lista) {
                cpesLista = c.lista;
            } else {
                marcadoBloco.push(`${_HS_LABELS[c.key] || c.key}: ${c.valor}`);
            }
        });
        if (cpesLista && cpesLista.length) {
            marcadoBloco.push('Equipamentos (preencher modelo):');
            cpesLista.forEach(m => marcadoBloco.push(`  - MAC ${m} → `));
        }
        if (marcadoBloco.length) { _hsInjetarBloco(marcadoBloco.join('\n')); nCampos++; }

        if (window.sistemaChamados && typeof window.sistemaChamados.atualizarResumo === 'function') {
            window.sistemaChamados.atualizarResumo();
        }
        _hsToast(`✓ ${nCampos} item(ns) aplicado(s) ao chamado.`, 'success');
        this.fechar();
        // vai para a etapa James: a IA complementa (só campos vazios) o que
        // veio do HubSoft com o que o atendente colar do chat.
        if (window.chamadoWizard) chamadoWizard.ir('james');
    },

    /* ── render ── */
    _render() { this._renderStepper(); this._renderPane(); this._renderFooter(); },

    _renderStepper() {
        const box = document.getElementById('hsw-stepper');
        if (!box) return;
        box.innerHTML = this.passos.map((nome, i) => {
            const estado = i < this.atual ? 'done' : (i === this.atual ? 'active' : '');
            const node = i < this.atual ? '<i class="fas fa-check"></i>' : (i + 1);
            const step = `<div class="hsw-step ${estado}">
                <div class="hsw-step-node">${node}</div>
                <div class="hsw-step-label">${_HS_STEP_META[nome].label}</div>
            </div>`;
            const link = (i < this.passos.length - 1) ? '<div class="hsw-step-link"></div>' : '';
            return step + link;
        }).join('');
    },

    _renderPane() {
        const body = document.getElementById('hsw-body');
        if (!body) return;
        const nome = this.passos[this.atual];
        if (nome === 'localizar') body.innerHTML = this._paneLocalizar();
        else if (nome === 'ponto') body.innerHTML = this._panePonto();
        else if (nome === 'selecionar') body.innerHTML = this._paneSelecionar();
        if (nome === 'localizar') { this._renderConsole(); const i = document.getElementById('hsw-codigo'); if (i) setTimeout(() => i.focus(), 40); }
    },

    _paneLocalizar() {
        return `<div class="hsw-pane">
            <div class="hsw-eyebrow">etapa 01 · localizar</div>
            <div class="hsw-h">Consultar cliente</div>
            <div class="hsw-sub">Digite o código do cliente no HubSoft. A consulta é <strong>somente leitura</strong>.</div>
            <div class="hsw-search">
                <div class="hsw-search-field">
                    <i class="fas fa-hashtag"></i>
                    <input id="hsw-codigo" type="text" inputmode="numeric" autocomplete="off"
                        placeholder="ex.: 4194" value="${_hsEscapeHTML(this.codigo)}"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();hsWizard.buscar();}">
                </div>
            </div>
            <div class="hsw-console">
                <div class="hsw-console-bar"><span></span><span></span><span></span></div>
                <div id="hsw-console-body"></div>
            </div>
        </div>`;
    },

    _panePonto() {
        const cli = this.cliente || {};
        const itens = this.svcs.map((svc, i) => {
            const numero = (svc.numero_plano != null) ? `(${_hsEscapeHTML(svc.numero_plano)}) ` : '';
            const on = svc.ultima_conexao && svc.ultima_conexao.conectado;
            const end = (svc.endereco_instalacao && svc.endereco_instalacao.completo)
                || (cli.endereco_instalacao && cli.endereco_instalacao.completo) || 'endereço não disponível';
            return `<button type="button" class="hsw-ponto" onclick="hsWizard.escolherPonto(${i})">
                <span class="hsw-dot ${on ? 'on' : 'off'}"></span>
                <span class="hsw-ponto-info">
                    <span class="hsw-ponto-nome">${numero}${_hsEscapeHTML(svc.nome || ('Serviço ' + (i + 1)))}</span>
                    <span class="hsw-ponto-end">${_hsEscapeHTML(end)}</span>
                </span>
                <i class="fas fa-chevron-right"></i>
            </button>`;
        }).join('');
        return `<div class="hsw-pane">
            <div class="hsw-eyebrow">etapa 02 · ponto</div>
            <div class="hsw-h">Selecione o ponto</div>
            <div class="hsw-sub">${_hsEscapeHTML(cli.nome_razaosocial || cli.nome_fantasia || 'Cliente')} possui ${this.svcs.length} serviços ativos.</div>
            <div class="hsw-pontos">${itens}</div>
        </div>`;
    },

    _paneSelecionar() {
        const alertas = _hsAlertas(this.cliente, this.svc);
        const alertasHTML = alertas.length ? `<div class="hsw-alertas">${alertas.map(a =>
            `<div class="hsw-alerta ${a.tipo}"><i class="fas ${a.icon}"></i> ${_hsEscapeHTML(a.texto)}</div>`).join('')}</div>` : '';

        const form = this.campos.filter(c => c.target);
        const nota = this.campos.filter(c => !c.target);
        const etapaN = this.passos.includes('ponto') ? '03' : '02';

        const grupo = (titulo, arr, grupoKey) => {
            if (!arr.length) return '';
            const rows = arr.map(c => `
                <label class="hsw-field ${this.sel[c.key] ? 'sel' : ''}" data-key="${_hsEscapeHTML(c.key)}"
                    onclick="event.preventDefault();hsWizard.toggleCampo('${_hsEscapeHTML(c.key)}')">
                    <span class="hsw-check"><i class="fas fa-check"></i></span>
                    <span class="hsw-field-body">
                        <span class="hsw-field-label">${_hsEscapeHTML(c.label)}</span>
                        <span class="hsw-field-val">${_hsEscapeHTML(c.valor)}</span>
                    </span>
                </label>`).join('');
            return `<div class="hsw-grupo">
                <div class="hsw-grupo-head">
                    <span class="tag">${titulo}</span>
                    <span class="rule"></span>
                    <span class="chip" onclick="hsWizard.marcarGrupo('${grupoKey}', true)" style="cursor:pointer">todos</span>
                    <span class="chip" onclick="hsWizard.marcarGrupo('${grupoKey}', false)" style="cursor:pointer">nenhum</span>
                </div>
                <div class="hsw-fields">${rows}</div>
            </div>`;
        };

        return `<div class="hsw-pane">
            <div class="hsw-eyebrow">etapa ${etapaN} · selecionar</div>
            <div class="hsw-h">O que entra no chamado?</div>
            <div class="hsw-sub">Itens marcados como <strong>formulário</strong> preenchem os campos; os de <strong>nota</strong> viram um bloco anexado à Instrução.</div>
            ${alertasHTML}
            ${grupo('campos do formulário', form, 'form')}
            ${grupo('anexar à nota (instrução)', nota, 'nota')}
            ${(!form.length && !nota.length) ? '<div class="hsw-empty">Nenhum dado retornado para este serviço.</div>' : ''}
        </div>`;
    },

    _renderFooter() {
        const foot = document.getElementById('hsw-footer');
        if (!foot) return;
        const nome = this.passos[this.atual];
        if (nome === 'localizar') {
            const dis = this.buscando ? 'disabled' : '';
            const lbl = this.buscando
                ? '<i class="fas fa-spinner fa-spin"></i> Consultando'
                : 'Consultar <i class="fas fa-arrow-right"></i>';
            foot.innerHTML = `
                <button class="hsw-btn ghost" onclick="hsWizard.fechar()">Cancelar</button>
                <span class="hsw-spacer"></span>
                <button class="hsw-btn primary" onclick="hsWizard.buscar()" ${dis}>${lbl}</button>`;
        } else if (nome === 'ponto') {
            foot.innerHTML = `
                <button class="hsw-btn ghost" onclick="hsWizard.voltar()"><i class="fas fa-arrow-left"></i> Voltar</button>
                <span class="hsw-spacer"></span>
                <span class="hsw-count">selecione um ponto acima</span>`;
        } else {
            let nf = 0, nn = 0;
            this.campos.forEach(c => { if (this.sel[c.key]) { c.target ? nf++ : nn++; } });
            foot.innerHTML = `
                <button class="hsw-btn ghost" onclick="hsWizard.voltar()"><i class="fas fa-arrow-left"></i> Voltar</button>
                <span class="hsw-spacer"></span>
                <span class="hsw-count" id="hsw-count"><b>${nf}</b> no formulário · <b>${nn}</b> na nota</span>
                <button class="hsw-btn primary" onclick="hsWizard.aplicar()">Aplicar ao chamado <i class="fas fa-arrow-right"></i></button>`;
        }
    }
};

/* ─── utilitários de aplicação no formulário ───────────────── */
const _HS_MARCADOR = 'DADOS HUBSOFT ────>';
function _hsPop(el) {
    el.classList.remove('field-popped');
    void el.offsetWidth;
    el.classList.add('field-popped');
}
// Bloco de extras vai para o campo FALHA, deixando 2 quebras de linha em
// cima (espaço p/ a falha) e o marcador com seta ────> onde começa a nota.
function _hsInjetarBloco(conteudo) {
    const el = document.getElementById('falha');
    if (!el) return;
    let atual = el.value || '';
    const pos = atual.indexOf(_HS_MARCADOR);
    if (pos !== -1) atual = atual.slice(0, pos); // reescreve o bloco, mantém a falha do topo
    const topo = atual.replace(/\s+$/, '');      // texto da falha (sem sobra de espaço)
    el.value = `${topo}\n\n${_HS_MARCADOR}\n${conteudo}`;
    _hsPop(el);
}

// Fecha ao clicar no backdrop / Esc
document.addEventListener('DOMContentLoaded', () => {
    const ov = document.getElementById('hs-wizard');
    if (ov) ov.addEventListener('click', e => { if (e.target === ov) hsWizard.fechar(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            const o = document.getElementById('hs-wizard');
            if (o && o.classList.contains('open')) hsWizard.fechar();
        }
    });
});

window.hsWizard = hsWizard;

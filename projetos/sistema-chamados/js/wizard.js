// ================================================================
// CHAMADO WIZARD — fluxo de abertura em 4 etapas, sem rolagem:
//   HubSoft → James → Dados → Resumo
// Não reimplementa a lógica: apenas orquestra as etapas e chama os
// métodos já existentes em window.sistemaChamados (app.js).
// ================================================================
const chamadoWizard = {
    steps: ['hubsoft', 'james', 'dados', 'resumo', 'resultado'],
    meta: { hubsoft: 'HubSoft', james: 'James', dados: 'Dados', resumo: 'Resumo', resultado: 'Resultado' },
    atual: 0,

    init() { this._render(); },

    // Etapa 1: alterna entre "buscar por código" e "colar dados"
    hsModo(modo) {
        document.querySelectorAll('#cw-hs-seg .cw-seg-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === modo));
        document.getElementById('cw-hs-buscar').style.display = (modo === 'buscar') ? '' : 'none';
        document.getElementById('cw-hs-colar').style.display  = (modo === 'colar')  ? '' : 'none';
    },

    // Abre o console da API com o código digitado na etapa 1
    consultarApi() {
        const c = (document.getElementById('codigoBusca').value || '').trim();
        document.getElementById('codigo').value = c;
        // abre o console já buscando (sem exigir clicar "Consultar" de novo)
        if (window.hsWizard) hsWizard.abrir(true);
    },

    ir(nome) { const i = this.steps.indexOf(nome); if (i >= 0) { this.atual = i; this._render(); } },
    voltar() { if (this.atual > 0) { this.atual--; this._render(); } },
    _clicaStep(i) { if (i <= this.atual) { this.atual = i; this._render(); } }, // só volta

    async proximo() {
        const nome = this.steps[this.atual];
        if (nome === 'james') {
            const hs = (document.getElementById('hubsoftData').value || '').trim();
            const jm = (document.getElementById('jamesData').value || '').trim();
            if (hs || jm) await this._processarIA();
            this.ir('dados');
            return;
        }
        if (nome === 'dados') {
            if (window.sistemaChamados && sistemaChamados.atualizarResumo) sistemaChamados.atualizarResumo();
            this.ir('resumo');
            return;
        }
        if (nome === 'resumo') {
            this.ir('resultado'); // monta o resultado final e registra no histórico
            return;
        }
        if (nome === 'resultado') {
            this.copiarResultado('tudo');
            return;
        }
        // hubsoft → james
        if (this.atual < this.steps.length - 1) { this.atual++; this._render(); }
    },

    // Monta o texto final: chamado (dados) + resumo de agenda.
    _montarResultado() {
        const chamado = (window.sistemaChamados && sistemaChamados.gerarChamadoCompleto)
            ? sistemaChamados.gerarChamadoCompleto() : '';
        const resumo = (document.getElementById('resumoContent') && document.getElementById('resumoContent').textContent || '').trim();
        const resumoOk = resumo && !/Preencha|Clique em|Gerando/.test(resumo);
        return resumoOk
            ? `${chamado}\n\n━━━━━━━━━━━━━━\n📅 RESUMO DE AGENDA\n${resumo}`
            : chamado;
    },

    // Preenche o preview e registra no histórico (add na 1ª vez, update depois).
    _prepararResultado() {
        const box = document.getElementById('cwResultado');
        if (box) box.textContent = this._montarResultado();
        if (typeof salvarHistoricoChamado === 'function') salvarHistoricoChamado();
    },

    copiarResultado(qual) {
        const chamado = (window.sistemaChamados && sistemaChamados.gerarChamadoCompleto)
            ? sistemaChamados.gerarChamadoCompleto() : '';
        const resumo = (document.getElementById('resumoContent') && document.getElementById('resumoContent').textContent || '').trim();
        const resumoOk = resumo && !/Preencha|Clique em|Gerando/.test(resumo);
        let txt;
        if (qual === 'chamado') txt = chamado;
        else if (qual === 'resumo') txt = resumoOk ? resumo : '';
        else txt = this._montarResultado();
        const toast = (m, t) => { if (window.sistemaChamados && sistemaChamados.mostrarToast) sistemaChamados.mostrarToast(m, t); };
        if (!txt) { toast('Nada para copiar ainda.', 'error'); return; }
        navigator.clipboard.writeText(txt).then(
            () => toast(qual === 'resumo' ? 'Resumo copiado!' : (qual === 'chamado' ? 'Chamado copiado!' : 'Resultado copiado!'), 'success'),
            () => toast('Erro ao copiar.', 'error')
        );
    },

    novoChamado() {
        const b = document.getElementById('limparBtn');
        if (b) b.click(); // limpa o formulário (lógica do app.js)
        ['hubsoftData', 'jamesData', 'codigoBusca'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        if (typeof novoChamadoHistorico === 'function') novoChamadoHistorico();
        this.ir('hubsoft');
    },

    async _processarIA() {
        const next = document.getElementById('cw-next');
        const old = next.innerHTML;
        next.disabled = true;
        next.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando…';
        try {
            if (window.sistemaChamados && sistemaChamados.processarComIA) await sistemaChamados.processarComIA();
        } catch (e) { console.warn('IA falhou:', e); }
        finally { next.disabled = false; next.innerHTML = old; }
    },

    _render() {
        const nome = this.steps[this.atual];
        document.querySelectorAll('.cw-pane').forEach(p =>
            p.classList.toggle('active', p.dataset.step === nome));
        this._renderStepper();

        const back = document.getElementById('cw-back');
        const next = document.getElementById('cw-next');
        const info = document.getElementById('cw-foot-info');
        if (back) back.style.visibility = (this.atual === 0) ? 'hidden' : 'visible';
        if (next) {
            if (nome === 'james') next.innerHTML = 'Processar e avançar <i class="fas fa-arrow-right"></i>';
            else if (nome === 'resumo') next.innerHTML = 'Ver resultado <i class="fas fa-arrow-right"></i>';
            else if (nome === 'resultado') next.innerHTML = '<i class="fas fa-copy"></i> Copiar tudo';
            else next.innerHTML = 'Próximo <i class="fas fa-arrow-right"></i>';
        }
        if (info) {
            const t = {
                hubsoft: 'HubSoft e James são opcionais — dá pra preencher à mão na etapa Dados.',
                james: 'Cole o chat ou deixe em branco e avance.',
                dados: 'Revise os campos obrigatórios (*) antes de gerar o resumo.',
                resumo: 'Confira o resumo. No próximo passo o chamado é registrado no histórico.',
                resultado: 'Registrado no histórico ✓ — copie o texto e envie.'
            };
            info.textContent = t[nome] || '';
        }
        if (nome === 'hubsoft') {
            const el = document.getElementById('codigoBusca');
            if (el && document.getElementById('cw-hs-buscar').style.display !== 'none') setTimeout(() => el.focus(), 60);
        }
        if (nome === 'resultado') this._prepararResultado();
    },

    _renderStepper() {
        const box = document.getElementById('cw-stepper');
        if (!box) return;
        box.innerHTML = this.steps.map((s, i) => {
            const st = i < this.atual ? 'done' : (i === this.atual ? 'active' : '');
            const node = i < this.atual ? '<i class="fas fa-check"></i>' : (i + 1);
            const clique = (i <= this.atual) ? ` onclick="chamadoWizard._clicaStep(${i})"` : '';
            const step = `<button type="button" class="cw-step ${st}"${clique}>
                <span class="cw-step-node">${node}</span>
                <span class="cw-step-label">${this.meta[s]}</span>
            </button>`;
            const link = (i < this.steps.length - 1) ? '<span class="cw-step-link"></span>' : '';
            return step + link;
        }).join('');
    }
};

document.addEventListener('DOMContentLoaded', () => chamadoWizard.init());
window.chamadoWizard = chamadoWizard;

class SistemaChamados {
    constructor() {
        this.scriptOriginal = `Será necessário envio técnico. Pode me informar os dados abaixo, por gentileza?

▪️ Telefone de quem irá receber o técnico:
▪️ Disponibilidade para os próximos dois dias comerciais:
▪️ Nome da pessoa que irá receber o técnico:
▪️ Endereço atualizado (preferencialmente com link do Google Maps ou WhatsApp):

Assim que receber essas informações, sigo com o agendamento da visita técnica. Fico no aguardo!`;
        
        this.init();
        this.bindEvents();
    }

    init() {
        // Elementos do DOM
        this.form = document.getElementById('chamadoForm');
        this.scriptContent = document.getElementById('scriptCliente');
        this.resumoContent = document.getElementById('resumoContent');
        this.modal = document.getElementById('editModal');
        this.scriptEditor = document.getElementById('scriptEditor');
        this.toast = document.getElementById('toast');
        this.toastMessage = document.getElementById('toastMessage');
        
        // Elementos do último script
        this.ultimoScriptSection = document.getElementById('ultimoScriptSection');
        this.ultimoScriptContent = document.getElementById('ultimoScriptContent');
        this.ultimoScriptInfo = document.getElementById('ultimoScriptInfo');
        this.scriptTimestamp = document.getElementById('scriptTimestamp');

        // Inicializar script
        this.scriptContent.textContent = this.scriptOriginal;
        this.scriptEditor.value = this.scriptOriginal;

        // Carregar último script salvo se existir
        this.carregarUltimoScript();

        // Configurar observadores de mudança nos campos
        this.setupFormObservers();
    }

    bindEvents() {
        // Check updates button
        document.getElementById('checkUpdatesBtn').addEventListener('click', () => this.checkForUpdates());

        // Auto Mode
        document.getElementById('processarIABtn').addEventListener('click', () => this.processarComIA());
        document.getElementById('closeContractsModal').addEventListener('click', () => this.fecharModalContratos());
        // How-to modal
        document.querySelectorAll('.btn-how-to').forEach(btn => {
            btn.addEventListener('click', () => {
                const img     = btn.dataset.img;
                const caption = btn.dataset.caption;
                const isJames = btn.classList.contains('james-how-to');
                document.getElementById('howToTitle').textContent   = isJames ? 'Como copiar do JAMES' : 'Como copiar do HUBSOFT';
                document.getElementById('howToCaption').textContent = caption;
                document.getElementById('howToImg').src             = img;
                document.getElementById('howToModal').style.display = 'block';
            });
        });
        document.getElementById('closeHowToModal').addEventListener('click', () => {
            document.getElementById('howToModal').style.display = 'none';
        });
        document.getElementById('howToModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('howToModal'))
                document.getElementById('howToModal').style.display = 'none';
        });

        document.getElementById('contractsModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('contractsModal')) this.fecharModalContratos();
        });
        document.querySelectorAll('.btn-clear-input').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.target;
                if (target) document.getElementById(target).value = '';
            });
        });
        
        // Botões principais
        document.getElementById('limparBtn').addEventListener('click', () => this.limparFormulario());
        document.getElementById('copiarChamadoBtn').addEventListener('click', () => this.copiarChamado());
        document.getElementById('copiarScriptBtn').addEventListener('click', () => this.copiarScript());
        document.getElementById('copiarResumoBtn').addEventListener('click', () => this.copiarResumo());
        document.getElementById('editarScriptBtn').addEventListener('click', () => this.abrirEditor());

        // Modal
        document.getElementById('closeModal').addEventListener('click', () => this.fecharModal());
        document.getElementById('cancelarEdicaoBtn').addEventListener('click', () => this.fecharModal());
        document.getElementById('salvarEdicaoBtn').addEventListener('click', () => this.salvarEdicao());

        // Último Script
        document.getElementById('recuperarScriptBtn').addEventListener('click', () => this.recuperarUltimoScript());
        document.getElementById('copiarUltimoBtn').addEventListener('click', () => this.copiarUltimoScript());
        document.getElementById('descartarUltimoBtn').addEventListener('click', () => this.descartarUltimoScript());

        // Fechar modal clicando fora
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.fecharModal();
            }
        });

        // ESC para fechar modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.style.display === 'block') {
                this.fecharModal();
            }
        });

        // Correção de texto via IA nos campos
        const btnCorrigir = document.getElementById('corrigirCamposBtn');
        if (btnCorrigir) {
            btnCorrigir.addEventListener('click', () => this.corrigirCamposDoFormulario());
        }
        // Gerar resumo via IA
        const btnGerarResumo = document.getElementById('gerarResumoBtn');
        if (btnGerarResumo) {
            btnGerarResumo.addEventListener('click', () => this.atualizarResumo());
        }    }

    setupFormObservers() {
        // Removido: não atualiza automaticamente mais
        // A atualização agora é manual via botão
    }

    async gerarResumoViaIA(dados) {
        try {
            if (!window.CHAT_API_CONFIG && typeof window.loadGeminiConfig === 'function') {
                await window.loadGeminiConfig();
            }
            if (!window.CHAT_API_CONFIG) {
                console.error('API não configurada — defina a chave em config/gemini-api-key no Firestore');
                return null;
            }

            // Construir entrada para a IA
            const entrada = `▪️ Instrução: ${dados.instrucao || '(vazio)'}
▪️ Código: ${dados.codigo}
▪️ Cliente: ${dados.cliente}
▪️ Ponto: ${dados.ponto || 'NÃO INFORMADO'}
▪️ Falha: ${dados.falha}
▪️ Local: ${dados.localCliente}
▪️ Telefone: ${dados.telefone || 'NÃO INFORMADO'}
▪️ Disponibilidade: ${dados.disponibilidade || 'NÃO INFORMADO'}
▪️ Responsável: ${dados.responsavel || 'NÃO INFORMADO'}
▪️ Protocolo: ${dados.protocolo}
▪️ Protocolo James: ${dados.protocoloJames || 'NÃO INFORMADO'}`;

            const prompt = `Você é um assistente de agendamento técnico. Sua função é converter chamados em notas de agenda em linha única.

**🚨 PRIORIDADE MÁXIMA - CAMPO INSTRUÇÃO:**
O campo "▪️ Instrução:" tem PRIORIDADE ABSOLUTA sobre TODAS as outras regras deste prompt.
Se houver conflito entre uma instrução e as regras padrão, SEMPRE obedeça a instrução.

**⚠️ TIPOS DE INSTRUÇÃO:**
Verifique sempre se há uma entrada chamada "▪️ Instrução:" e diferencie o tipo:

A) **INFORMAÇÃO para o técnico (APARECE no início do output):**
   - Avisos sobre segurança/cliente: "Cuidado cachorro bravo", "Cliente agressivo"
   - Tarefas/materiais: "Comprar poste", "Levar cabo", "Trazer equipamento"
   - Observações importantes: "Ligar antes", "Só atende após 14h"
   - **AÇÃO:** Coloque NO INÍCIO em MAIÚSCULAS seguido de ▪️
   - **Exemplo:** COMPRAR POSTE ▪️ (5806) Nome ▪️ Local...

B) **REGRA de formatação/estilo (NÃO aparece, mas você DEVE SEGUIR):**
   - Instruções sobre formato: "gere com emojis", "use markdown", "seja criativo"
   - Nível de detalhe: "não resuma", "seja detalhado", "inclua todos os dados"
   - Estilo de escrita: "linguagem formal", "tom amigável"
   - **AÇÃO:** OBEDEÇA a regra ao gerar, mas NÃO a escreva no output
   - **Exemplo:** Se instrução = "gere com emojis", você deve adicionar emojis no output, mas não escrever "GERE COM EMOJIS" no início

**Como identificar:**
- É algo para o TÉCNICO SABER/FAZER no local? → Tipo A (APARECE)
- É sobre COMO VOCÊ DEVE GERAR o texto? → Tipo B (SIGA mas NÃO ESCREVA)

**Regras Padrão (quando não há instrução tipo B específica):**

1. **Resumo Técnico:** Apenas defeito físico resumido (ex: "Sem sinal", "POE queimado"). Apague histórico de chat.
2. **Localização:** Organize assim:
   - Mantenha endereço principal (ex: "Av Nome da Rua 123")
   - NÃO COLOQUE referências entre aspas no final (ex: "ao lado X")
   - Exemplo: Av Anselmo Alves 1542 "Ao lado Audinha"
3. **Segurança:** Se faltar dado essencial, escreva "NÃO INFORMADO". Não invente.

**Formatação Obrigatória:**
[INSTRUÇÃO TIPO A EM MAIÚSCULAS ▪️ ] (Código) NOME ▪️ LOCAL ▪️ RESUMO TÉCNICO ▪️ TELEFONE ▪️ PROTOCOLO

**Entrada do Chamado:**
${entrada}

**Saída (apenas a linha de resumo, seguindo instrução tipo B se houver):**`;

            const resumoGerado = await window.chatAI(prompt);
            if (!resumoGerado) throw new Error('Resposta inválida da IA');
            return resumoGerado;
        } catch (error) {
            console.error('Erro ao gerar resumo via IA:', error);
            return null;
        }
    }

    // ====== IA de Correção de Texto (copiada de scripts-atendimento) ======
    async chamarAPICorrecao(texto) {
        try {
            if (!window.CHAT_API_CONFIG && typeof window.loadGeminiConfig === 'function') {
                await window.loadGeminiConfig();
            }
            if (!window.CHAT_API_CONFIG) {
                console.error('API não configurada — defina a chave em config/gemini-api-key no Firestore');
                throw new Error('API não configurada');
            }
            
            const prompt = `Você é um corretor de português brasileiro especializado em telecom e está operando dentro de um SISTEMA automatizado. Regras:\n1) Corrija apenas gramática, ortografia, acentuação e pontuação.\n2) Mantenha o tom profissional adequado para atendimento ao cliente.\n3) NÃO invente dados e NÃO faça perguntas.\n4) Se NÃO souber o que ajustar, RETORNE EXATAMENTE o texto original.\n5) Preserve números, códigos e nomes próprios (não mude a escrita de nomes), apenas melhore pontuação/contexto.\n6) Responda APENAS com o texto corrigido, sem comentários.\n\nTexto para corrigir: "${texto}"`;

            const textoCorrigido = await window.chatAI(prompt);
            if (!textoCorrigido) throw new Error('Resposta inválida da IA');
            return {
                sucesso: true,
                textoCorrigido,
                correcoesCount: texto !== textoCorrigido ? 1 : 0,
                apiUsada: window._aiProvider || 'IA'
            };
        } catch (error) {
            // Fallback local simples
            try {
                const { textoCorrigido, correcoesCount } = this.correcaoBasica(texto);
                return {
                    sucesso: true,
                    textoCorrigido,
                    correcoesCount,
                    apiUsada: 'Correção Básica Local'
                };
            } catch (e) {
                return { sucesso: false, erro: 'Falha na correção de texto.' };
            }
        }
    }

    correcaoBasica(texto) {
        const regras = [
            { pattern: /\bnao\b/gi, replacement: 'não' },
            { pattern: /\bvoce\b/gi, replacement: 'você' },
            { pattern: /\besta\s+(muito|bem|indo)/gi, replacement: 'está $1' },
            { pattern: /\be\s+(muito|bem|bom)/gi, replacement: 'é $1' },
            { pattern: /\bso\s+(um|uma|isso)/gi, replacement: 'só $1' },
            { pattern: /\bja\s+(fiz|foi|estava)/gi, replacement: 'já $1' },
            { pattern: /\bas\s+vezes/gi, replacement: 'às vezes' },
            { pattern: /\ba\s+noite/gi, replacement: 'à noite' },
            { pattern: /\ba\s+tarde/gi, replacement: 'à tarde' }
        ];

        let textoCorrigido = texto;
        let correcoesCount = 0;
        regras.forEach(regra => {
            const antes = textoCorrigido;
            textoCorrigido = textoCorrigido.replace(regra.pattern, regra.replacement);
            if (antes !== textoCorrigido) correcoesCount++;
        });
        return { textoCorrigido, correcoesCount };
    }

    async corrigirCamposDoFormulario() {
        const btn = document.getElementById('corrigirCamposBtn');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Corrigindo...';

        const camposTexto = [
            'cliente', 'ponto', 'falha', 'telefone',
            'disponibilidade', 'responsavel', 'localCliente', 'protocolo', 'protocoloJames'
        ];

        let totalCorrigidos = 0;
        let apiUsada = '';

        for (const id of camposTexto) {
            const el = document.getElementById(id);
            if (!el) continue;
            const valor = (el.value || el.textContent || '').trim();
            if (!valor) continue;

            try {
                // Regras específicas por campo:
                // - ponto: NÃO alterar
                if (id === 'ponto') {
                    continue;
                }

                // - cliente e responsavel: apenas normalizar espaços e capitalização; NÃO usar IA
                if (id === 'cliente' || id === 'responsavel') {
                    const novoValor = this.normalizarNomePreservandoOriginalidade(valor);
                    if ('value' in el) el.value = novoValor; else el.textContent = novoValor;
                    // Considera como 1 melhoria se houve mudança
                    if (novoValor !== valor) totalCorrigidos += 1;
                    apiUsada = apiUsada || 'Normalização de Nome';
                    continue;
                }

                // - telefone: apenas formatar para padrão brasileiro
                if (id === 'telefone') {
                    const formatado = this.formatarTelefoneBR(valor);
                    if ('value' in el) el.value = formatado; else el.textContent = formatado;
                    if (formatado !== valor) totalCorrigidos += 1;
                    apiUsada = apiUsada || 'Formatação de Telefone';
                    continue;
                }

                // Demais campos: usar IA de correção
                const res = await this.chamarAPICorrecao(valor);
                if (res.sucesso) {
                    if ('value' in el) el.value = res.textoCorrigido; else el.textContent = res.textoCorrigido;
                    totalCorrigidos += res.correcoesCount;
                    apiUsada = apiUsada || res.apiUsada;
                }
            } catch (_) {}
        }

        // Regerar resumo após correções
        this.atualizarResumo();

        btn.disabled = false;
        btn.innerHTML = original;

        if (totalCorrigidos > 0) {
            this.mostrarToast(`Campos corrigidos (${apiUsada}).`, 'success');
        } else {
            this.mostrarToast('Nada para corrigir ou já está ok.', 'info');
        }
    }

    // Normaliza nomes: apenas espaços e capitalização; não altera a escrita (semântica)
    normalizarNomePreservandoOriginalidade(texto) {
        if (!texto) return texto;
        // Trim e colapsar múltiplos espaços
        let t = texto.replace(/\s+/g, ' ').trim();
        if (!t) return t;

        const conectivos = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

        const titlecasePalavra = (palavra) => {
            if (!palavra) return palavra;
            // Preservar hífens (ex: maria-clara)
            return palavra.split('-').map(seg => {
                if (!seg) return seg;
                const lower = seg.toLowerCase();
                return lower.charAt(0).toUpperCase() + lower.slice(1);
            }).join('-');
        };

        const palavras = t.split(' ');
        const resultado = palavras.map((p, idx) => {
            const base = p.trim();
            if (!base) return base;
            const lower = base.toLowerCase();
            if (idx > 0 && conectivos.has(lower)) {
                return lower; // conectivos em minúsculo quando não são a primeira palavra
            }
            return titlecasePalavra(base);
        }).join(' ');

        return resultado;
    }

    // Formata número de telefone para o padrão BR. Mantém original se não reconhecido.
    formatarTelefoneBR(entrada) {
        if (!entrada) return entrada;
        const digitsRaw = String(entrada).replace(/\D/g, '');
        if (!digitsRaw) return entrada.trim();

        // Remover código do país 55 se presente
        let d = digitsRaw;
        if ((d.length === 13 || d.length === 12) && d.startsWith('55')) {
            d = d.slice(2);
        }

        // 11 dígitos (celular com 9): (DD) 9XXXX-XXXX
        if (d.length === 11) {
            return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
        }

        // 10 dígitos (fixo): (DD) XXXX-XXXX
        if (d.length === 10) {
            return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
        }

        // 9 dígitos sem DDD: 9XXXX-XXXX
        if (d.length === 9) {
            return `${d.slice(0, 5)}-${d.slice(5)}`;
        }

        // 8 dígitos sem DDD: XXXX-XXXX
        if (d.length === 8) {
            return `${d.slice(0, 4)}-${d.slice(4)}`;
        }

        // Caso não reconheça, manter original aparado
        return entrada.trim();
    }

    getFormData() {
        return {
            codigo: document.getElementById('codigo').value.trim(),
            cliente: document.getElementById('cliente').value.trim(),
            ponto: document.getElementById('ponto').value.trim(),
            falha: document.getElementById('falha').value.trim(),
            telefone: document.getElementById('telefone').value.trim(),
            disponibilidade: document.getElementById('disponibilidade').value.trim(),
            responsavel: document.getElementById('responsavel').value.trim(),
            localCliente: document.getElementById('localCliente').value.trim(),
            protocolo: document.getElementById('protocolo').value.trim(),
            protocoloJames: document.getElementById('protocoloJames').value.trim(),
            instrucao: document.getElementById('instrucao').value.trim()
        };
    }

    gerarChamadoCompleto() {
        const dados = this.getFormData();
        
        return `🔴 Chamados 🔴

▪️ Código HubSoft: ${dados.codigo}
▪️ Cliente HubSoft: ${dados.cliente}
▪️ Ponto HubSoft: ${dados.ponto}

▪️ Falha: ${dados.falha}

▪️ Telefone: ${dados.telefone}
▪️ Disponibilidade: ${dados.disponibilidade}
▪️ Responsável pelo local: ${dados.responsavel}
▪️ Local: ${dados.localCliente}
▪️ Protocolo HubSoft: ${dados.protocolo}
▪️ Protocolo James: ${dados.protocoloJames}`;
    }

    async atualizarResumo() {
        const dados = this.getFormData();
        const copiarBtn = document.getElementById('copiarResumoBtn');

        // Campos mínimos para gerar resumo
        if (!dados.codigo && !dados.cliente && !dados.falha) {
            this.resumoContent.innerHTML = '<p class="placeholder">Preencha os dados acima para gerar o resumo automaticamente</p>';
            this.resumoContent.classList.remove('generated');
            if (copiarBtn) copiarBtn.disabled = true;
            return;
        }

        // Mostra spinner e bloqueia avanço
        this.resumoContent.innerHTML = '<p class="placeholder"><i class="fas fa-spinner fa-spin"></i> Gerando resumo via IA...</p>';
        if (copiarBtn) copiarBtn.disabled = true;

        let resumo = null;
        try {
            resumo = await this.gerarResumoViaIA(dados);
        } catch (e) {
            console.warn('IA falhou, usando fallback local:', e);
        }

        if (resumo) {
            this.resumoContent.textContent = resumo;
            this.resumoContent.classList.add('generated');
            this.resumoContent.classList.remove('placeholder');
        } else {
            // Fallback local — monta resumo com os dados disponíveis
            const partes = [];
            if (dados.codigo && dados.cliente) partes.push(`(${dados.codigo}) ${dados.cliente}`);
            else if (dados.cliente)            partes.push(dados.cliente);
            if (dados.localCliente)            partes.push(dados.localCliente);
            if (dados.falha) {
                // Só a primeira linha da falha (sem bloco HubSoft)
                const falhaCurta = dados.falha.split('DADOS HUBSOFT')[0].split('\n')[0].trim();
                if (falhaCurta) partes.push(falhaCurta);
            }
            if (dados.telefone)    partes.push(dados.telefone);
            if (dados.protocolo)   partes.push('Protocolo: ' + dados.protocolo);
            this.resumoContent.textContent = partes.join(' ▪️ ');
            this.resumoContent.classList.add('generated');
        }

        if (copiarBtn) copiarBtn.disabled = false;
    }


    limparFormulario() {
        // Salvar dados atuais antes de limpar
        this.salvarUltimoScript();
        
        this.form.reset();
        this.atualizarResumo();
        this.mostrarToast('Formulário limpo! Último script salvo para recuperação.', 'info');
    }

    async copiarChamado() {
        const chamado = this.gerarChamadoCompleto();
        await this.copiarTexto(chamado, 'Chamado copiado para a área de transferência!');
    }

    async copiarScript() {
        const script = this.scriptContent.textContent;
        await this.copiarTexto(script, 'Script copiado para a área de transferência!');
    }

    async copiarResumo() {
        const resumo = this.resumoContent.textContent;
        if (resumo && !resumo.includes('Preencha os dados')) {
            await this.copiarTexto(resumo, 'Resumo copiado para a área de transferência!');
        }
    }

    async copiarTexto(texto, mensagem) {
        try {
            await navigator.clipboard.writeText(texto);
            this.mostrarToast(mensagem, 'success');
        } catch (err) {
            // Fallback para navegadores que não suportam navigator.clipboard
            const textArea = document.createElement('textarea');
            textArea.value = texto;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                document.execCommand('copy');
                this.mostrarToast(mensagem, 'success');
            } catch (err) {
                this.mostrarToast('Erro ao copiar. Tente novamente.', 'error');
            }
            
            document.body.removeChild(textArea);
        }
    }

    abrirEditor() {
        this.scriptEditor.value = this.scriptContent.textContent;
        this.modal.style.display = 'block';
        this.scriptEditor.focus();
    }

    fecharModal() {
        this.modal.style.display = 'none';
    }

    salvarEdicao() {
        const novoScript = this.scriptEditor.value.trim();
        if (novoScript) {
            this.scriptContent.textContent = novoScript;
            this.fecharModal();
            this.mostrarToast('Script atualizado com sucesso!', 'success');
        } else {
            this.mostrarToast('O script não pode estar vazio!', 'error');
        }
    }

    mostrarToast(mensagem, tipo = 'success') {
        this.toastMessage.textContent = mensagem;

        const icon = this.toast.querySelector('i');
        const cores = {
            success: { icon: 'fas fa-check-circle',       color: '#34d399', border: 'rgba(16,185,129,0.35)' },
            error:   { icon: 'fas fa-exclamation-circle', color: '#f87171', border: 'rgba(239,68,68,0.35)'   },
            info:    { icon: 'fas fa-info-circle',         color: '#818cf8', border: 'rgba(99,102,241,0.35)'  }
        };
        const cfg = cores[tipo] || cores.info;
        icon.className = cfg.icon;
        icon.style.color = cfg.color;
        this.toast.style.borderColor = cfg.border;
        this.toast.style.background  = '';

        this.toast.classList.add('show');
        setTimeout(() => this.toast.classList.remove('show'), 3000);
    }

    // Método para resetar o script para o original
    resetarScript() {
        this.scriptContent.textContent = this.scriptOriginal;
        this.mostrarToast('Script resetado para o original!', 'info');
    }

    // Método para validar campos obrigatórios
    validarFormulario() {
        const dados = this.getFormData();
        const camposObrigatorios = ['codigo', 'cliente', 'localCliente', 'falha', 'telefone', 'protocolo'];
        const camposFaltantes = [];

        camposObrigatorios.forEach(campo => {
            if (!dados[campo]) {
                camposFaltantes.push(campo);
            }
        });

        return {
            valido: camposFaltantes.length === 0,
            camposFaltantes
        };
    }

    // Método para exportar dados (para futuras funcionalidades)
    exportarDados() {
        const dados = this.getFormData();
        const dataExport = {
            timestamp: new Date().toISOString(),
            chamado: dados,
            script: this.scriptContent.textContent
        };
        
        return JSON.stringify(dataExport, null, 2);
    }

    // Método para importar dados (para futuras funcionalidades)
    importarDados(jsonData) {
        try {
            const dados = JSON.parse(jsonData);
            
            if (dados.chamado) {
                Object.keys(dados.chamado).forEach(campo => {
                    const elemento = document.getElementById(campo);
                    if (elemento && dados.chamado[campo]) {
                        elemento.value = dados.chamado[campo];
                    }
                });
                
                this.atualizarResumo();
            }
            
            if (dados.script) {
                this.scriptContent.textContent = dados.script;
            }
            
            this.mostrarToast('Dados importados com sucesso!', 'success');
        } catch (err) {
            this.mostrarToast('Erro ao importar dados!', 'error');
        }
    }

    // Métodos para gerenciar último script
    salvarUltimoScript() {
        const dados = this.getFormData();
        const chamado = this.gerarChamadoCompleto();
        const timestamp = new Date();
        
        // Verificar se há dados para salvar
        if (!dados.codigo && !dados.cliente && !dados.falha) {
            return; // Não salvar se não há dados relevantes
        }

        const ultimoScript = {
            timestamp: timestamp.toISOString(),
            timestampFormatado: this.formatarTimestamp(timestamp),
            dados: dados,
            chamadoCompleto: chamado,
            resumo: dados.codigo && dados.cliente && dados.localCliente && dados.falha && dados.protocolo 
                ? `${dados.codigo} - ${dados.cliente} - ${dados.localCliente} - ${dados.falha} - ${dados.protocolo}`
                : null
        };

        // Salvar no localStorage
        localStorage.setItem('ultimoScriptChamados', JSON.stringify(ultimoScript));
        
        // Mostrar o card
        this.mostrarUltimoScript(ultimoScript);
    }

    carregarUltimoScript() {
        const ultimoScript = localStorage.getItem('ultimoScriptChamados');
        if (ultimoScript) {
            try {
                const dados = JSON.parse(ultimoScript);
                this.mostrarUltimoScript(dados);
            } catch (err) {
                console.log('Erro ao carregar último script:', err);
            }
        }
    }

    mostrarUltimoScript(dadosScript) {
        this.scriptTimestamp.textContent = `Salvo em: ${dadosScript.timestampFormatado}`;
        this.ultimoScriptContent.textContent = dadosScript.chamadoCompleto;
        this.ultimoScriptSection.style.display = 'block';
        
        // Scroll suave para o card
        setTimeout(() => {
            this.ultimoScriptSection.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
            });
        }, 300);
    }

    recuperarUltimoScript() {
        const ultimoScript = localStorage.getItem('ultimoScriptChamados');
        if (ultimoScript) {
            try {
                const dados = JSON.parse(ultimoScript);
                
                // Preencher o formulário com os dados salvos
                Object.keys(dados.dados).forEach(campo => {
                    const elemento = document.getElementById(campo);
                    if (elemento && dados.dados[campo]) {
                        elemento.value = dados.dados[campo];
                    }
                });
                
                // Atualizar resumo
                this.atualizarResumo();
                
                // Scroll para o topo
                window.scrollTo({ top: 0, behavior: 'smooth' });
                
                this.mostrarToast('Script recuperado com sucesso!', 'success');
                
            } catch (err) {
                this.mostrarToast('Erro ao recuperar script!', 'error');
            }
        }
    }

    async copiarUltimoScript() {
        const ultimoScript = localStorage.getItem('ultimoScriptChamados');
        if (ultimoScript) {
            try {
                const dados = JSON.parse(ultimoScript);
                await this.copiarTexto(dados.chamadoCompleto, 'Último script copiado!');
            } catch (err) {
                this.mostrarToast('Erro ao copiar último script!', 'error');
            }
        }
    }

    descartarUltimoScript() {
        // Confirmar ação
        if (confirm('Tem certeza que deseja descartar o último script salvo?')) {
            localStorage.removeItem('ultimoScriptChamados');
            this.ultimoScriptSection.style.display = 'none';
            this.mostrarToast('Último script descartado!', 'info');
        }
    }

    formatarTimestamp(timestamp) {
        const data = new Date(timestamp);
        const agora = new Date();
        const diferenca = agora - data;
        const minutos = Math.floor(diferenca / (1000 * 60));
        const horas = Math.floor(diferenca / (1000 * 60 * 60));
        const dias = Math.floor(diferenca / (1000 * 60 * 60 * 24));

        if (minutos < 1) {
            return 'Agora há pouco';
        } else if (minutos < 60) {
            return `${minutos} minuto${minutos > 1 ? 's' : ''} atrás`;
        } else if (horas < 24) {
            return `${horas} hora${horas > 1 ? 's' : ''} atrás`;
        } else if (dias === 1) {
            return 'Ontem às ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        } else {
            return data.toLocaleDateString('pt-BR', { 
                day: '2-digit', 
                month: '2-digit', 
                year: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
    
    // ====== MODO AUTOMÁTICO COM IA ======

    async processarComIA() {
        const hubsoftData = document.getElementById('hubsoftData').value.trim();
        const jamesData   = document.getElementById('jamesData').value.trim();

        if (!hubsoftData && !jamesData) {
            this.mostrarToast('Cole pelo menos um dos scripts (HUBSOFT ou JAMES) para processar.', 'error');
            return;
        }

        const btn = document.getElementById('processarIABtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';

        try {
            const resultado = await this.extrairDadosComIA(hubsoftData, jamesData);

            if (!resultado) {
                this.mostrarToast('Erro ao processar com IA. Verifique os dados e tente novamente.', 'error');
                return;
            }

            if (resultado.multiplos_contratos && resultado.contratos && resultado.contratos.length > 1) {
                this.mostrarSelecaoContratos(resultado);
            } else {
                this.aplicarDadosExtraidos(resultado.dados);
            }

        } catch (err) {
            console.error('Erro no processamento:', err);
            this.mostrarToast('Erro ao processar. Tente novamente.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Processar com Audinha IA';
        }
    }

    async extrairDadosComIA(hubsoftData, jamesData) {
        if (!window.CHAT_API_CONFIG && typeof window.loadGeminiConfig === 'function') {
            await window.loadGeminiConfig();
        }
        if (!window.CHAT_API_CONFIG) {
            console.error('API não configurada — defina a chave em config/gemini-api-key no Firestore');
            return null;
        }

        const prompt = `Você é um extrator de dados para sistema de chamados técnicos de internet. Analise as informações e retorne APENAS JSON válido, sem markdown, sem texto extra.

DADOS HUBSOFT (contratos/serviços do cliente):
${hubsoftData || 'Não fornecido'}

DADOS JAMES (chat/suporte):
${jamesData || 'Não fornecido'}

REGRAS DE EXTRAÇÃO:

Do HUBSOFT:
- "codigo": número nos parênteses da PRIMEIRA linha. Ex: "(4194) NOME" → "4194"
- "cliente": nome após os parênteses da PRIMEIRA linha. Ex: "(4194) JULIANO RODRIGUES RIZZA" → "JULIANO RODRIGUES RIZZA"
- Se há UM serviço: extraia "ponto" (linha "(num) NOME_PLANO" dentro dos serviços) e "localCliente" (texto após "INSTALAÇÃO:")
- Se há MÚLTIPLOS serviços (múltiplas linhas com "(num) NOME_PLANO"): defina multiplos_contratos=true e liste todos em "contratos"
- Cada contrato: {"indice":0,"ponto":"(0) 65_ 100MB...","local":"Rua X, 123...","status":"CONECTADO|DESCONECTADO","id_servico":"5788"}

Do JAMES:
- "protocoloJames": número após "Nº protocolo:"
- "cliente" (se não veio do HUBSOFT): valor de "Cliente:" ou "Nome:"
- "telefone": número de "Telefone:" no cabeçalho. Se cliente informou outro número no chat, coloque ambos separados por " / "
- "falha": resumo conciso do problema técnico relatado pelo cliente (máximo 1 linha, sem histórico de chat)
- "disponibilidade": disponibilidade que o cliente informou para receber o técnico
- "responsavel": nome de quem vai receber o técnico (informado no chat)
- "localCliente": link Google Maps ou endereço que o cliente informou no chat (prioridade sobre o do HUBSOFT se disponível no chat)

REGRAS GERAIS:
- Se campo não encontrado: deixe string vazia ""
- "protocolo" (HubSoft OS) sempre fica vazio ""
- Falha: interprete o chat para identificar o problema técnico real (ex: "Modem não liga", "Sinal fraco na setorial", "Sem internet")
- Se multiplos_contratos=true: "ponto" e "localCliente" em "dados" ficam vazios

RETORNE EXATAMENTE este JSON:
{"multiplos_contratos":false,"contratos":[],"dados":{"codigo":"","cliente":"","ponto":"","falha":"","telefone":"","disponibilidade":"","responsavel":"","localCliente":"","protocolo":"","protocoloJames":""}}`;

        try {
            let texto = await window.chatAI(prompt);
            if (!texto) throw new Error('Resposta vazia');
            texto = texto.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
            return JSON.parse(texto);
        } catch (err) {
            console.error('Erro na extração:', err);
            return null;
        }
    }

    mostrarSelecaoContratos(resultado) {
        const modal = document.getElementById('contractsModal');
        const lista = document.getElementById('contractsList');
        lista.innerHTML = '';

        resultado.contratos.forEach((contrato, i) => {
            const isConectado = (contrato.status || '').toUpperCase().includes('CONECTADO') &&
                                !(contrato.status || '').toUpperCase().includes('DES');
            const item = document.createElement('div');
            item.className = 'contract-item';
            item.innerHTML = `
                <div class="contract-status-dot ${isConectado ? 'connected' : 'disconnected'}"></div>
                <div class="contract-info">
                    <div class="contract-ponto">${contrato.ponto || `Serviço ${i + 1}`}</div>
                    <div class="contract-local">${contrato.local || 'Endereço não disponível'}</div>
                </div>
                <i class="fas fa-chevron-right contract-arrow"></i>`;

            item.addEventListener('click', () => {
                resultado.dados.ponto = contrato.ponto || '';
                resultado.dados.localCliente = contrato.local || resultado.dados.localCliente || '';
                this.fecharModalContratos();
                this.aplicarDadosExtraidos(resultado.dados);
            });

            lista.appendChild(item);
        });

        modal.style.display = 'block';
    }

    fecharModalContratos() {
        document.getElementById('contractsModal').style.display = 'none';
    }

    aplicarDadosExtraidos(dados) {
        const mapeamento = {
            codigo: 'codigo', cliente: 'cliente', ponto: 'ponto',
            falha: 'falha', telefone: 'telefone', disponibilidade: 'disponibilidade',
            responsavel: 'responsavel', localCliente: 'localCliente',
            protocolo: 'protocolo', protocoloJames: 'protocoloJames'
        };

        const camposPreenchidos = [];
        const camposFaltando = [];

        const MARCADOR_HS = 'DADOS HUBSOFT ────>';
        const popAnim = (el) => { el.classList.remove('field-popped'); void el.offsetWidth; el.classList.add('field-popped'); };

        Object.entries(mapeamento).forEach(([chave, idCampo]) => {
            const el = document.getElementById(idCampo);
            if (!el) return;
            const valor = dados[chave] || '';

            // FALHA: pode conter o bloco "DADOS HUBSOFT ────>" (extras da API).
            // A falha extraída entra ACIMA do bloco, sem sobrescrevê-lo.
            if (chave === 'falha') {
                const txt = el.value || '';
                const pos = txt.indexOf(MARCADOR_HS);
                const topo = (pos !== -1 ? txt.slice(0, pos) : txt).trim();
                if (valor && !topo) {
                    el.value = (pos !== -1) ? `${valor}\n\n${txt.slice(pos)}` : valor;
                    popAnim(el);
                    camposPreenchidos.push(chave);
                } else if (topo) {
                    camposPreenchidos.push(chave); // falha já preenchida (preservada)
                } else {
                    camposFaltando.push(chave);
                }
                return;
            }

            const jaPreenchido = !!(el.value && el.value.trim());
            if (valor && !jaPreenchido) {
                // só preenche campos VAZIOS — a IA complementa (não sobrescreve
                // o que já veio do HubSoft ou o que o atendente digitou)
                el.value = valor;
                el.classList.remove('field-popped');
                void el.offsetWidth;
                el.classList.add('field-popped');
                camposPreenchidos.push(chave);
            } else if (jaPreenchido) {
                camposPreenchidos.push(chave); // preservado (ex.: dado do HubSoft)
            } else {
                camposFaltando.push(chave);
            }
        });

        this.mostrarStatusExtracao(camposPreenchidos, camposFaltando);
        this.mostrarToast(`✓ ${camposPreenchidos.length} campos preenchidos automaticamente!`, 'success');

        // Gerar resumo de agenda automaticamente
        this.atualizarResumo();

        // Scroll suave para o formulário
        setTimeout(() => {
            document.querySelector('.form-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
    }

    mostrarStatusExtracao(encontrados, faltando) {
        const status = document.getElementById('extractionStatus');
        const items  = document.getElementById('extractionItems');
        const labels = {
            codigo: 'Código', cliente: 'Cliente', ponto: 'Ponto',
            falha: 'Falha', telefone: 'Telefone', disponibilidade: 'Disponibilidade',
            responsavel: 'Responsável', localCliente: 'Local',
            protocolo: 'Protocolo HS', protocoloJames: 'Protocolo James'
        };

        items.innerHTML = '';
        encontrados.forEach(c => {
            const span = document.createElement('span');
            span.className = 'ext-item found';
            span.innerHTML = `<i class="fas fa-check"></i> ${labels[c] || c}`;
            items.appendChild(span);
        });
        faltando.forEach(c => {
            // Protocolo HubSoft é sempre manual, não mostrar como faltando
            if (c === 'protocolo') return;
            const span = document.createElement('span');
            span.className = 'ext-item missing';
            span.innerHTML = `<i class="fas fa-minus"></i> ${labels[c] || c}`;
            items.appendChild(span);
        });

        status.style.display = 'block';
    }

    // Check for updates method
    checkForUpdates() {
        const confirmation = confirm(
            '🔄 Verificar Updates\n\n' +
            'Esta ação irá recarregar a página para buscar a versão mais recente do sistema.\n\n' +
            'Deseja continuar?'
        );
        
        if (confirmation) {
            // Forçar recarregamento sem cache
            window.location.reload(true);
            // Fallback para navegadores modernos
            setTimeout(() => {
                location.reload();
            }, 100);
        }
    }
}

// Inicializar quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', () => {
    window.sistemaChamados = new SistemaChamados();
});

// Expor métodos úteis no escopo global para debug/desenvolvimento
window.debugChamados = {
    exportar: () => window.sistemaChamados.exportarDados(),
    importar: (dados) => window.sistemaChamados.importarDados(dados),
    resetarScript: () => window.sistemaChamados.resetarScript(),
    validar: () => window.sistemaChamados.validarFormulario()
};
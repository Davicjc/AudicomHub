// ================================================================
// UTILS — compressão de imagem, toast, helpers
// ================================================================

// Comprime imagem para JPEG, máx 1200px de largura, qualidade 0.75.
// Retorna string base64 ("data:image/jpeg;base64,...").
// Cada documento Firestore tem limite de 1MB; esta configuração
// mantém imagens comuns entre 60KB e 400KB em base64.
async function compressImage(file, maxWidth = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Arquivo não é uma imagem'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Erro ao carregar imagem'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round(height * maxWidth / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        const base64 = canvas.toDataURL('image/jpeg', quality);

        // Alerta se ainda passar de 900KB em base64
        const sizeKB = Math.round((base64.length * 3 / 4) / 1024);
        if (sizeKB > 900) {
          console.warn(`Imagem comprimida ainda grande: ${sizeKB}KB. Considere usar uma imagem menor.`);
        }

        resolve({ base64, sizeKB });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Exibe toast de notificação. tipo: 'info' | 'success' | 'error'
function showToast(msg, tipo = 'info') {
  let toast = document.getElementById('_toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = `toast toast-${tipo} show`;
  toast.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 3200);
}

// Converte Firestore Timestamp ou Date para string legível
function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Gera ID único simples
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

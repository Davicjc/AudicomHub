// ================================================================
// AUTH GUARD — proteção de páginas e utilitários de sessão
// ================================================================

// Raiz do site. Mude para '/meu-subdiretorio/' se necessário.
const SITE_ROOT = '/';

// Retorna { user, userData } ou redireciona para login.
// projectId (opcional): verifica acesso específico ao projeto.
async function requireAuth(projectId = null) {
  return new Promise((resolve) => {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.href = SITE_ROOT + 'index.html';
        return;
      }

      try {
        const snap = await db.collection('users').doc(user.uid).get();

        if (!snap.exists) {
          // Usuário sem documento — auto-cria com role "user" sem acesso
          await db.collection('users').doc(user.uid).set({
            email: user.email,
            name: user.displayName || user.email.split('@')[0],
            role: 'user',
            projects: {},
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          window.location.href = SITE_ROOT + 'hub.html';
          return;
        }

        const userData = { id: user.uid, ...snap.data() };

        resolve({ user, userData });
      } catch (err) {
        console.error('Erro ao verificar autenticação:', err);
        window.location.href = SITE_ROOT + 'index.html';
      }
    });
  });
}

// Retorna { user, userData } ou redireciona — exige role admin ou superadmin.
async function requireAdmin() {
  return new Promise((resolve) => {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.href = SITE_ROOT + 'index.html';
        return;
      }

      const snap = await db.collection('users').doc(user.uid).get();
      if (!snap.exists) {
        window.location.href = SITE_ROOT + 'index.html';
        return;
      }

      const userData = { id: user.uid, ...snap.data() };
      if (userData.role !== 'superadmin' && userData.role !== 'admin') {
        window.location.href = SITE_ROOT + 'hub.html';
        return;
      }

      resolve({ user, userData });
    });
  });
}

async function fazerLogout() {
  await auth.signOut();
  window.location.href = SITE_ROOT + 'index.html';
}

function traduzirErroAuth(code) {
  const map = {
    'auth/user-not-found':        'Usuário não encontrado.',
    'auth/wrong-password':        'Senha incorreta.',
    'auth/invalid-email':         'E-mail inválido.',
    'auth/invalid-credential':    'E-mail ou senha incorretos.',
    'auth/too-many-requests':     'Muitas tentativas. Aguarde e tente novamente.',
    'auth/network-request-failed':'Sem conexão. Verifique a internet.',
    'auth/user-disabled':         'Conta desativada. Fale com o administrador.',
  };
  return map[code] || 'Erro inesperado. Tente novamente.';
}

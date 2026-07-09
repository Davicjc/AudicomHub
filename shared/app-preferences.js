(function () {
  const STORAGE_KEY = 'audicom-theme-mode';
  const MODES = ['auto', 'light', 'dark'];
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let deferredInstallPrompt = null;

  function getStoredMode() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(saved) ? saved : 'auto';
  }

  function resolvedTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return media.matches ? 'dark' : 'light';
  }

  function setTheme(mode) {
    const safeMode = MODES.includes(mode) ? mode : 'auto';
    localStorage.setItem(STORAGE_KEY, safeMode);
    document.documentElement.dataset.themeMode = safeMode;
    document.documentElement.dataset.theme = resolvedTheme(safeMode);
    updateThemeColor();
    document.querySelectorAll('.theme-select').forEach(select => { select.value = safeMode; });
    document.querySelectorAll('.theme-choice').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeMode === safeMode);
    });
  }

  function updateThemeColor() {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = document.documentElement.dataset.theme === 'light' ? '#f5f7fb' : '#090909';
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isMobileLike() {
    return window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;
  }

  function showToast(message) {
    let toast = document.getElementById('appPrefToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appPrefToast';
      toast.className = 'app-pref-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 4600);
  }

  function updateInstallButtons() {
    const visible = !isStandalone() && (deferredInstallPrompt || isMobileLike());
    document.querySelectorAll('.install-app-btn').forEach(btn => {
      btn.classList.toggle('is-visible', visible);
    });
  }

  async function installApp() {
    if (isStandalone()) {
      showToast('O Hub ja esta instalado como app neste dispositivo.');
      return;
    }

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      updateInstallButtons();
      return;
    }

    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showToast(isiOS
      ? 'No iPhone/iPad: toque em Compartilhar e depois em Adicionar a Tela de Inicio.'
      : 'Use o menu do navegador e escolha Instalar app ou Adicionar a tela inicial.');
  }

  function makeControls(sidebar = false) {
    const wrap = document.createElement('div');
    wrap.className = sidebar ? 'app-preferences app-preferences--sidebar' : 'app-preferences app-preferences--navbar';
    const inlineControls = `
        <select class="theme-select" aria-label="Tema do sistema">
          <option value="auto">Tema: automatico</option>
          <option value="light">Tema: claro</option>
          <option value="dark">Tema: escuro</option>
        </select>
        <button type="button" class="install-app-btn">Instalar app</button>`;
    const panelControls = `
        <div class="app-pref-options" role="group" aria-label="Tema do sistema">
          <button type="button" class="theme-choice" data-theme-mode="auto"><span>Auto</span><small>Sistema</small></button>
          <button type="button" class="theme-choice" data-theme-mode="light"><span>Claro</span><small>Manual</small></button>
          <button type="button" class="theme-choice" data-theme-mode="dark"><span>Escuro</span><small>Manual</small></button>
          <button type="button" class="install-app-btn install-app-card"><span>Instalar</span><small>App</small></button>
        </div>`;
    wrap.innerHTML = sidebar ? inlineControls : `
      <div class="app-pref-desktop">${inlineControls}</div>
      <button type="button" class="app-pref-toggle" aria-label="Abrir preferencias" aria-expanded="false">
        <span class="app-pref-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="app-pref-panel" aria-label="Preferencias do app">${panelControls}</div>`;
    const select = wrap.querySelector('.theme-select');
    if (select) select.addEventListener('change', event => setTheme(event.target.value));
    wrap.querySelectorAll('.theme-choice').forEach(btn => {
      btn.addEventListener('click', () => setTheme(btn.dataset.themeMode));
    });
    wrap.querySelectorAll('.install-app-btn').forEach(btn => {
      btn.addEventListener('click', installApp);
    });
    const toggle = wrap.querySelector('.app-pref-toggle');
    if (toggle) {
      toggle.addEventListener('click', event => {
        event.stopPropagation();
        const open = !wrap.classList.contains('is-open');
        document.querySelectorAll('.app-preferences--navbar.is-open').forEach(el => {
          if (el !== wrap) closePreferencePanel(el);
        });
        wrap.classList.toggle('is-open', open);
        document.body.classList.toggle('app-pref-open', open || !!document.querySelector('.app-preferences--navbar.is-open'));
        toggle.setAttribute('aria-expanded', String(open));
        const icon = toggle.querySelector('.app-pref-chevron');
        if (icon) icon.textContent = open ? '⌃' : '⌄';
      });
      wrap.querySelector('.app-pref-panel').addEventListener('click', event => event.stopPropagation());
    }
    return wrap;
  }

  function closePreferencePanel(wrap) {
    wrap.classList.remove('is-open');
    const toggle = wrap.querySelector('.app-pref-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      const icon = toggle.querySelector('.app-pref-chevron');
      if (icon) icon.textContent = '⌄';
    }
    if (!document.querySelector('.app-preferences--navbar.is-open')) {
      document.body.classList.remove('app-pref-open');
    }
  }

  function injectControls() {
    if (document.querySelector('.app-preferences')) return;

    const navbarRight = document.querySelector('.navbar-right');
    if (navbarRight) {
      const user = navbarRight.querySelector('.nav-user');
      const controls = makeControls(false);
      if (user && user.nextSibling) navbarRight.insertBefore(controls, user.nextSibling);
      else navbarRight.appendChild(controls);
    }

    document.querySelectorAll('.sidebar-footer').forEach(footer => {
      const controls = makeControls(true);
      const user = footer.querySelector('.sidebar-user');
      if (user && user.nextSibling) footer.insertBefore(controls, user.nextSibling);
      else footer.insertBefore(controls, footer.firstChild);
    });

    setTheme(getStoredMode());
    updateInstallButtons();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const script = document.currentScript;
    const swUrl = script ? new URL('../service-worker.js', script.src) : new URL('/service-worker.js', location.href);
    navigator.serviceWorker.register(swUrl.pathname).catch(() => null);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButtons();
    showToast('AUDICOM Hub instalado como app.');
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.app-preferences--navbar.is-open').forEach(closePreferencePanel);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.app-preferences--navbar.is-open').forEach(closePreferencePanel);
    }
  });

  media.addEventListener('change', () => {
    if (getStoredMode() === 'auto') setTheme('auto');
  });

  setTheme(getStoredMode());
  registerServiceWorker();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectControls);
  else injectControls();
})();
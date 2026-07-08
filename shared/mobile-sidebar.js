(function () {
  const mobileQuery = window.matchMedia('(max-width: 820px)');

  function closeSidebar() {
    document.body.classList.remove('mobile-sidebar-open');
    const btn = document.getElementById('mobileSidebarToggle');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fas fa-bars';
    }
  }

  function openSidebar() {
    document.body.classList.add('mobile-sidebar-open');
    const btn = document.getElementById('mobileSidebarToggle');
    if (btn) {
      btn.setAttribute('aria-expanded', 'true');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fas fa-times';
    }
  }

  function scrollContentTop() {
    const content = document.querySelector('.content-area');
    if (content) content.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }

  function initMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('mobileSidebarToggle')) return;

    if (!sidebar.id) sidebar.id = 'projectSidebar';
    const brand = sidebar.querySelector('.sidebar-brand');
    if (brand && !brand.querySelector('.mobile-sidebar-close')) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'mobile-sidebar-close';
      closeBtn.setAttribute('aria-label', 'Fechar menu');
      closeBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
      brand.appendChild(closeBtn);
      closeBtn.addEventListener('click', closeSidebar);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mobileSidebarToggle';
    btn.className = 'mobile-sidebar-toggle';
    btn.setAttribute('aria-controls', sidebar.id);
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<i class="fas fa-bars" aria-hidden="true"></i><span>Menu</span>';

    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-sidebar-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    document.body.appendChild(btn);
    document.body.appendChild(backdrop);

    btn.addEventListener('click', () => {
      if (document.body.classList.contains('mobile-sidebar-open')) closeSidebar();
      else openSidebar();
    });

    backdrop.addEventListener('click', closeSidebar);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSidebar();
    });

    sidebar.addEventListener('click', event => {
      const tab = event.target.closest('.tab-btn');
      if (!tab || !mobileQuery.matches) return;
      setTimeout(() => {
        closeSidebar();
        scrollContentTop();
      }, 0);
    });

    mobileQuery.addEventListener('change', event => {
      if (!event.matches) closeSidebar();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileSidebar);
  } else {
    initMobileSidebar();
  }
})();
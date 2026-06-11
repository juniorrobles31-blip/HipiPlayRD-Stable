export function enableGlobalScroll() {
  const hideRedundantCoinsPanel = () => {
    const labels = ['monedas disponibles', 'moneda disponible', 'monedas disponible'];

    const nodes = Array.from(document.querySelectorAll('main *, .clean-main *, .app-shell *, .mobile-shell *'));

    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;

      const text = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const hasCoinsLabel = labels.some((label) => text.includes(label));

      if (!hasCoinsLabel) continue;

      if (
        node.closest('header') ||
        node.closest('nav') ||
        node.closest('[class*="header"]') ||
        node.closest('[class*="topbar"]') ||
        node.closest('[class*="top-bar"]') ||
        node.closest('[class*="brand"]') ||
        node.closest('[class*="navbar"]')
      ) {
        continue;
      }

      const card = node.closest(
        '.glass, .wallet-card, .balance-card, .metric-card, .stat-card, .summary-card, .result-card, [class*="wallet"], [class*="balance"], [class*="coin"], [class*="metric"], [class*="stat"], [class*="summary"]'
      );

      if (card instanceof HTMLElement) {
        card.classList.add('hipiplay-hide-redundant-coins');
      } else {
        node.classList.add('hipiplay-hide-redundant-coins');
      }
    }
  };

  const unlock = () => {
    document.documentElement.classList.add('hipiplay-scroll-unlocked');
    document.body.classList.add('hipiplay-scroll-unlocked');

    const root = document.getElementById('root');

    if (root) {
      root.classList.add('hipiplay-scroll-root');
    }

    hideRedundantCoinsPanel();
  };

  unlock();

  window.addEventListener('load', unlock, { passive: true });
  window.addEventListener('resize', unlock, { passive: true });
  window.addEventListener('orientationchange', unlock, { passive: true });

  const observer = new MutationObserver(() => {
    hideRedundantCoinsPanel();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

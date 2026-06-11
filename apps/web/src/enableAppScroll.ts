export function enableAppScroll() {
  let lastTouchY = 0;

  const getScrollTarget = () => {
    const shell = document.querySelector(
      '.clean-player-shell, .app-shell, .mobile-app-shell, .main-shell'
    ) as HTMLElement | null;

    return shell || document.scrollingElement || document.documentElement;
  };

  const isInteractive = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;

    return Boolean(
      target.closest(
        'button, input, select, textarea, a, .mobile-bottom-nav, .bottom-nav, .mobile-nav'
      )
    );
  };

  window.addEventListener(
    'wheel',
    (event) => {
      if (isInteractive(event.target)) return;

      const target = getScrollTarget();
      const before = target.scrollTop;

      target.scrollTop += event.deltaY;

      if (target.scrollTop !== before) {
        event.preventDefault();
      }
    },
    { passive: false, capture: true }
  );

  window.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length === 1) {
        lastTouchY = event.touches[0].clientY;
      }
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    'touchmove',
    (event) => {
      if (isInteractive(event.target)) return;
      if (event.touches.length !== 1) return;

      const currentY = event.touches[0].clientY;
      const deltaY = lastTouchY - currentY;
      lastTouchY = currentY;

      const target = getScrollTarget();
      const before = target.scrollTop;

      target.scrollTop += deltaY;

      if (target.scrollTop !== before) {
        event.preventDefault();
      }
    },
    { passive: false, capture: true }
  );
}

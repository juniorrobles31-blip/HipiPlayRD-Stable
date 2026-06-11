export function enableWheelScroll() {
  const getScrollContainer = () => {
    return document.querySelector(
      '.clean-player-shell, .app-shell, .mobile-app-shell, .main-shell'
    ) as HTMLElement | null;
  };

  window.addEventListener(
    'wheel',
    (event) => {
      const container = getScrollContainer();

      if (!container) {
        return;
      }

      const canScroll =
        container.scrollHeight > container.clientHeight;

      if (!canScroll) {
        return;
      }

      container.scrollTop += event.deltaY;
      event.preventDefault();
    },
    { passive: false, capture: true }
  );
}

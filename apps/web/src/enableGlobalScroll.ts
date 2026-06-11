export function enableGlobalScroll() {
  const unlock = () => {
    document.documentElement.classList.add('hipiplay-scroll-unlocked');
    document.body.classList.add('hipiplay-scroll-unlocked');

    const root = document.getElementById('root');

    if (root) {
      root.classList.add('hipiplay-scroll-root');
    }
  };

  unlock();

  window.addEventListener('load', unlock, { passive: true });
  window.addEventListener('resize', unlock, { passive: true });
  window.addEventListener('orientationchange', unlock, { passive: true });
}

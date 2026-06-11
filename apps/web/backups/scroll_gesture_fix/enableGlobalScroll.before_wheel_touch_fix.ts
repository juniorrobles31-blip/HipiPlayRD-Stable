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

  window.addEventListener('load', unlock);
  window.addEventListener('resize', unlock);
  window.addEventListener('orientationchange', unlock);

  let attempts = 0;

  const timer = window.setInterval(() => {
    unlock();
    attempts++;

    if (attempts >= 8) {
      window.clearInterval(timer);
    }
  }, 500);
}

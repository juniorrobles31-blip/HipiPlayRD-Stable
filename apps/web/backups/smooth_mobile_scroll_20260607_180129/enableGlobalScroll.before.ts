function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(
    target.closest(
      'input, textarea, select, button, a, video, [role="button"], [contenteditable="true"]'
    )
  );
}

export function enableGlobalScroll() {
  const unlock = () => {
    document.documentElement.classList.add('hipiplay-scroll-unlocked');
    document.body.classList.add('hipiplay-scroll-unlocked');

    document.documentElement.style.overflowY = 'auto';
    document.documentElement.style.overflowX = 'hidden';
    document.documentElement.style.height = 'auto';
    document.documentElement.style.minHeight = '100%';

    document.body.style.overflowY = 'auto';
    document.body.style.overflowX = 'hidden';
    document.body.style.height = 'auto';
    document.body.style.minHeight = '100%';
    document.body.style.position = 'relative';
    document.body.style.touchAction = 'pan-y';

    const root = document.getElementById('root');

    if (root) {
      root.classList.add('hipiplay-scroll-root');
      root.style.overflow = 'visible';
      root.style.height = 'auto';
      root.style.minHeight = '100dvh';
    }
  };

  unlock();

  window.addEventListener('load', unlock);
  window.addEventListener('resize', unlock);
  window.addEventListener('orientationchange', unlock);

  let lastTouchY = 0;

  const onWheel = (event: WheelEvent) => {
    if (isInteractiveTarget(event.target)) return;

    const before = window.scrollY;
    const deltaY = event.deltaY;

    window.requestAnimationFrame(() => {
      const after = window.scrollY;

      if (Math.abs(after - before) < 1 && Math.abs(deltaY) > 0) {
        window.scrollBy({
          top: deltaY,
          left: 0,
          behavior: 'auto'
        });
      }
    });
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    lastTouchY = event.touches[0].clientY;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    if (isInteractiveTarget(event.target)) return;

    const currentY = event.touches[0].clientY;
    const deltaY = lastTouchY - currentY;

    if (Math.abs(deltaY) > 2) {
      event.preventDefault();

      window.scrollBy({
        top: deltaY,
        left: 0,
        behavior: 'auto'
      });

      lastTouchY = currentY;
    }
  };

  window.addEventListener('wheel', onWheel, { passive: true, capture: true });
  window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });

  let attempts = 0;

  const timer = window.setInterval(() => {
    unlock();
    attempts++;

    if (attempts >= 8) {
      window.clearInterval(timer);
    }
  }, 500);
}

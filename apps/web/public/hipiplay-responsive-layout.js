(function () {
  "use strict";

  function getViewportSize() {
    var vv = window.visualViewport;

    return {
      width: vv && vv.width ? vv.width : window.innerWidth,
      height: vv && vv.height ? vv.height : window.innerHeight
    };
  }

  function updateViewportVars() {
    var size = getViewportSize();
    var height = Math.max(320, Math.round(size.height || window.innerHeight || 0));
    var width = Math.max(240, Math.round(size.width || window.innerWidth || 0));

    document.documentElement.style.setProperty("--hipi-vh", (height * 0.01) + "px");

    document.documentElement.classList.toggle("hipi-h-small", height < 760);
    document.documentElement.classList.toggle("hipi-h-tiny", height < 660);
    document.documentElement.classList.toggle("hipi-w-small", width < 390);
    document.documentElement.classList.toggle("hipi-landscape", width > height);
    document.documentElement.classList.toggle("hipi-portrait", height >= width);
  }

  function fixRootShell() {
    var root = document.getElementById("root");

    if (!root) return;

    root.setAttribute("data-hipi-responsive", "1");

    Array.prototype.forEach.call(root.children || [], function (child) {
      child.classList.add("hipi-force-scroll-fix");
    });
  }

  function fixInputs() {
    document.querySelectorAll("input, textarea, select").forEach(function (el) {
      if (!el.style.fontSize) {
        el.style.fontSize = "16px";
      }
    });
  }

  function apply() {
    updateViewportVars();
    fixRootShell();
    fixInputs();
  }

  function start() {
    apply();

    window.addEventListener("resize", apply, { passive: true });
    window.addEventListener("orientationchange", function () {
      setTimeout(apply, 80);
      setTimeout(apply, 350);
      setTimeout(apply, 900);
    }, { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", apply, { passive: true });
      window.visualViewport.addEventListener("scroll", apply, { passive: true });
    }

    setInterval(apply, 1200);

    try {
      var observer = new MutationObserver(function () {
        apply();
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
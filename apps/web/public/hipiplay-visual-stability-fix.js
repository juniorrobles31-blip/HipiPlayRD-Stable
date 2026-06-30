(function () {
  "use strict";

  var CP1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
    0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
    0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
  };

  function looksBroken(text) {
    return /[ÃÂâð]/.test(String(text || ""));
  }

  function cp1252Byte(code) {
    if (code <= 0xFF) return code;
    if (Object.prototype.hasOwnProperty.call(CP1252, code)) return CP1252[code];
    return null;
  }

  function repairText(text) {
    text = String(text || "");

    if (!looksBroken(text)) return text;

    try {
      var bytes = [];

      for (var i = 0; i < text.length; i++) {
        var b = cp1252Byte(text.charCodeAt(i));
        if (b === null) return text;
        bytes.push(b);
      }

      var decoded = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));

      if (decoded && decoded !== text && decoded.indexOf("\uFFFD") < 0) {
        return decoded;
      }
    } catch (_) {}

    return text;
  }

  function walk(root) {
    if (!root) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;

    while ((node = walker.nextNode())) {
      var oldValue = node.nodeValue;
      var newValue = repairText(oldValue);

      if (newValue !== oldValue) {
        node.nodeValue = newValue;
      }
    }

    var selector = "input, textarea, button, [placeholder], [title], [aria-label]";
    root.querySelectorAll && root.querySelectorAll(selector).forEach(function (el) {
      ["placeholder", "title", "aria-label", "value"].forEach(function (attr) {
        var val = attr === "value" ? el.value : el.getAttribute(attr);
        if (!val) return;

        var fixed = repairText(val);

        if (fixed !== val) {
          if (attr === "value") el.value = fixed;
          else el.setAttribute(attr, fixed);
        }
      });
    });
  }

  function removeOldFloatingWithdrawButton() {
    document.querySelectorAll(".hipi-withdraw-btn").forEach(function (btn) {
      btn.remove();
    });
  }

  function installCss() {
    if (document.getElementById("hipi-only-text-icon-fix-css")) return;

    var style = document.createElement("style");
    style.id = "hipi-only-text-icon-fix-css";
    style.textContent = ".hipi-withdraw-btn{display:none!important;visibility:hidden!important;pointer-events:none!important;}";
    document.head.appendChild(style);
  }

  function apply() {
    walk(document.body || document.documentElement);
    removeOldFloatingWithdrawButton();
  }

  function start() {
    installCss();
    apply();

    setInterval(apply, 1200);

    try {
      var observer = new MutationObserver(function () {
        apply();
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
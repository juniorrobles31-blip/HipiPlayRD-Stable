(function () {
  "use strict";

  var INTRO = "Ingresa tu wallet y el monto.";
  var ROAD = "BSC / BEP20";
  var PROCESSING_MESSAGE = "Procesando pago...";
  var SUCCESS_MESSAGE = "Recarga exitosa.";
  var FAILED_MESSAGE = "Pago no recibido.";
  var STORAGE_KEY = "hipiplay_current_deposit_intent";
  var START_KEY = "hipiplay_current_deposit_started_at";
  var STATUS_KEY = "hipiplay_current_deposit_status";
  var MAX_PENDING_MS = 30 * 1000;

  function now() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function saveFlow(intentId, status) {
    if (!intentId) return;

    try {
      sessionStorage.setItem(STORAGE_KEY, String(intentId));
      sessionStorage.setItem(STATUS_KEY, String(status || "PENDING").toUpperCase());

      if (!sessionStorage.getItem(START_KEY)) {
        sessionStorage.setItem(START_KEY, String(now()));
      }
    } catch {}
  }

  function clearFlow() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(START_KEY);
      sessionStorage.removeItem(STATUS_KEY);
    } catch {}
  }

  function getIntentId() {
    try {
      return String(sessionStorage.getItem(STORAGE_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function getStartedAt() {
    try {
      return Number(sessionStorage.getItem(START_KEY) || "0") || 0;
    } catch {
      return 0;
    }
  }

  function getStoredStatus() {
    try {
      return String(sessionStorage.getItem(STATUS_KEY) || "").trim().toUpperCase();
    } catch {
      return "";
    }
  }

  function normalizeStatus(status) {
    return String(status || "").trim().toUpperCase();
  }

  function isPaid(status) {
    status = normalizeStatus(status);

    return (
      status === "PAID" ||
      status === "CONFIRMED" ||
      status === "COMPLETED" ||
      status === "SUCCESS" ||
      status === "CREDITED"
    );
  }

  function isFailed(status) {
    status = normalizeStatus(status);

    return (
      status === "FAILED" ||
      status === "EXPIRED" ||
      status === "CANCELLED" ||
      status === "CANCELED" ||
      status === "REJECTED" ||
      status === "ERROR"
    );
  }

  function findIntentPayload(data) {
    if (!data || typeof data !== "object") return null;

    var queue = [data];

    while (queue.length) {
      var item = queue.shift();

      if (!item || typeof item !== "object") continue;

      var possibleId =
        item.intentId ||
        item.intent_id ||
        item.id ||
        item.paymentIntentId ||
        item.payment_intent_id;

      if (possibleId && /^PAY-/i.test(String(possibleId))) {
        return {
          intentId: String(possibleId),
          status:
            item.status ||
            item.paymentStatus ||
            item.payment_status ||
            item.state ||
            "PENDING"
        };
      }

      Object.keys(item).forEach(function (key) {
        var value = item[key];

        if (value && typeof value === "object") {
          queue.push(value);
        }
      });
    }

    return null;
  }

  function captureIntentFromResponse(url, method, response) {
    try {
      var urlText = String(url || "");
      var methodText = String(method || "GET").toUpperCase();

      if (urlText.indexOf("/api/public/intents") < 0) return;

      response
        .clone()
        .json()
        .then(function (data) {
          var payload = findIntentPayload(data);

          if (!payload) return;

          saveFlow(payload.intentId, payload.status);

          if (methodText === "POST") {
            setVisualState("processing");
            startPolling();
          }
          else {
            updateFromStatus(payload.status);
          }
        })
        .catch(function () {});
    } catch {}
  }

  function patchFetch() {
    if (!window.fetch || window.__hipiplayRecargaFetchPatched) return;

    window.__hipiplayRecargaFetchPatched = true;

    var originalFetch = window.fetch;

    window.fetch = function () {
      var args = arguments;
      var input = args[0];
      var options = args[1] || {};
      var url = typeof input === "string" ? input : input && input.url;
      var method = options.method || (input && input.method) || "GET";

      return originalFetch.apply(this, args).then(function (response) {
        captureIntentFromResponse(url, method, response);
        return response;
      });
    };
  }

  function currentFlowState() {
    var status = getStoredStatus();
    var startedAt = getStartedAt();

    if (isPaid(status)) return "success";
    if (isFailed(status)) return "failed";

    if (startedAt && now() - startedAt > MAX_PENDING_MS) {
      return "failed";
    }

    if (getIntentId()) return "processing";

    return "";
  }

  function finalMessageForState(state) {
    if (state === "success") return SUCCESS_MESSAGE;
    if (state === "failed") return FAILED_MESSAGE;
    if (state === "processing") return PROCESSING_MESSAGE;
    return "Recarga recibida. Estamos validando el pago.";
  }

  function returnHome() {
    clearFlow();

    try {
      var candidates = Array.prototype.slice.call(document.querySelectorAll("button, a"));

      var home = candidates.find(function (el) {
        var txt = String(el.textContent || "").trim().toLowerCase();

        return (
          txt.indexOf("volver al inicio") >= 0 ||
          txt === "inicio" ||
          txt.indexOf("menú principal") >= 0 ||
          txt.indexOf("menu principal") >= 0
        );
      });

      if (home) {
        home.click();
        return;
      }
    } catch {}

    try {
      window.location.href = "/pwa/";
    } catch {
      location.reload();
    }
  }

  function buildStatusBox(state) {
    var wrapper = document.createElement("div");
    wrapper.className = "hipi-payment-flow-box hipi-payment-flow-" + state;

    var msg = document.createElement("div");
    msg.className = "hipi-payment-flow-message";
    msg.textContent = finalMessageForState(state);

    wrapper.appendChild(msg);

    if (state === "processing") {
      var sub = document.createElement("div");
      sub.className = "hipi-payment-flow-sub";
      sub.textContent = "Por favor espera mientras validamos la recarga.";
      wrapper.appendChild(sub);

      var loader = document.createElement("div");
      loader.className = "hipi-payment-flow-loader";
      wrapper.appendChild(loader);
    }

    if (state === "success" || state === "failed") {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "hipi-payment-flow-accept";
      button.textContent = "Aceptar";
      button.addEventListener("click", returnHome);
      wrapper.appendChild(button);
    }

    return wrapper;
  }

  function replaceTechnicalBlock(element, state) {
    if (!element) return;

    if (element.querySelector && element.querySelector("input, textarea, select")) {
      return;
    }

    var box = buildStatusBox(state);
    element.replaceWith(box);
  }

  function hasTechnicalText(text) {
    text = String(text || "");

    return (
      text.indexOf("Wallet de pago generada") >= 0 ||
      text.indexOf("Wallet destino generada") >= 0 ||
      text.indexOf("PAYMENT_PENDING") >= 0 ||
      text.indexOf("Intent:") >= 0 ||
      text.indexOf("Referencia:") >= 0 ||
      text.indexOf("Enviar USDT") >= 0 ||
      text.indexOf("Dirección de pago") >= 0 ||
      text.indexOf("Direccion de pago") >= 0 ||
      text.indexOf("Copiar dirección de pago") >= 0 ||
      text.indexOf("Copiar direccion de pago") >= 0 ||
      text.indexOf("Recarga recibida. Estamos validando el pago.") >= 0 ||
      /0x[a-fA-F0-9]{40}/.test(text)
    );
  }

  function replaceText(text) {
    text = String(text || "");

    text = text.replace(
      /Ingresa tu wallet y el monto\. Generaremos una direcci[oó]n segura para completar tu recarga\./gi,
      INTRO
    );

    text = text.replace(
      /Escribe tu wallet, detectamos la carretera y generamos la wallet de pago\./gi,
      INTRO
    );

    text = text.replace(
      /Generaremos una direcci[oó]n segura para completar tu recarga\./gi,
      ""
    );

    text = text.replace(/Red validada correctamente\.?/gi, ROAD);
    text = text.replace(/Carretera detectada correctamente\.?/gi, ROAD);

    text = text.replace(/Cantidad USDT a recargar/gi, "Monto");
    text = text.replace(/Monto a recargar/gi, "Monto");
    text = text.replace(/Generar wallet real/gi, "Confirmar recarga");
    text = text.replace(/Generar wallet/gi, "Confirmar recarga");

    var state = currentFlowState();

    if (state) {
      text = text.replace(/Siguiente/gi, "");
      text = text.replace(/Continuar/gi, "");
    }
    else {
      text = text.replace(/Continuar/gi, "Siguiente");
    }

    return text;
  }

  function cleanTextNodes(root) {
    var walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          var parent = node.parentElement;

          if (!parent) return NodeFilter.FILTER_REJECT;

          var tag = String(parent.tagName || "").toLowerCase();

          if (tag === "script" || tag === "style") {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    var nodes = [];
    var node;

    while ((node = walker.nextNode())) {
      nodes.push(node);
    }

    nodes.forEach(function (textNode) {
      var original = textNode.nodeValue || "";
      var next = replaceText(original);

      if (next !== original) {
        textNode.nodeValue = next;
      }
    });
  }

  function cleanButtons() {
    var state = currentFlowState();

    Array.prototype.forEach.call(document.querySelectorAll("button"), function (button) {
      var text = String(button.textContent || "").trim();

      if (button.classList.contains("hipi-payment-flow-accept")) {
        button.style.display = "";
        return;
      }

      if (/copiar direcci[oó]n de pago/i.test(text)) {
        button.style.display = "none";
        return;
      }

      if (state && /siguiente|continuar|confirmar recarga|generar wallet|crear recarga/i.test(text)) {
        button.style.display = "none";
        button.disabled = true;
        return;
      }

      if (!state && /continuar/i.test(text)) {
        button.textContent = "Siguiente";
      }

      if (!state && /generar wallet|generar recarga|crear recarga/i.test(text)) {
        button.textContent = "Confirmar recarga";
      }
    });
  }

  function cleanInputs() {
    Array.prototype.forEach.call(document.querySelectorAll("input"), function (input) {
      var ph = String(input.getAttribute("placeholder") || "");

      ph = ph.replace(/Cantidad USDT a recargar/gi, "Monto");
      ph = ph.replace(/Monto a recargar/gi, "Monto");
      ph = ph.replace(/Tu wallet/gi, "Wallet");

      if (ph) {
        input.setAttribute("placeholder", ph);
      }
    });
  }

  function ensureFlowBox() {
    var state = currentFlowState();

    if (!state) return;

    var existing = document.querySelector(".hipi-payment-flow-box");

    if (existing) {
      existing.className = "hipi-payment-flow-box hipi-payment-flow-" + state;

      var msg = existing.querySelector(".hipi-payment-flow-message");

      if (msg) {
        msg.textContent = finalMessageForState(state);
      }

      var accept = existing.querySelector(".hipi-payment-flow-accept");

      if ((state === "success" || state === "failed") && !accept) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "hipi-payment-flow-accept";
        button.textContent = "Aceptar";
        button.addEventListener("click", returnHome);
        existing.appendChild(button);
      }

      if (state === "processing" && accept) {
        accept.remove();
      }

      return;
    }

    var technicalNodes = Array.prototype.slice.call(
      document.querySelectorAll("pre, code, p, span, small, strong, div, section")
    );

    var target = technicalNodes.find(function (el) {
      return hasTechnicalText(el.textContent || "");
    });

    if (target) {
      replaceTechnicalBlock(target, state);
      return;
    }

    var modal = Array.prototype.slice.call(document.querySelectorAll("div, section")).find(function (el) {
      var txt = String(el.textContent || "").toLowerCase();
      return txt.indexOf("recarga") >= 0 || txt.indexOf("wallet") >= 0 || txt.indexOf("monto") >= 0;
    });

    if (modal) {
      modal.appendChild(buildStatusBox(state));
      return;
    }

    document.body.appendChild(buildStatusBox(state));
  }

  function scrub() {
    if (!document.body) return;

    cleanTextNodes(document.body);
    cleanButtons();
    cleanInputs();
    ensureFlowBox();
  }

  function updateFromStatus(status) {
    status = normalizeStatus(status);

    if (!status) return;

    try {
      sessionStorage.setItem(STATUS_KEY, status);
    } catch {}

    if (isPaid(status)) {
      setVisualState("success");
    }
    else if (isFailed(status)) {
      setVisualState("failed");
    }
    else {
      setVisualState("processing");
    }
  }

  function setVisualState(state) {
    if (state === "success") {
      try {
        sessionStorage.setItem(STATUS_KEY, "PAID");
      } catch {}
    }

    if (state === "failed") {
      try {
        sessionStorage.setItem(STATUS_KEY, "FAILED");
      } catch {}
    }

    scrub();
  }

  function fetchIntentStatus(intentId) {
    if (!intentId) return Promise.resolve(null);

    var urls = [
      "/blockchain-pay/api/public/intents/" + encodeURIComponent(intentId),
      "/api/public/intents/" + encodeURIComponent(intentId)
    ];

    function tryUrl(index) {
      if (index >= urls.length) return Promise.resolve(null);

      return fetch(urls[index], { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (data) {
          var payload = findIntentPayload(data);

          if (payload) {
            saveFlow(payload.intentId || intentId, payload.status);
            return payload.status;
          }

          return null;
        })
        .catch(function () {
          return tryUrl(index + 1);
        });
    }

    return tryUrl(0);
  }

  function startPolling() {
    if (window.__hipiplayRecargaPolling) return;

    window.__hipiplayRecargaPolling = true;

    setInterval(function () {
      var intentId = getIntentId();

      if (!intentId) {
        scrub();
        return;
      }

      var state = currentFlowState();

      if (state === "success" || state === "failed") {
        scrub();
        return;
      }

      setVisualState("processing");

      fetchIntentStatus(intentId).then(function (status) {
        if (status) {
          updateFromStatus(status);
        }
        else {
          scrub();
        }
      });
    }, 3000);
  }

  function installStyles() {
    if (document.getElementById("hipiplay-recarga-production-clean-css")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "hipiplay-recarga-production-clean-css";
    style.textContent =
      ".hipi-payment-flow-box{" +
      "margin-top:12px;" +
      "padding:16px;" +
      "border-radius:18px;" +
      "border:1px solid rgba(34,197,94,.28);" +
      "background:rgba(34,197,94,.10);" +
      "color:rgba(255,255,255,.92);" +
      "font-size:15px;" +
      "font-weight:700;" +
      "line-height:1.4;" +
      "text-align:center;" +
      "white-space:normal!important;" +
      "word-break:normal!important;" +
      "}" +
      ".hipi-payment-flow-message{" +
      "font-size:16px;" +
      "font-weight:900;" +
      "}" +
      ".hipi-payment-flow-sub{" +
      "margin-top:6px;" +
      "font-size:12px;" +
      "font-weight:600;" +
      "opacity:.78;" +
      "}" +
      ".hipi-payment-flow-loader{" +
      "width:26px;" +
      "height:26px;" +
      "margin:12px auto 0;" +
      "border-radius:999px;" +
      "border:3px solid rgba(255,255,255,.22);" +
      "border-top-color:rgba(34,197,94,.95);" +
      "animation:hipiPaySpin .8s linear infinite;" +
      "}" +
      ".hipi-payment-flow-accept{" +
      "width:100%;" +
      "margin-top:14px;" +
      "padding:13px 16px;" +
      "border:0;" +
      "border-radius:14px;" +
      "background:linear-gradient(180deg,#22c55e,#16a34a);" +
      "color:white;" +
      "font-weight:900;" +
      "font-size:15px;" +
      "}" +
      ".hipi-payment-flow-failed{" +
      "border-color:rgba(239,68,68,.35);" +
      "background:rgba(239,68,68,.10);" +
      "}" +
      ".hipi-payment-flow-failed .hipi-payment-flow-accept{" +
      "background:linear-gradient(180deg,#ef4444,#b91c1c);" +
      "}" +
      ".hipi-copy-address-btn{display:none!important;}" +
      "@keyframes hipiPaySpin{to{transform:rotate(360deg);}}";

    document.head.appendChild(style);
  }

  function start() {
    patchFetch();
    installStyles();
    startPolling();
    scrub();

    var observer = new MutationObserver(function () {
      scrub();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    setInterval(scrub, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  }
  else {
    start();
  }
})();
(function () {
  "use strict";

  var API_BASES = [
    "/blockchain-pay/api/public/withdrawals",
    "/api/public/withdrawals"
  ];

  var state = {
    requestId: null,
    polling: null
  };

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function normalizeText(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function injectCss() {
    if (document.getElementById("hipi-withdraw-css")) return;

    var style = document.createElement("style");
    style.id = "hipi-withdraw-css";
    style.textContent = `
      .hipi-withdraw-btn {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      .hipi-withdraw-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.72);
        padding: 18px;
      }

      .hipi-withdraw-backdrop.hipi-show {
        display: flex;
      }

      .hipi-withdraw-modal {
        width: min(92vw, 420px);
        border-radius: 22px;
        padding: 18px;
        color: #fff;
        background: radial-gradient(circle at top, #302a4a, #11111b 70%);
        box-shadow: 0 20px 60px rgba(0,0,0,.55);
        border: 1px solid rgba(255,255,255,.12);
      }

      .hipi-withdraw-title {
        font-size: 20px;
        font-weight: 900;
        margin: 0 0 6px;
      }

      .hipi-withdraw-sub {
        font-size: 13px;
        color: rgba(255,255,255,.72);
        margin: 0 0 14px;
        line-height: 1.35;
      }

      .hipi-withdraw-field {
        margin: 10px 0;
      }

      .hipi-withdraw-field label {
        display: block;
        font-size: 12px;
        font-weight: 800;
        margin-bottom: 6px;
        color: rgba(255,255,255,.82);
      }

      .hipi-withdraw-field input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 14px;
        padding: 12px 12px;
        background: rgba(255,255,255,.08);
        color: #fff;
        outline: none;
        font-size: 16px;
      }

      .hipi-withdraw-network {
        min-height: 20px;
        font-size: 12px;
        font-weight: 800;
        color: #f8d36b;
        margin-top: 6px;
      }

      .hipi-withdraw-actions {
        display: flex;
        gap: 10px;
        margin-top: 14px;
      }

      .hipi-withdraw-actions button {
        flex: 1;
        border: 0;
        border-radius: 14px;
        padding: 12px 10px;
        font-weight: 900;
        cursor: pointer;
      }

      .hipi-withdraw-cancel {
        color: #fff;
        background: rgba(255,255,255,.12);
      }

      .hipi-withdraw-submit {
        color: #101018;
        background: linear-gradient(135deg, #f8d36b, #fff1a8);
      }

      .hipi-withdraw-submit:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      .hipi-withdraw-message {
        margin-top: 12px;
        padding: 11px 12px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.35;
        display: none;
      }

      .hipi-withdraw-message.hipi-show {
        display: block;
      }

      .hipi-withdraw-message.ok {
        background: rgba(44, 210, 128, .14);
        border: 1px solid rgba(44, 210, 128, .28);
        color: #baf8d7;
      }

      .hipi-withdraw-message.err {
        background: rgba(255, 90, 90, .14);
        border: 1px solid rgba(255, 90, 90, .28);
        color: #ffd0d0;
      }

      .hipi-withdraw-message.info {
        background: rgba(248, 211, 107, .12);
        border: 1px solid rgba(248, 211, 107, .25);
        color: #fff1a8;
      }
    `;
    document.head.appendChild(style);
  }

  function getJson(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function findUserObject(value) {
    if (!value || typeof value !== "object") return null;

    if (
      (value.id || value.playerId || value.userId) &&
      (value.username || value.visibleId || value.name || value.displayName)
    ) {
      return value;
    }

    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      var found = findUserObject(value[keys[i]]);
      if (found) return found;
    }

    return null;
  }

  function normalizeUser(user) {
    var playerId =
      user.id ||
      user.playerId ||
      user.userId ||
      user.uid ||
      "";

    var visibleId =
      user.username ||
      user.visibleId ||
      user.userName ||
      user.name ||
      user.displayName ||
      playerId;

    return {
      playerId: String(playerId || "").trim(),
      visibleId: String(visibleId || "").trim()
    };
  }

  function getCurrentUser() {
    var preferred = [
      "hipiplay_user",
      "hipiplayUser",
      "user",
      "currentUser",
      "authUser",
      "player",
      "hipiplay-session",
      "hipiplay_session"
    ];

    for (var i = 0; i < preferred.length; i++) {
      var parsed = getJson(preferred[i]);
      var found = findUserObject(parsed);
      if (found) return normalizeUser(found);
    }

    for (var j = 0; j < localStorage.length; j++) {
      var key = localStorage.key(j);
      var obj = getJson(key);
      var f = findUserObject(obj);
      if (f) return normalizeUser(f);
    }

    var visibleText = document.body ? document.body.innerText : "";
    var idMatch = visibleText.match(/ID[0-9]{3,}/i);

    if (idMatch) {
      return {
        playerId: idMatch[0],
        visibleId: idMatch[0]
      };
    }

    return null;
  }

  function detectNetwork(wallet) {
    wallet = String(wallet || "").trim();

    if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return {
        ok: true,
        networkCode: "BSC_BEP20",
        label: "BSC / BEP20"
      };
    }

    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet)) {
      return {
        ok: true,
        networkCode: "TRON_TRC20",
        label: "TRON / TRC20"
      };
    }

    return {
      ok: false,
      label: ""
    };
  }

  function maskId(id) {
    id = String(id || "");
    if (id.length <= 12) return id;
    return id.slice(0, 8) + "..." + id.slice(-4);
  }

  function setMessage(type, text) {
    var box = document.querySelector(".hipi-withdraw-message");
    if (!box) return;

    box.className = "hipi-withdraw-message hipi-show " + type;
    box.textContent = text;
  }

  async function postWithdrawal(payload) {
    var lastError = null;

    for (var i = 0; i < API_BASES.length; i++) {
      try {
        var response = await fetch(API_BASES[i], {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        var data = await response.json().catch(function () {
          return {};
        });

        if (!response.ok || data.ok !== true) {
          throw new Error(data.error || "No se pudo crear la solicitud.");
        }

        return data;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("No se pudo conectar.");
  }

  async function getWithdrawal(requestId) {
    var lastError = null;

    for (var i = 0; i < API_BASES.length; i++) {
      try {
        var response = await fetch(API_BASES[i] + "/" + encodeURIComponent(requestId), {
          method: "GET",
          headers: {
            "accept": "application/json"
          }
        });

        var data = await response.json().catch(function () {
          return {};
        });

        if (!response.ok || data.ok !== true) {
          throw new Error(data.error || "No se pudo consultar la solicitud.");
        }

        return data;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("No se pudo consultar.");
  }

  function startPolling(requestId) {
    if (state.polling) {
      clearInterval(state.polling);
      state.polling = null;
    }

    state.polling = setInterval(async function () {
      try {
        var data = await getWithdrawal(requestId);
        var w = data.withdrawal || {};

        if (w.status === "PENDING_REVIEW") {
          setMessage("info", "Solicitud recibida. Pendiente de revisión.");
        } else if (w.status === "APPROVED") {
          setMessage("ok", "Solicitud aprobada. Estamos procesando el retiro.");
        } else if (w.status === "REJECTED") {
          clearInterval(state.polling);
          state.polling = null;
          setMessage("err", "Solicitud rechazada.");
        } else if (w.status === "EXECUTED" || w.status === "DRY_RUN_EXECUTED") {
          clearInterval(state.polling);
          state.polling = null;
          setMessage("ok", "Retiro procesado.");
        }
      } catch (_) {}
    }, 5000);
  }

  function openModal() {
    var modal = document.querySelector(".hipi-withdraw-backdrop");

    if (modal) {
      modal.classList.add("hipi-show");
      var amount = modal.querySelector("#hipiWithdrawAmount");

      if (amount) {
        setTimeout(function () {
          amount.focus();
        }, 100);
      }
    }
  }

  function closeModal() {
    var modal = document.querySelector(".hipi-withdraw-backdrop");
    if (modal) modal.classList.remove("hipi-show");
  }

  function removeWrongFloatingButton() {
    document.querySelectorAll(".hipi-withdraw-btn").forEach(function (btn) {
      btn.remove();
    });
  }

  function createModalOnly() {
    injectCss();
    removeWrongFloatingButton();

    if (document.querySelector(".hipi-withdraw-backdrop")) return;

    var backdrop = document.createElement("div");
    backdrop.className = "hipi-withdraw-backdrop";

    backdrop.innerHTML = `
      <div class="hipi-withdraw-modal" role="dialog" aria-modal="true">
        <h2 class="hipi-withdraw-title">Solicitar retiro</h2>
        <p class="hipi-withdraw-sub">Indica el monto y la wallet donde deseas recibir tus USDT.</p>

        <div class="hipi-withdraw-field">
          <label for="hipiWithdrawAmount">Monto a retirar</label>
          <input id="hipiWithdrawAmount" inputmode="decimal" autocomplete="off" placeholder="Ej: 5" />
        </div>

        <div class="hipi-withdraw-field">
          <label for="hipiWithdrawWallet">Wallet destino</label>
          <input id="hipiWithdrawWallet" autocomplete="off" placeholder="0x... o T..." />
          <div class="hipi-withdraw-network"></div>
        </div>

        <div class="hipi-withdraw-actions">
          <button type="button" class="hipi-withdraw-cancel">Cancelar</button>
          <button type="button" class="hipi-withdraw-submit">Solicitar</button>
        </div>

        <div class="hipi-withdraw-message"></div>
      </div>
    `;

    document.body.appendChild(backdrop);

    backdrop.querySelector(".hipi-withdraw-cancel").addEventListener("click", closeModal);

    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) closeModal();
    });

    var walletInput = backdrop.querySelector("#hipiWithdrawWallet");
    var networkBox = backdrop.querySelector(".hipi-withdraw-network");

    walletInput.addEventListener("input", function () {
      var detected = detectNetwork(walletInput.value);
      networkBox.textContent = detected.ok ? detected.label : "";
    });

    backdrop.querySelector(".hipi-withdraw-submit").addEventListener("click", async function () {
      var submit = this;
      var amountInput = backdrop.querySelector("#hipiWithdrawAmount");
      var walletInput = backdrop.querySelector("#hipiWithdrawWallet");

      var amount = String(amountInput.value || "").replace(",", ".").trim();
      var wallet = String(walletInput.value || "").trim();
      var detected = detectNetwork(wallet);
      var user = getCurrentUser();

      if (!user || !user.playerId) {
        setMessage("err", "No se pudo identificar tu sesión. Cierra y vuelve a entrar.");
        return;
      }

      if (!amount || Number(amount) <= 0) {
        setMessage("err", "Coloca un monto válido.");
        return;
      }

      if (!detected.ok) {
        setMessage("err", "Wallet no válida. Usa BSC/BEP20 o TRON/TRC20.");
        return;
      }

      submit.disabled = true;
      setMessage("info", "Enviando solicitud...");

      try {
        var data = await postWithdrawal({
          playerId: user.playerId,
          visibleId: user.visibleId,
          amount: amount,
          destinationWallet: wallet,
          networkCode: detected.networkCode,
          networkLabel: detected.label,
          pwa: "HipiPlay"
        });

        var w = data.withdrawal || {};
        state.requestId = w.requestId;

        setMessage(
          "ok",
          "Solicitud recibida. Pendiente de revisión. No. " + maskId(w.requestId)
        );

        if (w.requestId) {
          startPolling(w.requestId);
        }
      } catch (error) {
        setMessage("err", error.message || "No se pudo crear la solicitud.");
      } finally {
        submit.disabled = false;
      }
    });
  }

  function isExactWithdrawText(element) {
    var text = normalizeText(element.innerText || element.textContent || "");

    return (
      text === "RETIRO USDT" ||
      text === "RETIRAR USDT"
    );
  }

  function isSafeWithdrawTarget(element) {
    if (!element || element.dataset.hipiWithdrawBound === "1") {
      return false;
    }

    if (!isExactWithdrawText(element)) {
      return false;
    }

    var text = normalizeText(element.innerText || element.textContent || "");

    if (text.length > 18) {
      return false;
    }

    var tag = String(element.tagName || "").toLowerCase();

    if (tag === "button" || tag === "a" || element.getAttribute("role") === "button") {
      return true;
    }

    if (tag === "div" || tag === "span") {
      var nestedClickable = element.querySelectorAll
        ? element.querySelectorAll("button, a, [role='button']").length
        : 0;

      var nestedTextElements = element.querySelectorAll
        ? element.querySelectorAll("div, span, p, button, a").length
        : 0;

      return nestedClickable === 0 && nestedTextElements <= 2;
    }

    return false;
  }

  function bindExistingWithdrawButton() {
    createModalOnly();

    var selectors = [
      "button",
      "a",
      "[role='button']",
      "div",
      "span"
    ];

    var candidates = document.querySelectorAll(selectors.join(","));
    var bound = 0;

    candidates.forEach(function (element) {
      if (!isSafeWithdrawTarget(element)) return;

      element.dataset.hipiWithdrawBound = "1";

      element.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openModal();
      }, true);

      bound++;
    });

    document.documentElement.dataset.hipiWithdrawBoundCount = String(bound);
  }

  function keepAlive() {
    removeWrongFloatingButton();
    bindExistingWithdrawButton();

    setInterval(function () {
      removeWrongFloatingButton();
      bindExistingWithdrawButton();
    }, 1500);
  }

  ready(keepAlive);
})();
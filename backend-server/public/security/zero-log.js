(function () {
  const SENSITIVE_PATTERNS = [
    "seed",
    "mnemonic",
    "privatekey",
    "private_key",
    "secret",
    "password",
    "phrase",
    "recovery",
    "clave privada",
    "semilla"
  ];

  function containsSensitiveData(args) {
    try {
      const text = JSON.stringify(args).toLowerCase();
      return SENSITIVE_PATTERNS.some(function (pattern) {
        return text.includes(pattern.toLowerCase());
      });
    } catch {
      return false;
    }
  }

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;

  console.log = function (...args) {
    if (containsSensitiveData(args)) {
      originalLog("[ZERO-LOG] Registro sensible bloqueado");
      return;
    }
    originalLog.apply(console, args);
  };

  console.warn = function (...args) {
    if (containsSensitiveData(args)) {
      originalWarn("[ZERO-LOG] Advertencia sensible bloqueada");
      return;
    }
    originalWarn.apply(console, args);
  };

  console.error = function (...args) {
    if (containsSensitiveData(args)) {
      originalError("[ZERO-LOG] Error sensible bloqueado");
      return;
    }
    originalError.apply(console, args);
  };

  console.info = function (...args) {
    if (containsSensitiveData(args)) {
      originalInfo("[ZERO-LOG] Información sensible bloqueada");
      return;
    }
    originalInfo.apply(console, args);
  };

  window.HipiZeroLog = {
    enabled: true
  };
})();

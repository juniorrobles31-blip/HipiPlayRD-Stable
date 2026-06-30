async function wipeLocalPwaData() {
  try {
    localStorage.clear();
    sessionStorage.clear();

    if ("indexedDB" in window && indexedDB.databases) {
      const databases = await indexedDB.databases();

      await Promise.all(
        databases.map(function (db) {
          if (!db.name) return Promise.resolve();

          return new Promise(function (resolve) {
            const request = indexedDB.deleteDatabase(db.name);

            request.onsuccess = function () { resolve(); };
            request.onerror = function () { resolve(); };
            request.onblocked = function () { resolve(); };
          });
        })
      );
    }

    if ("caches" in window) {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames.map(function (cacheName) {
          return caches.delete(cacheName);
        })
      );
    }

    document.cookie.split(";").forEach(function (cookie) {
      const name = cookie.split("=")[0].trim();

      if (name) {
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
      }
    });

    return true;
  } catch (error) {
    console.error("Error ejecutando limpieza local");
    return false;
  }
}

async function wipeAndReloadPwa() {
  const confirmDelete = confirm(
    "Esto borrará los datos locales de esta PWA en este dispositivo. Si no tienes tu semilla guardada físicamente, perderás el acceso. ¿Deseas continuar?"
  );

  if (!confirmDelete) return;

  await wipeLocalPwaData();

  alert("Datos locales eliminados.");
  window.location.reload();
}

window.HipiSecureWipe = {
  wipeLocalPwaData,
  wipeAndReloadPwa
};

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => console.log("HipiPlay service worker registrado."))
      .catch((error) => console.error("Error registrando service worker:", error));
  });
}

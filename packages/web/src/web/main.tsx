// Entry referenced by index.html — composition only.
import "./lib/auth-redirect";
import "./__main";

// PWA: regista o service worker.
// Nota: `import.meta.env.PROD` não é fiável neste projeto (o vite.config carrega o .env da raiz,
// que define NODE_ENV=development, e o Vite herda-o). O registo é saltado no servidor de
// desenvolvimento do Vite, que é o único sítio onde o SW incomodaria (HMR + módulos sem hash).
const isViteDev = import.meta.env.DEV === true && "__vite__injectQuery" in window;
if ("serviceWorker" in navigator && !isViteDev) {
  // Em contexto não seguro (http:// num IP de LAN) o registo falha — ignoramos em silêncio.
  navigator.serviceWorker.register("/sw.js").catch(() => {});

  // Verifica se há um sw.js novo a cada arranque e quando a app volta ao primeiro plano.
  // Sem isto, o browser pode ficar até 24h com a versão antiga registada — e como o
  // activate é que limpa a cache antiga, o utilizador ficaria preso num build velho.
  const checkUpdate = () => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.update().catch(() => {});
    }).catch(() => {});
  };
  checkUpdate();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkUpdate();
  });
}

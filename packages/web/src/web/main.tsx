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
}

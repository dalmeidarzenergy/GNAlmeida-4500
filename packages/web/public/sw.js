// Service Worker do CRM D2D Consulting — cache básica.
// Estratégia:
//   - Navegação (HTML): rede primeiro, fallback para a shell em cache (modo offline).
//   - Assets estáticos: cache primeiro (os ficheiros do build têm nomes com hash).
//   - API e autenticação (/api/): sempre pela rede, nunca em cache.

const CACHE_NAME = "d2dconsulting-v2";

// Nota: as splash screens NÃO entram no precache — são ~560 KB de imagens que
// a maioria dos dispositivos nunca usa (só o iOS em modo standalone). São
// guardadas em cache na primeira utilização, pela regra "cache primeiro".
const SHELL = [
  "/",
  "/manifest.json",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Só tratamos pedidos do nosso próprio domínio (fonts e afins ficam de fora).
  if (url.origin !== self.location.origin) return;

  // API e autenticação: sempre rede, nunca cache.
  if (url.pathname.startsWith("/api/")) return;

  // Navegação: rede primeiro; offline → shell em cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Assets estáticos: cache primeiro, guarda a resposta quando não estava em cache.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

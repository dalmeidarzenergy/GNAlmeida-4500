import app from "./api";
import { PUBLIC_DIR } from "./api/lib/public-files";

const port = Number(process.env.PORT ?? 3000);
const distDir = `${import.meta.dirname}/../dist`;
const indexPath = `${distDir}/index.html`;

/** Extensões comprimíveis (texto). Imagens/PDF já são comprimidas. */
const COMPRESSIBLE = /\.(js|css|html|json|svg|xml|txt|map|webmanifest|ico)$/i;
/** Ficheiros com nome hasheado (assets do Vite) — imutáveis, cache agressivo. */
const IMMUTABLE = /^\/assets\//;

/** Cache em memória dos ficheiros estáticos já comprimidos (evita re-gerar gzip). */
const gzipCache = new Map<string, { mtime: number; buf: Uint8Array<ArrayBuffer> }>();

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, "").replaceAll("..", "");
  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}

async function serveStatic(filePath: string, request: Request): Promise<Response | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  const pathname = new URL(request.url).pathname;
  const acceptsGzip = /\bgzip\b/.test(request.headers.get("Accept-Encoding") ?? "");
  const headers = new Headers();

  if (IMMUTABLE.test(pathname)) {
    // Nome com hash → o conteúdo nunca muda, guardar 1 ano.
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (filePath.endsWith(".html")) {
    headers.set("Cache-Control", "no-cache");
  } else if (pathname === "/sw.js" || pathname === "/manifest.json") {
    // O browser guarda o service worker por omissão durante 24h (alguns ignoram
    // o pedido de atualização durante esse tempo). Sem no-cache, uma versão nova
    // nunca é detetada e o utilizador fica preso na cache antiga indefinidamente.
    headers.set("Cache-Control", "no-cache");
  }

  const compressible = COMPRESSIBLE.test(pathname);
  if (compressible && acceptsGzip) {
    const stat = await file.stat();
    const key = filePath;
    const cached = gzipCache.get(key);
    let buf: Uint8Array<ArrayBuffer>;
    if (cached && cached.mtime === stat.mtimeMs) {
      buf = cached.buf;
    } else {
      buf = Bun.gzipSync(new Uint8Array(await file.arrayBuffer()));
      gzipCache.set(key, { mtime: stat.mtimeMs, buf });
    }
    headers.set("Content-Type", file.type || "application/octet-stream");
    headers.set("Content-Encoding", "gzip");
    headers.set("Vary", "Accept-Encoding");
    return new Response(new Uint8Array(buf), { headers });
  }

  return new Response(file, { headers });
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api")) {
      return app.fetch(request);
    }

    const staticRes = await serveStatic(getStaticFilePath(url.pathname), request);
    if (staticRes) return staticRes;

    // Ficheiros gerados em runtime (ex.: autos de pagamento em PDF) vivem em
    // public/uploads e nao sao copiados para dist pelo build: servir do repo.
    if (url.pathname.startsWith("/uploads/")) {
      const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, "").replaceAll("..", "");
      const upload = Bun.file(`${PUBLIC_DIR}/${cleanPath}`);
      if (await upload.exists()) {
        return new Response(upload);
      }
      return new Response("Not found", { status: 404 });
    }

    const index = Bun.file(indexPath);
    if (await index.exists()) {
      return new Response(index, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    return new Response("Build output not found. Run `bun run build` first.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`Web server listening on http://localhost:${server.port}`);

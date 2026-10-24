import app from "./api";

const port = Number(process.env.PORT ?? 3000);
const distDir = `${import.meta.dirname}/../dist`;
const publicDir = `${import.meta.dirname}/../public`;
const indexPath = `${distDir}/index.html`;

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api")) {
      return app.fetch(request);
    }

    const filePath = getStaticFilePath(url.pathname);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    // Ficheiros gerados em runtime (ex.: autos de pagamento em PDF) vivem em
    // public/uploads e nao sao copiados para dist pelo build: servir do repo.
    if (url.pathname.startsWith("/uploads/")) {
      const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, "").replaceAll("..", "");
      const upload = Bun.file(`${publicDir}/${cleanPath}`);
      if (await upload.exists()) {
        return new Response(upload);
      }
      return new Response("Not found", { status: 404 });
    }

    const index = Bun.file(indexPath);
    if (await index.exists()) {
      return new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Build output not found. Run `bun run build` first.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`Web server listening on http://localhost:${server.port}`);

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, "").replaceAll("..", "");

  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}

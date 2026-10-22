// Production & dev entrypoint: resolve o caminho da BD SQLite como
// absoluto. Se houver um volume persistente montado (Fly.io), copia
// o data.db para lá no primeiro arranque e usa-o — assim os dados
// sobrevivem a redeploys.
import { existsSync, copyFileSync } from "node:fs";

const bundledDb = `${import.meta.dirname}/data.db`;
const volumeDir = "/data";
const volumeDb = `${volumeDir}/data.db`;

if (existsSync(volumeDir)) {
  // Volume persistente disponível — copiar seed se ainda não existir
  if (!existsSync(volumeDb)) {
    copyFileSync(bundledDb, volumeDb);
    console.log(`BD copiada para volume persistente: ${volumeDb}`);
  }
  process.env.DATABASE_URL = `file:${volumeDb}`;
} else {
  // Ambiente local / dev — usar BD junto ao código
  process.env.DATABASE_URL = `file:${bundledDb}`;
}

// Import dinâmico — só depois de DATABASE_URL estar definido
await import("./__server");
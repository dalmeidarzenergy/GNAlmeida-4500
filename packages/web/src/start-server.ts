// Production & dev entrypoint: resolve o caminho da BD SQLite como
// absoluto antes do servidor arrancar, para que o DATABASE_URL relativo
// não parta quando o cwd difere entre ambientes.
process.env.DATABASE_URL = `file:${import.meta.dirname}/data.db`;

import "./__server";
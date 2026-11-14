import { Pool, type PoolConfig } from "pg"
import { AsyncLocalStorage } from "node:async_hooks"
import { drizzle } from "drizzle-orm/node-postgres"
import { selectedDatabaseBackend } from "../backend"
import { isLocalPostgresTestMarker } from "./local-test-marker"
import * as schema from "./schema"

export const NEW_PROJECT_DIRECT_HOST = "ep-super-meadow-az4e41mn.c-3.ap-southeast-1.aws.neon.tech"
export const NEW_PROJECT_POOLED_HOST = "ep-super-meadow-az4e41mn-pooler.c-3.ap-southeast-1.aws.neon.tech"

export function postgresRuntimePoolConfig(source: Record<string, string | undefined> = process.env): PoolConfig {
  if (selectedDatabaseBackend(source) !== "postgres") throw new Error("CN_DB_BACKEND=postgres is required for PostgreSQL runtime access.")
  if (source.CN_PG_LOCAL_TEST_ENABLED === "true") {
    const socket = source.CN_PG_LOCAL_TEST_SOCKET?.trim() ?? ""
    if (source.NODE_ENV !== "development" || source.LOCAL_DEV_AUTH_ENABLED !== "true" || source.DATABASE_URL?.trim() || !isLocalPostgresTestMarker(socket)) {
      throw new Error("Local PostgreSQL test access requires development auth, an isolated Step 3C socket, and no DATABASE_URL.")
    }
    // The Cloudflare local worker's node:net shim requires a TCP host and port.
    // The marker socket path is validated by Vite and ties this opt-in to a
    // disposable Step 3C cluster; PostgreSQL itself listens on loopback only.
    return { host: "127.0.0.1", port: 55433, user: "cn_step3c_test", database: "cn_step3c_fixture", max: 5, maxUses: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 }
  }
  if (source.CN_PG_LOCAL_DEV_ENABLED === "true") {
    // Loopback cluster created by scripts/dev-local-windows.mjs with fictional
    // fixtures. Same pool shape as the validated local test gate.
    if (source.NODE_ENV !== "development" || source.LOCAL_DEV_AUTH_ENABLED !== "true" || source.DATABASE_URL?.trim()) {
      throw new Error("Local PostgreSQL development access requires development auth and no DATABASE_URL.")
    }
    return { host: "127.0.0.1", port: 55432, user: "cn_local_dev", database: "cn_local_dev", max: 5, maxUses: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 }
  }
  const raw = source.DATABASE_URL?.trim()
  if (!raw) throw new Error("DATABASE_URL is required for PostgreSQL runtime access.")
  let target: URL
  try { target = new URL(raw) } catch { throw new Error("DATABASE_URL is invalid.") }
  if (target.protocol !== "postgresql:" || target.hostname !== NEW_PROJECT_POOLED_HOST || target.pathname !== "/corporate_network" || target.searchParams.get("sslmode") !== "require") {
    throw new Error("DATABASE_URL must use the new project's pooled Neon endpoint, corporate_network, and sslmode=require.")
  }
  if (!target.username || !target.password) throw new Error("DATABASE_URL must include a database role and password.")
  // A Cloudflare request cannot resume I/O on a connection opened by a prior
  // request. Retire each checked-out client when its query/transaction ends.
  return { connectionString: raw, max: 5, maxUses: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 }
}

/** A real node-postgres pool; test callers supply a disposable local pool. */
export function postgresDatabaseFromPool(pool: Pool) {
  return drizzle({ client: pool, schema })
}

export function openPostgresRuntime(source: Record<string, string | undefined> = process.env) {
  const pool = new Pool(postgresRuntimePoolConfig(source))
  return { pool, db: postgresDatabaseFromPool(pool) }
}

type PostgresRequest = { runtime?: ReturnType<typeof openPostgresRuntime> }
const requestDatabase = new AsyncLocalStorage<PostgresRequest>()

/** A Worker request owns its pool; sockets must never cross request contexts. */
export function withPostgresRequest<T>(operation: () => Promise<T>): Promise<T> {
  const request: PostgresRequest = {}
  return requestDatabase.run(request, async () => {
    try {
      return await operation()
    } finally {
      if (request.runtime) await request.runtime.pool.end()
    }
  })
}

/** Lazily share a database only within the current Worker request. */
export function getPostgresDb() {
  const request = requestDatabase.getStore()
  if (!request) throw new Error("PostgreSQL access requires a Worker request context.")
  if (!request.runtime) request.runtime = openPostgresRuntime()
  return request.runtime.db
}

export type PostgresDatabase = ReturnType<typeof postgresDatabaseFromPool>

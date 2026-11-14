// Platform details for the disposable PostgreSQL 17 test clusters.
// macOS keeps the original Homebrew binaries and Unix-socket clusters.
// Windows uses the git-ignored portable binaries under .sites-runtime and a
// loopback-only TCP listener, because node-postgres cannot reach a Windows
// socket path. Both platforms use `initdb -A trust` on a throwaway cluster.
import { spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const windows = process.platform === "win32"
const root = fileURLToPath(new URL("../..", import.meta.url))

export const pgBin = process.env.PG_TEST_BIN
  || (windows ? join(root, ".sites-runtime", "postgresql17", "pgsql", "bin") : "/opt/homebrew/opt/postgresql@17/bin")

export const pgExecutable = name => join(pgBin, windows ? `${name}.exe` : name)

/**
 * pg_ctl without captured output. On Windows the started postmaster inherits
 * pg_ctl's stdio pipes, so execFile would wait until the server exits. The
 * server log is still written to the `-l` file.
 */
export function pgCtl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pgExecutable("pg_ctl"), args, { stdio: "ignore", windowsHide: true, env: { ...process.env, LC_ALL: "C", LANG: "C" } })
    child.once("error", reject)
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`pg_ctl ${args.filter(arg => ["start", "stop"].includes(arg)).join(" ")} exited with ${code}`)))
  })
}

/**
 * Prefix for the HTTP acceptance clusters. The Windows form satisfies the
 * shared `isLocalPostgresTestMarker` gate and the existing
 * `corporate-network-local-` isolated-D1 rule.
 */
export const httpTemporaryPrefix = name => windows
  ? join(realpathSync.native(tmpdir()), `corporate-network-local-${name}-`)
  : `/private/tmp/${name}-`

/**
 * postgresql.conf additions and client host for one cluster.
 * `tcp` keeps the original macOS loopback listener for the HTTP suite.
 */
export function clusterSettings(socketDir, { port, windowsPort = port, tcp = false }) {
  if (windows) {
    return { conf: `\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nport = ${windowsPort}\n`, host: "127.0.0.1", port: windowsPort }
  }
  return { conf: `\nlisten_addresses = '${tcp ? "127.0.0.1" : ""}'\nunix_socket_directories = '${socketDir}'\nport = ${port}\n`, host: socketDir, port }
}

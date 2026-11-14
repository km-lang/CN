// Marker directory that ties CN_PG_LOCAL_TEST_ENABLED to one disposable Step 3C
// cluster. macOS keeps the original /private/tmp form. Windows uses the
// per-user Temp directory with the existing `corporate-network-local-` prefix
// already required by the local isolated-D1 gates. Vite additionally requires
// the directory to exist with an unchanged real path.
const MACOS_MARKER = /^\/private\/tmp\/cn-step3c-postgres-[A-Za-z0-9]+\/socket$/
const WINDOWS_MARKER = /^[A-Za-z]:\\Users\\[^\\/:*?"<>|]+\\AppData\\Local\\Temp\\corporate-network-local-cn-step3c-postgres-[A-Za-z0-9]+\\socket$/

export function isLocalPostgresTestMarker(path: string) {
  if (path.split(/[\\/]/).some(segment => segment === "." || segment === "..")) return false
  return MACOS_MARKER.test(path) || WINDOWS_MARKER.test(path)
}

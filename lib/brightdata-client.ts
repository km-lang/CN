export const BRIGHTDATA_API_BASE = "https://api.brightdata.com"
export const BRIGHTDATA_TRIGGER_PATH = "/datasets/v3/trigger"
export const BRIGHTDATA_PROGRESS_PATH = "/datasets/v3/progress"
export const BRIGHTDATA_SNAPSHOT_PATH = "/datasets/v3/snapshot"

export type BrightDataProgress = { status: "pending" | "running" | "ready" | "failed"; error?: string }

export class BrightDataProviderError extends Error {
  constructor(message: string, public readonly status = 502, public readonly category = "provider_error") {
    super(message)
    this.name = "BrightDataProviderError"
  }
}

type ClientOptions = { token: string; datasetId: string; baseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number }

function safeProviderMessage(status: number) {
  if (status === 401 || status === 403) return "Bright Data rejected the configured server credential or dataset access."
  if (status === 404) return "The configured Bright Data dataset or snapshot was not found."
  if (status === 429) return "Bright Data rate-limited the request. No automatic retry was made."
  return `Bright Data returned HTTP ${status}. No automatic retry was made.`
}

export class BrightDataClient {
  private readonly fetcher: typeof fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(private readonly options: ClientOptions) {
    if (!options.token.trim()) throw new Error("BRIGHTDATA_API_TOKEN is required.")
    if (!options.datasetId.trim()) throw new Error("BRIGHTDATA_DATASET_ID is required.")
    this.fetcher = options.fetcher ?? fetch
    this.baseUrl = options.baseUrl ?? BRIGHTDATA_API_BASE
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  private async request(path: string, init: RequestInit = {}) {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json", ...init.headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new BrightDataProviderError(error instanceof Error ? error.message : "Bright Data transport failed.", 504, "transport_ambiguous")
    }
    if (!response.ok) throw new BrightDataProviderError(safeProviderMessage(response.status), response.status, "provider_rejected")
    return response
  }

  async triggerProfile(profileUrl: string) {
    const query = new URLSearchParams({ dataset_id: this.options.datasetId, format: "json", uncompressed_webhook: "true", include_errors: "true" })
    const response = await this.request(`${BRIGHTDATA_TRIGGER_PATH}?${query}`, { method: "POST", body: JSON.stringify([{ url: profileUrl }]) })
    const payload = await response.json() as { snapshot_id?: unknown }
    if (typeof payload.snapshot_id !== "string" || !payload.snapshot_id.trim()) throw new BrightDataProviderError("Bright Data accepted the trigger but omitted a snapshot ID.", 502, "trigger_outcome_ambiguous")
    return payload.snapshot_id.trim()
  }

  async progress(snapshotId: string): Promise<BrightDataProgress> {
    const response = await this.request(`${BRIGHTDATA_PROGRESS_PATH}/${encodeURIComponent(snapshotId)}`)
    const payload = await response.json() as { status?: unknown; error?: unknown }
    const status = typeof payload.status === "string" ? payload.status.toLowerCase() : ""
    if (["ready", "success", "completed"].includes(status)) return { status: "ready" }
    if (["failed", "error", "cancelled"].includes(status)) return { status: "failed", ...(typeof payload.error === "string" ? { error: payload.error.slice(0, 500) } : {}) }
    if (["starting", "pending", "queued"].includes(status)) return { status: "pending" }
    if (status === "running") return { status: "running" }
    throw new BrightDataProviderError("Bright Data returned an unrecognized snapshot status.", 502, "malformed_status")
  }

  async download(snapshotId: string) {
    const response = await this.request(`${BRIGHTDATA_SNAPSHOT_PATH}/${encodeURIComponent(snapshotId)}?format=json`)
    const payload = await response.json()
    if (!Array.isArray(payload)) throw new BrightDataProviderError("Bright Data snapshot response was not a JSON array.", 502, "malformed_result")
    return payload.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[]
  }
}

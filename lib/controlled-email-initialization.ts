export type ControlledEmailInitializationResult<T> =
  | { status: "ready"; value: T }
  | { status: "error"; message: string }
  | { status: "cancelled" }

type InitializationOptions<T> = {
  request: (signal: AbortSignal) => Promise<T>
  signal?: AbortSignal
  timeoutMs: number
  timeoutMessage: string
  errorMessage: string
}

function abortError() {
  return new DOMException("The controlled email initialization was cancelled.", "AbortError")
}

export async function initializeControlledEmail<T>({
  request,
  signal,
  timeoutMs,
  timeoutMessage,
  errorMessage,
}: InitializationOptions<T>): Promise<ControlledEmailInitializationResult<T>> {
  if (signal?.aborted) return { status: "cancelled" }

  const controller = new AbortController()
  let timedOut = false
  let rejectCancellation: ((reason: DOMException) => void) | undefined
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject
  })
  const cancel = () => {
    const reason = signal?.reason instanceof DOMException ? signal.reason : abortError()
    controller.abort(reason)
    rejectCancellation?.(reason)
  }
  signal?.addEventListener("abort", cancel, { once: true })

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort(abortError())
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  try {
    const value = await Promise.race([request(controller.signal), deadline, cancellation])
    return { status: "ready", value }
  } catch (error) {
    if (timedOut) return { status: "error", message: timeoutMessage }
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return { status: "cancelled" }
    }
    return { status: "error", message: error instanceof Error && error.message ? error.message : errorMessage }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    signal?.removeEventListener("abort", cancel)
  }
}

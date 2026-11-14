export class AccessError extends Error {
  constructor(message: string, public readonly status: 401 | 403, public readonly code: string) {
    super(message)
  }
}

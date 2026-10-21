/** Read-only synthetic test shim; the real D1 binding is never opened. */
export const env: { DB: unknown } = { DB: undefined }

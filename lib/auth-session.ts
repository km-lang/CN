import type { IdentityProvider } from "@/lib/auth-config"

export const APP_SESSION_COOKIE = "corporate_network_session"
export const GOOGLE_OAUTH_COOKIE = "corporate_network_google_oauth"
const SESSION_TTL_SECONDS = 8 * 60 * 60
const OAUTH_TTL_SECONDS = 10 * 60

export type AppSessionClaims = {
  kind: "app_session"
  version: 1
  applicationUserId: number
  applicationIdentityId: number
  provider: IdentityProvider
  issuedAt: number
  expiresAt: number
}

export type GoogleOAuthClaims = {
  kind: "google_oauth"
  version: 1
  state: string
  nonce: string
  codeVerifier: string
  returnTo: string
  issuedAt: number
  expiresAt: number
}

export async function createAppSessionToken(input: Pick<AppSessionClaims, "applicationUserId" | "applicationIdentityId" | "provider">) {
  const issuedAt = epochSeconds()
  return signClaims({ kind: "app_session", version: 1, ...input, issuedAt, expiresAt: issuedAt + SESSION_TTL_SECONDS })
}

export async function verifyAppSessionToken(token: string | null | undefined): Promise<AppSessionClaims | null> {
  const claims = await verifyClaims(token)
  if (!claims || claims.kind !== "app_session" || claims.version !== 1) return null
  if (!Number.isInteger(claims.applicationUserId) || !Number.isInteger(claims.applicationIdentityId)) return null
  if (claims.provider !== "google_workspace" && claims.provider !== "chatgpt") return null
  return claims as AppSessionClaims
}

export async function createGoogleOAuthToken(input: Pick<GoogleOAuthClaims, "state" | "nonce" | "codeVerifier" | "returnTo">) {
  const issuedAt = epochSeconds()
  return signClaims({ kind: "google_oauth", version: 1, ...input, issuedAt, expiresAt: issuedAt + OAUTH_TTL_SECONDS })
}

export async function verifyGoogleOAuthToken(token: string | null | undefined): Promise<GoogleOAuthClaims | null> {
  const claims = await verifyClaims(token)
  if (!claims || claims.kind !== "google_oauth" || claims.version !== 1) return null
  if (!claims.state || !claims.nonce || !claims.codeVerifier || !claims.returnTo) return null
  return claims as GoogleOAuthClaims
}

export function sessionCookie(token: string, options: { secure?: boolean } = {}) {
  return serializeCookie(APP_SESSION_COOKIE, token, SESSION_TTL_SECONDS, options.secure ?? true)
}

export function googleOAuthCookie(token: string) {
  return serializeCookie(GOOGLE_OAUTH_COOKIE, token, OAUTH_TTL_SECONDS)
}

export function clearSessionCookie(options: { secure?: boolean } = {}) {
  return serializeCookie(APP_SESSION_COOKIE, "", 0, options.secure ?? true)
}

export function clearGoogleOAuthCookie() {
  return serializeCookie(GOOGLE_OAUTH_COOKIE, "", 0)
}

export function cookieValue(cookieHeader: string | null | undefined, name: string) {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=")
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim())
  }
  return null
}

function serializeCookie(name: string, value: string, maxAge: number, secure = true) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax`
}

async function signClaims(claims: Record<string, unknown>) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)))
  const signature = await hmac(payload)
  return `${payload}.${base64UrlEncode(signature)}`
}

async function verifyClaims(token: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!token) return null
  const [payload, signature, extra] = token.split(".")
  if (!payload || !signature || extra) return null
  try {
    const actual = base64UrlDecode(signature)
    const expected = await hmac(payload)
    if (!constantTimeEqual(actual, expected)) return null
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as Record<string, unknown>
    const expiresAt = Number(claims.expiresAt)
    const issuedAt = Number(claims.issuedAt)
    if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt)) return null
    if (expiresAt <= epochSeconds() || issuedAt > epochSeconds() + 60) return null
    return claims
  } catch {
    return null
  }
}

async function hmac(payload: string) {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() ?? ""
  if (secret.length < 32) throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters.")
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function epochSeconds() {
  return Math.floor(Date.now() / 1000)
}

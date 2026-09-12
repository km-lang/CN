import { googleOAuthConfiguration } from "@/lib/auth-config"

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs"

type GoogleIdTokenClaims = {
  iss?: string
  aud?: string
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  hd?: string
  nonce?: string
  iat?: number
  exp?: number
}

type GoogleJwk = JsonWebKey & { kid?: string }
type GoogleJwks = { keys?: GoogleJwk[] }

export class GoogleOidcError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
  }
}

export async function createGoogleAuthorizationRequest(returnTo: string) {
  const config = requiredConfiguration()
  const state = randomBase64Url(32)
  const nonce = randomBase64Url(32)
  const codeVerifier = randomBase64Url(64)
  const codeChallenge = base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))))
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.callbackUrl)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("nonce", nonce)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("hd", config.allowedDomain)
  url.searchParams.set("prompt", "select_account")
  return { authorizationUrl: url.toString(), state, nonce, codeVerifier, returnTo }
}

export async function exchangeGoogleAuthorizationCode(code: string, codeVerifier: string, expectedNonce: string) {
  const config = requiredConfiguration()
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  })
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  const result = await response.json().catch(() => ({})) as { id_token?: string; error?: string }
  if (!response.ok || !result.id_token) throw new GoogleOidcError("Google Workspace could not complete authentication.", "token_exchange_failed")
  return verifyGoogleIdToken(result.id_token, expectedNonce)
}

export async function verifyGoogleIdToken(idToken: string, expectedNonce: string) {
  const config = requiredConfiguration()
  const [encodedHeader, encodedPayload, encodedSignature, extra] = idToken.split(".")
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra) throw new GoogleOidcError("Google returned an invalid identity token.", "invalid_id_token")
  let header: { alg?: string; kid?: string }
  let claims: GoogleIdTokenClaims
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedHeader)))
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)))
  } catch {
    throw new GoogleOidcError("Google returned an invalid identity token.", "invalid_id_token")
  }
  if (header.alg !== "RS256" || !header.kid) throw new GoogleOidcError("Google returned an unsupported identity token.", "invalid_id_token_algorithm")
  const jwksResponse = await fetch(GOOGLE_JWKS_ENDPOINT, { headers: { accept: "application/json" } })
  if (!jwksResponse.ok) throw new GoogleOidcError("Google identity keys are temporarily unavailable.", "jwks_unavailable")
  const jwks = await jwksResponse.json() as GoogleJwks
  const jwk = jwks.keys?.find(key => key.kid === header.kid && key.kty === "RSA")
  if (!jwk) throw new GoogleOidcError("Google returned an identity token signed by an unknown key.", "unknown_signing_key")
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlDecode(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`))
  if (!verified) throw new GoogleOidcError("Google identity-token verification failed.", "invalid_id_token_signature")

  const now = Math.floor(Date.now() / 1000)
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new GoogleOidcError("Google returned an unexpected token issuer.", "invalid_issuer")
  if (claims.aud !== config.clientId) throw new GoogleOidcError("Google returned a token for another application.", "invalid_audience")
  if (!claims.exp || claims.exp <= now || !claims.iat || claims.iat > now + 60) throw new GoogleOidcError("The Google identity token is expired or not yet valid.", "invalid_token_time")
  if (!claims.nonce || claims.nonce !== expectedNonce) throw new GoogleOidcError("Google sign-in state could not be verified.", "invalid_nonce")
  if (!claims.sub || !claims.email || claims.email_verified !== true) throw new GoogleOidcError("A verified Google email identity is required.", "email_not_verified")
  const email = claims.email.trim().toLowerCase()
  const hostedDomain = claims.hd?.trim().toLowerCase() ?? ""
  if (hostedDomain !== config.allowedDomain || !email.endsWith(`@${config.allowedDomain}`)) {
    throw new GoogleOidcError(`Use an approved ${config.allowedDomain} Google Workspace account.`, "institutional_domain_required")
  }
  return {
    provider: "google_workspace" as const,
    providerSubjectId: claims.sub,
    email,
    displayName: claims.name?.trim() || email,
    emailVerified: true,
    providerDomain: hostedDomain,
  }
}

function requiredConfiguration() {
  const config = googleOAuthConfiguration()
  if (!config.clientId || !config.clientSecret) throw new GoogleOidcError("Google Workspace sign-in is not configured yet.", "google_not_configured")
  return config
}

function randomBase64Url(byteLength: number) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
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

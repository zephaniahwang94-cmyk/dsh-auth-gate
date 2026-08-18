/**
 * AuthService: central authentication service registered on ctx.auth.
 *
 * Manages bearer token validation and session token lifecycle.
 */

import { timingSafeEqual } from 'node:crypto'
import { SessionManager } from './session.js'
import type { SessionPayload } from './session.js'
import type { AuthConfig } from './config.js'

export class AuthService {
  private static readonly MAX_REVOCATIONS = 10_000
  private readonly token: string | null
  private readonly sessionManager: SessionManager
  private readonly revokedSessions = new Map<string, number>()
  private readonly _hasSession: boolean

  constructor(config: AuthConfig) {
    // Resolve bearer token: config > env > null
    this.token = config.token ?? process.env.DSH_AUTH_TOKEN ?? null

    // Initialize session manager
    this.sessionManager = new SessionManager(config.sessionSecret, config.sessionTtl)

    // Session auth requires both username and password
    this._hasSession = !!(config.username && config.password)
  }

  /** Whether bearer token auth is configured */
  get hasBearer(): boolean {
    return this.token !== null
  }

  /** Whether session auth is configured (username + password both set) */
  get hasSession(): boolean {
    return this._hasSession
  }

  /** Validate a bearer token using constant-time comparison */
  validateBearer(token: string): boolean {
    if (!this.token) return false
    if (token.length !== this.token.length) return false
    return timingSafeCompare(token, this.token)
  }

  /** Validate a session token cookie, returns payload or null */
  validateSession(cookieValue: string): SessionPayload | null {
    const payload = this.sessionManager.verify(cookieValue)
    this.pruneRevocations()
    if (!payload || this.revokedSessions.has(cookieValue)) return null
    return payload
  }

  /** Create a new session for the given username */
  createSession(username: string): string {
    return this.sessionManager.create(username)
  }

  /** Revoke a session token */
  revokeSession(token: string): void {
    this.pruneRevocations()
    const payload = this.sessionManager.verify(token)
    if (!payload) return
    if (this.revokedSessions.size >= AuthService.MAX_REVOCATIONS) {
      // Bound memory without making an evicted logged-out token valid again.
      this.sessionManager.rotateSecret()
      this.revokedSessions.clear()
      return
    }
    this.revokedSessions.set(token, payload.exp)
  }

  /** Validate credentials for login */
  validateCredentials(username: string, password: string, config: AuthConfig): boolean {
    if (!config.username || !config.password) return false
    if (username !== config.username) return false
    return timingSafeCompare(password, config.password)
  }

  private pruneRevocations(): void {
    const now = Math.floor(Date.now() / 1000)
    for (const [token, expiresAt] of this.revokedSessions) {
      if (expiresAt <= now) this.revokedSessions.delete(token)
    }
  }
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

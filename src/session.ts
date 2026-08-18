/**
 * Session token creation and verification using HMAC-SHA256.
 *
 * Token format: <base64url(payload)>.<hex(signature)>
 * Payload: { sub: string, iat: number, exp: number }
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface SessionPayload {
  /** Subject (username) */
  sub: string
  /** Issued-at timestamp (seconds) */
  iat: number
  /** Expiration timestamp (seconds) */
  exp: number
}

export class SessionManager {
  private secret: string
  private readonly ttl: number

  constructor(secret: string | undefined, ttl: number) {
    this.secret = secret ?? randomBytes(32).toString('hex')
    this.ttl = ttl
  }

  /** Create a signed session token for the given username */
  create(username: string): string {
    const now = Math.floor(Date.now() / 1000)
    const payload: SessionPayload = {
      sub: username,
      iat: now,
      exp: now + this.ttl,
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = this.sign(payloadB64)
    return `${payloadB64}.${signature}`
  }

  /** Verify a session token and return the payload, or null if invalid */
  verify(token: string): SessionPayload | null {
    const dotIdx = token.lastIndexOf('.')
    if (dotIdx < 0) return null

    const payloadB64 = token.slice(0, dotIdx)
    const signature = token.slice(dotIdx + 1)

    // Verify signature using constant-time comparison
    const expected = this.sign(payloadB64)
    if (!timingSafeCompare(signature, expected)) return null

    // Decode and validate payload
    try {
      const json = Buffer.from(payloadB64, 'base64url').toString('utf-8')
      const payload = JSON.parse(json) as SessionPayload

      if (typeof payload.sub !== 'string') return null
      if (typeof payload.iat !== 'number') return null
      if (typeof payload.exp !== 'number') return null

      // Check expiration
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp <= now) return null

      return payload
    } catch {
      return null
    }
  }

  /** HMAC-SHA256 signature as hex string */
  private sign(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('hex')
  }

  /** Invalidate every issued session and begin signing with a fresh key. */
  rotateSecret(): void {
    this.secret = randomBytes(32).toString('hex')
  }
}

/** Constant-time string comparison to prevent timing attacks */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return timingSafeEqual(bufA, bufB)
}

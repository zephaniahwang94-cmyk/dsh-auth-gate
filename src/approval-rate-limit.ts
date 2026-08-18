/**
 * Sandbox escalation rate limiting via the approval/request waterfall.
 *
 * Intercepts sandbox escalation approval requests and enforces:
 * - Per-minute rate limit per session
 * - Per-session lifetime limit
 *
 * Excess requests are denied with 'unavailable' (fail-closed).
 */

import type { RateLimitConfig } from './config.js'

interface ApprovalRequest {
  agent?: { session?: { id?: string } }
  [key: string]: unknown
}

type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

interface RateLimitBucket {
  /** Timestamps of requests in the current window */
  window: number[]
  /** Total requests in this session lifetime */
  total: number
}

export class ApprovalRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>()
  private readonly maxPerMinute: number
  private readonly maxPerSession: number

  constructor(config: RateLimitConfig) {
    this.maxPerMinute = config.maxPerMinute
    this.maxPerSession = config.maxPerSession
  }

  /** Check and record a request. Returns true if allowed, false if rate-limited. */
  check(sessionId: string): boolean {
    const now = Date.now()
    let bucket = this.buckets.get(sessionId)

    if (!bucket) {
      bucket = { window: [], total: 0 }
      this.buckets.set(sessionId, bucket)
    }

    // Prune window entries older than 1 minute
    const cutoff = now - 60_000
    bucket.window = bucket.window.filter(t => t > cutoff)

    // Check per-minute limit
    if (bucket.window.length >= this.maxPerMinute) {
      return false
    }

    // Check per-session limit
    if (bucket.total >= this.maxPerSession) {
      return false
    }

    // Record the request
    bucket.window.push(now)
    bucket.total++
    return true
  }

  /** Get current stats for a session (for diagnostics) */
  stats(sessionId: string): { windowCount: number; totalCount: number } {
    const bucket = this.buckets.get(sessionId)
    if (!bucket) return { windowCount: 0, totalCount: 0 }

    const now = Date.now()
    const cutoff = now - 60_000
    const windowCount = bucket.window.filter(t => t > cutoff).length

    return { windowCount, totalCount: bucket.total }
  }
}

/**
 * Create an approval/request waterfall listener that rate-limits
 * sandbox escalation requests.
 */
export function createApprovalRateLimitListener(
  limiter: ApprovalRateLimiter,
): (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome> {
  return async (req, next) => {
    // ApprovalRequest has no request-type field; limiting every approval also
    // covers sandbox escalation without relying on unstable reason strings.
    const sessionId = req.agent?.session?.id
    if (!sessionId) return 'unavailable'

    if (!limiter.check(sessionId)) {
      // Rate limited — deny with 'unavailable' (fail-closed)
      return 'unavailable' as ApprovalOutcome
    }

    return next()
  }
}

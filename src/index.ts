/**
 * dsh-auth-gate: Authentication and security hardening plugin for DeepSeek Harness.
 *
 * Provides:
 * - Bearer token authentication for API requests
 * - Session-based login with cookie auth
 * - Sandbox escalation rate limiting
 *
 * Register in cordis.patch.yml:
 *   - id: auth-gate
 *     name: 'dsh-auth-gate'
 *     config:
 *       protections:
 *         networkAuth: true
 *         approvalRateLimit: true
 *
 * @module dsh-auth-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthConfig, PluginConfig } from './config.js'
import { resolveConfig } from './config.js'
import { AuthService } from './auth-service.js'
import { registerHttpAuth } from './http-auth.js'
import { ApprovalRateLimiter, createApprovalRateLimitListener } from './approval-rate-limit.js'

export type { AuthConfig, PluginConfig, ProtectionConfig, RateLimitConfig } from './config.js'
export { resolveConfig } from './config.js'
export { AuthService } from './auth-service.js'
export { SessionManager } from './session.js'

export const name = 'auth-gate'
// Both capabilities are optional at plugin level; enabled modules attach when
// their service exists and stay isolated from unrelated DSH surfaces.
export const inject = [] as const

export function apply(ctx: Context, rawConfig: PluginConfig): void {
  // Resolve config with defaults
  const config = resolveConfig(rawConfig)

  if (config.protections.networkAuth) {
    const auth = new AuthService(config)
    ctx.inject(['webServer' as any], (networkCtx: Context) => {
      const disposeAuth = registerHttpAuth((networkCtx as any).webServer, auth, config)
      networkCtx.effect(() => disposeAuth, 'auth-gate: route protection')
    })
  }

  if (config.protections.approvalRateLimit) {
    const limiter = new ApprovalRateLimiter(config.approvalRateLimit)
    const listener = createApprovalRateLimitListener(limiter)
    ctx.inject(['approval' as any], (approvalCtx: Context) => {
      approvalCtx.on('approval/request' as any, listener as any, { prepend: true })
    })
  }

  // 4. Log auth mode on activation
  const modules = [
    config.protections.networkAuth ? `network-auth(${config.mode})` : null,
    config.protections.approvalRateLimit ? 'approval-rate-limit' : null,
  ].filter(Boolean)
  ctx.logger('auth-gate').info('auth-gate protections: %s', modules.join(' + '))
  if (!config.protections.networkAuth) {
    ctx.logger('auth-gate').warn('network authentication is disabled; HTTP and WebSocket control surfaces are not protected')
  }
  if (!config.protections.approvalRateLimit) {
    ctx.logger('auth-gate').warn('approval rate limiting is disabled')
  }
  if (config.protections.networkAuth && config.mode !== 'bearer' && !config.secureCookie) {
    ctx.logger('auth-gate').warn('session cookie Secure flag is disabled; use this only for direct local HTTP')
  }
}

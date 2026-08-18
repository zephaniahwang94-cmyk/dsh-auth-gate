/**
 * Configuration schema for dsh-auth-gate.
 *
 * Plain TypeScript interfaces with runtime defaults.
 * Compatible with DSH cordis.patch.yml config injection.
 */

export interface RateLimitConfig {
  /** Max sandbox escalation requests per minute per session */
  maxPerMinute: number
  /** Max sandbox escalation requests per session lifetime */
  maxPerSession: number
}

export interface ProtectionConfig {
  /** Protect every HTTP and WebSocket route as one security boundary. */
  networkAuth: boolean
  /** Rate-limit approval/request events as defense in depth. */
  approvalRateLimit: boolean
}

export interface AuthConfig {
  protections: ProtectionConfig
  /**
   * Authentication mode:
   * - `bearer`: token-only via Authorization header
   * - `session`: login page + session cookie
   * - `both`: both bearer token and session login
   */
  mode: 'bearer' | 'session' | 'both'

  /**
   * Bearer token for API authentication.
   * Falls back to process.env.DSH_AUTH_TOKEN if not set.
   */
  token?: string

  /**
   * HMAC secret for signing session tokens.
   * If not set, a random secret is generated on each startup.
   */
  sessionSecret?: string

  /** Session time-to-live in seconds (default: 1 hour) */
  sessionTtl: number

  /** URL path for the login page */
  loginPath: string

  /** Username for session login */
  username?: string

  /** Password for session login */
  password?: string

  /** Mark session cookies Secure. Enable for every HTTPS deployment. */
  secureCookie: boolean

  /** Sandbox escalation rate limiting */
  approvalRateLimit: RateLimitConfig
}

/** User-facing config. Legacy top-level auth fields remain supported. */
export type PluginConfig = Partial<Omit<AuthConfig, 'protections' | 'approvalRateLimit'>> & {
  protections?: Partial<ProtectionConfig>
  auth?: Partial<Omit<AuthConfig, 'protections' | 'approvalRateLimit'>>
  approvalRateLimit?: Partial<RateLimitConfig>
}

/** Apply defaults to a partial config from cordis.patch.yml */
export function resolveConfig(raw: PluginConfig = {}): AuthConfig {
  const auth = { ...raw, ...raw.auth }
  const config: AuthConfig = {
    protections: {
      // Backward compatibility: absent protections means the old full mode.
      networkAuth: raw.protections?.networkAuth ?? true,
      approvalRateLimit: raw.protections?.approvalRateLimit ?? true,
    },
    mode: auth.mode ?? 'bearer',
    token: auth.token,
    sessionSecret: auth.sessionSecret,
    sessionTtl: auth.sessionTtl ?? 3600,
    loginPath: auth.loginPath ?? '/auth/login',
    username: auth.username ?? process.env.DSH_AUTH_USERNAME,
    password: auth.password ?? process.env.DSH_AUTH_PASSWORD,
    secureCookie: auth.secureCookie ?? false,
    approvalRateLimit: {
      maxPerMinute: raw.approvalRateLimit?.maxPerMinute ?? 3,
      maxPerSession: raw.approvalRateLimit?.maxPerSession ?? 10,
    },
  }
  validateConfig(config)
  return config
}

function validateConfig(config: AuthConfig): void {
  if (typeof config.protections.networkAuth !== 'boolean' || typeof config.protections.approvalRateLimit !== 'boolean') {
    throw new Error('auth-gate: protection switches must be boolean')
  }
  if (!config.protections.networkAuth && !config.protections.approvalRateLimit) {
    throw new Error('auth-gate: at least one protection must be enabled')
  }
  if (config.protections.networkAuth) validateNetworkAuth(config)
  if (config.protections.approvalRateLimit) validateApprovalRateLimit(config.approvalRateLimit)
}

function validateNetworkAuth(config: AuthConfig): void {
  if (!['bearer', 'session', 'both'].includes(config.mode)) throw new Error('auth-gate: invalid authentication mode')
  const token = config.token ?? process.env.DSH_AUTH_TOKEN
  if (config.mode !== 'session' && (!token || Buffer.byteLength(token) < 32)) {
    throw new Error('auth-gate: bearer mode requires DSH_AUTH_TOKEN or token with at least 32 bytes')
  }
  if (config.mode !== 'bearer') {
    if (!config.username || !config.password) throw new Error('auth-gate: session mode requires username and password')
    if (Buffer.byteLength(config.password) < 12) throw new Error('auth-gate: session password must be at least 12 bytes')
    if (config.password === 'replace-with-at-least-12-characters' || config.password.includes('替换为')) {
      throw new Error('auth-gate: replace the example session password before startup')
    }
    if (config.sessionSecret !== undefined) {
      throw new Error('auth-gate: persistent sessionSecret is unsupported because logout revocations are process-local')
    }
  }
  if (!Number.isSafeInteger(config.sessionTtl) || config.sessionTtl < 60 || config.sessionTtl > 604800) {
    throw new Error('auth-gate: sessionTtl must be an integer between 60 and 604800 seconds')
  }
  if (!/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(config.loginPath)) {
    throw new Error('auth-gate: loginPath must be a same-origin absolute URL path')
  }
}

function validateApprovalRateLimit(rateLimit: RateLimitConfig): void {
  for (const [name, value] of Object.entries(rateLimit)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`auth-gate: ${name} must be a positive integer`)
  }
}

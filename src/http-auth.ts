/** Authentication gateway for every DSH HTTP and WebSocket route. */
import type { Duplex } from 'node:stream'
import type { AuthService } from './auth-service.js'
import type { AuthConfig } from './config.js'
import { renderLoginPage, renderLogoutPage } from './login-page.js'

interface IncomingMessage { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string }; on?(event: string, listener: (...args: any[]) => void): void }
interface ServerResponse { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }
interface WebRoute { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }
interface UpgradeRoute { path: string; handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void> }
interface WebServer { register(route: WebRoute): () => void; registerUpgrade(route: UpgradeRoute): () => void; registerFallback(handler: WebRoute['handler']): () => void }
interface WebServerInternals extends WebServer { exact?: Map<string, WebRoute>; prefixes?: Map<string, WebRoute>; upgrades?: Map<string, UpgradeRoute>; fallback?: WebRoute['handler'] }

const SESSION_COOKIE = 'dsh_session'
const GATE_MARK = Symbol.for('dsh-auth-gate.installed')
const WRAPPED = Symbol('dsh-auth-gate.wrapped')
const MAX_LOGIN_BODY_BYTES = 16 * 1024
const MAX_LOGIN_FAILURES_PER_MINUTE = 5
const MAX_LOGIN_SOURCES = 10_000
type MarkedHandler = Function & { [WRAPPED]?: boolean }

/** Protect existing and subsequently registered HTTP and WebSocket routes. */
export function registerHttpAuth(webServer: WebServer, auth: AuthService, config: AuthConfig): () => void {
  const server = webServer as WebServerInternals & { [GATE_MARK]?: boolean }
  if (server[GATE_MARK]) throw new Error('auth-gate: only one instance may protect a webServer')
  assertRegistry(server)
  const disposers: Array<() => void> = []
  const loginFailures = new Map<string, number[]>()
  if (config.mode !== 'bearer') {
    disposers.push(server.register({ kind: 'exact', path: config.loginPath, handler: (req, res) => handleLoginRoute(req, res, auth, config, loginFailures) }))
    disposers.push(server.register({ kind: 'exact', path: '/auth/logout', handler: (req, res) => handleLogoutRoute(req, res, auth, config) }))
  }
  const originalRegister = server.register.bind(server)
  const originalRegisterUpgrade = server.registerUpgrade.bind(server)
  const originalRegisterFallback = server.registerFallback.bind(server)
  const originals = new WeakMap<Function, Function>()
  const wrapHttp = (handler: WebRoute['handler']): WebRoute['handler'] => {
    if ((handler as MarkedHandler)[WRAPPED]) return handler
    const wrapped: WebRoute['handler'] = async (req, res) => {
      const result = checkAuth(req, auth, config)
      if (!result.ok) return rejectHttp(req, res, config, result.reason)
      await handler(req, res)
    }
    ;(wrapped as MarkedHandler)[WRAPPED] = true
    originals.set(wrapped, handler)
    return wrapped
  }
  const wrapUpgrade = (handler: UpgradeRoute['handler']): UpgradeRoute['handler'] => {
    if ((handler as MarkedHandler)[WRAPPED]) return handler
    const wrapped: UpgradeRoute['handler'] = async (req, socket, head) => {
      if (!checkAuth(req, auth, config).ok) return rejectUpgrade(socket)
      await handler(req, socket, head)
    }
    ;(wrapped as MarkedHandler)[WRAPPED] = true
    originals.set(wrapped, handler)
    return wrapped
  }
  for (const route of server.exact!.values()) route.handler = wrapHttp(route.handler)
  for (const route of server.prefixes!.values()) route.handler = wrapHttp(route.handler)
  for (const route of server.upgrades!.values()) route.handler = wrapUpgrade(route.handler)
  if (server.fallback) server.fallback = wrapHttp(server.fallback)
  server.register = route => originalRegister({ ...route, handler: wrapHttp(route.handler) })
  server.registerUpgrade = route => originalRegisterUpgrade({ ...route, handler: wrapUpgrade(route.handler) })
  server.registerFallback = handler => originalRegisterFallback(wrapHttp(handler))
  server[GATE_MARK] = true
  return () => {
    server.register = originalRegister; server.registerUpgrade = originalRegisterUpgrade; server.registerFallback = originalRegisterFallback
    for (const route of server.exact!.values()) route.handler = (originals.get(route.handler) as WebRoute['handler'] | undefined) ?? route.handler
    for (const route of server.prefixes!.values()) route.handler = (originals.get(route.handler) as WebRoute['handler'] | undefined) ?? route.handler
    for (const route of server.upgrades!.values()) route.handler = (originals.get(route.handler) as UpgradeRoute['handler'] | undefined) ?? route.handler
    if (server.fallback) server.fallback = (originals.get(server.fallback) as WebRoute['handler'] | undefined) ?? server.fallback
    delete server[GATE_MARK]
    for (const dispose of disposers.reverse()) dispose()
  }
}

function assertRegistry(server: WebServerInternals): void {
  if (!(server.exact instanceof Map) || !(server.prefixes instanceof Map) || !(server.upgrades instanceof Map) || typeof server.registerUpgrade !== 'function') {
    throw new Error('auth-gate: incompatible DSH webServer; refusing to start without complete route protection')
  }
}
function checkAuth(req: IncomingMessage, auth: AuthService, config: AuthConfig): { ok: boolean; reason?: string } {
  const path = safePath(req.url)
  if (config.mode !== 'bearer' && (path === config.loginPath || path === '/auth/logout')) return { ok: true }
  if (config.mode !== 'session') {
    const token = getHeader(req, 'authorization')?.match(/^Bearer[ \t]+([^ \t]+)[ \t]*$/i)?.[1]
    if (token && auth.validateBearer(token)) return { ok: true }
  }
  if (config.mode !== 'bearer') {
    const cookie = getSessionCookie(req)
    if (cookie && auth.validateSession(cookie)) return { ok: true }
  }
  return { ok: false, reason: 'Missing or invalid credentials' }
}
function rejectHttp(req: IncomingMessage, res: ServerResponse, config: AuthConfig, reason?: string): void {
  const acceptsHtml = (getHeader(req, 'accept') ?? '').includes('text/html')
  if (config.mode === 'session' && acceptsHtml && (req.method === 'GET' || req.method === 'HEAD')) {
    res.statusCode = 303; res.setHeader('Location', config.loginPath); res.setHeader('Cache-Control', 'no-store'); res.end(); return
  }
  res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('WWW-Authenticate', 'Bearer')
  res.end(JSON.stringify({ error: 'Unauthorized', message: reason }))
}
function rejectUpgrade(socket: Duplex): void { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n') }

function handleLoginRoute(req: IncomingMessage, res: ServerResponse, auth: AuthService, config: AuthConfig, failures: Map<string, number[]>): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    res.end(req.method === 'HEAD' ? undefined : renderLoginPage({ loginPath: config.loginPath })); return
  }
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD, POST'); res.end('Method Not Allowed'); return }
  const source = req.socket?.remoteAddress ?? 'unknown'
  if (!reserveLoginAttempt(failures, source)) {
    res.statusCode = 429; res.setHeader('Retry-After', '60'); res.setHeader('Cache-Control', 'no-store'); res.end('Too Many Requests'); return
  }
  let body = ''; let rejected = false
  req.on?.('data', (chunk: Buffer) => {
    if (rejected) return
    body += chunk.toString()
    if (Buffer.byteLength(body) > MAX_LOGIN_BODY_BYTES) { rejected = true; res.statusCode = 413; res.end('Payload Too Large') }
  })
  req.on?.('end', () => {
    if (rejected) return
    const params = new URLSearchParams(body); const username = params.get('username') ?? ''; const password = params.get('password') ?? ''
    if (auth.validateCredentials(username, password, config)) {
      failures.delete(source)
      res.statusCode = 303; res.setHeader('Set-Cookie', buildSessionCookie(auth.createSession(username), config)); res.setHeader('Location', '/'); res.setHeader('Cache-Control', 'no-store'); res.end(); return
    }
    res.statusCode = 401; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store')
    res.end(renderLoginPage({ loginPath: config.loginPath, error: 'Invalid username or password' }))
  })
}
function reserveLoginAttempt(failures: Map<string, number[]>, source: string): boolean {
  const cutoff = Date.now() - 60_000
  const recent = (failures.get(source) ?? []).filter(time => time > cutoff)
  if (recent.length) failures.set(source, recent); else failures.delete(source)
  if (recent.length >= MAX_LOGIN_FAILURES_PER_MINUTE) return false
  if (!failures.has(source) && failures.size >= MAX_LOGIN_SOURCES) {
    const oldest = failures.keys().next().value as string | undefined
    if (oldest) failures.delete(oldest)
  }
  recent.push(Date.now())
  failures.set(source, recent)
  return true
}
function handleLogoutRoute(req: IncomingMessage, res: ServerResponse, auth: AuthService, config: AuthConfig): void {
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); res.end('Method Not Allowed'); return }
  const cookie = getSessionCookie(req); if (cookie) auth.revokeSession(cookie)
  res.statusCode = 200; res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${config.secureCookie ? '; Secure' : ''}`)
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(renderLogoutPage())
}
function getSessionCookie(req: IncomingMessage): string | null {
  const header = getHeader(req, 'cookie'); if (!header) return null
  for (const item of header.split(';')) { const [name, ...value] = item.trim().split('='); if (name === SESSION_COOKIE) return value.join('=') || null }
  return null
}
function buildSessionCookie(token: string, config: AuthConfig): string { return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${config.sessionTtl}; HttpOnly; SameSite=Strict${config.secureCookie ? '; Secure' : ''}` }
function getHeader(req: IncomingMessage, name: string): string | null { const value = req.headers[name.toLowerCase()]; return Array.isArray(value) ? (value[0] ?? null) : (value ?? null) }
function safePath(url: string | undefined): string { try { return new URL(url ?? '/', 'http://localhost').pathname } catch { return '/__invalid__' } }

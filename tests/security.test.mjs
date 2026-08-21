import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { AuthService, resolveConfig } from '../dist/index.js'
import { registerHttpAuth } from '../dist/http-auth.js'
import { ApprovalRateLimiter, createApprovalRateLimitListener } from '../dist/approval-rate-limit.js'
import { renderLoginPage } from '../dist/login-page.js'

class FakeWebServer {
  exact = new Map()
  prefixes = new Map()
  upgrades = new Map()
  fallback
  register(route) { this.exact.set(route.path, route); return () => this.exact.delete(route.path) }
  registerUpgrade(route) { this.upgrades.set(route.path, route); return () => this.upgrades.delete(route.path) }
  registerFallback(handler) { this.fallback = handler; return () => { this.fallback = undefined } }
}
function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(v = '') { this.body = v } }
}

test('configuration fails closed when bearer credentials are missing or weak', () => {
  assert.throws(() => resolveConfig({ mode: 'bearer', token: 'short' }), /at least 32 bytes/)
  assert.throws(() => resolveConfig({ mode: 'session', username: 'a', password: 'short' }), /at least 12 bytes/)
  assert.throws(() => resolveConfig({ mode: 'session', username: 'a', password: 'long-enough-password', sessionSecret: '0123456789abcdef0123456789abcdef' }), /process-local/)
  assert.throws(() => resolveConfig({ mode: 'session', username: 'a', password: 'long-enough-password', loginPath: '//evil.example' }), /same-origin/)
})

test('protection modules validate independently and legacy config means full protection', () => {
  const approvalOnly = resolveConfig({
    protections: { networkAuth: false, approvalRateLimit: true },
    approvalRateLimit: { maxPerMinute: 2, maxPerSession: 4 },
  })
  assert.deepEqual(approvalOnly.protections, { networkAuth: false, approvalRateLimit: true })

  const networkOnly = resolveConfig({
    protections: { networkAuth: true, approvalRateLimit: false },
    auth: { mode: 'bearer', token: '0123456789abcdef0123456789abcdef' },
    approvalRateLimit: { maxPerMinute: 0, maxPerSession: 0 },
  })
  assert.equal(networkOnly.mode, 'bearer')
  assert.throws(() => resolveConfig({ protections: { networkAuth: false, approvalRateLimit: false } }), /at least one/)
  assert.deepEqual(resolveConfig({ mode: 'bearer', token: '0123456789abcdef0123456789abcdef' }).protections, {
    networkAuth: true,
    approvalRateLimit: true,
  })
})

test('HTTP and WebSocket routes require authentication', async () => {
  const config = resolveConfig({ mode: 'bearer', token: '0123456789abcdef0123456789abcdef' })
  const server = new FakeWebServer()
  server.register({ kind: 'exact', path: '/api', handler: (_req, res) => { res.statusCode = 204; res.end() } })
  let upgraded = false
  server.registerUpgrade({ path: '/api/events', handler: () => { upgraded = true } })
  const dispose = registerHttpAuth(server, new AuthService(config), config)

  const denied = response()
  await server.exact.get('/api').handler({ method: 'GET', url: '/api', headers: {} }, denied)
  assert.equal(denied.statusCode, 401)
  const allowed = response()
  await server.exact.get('/api').handler({ method: 'GET', url: '/api', headers: { authorization: `Bearer ${config.token}` } }, allowed)
  assert.equal(allowed.statusCode, 204)

  const socket = new EventEmitter()
  socket.end = value => { socket.output = value }
  await server.upgrades.get('/api/events').handler({ url: '/api/events', headers: {} }, socket, Buffer.alloc(0))
  assert.match(socket.output, /401 Unauthorized/)
  assert.equal(upgraded, false)

  dispose()
  const afterDispose = response()
  await server.exact.get('/api').handler({ method: 'GET', url: '/api', headers: {} }, afterDispose)
  assert.equal(afterDispose.statusCode, 204)
})

test('approval rate limiting uses the actual DSH request shape', async () => {
  const listener = createApprovalRateLimitListener(new ApprovalRateLimiter({ maxPerMinute: 1, maxPerSession: 2 }))
  const request = { agent: { session: { id: 'session-a' } }, toolName: 'bash' }
  assert.equal(await listener(request, async () => 'allowed-once'), 'allowed-once')
  assert.equal(await listener(request, async () => 'allowed-once'), 'unavailable')
  assert.equal(await listener({ toolName: 'bash' }, async () => 'allowed-once'), 'unavailable')
})

test('login attempts reserve rate-limit capacity before bodies complete', () => {
  const config = resolveConfig({ mode: 'session', username: 'admin', password: 'long-enough-password' })
  const server = new FakeWebServer()
  registerHttpAuth(server, new AuthService(config), config)
  const handler = server.exact.get(config.loginPath).handler
  for (let index = 0; index < 5; index += 1) {
    handler({ method: 'POST', url: config.loginPath, headers: {}, socket: { remoteAddress: '10.0.0.1' }, on() {} }, response())
  }
  const denied = response()
  handler({ method: 'POST', url: config.loginPath, headers: {}, socket: { remoteAddress: '10.0.0.1' }, on() {} }, denied)
  assert.equal(denied.statusCode, 429)
})

test('published presets never materialize credentials into Loader config', () => {
  for (const path of ['cordis.patch.yml', 'presets/full.yml', 'presets/network-auth.yml', 'presets/approval-limit.yml']) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /^\s*(username|password|token):/m, path)
    assert.doesNotMatch(source, /!!js\s+process\.env\.DSH_AUTH_(USERNAME|PASSWORD|TOKEN)/, path)
  }
})

test('README contains no fixed credential that passes production validation', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.doesNotMatch(readme, /0123456789abcdef0123456789abcdef/)
  assert.doesNotMatch(readme, /your-strong-password|use-a-long-private-password/)
  assert.match(readme, /RandomNumberGenerator.*GetBytes\(32\)/s)
})

test('login page keeps Harness styling, accessibility, and escaped content', () => {
  const page = renderLoginPage({ loginPath: '/auth/login?next=&quot;', error: '<invalid>' })
  assert.match(page, /DeepSeek Harness/)
  assert.match(page, /#4176e6/i)
  assert.match(page, /aria-labelledby="auth-title"/)
  assert.match(page, /autocomplete="current-password"/)
  assert.match(page, /role="alert"/)
  assert.doesNotMatch(page, /<invalid>/)
  assert.match(page, /&lt;invalid&gt;/)
})

test('published package includes native Windows and POSIX bootstrap installers', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.files.includes('install.ps1'))
  assert.ok(manifest.files.includes('install.sh'))

  const shellInstaller = readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
  const powershellInstaller = readFileSync(new URL('../install.ps1', import.meta.url), 'utf8')
  for (const source of [shellInstaller, powershellInstaller]) {
    assert.match(source, /npm ci --ignore-scripts/)
    assert.match(source, /npm run build/)
    assert.doesNotMatch(source, /DSH_AUTH_PASSWORD\s*=\s*['"][^'"]{12}/)
  }
})

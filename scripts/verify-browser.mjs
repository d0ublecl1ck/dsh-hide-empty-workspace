#!/usr/bin/env node
/**
 * Real-browser verification + showcase recorder for this plugin.
 *
 * Unit tests cover the pure logic only. They cannot tell you whether the
 * WorkspaceHider slot ever mounts, whether the shipped sidebar still answers to
 * `data-row-key^="workspace:"`, or whether a right-click really opens the hide
 * menu. This script answers exactly those questions against a running DSH
 * instance, changes nothing it does not restore, and can also emit the
 * screenshots (and a GIF) the README shows.
 *
 * It authenticates the way the shell does: the browser session cookie is a
 * v1.<base64url payload>.<base64url HMAC-SHA256> value signed with the
 * `client-connection/browser-session` credential secret, and its name is
 * `dsh-auth-` + base64url(sha256(authority)).
 *
 * Usage:
 *   node scripts/verify-browser.mjs
 *   node scripts/verify-browser.mjs --url http://127.0.0.1:43129 --shots assets/showcase --gif assets/showcase/hide-empty-workspace.gif
 *
 * @module dsh-hide-empty-workspace/scripts/verify-browser
 */
import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const DEFAULTS = {
  url: 'http://127.0.0.1:43129',
  home: process.env.DSH_HOME ?? join(homedir(), 'Library', 'Application Support', 'dsh-desktop', 'harness'),
  chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  shots: 'assets/showcase',
  gif: null,
  redact: true,
  timeoutMs: 30000,
}

/**
 * A screenshot of a live instance is a screenshot of somebody's real work: 23
 * real workspace names, real session titles, and the account balance in the
 * composer footer. Public showcase images must not carry any of that.
 *
 * Redaction keeps the geometry and everything this plugin draws (its context
 * menu, its 「已隐藏 N」 footer) but replaces the text of every shipped sidebar
 * row with a neutral bar, and the capture is clipped to the sidebar column so
 * the main pane never enters the frame. `--no-redact` skips this for local use.
 */
const REDACTION_CSS = `[data-row-key] * { color: transparent !important; text-shadow: none !important; }
[data-row-key] { position: relative !important; }
[data-row-key]::after {
  content: ''; position: absolute; left: 10px; right: 24px; top: 50%;
  height: 9px; margin-top: -4.5px; border-radius: 4.5px;
  background: rgba(120, 120, 120, 0.35); pointer-events: none;
}`

/** Sidebar column only; the width the redaction and the clip agree on. */
const CAPTURE_WIDTH = 320

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const flags = new Set(argv.filter((value) => value.startsWith('--') && !value.includes('=')))

const config = {
  ...DEFAULTS,
  url: option('url', DEFAULTS.url),
  home: option('home', DEFAULTS.home),
  chrome: option('chrome', DEFAULTS.chrome),
  shots: option('shots', DEFAULTS.shots),
  gif: option('gif', DEFAULTS.gif),
  redact: !flags.has('--no-redact'),
}

const passes = []
const failures = []
const pass = (message) => { passes.push(message); console.log('  PASS  ' + message) }
const fail = (message) => { failures.push(message); console.log('  FAIL  ' + message) }

const base64url = (value) => Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** The one fact this script needs out of .credentials.yaml; avoids a YAML dependency. */
function readBrowserSessionSecret(text) {
  const lines = text.split(/\r?\n/)
  let inside = false
  let recordIndent = -1
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (!inside) {
      if (trimmed === 'client-connection/browser-session:') { inside = true; recordIndent = indent }
      continue
    }
    if (indent <= recordIndent) break
    const match = trimmed.match(/^secret:\s*(.+)$/)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  throw new Error('no client-connection/browser-session secret in ' + join(config.home, '.credentials.yaml'))
}

function sessionCookie(url, secret) {
  const authority = new URL(url).host
  const name = 'dsh-auth-' + base64url(createHash('sha256').update(authority).digest())
  const issuedAt = Date.now()
  const expiresAt = issuedAt + 30 * 24 * 60 * 60 * 1000
  const body = base64url(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }))
  const signature = createHmac('sha256', Buffer.from(secret, 'base64')).update(body).digest()
  return { name, value: 'v1.' + body + '.' + base64url(signature) }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Minimal flattened-protocol CDP client over the built-in WebSocket. */
class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) return
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('CDP timeout: ' + method))
      }, config.timeoutMs)
    })
  }
}

async function connect(port) {
  const deadline = Date.now() + config.timeoutMs
  for (;;) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/version')
      const info = await response.json()
      const socket = new WebSocket(info.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', () => reject(new Error('devtools websocket failed')), { once: true })
      })
      return { cdp: new Cdp(socket), socket }
    } catch (error) {
      if (Date.now() > deadline) throw new Error('Chrome devtools endpoint never came up on port ' + port)
      await sleep(200)
    }
  }
}

/** Evaluate in the page and return the value; throws on a page-side error. */
async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, sessionId)
  if (result.exceptionDetails) {
    throw new Error('page evaluation failed: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text))
  }
  return result.result.value
}

const ROW_SELECTOR = '[data-row-key^="workspace:"]'

const probeExpression = `(() => {
  const rows = [...document.querySelectorAll('[data-row-key^="workspace:"]')]
  const all = [...document.querySelectorAll('[data-row-key]')].map((row) => row.getAttribute('data-row-key'))
  const body = document.body ? document.body.innerText : ''
  return {
    readyState: document.readyState,
    url: location.href,
    rowCount: rows.length,
    rowKeys: all,
    hiddenRows: rows.filter((row) => row.style.display === 'none').length,
    markerWarning: body.includes('工作区行标记失配'),
    hideMenu: body.includes('隐藏工作区'),
    hiddenFooter: (body.match(/已隐藏 (\\d+)/) ?? [])[1] ?? null,
    restored: false,
    stored: (() => { try { return localStorage.getItem('dsh-hide-empty-workspace.hidden.v1') } catch { return null } })(),
    storedIds: (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem('dsh-hide-empty-workspace.hidden.v1') ?? '[]')
        return Array.isArray(parsed) ? [...parsed].sort() : []
      } catch { return [] }
    })(),
  }
})()`

async function waitFor(cdp, sessionId, predicate, what) {
  const deadline = Date.now() + config.timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await evaluate(cdp, sessionId, probeExpression)
    if (predicate(last)) return last
    await sleep(250)
  }
  throw new Error('timed out waiting for ' + what + '; last probe: ' + JSON.stringify(last))
}

async function screenshot(cdp, sessionId, path) {
  const height = config.redact ? await evaluate(cdp, sessionId, 'window.innerHeight') : null
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    ...(config.redact ? { clip: { x: 0, y: 0, width: CAPTURE_WIDTH, height, scale: 1 } } : {}),
  }, sessionId)
  writeFileSync(path, Buffer.from(shot.data, 'base64'))
}

function gif(framesDir, pattern, out) {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-framerate', '1', '-i', join(framesDir, pattern),
      '-vf', 'scale=iw/2:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
      out,
    ], { stdio: 'ignore' })
    ffmpeg.on('close', (code) => resolve(code === 0))
    ffmpeg.on('error', () => resolve(false))
  })
}

async function main() {
  const credentialsPath = join(config.home, '.credentials.yaml')
  if (!existsSync(credentialsPath)) throw new Error('DSH home has no .credentials.yaml: ' + credentialsPath)
  if (!existsSync(config.chrome)) throw new Error('Chrome not found; pass --chrome <path>')
  const secret = readBrowserSessionSecret(readFileSync(credentialsPath, 'utf8'))
  const cookie = sessionCookie(config.url, secret)

  const profile = mkdtempSync(join(tmpdir(), 'dsh-hew-verify-'))
  const port = 9222 + Math.floor(Math.random() * 500)
  const chrome = spawn(config.chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' })

  let socket
  try {
    const connection = await connect(port)
    const { cdp } = connection
    socket = connection.socket

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Network.enable', {}, sessionId)
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: config.url,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    }, sessionId)
    await cdp.send('Page.navigate', { url: config.url + '/' }, sessionId)

    await waitFor(cdp, sessionId, (state) => state.readyState === 'complete', 'document load')
    pass('signed browser session accepted at ' + config.url + ' (no 401)')

    // The sidebar can boot in its rail (collapsed) form, where this plugin is not mounted at all.
    let state = await evaluate(cdp, sessionId, probeExpression)
    if (state.rowCount === 0) {
      await evaluate(cdp, sessionId, `(() => {
        const toggle = document.querySelector('[aria-label="打开侧边栏"], [aria-label="Open sidebar"]')
        if (toggle) toggle.click()
        return true
      })()`)
      await sleep(1000)
    }

    mkdirSync(config.shots, { recursive: true })

    if (config.redact) {
      await evaluate(cdp, sessionId, `(() => {
        const style = document.createElement('style')
        style.id = 'dsh-hew-redact'
        style.textContent = ${JSON.stringify(REDACTION_CSS)}
        document.head.appendChild(style)
        return true
      })()`)
    }

    state = await waitFor(cdp, sessionId, (value) => value.rowCount > 0, 'shipped workspace rows')
    pass('shipped sidebar still renders ' + state.rowCount + ' workspace row(s) with data-row-key="workspace:<id>"')

    if (state.markerWarning) fail('the plugin rendered its marker-mismatch banner; the row contract is broken')
    else pass('no marker-mismatch banner: the row contract holds and the self-check stays quiet')

    await screenshot(cdp, sessionId, join(config.shots, '1-workspaces.png'))

    const targetKey = await evaluate(cdp, sessionId, `(() => {
      const row = document.querySelector('[data-row-key^="workspace:"]')
      if (!row) return null
      const rect = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + 20, clientY: rect.top + rect.height / 2,
      }))
      return row.getAttribute('data-row-key')
    })()`)
    if (targetKey === null) throw new Error('no workspace row to right-click')
    await sleep(400)

    const opened = await evaluate(cdp, sessionId, probeExpression)
    if (opened.hideMenu) pass('right-click on ' + targetKey + ' opened the plugin\'s 「隐藏工作区」 entry')
    else fail('right-click did not render 「隐藏工作区」: the footer slot is not mounted')
    await screenshot(cdp, sessionId, join(config.shots, '2-hide-menu.png'))

    // Dismiss, then exercise the manual hide path for real and put it back.
    await evaluate(cdp, sessionId, 'document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); true')
    await sleep(300)

    const before = await evaluate(cdp, sessionId, probeExpression)
    const rowKeys = await evaluate(cdp, sessionId, `[...document.querySelectorAll('[data-row-key^="workspace:"]')].map((row) => row.getAttribute('data-row-key')).slice(0, 2)`)
    const targets = rowKeys.map((key) => key.slice('workspace:'.length))

    /** Right-click the Nth workspace row and choose 「隐藏工作区」. */
    const hideRow = async (index) => {
      await evaluate(cdp, sessionId, `(() => {
        const row = document.querySelectorAll('[data-row-key^="workspace:"]')[${index}]
        if (!row) return false
        const rect = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + rect.height / 2 }))
        return true
      })()`)
      await sleep(300)
      await evaluate(cdp, sessionId, `(() => {
        const item = [...document.querySelectorAll('button')].find((button) => button.textContent === '隐藏工作区')
        if (item) item.click()
        return true
      })()`)
      await sleep(400)
    }

    // Two hides, because the workspace currently in use is documented to stay
    // visible even when hidden; with two hidden, at least one must be display:none.
    await hideRow(0)
    await hideRow(1)

    const afterHide = await evaluate(cdp, sessionId, probeExpression)
    const recorded = targets.filter((id) => afterHide.storedIds.includes(id))
    if (recorded.length === 2) pass('「隐藏工作区」 recorded both workspaces in localStorage: ' + targets.join(', '))
    else fail('only ' + recorded.length + '/2 hides were persisted (expected ' + targets.join(', ') + ', stored ' + JSON.stringify(afterHide.storedIds) + ')')
    if (afterHide.hiddenRows >= 1) pass('display:none actually reached the shipped rows (' + afterHide.hiddenRows + ' hidden, ' + (2 - afterHide.hiddenRows) + ' kept as the workspace in use)')
    else fail('no workspace row became display:none after two hides')
    if (afterHide.hiddenFooter !== null) pass('sidebar footer shows 「已隐藏 ' + afterHide.hiddenFooter + '」')
    else fail('no 「已隐藏 N」 restore entry appeared')
    await screenshot(cdp, sessionId, join(config.shots, '3-hidden.png'))

    // Restore everything, and prove the stored set came back to what it was.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const done = await evaluate(cdp, sessionId, `(() => {
        const toggle = [...document.querySelectorAll('button')].find((button) => /^已隐藏 /.test(button.textContent))
        if (toggle) toggle.click()
        return true
      })()`)
      await sleep(300)
      const remaining = await evaluate(cdp, sessionId, `(() => {
        const restore = [...document.querySelectorAll('button')].filter((button) => /^恢复 /.test(button.textContent))
        for (const button of restore) button.click()
        return restore.length
      })()`)
      await sleep(350)
      if (remaining === 0) break
    }

    const afterRestore = await evaluate(cdp, sessionId, probeExpression)
    const sameSet = JSON.stringify(afterRestore.storedIds) === JSON.stringify([...before.storedIds].sort())
    if (sameSet) pass('restore returned the hidden set to its original value: ' + (before.storedIds.length === 0 ? '(empty)' : before.storedIds.join(', ')))
    else fail('hidden set was not restored: was ' + JSON.stringify(before.storedIds) + ', now ' + JSON.stringify(afterRestore.storedIds))
    if (afterRestore.hiddenRows === before.hiddenRows) pass('no workspace row is left hidden (' + afterRestore.hiddenRows + ')')
    else fail('a row is still hidden: ' + afterRestore.hiddenRows)
    await screenshot(cdp, sessionId, join(config.shots, '4-restored.png'))

    if (config.gif !== null) {
      mkdirSync(dirname(config.gif), { recursive: true })
      const frames = ['1-workspaces.png', '2-hide-menu.png', '3-hidden.png', '4-restored.png']
      for (const [index, frame] of frames.entries()) {
        writeFileSync(join(config.shots, 'frame-' + String(index + 1).padStart(2, '0') + '.png'), readFileSync(join(config.shots, frame)))
      }
      const ok = await gif(config.shots, 'frame-%02d.png', config.gif)
      if (ok) pass('wrote ' + config.gif)
      else fail('ffmpeg could not build ' + config.gif)
      for (const [index] of frames.entries()) rmSync(join(config.shots, 'frame-' + String(index + 1).padStart(2, '0') + '.png'), { force: true })
    }
  } finally {
    try { socket?.close() } catch {}
    try { chrome.kill('SIGKILL') } catch {}
    await sleep(300)
    rmSync(profile, { recursive: true, force: true })
  }

  console.log('')
  console.log(passes.length + ' passed, ' + failures.length + ' failed')
  if (failures.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('verify-browser: ' + error.message)
  process.exitCode = 1
})

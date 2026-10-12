// Headless Chrome over its DevTools socket: one page, driven by CDP calls,
// so a hundred screenshots take seconds rather than a launch each.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export async function chrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-chrome-'))
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const url = await new Promise((resolve, reject) => {
    let seen = ''
    proc.stderr.on('data', chunk => {
      seen += chunk
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen)
      if (match) resolve(match[1])
    })
    proc.on('exit', () => reject(new Error(`Chrome exited: ${seen}`)))
  })
  const port = new URL(url).port
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const socket = new WebSocket(targets.find(one => one.type === 'page').webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  let id = 0
  const waiting = new Map()
  const events = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message)
      waiting.delete(message.id)
    } else if (message.method !== undefined) {
      events.push(message.method)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      waiting.set(n, message => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)))
      socket.send(JSON.stringify({ id: n, method, params }))
    })
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1800, deviceScaleFactor: 2, mobile: false })
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })

  const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value

  // A screenshot of the element matching `selector`, whole.
  const shoot = async (selector, file) => {
    await evaluate('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))')
    const rect = JSON.parse(await evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`))
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: Math.ceil(rect.width), height: Math.ceil(rect.height), scale: 1 } })
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  }

  const open = async url => {
    events.length = 0
    await send('Page.navigate', { url })
    for (let tries = 0; tries < 200 && !events.includes('Page.loadEventFired'); tries++) await new Promise(r => setTimeout(r, 25))
  }

  return { send, evaluate, shoot, open, close: () => (socket.close(), proc.kill()) }
}

#!/usr/bin/env node
// Turns the captures record.py wrote into a GIF:
// each capture is drawn as a terminal window on the mark's night blue by
// headless Chrome (chrome.mjs), then ffmpeg strings them together, each for
// as long as it was on screen, long waits cut short.
//
//   node e2e/reel/render.mjs <frames-dir> <out-base> [--title T] [--hold S] [--from MS] [--to MS] [--width PX] [--still]
//
// Writes <out-base>.gif, and with --still <out-base>.png of its last frame.
// Needs Chrome and ffmpeg.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chrome } from './chrome.mjs'

const [dir, base, ...rest] = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = rest.indexOf(`--${name}`)
  return at === -1 ? fallback : rest[at + 1]
}
const title = flag('title', 'claude')
const maxHold = Number(flag('hold', '1.2'))
const from = Number(flag('from', '0'))
const to = Number(flag('to', 'Infinity'))
const width = Number(flag('width', '1400'))
const lastHold = Number(flag('last', '3'))

// --- ANSI (SGR only, as tmux capture-pane -e writes it) to HTML -------------
const PALETTE = ['#1b1e26', '#f0605a', '#3fb950', '#d6a24a', '#5aaeff', '#c678dd', '#4fb8b0', '#d8dbe0', '#5c6370', '#ff7b72', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff']
function xterm(n) {
  if (n < 16) return PALETTE[n]
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const i = n - 16
  const c = v => (v === 0 ? 0 : 55 + v * 40)
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`
}
const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toHtml(ansi) {
  let style = {}
  let out = ''
  let open = false
  const span = () => {
    if (open) out += '</span>'
    let fg = style.fg
    let bg = style.bg
    if (style.inverse) [fg, bg] = [bg ?? '#1c1c1c', fg ?? '#d8dbe0']
    const css = []
    if (fg) css.push(`color:${fg}`)
    if (bg) css.push(`background:${bg}`)
    if (style.bold) css.push('font-weight:700')
    if (style.dim) css.push('opacity:.6')
    if (style.italic) css.push('font-style:italic')
    if (style.underline) css.push('text-decoration:underline')
    out += `<span style="${css.join(';')}">`
    open = true
  }
  const parts = ansi.split(/\x1b\[([0-9;:]*)m/)
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      out += esc(parts[i].replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b[()][A-Z0-9]/g, ''))
      continue
    }
    // 38:2::r:g:b (an empty colour-space slot) reads as 38;2;r;g;b.
    const codes = parts[i] === '' ? [0] : parts[i].replace(/([34]8):2::/g, '$1;2;').split(/[;:]/).map(Number)
    for (let k = 0; k < codes.length; k++) {
      const code = codes[k]
      if (code === 0) style = {}
      else if (code === 1) style.bold = true
      else if (code === 2) style.dim = true
      else if (code === 3) style.italic = true
      else if (code === 4) style.underline = true
      else if (code === 7) style.inverse = true
      else if (code === 22) style.bold = style.dim = false
      else if (code === 23) style.italic = false
      else if (code === 24) style.underline = false
      else if (code === 27) style.inverse = false
      else if (code >= 30 && code <= 37) style.fg = PALETTE[code - 30]
      else if (code === 39) delete style.fg
      else if (code >= 40 && code <= 47) style.bg = PALETTE[code - 40]
      else if (code === 49) delete style.bg
      else if (code >= 90 && code <= 97) style.fg = PALETTE[code - 82]
      else if (code >= 100 && code <= 107) style.bg = PALETTE[code - 92]
      else if (code === 38 || code === 48) {
        const key = code === 38 ? 'fg' : 'bg'
        if (codes[k + 1] === 5) {
          style[key] = xterm(codes[k + 2])
          k += 2
        } else if (codes[k + 1] === 2) {
          style[key] = `rgb(${codes.slice(k + 2, k + 5).join(',')})`
          k += 4
        }
      }
    }
    span()
  }
  if (open) out += '</span>'
  return out
}

function page(body, columns, rows) {
  return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent}
  #shot{display:inline-block;padding:22px;background:radial-gradient(120% 140% at 0% 0%,#1c2b4a 0%,#0d1526 55%,#090f1c 100%)}
  .win{border-radius:12px;overflow:hidden;background:#1c1c1c;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 60px rgba(0,0,0,.55)}
  .bar{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#2a2a2a;border-bottom:1px solid rgba(255,255,255,.06);font:500 12.5px -apple-system,BlinkMacSystemFont,sans-serif;color:#8b93a7}
  .dot{width:12px;height:12px;border-radius:50%}
  .t{flex:1;text-align:center;margin-right:52px}
  pre{margin:0;padding:14px 18px 16px;font:13px/16px "SF Mono",Menlo,monospace;color:#d8dbe0;white-space:pre;width:${columns}ch;height:${rows * 16}px;overflow:hidden}
</style><div id="shot"><div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="t">${esc(title)}</span></div><pre>${body}</pre></div></div>`
}

const frames = fs
  .readdirSync(dir)
  .filter(name => /^\d+\.(ansi|end)$/.test(name))
  .sort()
  .map(name => ({ at: Number(name.slice(0, 7)), file: path.join(dir, name), isEnd: name.endsWith('.end') }))
  .filter(frame => frame.at >= from && frame.at <= to)
const shots = frames.filter(frame => !frame.isEnd)
if (shots.length === 0) throw new Error(`no frames in ${dir}`)
// One window size for every frame (a cell is 1ch by 16px, whatever glyph
// fills it), so ffmpeg stores only what changed between frames.
const plain = shots.map(frame => fs.readFileSync(frame.file, 'utf8').replace(/\x1b\[[0-9;:]*m/g, '').replace(/\n$/, '').split('\n'))
const columns = Math.max(...plain.map(lines => Math.max(...lines.map(line => [...line].length))))
const rows = Math.max(...plain.map(lines => lines.length))

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-'))
const browser = await chrome()
const list = []
for (const [index, frame] of shots.entries()) {
  const html = page(toHtml(fs.readFileSync(frame.file, 'utf8').replace(/\n$/, '')), columns, rows)
  await browser.evaluate(`document.open();document.write(${JSON.stringify(html)});document.close()`)
  const png = path.join(work, `${String(index).padStart(4, '0')}.png`)
  await browser.shoot('#shot', png)
  const next = frames[frames.indexOf(frame) + 1]
  const real = next === undefined ? lastHold : (next.at - frame.at) / 1000
  const isLast = index === shots.length - 1
  list.push({ png, seconds: isLast ? lastHold : Math.max(0.08, Math.min(maxHold, real)) })
}
browser.close()

if (rest.includes('--still')) fs.copyFileSync(list.at(-1).png, `${base}.png`)
const concat = list.map(one => `file '${one.png}'\nduration ${one.seconds.toFixed(3)}`).join('\n') + `\nfile '${list.at(-1).png}'\n`
fs.writeFileSync(path.join(work, 'list.txt'), concat)
const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-fps_mode', 'vfr', '-vf', `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', `${base}.gif`], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
const seconds = list.reduce((sum, one) => sum + one.seconds, 0)
console.log(`${base}.gif: ${shots.length} frames, ${seconds.toFixed(1)}s, ${(fs.statSync(`${base}.gif`).size / 1024).toFixed(0)} KB`)

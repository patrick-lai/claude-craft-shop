#!/usr/bin/env node
// The README's desktop pictures: preview.mjs pages (the desktop's own trees,
// laid out as the desktop pane) shot on the mark's night blue, one PNG, or a
// GIF of several with a duration each.
//
//   node e2e/reel/desktop.mjs <preview-dir> <out-base> <page>[:seconds] ...
//
// One page writes <out-base>.png; several write <out-base>.gif too, and the
// PNG is the last of them. Needs Chrome, and ffmpeg for a GIF.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chrome } from './chrome.mjs'

const [dir, base, ...pages] = process.argv.slice(2)
const width = Number(process.env.REEL_WIDTH ?? '1600')
// A fixed pane width (px), for frames whose content would otherwise size it.
const paneWidth = process.env.REEL_PANE_WIDTH
// A pane height (px) to cut it at, to show its top part alone.
const paneHeight = process.env.REEL_PANE_HEIGHT

// The pane as the desktop app frames it, set on the backdrop the terminal
// reels use, so the README's pictures read as one set.
const FRAME = `
  html,body{background:transparent!important}
  body{margin:0!important;padding:0!important}
  #shot{display:inline-block;padding:32px;background:radial-gradient(120% 140% at 0% 0%,#1c2b4a 0%,#0d1526 55%,#090f1c 100%)}
  #shot .pane{margin:0!important;display:block!important;${paneWidth === undefined ? '' : `width:${paneWidth}px;box-sizing:border-box;`}${paneHeight === undefined ? '' : `height:${paneHeight}px;overflow:hidden;`}border-color:rgba(255,255,255,.1)!important;box-shadow:0 0 0 1px rgba(0,0,0,.4),0 24px 60px rgba(0,0,0,.55)}
`

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-desktop-'))
const browser = await chrome()
const shots = []
for (const [index, spec] of pages.entries()) {
  const [name, seconds = '1.5'] = spec.split(':')
  await browser.open(`file://${path.resolve(dir, `${name}.html`)}`)
  await browser.evaluate(`(() => {
    const style = document.createElement('style'); style.textContent = ${JSON.stringify(FRAME)}; document.head.append(style)
    const shot = document.createElement('div'); shot.id = 'shot'
    const pane = document.querySelector('.pane'); pane.replaceWith(shot); shot.append(pane)
  })()`)
  const png = path.join(work, `${String(index).padStart(4, '0')}.png`)
  await browser.shoot('#shot', png)
  shots.push({ png, seconds: Number(seconds) })
}
browser.close()

fs.copyFileSync(shots.at(-1).png, `${base}.png`)
if (shots.length > 1) {
  // Every frame the same size: the largest, each centred on the backdrop.
  const size = shots.map(one => spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', one.png], { encoding: 'utf8' }).stdout.match(/\d+/g).slice(-2).map(Number))
  const w = Math.max(...size.map(s => s[0]))
  const h = Math.max(...size.map(s => s[1]))
  const list = shots.map(one => `file '${one.png}'\nduration ${one.seconds.toFixed(3)}`).join('\n') + `\nfile '${shots.at(-1).png}'\n`
  fs.writeFileSync(path.join(work, 'list.txt'), list)
  const filter = `pad=${w}:${h}:0:0:color=0x0d1526,scale=${Math.min(width, w)}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-fps_mode', 'vfr', '-vf', filter, '-loop', '0', `${base}.gif`], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(`${base}.gif: ${shots.length} frames, ${(fs.statSync(`${base}.gif`).size / 1024).toFixed(0)} KB`)
}
console.log(`${base}.png`)

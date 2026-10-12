#!/usr/bin/env node
// Writes fishStack's mark from hooks/brand.ts to assets/: the full-colour
// icon and the one-colour template, plus a sheet of both at every size.
//
//   node e2e/brand.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { brandIcon, brandTemplate } from '../hooks/brand.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = path.join(root, 'assets')
fs.mkdirSync(assets, { recursive: true })
fs.writeFileSync(path.join(assets, 'icon.svg'), brandIcon())
fs.writeFileSync(path.join(assets, 'icon-template.svg'), brandTemplate())

const data = svg => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const tile = (svg, size, background) =>
  `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size + 20}px;height:${size + 20}px;background:${background};border-radius:8px"><img width="${size}" height="${size}" src="${data(svg)}"></span>`
const row = (label, svg, backgrounds) =>
  `<div style="display:flex;gap:10px;align-items:center;margin:10px 0"><b style="width:140px">${label}</b>${backgrounds.flatMap(bg => [16, 22, 32, 64, 128].map(size => tile(svg, size, bg))).join('')}</div>`
const white = brandTemplate().replace('fill="#000" mask', 'fill="#fff" mask')
fs.writeFileSync(
  path.join(root, 'e2e', 'out', 'brand.html'),
  `<!doctype html><meta charset="utf-8"><body style="margin:20px;background:#262624;color:#ddd;font:14px -apple-system">${row('Icon on dark', brandIcon(), ['#1f1f1e'])}${row('Icon on light', brandIcon(), ['#f5f5f4'])}${row('Template', brandTemplate(), ['#e8e8e8'])}${row('Template, dark bar', white, ['#1f1f1e'])}</body>`,
)
console.log('assets/icon.svg, assets/icon-template.svg, e2e/out/brand.html')

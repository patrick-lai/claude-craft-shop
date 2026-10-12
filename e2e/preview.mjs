#!/usr/bin/env node
// Turns the PREVIEW lines tests/desktop.test.ts prints into one HTML page per
// drawing, laid out roughly as a desktop pane: a cell is 8 by 20 pixels,
// buttons are native-looking, SVG is inlined and hover rules apply. A look at
// the composition, not the desktop's own paint.
//
//   claude plugin test . | node e2e/preview.mjs <out-dir>
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] ?? 'e2e/out/preview'
fs.mkdirSync(out, { recursive: true })

const THEME = {
  text: '#e8e6e3', inverseText: '#16161a', inactive: '#7d8590', subtle: '#4a4d55', suggestion: '#8fa8ff',
  remember: '#8fa8ff', success: '#3fb950', error: '#f0605a', warning: '#d6a24a', merged: '#a371f7', claude: '#d97757',
  permission: '#8fa8ff', planMode: '#4fb8b0', autoAccept: '#a371f7', promptBorder: '#6e7681', bashBorder: '#d6609c', ide: '#4fa3e0',
}
const COL = 8
const ROW = 20
const color = value => (value === undefined ? undefined : THEME[value] ?? value)
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
let rules = []
let counter = 0

function px(value, unit) {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : `${value * unit}px`
}

function boxStyle(p) {
  const s = ['display:' + (p.display === 'none' ? 'none' : 'flex'), 'flex-direction:' + (p.flexDirection ?? 'row')]
  const isRow = (p.flexDirection ?? 'row').startsWith('row')
  if (p.gap !== undefined) s.push(`gap:${p.gap * ROW * 0.5}px ${p.gap * COL}px`)
  if (p.flexWrap) s.push('flex-wrap:' + p.flexWrap)
  if (p.alignItems) s.push('align-items:' + p.alignItems)
  if (p.justifyContent) s.push('justify-content:' + p.justifyContent)
  if (p.flexGrow !== undefined) s.push('flex-grow:' + p.flexGrow)
  if (p.flexShrink !== undefined) s.push('flex-shrink:' + p.flexShrink)
  if (p.width !== undefined) s.push('width:' + px(p.width, COL), 'box-sizing:border-box')
  const pad = (k, v, u) => v !== undefined && s.push(`${k}:${v * u}px`)
  pad('padding-left', p.paddingX ?? p.paddingLeft ?? p.padding, COL)
  pad('padding-right', p.paddingX ?? p.paddingRight ?? p.padding, COL)
  pad('padding-top', p.paddingY ?? p.paddingTop ?? p.padding, ROW * 0.5)
  pad('padding-bottom', p.paddingY ?? p.paddingBottom ?? p.padding, ROW * 0.5)
  pad('margin-top', p.marginY ?? p.marginTop ?? p.margin, ROW * 0.5)
  pad('margin-bottom', p.marginY ?? p.marginBottom ?? p.margin, ROW * 0.5)
  pad('margin-left', p.marginX ?? p.marginLeft ?? p.margin, COL)
  if (p.borderStyle) s.push(`border:1px solid ${color(p.borderColor) ?? THEME.subtle}`, 'border-radius:10px')
  if (p.borderDimColor) s.push('border-color:' + (color(p.borderColor) ?? THEME.subtle) + '88')
  if (p.backgroundColor) s.push('background:' + color(p.backgroundColor))
  void isRow
  return s.join(';')
}

function textStyle(p) {
  const s = []
  if (p.color) s.push('color:' + color(p.color))
  if (p.backgroundColor) s.push('background:' + color(p.backgroundColor), 'border-radius:4px', 'padding:0 2px')
  if (p.bold) s.push('font-weight:600')
  if (p.dimColor) s.push('opacity:.58')
  if (p.italic) s.push('font-style:italic')
  if (p.wrap && p.wrap.startsWith('truncate')) s.push('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;max-width:100%')
  return s.join(';')
}

function render(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  const p = node.props ?? {}
  const kids = (node.children ?? []).map(render).join('')
  switch (node.type) {
    case 'Box': {
      let cls = ''
      if (p.hover) {
        cls = `h${counter++}`
        const h = []
        if (p.hover.backgroundColor) h.push('background:' + color(p.hover.backgroundColor) + ' !important')
        if (p.hover.borderColor) h.push('border-color:' + color(p.hover.borderColor) + ' !important')
        rules.push(`.${cls}:hover{${h.join(';')}}`)
      }
      return `<div class="${cls}" style="${boxStyle(p)}">${kids}</div>`
    }
    case 'Text':
      return `<span style="${textStyle(p)}">${kids}</span>`
    case 'Button': {
      const variant = p.plain ? 'plain' : p.variant ?? 'default'
      const content = kids || esc(p.label ?? '')
      return `<button class="b ${variant}" style="${p.dimColor ? 'opacity:.7' : ''}">${content}</button>`
    }
    case 'Svg':
      // As an image, the way the desktop app shows it: strict XML, so a
      // malformed picture breaks here too instead of rendering inline.
      return `<span class="svg" title="${esc(p.alt)}"><img alt="${esc(p.alt)}" width="${p.width}" height="${p.height}" src="data:image/svg+xml;base64,${Buffer.from(p.source).toString('base64')}"/></span>`
    case 'Input':
      return `<label class="in">${(p.label ?? '').trim() === '' ? '' : `<span>${esc(p.label.trim())}</span>`}<input value="${esc(p.value ?? '')}" placeholder="${esc(p.placeholder ?? '')}"/></label>`
    case 'Select':
      return `<label class="in">${(p.label ?? '').trim() === '' ? '' : `<span>${esc(p.label.trim())}</span>`}<select>${p.options.map(o => `<option ${o.value === p.value ? 'selected' : ''}>${esc(o.label ?? o.value)}</option>`).join('')}</select></label>`
    case 'Markdown':
      return `<div class="md">${esc(p.text).replace(/^## (.*)$/gm, '<h4>$1</h4>').replace(/\n/g, '<br>')}</div>`
    case 'Code':
      return `<pre class="code">${esc(p.source)}</pre>`
    case 'Link':
      return `<a>${kids}</a>`
    default:
      return kids
  }
}

const CSS = `
body{margin:0;background:#1f1f1e;color:${THEME.text};font:13px/20px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
.pane{margin:16px;padding:16px;border:1px solid #333;border-radius:12px;background:#262624;display:inline-block}
.b{font:inherit;font-size:12.5px;line-height:18px;color:${THEME.text};background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:3px 10px;cursor:pointer;white-space:nowrap}
.b:hover{background:rgba(255,255,255,.12)}
.b.primary{background:#e8e6e3;color:#1a1a1a;border-color:#e8e6e3}
.b.secondary{background:rgba(255,255,255,.04)}
.b.plain{background:none;border:none;padding:0;text-align:left;white-space:normal}
.b.plain:hover{background:none;text-decoration:underline}
.svg{display:inline-flex;line-height:0}
.in{display:flex;gap:8px;align-items:center;margin:2px 0}.in span{opacity:.6;min-width:44px}
.in{flex:1}.in input,.in select{flex:1;font:inherit;color:inherit;background:#1b1b1a;border:1px solid #444;border-radius:7px;padding:4px 8px;min-width:0;width:100%;box-sizing:border-box}
.md{opacity:.9}.md h4{margin:4px 0}.code{background:#1b1b1a;border-radius:8px;padding:8px;margin:2px 0;font:12px/18px ui-monospace,monospace}
`

const lines = fs.readFileSync(0, 'utf8').split('\n').filter(line => line.startsWith('PREVIEW '))
const index = []
for (const line of lines) {
  const [, name] = line.split(' ', 2)
  const tree = JSON.parse(line.slice(`PREVIEW ${name} `.length))
  rules = []
  const body = render(tree)
  fs.writeFileSync(path.join(out, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>${name}</title><style>${CSS}${rules.join('')}</style><body><div class="pane">${body}</div></body>`)
  index.push(name)
}
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body style="padding:16px">${index.map(n => `<p><a style="color:#8fa8ff" href="${n}.html">${n}</a></p>`).join('')}</body>`)
console.log(`${index.length} previews in ${out}`)

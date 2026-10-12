// The pane's drawn controls for the desktop: the tab bar, switches and preset
// pills, as SVG that follows light and dark. Presses reach them through a
// Client laid over each (see drawnButton in kit.tsx, and the tab bar's own
// overlay in ui.tsx).
import type { Tab } from '../types'

const SANS = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`
const ROUNDED = `ui-rounded, 'SF Pro Rounded', -apple-system, system-ui, sans-serif`

export const THEME = `<style>
  svg { --text: #ecebe8; --dim: #9a9aa2; --track: rgba(154,154,162,0.32); --pill: rgba(255,255,255,0.045); --pillLine: rgba(255,255,255,0.10); --active: rgba(255,255,255,0.13); --activeLine: rgba(255,255,255,0.22); --knob: #ffffff; }
  @media (prefers-color-scheme: light) { svg { --text: #1f1f22; --dim: #6b6b72; --track: rgba(107,107,114,0.28); --pill: rgba(0,0,0,0.035); --pillLine: rgba(0,0,0,0.10); --active: #ffffff; --activeLine: rgba(0,0,0,0.14); --knob: #ffffff; } }
  .num { font-variant-numeric: tabular-nums; }
</style>`

// Theme colours as style declarations, which every renderer reads.
export function paint(markup: string): string {
  return markup.replace(/(fill|stroke)="var\((--[A-Za-z]+)\)"/g, 'style="$1: var($2)"')
}

export function textWidth(text: string, size: number, isBold = false): number {
  let units = 0
  for (const char of text) units += /[mwMW@]/.test(char) ? 0.86 : /[il.:,'|!1]/.test(char) ? 0.3 : /[A-Z0-9$]/.test(char) ? 0.64 : 0.54
  return units * size * (isBold ? 1.0 : 0.95)
}

export function anvilMark(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})"><defs><linearGradient id="anvil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0a35e"/><stop offset="1" stop-color="#d97757"/></linearGradient></defs><path d="M1 4.5h12.5c0 2.6-2.1 4.5-4.6 4.6l1.6 3.4H13v2H3v-2h2.3l1.6-3.4C3.6 8.9 1 7.4 1 4.5z" fill="url(#anvil)"/><path d="M14.6 4.5h2.4" stroke="#d97757" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="1.8" r="1" fill="#f6c177"/></g>`
}

function tabIcon(id: Tab, x: number, y: number, isActive: boolean): string {
  const color = isActive ? 'var(--text)' : 'var(--dim)'
  const accent = { worktree: '#3fb950', dials: '#8f9cff', context: '#5cc8e8' }[id]
  if (id === 'worktree') {
    return `<g transform="translate(${x} ${y})" fill="none" stroke="${isActive ? accent : color}" stroke-width="1.5" stroke-linecap="round"><circle cx="3.5" cy="2.5" r="1.8"/><circle cx="3.5" cy="12.5" r="1.8"/><circle cx="11.5" cy="4.5" r="1.8"/><path d="M3.5 4.3v6.4M11.5 6.3c0 3.2-3.4 3-6.6 4.4"/></g>`
  }
  if (id === 'dials') {
    const levels = [4, 3, 5, 5, 4, 2]
    const point = (index: number, level: number) => {
      const angle = ((-90 + index * 60) * Math.PI) / 180
      return `${(7.5 + Math.cos(angle) * 7 * (level / 5)).toFixed(2)},${(7.5 + Math.sin(angle) * 7 * (level / 5)).toFixed(2)}`
    }
    return `<g transform="translate(${x} ${y})"><polygon points="${levels.map((_, i) => point(i, 5)).join(' ')}" fill="none" stroke="${color}" stroke-opacity="0.6"/><polygon points="${levels.map((level, i) => point(i, level)).join(' ')}" fill="${accent}" fill-opacity="${isActive ? 0.45 : 0.25}" stroke="${isActive ? accent : color}" stroke-width="1.3" stroke-linejoin="round"/></g>`
  }
  return `<g transform="translate(${x} ${y})" fill="none" stroke-width="1.4" stroke-linejoin="round"><rect x="4" y="0.6" width="9.5" height="11.5" rx="1.7" stroke="${isActive ? accent : color}" stroke-opacity="0.55"/><rect x="1.2" y="2.8" width="9.5" height="11.5" rx="1.7" stroke="${isActive ? accent : color}" fill="${isActive ? 'rgba(92,200,232,0.16)' : 'none'}"/><path d="M3.4 6.6h5M3.4 9.1h3.4" stroke="${isActive ? accent : color}" stroke-linecap="round"/></g>`
}

export type Segments = { width: number; height: number; source: string; segments: { x0: number; x1: number; tab: string }[] }

// The wordmark, then the three tabs as one segmented control.
export function tabsArt(tabs: { id: Tab; label: string }[], current: Tab): Segments {
  const height = 40
  const mid = height / 2
  const parts: string[] = []
  const segments: Segments['segments'] = []
  parts.push(anvilMark(2, mid - 8))
  parts.push(`<text x="27" y="${mid + 5}" font-family="${ROUNDED}" font-size="15" font-weight="750" fill="url(#brand)" letter-spacing="0.1">Craftshop</text>`)
  let x = 27 + textWidth('Craftshop', 15, true) + 20
  const trayX = x
  const widths = tabs.map(tab => 14 + 16 + 8 + textWidth(tab.label, 13, tab.id === current) + 16)
  const trayWidth = widths.reduce((sum, one) => sum + one, 0) + 8
  parts.push(`<rect x="${trayX + 0.5}" y="3.5" width="${trayWidth - 1}" height="${height - 7}" rx="${(height - 7) / 2}" fill="var(--pill)" stroke="var(--pillLine)"/>`)
  x = trayX + 4
  tabs.forEach((tab, index) => {
    const width = widths[index]!
    const isActive = tab.id === current
    if (isActive) parts.push(`<rect x="${x}" y="7" width="${width}" height="${height - 14}" rx="${(height - 14) / 2}" fill="var(--active)" stroke="var(--activeLine)"/>`)
    parts.push(tabIcon(tab.id, x + 14, mid - 7.5, isActive))
    parts.push(`<text x="${x + 14 + 16 + 8}" y="${mid + 4.6}" font-family="${SANS}" font-size="13" font-weight="${isActive ? 650 : 500}" fill="${isActive ? 'var(--text)' : 'var(--dim)'}">${tab.label}</text>`)
    segments.push({ x0: x, x1: x + width, tab: tab.id })
    x += width
  })
  const width = Math.ceil(trayX + trayWidth + 2)
  const defs = `<defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f2a65a"/><stop offset="1" stop-color="#e0715a"/></linearGradient></defs>`
  return { width, height, segments, source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${THEME}${defs}${paint(parts.join(''))}</svg>` }
}

// An iOS-style switch: green and right when on, grey and left when off, amber
// with the knob centred when some of a folder is on.
export function switchArt(state: 'on' | 'off' | 'some'): string {
  const track = state === 'on' ? '#34c759' : state === 'some' ? '#d6a24a' : 'var(--track)'
  const knob = state === 'on' ? 25 : state === 'some' ? 18 : 11
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="22" viewBox="0 0 36 22">${THEME}${paint(`<rect x="1" y="1" width="34" height="20" rx="10" fill="${track}"/><circle cx="${knob}" cy="11" r="8.2" fill="var(--knob)" stroke="rgba(0,0,0,0.12)"/>`)}</svg>`
}

// A preset as CommissionAI draws one: its radar glyph inside a pill, the
// active one outlined in the accent.
export function presetArt(name: string, levels: number[], isActive: boolean): { source: string; width: number; height: number } {
  const height = 32
  const width = Math.ceil(12 + 17 + 8 + textWidth(name, 13, isActive) + 14)
  const point = (index: number, level: number) => {
    const angle = ((-90 + (index * 360) / levels.length) * Math.PI) / 180
    return `${(8.5 + Math.cos(angle) * 7.8 * (level / 5)).toFixed(2)},${(8.5 + Math.sin(angle) * 7.8 * (level / 5)).toFixed(2)}`
  }
  const accent = '#8f9cff'
  const glyph = `<g transform="translate(12 ${height / 2 - 8.5})"><polygon points="${levels.map((_, i) => point(i, 5)).join(' ')}" fill="none" stroke="${isActive ? accent : 'var(--dim)'}" stroke-opacity="0.45"/><polygon points="${levels.map((level, i) => point(i, level)).join(' ')}" fill="${isActive ? accent : 'var(--dim)'}" fill-opacity="0.32" stroke="${isActive ? accent : 'var(--dim)'}" stroke-width="1.2" stroke-linejoin="round"/></g>`
  const pill = `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${(height - 1.5) / 2}" fill="${isActive ? 'rgba(143,156,255,0.16)' : 'var(--pill)'}" stroke="${isActive ? accent : 'var(--pillLine)'}" stroke-width="${isActive ? 1.5 : 1}"/>`
  const text = `<text x="${12 + 17 + 8}" y="${height / 2 + 4.6}" font-family="${SANS}" font-size="13" font-weight="${isActive ? 650 : 500}" fill="${isActive ? 'var(--text)' : 'var(--dim)'}">${name}</text>`
  return { width, height, source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${THEME}${paint(pill + glyph + text)}</svg>` }
}

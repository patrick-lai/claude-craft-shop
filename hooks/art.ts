// The pane's drawn controls for the desktop: the tab bar, switches and preset
// pills, as SVG that follows light and dark. Presses reach them through a
// Client laid over each (see drawnButton in kit.tsx, and the tab bar's own
// overlay in ui.tsx).
import { brandMark } from './brand'

const SANS = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`
const ROUNDED = `ui-rounded, 'SF Pro Rounded', -apple-system, system-ui, sans-serif`

export const THEME = `<style>
  svg { --text: #ecebe8; --dim: #9a9aa2; --track: rgba(154,154,162,0.32); --pill: rgba(255,255,255,0.045); --pillLine: rgba(255,255,255,0.10); --active: rgba(255,255,255,0.13); --activeLine: rgba(255,255,255,0.22); --knob: #ffffff; }
  @media (prefers-color-scheme: light) { svg { --text: #1f1f22; --dim: #6b6b72; --track: rgba(107,107,114,0.28); --pill: rgba(0,0,0,0.035); --pillLine: rgba(0,0,0,0.10); --active: #ffffff; --activeLine: rgba(0,0,0,0.14); --knob: #ffffff; } }
  .num { font-variant-numeric: tabular-nums; }
</style>`

// Theme colours as style declarations, which every renderer reads: one style
// per element, since a second style attribute is invalid XML and the image
// fails to load.
export function paint(markup: string): string {
  return markup.replace(/<[a-z]+\b[^>]*>/g, tag => {
    const styles: string[] = []
    const bare = tag.replace(/\s(fill|stroke)="var\((--[A-Za-z]+)\)"/g, (_, property: string, name: string) => {
      styles.push(`${property}: var(${name})`)
      return ''
    })
    if (styles.length === 0) return tag
    return bare.replace(/(\/?>)$/, ` style="${styles.join('; ')}"$1`)
  })
}

export function textWidth(text: string, size: number, isBold = false): number {
  let units = 0
  for (const char of text) units += /[mwMW@]/.test(char) ? 0.86 : /[il.:,'|!1]/.test(char) ? 0.3 : /[A-Z0-9$]/.test(char) ? 0.64 : 0.54
  return units * size * (isBold ? 1.0 : 0.95)
}

// The mark and the name, as the pane's head shows them: a still picture.
export function wordmarkArt(): { source: string; width: number; height: number } {
  const height = 32
  const mid = height / 2
  const width = Math.ceil(30 + textWidth('fishStack', 15, true) + 4)
  const defs = `<defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>`
  const parts = brandMark(1, mid - 11, 22, 'paneMark') + `<text x="30" y="${mid + 5}" font-family="${ROUNDED}" font-size="15" font-weight="750" fill="url(#brand)" letter-spacing="0.1">fishStack</text>`
  return { width, height, source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${THEME}${defs}${paint(parts)}</svg>` }
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

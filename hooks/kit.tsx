// The pane's small design kit, after CommissionAI's Stage: cards that light
// under the pointer, section labels, a segmented control, chips and the SVG
// glyphs the desktop draws. A terminal gets the same tree with borders and
// text in place of fills and pictures.
import type { RenderElement } from 'claude-code'

import type { Ui } from './ui'

// Fills read on dark and light themes alike; the terminal never gets them.
const FILL = 'rgba(140,140,150,0.07)'
const FILL_HOVER = 'rgba(140,140,150,0.15)'
const FILL_SELECTED = 'rgba(120,140,255,0.12)'

export type Tone = 'plain' | 'selected' | 'muted' | 'accent' | 'warning' | 'danger'

const BORDER: Record<Tone, string> = {
  plain: 'subtle',
  selected: 'suggestion',
  muted: 'subtle',
  accent: 'claude',
  warning: 'warning',
  danger: 'error',
}

export function isRich(ui: Ui): boolean {
  return ui.Svg !== undefined
}

// A card: a keyed Box, filled and lit under the pointer on the desktop,
// bordered everywhere.
export function card(
  ui: Ui,
  key: string,
  children: RenderElement | (RenderElement | false | null | undefined)[],
  options: { tone?: Tone; width?: number | string; direction?: 'row' | 'column'; grow?: number } = {},
) {
  const { Box } = ui
  const tone = options.tone ?? 'plain'
  const rich = isRich(ui)
  return (
    <Box
      key={key}
      flexDirection={options.direction ?? 'column'}
      width={options.width}
      flexGrow={options.grow}
      borderStyle="round"
      borderColor={BORDER[tone]}
      borderDimColor={tone === 'plain' || tone === 'muted'}
      backgroundColor={rich ? (tone === 'selected' ? FILL_SELECTED : FILL) : undefined}
      hover={rich ? { backgroundColor: tone === 'selected' ? FILL_SELECTED : FILL_HOVER, borderColor: tone === 'muted' || tone === 'plain' ? 'suggestion' : BORDER[tone] } : undefined}
      paddingX={1}
      paddingY={rich ? 1 : 0}
    >
      {children}
    </Box>
  )
}

export function label(ui: Ui, text: string) {
  const { Text } = ui
  return (
    <Text dimColor bold>
      {text}
    </Text>
  )
}

// CommissionAI's segmented control: the chosen option drawn primary.
export function segmented<T extends string>(
  ui: Ui,
  key: string,
  options: readonly { value: T; label: string }[],
  value: T | 'mixed' | null,
  onPick: (value: T) => void,
) {
  const { Box, Button, Text } = ui
  return (
    <Box gap={1} alignItems="center" flexWrap="wrap">
      {options.map(one => (
        <Button
          key={`${key}-${one.value}`}
          label={one.label}
          variant={value === one.value ? 'primary' : undefined}
          dimColor={value !== one.value}
          onPress={() => onPick(one.value)}
        />
      ))}
      {value === 'mixed' && chip(ui, 'mixed', 'warning')}
    </Box>
  )
}

// A short coloured tag: a filled badge on the desktop, bracketed on the terminal.
export function chip(ui: Ui, text: string, color: string) {
  const { Text } = ui
  return isRich(ui) ? (
    <Text backgroundColor={color} color="inverseText" bold>
      {`\u00a0\u00a0${text}\u00a0\u00a0`}
    </Text>
  ) : (
    <Text color={color} bold>
      [{text}]
    </Text>
  )
}

export function svg(ui: Ui, source: string, alt: string, width: number, height: number) {
  const { Svg } = ui
  return Svg === undefined ? null : <Svg source={source} alt={alt} width={width} height={height} />
}

const FONT = 'font-family="-apple-system, BlinkMacSystemFont, system-ui, sans-serif"'

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type Glyph = 'folder' | 'note' | 'link' | 'file' | 'plus'

export const GLYPH_COLOR: Record<Glyph, string> = {
  folder: '#d6a24a',
  note: '#8fa8ff',
  link: '#5cc8e8',
  file: '#9ad48a',
  plus: '#9aa1ab',
}

export function glyph(kind: Glyph, size = 18): string {
  const color = GLYPH_COLOR[kind]
  const shapes: Record<Glyph, string> = {
    folder: `<path d="M2 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.6 1.8h5.8A1.5 1.5 0 0 1 16 7.3v6.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 13.5z" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="1.3"/>`,
    note: `<rect x="4" y="2.5" width="10" height="13" rx="1.6" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="1.3"/><path d="M6.5 6.5h5M6.5 9h5M6.5 11.5h3" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>`,
    link: `<path d="M7.6 10.4l2.8-2.8M6.4 8.4l-1.6 1.6a2.4 2.4 0 0 0 3.4 3.4l1.6-1.6M11.6 9.6l1.6-1.6a2.4 2.4 0 0 0-3.4-3.4L8.2 6.2" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`,
    file: `<path d="M5 2.5h5.2L13.5 6v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V4A1.5 1.5 0 0 1 5 2.5z" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="1.3"/><path d="M10 2.5V6h3.5" fill="none" stroke="${color}" stroke-width="1.3"/>`,
    plus: `<path d="M9 4v10M4 9h10" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`,
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 18 18">${shapes[kind]}</svg>`
}

// CommissionAI's TickMeter: twenty ticks, teal within budget, red past it.
export function tickMeter(fraction: number, width: number): string {
  const count = 20
  const gap = 3
  const tick = Math.max(4, Math.floor((width - gap * (count - 1)) / count))
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * count)
  const over = fraction > 1
  const rects = Array.from({ length: count }, (_, index) => {
    const fill = index < filled ? (over ? '#e5534b' : '#3fb6a8') : 'rgba(139,148,158,0.28)'
    return `<rect x="${index * (tick + gap)}" y="0" width="${tick}" height="10" rx="2" fill="${fill}"/>`
  }).join('')
  const total = count * tick + (count - 1) * gap
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="10" viewBox="0 0 ${total} 10">${rects}</svg>`
}

// A source's cover, as CommissionAI's cards show one: a page of the note's
// first lines, a link's card with its host, or a file tab with its path.
export function cover(kind: Exclude<Glyph, 'plus' | 'folder'>, text: string, caption: string, width: number, height: number, isOff: boolean): string {
  const color = GLYPH_COLOR[kind]
  const perLine = Math.max(20, Math.floor((width - 28) / 6.1))
  const wrap = new RegExp(`.{1,${perLine}}(\\s|$)`, 'g')
  const isProse = /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(text) && !/^\s*[[{]/.test(text)
  const all = (isProse ? text : '')
    .split(/\n+/)
    .flatMap(line => (line.match(wrap) ?? [line]).map(part => part.trim()))
    .filter(line => line !== '')
  const room = kind === 'link' ? 1 : 3
  const lines = all.slice(0, room)
  if (all.length > room && lines.length > 0) lines[lines.length - 1] = `${lines[lines.length - 1]!.replace(/[.,;:]?$/, '')}…`
  if (lines.length === 0) lines.push(kind === 'note' ? 'Empty' : '⚠ No readable text fetched')
  const textLines = lines
    .map((line, index) => `<text x="14" y="${(kind === 'link' ? 50 : 30) + index * 15}" ${FONT} font-size="11" fill="#9aa1ab">${escape(line.slice(0, perLine + 4))}</text>`)
    .join('')
  const head =
    kind === 'link'
      ? `<rect x="10" y="10" width="${width - 20}" height="26" rx="6" fill="${color}" fill-opacity="0.14"/><text x="20" y="27" ${FONT} font-size="11.5" font-weight="600" fill="${color}">${escape(caption.slice(0, 34))}</text>`
      : kind === 'file'
        ? `<text x="14" y="17" ${FONT} font-size="10" font-weight="600" fill="${color}">${escape(caption.slice(0, 40))}</text>`
        : ''
  const sheet = `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${color}" fill-opacity="0.06" stroke="${color}" stroke-opacity="0.35"/>`
  const fold = kind === 'note' ? `<path d="M${width - 18} 0.5v12a5 5 0 0 0 5 5h12.5" fill="none" stroke="${color}" stroke-opacity="0.35"/>` : ''
  const fade = `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></linearGradient></defs><rect width="${width}" height="${height}" rx="8" fill="url(#f)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" opacity="${isOff ? 0.45 : 1}">${sheet}${fold}${head}${textLines}${fade}</svg>`
}

// A filled track: teal into the dials' blue, or one colour.
export function track(fraction: number, width: number, color?: string): string {
  const filled = Math.max(fraction > 0 ? 4 : 0, Math.round(Math.min(1, Math.max(0, fraction)) * width))
  const fill = color ?? 'url(#t)'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6"><defs><linearGradient id="t" x1="0" x2="1"><stop offset="0%" stop-color="#22c4dc"/><stop offset="100%" stop-color="#8f9cff"/></linearGradient></defs><rect width="${width}" height="6" rx="3" fill="#8b949e" fill-opacity="0.22"/><rect width="${filled}" height="6" rx="3" fill="${fill}"/></svg>`
}

// A folder's art: a folder with its members' pages fanned behind it.
export function folderArt(count: number, sharedCount: number, width: number, height: number): string {
  const color = GLYPH_COLOR.folder
  const pages = Array.from({ length: Math.min(3, count) }, (_, index) => {
    const x = width / 2 - 34 + index * 14
    const y = 14 - index * 3
    return `<rect x="${x}" y="${y}" width="52" height="40" rx="4" fill="#9aa1ab" fill-opacity="${0.14 + index * 0.05}" stroke="#9aa1ab" stroke-opacity="0.3" transform="rotate(${-8 + index * 8} ${x + 26} ${y + 20})"/>`
  }).join('')
  const body = `<path d="M${width / 2 - 52} 34a6 6 0 0 1 6-6h26l7 7h53a6 6 0 0 1 6 6v${height - 50}a6 6 0 0 1-6 6h-86a6 6 0 0 1-6-6z" fill="${color}" fill-opacity="${sharedCount > 0 ? 0.3 : 0.14}" stroke="${color}" stroke-opacity="0.8" stroke-width="1.4"/>`
  const badge =
    count > 0
      ? `<text x="${width / 2}" y="${height - 16}" text-anchor="middle" ${FONT} font-size="12" font-weight="600" fill="${color}">${count}</text>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${pages}${body}${badge}</svg>`
}

// A branch forking off a trunk, for the Worktree tab's empty state.
export function branchArt(width: number, height: number): string {
  const c = '#8f9cff'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 120 64"><path d="M20 52V12" stroke="#9aa1ab" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round"/><path d="M20 40c0-14 18-14 40-14h22" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/><circle cx="20" cy="12" r="6" fill="#9aa1ab" fill-opacity="0.5"/><circle cx="20" cy="52" r="6" fill="#9aa1ab" fill-opacity="0.5"/><rect x="84" y="14" width="26" height="24" rx="6" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="2"/><path d="M92 26h10M97 21v10" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`
}

// Three request rows, for the API log's empty state.
export function requestsArt(width: number, height: number): string {
  const rows = [
    ['#3fb950', 'GET', 46],
    ['#8fa8ff', 'POST', 60],
    ['#d6a24a', 'PUT', 38],
  ]
    .map(([color, method, length], index) => {
      const y = 6 + index * 20
      return `<rect x="0" y="${y}" width="34" height="14" rx="4" fill="${color}" fill-opacity="0.85"/><text x="17" y="${y + 10.5}" text-anchor="middle" ${FONT} font-size="8.5" font-weight="700" fill="#16161a">${method}</text><rect x="42" y="${y + 4}" width="${length}" height="6" rx="3" fill="#9aa1ab" fill-opacity="0.4"/><circle cx="${120 - 6}" cy="${y + 7}" r="4" fill="#3fb950" fill-opacity="${index === 2 ? 0.25 : 0.8}"/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 120 66">${rows}</svg>`
}

// One icon per dial, after CommissionAI's: a compass, people, a target, a
// steering wheel, a check in a shield and a speech bubble.
export function dialIcon(key: 'foresight' | 'crew' | 'tenacity' | 'autonomy' | 'proof' | 'voice', color: string, size = 18): string {
  const stroke = `fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`
  const shapes = {
    foresight: `<circle cx="9" cy="9" r="7" ${stroke}/><path d="M11.8 6.2 10.2 10.2 6.2 11.8 7.8 7.8z" ${stroke}/>`,
    crew: `<circle cx="7" cy="6.5" r="2.6" ${stroke}/><path d="M2.5 15c.4-2.8 2.2-4.2 4.5-4.2s4.1 1.4 4.5 4.2" ${stroke}/><circle cx="12.6" cy="5.8" r="2" ${stroke}/><path d="M12.4 9.6c1.9 0 3.3 1.2 3.6 3.6" ${stroke}/>`,
    tenacity: `<circle cx="9" cy="9" r="7" ${stroke}/><circle cx="9" cy="9" r="4" ${stroke}/><circle cx="9" cy="9" r="1.2" fill="${color}"/>`,
    autonomy: `<circle cx="9" cy="9" r="7" ${stroke}/><circle cx="9" cy="9" r="2" ${stroke}/><path d="M9 2v5M3 12.5l4.3-2.4M15 12.5l-4.3-2.4" ${stroke}/>`,
    proof: `<path d="M9 2 15 4.5v4.3c0 3.6-2.5 6-6 7.2-3.5-1.2-6-3.6-6-7.2V4.5z" ${stroke}/><path d="m6.2 9 2 2 3.8-4" ${stroke}/>`,
    voice: `<path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5v6a1.5 1.5 0 0 1-1.5 1.5H8l-3.5 3v-3h0A1.5 1.5 0 0 1 3 10.5z" ${stroke}/><path d="M6 6.5h6M6 9h4" ${stroke}/>`,
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 18 18">${shapes[key]}</svg>`
}

// A preset's shape: its six levels as a small radar, as CommissionAI's
// PresetGlyph draws one.
export function presetGlyph(levels: number[], color: string, size = 18): string {
  const point = (index: number, level: number) => {
    const angle = ((-90 + (index * 360) / levels.length) * Math.PI) / 180
    return `${(9 + Math.cos(angle) * 7.5 * (level / 5)).toFixed(2)},${(9 + Math.sin(angle) * 7.5 * (level / 5)).toFixed(2)}`
  }
  const ring = levels.map((_, index) => point(index, 5)).join(' ')
  const shape = levels.map((level, index) => point(index, level)).join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 18 18"><polygon points="${ring}" fill="none" stroke="${color}" stroke-opacity="0.35"/><polygon points="${shape}" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/></svg>`
}

// CommissionAI's prompt-cache gauge: a flame and five bars, one per minute of
// the cache's five, running down after each reply. Hovering it explains it.
export function cacheGauge(secondsLeft: number, isWorking: boolean, hitPercent: number | null): string {
  const colors = ['#5aaeff', '#2fcfa6', '#74d16f', '#a8c94a', '#d8bf45']
  const lit = isWorking ? 5 : Math.ceil(secondsLeft / 60)
  const isWarm = isWorking || secondsLeft > 0
  const bars = colors
    .map((color, index) => `<rect x="${24 + index * 9}" y="3" width="6" height="14" rx="3" fill="${index < lit ? color : '#8b949e'}" fill-opacity="${index < lit ? 1 : 0.3}"/>`)
    .join('')
  const flame = `<path d="M9 2.5c.6 2.7 3.6 4.3 3.6 7.9A4.6 4.6 0 0 1 3.4 10.6c0-1.6.7-2.8 1.7-3.8.1 1.3.8 2.2 1.8 2.6C6.5 6.9 7.4 4.7 9 2.5z" fill="none" stroke="${isWarm ? '#e8a33d' : '#8b949e'}" stroke-width="1.5" stroke-linejoin="round"/>`
  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(Math.floor(secondsLeft % 60)).padStart(2, '0')
  const lines = isWorking
    ? ['Prompt cache in use', 'The agent is working, reusing your chat from the cache.']
    : isWarm
      ? ['Prompt cache warm', 'The agent keeps your chat so far in a short-lived cache. While it is warm, your next message reuses it: faster and much cheaper.', `Bars show the time left: ${minutes}:${seconds}. The cache lasts 5 min after the last reply, then rests.`, 'Good time to send a follow-up.']
      : ['Prompt cache cold', 'More than 5 minutes since the last reply, so the cache has rested. Your next message reads the whole chat again: slower and costlier.']
  if (hitPercent !== null) lines.push(`The last request read ${hitPercent}% of its input from the cache.`)
  const title = lines.map(line => escape(line)).join('\n\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="70" height="20" viewBox="0 0 70 20"><title>${title}</title><rect width="70" height="20" fill="transparent"/>${flame}${bars}</svg>`
}

// What a drawn control runs when pressed, by its Client's key: set while the
// drawing is made, run by the press hook in pane.tsx.
export const pressHandlers = new Map<string, () => void>()

// What a drawn control that lights on hover runs as the pointer enters and
// leaves it, by its Client's key; run by the same hook in pane.tsx.
export const hoverHandlers = new Map<string, (isOn: boolean) => void>()

// How a drawn control lights: its lit picture, the same size, drawn always and
// shown in place of the one at rest while `isHot`, so no image loads on hover.
export type DrawnHover = { hotSource: string; isHot: boolean; onHover: (isOn: boolean) => void }

// A picture that presses like a Button on the desktop: the Svg with a Client
// laid over it. Where there is no Client, the caller draws a Button instead.
// The Client holds the pointer, so a hover reaches the plugin through it,
// never through a Box's hover props.
export function drawnButton(ui: Ui, key: string, source: string, alt: string, width: number, height: number, onPress: () => void, hover?: DrawnHover) {
  const { Box, Svg, Client } = ui
  if (Svg === undefined || Client === undefined) return null
  pressHandlers.set(key, onPress)
  if (hover !== undefined) hoverHandlers.set(key, hover.onHover)
  return (
    <Box key={`drawn-${key}`} position="relative" flexShrink={0}>
      <Svg source={source} alt={alt} width={width} height={height} />
      {hover !== undefined && (
        <Box key={`hot-${key}`} position="absolute" top={0} left={0} display={hover.isHot ? 'flex' : 'none'}>
          <Svg source={hover.hotSource} alt={alt} width={width} height={height} />
        </Box>
      )}
      <Box position="absolute" top={0} left={0} right={0} bottom={0}>
        <Client key={key} module="./press.tsx" props={{ hovers: hover !== undefined }} width="100%" height="100%" />
      </Box>
    </Box>
  )
}

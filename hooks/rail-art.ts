// The desktop rail drawn as one picture: a Craftshop wordmark, then pills for
// the prompt cache, cost, dials, sources and worktree, each with its own icon.
// It returns the SVG and where each segment sits, so the Client laid over it
// (rail-click.tsx) can map a press or hover to its segment.
import type { Tab } from '../types'

export type RailSegment = { x0: number; x1: number; tab: Tab | 'pane'; caption: string }

export type RailArt = { source: string; width: number; height: number; segments: RailSegment[] }

export type RailArtFigures = {
  cacheSecondsLeft: number | null
  isWorking: boolean
  cachePercent: number | null
  costUsd: number | null
  preset: string
  presetLevels: number[]
  sourcesOn: number
  sourcesTotal: number
  branch: string | null
}

const HEIGHT = 34
const SANS = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`
const ROUNDED = `ui-rounded, 'SF Pro Rounded', -apple-system, system-ui, sans-serif`
const BARS = ['#5aaeff', '#2fcfa6', '#74d16f', '#a8c94a', '#d8bf45']

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// A width for text set in the system face, close enough to lay pills out by.
function textWidth(text: string, size: number, isBold = false): number {
  let units = 0
  for (const char of text) units += /[mwMW@]/.test(char) ? 0.86 : /[il.:,'|!1]/.test(char) ? 0.3 : /[A-Z0-9$]/.test(char) ? 0.64 : 0.54
  return units * size * (isBold ? 1.0 : 0.95)
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function anvil(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})"><defs><linearGradient id="brandMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0a35e"/><stop offset="1" stop-color="#d97757"/></linearGradient></defs><path d="M1 4.5h12.5c0 2.6-2.1 4.5-4.6 4.6l1.6 3.4H13v2H3v-2h2.3l1.6-3.4C3.6 8.9 1 7.4 1 4.5z" fill="url(#brandMark)"/><path d="M14.6 4.5h2.4" stroke="#d97757" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="1.8" r="1" fill="#f6c177"/></g>`
}

function flame(x: number, y: number, isWarm: boolean): string {
  const color = isWarm ? '#f0a35e' : 'var(--dim)'
  return `<path transform="translate(${x} ${y})" d="M7 0.8c.5 2.4 3.3 3.9 3.3 7.2a4.3 4.3 0 0 1-8.6.2c0-1.5.6-2.6 1.6-3.5.1 1.2.7 2 1.7 2.4C4.6 4.8 5.6 2.8 7 .8z" fill="${isWarm ? 'rgba(240,163,94,0.18)' : 'none'}" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>`
}

function radarMini(x: number, y: number, levels: number[]): string {
  const point = (index: number, level: number) => {
    const angle = ((-90 + (index * 360) / levels.length) * Math.PI) / 180
    return `${(7 + Math.cos(angle) * 6.6 * (level / 5)).toFixed(2)},${(7 + Math.sin(angle) * 6.6 * (level / 5)).toFixed(2)}`
  }
  const ring = levels.map((_, index) => point(index, 5)).join(' ')
  const shape = levels.map((level, index) => point(index, level)).join(' ')
  return `<g transform="translate(${x} ${y})"><polygon points="${ring}" fill="none" stroke="var(--dim)" stroke-opacity="0.6"/><polygon points="${shape}" fill="#8f9cff" fill-opacity="0.35" stroke="#8f9cff" stroke-width="1.2" stroke-linejoin="round"/></g>`
}

function pages(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})" fill="none" stroke-width="1.3" stroke-linejoin="round"><rect x="3.5" y="0.7" width="9" height="11" rx="1.6" stroke="#5cc8e8" stroke-opacity="0.5"/><rect x="1" y="2.7" width="9" height="11" rx="1.6" stroke="#5cc8e8" fill="rgba(92,200,232,0.14)"/><path d="M3.2 6.4h4.6M3.2 8.8h3.2" stroke="#5cc8e8" stroke-linecap="round"/></g>`
}

function branch(x: number, y: number, isOn: boolean): string {
  const color = isOn ? '#3fb950' : 'var(--dim)'
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"><circle cx="3.5" cy="2.5" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="11" cy="4.5" r="1.8"/><path d="M3.5 4.3v5.9M11 6.3c0 3-3.2 2.8-6.3 4.2"/></g>`
}

export function railArt(figures: RailArtFigures, hover: number | null, showsBrand: boolean): RailArt {
  const parts: string[] = []
  const segments: RailSegment[] = []
  const mid = HEIGHT / 2
  let x = 0

  const segment = (width: number, tab: RailSegment['tab'], caption: string, draw: (left: number) => string) => {
    const index = segments.length
    const isHover = hover === index
    parts.push(`<rect x="${x + 0.5}" y="3.5" width="${width - 1}" height="${HEIGHT - 7}" rx="${(HEIGHT - 7) / 2}" class="pill${isHover ? ' hot' : ''}"/>`)
    parts.push(draw(x))
    segments.push({ x0: x, x1: x + width, tab, caption })
    x += width + 6
  }

  if (showsBrand) {
    const word = 'Craftshop'
    const width = 12 + 18 + 7 + textWidth(word, 13.5, true) + 14
    segment(width, 'pane', 'Open Craftshop', left => `${anvil(left + 12, mid - 8)}<text x="${left + 12 + 18 + 7}" y="${mid + 4.6}" font-family="${ROUNDED}" font-size="13.5" font-weight="700" fill="url(#brandText)" letter-spacing="0.1">${word}</text>`)
  }

  if (figures.cacheSecondsLeft !== null) {
    const left = figures.cacheSecondsLeft
    const isWarm = figures.isWorking || left > 0
    const lit = figures.isWorking ? 5 : Math.ceil(left / 60)
    const label = figures.isWorking ? 'In use' : isWarm ? clock(left) : 'Cold'
    const width = 12 + 14 + 7 + 5 * 6 + 4 * 3 + 9 + textWidth(label, 12.5, true) + 14
    const caption = figures.isWorking
      ? 'Prompt cache in use: the agent is working, reusing your chat from the cache.'
      : isWarm
        ? `Prompt cache warm, ${clock(left)} left: your next message reuses the chat, so it is faster and much cheaper. Good time to send a follow-up.`
        : 'Prompt cache cold: more than 5 minutes since the last reply, so the next message reads the whole chat again.'
    segment(width, 'context', caption + (figures.cachePercent === null ? '' : ` Last request: ${figures.cachePercent}% from the cache.`), left => {
      const bars = BARS.map((color, index) => `<rect x="${left + 12 + 14 + 7 + index * 9}" y="${mid - 7}" width="6" height="14" rx="3" fill="${index < lit ? color : 'var(--track)'}"/>`).join('')
      return `${flame(left + 12, mid - 7.5, isWarm)}${bars}<text x="${left + 12 + 14 + 7 + 45 + 9}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="${isWarm ? 650 : 500}" fill="${isWarm ? 'var(--text)' : 'var(--dim)'}" class="num">${label}</text>`
    })
  }

  if (figures.costUsd !== null) {
    const label = `$${figures.costUsd.toFixed(2)}`
    const width = 12 + textWidth(label, 12.5, true) + 12
    segment(width, 'context', `This session has cost ${label} so far.`, left => `<text x="${left + 12}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="var(--text)" class="num">${label}</text>`)
  }

  {
    const label = figures.preset
    const width = 12 + 14 + 7 + textWidth(label, 12.5, true) + 14
    segment(width, 'dials', `Dials: ${label}. Open them to see how the agent plans, delegates, persists, asks, proves and talks.`, left => `${radarMini(left + 12, mid - 7, figures.presetLevels)}<text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="var(--text)">${escape(label)}</text>`)
  }

  {
    const count = figures.sourcesTotal === figures.sourcesOn ? String(figures.sourcesOn) : `${figures.sourcesOn}/${figures.sourcesTotal}`
    const word = figures.sourcesTotal === 1 ? ' source' : ' sources'
    const width = 12 + 14 + 7 + textWidth(count, 12.5, true) + textWidth(word, 12.5) + 14
    segment(width, 'context', figures.sourcesTotal === 0 ? 'No context sources yet. Open Context to add files, links or notes.' : `${figures.sourcesOn} of ${figures.sourcesTotal} context sources reach the agent.`, left => `${pages(left + 12, mid - 7.5)}<text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5"><tspan font-weight="650" fill="var(--text)">${count}</tspan><tspan fill="var(--dim)">${word}</tspan></text>`)
  }

  {
    const label = figures.branch ?? 'No worktree'
    const width = 12 + 14 + 7 + textWidth(label, 12.5, figures.branch !== null) + 14
    segment(width, 'worktree', figures.branch === null ? 'Perm worktree is off for this session.' : `This session works in a perm worktree on ${figures.branch}.`, left => `${branch(left + 12, mid - 7, figures.branch !== null)}<text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="${figures.branch === null ? 500 : 600}" fill="${figures.branch === null ? 'var(--dim)' : 'var(--text)'}">${escape(label)}</text>`)
  }

  const width = Math.ceil(x - 6)
  // Theme colours are custom properties, which a presentation attribute does
  // not read everywhere; a style declaration does.
  const painted = parts.join('').replace(/(fill|stroke)="var\((--[A-Za-z]+)\)"/g, 'style="$1: var($2)"')
  const style = `<style>
    svg { --text: #ecebe8; --dim: #9a9aa2; --track: rgba(154,154,162,0.28); --pill: rgba(255,255,255,0.045); --pillLine: rgba(255,255,255,0.09); --hot: rgba(143,156,255,0.16); --hotLine: rgba(143,156,255,0.55); }
    @media (prefers-color-scheme: light) { svg { --text: #1f1f22; --dim: #6b6b72; --track: rgba(107,107,114,0.25); --pill: rgba(0,0,0,0.035); --pillLine: rgba(0,0,0,0.09); --hot: rgba(90,110,240,0.12); --hotLine: rgba(90,110,240,0.5); } }
    .num { font-variant-numeric: tabular-nums; }
    .pill { fill: var(--pill); stroke: var(--pillLine); }
    .pill.hot { fill: var(--hot); stroke: var(--hotLine); }
  </style>`
  const defs = `<defs><linearGradient id="brandText" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f2a65a"/><stop offset="1" stop-color="#e0715a"/></linearGradient></defs>`
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">${style}${defs}${painted}</svg>`,
    width,
    height: HEIGHT,
    segments,
  }
}

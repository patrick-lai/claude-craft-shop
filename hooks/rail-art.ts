// The desktop rail's pills, each its own picture: fishStack's mark, then
// the prompt cache, tokens, dials, sources and worktree, each with its icon.
// Every pill comes drawn twice, at rest and lit, so the surface can swap them
// on hover without a round trip (rail.tsx), and with the caption it shows.
import type { Tab } from '../types'
import { paint } from './art'
import { brandMark } from './brand'

export type RailPill = { id: string; tab: Tab | 'pane'; caption: string; width: number; height: number; source: string; hotSource: string }

export type RailArtFigures = {
  cacheSecondsLeft: number | null
  isWorking: boolean
  cachePercent: number | null
  // Tokens this session sent and received, summed from each turn's usage;
  // null before the first turn ends.
  tokens: { input: number; output: number } | null
  // Claude Code's own estimate (/cost): each response priced at its model's
  // API list price. Not what a subscription or plan is billed.
  costUsd: number | null
  preset: string
  presetLevels: number[]
  sourcesOn: number
  sourcesTotal: number
  branch: string | null
}

const HEIGHT = 28
// The pills are drawn at 28px and shown at 0.88 of that, icons and words
// alike, so the rail stays a slim row beside the composer.
const SCALE = 0.88
const SANS = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`
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

// A token count as the status line spells one: 812, 48.2k, 1.4M.
function compact(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1)}k`
  return String(count)
}

// Tokens both ways, as one glyph: up (blue) beside down (green).
function updown(x: number, mid: number): string {
  return `<path transform="translate(${x} ${mid - 6})" d="M3 11V1.5M.5 4 3 1.5 5.5 4" fill="none" stroke="#5aaeff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path transform="translate(${x + 6} ${mid - 6})" d="M3 1v9.5M.5 8 3 10.5 5.5 8" fill="none" stroke="#3fb950" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
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

// The pills that can give up their words for the rail to fit one row, in the
// order they do, down to their icon. The mark (always alone), the cache
// gauge, the cost and the sources count (always its icon and number) never do.
export const COMPACTABLE = ['worktree', 'dials'] as const
export type Compactable = (typeof COMPACTABLE)[number]

export function railArt(figures: RailArtFigures, iconOnly: ReadonlySet<Compactable> = new Set()): RailPill[] {
  const pills: RailPill[] = []
  const mid = HEIGHT / 2

  const pill = (id: string, width: number, tab: RailPill['tab'], caption: string, draw: (left: number) => string) => {
    const whole = Math.ceil(width)
    const shown = Math.ceil(whole * SCALE)
    const tall = Math.round(HEIGHT * SCALE)
    const svg = (isHot: boolean) => {
      const inner = `<rect x="0.5" y="0.5" width="${whole - 1}" height="${HEIGHT - 1}" rx="${(HEIGHT - 1) / 2}" class="pill${isHot ? ' hot' : ''}"/>${draw(0)}`
      // Theme colours are custom properties, which a presentation attribute
      // does not read everywhere; a style declaration does.
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${shown}" height="${tall}" viewBox="0 0 ${whole} ${HEIGHT}">${STYLE}${paint(inner)}</svg>`
    }
    pills.push({ id, tab, caption, width: shown, height: tall, source: svg(false), hotSource: svg(true) })
  }

  // The mark alone in a round pill: the name is in the pane.
  pill('brand', HEIGHT, 'pane', 'Open fishStack', left => brandMark(left + 4, 4, HEIGHT - 8, 'railMark'))

  // The cache gauge is always there: empty until a reply has been seen.
  {
    const left = figures.cacheSecondsLeft
    const isWarm = figures.isWorking || (left !== null && left > 0)
    const lit = figures.isWorking ? 5 : left === null ? 0 : Math.ceil(left / 60)
    const width = 12 + 14 + 7 + 5 * 6 + 4 * 3 + 12
    const caption = figures.isWorking
      ? 'Prompt cache in use'
      : left === null
        ? 'Prompt cache: the gauge starts with the next reply'
        : isWarm
          ? `Cache warm, ${clock(left)} left: replies now are cheaper`
          : 'Cache cold: the next message rereads the chat'
    pill('cache', width, 'context', caption, left => {
      const bars = BARS.map((color, index) => `<rect x="${left + 12 + 14 + 7 + index * 9}" y="${mid - 7}" width="6" height="14" rx="3" fill="${index < lit ? color : 'var(--track)'}"/>`).join('')
      return `${flame(left + 12, mid - 7.5, isWarm)}${bars}`
    })
  }

  // The cost whenever Claude Code has one, the tokens sent when it has not;
  // the tokens under the pointer once any are counted.
  if (figures.tokens !== null || figures.costUsd !== null) {
    const sent = figures.tokens === null ? null : compact(figures.tokens.input)
    const received = figures.tokens === null ? null : compact(figures.tokens.output)
    const cost = figures.costUsd === null ? null : `≈ $${figures.costUsd.toFixed(2)}`
    const label = cost ?? sent ?? ''
    const width = 12 + 12 + 7 + textWidth(label, 12.5, true) + 14
    const counted = sent === null ? null : `↑ ${sent} sent · ↓ ${received} received`
    const caption = [counted, cost === null ? null : counted === null ? `${cost} at API list price, not your bill` : 'API list price, not your bill'].filter(Boolean).join(' · ')
    pill('tokens', width, 'context', caption, left => `${updown(left + 12, mid)}<text x="${left + 12 + 12 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="var(--text)" class="num">${escape(label)}</text>`)
  }

  {
    const label = figures.preset
    const isIcon = iconOnly.has('dials')
    const width = isIcon ? 12 + 14 + 12 : 12 + 14 + 7 + textWidth(label, 12.5, true) + 14
    pill('dials', width, 'dials', `Dials: ${label} · tune how the agent works`, left => isIcon ? radarMini(left + 12, mid - 7, figures.presetLevels) : `${radarMini(left + 12, mid - 7, figures.presetLevels)}<text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="var(--text)">${escape(label)}</text>`)
  }

  {
    const count = figures.sourcesTotal === figures.sourcesOn ? String(figures.sourcesOn) : `${figures.sourcesOn}/${figures.sourcesTotal}`
    const width = 12 + 14 + 7 + textWidth(count, 12.5, true) + 14
    pill('sources', width, 'context', figures.sourcesTotal === 0 ? 'Add files, links or notes' : `${figures.sourcesOn} of ${figures.sourcesTotal} sources reach the agent`, left => `${pages(left + 12, mid - 7.5)}<text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5"><tspan font-weight="650" fill="var(--text)">${count}</tspan></text>`)
  }

  {
    const label = figures.branch ?? 'No worktree'
    const isIcon = iconOnly.has('worktree')
    const width = isIcon ? 12 + 14 + 12 : 12 + 14 + 7 + textWidth(label, 12.5, figures.branch !== null) + 14
    pill('worktree', width, 'worktree', figures.branch === null ? 'Perm worktree is off' : `Working in perm worktree ${figures.branch}`, left => isIcon ? branch(left + 12, mid - 7, figures.branch !== null) : `${branch(left + 12, mid - 7, figures.branch !== null)}<text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="${figures.branch === null ? 500 : 600}" fill="${figures.branch === null ? 'var(--dim)' : 'var(--text)'}">${escape(label)}</text>`)
  }

  return pills
}

const STYLE = `<style>
  svg { --text: #ecebe8; --dim: #9a9aa2; --track: rgba(154,154,162,0.28); --pill: rgba(255,255,255,0.045); --pillLine: rgba(255,255,255,0.09); --hot: rgba(143,156,255,0.16); --hotLine: rgba(143,156,255,0.55); }
  @media (prefers-color-scheme: light) { svg { --text: #1f1f22; --dim: #6b6b72; --track: rgba(107,107,114,0.25); --pill: rgba(0,0,0,0.035); --pillLine: rgba(0,0,0,0.09); --hot: rgba(90,110,240,0.12); --hotLine: rgba(90,110,240,0.5); } }
  .num { font-variant-numeric: tabular-nums; }
  .pill { fill: var(--pill); stroke: var(--pillLine); }
  .pill.hot { fill: var(--hot); stroke: var(--hotLine); }
</style>`


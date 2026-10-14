// The desktop rail's pills, each its own picture: fishStack's mark, then
// the prompt cache, tokens, dials, sources and worktree, each with its icon.
// Every pill comes drawn twice, at rest and lit, so the surface can swap them
// on hover without a round trip (rail.tsx), and with the caption it shows.
import type { Tab } from '../types'
import { paint } from './art'
import { brandMark } from './brand'

// Where a press takes you: a tab, the pane as it was, or nowhere (a pill with
// no pane of its own only explains itself on hover).
export type RailPill = { id: string; tab: Tab | 'pane' | null; caption: string; width: number; height: number; source: string; hotSource: string }

// Autopilot answering for a person who is away, as the rail shows it (only
// while Autonomy is on Autopilot): a question waiting, with the time left of
// its wait, or what was picked once nobody answered.
export type RailAutopilot =
  | { kind: 'waiting'; secondsLeft: number; totalSeconds: number; picked: string; count: number }
  | { kind: 'answered'; at: string; picked: string; waitedMinutes: number }

export type RailArtFigures = {
  cacheSecondsLeft: number | null
  isWorking: boolean
  cachePercent: number | null
  // Tokens this session sent and received, summed from each turn's usage
  // (Claude's own counts), with how much of what was sent the prompt cache
  // served and how much was written to it; null before the first turn ends.
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null
  // Claude Code's own estimate (/cost): each response priced at its model's
  // API list price. Not what a subscription or plan is billed.
  costUsd: number | null
  preset: string
  presetLevels: number[]
  sourcesOn: number
  sourcesTotal: number
  branch: string | null
  // While the worktree is made, the step it is on; null once ready or off.
  preparingStep: string | null
  autopilot: RailAutopilot | null
  // The Use dials and Use context switches: off, their pills say Off.
  isDialsOn: boolean
  isContextOn: boolean
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

// The cache's hit rate as Claude reported it: the last response's share of
// input read from the cache, and the session's, summed over its turns.
export function cacheStats(figures: Pick<RailArtFigures, 'cachePercent' | 'tokens'>): string[] {
  const stats: string[] = []
  if (figures.cachePercent !== null) stats.push(`last reply ${figures.cachePercent}% from cache`)
  const tokens = figures.tokens
  if (tokens !== null && tokens.cacheRead !== undefined && tokens.input > 0) {
    stats.push(`session ${Math.round((tokens.cacheRead / tokens.input) * 100)}% (${compact(tokens.cacheRead)} of ${compact(tokens.input)} input tokens)`)
  }
  return stats
}

// A token count as the status line spells one: 812, 48.2k, 1.4M.
export function compact(count: number): string {
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

function branch(x: number, y: number, isOn: boolean, isPreparing = false): string {
  const color = isPreparing ? '#f0a35e' : isOn ? '#3fb950' : 'var(--dim)'
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"><circle cx="3.5" cy="2.5" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="11" cy="4.5" r="1.8"/><path d="M3.5 4.3v5.9M11 6.3c0 3-3.2 2.8-6.3 4.2"/></g>`
}

// Autopilot's wait in the radar's place: a ring that runs down as the
// question waits, amber like a timer; then a check, once it has answered.
function waitRing(x: number, y: number, share: number): string {
  const r = 6
  const c = 2 * Math.PI * r
  const left = Math.max(0, Math.min(1, share))
  return `<g transform="translate(${x} ${y})"><circle cx="7" cy="7" r="${r}" fill="none" stroke="var(--track)" stroke-width="2"/><circle cx="7" cy="7" r="${r}" fill="none" stroke="#f0a35e" stroke-width="2" stroke-linecap="round" stroke-dasharray="${(c * left).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 7 7)"/><path d="M7 4.2V7l1.8 1.2" fill="none" stroke="#f0a35e" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></g>`
}

function answeredMark(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})"><circle cx="7" cy="7" r="6.4" fill="rgba(63,185,80,0.2)" stroke="#3fb950" stroke-width="1.4"/><path d="M4.2 7.2 6.2 9.2 9.9 5" fill="none" stroke="#3fb950" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>`
}

// The pills that can give up their words for the rail to fit one row, in the
// order they do, down to their icon. The mark (always alone), the cache
// gauge, the cost and the sources count (always its icon and number) never do.
export const COMPACTABLE = ['worktree', 'dials'] as const
export type Compactable = (typeof COMPACTABLE)[number]

export function railArt(figures: RailArtFigures, iconOnly: ReadonlySet<Compactable> = new Set()): RailPill[] {
  const pills: RailPill[] = []
  const mid = HEIGHT / 2

  const pill = (id: string, width: number, tab: RailPill['tab'], caption: string, draw: (left: number) => string, tone = '') => {
    const whole = Math.ceil(width)
    const shown = Math.ceil(whole * SCALE)
    const tall = Math.round(HEIGHT * SCALE)
    const svg = (isHot: boolean) => {
      const inner = `<rect x="0.5" y="0.5" width="${whole - 1}" height="${HEIGHT - 1}" rx="${(HEIGHT - 1) / 2}" class="pill${tone}${isHot ? ' hot' : ''}"/>${draw(0)}`
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
    const state = figures.isWorking
      ? 'Prompt cache in use'
      : left === null
        ? 'Prompt cache: the gauge starts with the next reply'
        : isWarm
          ? `Cache warm, ${clock(left)} left: replies now are cheaper`
          : 'Cache cold: the next message rereads the chat'
    const caption = [state, ...cacheStats(figures)].join(' · ')
    pill('cache', width, null, caption, left => {
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
    // Claude Code's /cost prices every response at its model's API list
    // price, cache reads and writes included at their own rates.
    const caption = [counted, cost === null ? null : `${counted === null ? `${cost} ` : ''}API list price, cache reads and writes included; not your bill`].filter(Boolean).join(' · ')
    pill('tokens', width, null, caption, left => `${updown(left + 12, mid)}<text x="${left + 12 + 12 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="var(--text)" class="num">${escape(label)}</text>`)
  }

  // The dials pill. On Autopilot it also says when Autopilot is answering for
  // you: tinted, its radar swapped for a ring that runs down while a question
  // waits, then a check once it answered. Same width either way, so nothing
  // beside it moves, and the icon stays when the pill gives up its words.
  {
    const label = figures.isDialsOn ? figures.preset : 'Off'
    const isIcon = iconOnly.has('dials')
    const width = isIcon ? 12 + 14 + 12 : 12 + 14 + 7 + textWidth(label, 12.5, true) + 14
    const auto = figures.autopilot
    const icon = (left: number) =>
      auto === null
        ? radarMini(left + 12, mid - 7, figures.presetLevels)
        : auto.kind === 'waiting'
          ? waitRing(left + 12, mid - 7, auto.secondsLeft / Math.max(1, auto.totalSeconds))
          : answeredMark(left + 12, mid - 7)
    const caption = !figures.isDialsOn
      ? 'Dials are off: the agent gets no working style'
      : auto === null
        ? `Dials: ${label} · tune how the agent works`
        : auto.kind === 'waiting'
          ? `Autopilot picks ${auto.picked} ${auto.secondsLeft < 60 ? 'in under a minute' : `in ${Math.ceil(auto.secondsLeft / 60)} min`} unless you answer${auto.count > 1 ? ` · ${auto.count} questions waiting` : ''}`
          : `Autopilot answered ${auto.picked} at ${auto.at}: nobody had for ${auto.waitedMinutes} min`
    const tone = auto === null ? '' : auto.kind === 'waiting' ? ' wait' : ' done'
    const drawn = (left: number) => (figures.isDialsOn ? icon(left) : `<g opacity="0.45">${icon(left)}</g>`)
    const weight = figures.isDialsOn ? 600 : 500
    const ink = figures.isDialsOn ? 'var(--text)' : 'var(--dim)'
    pill('dials', width, 'dials', caption, left => (isIcon ? drawn(left) : `${drawn(left)}<text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="${weight}" fill="${ink}">${escape(label)}</text>`), tone)
  }

  {
    const isOn = figures.isContextOn
    const count = !isOn ? 'Off' : figures.sourcesTotal === figures.sourcesOn ? String(figures.sourcesOn) : `${figures.sourcesOn}/${figures.sourcesTotal}`
    const width = 12 + 14 + 7 + textWidth(count, 12.5, true) + 14
    const caption = !isOn ? 'Context is off: no source reaches the agent' : figures.sourcesTotal === 0 ? 'Add files, links or notes' : `${figures.sourcesOn} of ${figures.sourcesTotal} sources reach the agent`
    pill('sources', width, 'context', caption, left => `<g opacity="${isOn ? 1 : 0.45}">${pages(left + 12, mid - 7.5)}</g><text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5"><tspan font-weight="${isOn ? 650 : 500}" fill="${isOn ? 'var(--text)' : 'var(--dim)'}">${count}</tspan></text>`)
  }

  {
    const preparing = figures.preparingStep
    const label = preparing !== null ? 'Preparing' : (figures.branch ?? 'No worktree')
    const isLit = preparing !== null || figures.branch !== null
    const isIcon = iconOnly.has('worktree')
    const width = isIcon ? 12 + 14 + 12 : 12 + 14 + 7 + textWidth(label, 12.5, isLit) + 14
    const caption = preparing !== null ? `Read-only until the worktree is ready · ${preparing}` : figures.branch === null ? 'No worktree for this session' : `Working in worktree ${figures.branch}`
    const icon = (left: number) => branch(left + 12, mid - 7, figures.branch !== null, preparing !== null)
    pill('worktree', width, 'worktree', caption, left => isIcon ? icon(left) : `${icon(left)}<text x="${left + 12 + 14 + 7}" y="${mid + 4.4}" font-family="${SANS}" font-size="12.5" font-weight="${isLit ? 600 : 500}" fill="${isLit ? 'var(--text)' : 'var(--dim)'}">${escape(label)}</text>`, preparing !== null ? ' wait' : '')
  }

  return pills
}

const STYLE = `<style>
  svg { --text: #ecebe8; --dim: #9a9aa2; --track: rgba(154,154,162,0.28); --pill: rgba(255,255,255,0.045); --pillLine: rgba(255,255,255,0.09); --hot: rgba(143,156,255,0.16); --hotLine: rgba(143,156,255,0.55); }
  @media (prefers-color-scheme: light) { svg { --text: #1f1f22; --dim: #6b6b72; --track: rgba(107,107,114,0.25); --pill: rgba(0,0,0,0.035); --pillLine: rgba(0,0,0,0.09); --hot: rgba(90,110,240,0.12); --hotLine: rgba(90,110,240,0.5); } }
  .num { font-variant-numeric: tabular-nums; }
  .pill { fill: var(--pill); stroke: var(--pillLine); }
  .pill.hot { fill: var(--hot); stroke: var(--hotLine); }
  .pill.wait { fill: rgba(240,163,94,0.12); stroke: rgba(240,163,94,0.6); }
  .pill.wait.hot { fill: rgba(240,163,94,0.22); stroke: rgba(240,163,94,0.9); }
  .pill.done { fill: rgba(63,185,80,0.12); stroke: rgba(63,185,80,0.6); }
  .pill.done.hot { fill: rgba(63,185,80,0.22); stroke: rgba(63,185,80,0.9); }
</style>`


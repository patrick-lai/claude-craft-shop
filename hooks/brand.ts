// fishStack's mark, "Moonlit": two pale koi chasing round a ripple on night
// water, a school of two. Their eyes show where the mark is drawn at 32px or
// more; smaller, they would read as specks. The one-colour template a tray
// icon wants has fuller fish, so they never read as a pair of sync arrows.
//
// Drawn on a 64-unit grid; `brandMark` places it at any size in a larger
// drawing, `brandIcon` and `brandTemplate` are standalone files (e2e/brand.mjs
// writes them to assets/).

const NIGHT_INNER = '#1e3a5f'
const NIGHT_OUTER = '#0a1426'
const EDGE = '#8fd3f4'
const KOI_LIGHT = '#eaf6ff'
const KOI_BLUE = '#8fd3f4'
const RIPPLE = '#9cc9e8'

type Point = [number, number]

const f = (n: number) => n.toFixed(2)

// A koi swimming round the centre: its snout at `start` degrees, its body
// following the circle for `sweep` degrees (clockwise), round at the head and
// tapering to a forked tail. Returns the outline and where its eye goes.
function koi(start: number, sweep: number, radius: number, width: number): { d: string; eye: Point } {
  const steps = 36
  const along = (t: number): [number, number, number] => {
    const angle = ((start + sweep * t) * Math.PI) / 180
    return [32 + radius * Math.cos(angle), 32 + radius * Math.sin(angle), angle]
  }
  const left: Point[] = []
  const right: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const [x, y, angle] = along(t)
    // Half-width: a round head, widest a third along, a slim wrist.
    const half = ((width * (Math.sqrt(t) * (1 - t) ** 1.15)) / 0.43) * 0.5 + (t > 0.92 ? 0.6 : 0)
    left.push([x + Math.cos(angle) * half, y + Math.sin(angle) * half])
    right.push([x - Math.cos(angle) * half, y - Math.sin(angle) * half])
  }
  // The tail: two lobes fanning out behind the wrist, along the circle.
  const [tx, ty, ta] = along(1)
  const back: Point = [-Math.sin(ta), Math.cos(ta)]
  const out: Point = [Math.cos(ta), Math.sin(ta)]
  const reach = 7.5
  const spread = 4.6
  const tail: Point[] = [
    [tx + back[0] * reach + out[0] * spread, ty + back[1] * reach + out[1] * spread],
    [tx + back[0] * reach * 0.55, ty + back[1] * reach * 0.55],
    [tx + back[0] * reach - out[0] * spread, ty + back[1] * reach - out[1] * spread],
  ]
  const outline = [...left, ...tail, ...right.reverse()]
  const d = `M${outline.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')}Z`
  const [ex, ey, ea] = along(0.12)
  return { d, eye: [ex + Math.cos(ea) * width * 0.18, ey + Math.sin(ea) * width * 0.18] }
}

// The pair, a gap of 30 degrees between each head and the other's tail.
const PALE = koi(-80, 150, 15.5, 9.5)
const BLUE = koi(100, 150, 15.5, 9.5)
// Fuller fish for the one-colour template, the gap the same.
const PALE_FULL = koi(-80, 150, 15.5, 12)
const BLUE_FULL = koi(100, 150, 15.5, 12)

// The mark's own markup on its 64-unit grid; `id` keeps its gradient apart
// from any other in the same drawing.
function body(id: string, hasEyes: boolean): string {
  const eyes = hasEyes
    ? [PALE.eye, BLUE.eye].map(([x, y]) => `<circle cx="${f(x)}" cy="${f(y)}" r="1.5" fill="${NIGHT_OUTER}"/>`).join('')
    : ''
  return (
    `<defs><radialGradient id="${id}" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="${NIGHT_INNER}"/><stop offset="1" stop-color="${NIGHT_OUTER}"/></radialGradient></defs>` +
    `<circle cx="32" cy="32" r="30" fill="url(#${id})" stroke="${EDGE}" stroke-opacity=".35" stroke-width="1.5"/>` +
    `<circle cx="32" cy="32" r="6" fill="none" stroke="${RIPPLE}" stroke-opacity=".45" stroke-width="1.4"/>` +
    `<circle cx="32" cy="32" r="2.2" fill="#e6f4ff" fill-opacity=".8"/>` +
    `<path d="${PALE.d}" fill="${KOI_LIGHT}"/><path d="${BLUE.d}" fill="${KOI_BLUE}"/>` +
    eyes
  )
}

// The mark at (x, y), `size` units across, inside a larger SVG.
export function brandMark(x: number, y: number, size: number, id = 'fishStackMark'): string {
  return `<g transform="translate(${x} ${y}) scale(${size / 64})">${body(id, size >= 32)}</g>`
}

// The full-colour icon as a file: the eyes included.
export function brandIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${body('fishStackMark', true)}</svg>\n`
}

// The one-colour template (black on clear, as macOS tray icons are): the disc
// with the two koi and the ripple's centre cut out, no eyes.
export function brandTemplate(): string {
  const cuts = `<path d="${PALE_FULL.d}" fill="#000"/><path d="${BLUE_FULL.d}" fill="#000"/><circle cx="32" cy="32" r="3" fill="#000"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><mask id="cut"><circle cx="32" cy="32" r="30" fill="#fff"/>${cuts}</mask><circle cx="32" cy="32" r="30" fill="#000" mask="url(#cut)"/></svg>\n`
}

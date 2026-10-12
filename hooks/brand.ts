// fishStack's mark: a round disc, teal to blue, with three lenses rising in a
// stack, a school that is also a stack of layers. The leader has an eye where
// the mark is drawn at 32px or more; smaller, and in the one-colour template a
// tray icon wants, it has none (it would read as a speck).
//
// Drawn on a 32-unit grid; `brandMark` places it at any size in a larger
// drawing, `brandIcon` and `brandTemplate` are standalone files (e2e/brand.mjs
// writes them to assets/).

const TEAL = '#5eead4'
const BLUE = '#3b82f6'
const EYE = '#1d4ed8'
// Each lens's centre, from the top: shifted one way, then the other.
const LENSES: [number, number][] = [
  [13.6, 9.4],
  [18.2, 16],
  [13.6, 22.6],
]
const OPACITY = [1, 0.9, 0.8]
const TILT = -14

// A lens: two arcs meeting in points, a body with no tail.
function lens(cx: number, cy: number): string {
  const width = 16.5
  const bulge = 3.1
  const x0 = cx - width / 2
  const x1 = cx + width / 2
  const f = (n: number) => n.toFixed(2)
  return `M${f(x0)} ${f(cy)}C${f(cx - width / 4)} ${f(cy - bulge)} ${f(cx + width / 4)} ${f(cy - bulge)} ${f(x1)} ${f(cy)}C${f(cx + width / 4)} ${f(cy + bulge)} ${f(cx - width / 4)} ${f(cy + bulge)} ${f(x0)} ${f(cy)}Z`
}

function eye(): string {
  const [cx, cy] = LENSES[0]!
  return `<circle cx="${cx - 4.4}" cy="${cy - 0.3}" r="1.6" fill="${EYE}"/>`
}

// The mark's own markup on its 32-unit grid; `id` keeps its gradient apart
// from any other in the same drawing.
function body(id: string, hasEye: boolean): string {
  const lenses = LENSES.map(([x, y], index) => `<path d="${lens(x, y)}" fill="#fff" fill-opacity="${OPACITY[index]}"/>`).join('')
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${TEAL}"/><stop offset="1" stop-color="${BLUE}"/></linearGradient></defs><circle cx="16" cy="16" r="15" fill="url(#${id})"/><g transform="rotate(${TILT} 16 16)">${lenses}${hasEye ? eye() : ''}</g>`
}

// The mark at (x, y), `size` units across, inside a larger SVG.
export function brandMark(x: number, y: number, size: number, id = 'fishStackMark'): string {
  return `<g transform="translate(${x} ${y}) scale(${size / 32})">${body(id, size >= 32)}</g>`
}

// The full-colour icon as a file: the eye included.
export function brandIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body('fishStackMark', true)}</svg>\n`
}

// The one-colour template (black on clear, as macOS tray icons are): the disc
// with the lenses cut out, no eye.
export function brandTemplate(): string {
  const cuts = LENSES.map(([x, y]) => `<path d="${lens(x, y)}" fill="#000"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><mask id="cut"><circle cx="16" cy="16" r="15" fill="#fff"/><g transform="rotate(${TILT} 16 16)">${cuts}</g></mask><circle cx="16" cy="16" r="15" fill="#000" mask="url(#cut)"/></svg>\n`
}

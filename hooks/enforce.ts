// The dials enforced in code, not only asked for in the prompt. Only rules a
// hook can check without guessing, and each built so it can never trap a
// session: a check that fails lets the call through, a refused edit is
// refused twice at most, and the end of a turn is held back once at most.
//
// The facts are kept as the turn happens (turn.start resets them; guard.ts
// records each tool call), never parsed back from the transcript.
import type { DialKey, DialValues } from '../types'

export type TurnFacts = {
  // How many messages the transcript held as the turn began: the turn's own
  // messages are those after it.
  start: number | null
  // Files or the working tree changed: Edit, Write and the like, a shell
  // command that is not a known read, by the agent or a subagent.
  changes: number
  // Of those, how many touched more than docs.
  codeChanges: number
  // The order calls ran in, so a check can be told apart from one that ran
  // before the last change.
  seq: number
  lastChange: number
  lastCheck: number
  // Subagents the main agent started this turn.
  agents: number
  // A plan the agent made with a tool: TodoWrite, or ExitPlanMode's plan.
  isPlanned: boolean
  // How many edits Foresight has refused this turn.
  foresightRefusals: number
}

export function freshTurn(start: number | null): TurnFacts {
  return { start, changes: 0, codeChanges: 0, seq: 0, lastChange: 0, lastCheck: 0, agents: 0, isPlanned: false, foresightRefusals: 0 }
}

// The turn under way in this process; null outside one.
let facts: TurnFacts = freshTurn(null)

export function beginTurn(start: number | null): void {
  facts = freshTurn(start)
}

export function turnFacts(): TurnFacts {
  return facts
}

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])
// Foresight never refuses more often than this in one turn: past it, the
// agent edits whatever it wrote first.
export const MAX_FORESIGHT_REFUSALS = 2

// Tests, builds, typechecks and linters by their usual names.
const CHECK = /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck|check)\b|\b(jest|vitest|pytest|mocha|rspec|phpunit|tsc|eslint|ruff|mypy|pyright|swiftlint|xcodebuild|gradle|mvn)\b|\bgo\s+(test|build|vet)\b|\bcargo\s+(test|build|check|clippy)\b|\bswift\s+(build|test)\b|\bmake\b|\bplugin\s+(test|validate)\b|\be2e\b/

export function isCheckCommand(command: string): boolean {
  return CHECK.test(command)
}

// A shell command that plainly writes a file: a redirect into one (not
// /dev/null, not 2>&1), an in-place edit, or a copy, move, touch or tee.
// Anything else, git and npm included, is not counted as a change: a
// command merely not known to be a read must never hold a turn back.
const SHELL_WRITE = /(^|[^0-9&>])>{1,2}\s*(?!\/dev\/null|&)[^\s|;&]|\bsed\s+(-[a-zA-Z]*\s+)*-i\b|\bperl\s+-[a-z]*i|\btee\b|(^|[\s;&|(])(cp|mv|touch|install)\s/

export function isShellWrite(command: string): boolean {
  return SHELL_WRITE.test(command)
}

const DOC = /\.(md|mdx|txt|rst|adoc|png|jpe?g|gif|svg)$/i

export function isDocPath(path: string): boolean {
  return DOC.test(path)
}

// A change, as guard.ts sees each call go through.
export function noteChange(path: string | null): void {
  facts.seq++
  facts.changes++
  if (path === null || !isDocPath(path)) facts.codeChanges++
  facts.lastChange = facts.seq
}

export function noteCheck(): void {
  facts.seq++
  facts.lastCheck = facts.seq
}

export function noteAgent(): void {
  facts.agents++
}

export function notePlan(): void {
  facts.isPlanned = true
}

// What Foresight's spec levels look for in what the agent wrote this turn.
export function hasSpec(level: number, texts: string[]): boolean {
  const said = texts.join('\n')
  if (!/acceptance criteria/i.test(said)) return false
  if (level < 5) return true
  return ['problem', 'approach', 'alternatives'].every(heading => new RegExp(`(^|\\n)\\s*(#+\\s*|\\*\\*)?${heading}`, 'i').test(said))
}

// Foresight 4 and 5: the turn's first edit waits for a spec, once or twice.
// Levels 1 to 3 are left to the prompt: a plan of steps is too loose a thing
// to hold an edit back for.
export function foresightRefusal(level: number, texts: string[] | null): string | null {
  if (level < 4 || facts.isPlanned || facts.changes > 0) return null
  if (facts.foresightRefusals >= MAX_FORESIGHT_REFUSALS) return null
  // The turn's messages could not be read (compacted, say): let it through.
  if (texts === null || hasSpec(level, texts)) return null
  facts.foresightRefusals++
  return level === 5
    ? 'fishStack dials, Foresight is Deep spec: before the first edit, post the spec as a message with the headings Problem, Constraints, Approach, Alternatives considered, Edge cases, Risks, Files, Acceptance criteria. Then edit.'
    : 'fishStack dials, Foresight is Write a spec: before the first edit, post a short spec as a message: the problem, your approach, the files involved and a list headed Acceptance criteria. Then edit.'
}

// Crew 1 and 2: no subagent, or one.
export function crewRefusal(level: number): string | null {
  if (level === 1) return 'Crew is set to Solo in fishStack: do the work yourself without subagents.'
  if (level === 2 && facts.agents >= 1) return 'fishStack dials, Crew is Scouts: one scout per request, and it has been sent. Do the rest yourself.'
  return null
}

const VOICE_PARTS: Record<number, string[]> = {
  4: ['What changed', 'Why this way', 'What I verified', 'What I left out'],
  5: ['How it worked before', 'What I changed and why', 'Alternatives I considered', 'What I learned about this codebase', 'What to know next time'],
}

// What a turn that changed code still owes before it ends, in one message:
// null when nothing, or when the turn is already one Stop hook held back.
export function stopReason(values: DialValues, lastMessage: string, isHeldBack: boolean): string | null {
  if (isHeldBack || facts.codeChanges === 0) return null
  const owed: string[] = []
  if (values.proof >= 2 && facts.lastCheck < facts.lastChange) {
    owed.push(values.proof === 2 ? 'build or typecheck what you changed' : 'run the tests (or the build) for what you changed')
  }
  if (values.tenacity === 4 && !/checklist/i.test(lastMessage)) owed.push('end with your Checklist, each line with its status')
  if (values.tenacity === 5 && !/acceptance criteria/i.test(lastMessage)) owed.push('end with your Acceptance criteria, each with the evidence that verifies it')
  const parts = VOICE_PARTS[values.voice]
  if (parts !== undefined) {
    const missing = parts.filter(part => !lastMessage.toLowerCase().includes(part.toLowerCase()))
    if (missing.length > 0) owed.push(`include the labelled parts ${missing.join(', ')}`)
  }
  if (owed.length === 0) return null
  return `fishStack dials, before you finish: ${owed.join('; ')}. Then end your turn as usual. (This is asked once.)`
}

// What a dial's level enforces, for its card; null when it is prompt-only.
export function enforcedRule(key: DialKey, level: number): string | null {
  switch (key) {
    case 'foresight':
      return level >= 4 ? `The first edit of a request waits for ${level === 5 ? 'the deep spec' : 'a spec with Acceptance criteria'} (asked twice at most).` : null
    case 'crew':
      return level === 1 ? 'Subagents are refused.' : level === 2 ? 'One subagent per request; more are refused.' : null
    case 'tenacity':
      return level >= 4 ? `A request that changed code ends with its ${level === 5 ? 'Acceptance criteria' : 'Checklist'} (held back once if not).` : null
    case 'autonomy':
      return level === 5 ? 'A question nobody answers is answered with its recommended option after the wait.' : null
    case 'proof':
      return level >= 2 ? `A request that changed code runs ${level === 2 ? 'a build or typecheck' : 'its tests'} after the last change (held back once if not).` : null
    case 'voice':
      return level >= 4 ? 'A request that changed code ends with the labelled parts (held back once if not).' : null
  }
}

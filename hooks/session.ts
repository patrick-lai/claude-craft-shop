// What every session loads, and what the model is told: the read-only head
// start, the dials' working style and the context library's enabled sources.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, PromptComposeSection, Timer } from 'claude-code'

import type { AutopilotWait, DialValues, Folder, Source } from '../types'
import { CONTEXT_SECTION_ID, contextSection, legacyStoreKey, libraryStoreKey, parseLibrary } from './context'
import { BALANCED, brief, DIALS_SECTION_ID, DIALS_STORE_KEY, isDialValues } from './dials'
import { FISH_COMMANDS } from './pane'
import { headStartNote, IDLE_WORKTREE, isReadOnlyPhase } from './worktree'

const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const folders = atom({ plugin: 'fishstack', key: 'folders' } as const, [])
const sources = atom({ plugin: 'fishstack', key: 'sources' } as const, [])
const worktree = atom({ plugin: 'fishstack', key: 'worktree' } as const, IDLE_WORKTREE)
const isHeadStartPrompted = atom({ plugin: 'fishstack', key: 'isHeadStartPrompted' } as const, false)
const toldStyle = atom({ plugin: 'fishstack', key: 'toldStyle' } as const, null)
const autopilot = atom({ plugin: 'fishstack', key: 'autopilot' } as const, null)
const railTick = atom({ plugin: 'fishstack', key: 'railTick' } as const, 0)

function styleOf(values: DialValues, list: Source[], groups: Folder[]): string {
  return [brief(values), contextSection(list, groups) ?? 'The user shares no project context now.'].join('\n\n')
}

function styleUpdate(style: string): string {
  return `fishStack update: the user changed the working style dials or the shared project context during this session. What follows replaces the Working style and Project context sections of your system prompt.\n\n${style}`
}

// fishStack was Craftshop, whose saved dials, context libraries, slot leases
// and Perm worktree switch sit in its own store file. The first session after
// the rename copies them in, once, never over a value fishStack already has.
// The plugin's name before the rename, which its store files start with.
const FORMER_NAME = 'craft-shop'
const MIGRATED_KEY = 'migratedFromCraftShop'

async function migrateStore($: EngineInterface): Promise<string[]> {
  if ((await $.store.get(MIGRATED_KEY)) !== undefined) return []
  const home = await $.env.get('HOME')
  const dir = `${home ?? ''}/.claude/plugins/store`
  const files = (await $.fs.exists(dir)) ? (await $.fs.list(dir)).filter(one => one.kind === 'file' && one.name.startsWith(`${FORMER_NAME}_`) && one.name.endsWith('.json')) : []
  const copied: string[] = []
  for (const file of files) {
    let saved: unknown
    try {
      saved = JSON.parse(String(await $.fs.read(`${dir}/${file.name}`)))
    } catch {
      continue
    }
    if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) continue
    for (const [key, value] of Object.entries(saved)) {
      const now = await $.store.get(key)
      if (now !== undefined && now !== null) continue
      await $.store.set(key, value as never)
      copied.push(key)
    }
  }
  await $.store.set(MIGRATED_KEY, files.map(one => one.name))
  return copied
}

// Autopilot answers for a person who is away: a question the agent asked
// that nobody has answered for autoAnswerMinutes (15 by default) takes, for
// each choice question, the option labelled (Recommended), or else the first.
// Text and number questions are left for the agent to settle.
const AUTO_ANSWER_MINUTES = 15

type AskedQuestion = {
  question: string
  kind?: 'choice' | 'text' | 'number'
  options?: { label: string }[]
  defaultValue?: number
}

export function recommendedAnswers(questions: AskedQuestion[]): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const one of questions) {
    if (one.kind === 'number' && one.defaultValue !== undefined) answers[one.question] = String(one.defaultValue)
    if ((one.kind ?? 'choice') !== 'choice' || one.options === undefined || one.options.length === 0) continue
    const marked = one.options.find(option => /\(recommended\)/i.test(option.label))
    answers[one.question] = (marked ?? one.options[0]!).label
  }
  return answers
}

// The picks as the rail and the notice say them: each answer without its
// "(Recommended)", the questions' answers joined.
export function pickedText(answers: Record<string, string>): string {
  return Object.values(answers)
    .map(answer => answer.replace(/\s*\(recommended\)\s*/i, ' ').trim())
    .join(', ')
}

// Minutes left as a person reads them: "in 14 min", "in under a minute".
function minutesLeft(ms: number): string {
  return ms < 60_000 ? 'in under a minute' : `in ${Math.ceil(ms / 60_000)} min`
}

// What Autopilot answered last in this session, kept in the store so the rail
// still says so after a reload, until the person types again.
export const AUTOPILOT_STORE_KEY = 'autopilot'
type AutopilotKept = { sessionId: string; answered: AutopilotWait & { kind: 'answered' } }

// The questions Autopilot is waiting on in this process, by call: the rail
// shows the soonest, and how many.
type Waiting = { id: string; since: number; deadline: number; picked: string }
const waitingOn = new Map<string, Waiting>()
let waitTick: Timer | null = null
let calls = 0

async function showWaiting($: EngineInterface): Promise<void> {
  const soonest = [...waitingOn.values()].sort((a, b) => a.deadline - b.deadline)[0]
  if (soonest !== undefined) {
    await update($, autopilot, (): AutopilotWait => ({ kind: 'waiting', since: soonest.since, deadline: soonest.deadline, picked: soonest.picked, count: waitingOn.size }))
  } else {
    await update($, autopilot, now => (now?.kind === 'waiting' ? null : now))
  }
}

// While anything waits, the rail redraws every 15 seconds so its ring runs
// down, and each open dialog's line counts the minutes.
function tickWhileWaiting($: EngineInterface): void {
  if (waitingOn.size > 0 && waitTick === null) {
    waitTick = $.clock.every(15_000, () => {
      void (async () => {
        const now = await $.clock.now()
        for (const one of waitingOn.values()) notice($, one.id, `Autopilot picks ${one.picked} ${minutesLeft(one.deadline - now)} unless you answer`)
        await update($, railTick, n => n + 1)
      })()
    })
  }
  if (waitingOn.size === 0 && waitTick !== null) {
    waitTick.cancel()
    waitTick = null
  }
}

// A line under the question's dialog: the rail is not drawn while a dialog
// holds the composer (the terminal's), so the countdown is said there too.
function notice($: EngineInterface, id: string, text: string | undefined): void {
  if (id.startsWith('call-')) return
  try {
    $.ui.notice(id, text)
  } catch {
    // The dialog closed first.
  }
}

// Where a prompt the person typed comes from: the terminal's composer, the
// desktop app (through the SDK) or their phone (Remote Control).
const PERSON_ORIGINS = new Set(['composer', 'sdk', 'bridge'])

export function registerSession(on: On, options: PluginOptions): void {
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const input = e as unknown as { questions?: AskedQuestion[]; metadata?: { source?: string } }
    // Only the agent's own questions: a plugin asking through $.ui.ask
    // carries a source, and is not Autopilot's to answer.
    if ((await read($, dials)).autonomy < 5 || input.metadata?.source !== undefined || input.questions === undefined) return next(e)
    const ms = Math.max(0, Number(options.autoAnswerMinutes ?? AUTO_ANSWER_MINUTES)) * 60_000
    const id = e.tool_use_id ?? `call-${++calls}`
    const since = await $.clock.now()
    const picked = pickedText(recommendedAnswers(input.questions)) || 'the recommended options'
    const answered = next(e)
    let timer: Timer | null = null
    const away = new Promise<'away'>(resolve => {
      timer = $.clock.after(ms, () => resolve('away'))
    })
    waitingOn.set(id, { id, since, deadline: since + ms, picked })
    await showWaiting($)
    tickWhileWaiting($)
    // After the dialog has opened: a line for a call not yet open is refused.
    $.clock.after(0, () => notice($, id, `Autopilot picks ${picked} ${minutesLeft(ms)} unless you answer`))
    try {
      const first = await Promise.race([answered, away])
      if (first !== 'away') return first
      // The dial may have come down while the question waited: read where a
      // change is saved, as this hook's own reads hold what it began with.
      const now = await $.store.get(DIALS_STORE_KEY)
      if (isDialValues(now) && now.autonomy < 5) {
        waitingOn.delete(id)
        await showWaiting($)
        notice($, id, undefined)
        return await answered
      }
      const answers = recommendedAnswers(input.questions)
      const at = await $.clock.now()
      const done: AutopilotWait = { kind: 'answered', at, picked, waitedMs: ms }
      waitingOn.delete(id)
      await update($, autopilot, () => done)
      await showWaiting($)
      await $.store.set(AUTOPILOT_STORE_KEY, { sessionId: await $.session.id(), answered: done })
      void $.ui.notify(`Autopilot answered for you after ${Math.round(ms / 60_000)} min away: ${Object.values(answers).join('; ')}`, { title: 'fishStack' }).catch(() => undefined)
      return { result: { questions: input.questions, answers, afkTimeoutMs: ms } }
    } finally {
      ;(timer as Timer | null)?.cancel()
      if (waitingOn.delete(id)) await showWaiting($)
      tickWhileWaiting($)
    }
  })

  on('session.start', async ($, e, next) => {
    // The commands first, so /fishstack answers from the first keystroke, not
    // after the worktree claim and the store reads below.
    for (const command of FISH_COMMANDS) await $.command.register(command)
    // Before the rest of the chain, so every later hook reads what came over
    // from Craftshop's store.
    await migrateStore($)
    const started = await next(e)
    const storedDials = await $.store.get(DIALS_STORE_KEY)
    if (isDialValues(storedDials)) await update($, dials, () => storedDials)
    const kept = (await $.store.get(AUTOPILOT_STORE_KEY)) as AutopilotKept | null | undefined
    if (kept?.sessionId === (await $.session.id()) && (await read($, autopilot)) === null) await update($, autopilot, () => kept.answered)
    const repo = await $.session.repo()
    const root = repo?.root ?? (await $.session.root())
    const library = parseLibrary(await $.store.get(libraryStoreKey(root)), await $.store.get(legacyStoreKey(root)))
    await update($, sources, () => library.sources)
    await update($, folders, () => library.folders)
    return started
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const values = await read($, dials)
    const list = await read($, sources)
    const groups = await read($, folders)
    // The engine keeps a session's first system prompt for its requests, so
    // the style first composed for a request (not for /context's measure) is
    // the one the model holds until prompt.submit tells it otherwise.
    if (!e.traits.includes('analysis') && (await read($, toldStyle)) === null) {
      await update($, toldStyle, () => styleOf(values, list, groups))
    }

    const added: PromptComposeSection[] = [{ id: DIALS_SECTION_ID, text: brief(values), scope: 'session' }]
    const shared = contextSection(list, groups)
    if (shared !== null) added.push({ id: CONTEXT_SECTION_ID, text: shared, scope: 'session' })
    return { sections: [...composed.sections, ...added] }
  })

  on('prompt.submit', async ($, e, next) => {
    // The person is back: what Autopilot answered for them has been seen.
    // A notification or a peer's message is not them.
    if (PERSON_ORIGINS.has(e.origin.kind) && (await read($, autopilot))?.kind === 'answered') {
      await update($, autopilot, () => null)
      await $.store.set(AUTOPILOT_STORE_KEY, null)
    }
    const notes: string[] = []
    const { phase, main } = await read($, worktree)
    if (isReadOnlyPhase(phase) && main !== null) {
      notes.push(headStartNote(main))
      await update($, isHeadStartPrompted, () => true)
    }
    const told = await read($, toldStyle)
    const style = styleOf(await read($, dials), await read($, sources), await read($, folders))
    if (told !== null && told !== style) {
      notes.push(styleUpdate(style))
      await update($, toldStyle, () => style)
    }
    return notes.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...notes] })
  })

  // A change made mid-turn reaches the agent before its next request, not at
  // the next prompt: once a batch of tool calls resolves, the note rides with
  // it as added context, after everything cached, so the cache holds. The
  // main loop's batches only: a subagent told would mark it told for nobody.
  on('classic.PostToolBatch', async ($, e, next) => {
    const done = await next(e)
    if (e.agent_id !== undefined) return done
    const told = await read($, toldStyle)
    const style = styleOf(await read($, dials), await read($, sources), await read($, folders))
    if (told === null || told === style) return done
    await update($, toldStyle, () => style)
    return { ...done, additionalContext: [...(done.additionalContext ?? []), styleUpdate(style)] }
  })
}

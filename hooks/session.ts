// What every session loads, and what the model is told: the read-only head
// start, the dials' working style and the context library's enabled sources.
import { atom, read, update } from 'claude-code'
import type { On, PromptComposeSection } from 'claude-code'

import type { DialValues, Folder, Source } from '../types'
import { CONTEXT_SECTION_ID, contextSection, legacyStoreKey, libraryStoreKey, parseLibrary } from './context'
import { BALANCED, brief, DIALS_SECTION_ID, DIALS_STORE_KEY, isDialValues } from './dials'
import { CRAFT_COMMAND } from './pane'
import { headStartNote, IDLE_WORKTREE, isReadOnlyPhase } from './worktree'

const dials = atom({ plugin: 'craft-shop', key: 'dials' } as const, BALANCED)
const folders = atom({ plugin: 'craft-shop', key: 'folders' } as const, [])
const sources = atom({ plugin: 'craft-shop', key: 'sources' } as const, [])
const worktree = atom({ plugin: 'craft-shop', key: 'worktree' } as const, IDLE_WORKTREE)
const isHeadStartPrompted = atom({ plugin: 'craft-shop', key: 'isHeadStartPrompted' } as const, false)
const toldStyle = atom({ plugin: 'craft-shop', key: 'toldStyle' } as const, null)

function styleOf(values: DialValues, list: Source[], groups: Folder[]): string {
  return [brief(values), contextSection(list, groups) ?? 'The user shares no project context now.'].join('\n\n')
}

function styleUpdate(style: string): string {
  return `Craftshop update: the user changed the working style dials or the shared project context during this session. What follows replaces the Working style and Project context sections of your system prompt.\n\n${style}`
}

export function registerSession(on: On): void {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const storedDials = await $.store.get(DIALS_STORE_KEY)
    if (isDialValues(storedDials)) await update($, dials, () => storedDials)
    const repo = await $.session.repo()
    const root = repo?.root ?? (await $.session.root())
    const library = parseLibrary(await $.store.get(libraryStoreKey(root)), await $.store.get(legacyStoreKey(root)))
    await update($, sources, () => library.sources)
    await update($, folders, () => library.folders)
    await $.command.register(CRAFT_COMMAND)
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
}

// What several files share and none owns: the starting dials and worktree,
// the presets, and what each card's head says while closed. It imports no
// other hook file, so any of them can import it.
import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { DialKey, DialValues, Tab, Worktree } from '../types'

export const BALANCED: DialValues = { foresight: 3, crew: 3, tenacity: 3, autonomy: 3, proof: 3, voice: 3 }

export const PRESETS: { name: string; values: DialValues }[] = [
  { name: 'Balanced', values: BALANCED },
  { name: 'Quick', values: { foresight: 1, crew: 1, tenacity: 2, autonomy: 4, proof: 2, voice: 2 } },
  { name: 'Deep work', values: { foresight: 4, crew: 3, tenacity: 4, autonomy: 3, proof: 4, voice: 3 } },
  { name: 'Autopilot', values: { foresight: 4, crew: 3, tenacity: 5, autonomy: 5, proof: 4, voice: 2 } },
]

const DIAL_KEYS: DialKey[] = ['foresight', 'crew', 'tenacity', 'autonomy', 'proof', 'voice']

export function presetName(values: DialValues): string {
  const preset = PRESETS.find(one => DIAL_KEYS.every(key => one.values[key] === values[key]))
  return preset?.name ?? 'Custom'
}

export const IDLE_WORKTREE: Worktree = {
  phase: 'off',
  step: '',
  steps: [],
  main: null,
  path: null,
  branch: null,
  base: null,
  baseSha: null,
  error: null,
}

const worktree = atom({ plugin: 'fishstack', key: 'worktree' } as const, IDLE_WORKTREE)
const elsewhere = atom({ plugin: 'fishstack', key: 'elsewhere' } as const, null)
const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const isDialsOn = atom({ plugin: 'fishstack', key: 'isDialsOn' } as const, true)
const autopilot = atom({ plugin: 'fishstack', key: 'autopilot' } as const, null)
const sources = atom({ plugin: 'fishstack', key: 'sources' } as const, [])
const isContextOn = atom({ plugin: 'fishstack', key: 'isContextOn' } as const, true)

export type Head = { value: string; tone?: 'success' | 'warning' | 'error' }

// Each card's state in a word or two, coloured when it wants a look.
export async function paneHeads($: EngineInterface): Promise<Record<Tab, Head>> {
  const state = await read($, worktree)
  const isDials = await read($, isDialsOn)
  const values = await read($, dials)
  const auto = isDials && values.autonomy === 5 ? await read($, autopilot) : null
  const list = await read($, sources)
  const on = list.filter(one => one.mode !== 'off').length
  const minutes = auto?.kind === 'waiting' ? Math.max(1, Math.ceil((auto.deadline - (await $.clock.now())) / 60_000)) : 0
  return {
    worktree:
      state.phase === 'ready'
        ? { value: state.branch ?? 'Worktree', tone: 'success' }
        : state.phase === 'preparing'
          ? { value: 'Preparing…', tone: 'warning' }
          : state.phase === 'failed'
            ? { value: 'Failed', tone: 'error' }
            : { value: (await read($, elsewhere)) !== null ? 'Its own worktree' : 'Main checkout' },
    dials: !isDials
      ? { value: 'Off' }
      : auto?.kind === 'waiting'
        ? { value: `Answers in ${minutes} min`, tone: 'warning' }
        : { value: presetName(values) },
    context: !(await read($, isContextOn)) ? { value: 'Off' } : list.length === 0 ? { value: 'None yet' } : { value: `${on} of ${list.length} on` },
  }
}

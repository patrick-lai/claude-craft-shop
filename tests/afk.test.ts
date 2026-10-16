import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { railArt } from '../hooks/rail-art'
import type { RailArtFigures } from '../hooks/rail-art'
import { activate, mountBand, mountPane, openCard, startSession, world } from './world'

const AUTOPILOT = { foresight: 4, crew: 3, tenacity: 5, autonomy: 5, proof: 4, voice: 2 }
const DECIDE = { ...AUTOPILOT, autonomy: 4 }
const MINUTE = 60_000

const QUESTIONS = [
  { question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'SQLite', description: '' }, { label: 'Postgres (Recommended)', description: '' }] },
  { question: 'Which checks?', header: 'Checks', multiSelect: true, options: [{ label: 'Lint', description: '' }, { label: 'Types', description: '' }] },
  { question: 'Anything else?', header: 'Notes', multiSelect: false, kind: 'text', options: [] },
]

function ask($: Engine, extra: object = {}) {
  return $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS, ...extra } as never) as Promise<{ result?: unknown }>
}

test('on Autopilot, a question nobody answers for 15 minutes takes the recommended option (or the first); text is left open', async ($, on) => {
  const { clock, notified } = world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  await startSession($)
  const pending = ask($)
  await clock.advance(14 * MINUTE)
  let settled = false
  void pending.then(() => (settled = true))
  await clock.advance(0)
  expect(settled).toBe(false)
  await clock.advance(MINUTE)
  const { result } = await pending
  expect(result).toMatchObject({
    answers: { 'Which database?': 'Postgres (Recommended)', 'Which checks?': 'Lint' },
    afkTimeoutMs: 15 * MINUTE,
  })
  expect((result as { answers: Record<string, string> }).answers['Anything else?']).toBeUndefined()
  expect(notified.join('\n')).toContain('Autopilot answered for you after 15 min away')
})

test('a person who answers in time is answered as they chose', async ($, on) => {
  const state = world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  await startSession($)
  const pending = ask($)
  await state.clock.advance(5 * MINUTE)
  state.answer({ 'Which database?': 'SQLite' })
  const { result } = await pending
  expect(result).toMatchObject({ answers: { 'Which database?': 'SQLite' } })
  expect((result as { afkTimeoutMs?: number }).afkTimeoutMs).toBeUndefined()
  await state.clock.advance(20 * MINUTE)
  expect(state.notified).toEqual([])
})

test('below Autopilot nothing is picked: the question waits for the person', async ($, on) => {
  const state = world(on, { isRepo: false, store: { dials: DECIDE } })
  await startSession($)
  const pending = ask($)
  await state.clock.advance(60 * MINUTE)
  state.answer({ 'Which database?': 'SQLite' })
  expect((await pending).result).toMatchObject({ answers: { 'Which database?': 'SQLite' } })
  expect(state.notified).toEqual([])
})

test("a plugin's own question (it carries a source) is never Autopilot's to answer", async ($, on) => {
  const state = world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  await startSession($)
  const pending = ask($, { metadata: { source: 'another-plugin' } })
  await state.clock.advance(30 * MINUTE)
  state.answer({ 'Which database?': 'SQLite' })
  expect((await pending).result).toMatchObject({ answers: { 'Which database?': 'SQLite' } })
})

test('a dial lowered while the question waits stops Autopilot answering it', async ($, on) => {
  const state = world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  await startSession($)
  const pending = ask($)
  await state.clock.advance(5 * MINUTE)
  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'dials')
  await activate(ui, 'preset-Balanced')
  await state.clock.advance(20 * MINUTE)
  state.answer({ 'Which database?': 'SQLite' })
  expect((await pending).result).toMatchObject({ answers: { 'Which database?': 'SQLite' } })
  expect(state.notified).toEqual([])
})

// The rail as each surface shows it: the desktop's dials pill (its tone, its
// caption, its ring) and the terminal's dials item, the Dials card's head.
async function rail($: Engine) {
  const desktop = JSON.stringify(await (await mountBand($, 'desktop')).drawn())
  const terminal = (await (await mountBand($, 'terminal')).find({ key: 'rail-dials' }))?.text ?? ''
  return { desktop, terminal }
}

test('on Autopilot the rail counts down a waiting question, then says what it picked until the person types', async ($, on) => {
  const state = world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  await startSession($)
  expect((await rail($)).desktop).not.toContain('pill wait')
  const pending = ask($, { tool_use_id: 'toolu_1' })
  await state.clock.advance(0)

  let now = await rail($)
  expect(now.desktop).toContain('class=\\"pill wait\\"')
  expect(now.desktop).toContain('Autopilot picks Postgres, Lint in 15 min unless you answer')
  expect(now.terminal).toBe('◇ Answers in 15 min')
  // The terminal hides the rail under the dialog: the dialog's line says it.
  expect(state.notices).toContain('Autopilot picks Postgres, Lint in 15 min unless you answer')
  const fullRing = /stroke-dasharray=\\"([\d.]+) /.exec(now.desktop)![1]

  await state.clock.advance(10 * MINUTE)
  now = await rail($)
  expect(now.desktop).toContain('Autopilot picks Postgres, Lint in 5 min unless you answer')
  expect(Number(/stroke-dasharray=\\"([\d.]+) /.exec(now.desktop)![1])).toBeLessThan(Number(fullRing) / 2)
  expect(now.terminal).toBe('◇ Answers in 5 min')
  expect(state.notices).toContain('Autopilot picks Postgres, Lint in 5 min unless you answer')

  await state.clock.advance(5 * MINUTE)
  await pending
  now = await rail($)
  expect(now.desktop).toContain('class=\\"pill done\\"')
  expect(now.desktop).toContain('Autopilot answered Postgres, Lint at ')
  expect(now.desktop).toContain('nobody had for 15 min')
  // The terminal's item is the card's head: the countdown over, the preset.
  expect(now.terminal).toBe('◇ Autopilot')
  expect(state.saved.autopilot).toMatchObject({ answered: { kind: 'answered', picked: 'Postgres, Lint' } })

  // A notification arriving is not the person: the check stays.
  await $.prompt.submit({ text: 'task done', wait: false, origin: { kind: 'task-notification' } as never })
  expect((await rail($)).desktop).toContain('pill done')
  await $.prompt.submit({ text: 'thanks', wait: false, origin: { kind: 'composer' } })
  now = await rail($)
  expect(now.desktop).not.toContain('pill done')
  expect(now.terminal).toBe('◇ Autopilot')
  expect(state.saved.autopilot).toBeNull()
})

test('the cue goes when the person answers, and never shows below Autopilot', async ($, on) => {
  const state = world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  await startSession($)
  const pending = ask($, { tool_use_id: 'toolu_2' })
  await state.clock.advance(2 * MINUTE)
  expect((await rail($)).desktop).toContain('pill wait')
  state.answer({ 'Which database?': 'SQLite' })
  await pending
  const after = await rail($)
  expect(after.desktop).not.toContain('pill wait')
  expect(after.desktop).not.toContain('pill done')

  // Lowered while a question waits: the rail drops the cue at once.
  const again = ask($, { tool_use_id: 'toolu_3' })
  await state.clock.advance(MINUTE)
  expect((await rail($)).desktop).toContain('pill wait')
  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'dials')
  await activate(ui, 'preset-Balanced')
  const lowered = await rail($)
  expect(lowered.desktop).not.toContain('pill wait')
  expect(lowered.terminal).toBe('◇ Balanced')
  state.answer({ 'Which database?': 'SQLite' })
  await again
})

test('two questions waiting: the rail counts down the sooner and says how many', async ($, on) => {
  const state = world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  await startSession($)
  const first = ask($, { tool_use_id: 'toolu_4' })
  await state.clock.advance(5 * MINUTE)
  void ask($, { tool_use_id: 'toolu_5' })
  await state.clock.advance(0)
  expect((await rail($)).desktop).toContain('Autopilot picks Postgres, Lint in 10 min unless you answer · 2 questions waiting')
  await state.clock.advance(10 * MINUTE)
  await first
  // The first answered, the second still waits: still counting.
  expect((await rail($)).desktop).toContain('Autopilot picks Postgres, Lint in 5 min unless you answer')
})

test('the dials pill keeps its width whatever Autopilot is doing, compacted too', () => {
  const base: RailArtFigures = { cacheSecondsLeft: null, isWorking: false, cachePercent: null, tokens: null, costUsd: null, preset: 'Autopilot', presetLevels: [4, 3, 5, 5, 4, 2], sourcesOn: 0, sourcesTotal: 0, branch: null, preparingStep: null, autopilot: null, isDialsOn: true, isContextOn: true }
  const widths = (compact: boolean) =>
    [
      null,
      { kind: 'waiting', secondsLeft: 840, totalSeconds: 900, picked: 'Red', count: 1 },
      { kind: 'waiting', secondsLeft: 12, totalSeconds: 900, picked: 'A much longer pick than usual', count: 3 },
      { kind: 'answered', at: '4:12 am', picked: 'Red', waitedMinutes: 15 },
    ].map(autopilot => {
      const pills = railArt({ ...base, autopilot } as RailArtFigures, new Set(compact ? ['dials'] : []))
      return pills.find(pill => pill.id === 'dials')!
    })
  for (const compact of [false, true]) {
    const pills = widths(compact)
    expect(new Set(pills.map(pill => pill.width)).size).toBe(1)
    // Compacted to its icon, the pill still shows the ring and the check.
    expect(pills[1]!.source).toContain('stroke="#f0a35e"')
    expect(pills[3]!.source).toContain('stroke="#3fb950"')
  }
})

test('below Autopilot a question shows nothing on the rail and no line under it', async ($, on) => {
  const state = world(on, { isRepo: false, store: { dials: DECIDE } })
  await startSession($)
  const pending = ask($, { tool_use_id: 'toolu_6' })
  await state.clock.advance(MINUTE)
  const now = await rail($)
  expect(now.desktop).not.toContain('pill wait')
  expect(now.terminal).not.toContain('Answers in')
  expect(state.notices).toEqual([])
  state.answer({ 'Which database?': 'SQLite' })
  await pending
})

// Autopilot answers the agent's questions. fishStack's own "Where should
// this session work?" is the person's, however long they are away.
test("on Autopilot, fishStack's own question at the start is left for the person", { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, notices, toolCalls } = world(on, { store: { dials: AUTOPILOT }, where: 'held' })
  await startSession($)
  await clock.advance(16 * MINUTE)
  expect(notices.join('\n')).not.toContain('Autopilot picks')
  expect(toolCalls).not.toContain('EnterWorktree')
})

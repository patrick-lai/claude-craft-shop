import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { activate, mountPane, startSession, world } from './world'

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
  await activate(ui, 'tab-dials')
  await activate(ui, 'preset-Balanced')
  await state.clock.advance(20 * MINUTE)
  state.answer({ 'Which database?': 'SQLite' })
  expect((await pending).result).toMatchObject({ answers: { 'Which database?': 'SQLite' } })
  expect(state.notified).toEqual([])
})

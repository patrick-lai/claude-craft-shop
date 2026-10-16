// Use dials and Use context: each tab's switch turns what it gives the agent
// off, says so to an agent already told, and shows on the rail.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { activate, COMPOSE, mountBand, mountPane, openCard, startSession, world } from './world'

const SOLO = { foresight: 1, crew: 1, tenacity: 2, autonomy: 4, proof: 2, voice: 2 }

async function sections($: Engine) {
  return (await $.prompt.compose(COMPOSE)).sections.map(section => section.id)
}

async function told($: Engine) {
  return ((await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })).context ?? []).join('\n')
}

test('Use dials off: no working style, Solo no longer refuses subagents, the agent is told, the rail says Off', async ($, on) => {
  world(on, { isRepo: false, store: { dials: SOLO } })
  await startSession($)
  expect(await sections($)).toContain('fishstack:dials')
  expect((await $.tool.call({ tool: 'Agent', prompt: 'look around' } as never)).deny).toContain('Solo')

  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'dials')
  await activate(ui, 'dials-on-off')
  expect(await ui.find({ text: 'The agent gets no working style.' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'brief-toggle' })).toBeUndefined()
  expect(await sections($)).not.toContain('fishstack:dials')
  expect(await told($)).toContain('The user turned the working style dials off')
  expect((await $.tool.call({ tool: 'Agent', prompt: 'look around' } as never)).deny).toBeUndefined()

  const terminal = await mountBand($, 'terminal')
  expect((await terminal.find({ key: 'rail-dials' }))?.text).toBe('◇ Off')
  const desktop = JSON.stringify(await (await mountBand($, 'desktop')).drawn())
  expect(desktop).toContain('>Off<')
  expect(desktop).toContain('Dials are off: the agent gets no working style')

  // Back on: the dials as they were.
  await activate(ui, 'dials-on-on')
  expect(await sections($)).toContain('fishstack:dials')
  expect(await told($)).toContain('Crew (Solo)')
})

test('Use context off: no source reaches the agent, the agent is told, the rail says Off; the library is kept', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'context')
  await ui.input({ key: 'add-input', text: 'Money is integer cents.' })
  expect(await sections($)).toContain('fishstack:context')
  await told($)

  await activate(ui, 'context-on-off')
  expect(await ui.find({ text: 'No source reaches the agent.' })).toBeDefined()
  expect(await sections($)).not.toContain('fishstack:context')
  expect(await told($)).toContain('The user turned the shared project context off')
  expect((await (await mountBand($, 'terminal')).find({ key: 'rail-sources' }))?.text).toBe('▤ Off')
  // The card hides the library while off; the note is still in it, and
  // back on it is listed and reaches the agent.
  expect(await ui.find({ text: /Money is integer cents/ })).toBeUndefined()
  await activate(ui, 'context-on-on')
  expect(await ui.find({ text: /Money is integer cents/ })).toBeDefined()
  expect(await told($)).toContain('Money is integer cents.')
})

test('the switches are kept across sessions', async ($, on) => {
  world(on, { isRepo: false, store: { useDials: false, useContext: false } })
  await startSession($)
  expect(await sections($)).not.toContain('fishstack:dials')
  expect(await sections($)).not.toContain('fishstack:context')
  const rail = await mountBand($, 'terminal')
  expect((await rail.find({ key: 'rail-dials' }))?.text).toBe('◇ Off')
  expect((await rail.find({ key: 'rail-sources' }))?.text).toBe('▤ Off')
})

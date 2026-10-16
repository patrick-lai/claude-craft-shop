import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { activate, COMPOSE, mountPane, openCard, startSession, world } from './world'

async function dialsSection($: Engine) {
  const composed = await $.prompt.compose(COMPOSE)
  return composed.sections.find(section => section.id === 'fishstack:dials')?.text ?? ''
}

test('dragging a dot on the desktop radar sets that dial, and the agent is told', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await openCard(ui, 'dials')
  // The radar is 360 by 300 pixels; laid out at 45 by 15 cells, a cell is 8 by 20.
  await ui.resize({ columns: 45, rows: 15, in: 'radar-drag' })

  // Tenacity's spoke points down and right; press near the centre, then drag out.
  await ui.pointer({ type: 'down', x: 24, y: 8, button: 'left', in: 'radar-drag' })
  expect(await dialsSection($)).toContain('Tenacity (One pass)')
  await ui.pointer({ type: 'move', x: 33, y: 10, button: 'left', in: 'radar-drag' })
  await ui.pointer({ type: 'up', x: 33, y: 10, button: 'left', in: 'radar-drag' })
  expect(await dialsSection($)).toContain('Tenacity (Goal mode)')
  // The dial dragged is the one selected: its row opens on what it does now.
  expect(await ui.find({ text: /How hard it pushes to finish: Sets acceptance criteria/ })).toBeDefined()

  // Arrow keys move the focus to Autonomy and lower it.
  await ui.key({ key: 'right', in: 'radar-drag' })
  await ui.key({ key: 'down', in: 'radar-drag' })
  expect(await dialsSection($)).toContain('Autonomy (Check in)')
})

test('the working style the model is told follows the dials', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  expect(await dialsSection($)).toContain('Foresight (Plan steps)')

  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'dials')
  await ui.press({ key: 'pip-foresight-5' })
  await ui.press({ key: 'pip-voice-1' })
  const section = await dialsSection($)
  expect(section).toContain('Foresight (Deep spec)')
  expect(section).toContain('Voice (Silent)')
  expect(await ui.find({ text: /Custom/ })).toBeDefined()

  await activate(ui, 'preset-Quick')
  expect(await dialsSection($)).toContain('Crew (Solo)')
})

test('Crew set to Solo refuses subagents', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const agent = { tool: 'Agent', description: 'scout', prompt: 'find the code' } as const
  expect((await $.tool.call(agent)).deny).toBeUndefined()

  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'dials')
  await ui.press({ key: 'pip-crew-1' })
  expect((await $.tool.call(agent)).deny).toContain('Solo')
})

test('a dial changed mid-session reaches the model with the next prompt, once', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  await $.prompt.compose(COMPOSE)
  const submit = async () =>
    (await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })).context?.join('\n') ?? ''
  expect(await submit()).toBe('')

  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'dials')
  await ui.press({ key: 'pip-voice-5' })
  const told = await submit()
  expect(told).toContain('fishStack update')
  expect(told).toContain('Voice (Teach)')
  expect(await submit()).toBe('')
})

test('a dial changed mid-turn reaches the agent before its next request, not only at the next prompt', async ($, on) => {
  world(on, { isRepo: false })
  on('classic.PostToolBatch', () => ({}))
  await startSession($)
  await $.prompt.compose(COMPOSE)
  const batch = async (agentId?: string) =>
    ((await $.classic.PostToolBatch({ tool_calls: [], ...(agentId === undefined ? {} : { agent_id: agentId }) } as never)).additionalContext ?? []).join('\n')
  expect(await batch()).toBe('')

  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'dials')
  await ui.press({ key: 'pip-voice-5' })
  // A subagent's batch does not take it: the main agent has not been told.
  expect(await batch('sub-1')).toBe('')
  const told = await batch()
  expect(told).toContain('fishStack update')
  expect(told).toContain('Voice (Teach)')
  // Told once: neither the next batch nor the next prompt says it again.
  expect(await batch()).toBe('')
  expect((await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })).context?.join('\n') ?? '').toBe('')
})

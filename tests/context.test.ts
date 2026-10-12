import { expect, test } from 'claude-code/testing'

import { COMPOSE, mountPane, startSession, world } from './world'

test('a note reaches the system prompt as strict, and leaves it when off', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'tab-context' })
    await ui.input({ key: 'note-title', text: `Ports ${surface}` })
    await ui.input({ key: 'note-text', text: 'The API listens on port 4321.' })
    expect(await ui.find({ text: new RegExp(`Ports ${surface}`) })).toBeDefined()
    await ui.unmount()
  }

  const contextSection = async () =>
    (await $.prompt.compose(COMPOSE)).sections.find(section => section.id === 'craft-shop:context')?.text

  expect(await contextSection()).toContain('port 4321')
  const ui = await mountPane($, 'terminal')
  const [first, second] = await ui.findAll({ type: 'Select' })
  await ui.select({ key: first!.key!, value: 'strict' })
  expect(await contextSection()).toMatch(/STRICT: binding ground truth/)

  await ui.select({ key: first!.key!, value: 'off' })
  await ui.select({ key: second!.key!, value: 'off' })
  expect(await contextSection()).toBeUndefined()
})

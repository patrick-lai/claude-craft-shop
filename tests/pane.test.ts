import { expect, test } from 'claude-code/testing'

import { mountPane, startSession, world } from './world'

test('the tabs switch on press and each draws its empty state', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'tab-worktree' })
    expect(await ui.find({ text: /No worktree for this session/ }), surface).toBeDefined()

    await ui.press({ key: 'tab-dials' })
    expect(await ui.find({ type: 'Button', key: 'preset-Balanced' }), surface).toBeDefined()
    expect(await ui.find({ text: /Plan steps/ }), surface).toBeDefined()

    await ui.press({ key: 'tab-context' })
    expect(await ui.find({ text: /No sources yet/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'add-input' }), surface).toBeDefined()

    await ui.unmount()
  }
})

test('/craft opens the pane on the tab it names', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const opened = await $.command.run({
    command: 'craft',
    args: 'dials',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
  expect(opened.text).toBe('Opened Craft Shop · Dials.')
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Button', key: 'pip-crew-1' })).toBeDefined()
})

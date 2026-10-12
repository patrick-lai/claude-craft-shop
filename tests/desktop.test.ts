// Every tab drawn on the desktop with real content: each tree must validate
// against the desktop's table (drawn() rejects otherwise). Each drawing is
// also printed between PREVIEW markers, which e2e/preview.mjs turns into an
// HTML page for a look at the layout.
import { expect, test } from 'claude-code/testing'

import { mountPane, startSession, world } from './world'

declare const console: { log: (...args: unknown[]) => void }

type Drawing = Awaited<ReturnType<typeof mountPane>>

async function show(ui: Pick<Drawing, "drawn">, name: string) {
  const tree = await ui.drawn()
  expect(tree).toBeDefined()
  console.log(`PREVIEW ${name} ${JSON.stringify(tree)}`)
}

async function buttons(ui: Drawing, key: RegExp) {
  return (await ui.findAll({ type: 'Button' })).filter(one => one.key !== undefined && key.test(one.key))
}

test('every tab draws on the desktop with content in it', async ($, on) => {
  world(on, { isRepo: false })
  on('fs.list', () => ({
    value: [
      { name: 'refunds.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
      { name: 'currency.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('refunds.md') ? 'Refunds settle in 5 business days. Partial refunds keep the original currency.' : 'Amounts are integer cents. Never use floats for money.' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  const ui = await mountPane($, 'desktop')

  await ui.press({ key: 'tab-context' })
  await show(ui, 'context-empty')

  await ui.press({ key: 'pick-folder' })
  const [strict] = await buttons(ui, /^strict-/)
  await ui.press({ key: strict!.key! })
  await ui.input({ key: 'add-input', text: 'Every endpoint returns JSON with snake_case keys. Paginate with cursor, never offset.' })
  await ui.input({ key: 'add-input', text: 'https://example.com/style' })
  const [off] = (await buttons(ui, /^toggle-/)).slice(-1)
  await ui.press({ key: off!.key! })
  await show(ui, 'context-library')

  const [open] = await buttons(ui, /^open-/)
  await ui.press({ key: open!.key! })
  await show(ui, 'context-source')

  await ui.press({ key: 'tab-dials' })
  await ui.press({ key: 'preset-Autopilot' })
  await ui.press({ key: 'dial-tenacity' })
  await show(ui, 'dials')

  await ui.press({ key: 'tab-worktree' })
  await show(ui, 'worktree-off')

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false })
  const band = await $.ui.mount({
    plugin: 'craft-shop',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  await show(band, 'rail')
})

test('the worktree tab draws its steps and slots on the desktop', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock } = world(on)
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'tab-worktree' })
  await show(ui, 'worktree-preparing')
  await clock.advance(1)
  await show(ui, 'worktree-ready')
})

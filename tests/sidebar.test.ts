// The pane as the desktop docks it: a sidebar about 44 cells (352px) wide.
// Each drawing must validate against the desktop's table, and is printed
// between PREVIEW markers for e2e/preview.mjs, named side-*.
import { expect, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { openCard, startSession, world } from './world'

declare const console: { log: (...args: unknown[]) => void }

const SIDE: RenderPropsOf['Pane'] = { title: 'fishStack', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }

async function sidebar($: Engine) {
  return $.ui.mount({ plugin: 'fishstack', surface: 'desktop', component: 'Pane', requestId: 'fishstack', props: SIDE })
}

async function show(ui: Awaited<ReturnType<typeof sidebar>>, name: string) {
  const tree = await ui.drawn()
  expect(tree).toBeDefined()
  console.log(`PREVIEW ${name} ${JSON.stringify(tree)}`)
}

test('the sidebar draws each card on the desktop', async ($, on) => {
  world(on)
  on('fs.list', () => ({
    value: [
      { name: 'refunds.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
      { name: 'currency.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('refunds.md') ? 'Refunds settle in 5 business days.' : 'Amounts are integer cents.' }))
  await startSession($)
  const ui = await sidebar($)
  await show(ui, 'side-start')
  await openCard(ui, 'worktree')
  await show(ui, 'side-worktree-off')
  await openCard(ui, 'dials')
  await show(ui, 'side-dials')
  await openCard(ui, 'context')
  await ui.press({ key: 'pick-folder' })
  await ui.input({ key: 'add-input', text: 'Every endpoint returns JSON with snake_case keys.' })
  await show(ui, 'side-context')
})

test('the sidebar draws a ready worktree on the desktop', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock } = world(on)
  await startSession($)
  await clock.advance(1)
  const ui = await sidebar($)
  await openCard(ui, 'worktree')
  await ui.redraw()
  await show(ui, 'side-worktree-ready')
})

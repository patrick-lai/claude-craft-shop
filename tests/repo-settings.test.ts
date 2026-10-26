// Settings are kept per repository: the dials, Use dials, Enforce, Use
// context and Use worktrees that one repository sets reach no other.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { activate, claimWorktree, COMPOSE, mountPane, openCard, REPO, startSession, world } from './world'

const SOLO = { foresight: 1, crew: 1, tenacity: 2, autonomy: 4, proof: 2, voice: 2 }
const ELSEWHERE = '/elsewhere'

async function dialsSection($: Engine) {
  return (await $.prompt.compose(COMPOSE)).sections.find(section => section.id === 'fishstack:dials')?.text ?? null
}

async function isAutoShown($: Engine) {
  const pane = await mountPane($, 'desktop')
  await openCard(pane, 'worktree')
  return JSON.stringify(await pane.drawn()).includes('"alt":"Use worktrees: on"')
}

test("another repository's settings do not reach this one", async ($, on) => {
  const { clock } = world(on, {
    store: {
      [`dials:${ELSEWHERE}`]: SOLO,
      [`useContext:${ELSEWHERE}`]: false,
      [`autoWorktree:${ELSEWHERE}`]: true,
    },
  })
  await startSession($)
  await clock.advance(1)
  expect(await dialsSection($)).toContain('Crew (Helpers)')
  expect(await isAutoShown($)).toBe(false)
})

test('a change is kept for this repository alone', { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, saved } = world(on)
  await startSession($)
  await claimWorktree($)
  const ui = await mountPane($, 'terminal')
  await openCard(ui, 'dials')
  await ui.press({ key: 'pip-crew-1' })
  await activate(ui, 'dials-enforce-off')
  await activate(ui, 'dials-on-off')
  await openCard(ui, 'context')
  await activate(ui, 'context-on-off')
  await openCard(ui, 'worktree')
  await activate(ui, 'auto-worktree-on')
  await clock.advance(1)

  expect(saved[`dials:${REPO}`]).toMatchObject({ crew: 1 })
  expect(saved[`enforceDials:${REPO}`]).toBe(false)
  expect(saved[`useDials:${REPO}`]).toBe(false)
  expect(saved[`useContext:${REPO}`]).toBe(false)
  expect(saved[`autoWorktree:${REPO}`]).toBe(true)
  for (const key of ['dials', 'enforceDials', 'useDials', 'useContext', 'autoWorktree']) expect(saved[key]).toBeUndefined()
})

test('what was kept for every repository before still applies until this repository sets its own', async ($, on) => {
  world(on, { store: { dials: SOLO, useDials: false, autoWorktree: true, [`useDials:${REPO}`]: true } })
  await startSession($)
  // Its own Use dials wins; the old dials and Use worktrees carry over.
  expect(await dialsSection($)).toContain('Crew (Solo)')
  expect(await isAutoShown($)).toBe(true)
})

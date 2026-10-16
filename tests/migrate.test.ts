import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COMPOSE, mountPane, openCard, REPO, startSession, world } from './world'

const STORE = '/home/me/.claude/plugins/store'
// Dive in and Solo: told apart from the Balanced default at a glance.
const SAVED = { foresight: 1, crew: 1, tenacity: 5, autonomy: 2, proof: 4, voice: 3 }

async function told($: Engine) {
  return (await $.prompt.compose(COMPOSE)).sections.find(section => section.id === 'fishstack:dials')?.text ?? ''
}

async function isAutoShown($: Engine) {
  const pane = await mountPane($, 'desktop')
  await openCard(pane, 'worktree')
  return JSON.stringify(await pane.drawn()).includes('"alt":"Use worktrees: on"')
}

test("the first session after the rename brings Craftshop's saved dials and Perm worktree switch over", async ($, on) => {
  world(on, {
    isRepo: false,
    files: {
      [`${STORE}/craft-shop_inline-0bc5373396bb.json`]: JSON.stringify({ dials: SAVED, [`context:${REPO}`]: { sources: [], folders: [] }, autoWorktree: true }),
      // Another plugin's store is left alone.
      [`${STORE}/someone-else_inline-1.json`]: JSON.stringify({ dials: { ...SAVED, foresight: 5 } }),
    },
  })
  await startSession($)
  expect(await told($)).toContain('Foresight (Dive in)')
  expect(await told($)).toContain('Crew (Solo)')
  expect(await isAutoShown($)).toBe(true)
})

test('a value fishStack already has is never overwritten, and a broken old file is skipped', async ($, on) => {
  world(on, {
    isRepo: false,
    store: { autoWorktree: false },
    files: {
      [`${STORE}/craft-shop_inline-a.json`]: JSON.stringify({ dials: SAVED, autoWorktree: true }),
      [`${STORE}/craft-shop_inline-b.json`]: '{ not json',
    },
  })
  await startSession($)
  expect(await told($)).toContain('Foresight (Dive in)')
  expect(await isAutoShown($)).toBe(false)
})

test('once migrated, a later session reads only what fishStack holds', async ($, on) => {
  world(on, {
    isRepo: false,
    store: { migratedFromCraftShop: ['craft-shop_inline-a.json'] },
    files: { [`${STORE}/craft-shop_inline-a.json`]: JSON.stringify({ dials: SAVED }) },
  })
  await startSession($)
  expect(await told($)).not.toContain('Foresight (Dive in)')
})

test('with no Craftshop store on disk the session starts as usual', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  expect(await told($)).not.toContain('Foresight (Dive in)')
})

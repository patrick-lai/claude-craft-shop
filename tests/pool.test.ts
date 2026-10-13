import { expect, test } from 'claude-code/testing'

import { activate, COMPOSE, mountPane, REPO, startSession, world } from './world'

// Where the slots of /repo live under a worktreeRoot of /slots.
async function repoDir(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(REPO))
  return `/slots/repo-${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 6)}`
}

const created = (commands: string[]) => commands.filter(one => one.includes(' worktree add -q --detach --no-checkout '))

test('turning Perm worktree on warms a pool of three slots, made as CommissionAI makes them', { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, commands } = world(on)
  await startSession($)
  expect(created(commands)).toEqual([])

  const ui = await mountPane($, 'desktop')
  await activate(ui, 'tab-worktree')
  await activate(ui, 'auto-worktree')
  await clock.advance(1)
  const dir = await repoDir()
  // Three slots, each detached and unchecked-out at origin's head, then
  // checked out with minimal stat checks, then its index warmed; hooks off.
  expect(created(commands)).toEqual([1, 2, 3].map(n => `${REPO}$ git -c core.hooksPath=/dev/null worktree add -q --detach --no-checkout ${dir}/${n} 0123456789abcdef`))
  expect(commands).toContain(`${dir}/2$ git -c core.hooksPath=/dev/null -c core.checkStat=minimal reset --hard -q`)
  expect(commands).toContain(`${dir}/3$ git status --porcelain=v1 -z --untracked-files=all`)
  await ui.redraw()
  expect(await ui.find({ text: /Pool: 3 slots, 3 ready/ })).toBeDefined()

  // Warm already: turning it off and on again makes nothing more.
  await activate(ui, 'auto-worktree')
  await activate(ui, 'auto-worktree')
  await clock.advance(1)
  expect(created(commands)).toHaveLength(3)
})

test('a new slot whose checkout is cut short is removed, not left to be reused, and the tab says why', { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, commands } = world(on, { isCheckoutCut: true })
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await activate(ui, 'tab-worktree')
  await activate(ui, 'auto-worktree')
  await clock.advance(1)
  const dir = await repoDir()
  expect(commands).toContain(`${REPO}$ git worktree remove --force --force ${dir}/1`)
  await ui.redraw()
  expect(await ui.find({ text: /Warming stopped: Could not check out the new worktree\. error: the checkout was cut short/ })).toBeDefined()
})

test('a session claims a slot and the pool tops itself up behind it, one spare kept', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, commands, toolCalls } = world(on)
  await startSession($)
  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
  const dir = await repoDir()
  expect(commands).toContain(`${dir}/1$ git -c core.hooksPath=/dev/null checkout -q -B fish/abcdef origin/main`)
  // Slot 1 is this session's; 2 and 3 wait for the next ones.
  expect(created(commands).map(one => one.split(' ').at(-2))).toEqual([`${dir}/1`, `${dir}/2`, `${dir}/3`])
})

test('a blobless clone can check a slot out: writes may fetch the blobs they lack and get minutes; reads neither', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, inits } = world(on)
  await startSession($)
  await clock.advance(1)
  const dir = await repoDir()
  for (const write of [
    `${dir}/1$ git -c core.hooksPath=/dev/null -c core.checkStat=minimal reset --hard -q`,
    `${dir}/1$ git -c core.hooksPath=/dev/null checkout -q -B fish/abcdef origin/main`,
  ]) {
    expect(inits[write]?.timeoutMs).toBe(10 * 60_000)
    expect(inits[write]?.env).toEqual({ GIT_NO_LAZY_FETCH: '0' })
  }
  expect(inits[`${REPO}$ git worktree list --porcelain`]?.timeoutMs).toBe(120_000)
  expect(inits[`${REPO}$ git worktree list --porcelain`]?.env).toBeUndefined()
})

test('a claim and the pool starting together share one fetch, both from origin', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, commands, finishFetches, toolCalls } = world(on, { fetch: 'held' })
  await startSession($)
  await clock.advance(1)
  await clock.advance(1)
  // Both wait on the one fetch, which neither would win against the other.
  expect(commands.filter(one => one === `${REPO}$ git fetch -q origin main`)).toHaveLength(1)
  for (let tries = 0; tries < 5; tries++) {
    finishFetches()
    await clock.advance(1)
  }
  expect(toolCalls).toContain('EnterWorktree')
  // The claim's slot (whichever the pool was not making) starts from origin.
  expect(commands.some(one => one.endsWith('$ git -c core.hooksPath=/dev/null checkout -q -B fish/abcdef origin/main'))).toBe(true)
})

test('a fetch still running at its timeout starts the slot from the local branch', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, commands, toolCalls } = world(on, { fetch: 'stuck' })
  await startSession($)
  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
  const dir = await repoDir()
  expect(commands).toContain(`${dir}/1$ git -c core.hooksPath=/dev/null checkout -q -B fish/abcdef main`)
})

test("with no worktreeRoot set, slots live under the repository's .claude/worktrees/, kept out of its git status once", { options: { autoWorktree: true, setupCommand: '' } }, async ($, on) => {
  const { clock, commands, toolCalls } = world(on)
  await startSession($)
  await clock.advance(1)
  const dir = `${REPO}/.claude/worktrees/fishstack`
  expect(toolCalls).toContain('EnterWorktree')
  expect(created(commands).map(one => one.split(' ').at(-2))).toEqual([`${dir}/1`, `${dir}/2`, `${dir}/3`])
  expect(commands.filter(one => one.includes('info/exclude') && one.includes('/bin/bash'))).toEqual([
    `${REPO}$ /bin/bash -c mkdir -p "$(dirname "$1")" && printf '%s\\n' "$2" >> "$1" bash ${REPO}/.git/info/exclude /.claude/worktrees/fishstack/`,
  ])
})

test('a session that starts in a slot under .claude/worktrees/ is that slot\'s, not adopted as a Claude Code worktree', { options: { setupCommand: '' } }, async ($, on) => {
  const dir = `${REPO}/.claude/worktrees/fishstack`
  const { commands, toolCalls } = world(on, { slots: [`${dir}/2`] })
  await $.session.start({ cwd: `${dir}/2`, surface: 'terminal', isInteractive: true })
  expect(toolCalls).not.toContain('EnterWorktree')
  expect(created(commands)).toEqual([])
  expect((await $.tool.call({ tool: 'Edit', file_path: `${dir}/2/a.ts`, old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
})

test('a slot left dirty is backed up, cleaned and detached before reuse; one another session holds is skipped', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  // Slot 1 is another session's, alive; slot 2 was left dirty by a crash.
  const { commands, dirty } = world(on, {
    isRepo: false,
    slots: [`${dir}/1`, `${dir}/2`],
    store: { [`lease:${dir}/1`]: { sessionId: 'someone-else', beatAt: 1_000_000 } },
  })
  dirty.add(`${dir}/2`)
  on('classic.WorktreeCreate', () => ({}))
  await startSession($)
  const claimed = await $.classic.WorktreeCreate({ name: 'fix-login' })
  expect(claimed.worktreePath).toBe(`${dir}/2`)
  const inSlot = commands.filter(one => one.startsWith(`${dir}/2$ `)).map(one => one.slice(`${dir}/2$ `.length))
  const hooksOff = 'git -c core.hooksPath=/dev/null'
  expect(inSlot.slice(0, 8)).toEqual([
    'git status --porcelain',
    `${hooksOff} add -A`,
    'git stash create',
    expect.stringMatching(new RegExp(`^${hooksOff} update-ref refs/fish/backup/2-\\d+ 5ta5h$`)),
    `${hooksOff} reset --hard -q`,
    `${hooksOff} clean -fdq`,
    `${hooksOff} checkout -q --detach HEAD`,
    `${hooksOff} checkout -q -B fish/fix-login origin/main`,
  ])
})

test('claims take the repository lock and give it back, and a stale lock is broken', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  // A lock left by a session that died holding it.
  const { commands } = world(on, { isRepo: false, folders: [`${dir}/.lock`] })
  on('classic.WorktreeCreate', () => ({}))
  await startSession($)
  const claimed = await $.classic.WorktreeCreate({ name: 'one' })
  expect(claimed.worktreePath).toBe(`${dir}/1`)
  const lockSteps = commands.filter(one => one.includes(`${dir}/.lock`)).map(one => one.slice(one.indexOf('$ ') + 2))
  expect(lockSteps.slice(0, 4)).toEqual([`mkdir ${dir}/.lock`, `rm -rf ${dir}/.lock`, `mkdir ${dir}/.lock`, `rm -rf ${dir}/.lock`])
})

test('node_modules are cloned copy-on-write through a staging folder, nested ones too', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const { clock, commands } = world(on, {
    files: {
      [`${REPO}/package-lock.json`]: '{}',
      [`${REPO}/node_modules/left-pad/index.js`]: '',
      [`${dir}/1/package-lock.json`]: '{}',
    },
    nodeModules: { [REPO]: ['node_modules', 'packages/api/node_modules'] },
  })
  await startSession($)
  await clock.advance(1)
  expect(commands).toContain(`${REPO}$ cp -c -p -R ${REPO}/node_modules ${dir}/1/.fish-seed-0`)
  expect(commands).toContain(`${REPO}$ mv ${dir}/1/.fish-seed-0 ${dir}/1/node_modules`)
  expect(commands).toContain(`${REPO}$ cp -c -p -R ${REPO}/packages/api/node_modules ${dir}/1/.fish-seed-1`)
  expect(commands).toContain(`${REPO}$ mkdir -p ${dir}/1/packages/api`)
})

test('the setup command is skipped when it and the lockfiles are what it last ran with', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: 'pnpm install' } }, async ($, on) => {
  const dir = await repoDir()
  const { clock, commands } = world(on, { store: { [`setup:${dir}/1`]: { command: 'pnpm install', lockHash: '' } } })
  await startSession($)
  await clock.advance(1)
  const ranIn = (path: string) => commands.includes(`${path}$ /bin/bash -lc pnpm install`)
  // Slot 1 ran it before with these lockfiles; the pool's new slots had not.
  expect(ranIn(`${dir}/1`)).toBe(false)
  expect(ranIn(`${dir}/2`)).toBe(true)
  expect(ranIn(`${dir}/3`)).toBe(true)
})

test('on a reused slot with its setup skipped, the stepper keeps up with the log while the move waits', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: 'pnpm install' } }, async ($, on) => {
  const dir = await repoDir()
  const state = world(on, { slots: [`${dir}/1`], store: { [`setup:${dir}/1`]: { command: 'pnpm install', lockHash: '' } }, isMoveHeld: true })
  const { clock } = state
  await startSession($)
  await clock.advance(1)
  const ui = await mountPane($, 'terminal')
  await activate(ui, 'tab-worktree')
  const stages = async () => ((await ui.find({ text: /Move in/ }))?.text ?? '').replace(/\s+/g, ' ')
  expect(await ui.find({ text: /Reusing slot 1/ })).toBeDefined()
  expect(await ui.find({ text: /Setup already done for these lockfiles/ })).toBeDefined()
  expect(await stages()).toContain('✓ Fetch ─ ✓ Claim a slot ─ ✓ Seed ─ ● Move in')
  state.confirmMove()
  await clock.advance(1)
  await ui.redraw()
  expect(await ui.find({ text: /Ready/ })).toBeDefined()
})

test("the pool's warming after a claim adds nothing to the session's steps", { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: 'pnpm install' } }, async ($, on) => {
  const { clock, commands } = world(on)
  await startSession($)
  await clock.advance(1)
  // The pool warmed slot 1 and ran the setup in each of its slots; the
  // session took slot 1, its setup already done. None of the pool's runs is
  // the session's, so its log shows none of them.
  expect(commands.filter(one => one.endsWith('$ /bin/bash -lc pnpm install')).length).toBe(3)
  const ui = await mountPane($, 'terminal')
  await activate(ui, 'tab-worktree')
  await activate(ui, 'steps-toggle')
  expect(await ui.find({ text: /Setup already done for these lockfiles/ })).toBeDefined()
  expect(await ui.find({ text: /Running pnpm install/ })).toBeUndefined()
  expect(await ui.find({ text: /✓ Fetch\s+─\s+✓ Claim a slot\s+─\s+✓ Seed\s+─\s+✓ Move in/ })).toBeDefined()
})

test('the pane tabs are the surface\'s own buttons, with keys 1 to 3', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Client', key: 'tabs-click' })).toBeUndefined()
  for (const [index, tab] of ['worktree', 'dials', 'context'].entries()) {
    expect(await ui.find({ type: 'Button', key: `tab-${tab}` })).toMatchObject({ props: { hotkey: String(index + 1) } })
  }
  await ui.press({ key: 'tab-dials' })
  expect(await ui.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
})

test('with too little free disk the pool does not warm, and the tab says why', { options: { worktreeRoot: '/slots', setupCommand: '', minFreeGb: 10_000 } }, async ($, on) => {
  const { clock, commands } = world(on)
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await activate(ui, 'tab-worktree')
  await activate(ui, 'auto-worktree')
  await clock.advance(1)
  expect(created(commands)).toEqual([])
  await ui.redraw()
  expect(await ui.find({ text: /Paused: .* GB of disk free, under the 10000 GB it keeps/ })).toBeDefined()
})

test("a session started in a worktree Claude Code made (claude --worktree, the desktop's option) is adopted into a slot on its name", { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, commands, toolCalls } = world(on)
  await $.session.start({ cwd: `${REPO}/.claude/worktrees/feat-x`, surface: 'terminal', isInteractive: true })
  // Read-only until its slot is ready, then moved in.
  expect((await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })).deny).toContain('Read-only until the worktree is ready')
  await clock.advance(1)
  const dir = await repoDir()
  expect(commands).toContain(`${dir}/1$ git -c core.hooksPath=/dev/null checkout -q -B fish/feat-x origin/main`)
  expect(toolCalls).toContain('EnterWorktree')
})

// Claude Code reuses a worktree folder for a new session: the branch named
// for it may be out in another slot still, or left behind by a session that
// ended. Either way it is not this session's, so it gets one of its own.
for (const [what, held] of [['still out in another slot', true], ['left with no worktree on it', false]] as const) {
  test(`a Claude Code worktree reused by a new session, its old branch ${what}, gets a branch of its own and leaves the old one be`, { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
    const dir = await repoDir()
    const { clock, commands, toolCalls } = world(on, held ? { slots: [`${dir}/1`, `${dir}/2`], onBranch: { [`${dir}/2`]: 'fish/feat-x' } } : { slots: [`${dir}/1`], branches: ['fish/feat-x'] })
    await $.session.start({ cwd: `${REPO}/.claude/worktrees/feat-x`, surface: 'terminal', isInteractive: true })
    await clock.advance(1)
    expect(commands).toContain(`${dir}/1$ git -c core.hooksPath=/dev/null checkout -q -B fish/feat-x-abcdef origin/main`)
    expect(commands.filter(one => one.endsWith('checkout -q -B fish/feat-x origin/main'))).toEqual([])
    expect(toolCalls).toContain('EnterWorktree')
  })
}

test('a retry comes back to the slot this session already leases, ahead of an idle one before it', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const { clock, commands } = world(on, { slots: [`${dir}/1`, `${dir}/2`], store: { [`lease:${dir}/2`]: { sessionId: 'abcdef123456', beatAt: 1_000_000 } } })
  await startSession($)
  await clock.advance(1)
  expect(commands).toContain(`${dir}/2$ git -c core.hooksPath=/dev/null checkout -q -B fish/abcdef origin/main`)
  // Slot 1 is only looked at, as the slot to offer the desktop's hook.
  expect(commands.filter(one => one.startsWith(`${dir}/1$`) && one !== `${dir}/1$ git status --porcelain`)).toEqual([])
})

for (const [what, mark] of [['uncommitted', 'dirty'], ['committed', 'ahead']] as const) {
  test(`a Claude Code worktree with ${what} work in it is left where it is, its work with it`, { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
    const one = world(on)
    one[mark].add(`${REPO}/.claude/worktrees/feat-x`)
    await $.session.start({ cwd: `${REPO}/.claude/worktrees/feat-x`, surface: 'terminal', isInteractive: true })
    expect((await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
    await one.clock.advance(1)
    expect(one.toolCalls).not.toContain('EnterWorktree')
  })
}

test('a session started in some other worktree, a slot of ours among them, is left where it is', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const { clock, toolCalls } = world(on)
  await $.session.start({ cwd: '/slots/repo-x/1', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
  expect(toolCalls).not.toContain('EnterWorktree')
})

test('a session that starts in one of our slots is that slot\'s, ready, with nothing to create, toggle off or on', { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const { toolCalls } = world(on, { slots: [`${dir}/2`] })
  await $.session.start({ cwd: `${dir}/2`, surface: 'terminal', isInteractive: true })
  expect(toolCalls).not.toContain('EnterWorktree')
  expect((await $.tool.call({ tool: 'Edit', file_path: `${dir}/2/a.ts`, old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
  const ui = await mountPane($, 'desktop')
  await activate(ui, 'tab-worktree')
  expect(await ui.find({ text: /Ready/ })).toBeDefined()
  expect(await ui.find({ text: /this session/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'worktree-create' })).toBeUndefined()
})

test('a session in a worktree fishStack does not manage is told where it is, and offered nothing to create', { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/other/wt', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'desktop')
  await activate(ui, 'tab-worktree')
  expect(await ui.find({ text: /This session already works in a worktree/ })).toBeDefined()
  expect(await ui.find({ text: /\/other\/wt/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'worktree-create' })).toBeUndefined()
})

test('the pool is listed whatever the session does, and + Add slot adds a slot to it', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const { clock, commands } = world(on, { slots: [1, 2, 3].map(n => `${dir}/${n}`) })
  // This session works in a worktree of its own, not one of the pool's.
  await $.session.start({ cwd: '/other/wt', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
  expect(created(commands)).toEqual([])
  const ui = await mountPane($, 'terminal')
  await activate(ui, 'tab-worktree')
  expect(await ui.find({ text: /This session already works in a worktree/ })).toBeDefined()
  expect(await ui.find({ text: /Slots · 3/ })).toBeDefined()
  expect(await ui.find({ text: /#3 detached ○ free/ })).toBeDefined()
  await activate(ui, 'pool-add')
  await clock.advance(1)
  expect(created(commands)).toEqual([`${REPO}$ git -c core.hooksPath=/dev/null worktree add -q --detach --no-checkout ${dir}/4 0123456789abcdef`])
  await ui.redraw()
  expect(await ui.find({ text: /Pool: 4 slots, 4 ready/ })).toBeDefined()
  expect(await ui.find({ text: /Slots · 4/ })).toBeDefined()
  // The pool keeps four from now on: a top-up makes nothing more.
  await activate(ui, 'auto-worktree-off')
  await activate(ui, 'auto-worktree-on')
  await clock.advance(1)
  expect(created(commands).length).toBe(1)
})

test('an added slot is listed at once as setting up, step by step, and no session claims it until it is ready', { options: { worktreeRoot: '/slots', setupCommand: 'pnpm install' } }, async ($, on) => {
  const dir = await repoDir()
  const state = world(on, { slots: [1, 2].map(n => `${dir}/${n}`), store: Object.fromEntries([1, 2].map(n => [`lease:${dir}/${n}`, { sessionId: 'someone-else', beatAt: 1_000_000 }])), isSetupHeld: true })
  const { clock } = state
  on('classic.WorktreeCreate', () => ({}))
  await $.session.start({ cwd: '/other/wt', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal')
  await activate(ui, 'tab-worktree')
  await activate(ui, 'pool-add')
  await ui.redraw()
  expect(await ui.find({ text: /Slots · 3/ })).toBeDefined()
  expect(await ui.find({ text: /#3 ◐ setting up/ })).toBeDefined()
  await clock.advance(1)
  await ui.redraw()
  // Made and seeding: its row says what it is doing, and it cannot be removed.
  expect(await ui.find({ text: /#3 ◐ setting up · Running pnpm install/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `slot-remove-${dir}/3` })).toBeUndefined()
  await activate(ui, 'auto-worktree-on')
  await ui.redraw()
  expect(await ui.find({ text: /Pool: 3 slots, 0 ready, 1 setting up/ })).toBeDefined()
  // Every other slot is held, and a claim passes the one setting up by.
  const claimed = await $.classic.WorktreeCreate({ name: 'feat-y' })
  expect(claimed.worktreePath).toBe(`${dir}/4`)
  state.finishSetup()
  await clock.advance(1)
  await ui.redraw()
  expect(await ui.find({ text: /#3 detached ○ free/ })).toBeDefined()
})

test('a free slot is removed after a second press: its leftovers backed up, the pool one smaller for good', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const { clock, commands, dirty, saved } = world(on, {
    slots: [1, 2, 3].map(n => `${dir}/${n}`),
    store: { [`lease:${dir}/1`]: { sessionId: 'someone-else', beatAt: 1_000_000 }, [`setup:${dir}/3`]: { command: 'x', lockHash: '' } },
  })
  dirty.add(`${dir}/3`)
  await $.session.start({ cwd: '/other/wt', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
  const ui = await mountPane($, 'terminal')
  await activate(ui, 'tab-worktree')
  // A slot another session holds offers Release, not Remove.
  expect(await ui.find({ type: 'Button', key: `slot-remove-${dir}/1` })).toBeUndefined()
  await activate(ui, `slot-remove-${dir}/3`)
  expect(await ui.find({ text: /Remove slot #3\?/ })).toBeDefined()
  await activate(ui, 'slot-remove-cancel')
  expect(await ui.find({ text: /Remove slot #3\?/ })).toBeUndefined()
  await activate(ui, `slot-remove-${dir}/3`)
  await activate(ui, 'slot-remove-confirm')
  await clock.advance(1)
  expect(commands).toContainEqual(expect.stringMatching(new RegExp(`^${dir}/3\\$ git -c core.hooksPath=/dev/null update-ref refs/fish/backup/3-\\d+ 5ta5h$`)))
  expect(commands).toContainEqual(expect.stringMatching(new RegExp(`mv ${dir}/3 ${dir}/\\.removing-3-\\d+$`)))
  expect(commands).toContain(`${REPO}$ git worktree prune`)
  expect(saved[`setup:${dir}/3`]).toBeUndefined()
  expect(saved[`poolSize:${dir}`]).toBe(2)
  await ui.redraw()
  expect(await ui.find({ text: /Slots · 2/ })).toBeDefined()
  expect(await ui.find({ text: /#3/ })).toBeUndefined()
  // The pool keeps two from now on: a top-up does not make it back.
  await activate(ui, 'auto-worktree-off')
  await activate(ui, 'auto-worktree-on')
  await clock.advance(1)
  expect(created(commands)).toEqual([])
})

test('after /clear the session keeps its slot, its lease and its dials', { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const state = world(on, { slots: [`${dir}/2`] })
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ cwd: `${dir}/2`, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal')
  await activate(ui, 'tab-dials')
  await activate(ui, 'preset-Autopilot')
  expect(state.saved[`lease:${dir}/2`]).toBeDefined()
  // /clear: the conversation ends, the process goes on in the slot, and a
  // fresh session follows with no session.start.
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  await $.classic.SessionStart({ source: 'clear' } as never)
  expect(state.saved[`lease:${dir}/2`]).toBeDefined()
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.find(section => section.id === 'fishstack:dials')?.text).toContain('Autonomy (Autopilot)')
  await activate(ui, 'tab-worktree')
  expect(await ui.find({ text: /Ready/ })).toBeDefined()
})

test('a session that really ends gives its slot back', { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const state = world(on, { slots: [`${dir}/2`] })
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: `${dir}/2`, surface: 'terminal', isInteractive: true })
  expect(state.saved[`lease:${dir}/2`]).toBeDefined()
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(state.saved[`lease:${dir}/2`]).toBeUndefined()
})

test("the Slots list follows other sessions: a claim or release shows on Claude Code's file watch, and a lapsed lease shows free on time", { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const state = world(on, { slots: [1, 2].map(n => `${dir}/${n}`) })
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  await $.session.start({ cwd: '/other/wt', surface: 'terminal', isInteractive: true })
  // Session start arms the watch on the pool's signal.
  const started = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(started.watchPaths).toContain(`${dir}/.changed`)
  const ui = await mountPane($, 'terminal')
  await activate(ui, 'tab-worktree')
  await state.clock.advance(1)
  expect(await ui.find({ text: /#1 detached ○ free/ })).toBeDefined()

  // Another session claims slot 1 and writes the signal.
  state.kept[`lease:${dir}/1`] = { sessionId: 'someone-else', beatAt: state.clock.now() }
  await $.classic.FileChanged({ file_path: `${dir}/.changed`, event: 'change' } as never)
  await state.clock.advance(250)
  await ui.redraw()
  expect(await ui.find({ text: /#1 detached ● leased/ })).toBeDefined()

  // It dies holding it: no signal, but the lease lapses and the list says so.
  await state.clock.advance(3 * 60_000)
  await ui.redraw()
  expect(await ui.find({ text: /#1 detached ○ free/ })).toBeDefined()
})

test('a claim and a release write the pool signal other sessions watch', { options: { worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const state = world(on, { slots: [`${dir}/2`] })
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: `${dir}/2`, surface: 'terminal', isInteractive: true })
  expect(state.written).toContain(`${dir}/.changed`)
  state.written.length = 0
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(state.written).toEqual([`${dir}/.changed`])
})

// The desktop app's WorktreeCreate hook (desktop-worktree.sh) takes the slot
// offered to it and holds it with a file beside it until the desktop removes
// its worktree: no session claims a held slot, whatever its lease says.
test('a slot the desktop holds is never claimed, and Release lets go of the hold', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const { clock, commands } = world(on, { slots: [1, 2].map(n => `${dir}/${n}`), files: { [`${dir}/1.held`]: 'desktop-session\n' } })
  await startSession($)
  await clock.advance(1)
  // Slot 2 is offered to the desktop meanwhile, so the session takes the one
  // warmed after it, never the held one.
  expect(commands).toContain(`${dir}/3$ git -c core.hooksPath=/dev/null checkout -q -B fish/abcdef origin/main`)
  expect(commands.some(one => one.startsWith(`${dir}/1$ git -c core.hooksPath=/dev/null checkout -q -B`))).toBe(false)

  const ui = await mountPane($, 'desktop')
  await activate(ui, 'tab-worktree')
  await activate(ui, `slot-release-${dir}/1`)
  expect(commands).toContain(`${REPO}$ rm -f ${dir}/1.held`)
})

test("the pool offers one clean, detached slot to the desktop's hook, and installs the hook where the repository's settings find it", { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const dir = await repoDir()
  const { clock, written } = world(on, { slots: [1, 2, 3].map(n => `${dir}/${n}`) })
  on('fs.read', ($, e) => (e.path.endsWith('/hooks/desktop-worktree.sh') ? { value: '#!/bin/bash\n' } : Promise.reject(new Error('ENOENT'))))
  await $.session.start({ cwd: '/other/wt', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
  expect(written.filter(path => path.endsWith('.ready'))).toEqual([`${dir}/1.ready`])
  expect(written).toContain(`${REPO}/.git/fishstack/slots-root`)
  expect(written).toContain(`${REPO}/.git/fishstack/desktop-worktree.sh`)
})

// The hook reaches the desktop only through settings: fishStack wires the
// repository's own .claude/settings.local.json while Use worktrees is on,
// keeps it out of git, and takes its entries out again when it goes off.
const LOCAL = `${REPO}/.claude/settings.local.json`

test('Use worktrees wires the local settings to the hook, the rest kept and out of git, and unwires them when off', { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const files: Record<string, string> = { [LOCAL]: '{"disabledMcpjsonServers":["x"],"hooks":{"Stop":[{"hooks":[{"type":"command","command":"true"}]}]}}' }
  const { clock, commands } = world(on, { files })
  await $.session.start({ cwd: '/other/wt', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
  const wired = JSON.parse(files[LOCAL]!)
  expect(wired.disabledMcpjsonServers).toEqual(['x'])
  expect(wired.hooks.Stop).toHaveLength(1)
  expect(wired.hooks.WorktreeCreate[0].hooks[0].command).toContain('/fishstack/desktop-worktree.sh" create')
  expect(wired.hooks.WorktreeRemove[0].hooks[0].command).toContain('/fishstack/desktop-worktree.sh" remove')
  expect(commands).toContain(`${REPO}$ git check-ignore -q .claude/settings.local.json`)
  expect(files[`${REPO}/.git/fishstack/on`]).toBeDefined()

  const ui = await mountPane($, 'desktop')
  await activate(ui, 'tab-worktree')
  await activate(ui, 'auto-worktree')
  expect(JSON.parse(files[LOCAL]!)).toEqual({ disabledMcpjsonServers: ['x'], hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } })
  expect(commands).toContain(`${REPO}$ rm -f ${REPO}/.git/fishstack/on`)
})

test("a WorktreeCreate hook of the person's own is left alone", { options: { autoWorktree: true, worktreeRoot: '/slots', setupCommand: '' } }, async ($, on) => {
  const theirs = '{"hooks":{"WorktreeCreate":[{"hooks":[{"type":"command","command":"my-worktree"}]}]}}'
  const files: Record<string, string> = { [LOCAL]: theirs }
  const { clock } = world(on, { files })
  await $.session.start({ cwd: '/other/wt', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
  expect(files[LOCAL]).toBe(theirs)
})

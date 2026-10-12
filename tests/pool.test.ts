import { expect, test } from 'claude-code/testing'

import { activate, mountPane, REPO, startSession, world } from './world'

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

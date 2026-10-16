import { expect, test } from 'claude-code/testing'

import { activate, mountBand, openCard, PANE_PROPS, REPO, startSession, world } from './world'

const EDIT = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as const

test('the head start is read-only until the worktree is ready, then the session moves in', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls, drain } = world(on, { fetch: 'held' })
  await startSession($)
  await clock.settle()

  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf src' })).deny).toBeDefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'rg TODO src | head -5' })).deny).toBeUndefined()

  const submitted = await $.prompt.submit({ text: 'create hello.txt', wait: false, origin: { kind: 'composer' } })
  expect(submitted.context?.join('\n')).toContain('Read-only head start')

  await drain()
  expect(toolCalls).toContain('EnterWorktree')
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})

test('the rail stays up while the worktree is made, its pill saying Preparing, then the branch', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, drain } = world(on, { fetch: 'held' })
  await startSession($)
  await clock.settle()
  const band = await mountBand($, 'terminal')
  expect(JSON.stringify(await band.find({ key: 'rail-worktree' }))).toContain('Preparing')
  const desktop = await mountBand($, 'desktop')
  expect(JSON.stringify(await desktop.drawn())).toContain('Read-only until the worktree is ready')

  await drain()
  await band.redraw()
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).not.toContain('Worktree ready')
  expect(drawn).not.toContain('Preparing')
  expect(await band.find({ key: 'rail-worktree' })).toBeDefined()
})

test('read-only shell commands pass and anything that writes is refused', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, drain } = world(on, { fetch: 'held' })
  await startSession($)
  await clock.settle()
  const allowed = ['ls -la', 'git -C /repo log --oneline -5', 'find . -name "*.ts"', "sed -n '1,20p' a.ts", 'cat a.ts 2>/dev/null']
  const refused = [
    'ls && rm a.ts',
    'cat a.ts | tee b.ts',
    'echo hi > b.ts',
    'git -c core.pager=less log',
    'git diff --output=patch.diff',
    'find . -exec rm {} \;',
    'sed -i s/a/b/ a.ts',
    'echo $(whoami)',
    'npm install',
  ]
  for (const command of allowed) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBeUndefined()
  }
  for (const command of refused) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBeDefined()
  }
  await drain()
})

test('a session outside the main checkout gets no worktree', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})

test('a VS Code session, headless at start, claims its worktree when the editor attaches', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls, drain } = world(on, { fetch: 'held' })
  on('session.surfaces', () => ({ value: [] }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()

  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default', viewport: { columns: 120, rows: 40, isFullscreen: false } })
  await clock.settle()
  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  await drain()
  expect(toolCalls).toContain('EnterWorktree')
})

// An editor can attach after the first prompt went out, so the claim starts
// mid-turn: the agent learns of the head start at its next batch, once, and
// is told to continue once it has moved.
test('a head start that begins after the prompt reaches the agent at its next batch', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls, prompts, drain } = world(on, { fetch: 'held' })
  on('classic.PostToolBatch', () => ({}))
  on('session.surfaces', () => ({ value: [] }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  const batch = async (agentId?: string) =>
    ((await $.classic.PostToolBatch({ tool_calls: [], ...(agentId === undefined ? {} : { agent_id: agentId }) } as never)).additionalContext ?? []).join('\n')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })

  const submitted = await $.prompt.submit({ text: 'how long is the readme', wait: false, origin: { kind: 'composer' } })
  expect(submitted.context?.join('\n') ?? '').not.toContain('Read-only head start')
  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default', viewport: { columns: 120, rows: 40, isFullscreen: false } })
  await clock.settle()
  // A subagent's batch does not take it.
  expect(await batch('sub-1')).toBe('')
  const told = await batch()
  expect(told).toContain('not from the tool you just ran')
  expect(told).toContain('Read-only head start')
  expect(await batch()).toBe('')

  await drain()
  expect(toolCalls).toContain('EnterWorktree')
  expect(prompts.at(-1)).toContain('Your worktree is ready')
  expect(await batch()).toBe('')
})

test('a move that lands mid-turn with no head start told is told once, at the next batch', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock } = world(on)
  on('classic.PostToolBatch', () => ({}))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  const batch = async () => ((await $.classic.PostToolBatch({ tool_calls: [] } as never)).additionalContext ?? []).join('\n')
  await startSession($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)

  await clock.advance(1)
  const told = await batch()
  expect(told).toContain('moved into its own worktree')
  expect(told).toMatch(/on branch `fish\//)
  expect(await batch()).toBe('')
  expect((await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })).context?.join('\n') ?? '').not.toContain('moved')
})

test('a move that lands at the end of a turn is told with the next prompt', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock } = world(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  await startSession($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await clock.advance(1)
  const told = (await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })).context?.join('\n') ?? ''
  expect(told).toContain('fishStack update: this session has moved into its own worktree')
  expect(told).not.toContain('not from the tool you just ran')
})

test('a move that lands before the first turn adds no note: the session starts where it works', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock } = world(on)
  await startSession($)
  await clock.advance(1)
  expect((await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })).context?.join('\n') ?? '').toBe('')
})

// The desktop's composer has its own worktree switch: unticked, the session
// starts in the main checkout and stays there; ticked, the desktop makes a
// worktree under .claude/worktrees/, which is set up where it is.
test("a desktop session in the main checkout stays there: the desktop's worktree option was off", { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls } = world(on)
  on('session.surfaces', () => ({ value: [] }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default', viewport: { columns: 120, rows: 40, isFullscreen: true } })
  await clock.advance(1)
  expect(toolCalls).not.toContain('EnterWorktree')
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()

  // Asked for by name, it is made all the same.
  const ui = await $.ui.mount({ plugin: 'fishstack', surface: 'desktop', component: 'Pane', requestId: 'fishstack', props: PANE_PROPS })
  await openCard(ui, 'worktree')
  await activate(ui, 'worktree-create')
  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
})

// The desktop's diff, PR and archive follow the worktree it made, so the
// session stays in it: set up there, with no slot and no move.
test("a desktop session in the worktree its option made is set up there and stays", { options: { autoWorktree: true, setupCommand: 'pnpm install' } }, async ($, on) => {
  const { clock, commands, toolCalls, saved, written } = world(on)
  const made = '/repo/.claude/worktrees/feat-x'
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: made, surface: null, isInteractive: false })
  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  await clock.advance(1)
  expect(commands).toContain(`${made}$ /bin/bash -lc pnpm install`)
  expect(commands.some(one => one.includes('checkout -q -B'))).toBe(false)
  expect(toolCalls).not.toContain('EnterWorktree')
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()

  // Not a slot: no lease, and nothing given back to the pool as it ends.
  await clock.advance(120_000)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(saved[`lease:${made}`]).toBeUndefined()
  expect(written).not.toContain('/repo/.claude/worktrees/.changed')
})

test('Perm worktree is off by default: no slot and no read-only guard', async ($, on) => {
  const { toolCalls } = world(on)
  await startSession($)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  expect(toolCalls).not.toContain('EnterWorktree')

  const ui = await $.ui.mount({ plugin: 'fishstack', surface: 'desktop', component: 'Pane', requestId: 'fishstack', props: PANE_PROPS })
  await openCard(ui, 'worktree')
  expect(await ui.find({ text: 'Sessions work in the main checkout.' })).toBeDefined()
  await activate(ui, 'auto-worktree')
  expect(await ui.find({ text: 'New sessions get a worktree of their own.' })).toBeDefined()
  expect((await ui.find({ key: 'terminal-worktree-ask' }))?.props.variant).toBe('primary')
})

test("Claude Code's own worktree creation gets a slot, read-only until it is seeded", { options: { autoWorktree: true, setupCommand: '' } }, async ($, on) => {
  const { clock } = world(on, { isRepo: false })
  on('classic.WorktreeCreate', () => ({}))
  await startSession($)
  const created = await $.classic.WorktreeCreate({ name: 'fix-login' })
  expect(created.worktreePath).toMatch(/\/1$/)
  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  await clock.advance(1)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})

// Plain `claude` in a main checkout says nothing about a worktree, so the
// person is asked, as the desktop's composer asks. The pool warms meanwhile.
test('plain claude in a main checkout asks where the session works, and claims nothing until told', { options: { autoWorktree: true } }, async ($, on) => {
  const state = world(on, { where: 'held' })
  await startSession($)
  await state.clock.advance(1)
  expect(state.asked).toEqual(['Where should this session work?'])
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  expect(state.toolCalls).not.toContain('EnterWorktree')

  state.answer({ 'Where should this session work?': 'A worktree' })
  await state.clock.advance(1)
  expect(state.toolCalls).toContain('EnterWorktree')
  expect(state.asked).toHaveLength(1)
})

for (const where of ['This main checkout', 'dismissed']) {
  test(`answered "${where}", the session stays in the main checkout with full access, and Create worktree now still claims one`, { options: { autoWorktree: true } }, async ($, on) => {
    const { clock, toolCalls, asked } = world(on, { where })
    await startSession($)
    await clock.advance(1)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git switch main' })).deny).toBeUndefined()
    expect(toolCalls).not.toContain('EnterWorktree')

    const ui = await $.ui.mount({ plugin: 'fishstack', surface: 'desktop', component: 'Pane', requestId: 'fishstack', props: PANE_PROPS })
    await openCard(ui, 'worktree')
    expect(await ui.find({ text: /This session: main checkout/ })).toBeDefined()
    await activate(ui, 'worktree-create')
    await clock.advance(1)
    expect(toolCalls).toContain('EnterWorktree')
    expect(asked).toHaveLength(1)
  })
}

test('claude --worktree is its own answer: the slot is claimed with no question', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls, asked } = world(on)
  await $.session.start({ cwd: '/repo/.claude/worktrees/feat-x', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
  expect(asked).toEqual([])
  expect(toolCalls).toContain('EnterWorktree')
})

// git gives a branch to one worktree at a time: a worktree on main would
// lock the main checkout out of its own default branch.
test('a worktree never checks out the default branch, so the main checkout can always switch to it', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock } = world(on)
  await startSession($)
  await clock.advance(1)
  const refused = ['git switch main', 'git checkout main', 'git checkout -q main', 'git fetch origin main && git switch main', 'git checkout -B main origin/main', 'git switch -C main', 'git switch --create=main']
  const allowed = ['git switch -c feat origin/main', 'git checkout -b feat main', 'git switch --detach origin/main', 'git checkout --detach main', 'git checkout main -- a.ts', 'git checkout main a.ts', 'git checkout origin/main', 'git switch feat', 'git switch -', 'cd /repo && git switch main', 'git -C /repo switch main']
  for (const command of refused) {
    const deny = (await $.tool.call({ tool: 'Bash', command })).deny
    expect(deny, command).toContain('stays free for the main checkout at `/repo`')
    expect(deny, command).toContain('git switch -c <new-branch> origin/main')
  }
  for (const command of allowed) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBeUndefined()
  }
})

test('each answer says where it leads: the main checkout by its branch, a worktree from origin', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, askedWith } = world(on, { where: 'held' })
  // The engine beneath the plugin: the props its own dialog is handed.
  let drawn: { questions: { header: string; options: { label: string; description?: string }[] }[] } | null = null
  on('ui.render', ($, e) => {
    if (e.component === 'AskUserQuestion') drawn = e.props as never
    return { type: 'engine', component: e.component, props: e.props } as never
  })
  await startSession($)
  await clock.advance(1)
  await $.ui.render({ surface: 'terminal', component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: askedWith } } as never)
  const [question] = drawn!.questions
  expect(question!.header).toBe('Worktree')
  expect(question!.options.map(one => one.label)).toEqual(['A worktree', 'This main checkout', 'Always a worktree'])
  expect(question!.options[0]!.description).toContain('from the latest origin/main')
  expect(question!.options[1]!.description).toContain('Right here, on main, with full access')
})

// Someone who always wants a worktree says so once: from then on a new
// terminal session takes one with no question, until the tab says ask again.
test('"Always a worktree" takes one now and for every new terminal session, until the tab says ask again', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls, saved } = world(on, { where: 'Always a worktree' })
  await startSession($)
  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
  expect(saved[`terminalWorktree:${REPO}`]).toBe('always')

  const ui = await $.ui.mount({ plugin: 'fishstack', surface: 'desktop', component: 'Pane', requestId: 'fishstack', props: PANE_PROPS })
  await openCard(ui, 'worktree')
  expect((await ui.find({ key: 'terminal-worktree-always' }))?.props.variant).toBe('primary')
  await activate(ui, 'terminal-worktree-ask')
  expect(saved[`terminalWorktree:${REPO}`]).toBe('ask')
})

test('with Always a worktree kept, a new terminal session takes one with no question', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls, asked } = world(on, { store: { terminalWorktree: 'always' } })
  await startSession($)
  await clock.advance(1)
  expect(asked).toEqual([])
  expect(toolCalls).toContain('EnterWorktree')
})

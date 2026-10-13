import { expect, test } from 'claude-code/testing'

import { activate, mountBand, PANE_PROPS, startSession, world } from './world'

const EDIT = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as const

test('the head start is read-only until the worktree is ready, then the session moves in', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls } = world(on)
  await startSession($)

  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf src' })).deny).toBeDefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'rg TODO src | head -5' })).deny).toBeUndefined()

  const submitted = await $.prompt.submit({ text: 'create hello.txt', wait: false, origin: { kind: 'composer' } })
  expect(submitted.context?.join('\n')).toContain('Read-only head start')

  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})

test('the ready band hides itself a moment later, giving way to the rail', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock } = world(on)
  await startSession($)
  await clock.advance(1)
  const band = await mountBand($, 'terminal')
  expect(JSON.stringify(await band.drawn())).toContain('Worktree ready')
  expect(await band.find({ key: 'rail-worktree' })).toBeUndefined()

  await clock.advance(4_000)
  await band.redraw()
  expect(JSON.stringify(await band.drawn())).not.toContain('Worktree ready')
  expect(await band.find({ key: 'rail-worktree' })).toBeDefined()
})

test('read-only shell commands pass and anything that writes is refused', { options: { autoWorktree: true } }, async ($, on) => {
  world(on)
  await startSession($)
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
})

test('a session outside the main checkout gets no worktree', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})

test('a VS Code session, headless at start, claims its worktree when the editor attaches', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls } = world(on)
  on('session.surfaces', () => ({ value: [] }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()

  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default', viewport: { columns: 120, rows: 40, isFullscreen: false } })
  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
})

// An editor can attach after the first prompt went out, so the claim starts
// mid-turn: the agent learns of the head start at its next batch, once, and
// is told to continue once it has moved.
test('a head start that begins after the prompt reaches the agent at its next batch', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls, prompts } = world(on)
  on('classic.PostToolBatch', () => ({}))
  on('session.surfaces', () => ({ value: [] }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  const batch = async (agentId?: string) =>
    ((await $.classic.PostToolBatch({ tool_calls: [], ...(agentId === undefined ? {} : { agent_id: agentId }) } as never)).additionalContext ?? []).join('\n')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })

  const submitted = await $.prompt.submit({ text: 'how long is the readme', wait: false, origin: { kind: 'composer' } })
  expect(submitted.context?.join('\n') ?? '').not.toContain('Read-only head start')
  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default', viewport: { columns: 120, rows: 40, isFullscreen: false } })
  // A subagent's batch does not take it.
  expect(await batch('sub-1')).toBe('')
  const told = await batch()
  expect(told).toContain('not from the tool you just ran')
  expect(told).toContain('Read-only head start')
  expect(await batch()).toBe('')

  await clock.advance(1)
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
// worktree under .claude/worktrees/, which is adopted.
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
  await activate(ui, 'tab-worktree')
  await activate(ui, 'worktree-create')
  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
})

test("a desktop session in the worktree its option made is adopted into a slot", { options: { autoWorktree: true, setupCommand: '' } }, async ($, on) => {
  const { clock, toolCalls } = world(on)
  const made = '/repo/.claude/worktrees/feat-x'
  on('session.surfaces', () => ({ value: ['desktop'] }))
  await $.session.start({ cwd: made, surface: null, isInteractive: false })
  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
})

test('Perm worktree is off by default: no slot and no read-only guard', async ($, on) => {
  const { toolCalls } = world(on)
  await startSession($)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  expect(toolCalls).not.toContain('EnterWorktree')

  const ui = await $.ui.mount({ plugin: 'fishstack', surface: 'desktop', component: 'Pane', requestId: 'fishstack', props: PANE_PROPS })
  await activate(ui, 'tab-worktree')
  expect(await ui.find({ text: /Off: fishStack leaves worktrees to Claude Code/ })).toBeDefined()
  await activate(ui, 'auto-worktree')
  expect(await ui.find({ text: /On: new sessions in a main checkout/ })).toBeDefined()
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

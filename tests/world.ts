// The world beneath the plugin in every test: a main checkout at /repo with
// an origin, git answered from a script, and the engine's own nouns.
import type { On, PromptComposeInput, RenderPropsOf } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const REPO = '/repo'

export type World = {
  clock: MockClock
  toolCalls: string[]
  fetched: string[]
  dialogs: number
  closeDialog: () => void
  panes: string[]
  // Every command fishStack ran, as `cwd$ argv`.
  commands: string[]
  // Slots with uncommitted work, by path.
  dirty: Set<string>
  // Answers the question the agent is waiting on, as the person would.
  answer: (answers: Record<string, string>) => void
  // Notifications sent, by text.
  notified: string[]
}

function ran(stdout = '', exitCode = 0) {
  return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

// `store` is what the plugin's store holds at the start; `files`, text files
// on disk by path, which fs.exists, fs.list and fs.read answer from.
export function world(
  on: On,
  {
    isRepo = true,
    isDialogSlow = false,
    store = {},
    files,
    nodeModules = {},
    slots = [],
    folders = [],
  }: {
    isRepo?: boolean
    isDialogSlow?: boolean
    store?: Record<string, unknown>
    files?: Record<string, string>
    nodeModules?: Record<string, string[]>
    // Worktrees already made, by path, detached.
    slots?: string[]
    // Folders already on disk, by path.
    folders?: string[]
  } = {},
): World {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, store)
  mock.env(on, { HOME: '/home/me' })
  const toolCalls: string[] = []
  const fetched: string[] = []
  const panes: string[] = []
  const commands: string[] = []
  const dirty = new Set<string>()
  const state: World = { clock, toolCalls, fetched, dialogs: 0, closeDialog: () => undefined, panes, commands, dirty, answer: () => undefined, notified: [] }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__fishstack__${e.name}` } }))
  on('session.repo', () => ({
    value: isRepo ? { root: REPO, remote: 'git@example.com:me/repo.git', internal: false, name: null } : null,
  }))
  on('session.root', () => ({ value: REPO }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.id', () => ({ value: 'abcdef123456' }))
  // A session a few turns in: the fields fishStack reads, the rest left out.
  const breakdown = {
    totalTokens: 68_000,
    rawMaxTokens: 200_000,
    percentage: 34,
    categories: [{ name: 'Messages', tokens: 41_000, kind: 'used' }],
    apiUsage: { input_tokens: 1_200, output_tokens: 800, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 3_000 },
  }
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 68_000, percent: 34, breakdown: breakdown as never }, rateLimits: [], cost: { usd: 0.42 } as never },
  }))
  on('ui.open', ($, e) => {
    if (!panes.includes(e.id)) panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
  on('fs.exists', ($, e) => ({ value: files !== undefined && Object.keys(files).some(path => path === e.path || path.startsWith(`${e.path}/`)) }))
  if (files !== undefined) {
    on('fs.list', ($, e) => ({
      value: Object.keys(files)
        .filter(path => dirOf(path) === e.path)
        .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: files[path]!.length, mtimeMs: 0, isLink: false })),
    }))
    on('fs.read', ($, e) => ({ value: files[e.path] ?? '' }))
  }
  on('fs.stat', ($, e) => ({ value: { kind: /\.\w+$/.test(e.path) ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: { 'content-type': 'application/json' }, text: '[{"id":1}]' } }
  })
  // The disk and git beneath the slots, as far as fishStack touches them: the
  // folders made, the worktrees git knows and the branch each has out.
  const dirs = new Set<string>([REPO])
  const worktrees = new Map<string, string | null>([[REPO, 'main']])
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
  const makeDir = (path: string) => {
    for (let at = path; at.length > 1; at = parentOf(at)) dirs.add(at)
  }
  for (const path of [...slots, ...folders]) makeDir(path)
  for (const path of slots) worktrees.set(path, null)
  on('process.run', ($, e) => {
    const argv = e.argv
    const command = argv.join(' ')
    const cwd = e.init?.cwd ?? REPO
    commands.push(`${cwd}$ ${command}`)
    // The macOS file dialog: what picked files come back as.
    if (argv[0] === 'osascript') {
      const picked = ran(command.includes('choose folder') ? `${REPO}/docs/\n` : `${REPO}/docs/api.md\n/Users/me/notes/style.md\n`)
      state.dialogs += 1
      // A slow dialog stays open until the test closes it.
      return isDialogSlow ? new Promise<typeof picked>(resolve => (state.closeDialog = () => resolve(picked))) : picked
    }
    if (argv[0] === 'mkdir') {
      const path = argv[argv.length - 1]!
      if (argv[1] !== '-p' && dirs.has(path)) return ran('', 1)
      makeDir(path)
      return ran()
    }
    if (argv[0] === 'rm') {
      const path = argv[argv.length - 1]!
      for (const one of [...dirs]) if (one === path || one.startsWith(`${path}/`)) dirs.delete(one)
      return ran()
    }
    if (argv[0] === 'mv') {
      makeDir(argv[2]!)
      return ran()
    }
    if (argv[0] === 'cp') {
      makeDir(argv[argv.length - 1]!)
      return ran()
    }
    if (argv[0] === 'df') return ran('Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk3 1 1 900000000 1% /\n')
    if (argv[0] === 'find' && argv.includes('-mindepth')) {
      const dir = argv[1]!
      if (!dirs.has(dir)) return ran('', 1)
      return ran([...dirs].filter(one => parentOf(one) === dir).join('\n'))
    }
    if (argv[0] === 'find') return ran((nodeModules[argv[1]!] ?? []).map(one => `${argv[1]}/${one}`).join('\n'))
    if (argv[0] === '/bin/bash') return ran()
    if (argv[0] !== 'git') return ran('', 1)
    // Git, its -c settings set aside.
    const args = argv.slice(1).filter((one, index, all) => one !== '-c' && all[index - 1] !== '-c')
    const sub = args.join(' ')
    // A worktree's top level is its own folder; every one shares /repo/.git.
    if (sub === 'rev-parse --show-toplevel') return ran(`${cwd.startsWith(`${REPO}/.claude/worktrees/`) || cwd.startsWith('/slots/') || cwd.startsWith('/other/') ? cwd : REPO}\n`)
    if (sub === 'rev-parse --path-format=absolute --git-common-dir') return ran(`${REPO}/.git\n`)
    if (sub === 'symbolic-ref --short refs/remotes/origin/HEAD') return ran('origin/main\n')
    if (sub === 'fetch -q origin main') return ran()
    if (sub === 'rev-parse origin/main') return ran('0123456789abcdef\n')
    if (sub === 'worktree list --porcelain') {
      return ran([...worktrees].map(([path, branch]) => `worktree ${path}\n${branch === null ? 'detached' : `branch refs/heads/${branch}`}`).join('\n\n') + '\n')
    }
    if (sub === 'worktree prune') return ran()
    if (sub.startsWith('worktree add -q --detach --no-checkout ')) {
      makeDir(args[5]!)
      worktrees.set(args[5]!, null)
      return ran()
    }
    if (sub.startsWith('checkout -q -B ')) {
      worktrees.set(cwd, args[3]!)
      return ran()
    }
    if (sub === 'checkout -q --detach HEAD') {
      worktrees.set(cwd, null)
      dirty.delete(cwd)
      return ran()
    }
    if (sub.startsWith('status')) return ran(dirty.has(cwd) ? ' M a.ts\n' : '')
    if (sub === 'stash create') return ran('5ta5h\n')
    if (sub.startsWith('hash-object ')) return ran('10ck\n')
    if (['reset --hard -q', 'clean -fdq', 'add -A'].includes(sub) || sub.startsWith('update-ref ')) return ran()
    return ran('', 1)
  })
  on('tool.call', ($, e) => {
    toolCalls.push(String(e.tool))
    // A question waits for the person, as the dialog does, until the test
    // answers it with state.answer.
    if (String(e.tool) === 'AskUserQuestion') {
      const asked = (e as unknown as { questions: unknown[] }).questions
      return new Promise(resolve => (state.answer = answers => resolve({ result: { questions: asked, answers } as never })))
    }
    return { result: 'ok' }
  })
  on('ui.notify', ($, e) => {
    state.notified.push(String(e.text))
    return { value: { isSent: true } as never }
  })
  return state
}

export async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
}

export const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'fishStack',
  isFocused: true,
  bodyColumns: 90,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}


export async function mountPane($: Engine, surface: 'terminal' | 'desktop') {
  return $.ui.mount({ plugin: 'fishstack', surface, component: 'Pane', requestId: 'fishstack', props: PANE_PROPS })
}

export const COMPOSE: PromptComposeInput = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
}

type Drawing = Awaited<ReturnType<typeof mountPane>>

// Presses a control by key as a person would on its surface: its Button, or
// on the desktop the Client laid over its picture.
// What activate needs of a drawing, on whichever surface it was mounted.
type Pressable = Pick<Drawing, 'find' | 'press' | 'resize' | 'pointer'>

export async function activate(ui: Pressable, key: string): Promise<void> {
  if ((await ui.find({ type: 'Button', key })) !== undefined) {
    await ui.press({ key })
    return
  }
  await ui.resize({ columns: 4, rows: 1, in: key })
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
}

// The keys of the controls, Buttons or drawn, whose key matches.
export async function keysOf(ui: Pick<Drawing, 'findAll'>, pattern: RegExp): Promise<string[]> {
  const found = [...(await ui.findAll({ type: 'Button' })), ...(await ui.findAll({ type: 'Client' }))]
  return found.map(one => one.key).filter((key): key is string => key !== undefined && pattern.test(key))
}

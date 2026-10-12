// Auto-claims a worktree slot for a session started in a main checkout, a
// simplified port of CommissionAI's head start (service/src/threads.rs) and
// slots (worktrees.rs). Until the slot is ready the session runs read-only
// in the main checkout (see guard.ts). This file also draws the band above
// the prompt and the pane's Worktree tab.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, Timer } from 'claude-code'

import type { Slot, Tab, Worktree, WorktreePhase } from '../types'
import { frame, PANE, PANE_TITLE } from './ui'

export const IDLE_WORKTREE: Worktree = {
  phase: 'off',
  step: '',
  steps: [],
  main: null,
  path: null,
  branch: null,
  base: null,
  baseSha: null,
  error: null,
}

const isBandHidden = atom({ plugin: 'craft-shop', key: 'isBandHidden' } as const, false)
const isHeadStartPrompted = atom({ plugin: 'craft-shop', key: 'isHeadStartPrompted' } as const, false)
const isTurnRunning = atom({ plugin: 'craft-shop', key: 'isTurnRunning' } as const, false)
const slots = atom({ plugin: 'craft-shop', key: 'slots' } as const, [])
const tab = atom({ plugin: 'craft-shop', key: 'tab' } as const, 'worktree')
const worktree = atom({ plugin: 'craft-shop', key: 'worktree' } as const, IDLE_WORKTREE)

type $ = EngineInterface

const LEASE_PREFIX = 'lease:'
const HEARTBEAT_MS = 60_000
const LEASE_TTL_MS = 3 * HEARTBEAT_MS
const SETUP_TIMEOUT_MS = 10 * 60_000
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']

export const READ_ONLY_DENY =
  'Read-only until the worktree is ready. Craft Shop is preparing a worktree for this session; read, search and plan for now, and you will be moved there with full access.'

export function headStartNote(main: string): string {
  return `Read-only head start: your worktree is still being prepared, so for now you run read-only in the main checkout at \`${main}\`. It may sit on another branch or be behind origin, so treat it as a reference. Investigate, read code and plan; do not edit files, commit or run commands that change anything. When your plan is ready, write it in your reply and end your turn. When the worktree is ready, Craft Shop moves you there with full access and tells you to continue.`
}

function continueNote(path: string, branch: string): string {
  return `Your worktree is ready at \`${path}\` on branch \`${branch}\`, and the read-only head start is over. You now work there with full access. Carry on with the request from where you left off, starting with the plan you made. If you ended your last turn waiting for an answer, end this turn and keep waiting instead.`
}

type Lease = { sessionId: string; beatAt: number }

class StepError extends Error {}

export function isReadOnlyPhase(phase: Worktree['phase']): boolean {
  return phase === 'preparing' || phase === 'failed'
}

async function git($: $, args: string[], cwd: string) {
  return $.process.run(['git', ...args], { cwd, timeoutMs: 120_000 })
}

async function gitOut($: $, args: string[], cwd: string, failure: string): Promise<string> {
  const ran = await git($, args, cwd)
  if (ran.exitCode !== 0) {
    $.ui.log(`git ${args.join(' ')} failed: ${ran.stderr.trim()}`, { to: 'debug' })
    throw new StepError(failure)
  }
  return ran.stdout.trim()
}

async function hash6(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 6)
}

async function realPath($: $, path: string): Promise<string> {
  return (await $.fs.stat(path, { resolve: true })).realPath ?? path
}

async function expandHome($: $, path: string): Promise<string> {
  if (!path.startsWith('~/')) return path
  const home = await $.env.get('HOME')
  if (home === undefined) throw new StepError('HOME is not set, so the worktree root cannot be found.')
  return `${home}${path.slice(1)}`
}

async function slotsRoot($: $, options: PluginOptions, main: string): Promise<string> {
  const root = await expandHome($, String(options.worktreeRoot || '~/.claude-craft/worktrees'))
  const name = main.split('/').pop() ?? 'repo'
  return `${root}/${name}-${await hash6(main)}`
}

async function readLease($: $, path: string): Promise<Lease | null> {
  const lease = await $.store.get(LEASE_PREFIX + path)
  return lease !== null && typeof lease === 'object' ? (lease as Lease) : null
}

async function isLeaseLive($: $, lease: Lease | null): Promise<boolean> {
  return lease !== null && (await $.clock.now()) - lease.beatAt < LEASE_TTL_MS
}

async function writeLease($: $, path: string): Promise<void> {
  const lease: Lease = { sessionId: await $.session.id(), beatAt: await $.clock.now() }
  await $.store.set(LEASE_PREFIX + path, lease)
}

async function setStep($: $, label: string, isWarning = false): Promise<void> {
  const at = await $.clock.now()
  await update($, worktree, current => ({
    ...current,
    step: label,
    steps: [...current.steps, { label, at, isWarning }],
  }))
}

async function worktreePaths($: $, main: string): Promise<Map<string, string | null>> {
  const listed = await gitOut($, ['worktree', 'list', '--porcelain'], main, 'Could not list worktrees.')
  const paths = new Map<string, string | null>()
  let path: string | null = null
  for (const line of listed.split('\n')) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length)
      paths.set(path, null)
    } else if (line.startsWith('branch ') && path !== null) {
      paths.set(path, line.slice('branch refs/heads/'.length))
    }
  }
  return paths
}

async function slotDirs($: $, repoDir: string): Promise<string[]> {
  if (!(await $.fs.exists(repoDir))) return []
  const entries = await $.fs.list(repoDir)
  return entries
    .filter(entry => entry.kind === 'dir' && /^\d+$/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => Number(a) - Number(b))
    .map(name => `${repoDir}/${name}`)
}

async function refreshSlots($: $, options: PluginOptions): Promise<void> {
  const { main, path: mine } = await read($, worktree)
  if (main === null) return
  const repoDir = await slotsRoot($, options, main)
  const listed = await worktreePaths($, main)
  const found: Slot[] = []
  for (const path of await slotDirs($, repoDir)) {
    const real = await realPath($, path)
    if (!listed.has(real)) continue
    const lease = await readLease($, path)
    found.push({
      path,
      branch: listed.get(real) ?? null,
      isLeased: await isLeaseLive($, lease),
      isMine: path === mine,
    })
  }
  await update($, slots, () => found)
}

async function releaseSlot($: $, path: string): Promise<void> {
  await $.store.delete(LEASE_PREFIX + path)
}

async function claimSlot($: $, options: PluginOptions, main: string, base: string, branch: string) {
  const repoDir = await slotsRoot($, options, main)
  const listed = await worktreePaths($, main)
  const sessionId = await $.session.id()
  const dirs = await slotDirs($, repoDir)

  for (const path of dirs) {
    if (!listed.has(await realPath($, path))) continue
    const lease = await readLease($, path)
    if (lease?.sessionId !== sessionId && (await isLeaseLive($, lease))) continue
    const status = await git($, ['status', '--porcelain'], path)
    if (status.exitCode !== 0 || status.stdout.trim() !== '') continue

    await writeLease($, path)
    await setStep($, `Reusing slot ${path.split('/').pop()}`)
    await gitOut($, ['checkout', '-q', '-B', branch, base], path, 'Could not check out the base branch in the reused slot.')
    return path
  }

  const next = dirs.reduce((most, path) => Math.max(most, Number(path.split('/').pop())), 0) + 1
  const path = `${repoDir}/${next}`
  await writeLease($, path)
  await setStep($, 'Creating a new worktree')
  await gitOut($, ['worktree', 'add', '-q', '-B', branch, path, base], main, 'Could not create the worktree.')
  return path
}

async function seedDependencies($: $, options: PluginOptions, main: string, path: string) {
  if ((await $.fs.exists(`${main}/node_modules`)) && !(await $.fs.exists(`${path}/node_modules`))) {
    for (const lockfile of LOCKFILES) {
      if (!(await $.fs.exists(`${main}/${lockfile}`))) continue
      const same = await $.process.run(['cmp', '-s', `${main}/${lockfile}`, `${path}/${lockfile}`])
      if (same.exitCode !== 0) break
      await setStep($, 'Cloning node_modules from the main checkout')
      // cp -c asks APFS for a clonefile copy, so a large node_modules costs
      // no disk until a file in it changes.
      const copied = await $.process.run(['cp', '-c', '-R', `${main}/node_modules`, `${path}/node_modules`], {
        timeoutMs: SETUP_TIMEOUT_MS,
      })
      if (copied.exitCode !== 0) {
        $.ui.log(`cp -c failed: ${copied.stderr.trim()}`, { to: 'debug' })
        await setStep($, 'Could not clone node_modules; the setup command has to install them', true)
      }
      break
    }
  }

  const setup = String(options.setupCommand ?? '').trim()
  if (setup === '') return
  await setStep($, `Running ${setup}`)
  const ran = await $.process.run(['/bin/bash', '-lc', setup], { cwd: path, timeoutMs: SETUP_TIMEOUT_MS })
  if (ran.exitCode !== 0) {
    $.ui.log(`setup command failed: ${ran.stderr.trim()}`, { to: 'debug' })
    throw new StepError(`The setup command exited with ${ran.exitCode}.`)
  }
}

async function defaultBranch($: $, main: string): Promise<string> {
  const head = await git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], main)
  if (head.exitCode === 0) return head.stdout.trim().replace(/^origin\//, '')
  return gitOut($, ['rev-parse', '--abbrev-ref', 'HEAD'], main, 'Could not read the current branch.')
}

// Held by the module, not $.state: a reload runs session.start again, which
// restarts prepare() and its heartbeat.
let isEnterPending = false
let heartbeat: Timer | null = null

function startHeartbeat($: $, path: string): void {
  heartbeat?.cancel()
  heartbeat = $.clock.every(HEARTBEAT_MS, () => void writeLease($, path))
}

async function fail($: $, error: unknown): Promise<void> {
  const message = error instanceof StepError ? error.message : 'Something went wrong while preparing the worktree.'
  if (!(error instanceof StepError)) $.ui.log(`prepare failed: ${String(error)}`, { to: 'debug' })
  await update($, worktree, (current): Worktree => ({ ...current, phase: 'failed', step: message, error: message }))
}

async function enter($: $, options: PluginOptions): Promise<void> {
  const { path, branch } = await read($, worktree)
  if (path === null || branch === null) return
  isEnterPending = false
  const entered = await $.tool.call({ tool: 'EnterWorktree', path })
  if (entered.deny !== undefined || entered.isError === true) {
    $.ui.log(`EnterWorktree refused: ${entered.deny ?? entered.text ?? ''}`, { to: 'debug' })
    await fail($, new StepError('Claude Code would not move the session into the worktree.'))
    return
  }
  await setStep($, 'Worktree ready')
  await update($, worktree, (current): Worktree => ({ ...current, phase: 'ready', error: null }))
  await refreshSlots($, options)
  if (await read($, isHeadStartPrompted)) {
    await update($, isHeadStartPrompted, () => false)
    await $.prompt.submit({ text: continueNote(path, branch) })
  }
}

async function prepare($: $, options: PluginOptions): Promise<void> {
  const { main } = await read($, worktree)
  if (main === null) return
  try {
    const branchName = await defaultBranch($, main)
    await setStep($, `Fetching the latest origin/${branchName}`)
    let base = `origin/${branchName}`
    const fetched = await git($, ['fetch', '-q', 'origin', branchName], main)
    if (fetched.exitCode !== 0) {
      base = branchName
      await setStep($, `Could not fetch origin; starting from the local ${branchName}`, true)
    }
    const baseSha = await gitOut($, ['rev-parse', base], main, `Could not resolve ${base}.`)
    const branch = `craft/${(await $.session.id()).slice(0, 6)}`
    await update($, worktree, current => ({ ...current, base, baseSha, branch }))

    await setStep($, 'Claiming a slot')
    const path = await claimSlot($, options, main, base, branch)
    await update($, worktree, current => ({ ...current, path }))
    startHeartbeat($, path)
    await seedDependencies($, options, main, path)
    await refreshSlots($, options)

    if (await read($, isTurnRunning)) {
      isEnterPending = true
      await setStep($, 'Ready; moving in when this turn ends')
    } else {
      await enter($, options)
    }
  } catch (error) {
    await fail($, error)
  }
}

async function beginWorktree($: $, options: PluginOptions): Promise<void> {
  await update($, worktree, (current): Worktree => ({ ...current, phase: 'preparing', step: 'Starting', steps: [], error: null }))
  await update($, isBandHidden, () => false)
  $.clock.after(0, () => void prepare($, options))
}

const PHASE: Record<WorktreePhase, { label: string; color: string }> = {
  off: { label: 'Off', color: 'inactive' },
  preparing: { label: 'Preparing (read-only)', color: 'warning' },
  ready: { label: 'Ready', color: 'success' },
  failed: { label: 'Failed (read-only)', color: 'error' },
}

// A pane opened unasked is a sidebar only where the surface docks one, which
// a render's viewport says and session.start does not.
let hasAutoOpened = false

export function registerWorktree(on: On, options: PluginOptions): void {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    const current = await read($, worktree)
    if (current.phase === 'ready' && current.path !== null) {
      startHeartbeat($, current.path)
      return started
    }
    if (current.phase === 'preparing') {
      await beginWorktree($, options)
      return started
    }
    if (options.autoWorktree === false) return started

    const repo = await $.session.repo()
    if (repo === null) return started
    const top = await git($, ['rev-parse', '--show-toplevel'], e.cwd)
    if (top.exitCode !== 0) return started
    const main = await realPath($, top.stdout.trim())
    if (main !== (await realPath($, repo.root))) return started

    await update($, worktree, now => ({ ...now, main }))
    await beginWorktree($, options)
    return started
  })

  on('session.end', async ($, e, next) => {
    heartbeat?.cancel()
    const { path } = await read($, worktree)
    if (path !== null) await releaseSlot($, path)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, isTurnRunning, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    await update($, isTurnRunning, () => false)
    if ((await read($, worktree)).phase === 'ready') await update($, isBandHidden, () => true)
    if (isEnterPending) $.clock.after(0, () => void enter($, options))
    return done
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    $.clock.after(0, () => void refreshSlots($, options))
    return opened
  })

  on('ui.press', { plugin: 'craft-shop', element: 'tab-worktree' }, async ($, e, next) => {
    const pressed = await next(e)
    await refreshSlots($, options)
    return pressed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen === true && !hasAutoOpened) {
      hasAutoOpened = true
      $.clock.after(0, () => void $.ui.open({ id: PANE, title: PANE_TITLE }))
    }
    const state = await read($, worktree)
    if (e.props.hasSurvey || state.phase === 'off' || (await read($, isBandHidden))) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    if (state.phase === 'preparing') {
      return (
        <Text wrap="truncate-end">
          <Text color="warning" bold>Read-only until the worktree is ready</Text>
          <Text dimColor> · {state.step}</Text>
        </Text>
      )
    }
    if (state.phase === 'failed') {
      return (
        <Box gap={1}>
          <Text wrap="truncate-end">
            <Text color="error" bold>Worktree failed, still read-only</Text>
            <Text dimColor> · {state.error}</Text>
          </Text>
          <Button key="worktree-retry" label="Retry" variant="primary" onPress={() => void beginWorktree($, options)} />
        </Box>
      )
    }
    return (
      <Box gap={1}>
        <Text wrap="truncate-end">
          <Text color="success" bold>Worktree ready</Text>
          <Text dimColor> · {state.branch}</Text>
        </Text>
        <Button key="band-hide" label="Hide" dimColor onPress={() => void update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, tab)) !== 'worktree') return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const state = await read($, worktree)
    const list = await read($, slots)
    const phase = PHASE[state.phase]
    const first = state.steps[0]?.at ?? 0
    const select = (id: Tab) => void update($, tab, () => id)

    if (state.phase === 'off') {
      return frame(
        ui,
        'worktree',
        e.props.bodyColumns,
        select,
        <Box flexDirection="column">
          <Text dimColor>No worktree for this session.</Text>
          <Text dimColor>
            Craft Shop claims one when a session starts in a repository's main checkout with autoWorktree on.
          </Text>
        </Box>,
      )
    }

    return frame(
      ui,
      'worktree',
      e.props.bodyColumns,
      select,
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            <Text color={phase.color} bold>● {phase.label}</Text>
            <Text dimColor> · {state.step}</Text>
          </Text>
          {state.steps.map(step => (
            <Text color={step.isWarning ? 'warning' : undefined} dimColor={!step.isWarning}>
              {`+${((step.at - first) / 1000).toFixed(1)}s`.padEnd(8)}
              {step.label}
            </Text>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text wrap="truncate-start">
            <Text dimColor>Main     </Text>
            {state.main ?? '–'}
          </Text>
          <Text wrap="truncate-start">
            <Text dimColor>Slot     </Text>
            {state.path ?? '–'}
          </Text>
          <Text>
            <Text dimColor>Branch   </Text>
            {state.branch ?? '–'}
          </Text>
          <Text>
            <Text dimColor>Base     </Text>
            {state.base ?? '–'}
            {state.baseSha === null ? '' : ` @ ${state.baseSha.slice(0, 7)}`}
          </Text>
        </Box>

        <Box gap={1}>
          <Button key="slots-refresh" label="Refresh" hotkey="r" onPress={() => void refreshSlots($, options)} />
          {state.phase === 'failed' && (
            <Button key="worktree-retry" label="Retry" variant="primary" onPress={() => void beginWorktree($, options)} />
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Slots</Text>
          {list.length === 0 && <Text dimColor>No slots yet.</Text>}
          {list.map(slot => (
            <Box flexDirection="column">
              <Text>
                <Text bold>#{slot.path.split('/').pop()}</Text> {slot.branch ?? 'detached'}{' '}
                <Text color={slot.isMine ? 'success' : slot.isLeased ? 'warning' : 'inactive'}>
                  {slot.isMine ? 'this session' : slot.isLeased ? 'leased' : 'free'}
                </Text>
              </Text>
              <Box gap={1}>
                <Button
                  key={`slot-copy-${slot.path}`}
                  label="Copy path"
                  dimColor
                  onPress={press => void $.ui.copy({ text: slot.path, surface: press.surface })}
                />
                {slot.isLeased && !slot.isMine && (
                  <Button
                    key={`slot-release-${slot.path}`}
                    label="Release"
                    dimColor
                    onPress={() => void releaseAndRefresh($, slot.path, options)}
                  />
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>,
    )
  })
}

async function releaseAndRefresh($: $, path: string, options: PluginOptions): Promise<void> {
  await releaseSlot($, path)
  await refreshSlots($, options)
}

// Auto-claims a worktree slot for a session started in a main checkout, a
// simplified port of CommissionAI's head start (service/src/threads.rs) and
// slots (worktrees.rs). Until the slot is ready the session runs read-only
// in the main checkout (see guard.ts). This file also draws the band above
// the prompt and the pane's Worktree tab.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, Timer } from 'claude-code'

import type { Slot, Tab, Worktree, WorktreePhase } from '../types'
import { frame, PANE, PANE_TITLE, resolveUi } from './ui'
import type { Ui } from './ui'
import { BALANCED, presetName } from './dials'
import { switchArt } from './art'
import { branchArt, card, drawnButton, label, segmented, svg } from './kit'
import { drawRail } from './rail'

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

const isBandHidden = atom({ plugin: 'fishstack', key: 'isBandHidden' } as const, false)
const isHeadStartPrompted = atom({ plugin: 'fishstack', key: 'isHeadStartPrompted' } as const, false)
const isTurnRunning = atom({ plugin: 'fishstack', key: 'isTurnRunning' } as const, false)
const slots = atom({ plugin: 'fishstack', key: 'slots' } as const, [])
const tab = atom({ plugin: 'fishstack', key: 'tab' } as const, 'worktree')
const worktree = atom({ plugin: 'fishstack', key: 'worktree' } as const, IDLE_WORKTREE)
const isStepsShown = atom({ plugin: 'fishstack', key: 'isStepsShown' } as const, false)
const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const sources = atom({ plugin: 'fishstack', key: 'sources' } as const, [])
const lastReplyAt = atom({ plugin: 'fishstack', key: 'lastReplyAt' } as const, null)
// The rail pill under the pointer, kept to this process: a hover is one
// window's, not the session's.
let railHover: string | null = null
// Bumped by a rail hover and the cache gauge's tick; only the band reads it,
// so neither redraws the pane.
const railTick = atom({ plugin: 'fishstack', key: 'railTick' } as const, 0)
// The rail's figures for one session, kept in the store under one key.
const RAIL_STORE_KEY = 'rail'
type RailKept = { sessionId: string; repliedAt: number | null; tokens: { input: number; output: number } | null }
// The worktree this session works in when it is not ours to manage (another
// tool's, or one made by hand); null in the main checkout or a slot of ours.
const elsewhere = atom({ plugin: 'fishstack', key: 'elsewhere' } as const, null)
// What the pool's background warming is doing, for the Worktrees tab.
const poolNote = atom({ plugin: 'fishstack', key: 'poolNote' } as const, '')
const tokenTotals = atom({ plugin: 'fishstack', key: 'tokenTotals' } as const, null)
// Autopilot answering for a person who is away (session.ts sets it).
const autopilot = atom({ plugin: 'fishstack', key: 'autopilot' } as const, null)

type $ = EngineInterface

const LEASE_PREFIX = 'lease:'
const HEARTBEAT_MS = 60_000
const LEASE_TTL_MS = 3 * HEARTBEAT_MS
const SETUP_TIMEOUT_MS = 10 * 60_000
const LOCK_STALE_MS = 30_000
// As CommissionAI's: three slots ready, and no warming below 20 GB free
// (the minFreeGb option).
export const POOL_SIZE = 3
const DEFAULT_MIN_FREE_GB = 20
const SETUP_PREFIX = 'setup:'
type SetupRun = { command: string; lockHash: string }
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']

export const READ_ONLY_DENY =
  'Read-only until the worktree is ready. fishStack is preparing a worktree for this session; read, search and plan for now, and you will be moved there with full access.'

export function headStartNote(main: string): string {
  return `Read-only head start: your worktree is still being prepared, so for now you run read-only in the main checkout at \`${main}\`. It may sit on another branch or be behind origin, so treat it as a reference. Investigate, read code and plan; do not edit files, commit or run commands that change anything. When your plan is ready, write it in your reply and end your turn. When the worktree is ready, fishStack moves you there with full access and tells you to continue.`
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
  const root = await expandHome($, String(options.worktreeRoot || '~/.fishstack/worktrees'))
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

// The numbered slot folders under a repository's slot root, in order.
async function slotDirs($: $, repoDir: string): Promise<string[]> {
  const found = await $.process.run(['find', repoDir, '-mindepth', '1', '-maxdepth', '1', '-type', 'd'])
  if (found.exitCode !== 0) return []
  return found.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => /\/\d+$/.test(line))
    .sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()))
}

async function refreshSlots($: $, options: PluginOptions): Promise<void> {
  const main = (await read($, worktree)).main ?? (await repoMain($))
  if (main !== null) await refreshSlotsFor($, options, main)
}

// The main checkout of the session's repository, or null outside one: the
// folder holding the repository's .git, so a session working in a linked
// worktree finds the same pool as one in the main checkout.
async function repoMain($: $): Promise<string | null> {
  const repo = await $.session.repo()
  if (repo === null) return null
  const common = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], repo.root)
  const dir = common.stdout.trim()
  return realPath($, common.exitCode === 0 && dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : repo.root)
}

async function refreshSlotsFor($: $, options: PluginOptions, main: string): Promise<void> {
  const { path: mine } = await read($, worktree)
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

// A git write: never runs the repository's hooks, as CommissionAI's do not.
async function gitWrite($: $, args: string[], cwd: string, failure: string): Promise<string> {
  return gitOut($, ['-c', 'core.hooksPath=/dev/null', ...args], cwd, failure)
}

// One claim at a time per repository, across sessions: an atomic mkdir, and a
// lock older than LOCK_STALE_MS (a session that died holding it) is broken.
async function lock($: $, repoDir: string): Promise<void> {
  await $.process.run(['mkdir', '-p', repoDir])
  const lockDir = `${repoDir}/.lock`
  for (let tries = 0; tries < 300; tries++) {
    if ((await $.process.run(['mkdir', lockDir])).exitCode === 0) return
    const held = await $.fs.stat(lockDir).catch(() => null)
    if (held === null || (await $.clock.now()) - held.mtimeMs > LOCK_STALE_MS) {
      await $.process.run(['rm', '-rf', lockDir])
      continue
    }
    await $.clock.sleep(100)
  }
  throw new StepError('Another session held the worktree lock for too long.')
}

async function unlock($: $, repoDir: string): Promise<void> {
  await $.process.run(['rm', '-rf', `${repoDir}/.lock`])
}

// A fresh slot as CommissionAI makes one: detached and unchecked-out at the
// base, then checked out with stat checks kept minimal, then the index warmed
// so the session's first git status is quick.
async function createSlot($: $, main: string, path: string, sha: string): Promise<void> {
  await git($, ['worktree', 'prune'], main)
  await gitWrite($, ['worktree', 'add', '-q', '--detach', '--no-checkout', path, sha], main, 'Could not create the worktree.')
  await gitWrite($, ['-c', 'core.checkStat=minimal', 'reset', '--hard', '-q'], path, 'Could not check out the new worktree.')
  await git($, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], path)
}

// Readies a used slot for its next session: anything left uncommitted is kept
// under refs/fish/backup/, then the slot is reset, cleaned (ignored files such
// as node_modules stay) and detached, which frees its old branch.
async function scrubSlot($: $, path: string): Promise<void> {
  const status = await git($, ['status', '--porcelain'], path)
  if (status.exitCode === 0 && status.stdout.trim() !== '') {
    await gitWrite($, ['add', '-A'], path, 'Could not save the slot\'s leftover work.')
    const stash = await git($, ['stash', 'create'], path)
    const sha = stash.stdout.trim()
    if (stash.exitCode === 0 && sha !== '') {
      await gitWrite($, ['update-ref', `refs/fish/backup/${path.split('/').pop()}-${await $.clock.now()}`, sha], path, 'Could not back up the slot\'s leftover work.')
    }
  }
  await gitWrite($, ['reset', '--hard', '-q'], path, 'Could not reset the slot.')
  await gitWrite($, ['clean', '-fdq'], path, 'Could not clean the slot.')
  await gitWrite($, ['checkout', '-q', '--detach', 'HEAD'], path, 'Could not detach the slot.')
}

// Picks a slot under the lock: an idle one (listed, no live lease) or the next
// number, reserved by its empty folder. Leased before the lock lifts.
async function pickSlot($: $, options: PluginOptions, main: string): Promise<{ path: string; isNew: boolean }> {
  const repoDir = await slotsRoot($, options, main)
  await lock($, repoDir)
  try {
    const listed = await worktreePaths($, main)
    const sessionId = await $.session.id()
    const dirs = await slotDirs($, repoDir)
    for (const path of dirs) {
      if (!listed.has(await realPath($, path))) continue
      const lease = await readLease($, path)
      if (lease?.sessionId !== sessionId && (await isLeaseLive($, lease))) continue
      await writeLease($, path)
      return { path, isNew: false }
    }
    const next = dirs.reduce((most, path) => Math.max(most, Number(path.split('/').pop())), 0) + 1
    const path = `${repoDir}/${next}`
    await $.process.run(['mkdir', '-p', path])
    await writeLease($, path)
    return { path, isNew: true }
  } finally {
    await unlock($, repoDir)
  }
}

async function claimSlot($: $, options: PluginOptions, main: string, base: string, baseSha: string, branch: string) {
  const { path, isNew } = await pickSlot($, options, main)
  if (isNew) {
    await setStep($, 'Creating a new worktree')
    await createSlot($, main, path, baseSha)
  } else {
    await setStep($, `Reusing slot ${path.split('/').pop()}`)
    await scrubSlot($, path)
  }
  await gitWrite($, ['checkout', '-q', '-B', branch, base], path, 'Could not check out the base branch in the slot.')
  return path
}

// What the dependencies are pinned to: the git hashes of the lockfiles there.
async function lockHash($: $, dir: string): Promise<string> {
  const parts: string[] = []
  for (const lockfile of LOCKFILES) {
    if (!(await $.fs.exists(`${dir}/${lockfile}`))) continue
    const hashed = await git($, ['hash-object', lockfile], dir)
    parts.push(`${lockfile}:${hashed.stdout.trim()}`)
  }
  return parts.join(',')
}

// Every node_modules under a folder, six deep at most, skipping dot folders
// and build output; relative paths.
async function nodeModulesIn($: $, dir: string): Promise<string[]> {
  const found = await $.process.run(
    ['find', dir, '-maxdepth', '6', '(', '-name', '.*', '-o', '-name', 'target', ')', '-prune', '-o', '-type', 'd', '-name', 'node_modules', '-print', '-prune'],
    { timeoutMs: 60_000 },
  )
  if (found.exitCode !== 0) return []
  return found.stdout
    .split('\n')
    .filter(line => line.startsWith(`${dir}/`))
    .map(line => line.slice(dir.length + 1))
}

// Seeds a slot's node_modules as CommissionAI does: cloned copy-on-write (APFS
// clonefile through cp -c, so it costs no disk until a file changes) from an
// idle sibling slot pinned to the same lockfiles, or else the main checkout,
// into a staging folder renamed into place. Then the setup command, skipped
// when it and the lockfiles are what it last ran with in this slot.
// What seeding says as it goes: a session's claim logs each step for its
// band and stepper; the pool's warming says nothing there, as no session
// waits on it.
type Report = (label: string, isWarning?: boolean) => Promise<void>
const SILENT: Report = async () => undefined

async function seedDependencies($: $, options: PluginOptions, main: string, path: string, report: Report) {
  const hash = await lockHash($, path)
  if (hash !== '') {
    let donor: string | null = null
    const repoDir = await slotsRoot($, options, main)
    for (const sibling of await slotDirs($, repoDir)) {
      if (sibling === path || (await isLeaseLive($, await readLease($, sibling)))) continue
      if ((await $.fs.exists(`${sibling}/node_modules`)) && (await lockHash($, sibling)) === hash) {
        donor = sibling
        break
      }
    }
    if (donor === null && (await $.fs.exists(`${main}/node_modules`)) && (await lockHash($, main)) === hash) donor = main
    if (donor !== null) {
      const missing: string[] = []
      for (const relative of await nodeModulesIn($, donor)) {
        if (!(await $.fs.exists(`${path}/${relative}`))) missing.push(relative)
      }
      if (missing.length > 0) {
        await report(`Cloning ${missing.length === 1 ? 'node_modules' : `${missing.length} node_modules folders`} from ${donor === main ? 'the main checkout' : `slot ${donor.split('/').pop()}`}`)
        for (const [index, relative] of missing.entries()) {
          const target = `${path}/${relative}`
          const staging = `${path}/.fish-seed-${index}`
          await $.process.run(['mkdir', '-p', target.slice(0, target.lastIndexOf('/'))])
          const copied = await $.process.run(['cp', '-c', '-p', '-R', `${donor}/${relative}`, staging], { timeoutMs: SETUP_TIMEOUT_MS })
          if (copied.exitCode !== 0) {
            $.ui.log(`cp -c failed: ${copied.stderr.trim()}`, { to: 'debug' })
            await $.process.run(['rm', '-rf', staging])
            await report('Could not clone node_modules; the setup command has to install them', true)
            break
          }
          await $.process.run(['mv', staging, target])
        }
      }
    }
  }

  const setup = String(options.setupCommand ?? '').trim()
  if (setup === '') return
  const last = await $.store.get(SETUP_PREFIX + path)
  if (last !== null && typeof last === 'object' && (last as SetupRun).command === setup && (last as SetupRun).lockHash === hash) {
    await report('Setup already done for these lockfiles')
    return
  }
  await report(`Running ${setup}`)
  const ran = await $.process.run(['/bin/bash', '-lc', setup], { cwd: path, timeoutMs: SETUP_TIMEOUT_MS })
  if (ran.exitCode !== 0) {
    $.ui.log(`setup command failed: ${ran.stderr.trim()}`, { to: 'debug' })
    throw new StepError(`The setup command exited with ${ran.exitCode}.`)
  }
  await $.store.set(SETUP_PREFIX + path, { command: setup, lockHash: hash })
}

// Free disk where the slots live, in kilobytes; Infinity when df cannot say.
async function freeKb($: $, dir: string): Promise<number> {
  const df = await $.process.run(['df', '-Pk', dir])
  const columns = df.stdout.trim().split('\n').pop()?.split(/\s+/) ?? []
  const available = Number(columns[3])
  return df.exitCode === 0 && Number.isFinite(available) ? available : Infinity
}

// Keeps the pool warm, as CommissionAI does: at least POOL_SIZE slots, at
// least one of them idle, each made, seeded and set up ahead of any session,
// one at a time in the background. Pauses below minFreeGb of free disk, and
// says so in the tab.
let isWarming = false
// A top-up asked for while one runs: run once more when it ends, as a claim
// made meanwhile may have taken the spare it was counting on.
let isWarmAgain = false
// Slots asked for beyond the pool's size by Warm one more, in this process:
// the warming makes at least this many, then forgets it.
let warmTo = 0
async function prewarm($: $, options: PluginOptions, main: string): Promise<void> {
  if (isWarming) {
    isWarmAgain = true
    return
  }
  isWarming = true
  try {
    const repoDir = await slotsRoot($, options, main)
    const branchName = await defaultBranch($, main)
    const fetched = await git($, ['fetch', '-q', 'origin', branchName], main)
    const sha = await gitOut($, ['rev-parse', fetched.exitCode === 0 ? `origin/${branchName}` : branchName], main, 'Could not resolve the base.')
    const minFreeGb = Number(options.minFreeGb ?? DEFAULT_MIN_FREE_GB)
    let note = ''
    for (let made = 0; made < Math.max(POOL_SIZE, warmTo); made++) {
      const listed = await worktreePaths($, main)
      let total = 0
      let idle = 0
      for (const path of await slotDirs($, repoDir)) {
        if (!listed.has(await realPath($, path))) continue
        total++
        if (!(await isLeaseLive($, await readLease($, path)))) idle++
      }
      if (total >= Math.max(POOL_SIZE, warmTo) && idle >= 1) {
        warmTo = 0
        break
      }
      await $.process.run(['mkdir', '-p', repoDir])
      const free = await freeKb($, repoDir)
      if (free < minFreeGb * 1024 * 1024) {
        note = `Paused: ${(free / 1024 / 1024).toFixed(1)} GB of disk free, under the ${minFreeGb} GB it keeps.`
        break
      }
      await lock($, repoDir)
      let path: string
      try {
        const dirs = await slotDirs($, repoDir)
        path = `${repoDir}/${dirs.reduce((most, one) => Math.max(most, Number(one.split('/').pop())), 0) + 1}`
        await $.process.run(['mkdir', '-p', path])
      } finally {
        await unlock($, repoDir)
      }
      await update($, poolNote, () => `Warming slot ${path.split('/').pop()} of ${Math.max(POOL_SIZE, warmTo, total + 1)}…`)
      await createSlot($, main, path, sha)
      await seedDependencies($, options, main, path, SILENT)
      await refreshSlotsFor($, options, main)
    }
    await update($, poolNote, () => note)
  } catch (error) {
    $.ui.log(`prewarm stopped: ${String(error)}`, { to: 'debug' })
    await update($, poolNote, () => (error instanceof StepError ? `Warming stopped: ${error.message}` : 'Warming stopped.'))
  } finally {
    isWarming = false
    if (isWarmAgain) {
      isWarmAgain = false
      $.clock.after(0, () => void prewarm($, options, main))
    }
  }
}

async function defaultBranch($: $, main: string): Promise<string> {
  const head = await git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], main)
  if (head.exitCode === 0) return head.stdout.trim().replace(/^origin\//, '')
  return gitOut($, ['rev-parse', '--abbrev-ref', 'HEAD'], main, 'Could not read the current branch.')
}

// Held by the module, not $.state: a reload runs session.start again, which
// restarts prepare() and its heartbeat.
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
  // Claude Code may ask the person to confirm the move: the stepper says
  // where things stand meanwhile.
  await setStep($, 'Moving the session in')
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
    const branch = `fish/${adoptedName ?? (await $.session.id()).slice(0, 6)}`
    await update($, worktree, current => ({ ...current, base, baseSha, branch }))

    await setStep($, 'Claiming a slot')
    const path = await claimSlot($, options, main, base, baseSha, branch)
    await update($, worktree, current => ({ ...current, path }))
    startHeartbeat($, path)
    await seedDependencies($, options, main, path, (label, isWarning) => setStep($, label, isWarning))
    await refreshSlots($, options)
    $.clock.after(0, () => void prewarm($, options, main))

    await enter($, options)
  } catch (error) {
    await fail($, error)
  }
}

async function beginWorktree($: $, options: PluginOptions): Promise<void> {
  await update($, worktree, (current): Worktree => ({ ...current, phase: 'preparing', step: 'Starting', steps: [], error: null }))
  await update($, isBandHidden, () => false)
  $.clock.after(0, () => void prepare($, options))
}

const AUTO_CHOICES = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
] as const

const PHASE: Record<WorktreePhase, { label: string; color: string }> = {
  off: { label: 'Off', color: 'inactive' },
  preparing: { label: 'Preparing (read-only)', color: 'warning' },
  ready: { label: 'Ready', color: 'success' },
  failed: { label: 'Failed (read-only)', color: 'error' },
}

// A pane opened unasked is a sidebar only where the surface docks one, which
// a render's viewport says and session.start does not.
let hasAutoOpened = false

// Claims a slot once per load, for the first person at the session: a REPL
// at session.start, or the desktop app or an editor attaching (they run the
// session headless, so its session.start says no one is at the prompt).
let hasStarted = false
// Where the session worked as a /clear ended it, for the session after.
let carried: { worktree: Worktree; elsewhere: string | null; isBandHidden: boolean } | null = null

// After a /clear: the session that follows works where the last one did,
// in the same slot, its lease kept alive from here.
async function carryOverClear($: $): Promise<void> {
  if (carried === null) return
  const { worktree: was, elsewhere: where, isBandHidden: wasHidden } = carried
  carried = null
  await update($, worktree, () => was)
  await update($, elsewhere, () => where)
  await update($, isBandHidden, () => wasHidden)
  if (was.phase === 'ready' && was.path !== null) startHeartbeat($, was.path)
}

export const AUTO_WORKTREE_KEY = 'autoWorktree'

// The Worktrees tab's toggle, kept across sessions; until it is pressed,
// the autoWorktree option decides, off unless set.
// Warm one more: one slot past what the pool holds now, made in the
// background like the rest, behind the same disk guard.
async function warmOneMore($: $, options: PluginOptions, count: number): Promise<void> {
  const main = (await read($, worktree)).main ?? (await repoMain($))
  if (main === null) return
  warmTo = Math.max(warmTo, count + 1)
  await prewarm($, options, main)
}

async function isAutoOn($: $, options: PluginOptions): Promise<boolean> {
  const stored = await $.store.get(AUTO_WORKTREE_KEY)
  return typeof stored === 'boolean' ? stored : options.autoWorktree === true
}

async function setAuto($: $, options: PluginOptions, isOn: boolean): Promise<void> {
  await $.store.set(AUTO_WORKTREE_KEY, isOn)
  $.ui.invalidate('ui.render')
  if (!isOn) return
  const main = (await read($, worktree)).main ?? (await repoMain($))
  if (main !== null) $.clock.after(0, () => void prewarm($, options, main))
}

async function startWorktree($: $, options: PluginOptions, cwd: string, isForced = false): Promise<void> {
  if (hasStarted) return
  hasStarted = true
  const current = await read($, worktree)
  // On, the pool is checked at every load: a reload stops a warming run
  // midway, and a pool left short by other sessions tops up here.
  if (await isAutoOn($, options)) {
    const poolMain = current.main ?? (await repoMain($))
    if (poolMain !== null) $.clock.after(0, () => void prewarm($, options, poolMain))
  }
  if (current.phase === 'ready' && current.path !== null) {
    startHeartbeat($, current.path)
    return
  }
  if (current.phase === 'preparing') {
    await beginWorktree($, options)
    return
  }
  const repo = await $.session.repo()
  if (repo === null) return
  const top = await git($, ['rev-parse', '--show-toplevel'], cwd)
  if (top.exitCode !== 0) return
  const here = await realPath($, top.stdout.trim())
  // The main checkout is where the repository's .git lives; a worktree's
  // top level is not it.
  const common = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  const commonDir = common.stdout.trim()
  const main = common.exitCode === 0 && commonDir.endsWith('/.git') ? await realPath($, commonDir.slice(0, -'/.git'.length)) : here

  // Already in one of our slots (a session carried on there, or started
  // there): it is this session's, ready, whatever the toggle says.
  if (here !== main) {
    const repoDir = await slotsRoot($, options, main)
    const realDir = await realPath($, repoDir).catch(() => repoDir)
    const inside = [realDir, repoDir].find(dir => here.startsWith(`${dir}/`))
    if (inside !== undefined) {
      const path = `${repoDir}${here.slice(inside.length)}`
      const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], here)).stdout.trim() || null
      const at = await $.clock.now()
      await update($, worktree, (): Worktree => ({ ...IDLE_WORKTREE, phase: 'ready', main, path, branch, step: 'Carried on in this slot', steps: [{ label: 'Carried on in this slot', at, isWarning: false }] }))
      await writeLease($, path)
      startHeartbeat($, path)
      await refreshSlots($, options)
      return
    }
  }

  // Off, fishStack stays out of the way: no slot, no read-only guard, and
  // Claude Code's own worktree handling applies.
  if (!isForced && !(await isAutoOn($, options))) {
    if (here !== main) await update($, elsewhere, () => here)
    return
  }

  if (here !== main) {
    // A worktree Claude Code made itself (claude --worktree, the desktop's
    // worktree option): those are made before any mod loads, so its
    // WorktreeCreate never reaches fishStack. Adopt it: a slot on its name,
    // read-only until the slot is ready, then the session moves in. Any
    // other worktree (a slot of ours among them) is left as it is.
    if (!here.startsWith(`${main}/.claude/worktrees/`)) {
      await update($, elsewhere, () => here)
      return
    }
    adoptedName = here.split('/').pop()!.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)
  } else if (main !== (await realPath($, repo.root))) {
    return
  }

  await update($, worktree, now => ({ ...now, main }))
  await beginWorktree($, options)
}

// The name of the Claude Code worktree this session started in, which its
// slot's branch takes; null for a session started in the main checkout.
let adoptedName: string | null = null

// The empty state's button: claims a slot now, whether the toggle is on or off.
async function claimNow($: $, options: PluginOptions): Promise<void> {
  hasStarted = false
  await startWorktree($, options, await $.session.cwd(), true)
  if ((await read($, worktree)).phase === 'off') {
    const other = await read($, elsewhere)
    await $.ui.toast(other === null ? "No worktree: this session isn't in a git repository." : `This session already works in a worktree fishStack does not manage: ${other}`)
  }
}

// Answers Claude Code's own worktree creation (claude --worktree, EnterWorktree
// with a name) with a slot: claimed at once so the session can enter it, then
// seeded while the session stays read-only. Null hands creation back.
async function claimForCreate($: $, options: PluginOptions, cwd: string, name: string): Promise<string | null> {
  try {
    const top = await gitOut($, ['rev-parse', '--show-toplevel'], cwd, 'Not inside a repository.')
    const repo = await $.session.repo()
    const main = await realPath($, repo?.root ?? top)
    const branchName = await defaultBranch($, main)
    const fetched = await git($, ['fetch', '-q', 'origin', branchName], main)
    const base = fetched.exitCode === 0 ? `origin/${branchName}` : branchName
    const baseSha = await gitOut($, ['rev-parse', base], main, `Could not resolve ${base}.`)
    const branch = `fish/${name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || (await $.session.id()).slice(0, 6)}`
    hasStarted = true
    await update($, worktree, (): Worktree => ({ ...IDLE_WORKTREE, phase: 'preparing', step: 'Claiming a slot', main, base, baseSha, branch }))
    const path = await claimSlot($, options, main, base, baseSha, branch)
    await update($, worktree, current => ({ ...current, path }))
    startHeartbeat($, path)
    $.clock.after(0, () => void seedThenUnlock($, options, main, path))
    $.clock.after(0, () => void prewarm($, options, main))
    return path
  } catch (error) {
    $.ui.log(`WorktreeCreate fell back to Claude Code: ${String(error)}`, { to: 'debug' })
    await update($, worktree, () => IDLE_WORKTREE)
    return null
  }
}

async function seedThenUnlock($: $, options: PluginOptions, main: string, path: string): Promise<void> {
  try {
    await seedDependencies($, options, main, path, (label, isWarning) => setStep($, label, isWarning))
    await setStep($, 'Worktree ready')
    await update($, worktree, (current): Worktree => ({ ...current, phase: 'ready', error: null }))
    await refreshSlots($, options)
  } catch (error) {
    await fail($, error)
  }
}

export function registerWorktree(on: On, options: PluginOptions): void {
  on('classic.WorktreeCreate', async ($, e, next) => {
    if (!(await isAutoOn($, options))) return next(e)
    const path = await claimForCreate($, options, e.cwd, e.name)
    return path === null ? next(e) : { worktreePath: path }
  })

  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    await startWorktree($, options, e.cwd)
    return started
  })

  on('session.start', { isInteractive: false }, async ($, e, next) => {
    const started = await next(e)
    if ((await $.session.surfaces()).some(one => one === 'desktop' || one === 'vscode')) await startWorktree($, options, e.cwd)
    return started
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    if (e.surface === 'desktop' || e.surface === 'vscode') await startWorktree($, options, await $.session.cwd())
    if (e.viewport?.isFullscreen === true && !hasAutoOpened) {
      hasAutoOpened = true
      $.clock.after(0, () => void $.ui.open({ id: PANE, title: PANE_TITLE }))
    }
    return attached
  })

  on('session.end', async ($, e, next) => {
    // A /clear ends the conversation, not the process: it goes on in the same
    // slot, so the lease stays, and what the next session needs is kept for
    // it (the state starts over, and no session.start follows).
    if (e.reason === 'clear') {
      carried = { worktree: await read($, worktree), elsewhere: await read($, elsewhere), isBandHidden: await read($, isBandHidden) }
      return next(e)
    }
    heartbeat?.cancel()
    const { path } = await read($, worktree)
    if (path !== null) await releaseSlot($, path)
    return next(e)
  })

  on('classic.SessionStart', { source: 'clear' }, async ($, e, next) => {
    const done = await next(e)
    await carryOverClear($)
    return done
  })

  on('turn.start', async ($, e, next) => {
    await update($, isTurnRunning, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Every turn's tokens count, a subagent's too: the session has no total of
    // its own, and /cost's dollars are list price, not what anyone is billed.
    const used = e.usage
    if (used !== undefined) {
      if ((await read($, tokenTotals)) === null) {
        const kept = await $.store.get(RAIL_STORE_KEY)
        if (kept !== null && typeof kept === 'object' && (kept as RailKept).sessionId === (await $.session.id()) && (kept as RailKept).tokens !== null) {
          await update($, tokenTotals, () => (kept as RailKept).tokens)
        }
      }
      await update($, tokenTotals, now => ({
        input: (now?.input ?? 0) + used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens,
        output: (now?.output ?? 0) + used.output_tokens,
      }))
    }
    const sessionId = await $.session.id()
    if (e.agentId !== undefined) {
      await $.store.set(RAIL_STORE_KEY, { sessionId, repliedAt: await read($, lastReplyAt), tokens: await read($, tokenTotals) })
      return done
    }
    const repliedAt = await $.clock.now()
    await update($, lastReplyAt, () => repliedAt)
    await $.store.set(RAIL_STORE_KEY, { sessionId, repliedAt, tokens: await read($, tokenTotals) })
    await update($, isTurnRunning, () => false)
    if ((await read($, worktree)).phase === 'ready') await update($, isBandHidden, () => true)
    return done
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    $.ui.invalidate('ui.render')
    return closed
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    $.ui.invalidate('ui.render')
    $.clock.after(0, () => void refreshSlots($, options))
    return opened
  })

  on('ui.press', { plugin: 'fishstack', element: 'tab-worktree' }, async ($, e, next) => {
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
    if (e.props.hasSurvey) {
      railHover = null
      return next(e)
    }
    if (state.phase === 'off' || (await read($, isBandHidden))) {
      // With no worktree news, the band is fishStack's status rail. Reading
      // isTurnRunning redraws it as each turn starts and ends.
      const isWorking = await read($, isTurnRunning)
      await read($, railTick)
      // State starts over on a reload or a rename; the store keeps this
      // session's last reply and token totals across both.
      const kept = await $.store.get(RAIL_STORE_KEY)
      const keptHere = kept !== null && typeof kept === 'object' && (kept as RailKept).sessionId === (await $.session.id()) ? (kept as RailKept) : null
      const repliedAt = (await read($, lastReplyAt)) ?? keptHere?.repliedAt ?? null
      const now = await $.clock.now()
      const cacheSecondsLeft = repliedAt === null ? null : Math.max(0, Math.round((CACHE_TTL_MS - (now - repliedAt)) / 1000))
      tickWhileWarm($, cacheSecondsLeft !== null && cacheSecondsLeft > 0 && !isWorking)
      const usage = await $.session.usage({ breakdown: 'summary' })
      const breakdown = usage.context.breakdown
      const last = breakdown?.apiUsage ?? null
      const input = last === null ? 0 : last.input_tokens + last.cache_read_input_tokens + last.cache_creation_input_tokens
      const list = await read($, sources)
      const values = await read($, dials)
      // Only while the dial is on Autopilot: lowered, nothing is answered.
      const auto = values.autonomy === 5 ? await read($, autopilot) : null
      const ui: Ui = resolveUi($.ui.resolve(e), e.surface)
      return drawRail(
        ui,
        {
          isWorking,
          cacheSecondsLeft,
          cachePercent: last === null || input === 0 ? null : Math.round((last.cache_read_input_tokens / input) * 100),
          tokens: (await read($, tokenTotals)) ?? keptHere?.tokens ?? null,
          costUsd: usage.cost?.usd ?? null,
          preset: presetName(values),
          presetLevels: [values.foresight, values.crew, values.tenacity, values.autonomy, values.proof, values.voice],
          sourcesOn: list.filter(one => one.mode !== 'off').length,
          sourcesTotal: list.length,
          branch: state.phase === 'ready' ? state.branch : null,
          autopilot:
            auto === null
              ? null
              : auto.kind === 'waiting'
                ? { kind: 'waiting', secondsLeft: Math.max(0, Math.round((auto.deadline - now) / 1000)), totalSeconds: Math.round((auto.deadline - auto.since) / 1000), picked: auto.picked, count: auto.count }
                : { kind: 'answered', at: clockTime(auto.at), picked: auto.picked, waitedMinutes: Math.round(auto.waitedMs / 60_000) },
        },
        at => void openAt($, at),
        railHover,
        (id, isOn) => {
          // Leaving A may land after entering B: only A's own leave clears it.
          const hovered = isOn ? id : railHover === id ? null : railHover
          if (hovered === railHover) return
          railHover = hovered
          void update($, railTick, n => n + 1)
        },
        e.props.bodyColumns,
      )
    }

    // The rail is not drawn, so its Clients send no leave: start unlit.
    railHover = null
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
    const ui: Ui = resolveUi($.ui.resolve(e), e.surface)
    const { Box, Text, Button } = ui
    const state = await read($, worktree)
    const list = await read($, slots)
    const phase = PHASE[state.phase]
    const first = state.steps[0]?.at ?? 0
    const select = (id: Tab) => void update($, tab, () => id)

    const isAuto = await isAutoOn($, options)
    const note = await read($, poolNote)
    const idle = list.filter(one => !one.isLeased).length
    const autoCard = (
        <Box key="worktree-head" justifyContent="space-between" alignItems="flex-start" gap={1}>
          <Box flexDirection="column" flexShrink={1}>
            <Text bold>Where the agent works</Text>
            <Text dimColor>
              {isAuto
                ? "On: new sessions in a main checkout, and Claude's own worktrees, get a lasting slot. Read-only until it is ready, then the lock lifts."
                : "Off: fishStack leaves worktrees to Claude Code (the desktop's worktree option, claude --worktree, EnterWorktree)."}
            </Text>
            {isAuto && (
              <Box key="pool-line" gap={1} alignItems="center" flexWrap="wrap">
                <Text>
                  <Text color={idle > 0 ? 'success' : 'warning'}>● </Text>
                  <Text>
                    Pool: {list.length} {list.length === 1 ? 'slot' : 'slots'}, {idle} ready
                  </Text>
                  {note !== '' && <Text dimColor> · {note}</Text>}
                </Text>
                <Button key="pool-more" label="Warm one more" dimColor onPress={() => void warmOneMore($, options, list.length)} />
              </Box>
            )}
          </Box>
          <Box flexShrink={0} gap={1} alignItems="center">
            <Text dimColor>Use worktrees</Text>
            {drawnButton(ui, 'auto-worktree', switchArt(isAuto ? 'on' : 'off'), isAuto ? 'Use worktrees: on' : 'Use worktrees: off', 36, 22, () => void setAuto($, options, !isAuto)) ??
              segmented(ui, 'auto-worktree', AUTO_CHOICES, isAuto ? 'on' : 'off', choice => void setAuto($, options, choice === 'on'))}
          </Box>
        </Box>
    )

    // Every slot of this repository's pool, whatever this session is doing.
    const rich = ui.Svg !== undefined
    const slotList =
      list.length === 0 ? null : (
        <Box key="slot-list" flexDirection="column" gap={rich ? 1 : 0}>
          {label(ui, `Slots · ${list.length}`)}
          {list.map(slot =>
            card(
              ui,
              `slot-${slot.path}`,
              [
                <Box justifyContent="space-between" alignItems="center" gap={1}>
                  <Text wrap="truncate-end">
                    <Text bold>#{slot.path.split('/').pop()}</Text> {slot.branch ?? 'detached'}{' '}
                    <Text color={slot.isMine ? 'success' : slot.isLeased ? 'warning' : 'inactive'}>{slot.isMine ? '● this session' : slot.isLeased ? '● leased' : '○ free'}</Text>
                  </Text>
                  <Box gap={1}>
                    <Button key={`slot-copy-${slot.path}`} label="Copy path" dimColor onPress={press => void $.ui.copy({ text: slot.path, surface: press.surface })} />
                    {slot.isLeased && !slot.isMine && (
                      <Button key={`slot-release-${slot.path}`} label="Release" dimColor onPress={() => void releaseAndRefresh($, slot.path, options)} />
                    )}
                  </Box>
                </Box>,
              ],
              { tone: slot.isMine ? 'selected' : 'plain' },
            ),
          )}
        </Box>
      )

    const other = await read($, elsewhere)
    if (state.phase === 'off' && other !== null) {
      // In a worktree that is not ours: say where, and offer nothing to make.
      return frame(
        ui,
        'worktree',
        e.props.bodyColumns,
        select,
        <Box flexDirection="column" gap={1}>
          {autoCard}
          {card(ui, 'worktree-elsewhere', [
            <Text bold>This session already works in a worktree</Text>,
            <Text dimColor>fishStack does not manage it, so it leaves it as it is. New sessions started in the main checkout get a slot of their own.</Text>,
            <Box marginTop={1} gap={1}>
              <Text dimColor>Path</Text>
              <Text wrap="truncate-start">{shortPath(other)}</Text>
            </Box>,
          ])}
          {slotList}
        </Box>,
      )
    }

    if (state.phase === 'off') {
      return frame(
        ui,
        'worktree',
        e.props.bodyColumns,
        select,
        <Box flexDirection="column" gap={1}>
          {autoCard}
          {card(ui, 'worktree-empty', [
            <Box gap={2} alignItems="flex-start">
              {svg(ui, branchArt(120, 72), 'A branch off the main line', 120, 72)}
              <Box flexDirection="column" flexShrink={1} flexGrow={1} gap={1}>
                <Box flexDirection="column">
                  <Text bold>No worktree for this session</Text>
                  <Text dimColor>{isAuto ? 'This session started before the toggle was on, or outside a main checkout.' : 'Create one for this session now, or turn Use worktrees on for new sessions.'}</Text>
                </Box>
                <Box flexDirection="column">
                  <Text dimColor>✓ An isolated branch and folder</Text>
                  <Text dimColor>✓ Safe to discard</Text>
                  <Text dimColor>✓ The main checkout stays as it is</Text>
                </Box>
                <Box>
                  <Button key="worktree-create" label="Create worktree now" variant="primary" onPress={() => void claimNow($, options)} />
                </Box>
              </Box>
            </Box>,
          ])}
          {slotList}
        </Box>,
      )
    }


    const stage = stageOf(state)
    const { Svg } = ui
    const isReady = state.phase === 'ready'
    const showSteps = !isReady || (await read($, isStepsShown))
    const stepperWidth = Math.max(320, (e.props.bodyColumns - 4) * 8)
    const isTimed = state.steps.some(step => step.at !== first)
    const detail = (label: string, value: string) => (
      <Box gap={1}>
        <Box width={8} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text wrap="truncate-start">{value}</Text>
      </Box>
    )
    return frame(
      ui,
      'worktree',
      e.props.bodyColumns,
      select,
      <Box flexDirection="column" gap={1}>
        {autoCard}
        {card(
          ui,
          'worktree-status',
          [
            <Box justifyContent="space-between" alignItems="center" gap={1}>
              <Text>
                <Text color={phase.color} bold>
                  ● {phase.label}
                </Text>
                <Text dimColor> · {isReady ? (state.branch ?? '') : state.steps.length === 0 ? shortPath(state.main ?? '') : state.step}</Text>
              </Text>
              <Box gap={1}>
                {isReady && <Button key="steps-toggle" label={showSteps ? 'Hide steps' : 'Show steps'} dimColor onPress={() => void update($, isStepsShown, now => !now)} />}
                {state.phase !== 'preparing' && <Button key="slots-refresh" label="Refresh" hotkey="r" dimColor onPress={() => void refreshSlots($, options)} />}
                {state.phase === 'failed' && <Button key="worktree-retry" label="Retry" variant="primary" onPress={() => void beginWorktree($, options)} />}
              </Box>
            </Box>,
            showSteps &&
              (rich ? (
                <Box marginTop={1}>{svg(ui, stepper(stage, state.phase, stepperWidth), `Stage ${Math.min(stage + 1, 4)} of 4: ${STAGES[Math.min(stage, 3)]}`, stepperWidth, 58)}</Box>
              ) : (
                <Text>
                  {STAGES.map((name, index) => (
                    <Text color={index < stage || isReady ? 'success' : index === stage ? phase.color : undefined} dimColor={index > stage && !isReady}>
                      {index < stage || isReady ? '✓' : index === stage ? '●' : '○'} {name}
                      {index < STAGES.length - 1 ? '  ─  ' : ''}
                    </Text>
                  ))}
                </Text>
              )),
            state.phase === 'preparing' && (
              <Box marginTop={1}>
                <Text dimColor>Prompts work now: the agent reads, searches and plans in the main checkout, and edits once it moves in.</Text>
              </Box>
            ),
            showSteps && state.steps.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {state.steps.map(step => (
                  <Text color={step.isWarning ? 'warning' : undefined} dimColor={!step.isWarning}>
                    {isTimed ? `+${((step.at - first) / 1000).toFixed(1)}s  ` : '·  '}
                    {step.label}
                  </Text>
                ))}
              </Box>
            ),
            state.path !== null && (
              <Box flexDirection="column" marginTop={1}>
                {detail('Main', shortPath(state.main ?? ''))}
                {detail('Slot', shortPath(state.path))}
                {detail('Branch', state.branch ?? '')}
                {detail('Base', `${state.base ?? ''}${state.baseSha === null ? '' : ` @ ${state.baseSha.slice(0, 7)}`}`)}
              </Box>
            ),
          ],
          { tone: state.phase === 'failed' ? 'danger' : isReady ? 'plain' : 'warning' },
        )}

        {slotList}
      </Box>,
    )
  })
}

// A time of day as the person's clock shows it: 4:12 pm.
function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// The prompt cache lives 5 minutes past the last reply. While it is warm
// the rail redraws every few seconds so its bars run down.
const CACHE_TTL_MS = 5 * 60_000
let cacheTick: Timer | null = null

function tickWhileWarm($: $, isWarm: boolean): void {
  if (isWarm && cacheTick === null) cacheTick = $.clock.every(5_000, () => void update($, railTick, n => n + 1))
  if (!isWarm && cacheTick !== null) {
    cacheTick.cancel()
    cacheTick = null
  }
}

// The rail's items open the pane, at their tab when they name one.
async function openAt($: $, at: Tab | null): Promise<void> {
  if (at !== null) await update($, tab, () => at)
  await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })
}

// A home folder spelled ~, as the terminal shows paths.
function shortPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~')
}

const STAGES = ['Fetch', 'Claim a slot', 'Seed', 'Move in']

// Which of the four stages the steps so far have reached.
function stageOf(state: Worktree): number {
  if (state.phase === 'ready') return STAGES.length
  const patterns = [/^Fetching|^Could not fetch/, /^Claiming|^Reusing slot|^Creating a new worktree/, /^Cloning|^Could not clone|^Running|^Setup already done/, /^Moving the session in/]
  let reached = 0
  for (const step of state.steps) {
    patterns.forEach((pattern, index) => {
      if (pattern.test(step.label)) reached = Math.max(reached, index)
    })
  }
  return reached
}

function stepper(stage: number, phase: WorktreePhase, width: number): string {
  const gap = width / STAGES.length
  const parts = STAGES.map((name, index) => {
    const x = gap * index + gap / 2
    const isDone = index < stage
    const isCurrent = index === stage
    const color = isDone ? '#3fb6a8' : isCurrent ? (phase === 'failed' ? '#e5534b' : '#d6a24a') : '#8b949e'
    const line =
      index < STAGES.length - 1
        ? `<line x1="${x + 13}" y1="16" x2="${x + gap - 13}" y2="16" stroke="${isDone ? '#3fb6a8' : '#8b949e'}" stroke-opacity="${isDone ? 0.9 : 0.35}" stroke-width="2" stroke-dasharray="${isDone ? '' : '3 4'}"/>`
        : ''
    const mark = isDone
      ? `<path d="M${x - 4.5} 16.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<text x="${x}" y="20.5" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="12" font-weight="600" fill="${isCurrent ? '#fff' : '#8b949e'}">${index + 1}</text>`
    const halo = isCurrent ? `<circle cx="${x}" cy="16" r="15" fill="${color}" fill-opacity="0.2"/>` : ''
    return `${line}${halo}<circle cx="${x}" cy="16" r="11" fill="${isDone || isCurrent ? color : 'none'}" stroke="${color}" stroke-opacity="${isDone || isCurrent ? 1 : 0.5}" stroke-width="1.6"/>${mark}<text x="${x}" y="48" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="12" font-weight="${isCurrent ? 600 : 400}" fill="${isCurrent ? color : isDone ? '#9aa1ab' : '#6e7681'}">${name}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="58" viewBox="0 0 ${width} 58">${parts}</svg>`
}

async function releaseAndRefresh($: $, path: string, options: PluginOptions): Promise<void> {
  await releaseSlot($, path)
  await refreshSlots($, options)
}

// The Context tab, after CommissionAI's context library: the sources the user
// shares with the agent (notes, links, files from the repository), each On or
// Off and On ones optionally Strict, kept loose or grouped in folders that
// switch as one. The live context window sits in a footer. session.ts puts
// the sources that are on in the system prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ContextView, Folder, Source, SourceMode, Tab } from '../types'
import { switchArt } from './art'
import { drawnButton, glyph, GLYPH_COLOR, isRich, svg, switchRow } from './kit'
import { setSetting, settingsHome } from './settings'
import { paneHeads } from './state'
import { bar, frame, PANE, resolveUi, tokens } from './ui'
import type { Ui } from './ui'

const contextDraft = atom({ plugin: 'fishstack', key: 'contextDraft' } as const, { input: '' })
const contextStatus = atom({ plugin: 'fishstack', key: 'contextStatus' } as const, '')
const contextView = atom({ plugin: 'fishstack', key: 'contextView' } as const, {
  openFolders: [],
  openId: null,
  picking: null,
  deletingFolder: null,
  isEditingText: false,
})
const folders = atom({ plugin: 'fishstack', key: 'folders' } as const, [])
const isTurnRunning = atom({ plugin: 'fishstack', key: 'isTurnRunning' } as const, false)
const isWindowShown = atom({ plugin: 'fishstack', key: 'isWindowShown' } as const, false)
const sources = atom({ plugin: 'fishstack', key: 'sources' } as const, [])
const tab = atom({ plugin: 'fishstack', key: 'tab' } as const, null)
const isClientDown = atom({ plugin: 'fishstack', key: 'isClientDown' } as const, false)
const isContextOn = atom({ plugin: 'fishstack', key: 'isContextOn' } as const, true)

// The Use context switch, kept across sessions for each repository. Off, no source reaches the
// agent, whatever each source's own switch says; the library is kept.
export const CONTEXT_ON_KEY = 'useContext'

async function setContextOn($: EngineInterface, isOn: boolean): Promise<void> {
  await setSetting($, CONTEXT_ON_KEY, isOn)
  await update($, isContextOn, () => isOn)
}

type $ = EngineInterface

export const CONTEXT_SECTION_ID = 'fishstack:context'
const CHAR_CAP = 12_000
const TOKEN_BUDGET = 12_000
const IMPORT_CAP = 40
const TEXT_FILE = /\.(md|mdx|markdown|txt|rst|adoc|json|ya?ml|toml|graphql|proto|sql|csv)$/i
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'target'])


const KIND_LABEL: Record<Source['kind'], string> = { note: 'Note', link: 'Link', file: 'File' }

// What a source looks like in the library, and what it costs the agent.
export function libraryStoreKey(root: string): string {
  return `context:${root}`
}

// The store key the library used before folders, read once to carry it over.
export function legacyStoreKey(root: string): string {
  return `sources:${root}`
}

export function parseLibrary(stored: unknown, legacy: unknown): { sources: Source[]; folders: Folder[] } {
  const library = stored as { sources?: unknown; folders?: unknown } | undefined
  if (library !== undefined && library !== null && Array.isArray(library.sources)) {
    return {
      sources: (library.sources as Source[]).map(normalize),
      folders: Array.isArray(library.folders) ? (library.folders as Folder[]) : [],
    }
  }
  return { sources: Array.isArray(legacy) ? (legacy as Source[]).map(normalize) : [], folders: [] }
}

function normalize(one: Source): Source {
  return { ...one, path: one.path ?? null, folderId: one.folderId ?? null }
}

function approxTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

function chars(count: number): string {
  return count >= 1_000 ? `${(count / 1_000).toFixed(1)}k chars` : `${count} chars`
}

// A title cut to fit its row at a word, the whole one kept in the store.
function shorten(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, room - 1).replace(/\s+\S*$/, '').replace(/[.,;:]$/, '')}…`
}

function host(url: string): string {
  return /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? url
}

function facts(source: Source): string {
  if (source.kind === 'link' && source.url !== null) return `Link · ${host(source.url)} · ${chars(source.text.length)}`
  if (source.kind === 'file' && source.path !== null) return `File · ${source.path} · ${chars(source.text.length)}`
  return `${KIND_LABEL[source.kind]} · ${chars(source.text.length)}`
}

// One mode for a folder's members, or 'mixed' when they differ.
export function folderMode(members: Source[]): SourceMode | 'mixed' {
  if (members.length === 0) return 'off'
  const first = members[0]!.mode
  return members.every(one => one.mode === first) ? first : 'mixed'
}

function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null
  const text = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return { title, text }
}

export function contextSection(list: Source[], groups: Folder[] = []): string | null {
  const enabled = list.filter(one => one.mode !== 'off')
  if (enabled.length === 0) return null
  const folderName = new Map(groups.map(one => [one.id, one.name]))
  const blocks = enabled.map(one => {
    const group = one.folderId === null ? undefined : folderName.get(one.folderId)
    const heading = group === undefined ? one.title : `${group} › ${one.title}`
    const origin = one.url !== null ? ` (${one.url})` : one.path !== null ? ` (${one.path})` : ''
    const weight =
      one.mode === 'strict'
        ? 'STRICT: binding ground truth. Follow it over your own assumptions, and say so if the code disagrees.'
        : 'Guidance: weigh it, but the code and the user win when they disagree.'
    return `### ${heading}${origin}\n${weight}\n\n${one.text}`
  })
  return ['## Project context the user shared', ...blocks].join('\n\n')
}

// The thresholds CommissionAI's ContextRing turns amber and red at.
function fillColor(percent: number): string {
  return percent >= 85 ? 'error' : percent >= 65 ? 'warning' : 'success'
}

async function save($: $): Promise<void> {
  await $.store.set(libraryStoreKey(await settingsHome($)), {
    sources: await read($, sources),
    folders: await read($, folders),
  })
}

async function saveSources($: $, change: (list: Source[]) => Source[]): Promise<void> {
  await update($, sources, change)
  await save($)
}

async function newId($: $): Promise<string> {
  return `${(await $.clock.now()).toString(36)}-${crypto.randomUUID().slice(0, 4)}`
}

const VIEW: ContextView = {
  openFolders: [],
  openId: null,
  picking: null,
  deletingFolder: null,
  isEditingText: false,
}

// The view as this version draws it. $.state outlives a reload, so a view
// saved by an older version can lack fields; they start at their defaults.
async function readView($: $): Promise<ContextView> {
  return { ...VIEW, ...(await read($, contextView)) }
}

async function updateView($: $, change: (now: ContextView) => ContextView): Promise<void> {
  await update($, contextView, now => change({ ...VIEW, ...now }))
}

async function setView($: $, change: Partial<ContextView>): Promise<void> {
  await updateView($, now => ({ ...now, ...change }))
}

async function say($: $, text: string): Promise<void> {
  await update($, contextStatus, () => text)
}

async function addSource($: $, source: Omit<Source, 'id' | 'mode' | 'folderId'>): Promise<Source> {
  const added: Source = { ...source, id: await newId($), mode: 'guidance', folderId: null }
  await saveSources($, list => [...list, added])
  return added
}

async function fetchLink($: $, url: string): Promise<{ title: string; text: string } | string> {
  let response
  try {
    response = await $.http.fetch(url)
  } catch (error) {
    $.ui.log(`fetch ${url} failed: ${String(error)}`, { to: 'debug' })
    return 'Could not reach that link.'
  }
  if (!response.ok) return `That link answered ${response.status}.`
  const isHtml = (response.headers['content-type'] ?? '').includes('html')
  const page = isHtml ? htmlToText(response.text) : { title: null, text: response.text.trim() }
  return { title: page.title || url.replace(/^https?:\/\//, '').replace(/\/$/, ''), text: page.text.slice(0, CHAR_CAP) }
}

async function readText($: $, path: string): Promise<string> {
  const text = await $.fs.read(path)
  return typeof text === 'string' ? text.slice(0, CHAR_CAP) : ''
}

// The text files under a directory, breadth first, at most IMPORT_CAP, as
// absolute paths.
async function textFiles($: $, directory: string): Promise<string[]> {
  const found: string[] = []
  const queue = [directory]
  while (queue.length > 0 && found.length < IMPORT_CAP) {
    const dir = queue.shift()!
    const entries = await $.fs.list(dir)
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      const path = `${dir}/${entry.name}`
      if (entry.kind === 'dir' && !SKIPPED_DIRS.has(entry.name)) queue.push(path)
      else if (entry.kind === 'file' && TEXT_FILE.test(entry.name) && found.length < IMPORT_CAP) found.push(path)
    }
  }
  return found
}

// The one add field: a link is fetched, a path in the repository is read (a
// directory becomes a folder of its text files), anything else is a note.
async function addFromInput($: $, raw: string): Promise<void> {
  const text = raw.trim()
  if (text === '') return say($, 'Paste a link or write a note, or choose files.')
  if (/^https?:\/\/\S+$/.test(text)) {
    await say($, `Fetching ${text}`)
    const page = await fetchLink($, text)
    if (typeof page === 'string') return say($, page)
    await addSource($, { kind: 'link', title: page.title, text: page.text, url: text, path: null })
    return clearInput($, `Added ${page.title}`)
  }
  const looksLikePath = !/\s/.test(text) && /[/.]/.test(text)
  if (looksLikePath) {
    const path = text.replace(/^\.\//, '').replace(/\/+$/, '')
    const top = await $.session.root()
    const stat = await $.fs.stat(`${top}/${path}`).catch(() => undefined)
    if (stat?.kind === 'dir') return importDirectory($, `${top}/${path}`, path)
    if (stat?.kind === 'file') {
      const body = await readText($, `${top}/${path}`).catch(() => null)
      if (body === null) return say($, `Could not read ${path}.`)
      await addSource($, { kind: 'file', title: path.split('/').pop() ?? path, text: body, url: null, path })
      return clearInput($, `Added ${path}`)
    }
  }
  const firstLine = text.split('\n')[0]!
  const title = firstLine.slice(0, 120)
  await addSource($, { kind: 'note', title, text, url: null, path: null })
  return clearInput($, 'Added a note. Open it to rename it or add more.')
}

// The macOS file dialog, run through osascript on the machine Claude Code
// runs on: the picked paths, [] when the person cancels, null when there is
// no dialog to show (not macOS, or osascript failed).
async function pickPaths($: $, kind: 'file' | 'folder'): Promise<string[] | null> {
  const top = (await $.session.root()).replace(/"/g, '')
  const chooser =
    kind === 'file'
      ? `choose file with prompt "Add files to fishStack context" default location (POSIX file "${top}") with multiple selections allowed`
      : `choose folder with prompt "Add folders to fishStack context" default location (POSIX file "${top}") with multiple selections allowed`
  const ran = await $.process
    .run(['osascript', '-e', 'activate', '-e', `set picked to ${chooser}`, '-e', 'set out to ""', '-e', 'repeat with one in picked', '-e', 'set out to out & POSIX path of one & linefeed', '-e', 'end repeat', '-e', 'return out'], { timeoutMs: 600_000 })
    .catch(() => null)
  if (ran === null) return null
  if (ran.exitCode !== 0) return /-128/.test(ran.stderr) ? [] : null
  return ran.stdout
    .split('\n')
    .map(line => line.trim().replace(/\/$/, ''))
    .filter(line => line !== '')
}

// A path as a source keeps it: relative to the checkout when inside it.
function relativePath(top: string, path: string): string {
  return path.startsWith(`${top}/`) ? path.slice(top.length + 1) : path
}

// Set before the first await, so a second press while the dialog is coming
// up (it can take a few seconds) is dropped rather than opening another.
let isPicking = false

async function choose($: $, kind: 'file' | 'folder'): Promise<void> {
  if (isPicking) return
  isPicking = true
  try {
    await setView($, { picking: kind })
    await say($, 'Waiting for the file dialog. It can take a moment to open, sometimes behind this window.')
    await addPicked($, kind, await pickPaths($, kind))
  } finally {
    isPicking = false
    await setView($, { picking: null })
  }
}

async function addPicked($: $, kind: 'file' | 'folder', picked: string[] | null): Promise<void> {
  if (picked === null) return say($, 'Could not open the file dialog here. Type a path in the field instead.')
  if (picked.length === 0) return say($, '')
  const top = await $.session.root()
  const added: string[] = []
  for (const path of picked) {
    if (kind === 'folder') {
      await importDirectory($, path, relativePath(top, path))
      added.push(relativePath(top, path))
      continue
    }
    const body = await readText($, path).catch(() => null)
    if (body === null || body.includes('\u0000')) {
      await say($, `Skipped ${path.split('/').pop()}: only text files can be sources.`)
      continue
    }
    await addSource($, { kind: 'file', title: path.split('/').pop() ?? path, text: body, url: null, path: relativePath(top, path) })
    added.push(path.split('/').pop() ?? path)
  }
  if (kind === 'file' && added.length > 0) await say($, `Added ${added.join(', ')}`)
}

async function clearInput($: $, status: string): Promise<void> {
  await update($, contextDraft, now => ({ ...now, input: '' }))
  await say($, status)
}

async function importDirectory($: $, directory: string, path: string): Promise<void> {
  const top = await $.session.root()
  const files = await textFiles($, directory)
  if (files.length === 0) return say($, `No text files under ${path}.`)
  const folder: Folder = { id: await newId($), name: path.split('/').pop() || path }
  const added: Source[] = []
  for (const file of files) {
    added.push({
      id: await newId($),
      kind: 'file',
      title: file.split('/').pop() ?? file,
      text: await readText($, file),
      url: null,
      path: relativePath(top, file),
      mode: 'guidance',
      folderId: folder.id,
    })
  }
  await update($, folders, list => [...list, folder])
  await saveSources($, list => [...list, ...added])
  await updateView($, now => ({ ...now, openFolders: [...now.openFolders, folder.id] }))
  await clearInput($, `Added ${path} as a folder of ${files.length} files`)
}

async function refresh($: $, source: Source): Promise<void> {
  await say($, `Refreshing ${source.title}`)
  let text: string | null = null
  if (source.kind === 'link' && source.url !== null) {
    const page = await fetchLink($, source.url)
    if (typeof page === 'string') return say($, page)
    text = page.text
  } else if (source.kind === 'file' && source.path !== null) {
    const file = source.path.startsWith('/') ? source.path : `${await $.session.root()}/${source.path}`
    text = await readText($, file).catch(() => null)
  }
  if (text === null) return say($, `Could not refresh ${source.title}.`)
  await saveSources($, list => list.map(one => (one.id === source.id ? { ...one, text: text! } : one)))
  await say($, `Refreshed ${source.title}`)
}

async function setMode($: $, id: string, mode: SourceMode): Promise<void> {
  await saveSources($, list => list.map(one => (one.id === id ? { ...one, mode } : one)))
}

// A folder's switch: everything on (strict members stay strict), or all off.
async function setFolderOn($: $, folderId: string, isOn: boolean): Promise<void> {
  await saveSources($, list =>
    list.map(one => (one.folderId !== folderId ? one : { ...one, mode: isOn ? (one.mode === 'off' ? 'guidance' : one.mode) : 'off' })),
  )
}

async function renameSource($: $, id: string, title: string): Promise<void> {
  if (title.trim() === '') return
  await saveSources($, list => list.map(one => (one.id === id ? { ...one, title: title.trim() } : one)))
}

async function editNote($: $, id: string, text: string): Promise<void> {
  await saveSources($, list => list.map(one => (one.id === id ? { ...one, text } : one)))
  await setView($, { isEditingText: false })
}

async function removeSource($: $, id: string): Promise<void> {
  await saveSources($, list => list.filter(one => one.id !== id))
  await setView($, { openId: null })
}

async function deleteFolder($: $, id: string): Promise<void> {
  await update($, sources, list => list.filter(one => one.folderId !== id))
  await update($, folders, list => list.filter(one => one.id !== id))
  await save($)
  await updateView($, now => ({ ...now, deletingFolder: null, openFolders: now.openFolders.filter(one => one !== id) }))
}

async function toggleFolderOpen($: $, id: string): Promise<void> {
  await updateView($, now => ({
    ...now,
    openFolders: now.openFolders.includes(id) ? now.openFolders.filter(one => one !== id) : [...now.openFolders, id],
  }))
}

export function registerContext(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, tab)) !== 'context') return next(e)
    const ui: Ui = resolveUi($.ui.resolve(e), e.surface, await read($, isClientDown))
    const { Box, Text, Button, Input, Markdown } = ui
    const rich = isRich(ui)
    const list = await read($, sources)
    const groups = await read($, folders)
    const view = await readView($)
    const draft = await read($, contextDraft)
    const status = await read($, contextStatus)
    const columns = e.props.bodyColumns
    const go = (change: Partial<ContextView>) => () => void setView($, change)
    const select = (id: Tab | null) => void update($, tab, () => id)
    const heads = await paneHeads($)
    const isOn = await read($, isContextOn)

    const setting = switchRow(ui, 'context-on', 'Use context', isOn, isOn ? 'Sources that are on go into every request.' : 'No source reaches the agent.', turned => void setContextOn($, turned))
    if (!isOn) return frame(ui, 'context', columns, select, setting, heads)

    const sharedList = list.filter(one => one.mode !== 'off')
    const sharedTokens = approxTokens(sharedList.reduce((sum, one) => sum + one.text.length, 0))
    const isOver = sharedTokens > TOKEN_BUDGET
    const loose = list.filter(one => one.folderId === null)
    const isThin = (source: Source) => source.kind === 'link' && source.text.length < 200
    // What a row's title may take: the card less its switch, mark and Strict.
    const room = Math.max(12, columns - 24)

    const onOff = (key: string, state: 'on' | 'off' | 'some', onPress: () => void) =>
      drawnButton(ui, key, switchArt(state), state === 'on' ? 'On' : state === 'some' ? 'Some on' : 'Off', 36, 22, onPress) ?? (
        <Button key={key} plain onPress={onPress}>
          {state === 'on' ? <Text color="success">●</Text> : state === 'some' ? <Text color="warning">◐</Text> : <Text dimColor>○</Text>}
        </Button>
      )

    const sourceRow = (source: Source, isNested: boolean) => {
      const isSourceOn = source.mode !== 'off'
      const isOpen = view.openId === source.id
      return (
        <Box key={`row-${source.id}`} flexDirection="column" paddingLeft={isNested ? 2 : 0}>
          <Box justifyContent="space-between" alignItems="center" gap={1}>
            <Box gap={1} alignItems="center" flexShrink={1}>
              {onOff(`toggle-${source.id}`, isSourceOn ? 'on' : 'off', () => void setMode($, source.id, isSourceOn ? 'off' : 'guidance'))}
              {rich ? svg(ui, glyph(source.kind), source.kind, 18, 18) : <Text color={GLYPH_COLOR[source.kind]}>{KIND_MARK[source.kind]}</Text>}
              <Button key={`open-${source.id}`} plain onPress={go({ openId: isOpen ? null : source.id, isEditingText: false })}>
                <Text dimColor={!isSourceOn}>{shorten(source.title, room - (isNested ? 2 : 0))}</Text>
              </Button>
            </Box>
            {isSourceOn && (
              <Button
                key={`strict-${source.id}`}
                label="Strict"
                variant={source.mode === 'strict' ? 'primary' : undefined}
                dimColor={source.mode !== 'strict'}
                onPress={() => void setMode($, source.id, source.mode === 'strict' ? 'guidance' : 'strict')}
              />
            )}
          </Box>
          {isOpen && (
            <Box flexDirection="column" gap={rich ? 1 : 0} paddingLeft={2} marginTop={rich ? 1 : 0}>
              <Text dimColor wrap="truncate-end">
                {facts(source)}
                {isThin(source) ? ' · may be empty' : ''}
              </Text>
              {source.kind === 'file' && /\.mdx?$/i.test(source.path ?? '') ? (
                <Markdown key={`text-${source.id}`} text={source.text.slice(0, 600)} />
              ) : (
                <Text wrap="wrap">{source.text.slice(0, 600) || 'No readable text.'}</Text>
              )}
              {source.text.length > 600 && <Text dimColor>… {chars(source.text.length - 600)} more reach the agent</Text>}
              {view.isEditingText && source.kind === 'note' && Input !== undefined && (
                <Input key={`edit-text-${source.id}`} label="Text " value={source.text} submitLabel="save" autoFocus onSubmit={value => void editNote($, source.id, value)} />
              )}
              {Input !== undefined && <Input key={`rename-source-${source.id}`} label="Title " value={source.title} submitLabel="rename" onSubmit={value => void renameSource($, source.id, value)} />}
              <Box gap={1} flexWrap="wrap">
                {source.kind === 'note' && Input !== undefined && (
                  <Button key={`edit-text-start-${source.id}`} label={view.isEditingText ? 'Done' : 'Edit text'} dimColor onPress={go({ isEditingText: !view.isEditingText })} />
                )}
                {source.kind !== 'note' && <Button key={`refresh-${source.id}`} label="Refresh" dimColor onPress={() => void refresh($, source)} />}
                <Button key={`remove-${source.id}`} onPress={() => void removeSource($, source.id)}>
                  <Text color="error">Delete</Text>
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    const folderBlock = (folder: Folder) => {
      const members = list.filter(one => one.folderId === folder.id)
      const onCount = members.filter(one => one.mode !== 'off').length
      const state = members.length === 0 || onCount === 0 ? 'off' : onCount === members.length ? 'on' : 'some'
      const isOpen = view.openFolders.includes(folder.id)
      return (
        <Box key={`folder-card-${folder.id}`} flexDirection="column">
          <Box justifyContent="space-between" alignItems="center" gap={1}>
            <Box gap={1} alignItems="center" flexShrink={1}>
              {members.length > 0 && onOff(`folder-toggle-${folder.id}`, state, () => void setFolderOn($, folder.id, state !== 'on'))}
              {rich ? svg(ui, glyph('folder'), 'folder', 18, 18) : <Text color="warning">▣</Text>}
              <Button key={`fold-${folder.id}`} plain onPress={() => void toggleFolderOpen($, folder.id)}>
                <Text bold>{shorten(folder.name, room - 8)}</Text>
                <Text dimColor> {members.length === 0 ? 'empty' : `${onCount}/${members.length}`} {isOpen ? '⌄' : '›'}</Text>
              </Button>
            </Box>
            <Button key={`folder-delete-${folder.id}`} label="Remove" dimColor onPress={go({ deletingFolder: folder.id })} />
          </Box>
          {view.deletingFolder === folder.id && (
            <Box flexDirection="column">
              <Text dimColor>Remove {folder.name} and its {members.length} sources? The files stay on disk.</Text>
              <Box gap={1} justifyContent="flex-end">
                <Button key="delete-cancel" label="Cancel" dimColor onPress={go({ deletingFolder: null })} />
                <Button key="delete-folder" label="Remove" variant="primary" onPress={() => void deleteFolder($, folder.id)} />
              </Box>
            </Box>
          )}
          {isOpen && members.map(source => sourceRow(source, true))}
        </Box>
      )
    }

    const isWarning = /^(Could|That link|No text|Skipped)/.test(status)
    const adder = (
      <Box key="adder" flexDirection="column" gap={rich ? 1 : 0}>
        <Box gap={1} alignItems="center" flexWrap="wrap">
          <Button key="pick-files" label={view.picking === 'file' ? 'Choosing…' : 'Add files…'} dimColor={view.picking !== null} onPress={() => void choose($, 'file')} />
          <Button key="pick-folder" label={view.picking === 'folder' ? 'Choosing…' : 'Add folder…'} dimColor={view.picking !== null} onPress={() => void choose($, 'folder')} />
        </Box>
        {Input !== undefined && (
          <Input
            key="add-input"
            placeholder="Paste a link or write a note"
            value={draft.input}
            submitLabel="add"
            onInput={value => void update($, contextDraft, now => ({ ...now, input: value }))}
            onSubmit={value => void addFromInput($, value)}
          />
        )}
        {status !== '' && (
          <Text color={isWarning ? 'warning' : undefined} dimColor={!isWarning} wrap="truncate-end">
            {status}
          </Text>
        )}
      </Box>
    )

    const isEmpty = list.length === 0 && groups.length === 0
    return frame(
      ui,
      'context',
      columns,
      select,
      <Box flexDirection="column" gap={1}>
        {setting}
        {adder}
        {isEmpty ? (
          <Text dimColor>No sources yet. Try a note like "Amounts are integer cents".</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={isOver ? 'error' : undefined} dimColor={!isOver}>
              {sharedList.length} of {list.length} on · about {tokens(sharedTokens)} tokens{isOver ? ', over budget' : ''}
            </Text>
            {groups.map(folderBlock)}
            {loose.map(source => sourceRow(source, false))}
          </Box>
        )}
        {!isEmpty && (await drawWindow($, ui))}
      </Box>,
      heads,
    )
  })
}


const KIND_MARK: Record<Source['kind'], string> = { note: '¶', link: '↗', file: '▢' }

// The live context window, one line at the foot of the card.
async function drawWindow($: $, ui: Ui) {
  const { Box, Text, Button } = ui
  // Reading isTurnRunning redraws the card as each turn starts and ends, so
  // the window figures below are read fresh then.
  const isRunning = await read($, isTurnRunning)
  const isShown = await read($, isWindowShown)
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  const used = breakdown?.totalTokens ?? usage.context.tokens ?? 0
  const window = breakdown?.rawMaxTokens ?? usage.context.window
  const percent = breakdown?.percentage ?? usage.context.percent ?? 0
  const categories = (breakdown?.categories ?? []).filter(one => one.kind === 'used' && one.tokens > 0)
  return (
    <Box key="window" flexDirection="column">
      <Box justifyContent="space-between" alignItems="center" gap={1}>
        <Text wrap="truncate-end">
          <Text dimColor>Window </Text>
          <Text color={fillColor(percent)} bold>
            {percent}%
          </Text>
          <Text dimColor>
            {' '}
            · {tokens(used)} of {tokens(window)}
          </Text>
        </Text>
        <Box gap={1} flexShrink={0}>
          <Button key="window-details" label={isShown ? 'Hide' : 'Details'} dimColor onPress={() => void update($, isWindowShown, now => !now)} />
          {!isRunning && <Button key="usage-compact" label="Compact" dimColor onPress={() => void $.session.compact({})} />}
        </Box>
      </Box>
      {isShown &&
        categories.map(category => (
          <Text>
            <Text dimColor>{category.name.slice(0, 18).padEnd(19)}</Text>
            {tokens(category.tokens).padStart(6)} <Text color="promptBorder">{bar(category.tokens / Math.max(1, used), 10)}</Text>
          </Text>
        ))}
    </Box>
  )
}

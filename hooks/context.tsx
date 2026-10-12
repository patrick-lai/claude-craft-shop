// The Context tab, after CommissionAI's context ring and knowledge library:
// the live context window, and the notes and links the user shares with the
// agent (session.ts puts the enabled ones in the system prompt).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Source, SourceMode, Tab } from '../types'
import { bar, frame, PANE, tokens } from './ui'
import type { Ui } from './ui'

const isTurnRunning = atom({ plugin: 'craft-shop', key: 'isTurnRunning' } as const, false)
const linkStatus = atom({ plugin: 'craft-shop', key: 'linkStatus' } as const, '')
const noteDraft = atom({ plugin: 'craft-shop', key: 'noteDraft' } as const, { title: '', text: '' })
const sources = atom({ plugin: 'craft-shop', key: 'sources' } as const, [])
const tab = atom({ plugin: 'craft-shop', key: 'tab' } as const, 'worktree')

type $ = EngineInterface

export const CONTEXT_SECTION_ID = 'craft-shop:context'
const LINK_CHAR_CAP = 12_000
const TOKEN_BUDGET = 12_000

const MODES: { value: SourceMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'guidance', label: 'Guidance' },
  { value: 'strict', label: 'Strict' },
]

export function sourcesStoreKey(root: string): string {
  return `sources:${root}`
}

function approxTokens(chars: number): number {
  return Math.ceil(chars / 4)
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

export function contextSection(list: Source[]): string | null {
  const enabled = list.filter(one => one.mode !== 'off')
  if (enabled.length === 0) return null
  const blocks = enabled.map(one => {
    const origin = one.url === null ? '' : ` (${one.url})`
    const weight = one.mode === 'strict'
      ? 'STRICT: binding ground truth. Follow it over your own assumptions, and say so if the code disagrees.'
      : 'Guidance: weigh it, but the code and the user win when they disagree.'
    return `### ${one.title}${origin}\n${weight}\n\n${one.text}`
  })
  return ['## Project context the user shared', ...blocks].join('\n\n')
}

// The thresholds CommissionAI's ContextRing turns amber and red at.
function fillColor(percent: number): string {
  return percent >= 85 ? 'error' : percent >= 65 ? 'warning' : 'success'
}

async function saveSources($: $, change: (list: Source[]) => Source[]): Promise<void> {
  await update($, sources, change)
  const repo = await $.session.repo()
  await $.store.set(sourcesStoreKey(repo?.root ?? (await $.session.root())), await read($, sources))
}

async function newId($: $): Promise<string> {
  return `${(await $.clock.now()).toString(36)}-${crypto.randomUUID().slice(0, 4)}`
}

async function addNote($: $, text: string): Promise<void> {
  const { title } = await read($, noteDraft)
  const id = await newId($)
  const note: Source = { id, kind: 'note', title: title.trim() || 'Note', text: text.trim(), url: null, mode: 'guidance' }
  await saveSources($, list => [...list, note])
  await update($, noteDraft, () => ({ title: '', text: '' }))
}

async function addLink($: $, url: string): Promise<void> {
  const trimmed = url.trim()
  if (!/^https?:\/\//.test(trimmed)) {
    await update($, linkStatus, () => 'A link starts with http:// or https://.')
    return
  }
  await update($, linkStatus, () => `Fetching ${trimmed}`)
  let response
  try {
    response = await $.http.fetch(trimmed)
  } catch (error) {
    $.ui.log(`fetch ${trimmed} failed: ${String(error)}`, { to: 'debug' })
    await update($, linkStatus, () => 'Could not reach that link.')
    return
  }
  if (!response.ok) {
    await update($, linkStatus, () => `That link answered ${response.status}.`)
    return
  }
  const isHtml = (response.headers['content-type'] ?? '').includes('html')
  const page = isHtml ? htmlToText(response.text) : { title: null, text: response.text.trim() }
  const id = await newId($)
  const link: Source = {
    id,
    kind: 'link',
    title: page.title || trimmed,
    text: page.text.slice(0, LINK_CHAR_CAP),
    url: trimmed,
    mode: 'guidance',
  }
  await saveSources($, list => [...list, link])
  await update($, linkStatus, () => '')
}

async function setMode($: $, id: string, mode: SourceMode): Promise<void> {
  await saveSources($, list => list.map(one => (one.id === id ? { ...one, mode } : one)))
}

async function removeSource($: $, id: string): Promise<void> {
  await saveSources($, list => list.filter(one => one.id !== id))
}

export function registerContext(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, tab)) !== 'context') return next(e)
    const ui: Ui = $.ui.resolve(e)
    const { Box, Text, Button, Input, Select } = ui
    // Reading isTurnRunning redraws the tab as each turn starts and ends, so
    // the window figures below are read fresh then.
    const isRunning = await read($, isTurnRunning)
    const usage = await $.session.usage({ breakdown: 'summary' })
    const list = await read($, sources)
    const draft = await read($, noteDraft)
    const status = await read($, linkStatus)

    const breakdown = usage.context.breakdown
    const used = breakdown?.totalTokens ?? usage.context.tokens ?? 0
    const window = breakdown?.rawMaxTokens ?? usage.context.window
    const percent = breakdown?.percentage ?? usage.context.percent ?? 0
    const categories = (breakdown?.categories ?? []).filter(one => one.kind === 'used' && one.tokens > 0)
    const last = breakdown?.apiUsage ?? null
    const barWidth = Math.max(10, Math.min(40, e.props.bodyColumns - 24))
    const enabledChars = list.filter(one => one.mode !== 'off').reduce((sum, one) => sum + one.text.length, 0)
    const enabledTokens = approxTokens(enabledChars)

    return frame(
      ui,
      'context',
      e.props.bodyColumns,
      (id: Tab) => void update($, tab, () => id),
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box gap={1}>
            <Text bold>Context window</Text>
            <Button key="usage-refresh" label="Refresh" hotkey="r" dimColor onPress={() => $.ui.invalidate('ui.render')} />
            {!isRunning && (
              <Button key="usage-compact" label="Compact" dimColor onPress={() => void $.session.compact({})} />
            )}
          </Box>
          <Text>
            <Text color={fillColor(percent)}>{bar(percent / 100, barWidth)}</Text> {percent}% · {tokens(used)} /{' '}
            {tokens(window)}
          </Text>
          {categories.map(category => (
            <Text>
              <Text dimColor>{category.name.slice(0, 18).padEnd(19)}</Text>
              {tokens(category.tokens).padStart(6)}{' '}
              <Text color="promptBorder">{bar(category.tokens / Math.max(1, used), 12)}</Text>
            </Text>
          ))}
          {last !== null && (
            <Text dimColor>
              Last response: in {tokens(last.input_tokens)} · out {tokens(last.output_tokens)} · cache read{' '}
              {tokens(last.cache_read_input_tokens)} · cache write {tokens(last.cache_creation_input_tokens)}
              {usage.cost === undefined ? '' : ` · session $${usage.cost.usd.toFixed(2)}`}
            </Text>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Library</Text>
          <Text color={enabledTokens > TOKEN_BUDGET ? 'error' : undefined} dimColor={enabledTokens <= TOKEN_BUDGET}>
            {enabledChars} chars · about {tokens(enabledTokens)} tokens of {tokens(TOKEN_BUDGET)} budget
          </Text>
          {list.length === 0 && <Text dimColor>No sources yet. Notes and links you add here reach the agent.</Text>}
          {list.map(source => (
            <Box flexDirection="column" marginTop={1}>
              <Text wrap="truncate-end">
                <Text bold>{source.title}</Text>
                <Text dimColor>
                  {' '}
                  {source.kind} · {source.text.length} chars
                </Text>
              </Text>
              <Box gap={1}>
                {Select === undefined ? (
                  <Text dimColor>{source.mode}</Text>
                ) : (
                  <Select
                    key={`mode-${source.id}`}
                    options={MODES}
                    value={source.mode}
                    onSelect={mode => void setMode($, source.id, mode as SourceMode)}
                  />
                )}
                <Button key={`remove-${source.id}`} label="Remove" dimColor onPress={() => void removeSource($, source.id)} />
              </Box>
            </Box>
          ))}
        </Box>

        {Input !== undefined && (
          <Box flexDirection="column">
            <Text bold>Add note</Text>
            <Input
              key="note-title"
              label="Title "
              placeholder="API conventions"
              value={draft.title}
              submitLabel="next"
              onInput={title => void update($, noteDraft, now => ({ ...now, title }))}
              onSubmit={title => void update($, noteDraft, now => ({ ...now, title }))}
            />
            <Input
              key="note-text"
              label="Text  "
              placeholder="What the agent should know"
              value={draft.text}
              submitLabel="add"
              onInput={text => void update($, noteDraft, now => ({ ...now, text }))}
              onSubmit={text => void (text.trim() === '' ? undefined : addNote($, text))}
            />
            <Text bold>Add link</Text>
            <Input key="link-url" label="URL   " placeholder="https://…" submitLabel="fetch" onSubmit={url => void addLink($, url)} />
            {status !== '' && <Text dimColor>{status}</Text>}
          </Box>
        )}
      </Box>,
    )
  })
}

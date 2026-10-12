// The API tab's engine, a simplified CommissionAI workbench: an OpenAPI
// reference, a sender shared by the person and the agent's api_send tool,
// and a log of the last exchanges. session.ts registers the tool.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, ToolSpec } from 'claude-code'

import type { ApiLens, ApiOp, ApiParam, Exchange, Tab } from '../types'
import { frame, PANE } from './ui'
import type { Ui } from './ui'

const apiLens = atom({ plugin: 'craft-shop', key: 'apiLens' } as const, 'reference')
const exchanges = atom({ plugin: 'craft-shop', key: 'exchanges' } as const, [])
const isApiUp = atom({ plugin: 'craft-shop', key: 'isApiUp' } as const, null)
const ops = atom({ plugin: 'craft-shop', key: 'ops' } as const, [])
const selectedExchange = atom({ plugin: 'craft-shop', key: 'selectedExchange' } as const, null)
const selectedOp = atom({ plugin: 'craft-shop', key: 'selectedOp' } as const, null)
const sendDraft = atom({ plugin: 'craft-shop', key: 'sendDraft' } as const, { method: 'GET', path: '/', body: '' })
const specStatus = atom({ plugin: 'craft-shop', key: 'specStatus' } as const, '')
const tab = atom({ plugin: 'craft-shop', key: 'tab' } as const, 'worktree')

type $ = EngineInterface

const TOOL_ID = 'mcp__craft-shop__api_send'
const LOG_LIMIT = 60
const BODY_CAP = 4_000
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$|token|secret/i
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
const SPEC_DIRS = ['', 'docs', 'api', 'spec', 'openapi', 'public']

type SendRequest = {
  actor: Exchange['actor']
  method: string
  path?: string
  url?: string
  headers?: Record<string, string>
  body?: string
  expectStatus?: number
}

function apiBase(options: PluginOptions): string {
  return String(options.apiBase || 'http://localhost:3000').replace(/\/+$/, '')
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, SECRET_HEADER.test(name) ? '••••' : value]),
  )
}

function headerLines(headers: Record<string, string>): string {
  return Object.entries(maskHeaders(headers))
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}

async function send($: $, options: PluginOptions, request: SendRequest): Promise<Exchange> {
  const method = request.method.toUpperCase()
  const base = apiBase(options)
  const path = request.path ?? ''
  const url = request.url ?? `${base}${path.startsWith('/') ? '' : '/'}${path}`
  const headers: Record<string, string> = { ...(request.headers ?? {}) }
  const body = request.body ?? ''
  if (body !== '' && !Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json'
  }

  const startedAt = await $.clock.now()
  let status: number | null = null
  let response: string
  try {
    const answered = await $.http.fetch(url, { method, headers, body: body === '' ? undefined : body })
    status = answered.status
    const text = answered.text.length > BODY_CAP ? `${answered.text.slice(0, BODY_CAP)}\n… cut at ${BODY_CAP} characters` : answered.text
    response = `${answered.status}\n${headerLines(answered.headers)}\n\n${text}`
  } catch (error) {
    $.ui.log(`api send ${method} ${url} failed: ${String(error)}`, { to: 'debug' })
    response = 'No response: the server could not be reached.'
  }
  const ms = (await $.clock.now()) - startedAt
  const expectStatus = request.expectStatus ?? null
  const isPass = expectStatus === null ? status !== null && status < 400 : status === expectStatus

  const exchange: Exchange = {
    id: `${startedAt.toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
    actor: request.actor,
    method,
    path: url.startsWith(base) ? url.slice(base.length) || '/' : url,
    url,
    status,
    ms,
    isPass,
    expectStatus,
    request: `${method} ${url}\n${headerLines(headers)}${body === '' ? '' : `\n\n${body}`}`,
    response,
  }
  await update($, exchanges, list => [...list, exchange].slice(-LOG_LIMIT))
  return exchange
}

async function probe($: $, options: PluginOptions): Promise<void> {
  try {
    await $.http.fetch(apiBase(options))
    await update($, isApiUp, () => true)
  } catch {
    // An unreachable server is the answer the probe exists to give.
    await update($, isApiUp, () => false)
  }
}

type Json = Record<string, unknown>

function asObject(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function sampleOf(schema: Json, depth = 0): unknown {
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if (depth > 4) return null
  switch (schema.type) {
    case 'object': {
      const properties = asObject(schema.properties)
      return Object.fromEntries(Object.entries(properties).map(([name, inner]) => [name, sampleOf(asObject(inner), depth + 1)]))
    }
    case 'array':
      return [sampleOf(asObject(schema.items), depth + 1)]
    case 'integer':
    case 'number':
      return 1
    case 'boolean':
      return true
    case 'string':
      return 'text'
    default:
      return null
  }
}

function requestExample(operation: Json): string | null {
  const json = asObject(asObject(asObject(operation.requestBody).content)['application/json'])
  if (Object.keys(json).length === 0) return null
  const examples = Object.values(asObject(json.examples))
  const example = json.example ?? asObject(examples[0]).value ?? sampleOf(asObject(json.schema))
  return JSON.stringify(example, null, 2)
}

function parseSpec(text: string): ApiOp[] {
  const spec = asObject(JSON.parse(text))
  const found: ApiOp[] = []
  for (const [path, item] of Object.entries(asObject(spec.paths))) {
    const shared = Array.isArray(asObject(item).parameters) ? (asObject(item).parameters as unknown[]) : []
    for (const [method, value] of Object.entries(asObject(item))) {
      if (!METHODS.includes(method)) continue
      const operation = asObject(value)
      const own = Array.isArray(operation.parameters) ? (operation.parameters as unknown[]) : []
      const params: ApiParam[] = [...shared, ...own].map(raw => {
        const param = asObject(raw)
        return {
          name: String(param.name ?? ''),
          in: String(param.in ?? ''),
          isRequired: param.required === true,
          type: String(asObject(param.schema).type ?? ''),
        }
      })
      const tags = Array.isArray(operation.tags) ? operation.tags : []
      found.push({
        id: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        tag: String(tags[0] ?? 'default'),
        summary: String(operation.summary ?? operation.operationId ?? ''),
        params,
        example: requestExample(operation),
        responses: Object.entries(asObject(operation.responses)).map(([status, response]) => ({
          status,
          description: String(asObject(response).description ?? ''),
        })),
      })
    }
  }
  return found
}

function examplePath(op: ApiOp): string {
  return op.path.replace(/\{([^}]+)\}/g, '1')
}

function matchesOp(op: ApiOp, exchange: Exchange): boolean {
  if (op.method !== exchange.method) return false
  const pattern = op.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+')
  return new RegExp(`^${pattern}(\\?.*)?$`).test(exchange.path)
}

async function findSpec($: $, options: PluginOptions): Promise<string | null> {
  const cwd = await $.session.cwd()
  const configured = String(options.openapiPath ?? '').trim()
  if (configured !== '') return configured.startsWith('/') ? configured : `${cwd}/${configured}`

  // From the working directory up to the checkout's top (the folder holding
  // .git, a file in a worktree), so a worktree finds its own copy.
  for (let dir = cwd; dir !== ''; dir = dir.slice(0, dir.lastIndexOf('/'))) {
    for (const sub of SPEC_DIRS) {
      const candidate = sub === '' ? `${dir}/openapi.json` : `${dir}/${sub}/openapi.json`
      if (await $.fs.exists(candidate)) return candidate
    }
    if (await $.fs.exists(`${dir}/.git`)) break
  }
  return null
}

async function loadSpec($: $, options: PluginOptions): Promise<void> {
  const path = await findSpec($, options)
  if (path === null) {
    await update($, ops, () => [])
    await update($, specStatus, () => 'No openapi.json found. Set openapiPath in /config to point at one.')
    return
  }
  try {
    const text = await $.fs.read(path)
    const parsed = parseSpec(typeof text === 'string' ? text : '')
    await update($, ops, () => parsed)
    const cwd = await $.session.cwd()
    const shown = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
    await update($, specStatus, () => `${parsed.length} operations from ${shown}`)
  } catch (error) {
    $.ui.log(`openapi read failed: ${String(error)}`, { to: 'debug' })
    await update($, ops, () => [])
    await update($, specStatus, () => 'The OpenAPI file could not be read as JSON.')
  }
}

function proofTable(list: Exchange[]): string {
  const rows = list.map((exchange, index) => {
    const expected = exchange.expectStatus ?? '<400'
    return `| ${index + 1} | ${exchange.actor} | \`${exchange.method} ${exchange.path}\` | ${exchange.status ?? 'none'} | ${expected} | ${exchange.ms} | ${exchange.isPass ? 'pass' : 'fail'} |`
  })
  const passed = list.filter(exchange => exchange.isPass).length
  return [
    `API proof: ${passed} of ${list.length} requests passed.`,
    '',
    '| # | By | Request | Status | Expected | ms | Result |',
    '| - | - | - | - | - | - | - |',
    ...rows,
  ].join('\n')
}

export const API_SEND_TOOL: ToolSpec = {
  name: 'api_send',
  description:
    "Send one HTTP request to the project's local API server and record it in the Craft Shop API log, where the user sees it. Use it to prove an endpoint works. Give `path` (joined to the configured base URL) or a full `url`. `expect_status` marks the exchange pass or fail.",
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      method: { type: 'string', description: 'GET, POST, PUT, PATCH or DELETE.' },
      path: { type: 'string', description: 'Path joined to the API base URL, such as /items?limit=2.' },
      url: { type: 'string', description: 'A full URL, used in place of path.' },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      body: { type: 'string', description: 'The request body as text, usually JSON.' },
      expect_status: { type: 'integer', description: 'The status that counts as a pass.' },
    },
    required: ['method'],
  },
}

function parseHeaders(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(asObject(value)).map(([name, inner]) => [name, String(inner)]))
}

export function registerApi(on: On, options: PluginOptions): void {
  on('tool.call', { tool: TOOL_ID }, async ($, e) => {
    const path = typeof e.path === 'string' ? e.path : undefined
    const url = typeof e.url === 'string' ? e.url : undefined
    if (typeof e.method !== 'string' || (path === undefined && url === undefined)) {
      return { deny: 'api_send needs a method and a path or url.' }
    }
    const exchange = await send($, options, {
      actor: 'agent',
      method: e.method,
      path,
      url,
      headers: parseHeaders(e.headers),
      body: typeof e.body === 'string' ? e.body : e.body === undefined ? undefined : JSON.stringify(e.body),
      expectStatus: typeof e.expect_status === 'number' ? e.expect_status : undefined,
    })
    const verdict = exchange.expectStatus === null ? '' : exchange.isPass ? ' (pass)' : ` (fail: expected ${exchange.expectStatus})`
    return { result: `${exchange.request}\n\n--- response in ${exchange.ms} ms${verdict}\n${exchange.response}` }
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    $.clock.after(0, () => void refresh($, options))
    return opened
  })

  on('ui.press', { plugin: 'craft-shop', element: 'tab-api' }, async ($, e, next) => {
    const pressed = await next(e)
    await refresh($, options)
    return pressed
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, tab)) !== 'api') return next(e)
    const ui: Ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const lens = await read($, apiLens)
    const up = await read($, isApiUp)
    const body =
      lens === 'reference' ? await reference($, ui, options) : lens === 'send' ? await sender($, ui, options) : await log($, ui)

    return frame(
      ui,
      'api',
      e.props.bodyColumns,
      (id: Tab) => void update($, tab, () => id),
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          <Text>
            <Text color={up === null ? 'inactive' : up ? 'success' : 'error'}>●</Text> {apiBase(options)}{' '}
            <Text dimColor>{up === null ? 'checking' : up ? 'up' : 'down'}</Text>
          </Text>
          <Button key="api-probe" label="Check again" dimColor onPress={() => void probe($, options)} />
        </Box>
        <Box gap={1}>
          {LENSES.map(one => (
            <Button
              key={`lens-${one.id}`}
              label={one.label}
              hotkey={one.hotkey}
              variant={one.id === lens ? 'primary' : undefined}
              onPress={() => void update($, apiLens, () => one.id)}
            />
          ))}
        </Box>
        {body}
      </Box>,
    )
  })
}

async function refresh($: $, options: PluginOptions): Promise<void> {
  await loadSpec($, options)
  await probe($, options)
}

const LENSES: { id: ApiLens; label: string; hotkey: string }[] = [
  { id: 'reference', label: 'Reference', hotkey: 'f' },
  { id: 'send', label: 'Send', hotkey: 's' },
  { id: 'log', label: 'Log', hotkey: 'l' },
]
const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(value => ({ value }))

function methodColor(method: string): string {
  switch (method) {
    case 'GET':
      return 'success'
    case 'POST':
      return 'suggestion'
    case 'DELETE':
      return 'error'
    default:
      return 'warning'
  }
}

function statusColor(status: number | null): string {
  return status === null || status >= 400 ? 'error' : 'success'
}

async function reference($: $, ui: Ui, options: PluginOptions) {
  const { Box, Text, Button } = ui
  const list = await read($, ops)
  const status = await read($, specStatus)
  const selected = await read($, selectedOp)
  const log = await read($, exchanges)
  const tags = [...new Set(list.map(op => op.tag))]

  const tryIt = (op: ApiOp) =>
    void send($, options, { actor: 'you', method: op.method, path: examplePath(op), body: op.example ?? undefined })
  const ask = (op: ApiOp) =>
    void $.prompt.fill({ text: `About \`${op.method} ${op.path}\`${op.summary === '' ? '' : ` (${op.summary})`}: ` })

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text dimColor>{status}</Text>
        <Button key="spec-reload" label="Reload" dimColor onPress={() => void loadSpec($, options)} />
      </Box>
      {tags.map(tag => (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{tag}</Text>
          {list
            .filter(op => op.tag === tag)
            .map(op => {
              const last = log.findLast(exchange => matchesOp(op, exchange))
              const isOpen = selected === op.id
              return (
                <Box flexDirection="column">
                  <Button
                    key={`op-${op.id}`}
                    plain
                    onPress={() => void update($, selectedOp, now => (now === op.id ? null : op.id))}
                  >
                    <Text color={methodColor(op.method)} bold>
                      {op.method.padEnd(7)}
                    </Text>
                    {op.path} <Text dimColor>{op.summary}</Text>
                    {last === undefined ? '' : ' '}
                    {last !== undefined && <Text color={statusColor(last.status)}>{String(last.status ?? '×')}</Text>}
                  </Button>
                  {isOpen && (
                    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
                      {op.params.length > 0 && <Text dimColor>Parameters</Text>}
                      {op.params.map(param => (
                        <Text>
                          {'  '}
                          {param.name} <Text dimColor>({param.in}{param.type === '' ? '' : `, ${param.type}`}{param.isRequired ? ', required' : ''})</Text>
                        </Text>
                      ))}
                      {op.example !== null && <Text dimColor>Request example</Text>}
                      {op.example !== null && <Text>{op.example}</Text>}
                      <Text dimColor>Responses</Text>
                      {op.responses.map(response => (
                        <Text>
                          {'  '}
                          {response.status} <Text dimColor>{response.description}</Text>
                        </Text>
                      ))}
                      <Box gap={1}>
                        <Button key={`try-${op.id}`} label="Try it" variant="primary" onPress={() => tryIt(op)} />
                        <Button key={`ask-${op.id}`} label="Ask about this" onPress={() => ask(op)} />
                      </Box>
                    </Box>
                  )}
                </Box>
              )
            })}
        </Box>
      ))}
    </Box>
  )
}

async function sender($: $, ui: Ui, options: PluginOptions) {
  const { Box, Text, Button, Input, Select } = ui
  const draft = await read($, sendDraft)
  if (Input === undefined || Select === undefined) return <Text dimColor>Sending needs a surface with text fields.</Text>

  const sendDraftNow = async () => {
    const now = await read($, sendDraft)
    await send($, options, { actor: 'you', method: now.method, path: now.path, body: now.body || undefined })
    await update($, apiLens, () => 'log')
  }

  return (
    <Box flexDirection="column">
      <Select
        key="send-method"
        label="Method "
        options={METHOD_OPTIONS}
        value={draft.method}
        onSelect={method => void update($, sendDraft, now => ({ ...now, method }))}
      />
      <Input
        key="send-path"
        label="Path   "
        value={draft.path}
        placeholder="/items"
        submitLabel="send"
        onInput={path => void update($, sendDraft, now => ({ ...now, path }))}
        onSubmit={async path => {
          await update($, sendDraft, now => ({ ...now, path }))
          await sendDraftNow()
        }}
      />
      <Input
        key="send-body"
        label="Body   "
        value={draft.body}
        placeholder='{"name": "…"}'
        submitLabel="send"
        onInput={body => void update($, sendDraft, now => ({ ...now, body }))}
        onSubmit={async body => {
          await update($, sendDraft, now => ({ ...now, body }))
          await sendDraftNow()
        }}
      />
      <Box>
        <Button key="send-go" label="Send" variant="primary" onPress={() => void sendDraftNow()} />
      </Box>
    </Box>
  )
}

async function log($: $, ui: Ui) {
  const { Box, Text, Button } = ui
  const list = await read($, exchanges)
  const selected = await read($, selectedExchange)

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text dimColor>{list.length} of the last 60</Text>
        {list.length > 0 && (
          <Button
            key="log-prove"
            label="Prove it"
            variant="primary"
            onPress={async () => void $.prompt.fill({ text: proofTable(await read($, exchanges)), mode: 'append' })}
          />
        )}
        {list.length > 0 && <Button key="log-clear" label="Clear" dimColor onPress={() => void update($, exchanges, () => [])} />}
      </Box>
      {list.length === 0 && <Text dimColor>No requests yet. Send one, press Try it, or ask the agent to use api_send.</Text>}
      {[...list].reverse().map(exchange => (
        <Box flexDirection="column">
          <Button
            key={`ex-${exchange.id}`}
            plain
            onPress={() => void update($, selectedExchange, now => (now === exchange.id ? null : exchange.id))}
          >
            <Text color={exchange.actor === 'agent' ? 'claude' : 'suggestion'}>{exchange.actor.padEnd(6)}</Text>
            <Text color={methodColor(exchange.method)}>{exchange.method.padEnd(7)}</Text>
            {exchange.path}{' '}
            <Text color={statusColor(exchange.status)}>{String(exchange.status ?? 'none')}</Text>
            <Text dimColor> {exchange.ms}ms </Text>
            <Text color={exchange.isPass ? 'success' : 'error'}>{exchange.isPass ? '✓' : '✗'}</Text>
          </Button>
          {selected === exchange.id && (
            <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
              <Text dimColor>Request</Text>
              <Text>{exchange.request}</Text>
              <Text dimColor>Response</Text>
              <Text>{exchange.response}</Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}


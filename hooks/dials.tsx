// Six of CommissionAI's crew dials (protocol/fixtures/dials.json), with the
// per-level prompts reworded for a Claude Code session: no task_blocked or
// task_complete tools, no board check command, no $COMMISSION_DEV_PORT. Some
// levels borrow practices from pStack (Lauren Tan, MIT): verdicts, a failing
// test before a fix, done-predicates for subagents, testing a shared premise.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { DialKey, DialValues, Tab } from '../types'
import { presetArt, switchArt } from './art'
import { enforcedRule } from './enforce'
import { chip, drawnButton, isRich, ON_OFF, segmented, svg, switchRow } from './kit'
import { setSetting } from './settings'
import { BALANCED, paneHeads, presetName, PRESETS } from './state'
import { bar, frame, PANE, resolveUi } from './ui'
import type { Ui } from './ui'

export { BALANCED, presetName }

const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const isBriefShown = atom({ plugin: 'fishstack', key: 'isBriefShown' } as const, false)
const selectedDial = atom({ plugin: 'fishstack', key: 'selectedDial' } as const, null)
const tab = atom({ plugin: 'fishstack', key: 'tab' } as const, null)
const isClientDown = atom({ plugin: 'fishstack', key: 'isClientDown' } as const, false)
const isDialsOn = atom({ plugin: 'fishstack', key: 'isDialsOn' } as const, true)

// The Use dials switch, kept across sessions for each repository. Off, the agent gets no working
// style and the dials do nothing; their settings are kept for when it is on.
export const DIALS_ON_KEY = 'useDials'

async function setDialsOn($: EngineInterface, isOn: boolean): Promise<void> {
  await setSetting($, DIALS_ON_KEY, isOn)
  await update($, isDialsOn, () => isOn)
}

// The Enforce switch, kept across sessions for each repository: on, the rules enforce.ts can
// check hold the agent to some levels in code; off, the dials are the
// prompt alone.
const isEnforced = atom({ plugin: 'fishstack', key: 'isEnforced' } as const, true)
export const ENFORCE_KEY = 'enforceDials'

async function setEnforced($: EngineInterface, isOn: boolean): Promise<void> {
  await setSetting($, ENFORCE_KEY, isOn)
  await update($, isEnforced, () => isOn)
}

type Level = { label: string; summary: string; prompt: string }
type Dial = { key: DialKey; name: string; question: string; levels: Level[] }

const DIALS: Dial[] = [
  {
    key: 'foresight',
    name: 'Foresight',
    question: 'How much it plans before editing',
    levels: [
      { label: 'Dive in', summary: 'Starts editing right away.', prompt: 'Start editing right away. Do not write a plan or spec first.' },
      { label: 'Sketch', summary: 'States a two-line approach first.', prompt: 'Before editing, state your approach in two or three lines.' },
      { label: 'Plan steps', summary: 'Lists the steps and files before editing.', prompt: 'Before changing any file, post a message listing the steps you will take and the files you expect to touch.' },
      { label: 'Write a spec', summary: 'Writes a short spec with acceptance criteria before any code.', prompt: 'Before changing any file, post a short spec as a message: the problem, your approach, the files involved and the acceptance criteria. Then implement it.' },
      { label: 'Deep spec', summary: 'Researches, brainstorms options, grills its own plan and writes a full spec before any code.', prompt: 'Research the relevant code and brainstorm at least three approaches. Before changing any file, post two messages: your self-grilling, answering what a skeptical reviewer would reject, which inputs break the plan, what else could break, what the smallest version is and what would prove it works; then a full spec with the headings Problem, Constraints, Approach, Alternatives considered, Edge cases, Risks, Files, Acceptance criteria.' },
    ],
  },
  {
    key: 'crew',
    name: 'Crew',
    question: 'How readily it starts subagents',
    levels: [
      { label: 'Solo', summary: 'Works alone and never starts subagents.', prompt: 'Do all the work yourself. Do not start subagents or parallel tasks.' },
      { label: 'Scouts', summary: 'Sends one scout to find the code, then works alone.', prompt: 'Before editing, start one subagent as a scout to find the code that matters (file paths and short findings, not code). Make every edit yourself and delegate nothing else. Give the scout a fast, cheaper model if the Agent tool lets you pick one: it only reads.' },
      { label: 'Helpers', summary: 'A scout up front. You keep the implementation.', prompt: 'Start one scout subagent to find the relevant code. Keep the core implementation yourself. On design work (UI or visual design, architecture, schema or API shape), also start one fresh subagent to critique your design in writing (what breaks, with evidence, and a simpler option) before you build.' },
      { label: 'Squads', summary: 'One parallel subagent per independent part.', prompt: 'Do not write the parts yourself. Split the implementation into independent parts and start one subagent per part with the Agent tool, all in one message so they run in parallel, even when a part is small. First state what done means. Give each part its own files: parts that share a file run one after another. Each subagent ends with PASS, ISSUES or BLOCKED and its evidence; a part with no such report is a gap, not a pass. Then integrate the results yourself. On design work, first convene a council of two subagents that each propose a design independently and then give each other written feedback, and merge the best of both before you build.' },
      { label: 'Swarm', summary: 'Fans out to dozens of fast, cheap subagents, as many as the work parallelizes.', prompt: 'Do not investigate or write the parts yourself. Start one investigator subagent per area first, then one subagent per independent part, all in parallel; use at least two subagents even on a small task. Say first whether they split the work or race at the same problem. On a larger one swarm: one subagent per file, call site, test or question that can run independently, as many as the work has parts, on the fastest cheapest model you have, until more subagents would only add coordination. You only integrate the results. On design work, convene a council of three subagents proposing from different angles, have one more subagent write feedback on each and recommend a base, then merge and have it check the merge before you build.' },
    ],
  },
  {
    key: 'tenacity',
    name: 'Tenacity',
    question: 'How hard it pushes to finish',
    levels: [
      { label: 'One pass', summary: 'One attempt, then reports back. No retries.', prompt: 'Make one focused attempt. If you hit a blocker, stop and end your turn saying what blocked you instead of working around it.' },
      { label: 'Retry once', summary: 'Tries one alternative before stopping.', prompt: 'If an approach fails, try one alternative before stopping to report the blocker.' },
      { label: 'Push through', summary: 'Works around blockers it can solve itself.', prompt: 'Work around obstacles you can solve yourself before stopping to report a blocker. After two failed fixes that rest on the same assumption, write the assumption down and test it before a third.' },
      { label: 'Checklist', summary: 'Keeps a checklist and keeps going until every item is done.', prompt: 'Before editing, post a message headed Checklist with one line per thing the request requires, tests and cleanup included. Keep working until every line is done, then list each line with its status under a Checklist heading in your final message. Only stop early for things you cannot resolve yourself.' },
      { label: 'Goal mode', summary: 'Sets acceptance criteria and keeps going until each one is verified.', prompt: 'Treat this request as a goal. Before editing, write explicit, testable acceptance criteria as a numbered checklist in a message headed Acceptance criteria, each naming the command or check that will verify it. Keep working until every criterion is verified with evidence you produced, never weakening a criterion to call it met (a plateau is not a stop), and list each one with its evidence under an Acceptance criteria heading in your final message. Only stop early for things that need the user.' },
    ],
  },
  {
    key: 'autonomy',
    name: 'Autonomy',
    question: 'How often it asks you',
    levels: [
      { label: 'Ask first', summary: 'Stops to ask about any decision the request leaves open before editing.', prompt: 'Before editing, look for decisions the request leaves open, such as behavior, naming, scope or dependencies. If there are any, ask with AskUserQuestion right away, giving the options and your recommendation, and do not change files until the user answers.' },
      { label: 'Check in', summary: 'Asks about product and scope decisions.', prompt: 'If the request leaves a product, scope or public API decision open, ask with AskUserQuestion, giving the options and your recommendation, before building that part. Decide implementation details yourself.' },
      { label: 'When unsure', summary: 'Asks only when it is genuinely unsure.', prompt: 'Decide routine questions yourself. Ask with AskUserQuestion when the answer is a business fact you cannot find in the code or project context (a rate, price, policy, deadline or approver), or when a wrong guess would be costly to undo.' },
      { label: 'Decide, note', summary: 'Makes the call and records it in the summary.', prompt: 'Make judgment calls yourself and list each one with its reasoning in your final message. Ask only when the work cannot continue without the user. If running something could answer a question, run it instead of asking. You may act outside the repository when it is reversible, but ask before messaging people.' },
      { label: 'Autopilot', summary: 'Works as if the user is away: never asks, clears its own blockers, never deletes data.', prompt: 'Assume the user is away and will never answer: do not ask, decide every open question, clear your own blockers, and act outside the repository whenever it helps (other apps, connected tools, services). Message people only when the work cannot move without them, such as a review approval. Never delete data. Never force-push or deploy to production without the user. Record each decision in your final message. If you must ask with AskUserQuestion, put your recommended option first and end its label with (Recommended): when nobody answers within 15 minutes it is chosen for you.' },
    ],
  },
  {
    key: 'proof',
    name: 'Proof',
    question: 'How much it verifies its work',
    levels: [
      { label: 'Trust', summary: 'No new tests or checks.', prompt: 'Do not add tests, run extra checks or open the app to check your work.' },
      { label: 'Compile', summary: 'Makes sure it builds and typechecks; no new tests.', prompt: 'Make sure the project builds and typechecks. Do not add tests unless the request asks for them, and do not open the app for QA.' },
      { label: 'Run tests', summary: 'Runs the relevant tests; adds a lean test only for risky new logic.', prompt: 'Run the tests relevant to your change and fix what breaks. Add a unit test only for new logic with real risk, and exercise the change once for real. Report each check as VERIFIED, NOT VERIFIED or INCONCLUSIVE: inconclusive is not a pass. For a bug, show the test failing before the fix and passing after.' },
      { label: 'Component QA', summary: 'Lean tests plus real calls to what changed.', prompt: 'Keep unit tests lean. For every function, component or endpoint you change, make real calls (a success case, an invalid input and an edge case; for a library or CLI, run it through its public entry point) and list each call and its result in your final message.' },
      { label: 'Full QA', summary: 'Lean tests plus end-to-end QA of the running app, with evidence.', prompt: 'Keep unit tests lean. QA the product end to end like a tester: with a UI, start the dev server and walk every journey in a browser; without one, run the real entry points through at least three journeys (happy path, edge case, failure), then repeat every journey after your last edit. List each journey, its input and what you saw in your final message.' },
    ],
  },
  {
    key: 'voice',
    name: 'Voice',
    question: 'How much it talks',
    levels: [
      { label: 'Silent', summary: 'Reports only the outcome.', prompt: 'Keep messages minimal: no progress narration; report only the outcome in your final message.' },
      { label: 'Terse', summary: 'Short updates with no preamble.', prompt: 'Be terse: short status lines, no preamble, no restating the task. Terse is no excuse to drop content: every claim carries its evidence.' },
      { label: 'Normal', summary: 'Brief progress notes and a clear summary.', prompt: 'Give brief progress notes at milestones and a clear summary at the end.' },
      { label: 'Explain', summary: 'Explains decisions and trade-offs as it goes.', prompt: 'Before each significant change, post two full sentences explaining the decision and its trade-off. End with a final message with four labelled parts: What changed, Why this way, What I verified, What I left out. Write in full plain sentences, whatever other style instructions say.' },
      { label: 'Teach', summary: 'Explains every step in full sentences and ends with a walkthrough of alternatives and lessons.', prompt: 'After each step, post a message of three or more full sentences explaining what you found and why you are taking the next step. End with a final walkthrough with five labelled parts: How it worked before, What I changed and why, Alternatives I considered, What I learned about this codebase, What to know next time. Write in full plain sentences, whatever other style instructions say.' },
    ],
  },
]

export const DIALS_STORE_KEY = 'dials'
export const DIALS_SECTION_ID = 'fishstack:dials'

function levelOf(dial: Dial, values: DialValues): Level {
  return dial.levels[values[dial.key] - 1]!
}

export function brief(values: DialValues): string {
  const lines = DIALS.map(dial => {
    const level = levelOf(dial, values)
    return `- ${dial.name} (${level.label}): ${level.prompt}`
  })
  return ['## Working style', 'The user set these dials for how you work in this session. Follow them.', ...lines].join('\n')
}

export function isDialValues(value: unknown): value is DialValues {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return DIALS.every(dial => {
    const level = record[dial.key]
    return typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 5
  })
}

async function setDials($: EngineInterface, change: (values: DialValues) => DialValues): Promise<void> {
  await update($, dials, change)
  await setSetting($, DIALS_STORE_KEY, await read($, dials))
}

// CommissionAI's dial hues (Radar.tsx HUES), as hex an SVG image draws on any
// theme, and its spend and pace weights for the six dials kept here.
const COLOR: Record<DialKey, string> = {
  foresight: '#8f9cff',
  crew: '#5aaeff',
  tenacity: '#22c4dc',
  autonomy: '#2fcfa6',
  proof: '#74d16f',
  voice: '#d8bf45',
}

const SPEND: Record<DialKey, number[]> = {
  foresight: [0.9, 0.95, 1, 1.08, 1.15],
  crew: [0.9, 0.95, 1, 1.3, 1.7],
  tenacity: [0.7, 0.85, 1, 1.25, 1.6],
  autonomy: [1, 1, 1, 1, 1],
  proof: [0.9, 0.95, 1, 1.1, 1.25],
  voice: [0.95, 0.97, 1, 1.05, 1.1],
}

const PACE: Record<DialKey, number[]> = {
  foresight: [0.9, 0.95, 1, 1.1, 1.2],
  crew: [1.05, 1.02, 1, 0.9, 0.8],
  tenacity: [0.7, 0.85, 1, 1.2, 1.5],
  autonomy: [1.4, 1.2, 1, 0.95, 0.9],
  proof: [0.9, 0.95, 1, 1.15, 1.3],
  voice: [1, 1, 1, 1.03, 1.06],
}

const ASKS = ['Often', 'On big calls', 'When unsure', 'Rarely', 'Almost never']

export function estimate(values: DialValues): { spend: number; pace: number; paceLabel: string; asks: string } {
  const spend = Math.max(0.4, 1 + 0.5 * DIALS.reduce((total, dial) => total + SPEND[dial.key][values[dial.key] - 1]! - 1, 0))
  const pace = DIALS.reduce((total, dial) => total * PACE[dial.key][values[dial.key] - 1]!, 1)
  const paceLabel = pace < 0.8 ? 'Quick' : pace < 1.15 ? 'Normal' : pace < 1.6 ? 'Longer' : 'Long haul'
  return { spend, pace, paceLabel, asks: ASKS[values.autonomy - 1]! }
}

function spendText(spend: number): string {
  const percent = Math.round((spend - 1) * 100)
  return percent === 0 ? 'Baseline' : `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`
}

const RADAR_W = 360
const RADAR_H = 300
const RADIUS = 104

function point(index: number, level: number): [number, number] {
  const angle = ((-90 + (index * 360) / DIALS.length) * Math.PI) / 180
  const reach = RADIUS * (level / 5)
  return [RADAR_W / 2 + Math.cos(angle) * reach, RADAR_H / 2 + Math.sin(angle) * reach]
}

function polygon(levels: number[]): string {
  return levels.map((level, index) => point(index, level).map(n => n.toFixed(1)).join(',')).join(' ')
}

// The radar of CommissionAI's Dials page: rings per level, the dial shape
// filled with the dials' hues, a dot per dial and its name and level.
export function radar(values: DialValues, selected: DialKey | null): string {
  const levels = DIALS.map(dial => values[dial.key])
  const rings = [1, 2, 3, 4, 5]
    .map(ring => `<polygon points="${polygon(DIALS.map(() => ring))}" fill="none" stroke="#8b949e" stroke-opacity="${ring === 5 ? 0.45 : 0.2}" stroke-dasharray="${ring === 5 ? '' : '2 3'}"/>`)
    .join('')
  const spokes = DIALS.map((_, index) => {
    const [x, y] = point(index, 5)
    return `<line x1="${RADAR_W / 2}" y1="${RADAR_H / 2}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#8b949e" stroke-opacity="0.22"/>`
  }).join('')
  const stops = DIALS.map((dial, index) => `<stop offset="${((index / (DIALS.length - 1)) * 100).toFixed(0)}%" stop-color="${COLOR[dial.key]}"/>`).join('')
  const edges = DIALS.map((dial, index) => {
    const [x1, y1] = point(index, levels[index]!)
    const [x2, y2] = point((index + 1) % DIALS.length, levels[(index + 1) % DIALS.length]!)
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${COLOR[dial.key]}" stroke-width="2.4" stroke-linecap="round"/>`
  }).join('')
  const dots = DIALS.map((dial, index) => {
    const [x, y] = point(index, levels[index]!)
    const isSelected = dial.key === selected
    const halo = isSelected ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="${COLOR[dial.key]}" fill-opacity="0.25"/>` : ''
    return `${halo}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isSelected ? 7 : 5.5}" fill="${COLOR[dial.key]}" stroke="#1b1d22" stroke-width="2"/>`
  }).join('')
  const labels = DIALS.map((dial, index) => {
    const [x, y] = point(index, 6.3)
    const anchor = Math.abs(x - RADAR_W / 2) < 4 ? 'middle' : x < RADAR_W / 2 ? 'end' : 'start'
    const isSelected = dial.key === selected
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" font-family="-apple-system, system-ui, sans-serif" font-size="13" font-weight="${isSelected ? 600 : 400}" fill="${isSelected ? COLOR[dial.key] : '#9aa1ab'}">${dial.name} <tspan fill="${isSelected ? COLOR[dial.key] : '#6e7681'}">${levels[index]}</tspan></text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RADAR_W}" height="${RADAR_H}" viewBox="0 0 ${RADAR_W} ${RADAR_H}"><defs><linearGradient id="fill" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient><radialGradient id="glow"><stop offset="0%" stop-color="#8f9cff" stop-opacity="0.10"/><stop offset="100%" stop-color="#8f9cff" stop-opacity="0"/></radialGradient></defs><circle cx="${RADAR_W / 2}" cy="${RADAR_H / 2}" r="${RADIUS * 1.25}" fill="url(#glow)"/>${rings}${spokes}<polygon points="${polygon(levels)}" fill="url(#fill)" fill-opacity="0.28"/>${edges}${dots}${labels}</svg>`
}

function pips(level: number, color: string): string {
  const cells = [1, 2, 3, 4, 5]
    .map(index => `<rect x="${(index - 1) * 22}" y="0" width="18" height="18" rx="5" fill="${index <= level ? color : '#8b949e'}" fill-opacity="${index <= level ? 1 : 0.22}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="106" height="18" viewBox="0 0 106 18">${cells}</svg>`
}


// What the radar's Client posts: a dial and its level, and whether the press
// selects that dial. Posted by code, so checked before it moves anything.
function isRadarPost(data: unknown): data is { dial: number; level: number; select?: number } {
  const post = data as { dial?: unknown; level?: unknown } | null
  return (
    post !== null &&
    typeof post === 'object' &&
    Number.isInteger(post.dial) &&
    Number.isInteger(post.level) &&
    (post.dial as number) >= 0 &&
    (post.dial as number) < DIALS.length &&
    (post.level as number) >= 1 &&
    (post.level as number) <= 5
  )
}

export function registerDials(on: On): void {
  on('ui.message', { element: 'radar-drag' }, async ($, e, next) => {
    if (!isRadarPost(e.data)) return next(e)
    const dial = DIALS[e.data.dial]!
    const level = e.data.level
    if (e.data.select !== undefined) await update($, selectedDial, () => dial.key)
    await setDials($, now => ({ ...now, [dial.key]: level }))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, tab)) !== 'dials') return next(e)
    const ui: Ui = resolveUi($.ui.resolve(e), e.surface, await read($, isClientDown))
    const { Box, Text, Button, Markdown } = ui
    const { Client } = ui
    const rich = isRich(ui)
    const values = await read($, dials)
    const selected = await read($, selectedDial)
    const isShown = await read($, isBriefShown)
    const current = presetName(values)
    const columns = e.props.bodyColumns
    // The radar only where the pane is wide; a sidebar keeps the rows.
    const isWide = columns >= 86
    const guess = estimate(values)
    const pick = (key: DialKey, level: number) => void setDials($, now => ({ ...now, [key]: Math.min(5, Math.max(1, level)) }))
    const isOn = await read($, isDialsOn)
    const isEnforcing = await read($, isEnforced)
    const select = (id: Tab | null) => void update($, tab, () => id)
    const heads = await paneHeads($)

    const setting = switchRow(ui, 'dials-on', 'Use dials', isOn, isOn ? 'The agent works the way these dials say.' : 'The agent gets no working style.', turned => void setDialsOn($, turned))
    if (!isOn) return frame(ui, 'dials', columns, select, setting, heads)

    const presets = (
      <Box key="presets" gap={1} flexWrap="wrap" alignItems="center">
        {PRESETS.map(preset => {
          const isActive = preset.name === current
          const art = presetArt(preset.name, DIALS.map(dial => preset.values[dial.key]), isActive)
          return (
            drawnButton(ui, `preset-${preset.name}`, art.source, preset.name, art.width, art.height, () => void setDials($, () => preset.values)) ?? (
              <Button key={`preset-${preset.name}`} label={preset.name} variant={isActive ? 'primary' : undefined} dimColor={!isActive} onPress={() => void setDials($, () => preset.values)} />
            )
          )
        })}
        {current === 'Custom' && chip(ui, 'Custom', 'claude')}
      </Box>
    )

    const radarBox = isWide && rich && (
      <Box key="radar-box" justifyContent="center">
        <Box key="radar" position="relative">
          {svg(ui, radar(values, selected), `Dials: ${summaryOf(values)}. Drag a dot to change its level.`, RADAR_W, RADAR_H)}
          {Client !== undefined && (
            <Box position="absolute" top={0} left={0} right={0} bottom={0}>
              <Client key="radar-drag" module="./radar-drag.tsx" props={{ levels: DIALS.map(dial => values[dial.key]), width: RADAR_W, height: RADAR_H, radius: RADIUS }} width="100%" height="100%" />
            </Box>
          )}
        </Box>
      </Box>
    )

    // One row a dial: its name opens what it does and what the agent is told.
    const dialRow = (dial: Dial) => {
      const level = levelOf(dial, values)
      const value = values[dial.key]
      const isSelected = selected === dial.key
      const color = COLOR[dial.key]
      const rule = isEnforcing ? enforcedRule(dial.key, value) : null
      return (
        <Box key={`card-${dial.key}`} flexDirection="column">
          <Box justifyContent="space-between" alignItems="center" gap={1}>
            <Box gap={1} alignItems="center" flexShrink={1}>
              <Button key={`dial-${dial.key}`} plain onPress={() => void update($, selectedDial, now => (now === dial.key ? null : dial.key))}>
                <Text bold color={isSelected ? color : undefined}>
                  {dial.name.padEnd(10)}
                </Text>
              </Button>
              {rich ? (
                svg(ui, pips(value, color), `${dial.name} ${value} of 5`, 106, 18)
              ) : (
                <Box>
                  {dial.levels.map((_, index) => (
                    <Button key={`pip-${dial.key}-${index + 1}`} plain onPress={() => pick(dial.key, index + 1)}>
                      {index < value ? <Text color={color}>■</Text> : <Text dimColor>□</Text>}
                    </Button>
                  ))}
                </Box>
              )}
            </Box>
            {rich ? (
              <Box gap={1} alignItems="center" flexShrink={0}>
                <Button key={`less-${dial.key}`} label="−" dimColor onPress={() => pick(dial.key, value - 1)} />
                <Button key={`more-${dial.key}`} label="+" dimColor onPress={() => pick(dial.key, value + 1)} />
              </Box>
            ) : (
              <Text color={color} wrap="truncate-end">
                {level.label}
              </Text>
            )}
          </Box>
          {rich && (
            <Text color={color} wrap="truncate-end">
              {level.label}
            </Text>
          )}
          {isSelected && (
            <Box flexDirection="column" paddingLeft={1}>
              <Text wrap="wrap" dimColor>
                {dial.question}: {level.summary}
              </Text>
              {rule !== null && (
                <Text wrap="wrap" dimColor>
                  <Text color={color}>Enforced:</Text> {rule}
                </Text>
              )}
              <Text wrap="wrap">{level.prompt}</Text>
            </Box>
          )}
        </Box>
      )
    }

    return frame(
      ui,
      'dials',
      columns,
      select,
      <Box flexDirection="column" gap={1}>
        {setting}
        {presets}
        {radarBox}
        <Text dimColor wrap="wrap">
          {spendText(guess.spend)} spend · {guess.paceLabel.toLowerCase()} · asks {guess.asks.toLowerCase()}
        </Text>
        <Box flexDirection="column" gap={rich ? 1 : 0}>
          {DIALS.map(dialRow)}
        </Box>
        <Box key="dials-more" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
          <Box gap={1} alignItems="center">
            <Text dimColor>Enforce</Text>
            {drawnButton(ui, 'dials-enforce', switchArt(isEnforcing ? 'on' : 'off'), `Enforce: ${isEnforcing ? 'on' : 'off'}`, 36, 22, () => void setEnforced($, !isEnforcing)) ??
              segmented(ui, 'dials-enforce', ON_OFF, isEnforcing ? 'on' : 'off', choice => void setEnforced($, choice === 'on'))}
          </Box>
          <Button key="brief-toggle" label={isShown ? 'Hide brief' : 'What agents are told'} hotkey="w" dimColor onPress={() => void update($, isBriefShown, now => !now)} />
        </Box>
        {isShown && <Markdown text={brief(values)} />}
      </Box>,
      heads,
    )
  })
}

function summaryOf(values: DialValues): string {
  return DIALS.map(dial => `${dial.name} ${values[dial.key]}`).join(', ')
}

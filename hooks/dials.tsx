// Six of CommissionAI's crew dials (protocol/fixtures/dials.json), with the
// per-level prompts reworded for a Claude Code session: no task_blocked or
// task_complete tools, no board check command, no $COMMISSION_DEV_PORT.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { DialKey, DialValues, Tab } from '../types'
import { frame, PANE } from './ui'

export const BALANCED: DialValues = { foresight: 3, crew: 3, tenacity: 3, autonomy: 3, proof: 3, voice: 3 }

const dials = atom({ plugin: 'craft-shop', key: 'dials' } as const, BALANCED)
const isBriefShown = atom({ plugin: 'craft-shop', key: 'isBriefShown' } as const, false)
const selectedDial = atom({ plugin: 'craft-shop', key: 'selectedDial' } as const, null)
const tab = atom({ plugin: 'craft-shop', key: 'tab' } as const, 'worktree')

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
      { label: 'Scouts', summary: 'Sends one scout to find the code, then works alone.', prompt: 'Before editing, start one subagent as a scout to find the code that matters (file paths and short findings, not code). Make every edit yourself and delegate nothing else.' },
      { label: 'Helpers', summary: 'A scout up front. You keep the implementation.', prompt: 'Start one scout subagent to find the relevant code. Keep the core implementation yourself. On design work (UI or visual design, architecture, schema or API shape), also start one fresh subagent to critique your design in writing (what breaks, with evidence, and a simpler option) before you build.' },
      { label: 'Squads', summary: 'One parallel subagent per independent part.', prompt: 'Do not write the parts yourself. Split the implementation into independent parts and start one subagent per part with the Agent tool, all in one message so they run in parallel, even when a part is small. Then integrate the results yourself. On design work, first convene a council of two subagents that each propose a design independently and then give each other written feedback, and merge the best of both before you build.' },
      { label: 'Swarm', summary: 'Fans out to dozens of fast, cheap subagents, as many as the work parallelizes.', prompt: 'Do not investigate or write the parts yourself. Start one investigator subagent per area first, then one subagent per independent part, all in parallel; use at least two subagents even on a small task. On a larger one swarm: one subagent per file, call site, test or question that can run independently, as many as the work has parts, on the fastest cheapest model you have, until more subagents would only add coordination. You only integrate the results. On design work, convene a council of three subagents proposing from different angles, have one more subagent write feedback on each and recommend a base, then merge and have it check the merge before you build.' },
    ],
  },
  {
    key: 'tenacity',
    name: 'Tenacity',
    question: 'How hard it pushes to finish',
    levels: [
      { label: 'One pass', summary: 'One attempt, then reports back. No retries.', prompt: 'Make one focused attempt. If you hit a blocker, stop and end your turn saying what blocked you instead of working around it.' },
      { label: 'Retry once', summary: 'Tries one alternative before stopping.', prompt: 'If an approach fails, try one alternative before stopping to report the blocker.' },
      { label: 'Push through', summary: 'Works around blockers it can solve itself.', prompt: 'Work around obstacles you can solve yourself before stopping to report a blocker.' },
      { label: 'Checklist', summary: 'Keeps a checklist and keeps going until every item is done.', prompt: 'Before editing, post a message headed Checklist with one line per thing the request requires, tests and cleanup included. Keep working until every line is done, then list each line with its status under a Checklist heading in your final message. Only stop early for things you cannot resolve yourself.' },
      { label: 'Goal mode', summary: 'Sets acceptance criteria and keeps going until each one is verified.', prompt: 'Treat this request as a goal. Before editing, write explicit, testable acceptance criteria as a numbered checklist in a message headed Acceptance criteria, each naming the command or check that will verify it. Keep working until every criterion is verified with evidence you produced, and list each one with its evidence under an Acceptance criteria heading in your final message. Only stop early for things that need the user.' },
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
      { label: 'Decide, note', summary: 'Makes the call and records it in the summary.', prompt: 'Make judgment calls yourself and list each one with its reasoning in your final message. Ask only when the work cannot continue without the user. You may act outside the repository when it is reversible, but ask before messaging people.' },
      { label: 'Autopilot', summary: 'Works as if the user is away: never asks, clears its own blockers, never deletes data.', prompt: 'Assume the user is away and will never answer: do not ask, decide every open question, clear your own blockers, and act outside the repository whenever it helps (other apps, connected tools, services). Message people only when the work cannot move without them, such as a review approval. Never delete data. Record each decision in your final message.' },
    ],
  },
  {
    key: 'proof',
    name: 'Proof',
    question: 'How much it verifies its work',
    levels: [
      { label: 'Trust', summary: 'No new tests or checks.', prompt: 'Do not add tests, run extra checks or open the app to check your work.' },
      { label: 'Compile', summary: 'Makes sure it builds and typechecks; no new tests.', prompt: 'Make sure the project builds and typechecks. Do not add tests unless the request asks for them, and do not open the app for QA.' },
      { label: 'Run tests', summary: 'Runs the relevant tests; adds a lean test only for risky new logic.', prompt: 'Run the tests relevant to your change and fix what breaks. Add a unit test only for new logic with real risk, and exercise the change once for real.' },
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
      { label: 'Terse', summary: 'Short updates with no preamble.', prompt: 'Be terse: short status lines, no preamble, no restating the task.' },
      { label: 'Normal', summary: 'Brief progress notes and a clear summary.', prompt: 'Give brief progress notes at milestones and a clear summary at the end.' },
      { label: 'Explain', summary: 'Explains decisions and trade-offs as it goes.', prompt: 'Before each significant change, post two full sentences explaining the decision and its trade-off. End with a final message with four labelled parts: What changed, Why this way, What I verified, What I left out. Write in full plain sentences, whatever other style instructions say.' },
      { label: 'Teach', summary: 'Explains every step in full sentences and ends with a walkthrough of alternatives and lessons.', prompt: 'After each step, post a message of three or more full sentences explaining what you found and why you are taking the next step. End with a final walkthrough with five labelled parts: How it worked before, What I changed and why, Alternatives I considered, What I learned about this codebase, What to know next time. Write in full plain sentences, whatever other style instructions say.' },
    ],
  },
]

const PRESETS: { name: string; values: DialValues }[] = [
  { name: 'Balanced', values: BALANCED },
  { name: 'Quick', values: { foresight: 1, crew: 1, tenacity: 2, autonomy: 4, proof: 2, voice: 2 } },
  { name: 'Deep work', values: { foresight: 4, crew: 3, tenacity: 4, autonomy: 3, proof: 4, voice: 3 } },
  { name: 'Autopilot', values: { foresight: 4, crew: 3, tenacity: 5, autonomy: 5, proof: 4, voice: 2 } },
]

export const DIALS_STORE_KEY = 'dials'
export const DIALS_SECTION_ID = 'craft-shop:dials'

function levelOf(dial: Dial, values: DialValues): Level {
  return dial.levels[values[dial.key] - 1]!
}

function presetName(values: DialValues): string {
  const preset = PRESETS.find(one => DIALS.every(dial => one.values[dial.key] === values[dial.key]))
  return preset?.name ?? 'Custom'
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
  await $.store.set(DIALS_STORE_KEY, await read($, dials))
}

export function registerDials(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, tab)) !== 'dials') return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = ui
    const values = await read($, dials)
    const selected = await read($, selectedDial)
    const isShown = await read($, isBriefShown)
    const current = presetName(values)

    return frame(
      ui,
      'dials',
      e.props.bodyColumns,
      (id: Tab) => void update($, tab, () => id),
      <Box flexDirection="column" gap={1}>
        <Box gap={1} flexWrap="wrap">
          {PRESETS.map(preset => (
            <Button
              key={`preset-${preset.name}`}
              label={preset.name}
              variant={preset.name === current ? 'primary' : undefined}
              onPress={() => void setDials($, () => preset.values)}
            />
          ))}
          {current === 'Custom' && <Text color="claude">Custom</Text>}
        </Box>

        <Box flexDirection="column">
          {DIALS.map(dial => {
            const level = levelOf(dial, values)
            const isSelected = selected === dial.key
            return (
              <Box flexDirection="column">
                <Box>
                  <Button
                    key={`dial-${dial.key}`}
                    plain
                    onPress={() => void update($, selectedDial, now => (now === dial.key ? null : dial.key))}
                  >
                    <Text bold={isSelected}>{(isSelected ? '▾ ' : '▸ ') + dial.name.padEnd(10)}</Text>
                  </Button>
                  {dial.levels.map((_, index) => (
                    <Button
                      key={`pip-${dial.key}-${index + 1}`}
                      plain
                      onPress={() => void setDials($, now => ({ ...now, [dial.key]: index + 1 }))}
                    >
                      {index < values[dial.key] ? <Text color="claude">●</Text> : <Text dimColor>○</Text>}
                    </Button>
                  ))}
                  <Text wrap="truncate-end">
                    {'  '}
                    {level.label}. <Text dimColor>{level.summary}</Text>
                  </Text>
                </Box>
                {isSelected && (
                  <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
                    <Text dimColor>{dial.question}</Text>
                    <Text>{level.prompt}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column">
          <Button
            key="brief-toggle"
            label={isShown ? 'Hide what agents are told' : 'What agents are told'}
            hotkey="w"
            onPress={() => void update($, isBriefShown, now => !now)}
          />
          {isShown && <Markdown text={brief(values)} />}
        </Box>
      </Box>,
    )
  })
}

// The dials enforced in code: what each rule refuses or asks for, and that
// none of it can trap a session (refusals capped, the end of a turn held back
// once, a failure letting things through, the switches turning it all off).
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { activate, mountPane, startSession, world } from './world'

const AUTOPILOT = { foresight: 4, crew: 3, tenacity: 5, autonomy: 5, proof: 4, voice: 2 }

type Message = { role: 'user' | 'assistant'; text: string; toolUses: unknown[] }

// The transcript as $.session.messages() reads it, which a test writes to.
function transcript(on: On, { isBroken = false } = {}) {
  const messages: Message[] = [{ role: 'user', text: 'earlier work', toolUses: [] }]
  on('session.messages', () => {
    if (isBroken) throw new Error('no transcript')
    return { value: messages as never }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('classic.Stop', () => ({}))
  return {
    say: (text: string) => messages.push({ role: 'assistant', text, toolUses: [] }),
    ask: (text: string) => messages.push({ role: 'user', text, toolUses: [] }),
  }
}

async function turn($: Engine, chat: ReturnType<typeof transcript>, text: string) {
  chat.ask(text)
  await $.turn.start({ text, turnId: `t-${text}` } as never)
}

const edit = ($: Engine, path = '/repo/src/a.ts', agentId?: string) =>
  $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', ...(agentId === undefined ? {} : { agentId }) } as never) as Promise<{ deny?: string }>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ deny?: string }>
const stop = ($: Engine, last: string, isHeldBack = false) =>
  $.classic.Stop({ stop_hook_active: isHeldBack, last_assistant_message: last } as never) as Promise<{ block?: string }>

test('Foresight at Write a spec: the first edit waits for a spec, twice at most, and only the main agent', async ($, on) => {
  world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  const chat = transcript(on)
  await startSession($)
  await turn($, chat, 'add a field')
  chat.say('I will add it.')
  expect((await edit($)).deny).toContain('Foresight is Write a spec')
  // A subagent's edit is its own business.
  expect((await edit($, '/repo/src/a.ts', 'agent-1')).deny).toBeUndefined()
  chat.say('Spec: add createdAt.\n\nAcceptance criteria\n1. the field is saved')
  expect((await edit($)).deny).toBeUndefined()

  // A next request asks again; an agent that ignores it is refused twice,
  // then let through.
  await turn($, chat, 'and another')
  expect((await edit($)).deny).toBeDefined()
  expect((await edit($)).deny).toBeDefined()
  expect((await edit($)).deny).toBeUndefined()
})

test('an unreadable transcript lets the edit through', async ($, on) => {
  world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  const chat = transcript(on, { isBroken: true })
  await startSession($)
  await turn($, chat, 'go')
  // The transcript cannot be read: no refusal on a guess.
  expect((await edit($)).deny).toBeUndefined()
})

test('TodoWrite as the plan', async ($, on) => {
  world(on, { isRepo: false, store: { dials: AUTOPILOT } })
  const chat = transcript(on)
  await startSession($)
  await turn($, chat, 'go')
  await $.tool.call({ tool: 'TodoWrite', todos: [] } as never)
  expect((await edit($)).deny).toBeUndefined()
})

test('Crew: Solo refuses subagents, Scouts allows one per request', async ($, on) => {
  world(on, { isRepo: false, store: { dials: { ...AUTOPILOT, crew: 2 } } })
  const chat = transcript(on)
  await startSession($)
  await turn($, chat, 'look')
  const agent = () => $.tool.call({ tool: 'Agent', prompt: 'find it' } as never) as Promise<{ deny?: string }>
  expect((await agent()).deny).toBeUndefined()
  expect((await agent()).deny).toContain('Crew is Scouts')
  await turn($, chat, 'look again')
  expect((await agent()).deny).toBeUndefined()
})

test('the end of a request that changed code is held back once for its checks and its criteria, never twice', async ($, on) => {
  world(on, { isRepo: false, store: { dials: { ...AUTOPILOT, foresight: 1 } } })
  const chat = transcript(on)
  await startSession($)
  await turn($, chat, 'fix it')
  // A question answered, nothing changed: nothing is asked for.
  expect((await stop($, 'It is in a.ts.')).block).toBeUndefined()
  await edit($)
  const held = (await stop($, 'Done.')).block ?? ''
  expect(held).toContain('run the tests')
  expect(held).toContain('Acceptance criteria')
  // Already held back once: let it end, whatever it still owes.
  expect((await stop($, 'Done.', true)).block).toBeUndefined()
  // Tests run after the last change and criteria given: nothing owed.
  await bash($, 'npm test')
  expect((await stop($, 'Acceptance criteria\n1. VERIFIED: npm test passes')).block).toBeUndefined()
  // A change after the tests needs them again.
  await bash($, "sed -i '' s/a/b/ src/a.ts")
  expect((await stop($, 'Acceptance criteria\n1. VERIFIED')).block).toContain('run the tests')
})

test('commands that only look things up are not changes: no hold-back for them', async ($, on) => {
  world(on, { isRepo: false, store: { dials: { ...AUTOPILOT, foresight: 1 } } })
  const chat = transcript(on)
  await startSession($)
  await turn($, chat, 'is it pushed?')
  // The very commands that once held a request back that changed nothing.
  for (const command of ['git status --short | head; git log --oneline -1; git ls-remote github refs/heads/main', 'npm view claude-fish-stack-mod version 2>&1 | tail -1', 'gh release view v0.5.1 --json url', 'ls -la docs/media 2>/dev/null']) {
    await bash($, command)
  }
  expect((await stop($, 'Yes, all pushed.')).block).toBeUndefined()
  // A command that plainly writes a file still counts.
  for (const command of ["echo 'x' > src/a.ts", "sed -i '' s/a/b/ src/a.ts", 'cp a.ts b.ts']) {
    await turn($, chat, command)
    await bash($, command)
    expect((await stop($, 'Done.')).block, command).toContain('run the tests')
  }
})

test('docs alone are not held back for tests', async ($, on) => {
  world(on, { isRepo: false, store: { dials: { ...AUTOPILOT, foresight: 1, tenacity: 3 } } })
  const chat = transcript(on)
  await startSession($)
  await turn($, chat, 'docs')
  await edit($, '/repo/README.md')
  expect((await stop($, 'Updated the README.')).block).toBeUndefined()
})

test('with Enforce off, or the dials off, nothing is refused or held back', async ($, on) => {
  world(on, { isRepo: false, store: { dials: { ...AUTOPILOT, crew: 1 } } })
  const chat = transcript(on)
  await startSession($)
  const ui = await mountPane($, 'terminal')
  await activate(ui, 'tab-dials')
  expect(await ui.find({ text: /Enforced: The first edit of a request waits for a spec/ })).toBeDefined()
  await activate(ui, 'dials-enforce-off')
  expect(await ui.find({ text: /Enforced:/ })).toBeUndefined()
  await turn($, chat, 'go')
  expect((await edit($)).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Agent', prompt: 'x' } as never) as { deny?: string }).deny).toBeUndefined()
  expect((await stop($, 'Done.')).block).toBeUndefined()

  await activate(ui, 'dials-enforce-on')
  await activate(ui, 'dials-on-off')
  await turn($, chat, 'again')
  expect((await edit($)).deny).toBeUndefined()
  expect((await stop($, 'Done.')).block).toBeUndefined()
})

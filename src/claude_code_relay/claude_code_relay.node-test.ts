// The relay fails closed on every event, and relays the engine's fields unchanged (#41).
//
// The relay is driven here with the hooks it registers and a fake engine `$`, as
// the host would call them. The launcher's side is tested in
// ../launch_a_claude_code_member.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { moduleReferencesOf } from '../../prove_the_core/parse_a_source.ts'
import {
  processGroupOf,
  relay,
  register,
  REFUSED_BY_THE_RELAY,
  type RelayCatch,
  type RelayEngine,
  type RelayHook,
} from './hooks/register.ts'
import { heardTaken, LARGEST_RELAYED_ANSWER, RELAY_DEADLINE_MS, RELAY_ORIGIN, RELAY_PATHS, RELAY_SOCKET_VARIABLE } from './hooks/relay_protocol.ts'

type AnyHook = RelayHook<any, any>
type AnyCatch = RelayCatch<any, any>

interface Registered {
  readonly hook: AnyHook
  handler?: AnyCatch
}

/** The relay's hooks, by event, as the engine would hold them. */
function hooksOfTheRelay(): Map<string, Registered> {
  const hooks = new Map<string, Registered>()
  register(((event: string, hook: AnyHook) => {
    const entry: Registered = { hook }
    hooks.set(event, entry)
    return { catch: (handler: AnyCatch) => void (entry.handler = handler) }
  }) as never)
  return hooks
}

interface Posted {
  readonly url: string
  readonly body: unknown
  readonly socketPath: string
}

type Launcher = (posted: Posted) => Promise<{ status: number; text: string }>

interface Fake {
  readonly $: RelayEngine
  readonly posted: Posted[]
  readonly ran: (readonly string[])[]
  fireTimers(): void
}

const SOCKET = '/run/martha-test/relay.sock'
const SESSION = 'session-1'
const OWN_STAT = '4242 (claude) code) S 1 4242 4242 0 -1'

function fakeEngine(launcher: Launcher, environment: Record<string, string> = { [RELAY_SOCKET_VARIABLE]: SOCKET }): Fake {
  const posted: Posted[] = []
  const ran: (readonly string[])[] = []
  const timers: (() => void)[] = []
  const $: RelayEngine = {
    env: { get: async (name) => environment[name] },
    http: {
      fetch: async (url, init) => {
        const entry = { url, body: JSON.parse(init.body) as unknown, socketPath: init.socketPath }
        posted.push(entry)
        return launcher(entry)
      },
    },
    session: { id: async () => SESSION },
    clock: {
      after: (_ms, fn) => {
        timers.push(fn)
        return { cancel: () => undefined }
      },
    },
    fs: { read: async (path) => (path === '/proc/self/stat' ? OWN_STAT : Promise.reject(new Error(`no ${path}`))) },
    process: {
      run: async (argv) => {
        ran.push(argv)
        // The hold never ends in a test: the kill would have ended it.
        return argv[0] === 'sleep' ? new Promise(() => undefined) : { exitCode: 0 }
      },
    },
    ui: { toast: () => undefined },
  }
  return { $, posted, ran, fireTimers: () => timers.splice(0).forEach((fn) => fn()) }
}

const answering =
  (status: number, text: string): Launcher =>
  async () => ({ status, text })

const yesTo = (path: string): string => (path === RELAY_PATHS.tool_called ? '{"allow":1}' : '{"taken":1}')
const sayYes: Launcher = async ({ url }) => ({ status: 200, text: yesTo(url.slice(RELAY_ORIGIN.length)) })

/** Resolves to 'pending' when the promise has not settled after the event loop turned. */
async function settled<T>(promise: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20))])
}

const next = <E>(result: unknown) => {
  const calls: E[] = []
  const fn = async (e: E) => {
    calls.push(e)
    return result
  }
  return { fn, calls }
}

const PROMPT = { text: 'hello', origin: { kind: 'task-notification', subkind: 'github-webhook' }, wait: false }
const CALL = { tool: 'Bash', command: 'ls', tool_use_id: 'toolu_1' }
const RESULT = { text: 'a b c' }

async function promptThrough(fake: Fake) {
  const { fn, calls } = next<typeof PROMPT>({ text: PROMPT.text })
  const answer = await hooksOfTheRelay().get('prompt.submit')?.hook(fake.$, PROMPT, fn)
  return { answer, entered: calls.length }
}

async function callThrough(fake: Fake) {
  const { fn, calls } = next<typeof CALL>(RESULT)
  const answer = hooksOfTheRelay().get('tool.call')?.hook(fake.$, CALL, fn)
  return { answer, ran: calls }
}

test('the relay sends the engine fields unchanged: the start whole, the origin whole, the call with its answer', async () => {
  const fake = fakeEngine(sayYes)
  const start = { session_id: SESSION, source: 'fork', transcript_path: '/t', hook_event_name: 'SessionStart' }
  const started = next<typeof start>({})
  await hooksOfTheRelay().get('classic.SessionStart')?.hook(fake.$, start, started.fn)
  assert.equal(started.calls.length, 1)

  const prompt = await promptThrough(fake)
  assert.equal(prompt.entered, 1)
  const call = await callThrough(fake)
  assert.deepEqual(await call.answer, RESULT)

  assert.deepEqual(
    fake.posted.map(({ url, body, socketPath }) => ({ url, body, socketPath })),
    [
      { url: `${RELAY_ORIGIN}${RELAY_PATHS.session_started}`, body: start, socketPath: SOCKET },
      { url: `${RELAY_ORIGIN}${RELAY_PATHS.prompt_submitted}`, body: { session_id: SESSION, text: PROMPT.text, origin: PROMPT.origin }, socketPath: SOCKET },
      { url: `${RELAY_ORIGIN}${RELAY_PATHS.tool_called}`, body: { session_id: SESSION, call: CALL }, socketPath: SOCKET },
      // The answer goes with the call (martha#129): the launcher keeps the shell only when this is exactly the one
      // a signed run's receipt builds, so the relay carries it unchanged and decides nothing about it.
      { url: `${RELAY_ORIGIN}${RELAY_PATHS.tool_answered}`, body: { session_id: SESSION, call: CALL, answer: RESULT }, socketPath: SOCKET },
    ],
  )
})

test('an answer too big to send is left out of the tool_answered body, and the call records A13 rather than a body the launcher stops the member over (martha#129)', async () => {
  const huge = { text: 'x'.repeat(LARGEST_RELAYED_ANSWER) }
  const fake = fakeEngine(sayYes)
  const { fn } = next<typeof CALL>(huge)
  await hooksOfTheRelay().get('tool.call')?.hook(fake.$, CALL, fn)
  const answered = fake.posted.filter(({ url }) => url.endsWith(RELAY_PATHS.tool_answered))
  assert.equal(answered.length, 1)
  assert.deepEqual(answered[0]?.body, { session_id: SESSION, call: CALL })
  // An answer that cannot be written down is one the launcher cannot compare either.
  const circular: Record<string, unknown> = {}
  circular['self'] = circular
  const alsoFake = fakeEngine(sayYes)
  const { fn: alsoFn } = next<typeof CALL>(circular)
  await hooksOfTheRelay().get('tool.call')?.hook(alsoFake.$, CALL, alsoFn)
  assert.deepEqual(alsoFake.posted.filter(({ url }) => url.endsWith(RELAY_PATHS.tool_answered)).map(({ body }) => body), [{ session_id: SESSION, call: CALL }])
})

test('the relay sends a prompt\'s command and meta mark unchanged, so the launcher can tell typing from an expansion (#51)', async () => {
  const fake = fakeEngine(sayYes)
  const expanded = { text: '/review', origin: { kind: 'composer' }, command: { name: 'review' }, isMeta: false }
  const { fn } = next<typeof expanded>({ text: expanded.text })
  await hooksOfTheRelay().get('prompt.submit')?.hook(fake.$, expanded, fn)
  assert.deepEqual(fake.posted.map(({ body }) => body), [
    { session_id: SESSION, text: expanded.text, origin: expanded.origin, command: expanded.command, isMeta: expanded.isMeta },
  ])
})

/** Every way the launcher can fail to say yes, as the relay sees it. */
const NOT_A_YES: readonly { readonly what: string; readonly launcher: Launcher }[] = [
  { what: 'the socket is refused', launcher: async () => Promise.reject(new Error('ECONNREFUSED')) },
  { what: 'status 500', launcher: answering(500, '{"allow":1}') },
  { what: 'text that is not JSON', launcher: answering(200, 'allow') },
  { what: 'a JSON list', launcher: answering(200, '[1]') },
  { what: 'an allow spelled as true', launcher: async ({ url }) => ({ status: 200, text: url.endsWith(RELAY_PATHS.tool_called) ? '{"allow":true}' : '{"taken":true}' }) },
  { what: 'an allow spelled as the string 1', launcher: async ({ url }) => ({ status: 200, text: url.endsWith(RELAY_PATHS.tool_called) ? '{"allow":"1"}' : '{"taken":"1"}' }) },
  { what: 'a yes with a field more', launcher: answering(200, '{"allow":1,"taken":1,"why":"x"}') },
  { what: 'a deny with no reason', launcher: answering(200, '{"deny":""}') },
  { what: 'a refusal', launcher: answering(200, '{"refused":"no","deny":"no"}') },
  { what: 'an empty object', launcher: answering(200, '{}') },
]

for (const { what, launcher } of NOT_A_YES) {
  test(`${what}: the prompt is dropped, the tool is denied and never runs`, async () => {
    const prompt = await promptThrough(fakeEngine(launcher))
    assert.equal(prompt.entered, 0)
    assert.match(String((prompt.answer as { drop?: string }).drop), new RegExp(REFUSED_BY_THE_RELAY))

    const call = await callThrough(fakeEngine(launcher))
    assert.match(String(((await call.answer) as { deny?: string }).deny), new RegExp(REFUSED_BY_THE_RELAY))
    assert.equal(call.ran.length, 0)
  })

  test(`${what} after the tool ran: the relay kills its own group and never returns`, async () => {
    const fake = fakeEngine(async (posted) =>
      posted.url.endsWith(RELAY_PATHS.tool_called) ? { status: 200, text: '{"allow":1}' } : launcher(posted),
    )
    const call = await callThrough(fake)
    assert.equal(await settled(call.answer as Promise<unknown>), 'pending')
    assert.equal(call.ran.length, 1)
    assert.deepEqual(fake.ran[0], ['kill', '-s', 'KILL', '--', '-4242'])
  })
}

test('no launcher socket in the environment: every event is refused and nothing is posted', async () => {
  const prompt = await promptThrough(fakeEngine(sayYes, {}))
  assert.equal(prompt.entered, 0)
  const fake = fakeEngine(sayYes, {})
  const call = await callThrough(fake)
  assert.ok('deny' in ((await call.answer) as object))
  assert.equal(call.ran.length, 0)
  assert.deepEqual(fake.posted, [])
})

test(`a launcher that does not answer within ${RELAY_DEADLINE_MS} ms: the prompt is dropped and the tool denied`, async () => {
  const silent: Launcher = () => new Promise(() => undefined)
  const forPrompt = fakeEngine(silent)
  const prompt = (async () => promptThrough(forPrompt))()
  await new Promise((resolve) => setTimeout(resolve, 5))
  forPrompt.fireTimers()
  assert.equal((await prompt).entered, 0)

  const forCall = fakeEngine(silent)
  const call = await callThrough(forCall)
  await new Promise((resolve) => setTimeout(resolve, 5))
  forCall.fireTimers()
  assert.ok('deny' in ((await call.answer) as object))
  assert.equal(call.ran.length, 0)
})

test('a hook that failed: its catch drops or denies before the tool ran, and stops the member after', async () => {
  const hooks = hooksOfTheRelay()
  const fake = fakeEngine(sayYes)
  const failedBefore = Object.assign(async () => RESULT, { called: false })
  const failedAfter = Object.assign(async () => RESULT, { called: true })

  const promptCatch = hooks.get('prompt.submit')?.handler
  assert.ok('drop' in ((await promptCatch?.(fake.$, PROMPT, failedBefore)) as object))

  const toolCatch = hooks.get('tool.call')?.handler
  assert.ok('deny' in ((await toolCatch?.(fake.$, CALL, failedBefore)) as object))
  assert.equal(await settled(toolCatch?.(fake.$, CALL, failedAfter) as Promise<unknown>), 'pending')
  assert.deepEqual(fake.ran[0], ['kill', '-s', 'KILL', '--', '-4242'])

  assert.ok(hooks.get('classic.SessionStart')?.handler, 'the session start has a catch too')
})

test('the relay holds no verdict of its own: a deny is the launcher\'s reason, word for word, and nothing else allows', async () => {
  const reason = 'Nothing executes in this session: because the launcher said so.'
  const call = await callThrough(fakeEngine(answering(200, JSON.stringify({ deny: reason }))))
  assert.equal(((await call.answer) as { deny: string }).deny, `${REFUSED_BY_THE_RELAY}: ${reason}`)

  // The relay's source names no tool, kind or path: it cannot treat one call unlike another.
  const source = readFileSync(new URL('./hooks/register.ts', import.meta.url), 'utf8')
  for (const policy of ['Bash', 'mcp__', 'composer', 'peer', 'owner_paste', 'cross_session']) {
    assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm, ''), new RegExp(`['"\`]${policy}`), policy)
  }
})

test('the relay imports only its protocol, and the protocol imports nothing', () => {
  const read = (name: string): string => readFileSync(new URL(`./hooks/${name}`, import.meta.url), 'utf8')
  const specifiers = (name: string) => moduleReferencesOf(read(name), name).map(({ specifier }) => specifier)
  assert.deepEqual(specifiers('register.ts'), ['./relay_protocol.ts'])
  assert.deepEqual(specifiers('relay_protocol.ts'), [])
  // The crew's mod is the second module the host loads (martha#254): it carries its tools' calls to the launcher the
  // same way, and the one rule it applies — whether the pane opens by itself — is a plain file with no imports at all,
  // so what it decides is readable and testable without the host.
  assert.deepEqual(specifiers('crew.tsx'), ['./relay_protocol.ts', './pane_rule.ts'])
  assert.deepEqual(specifiers('pane_rule.ts'), [])
  assert.deepEqual(JSON.parse(read('hooks.json')), { modules: ['./register.ts', './crew.tsx'] })
})

test('the relay reads the socket only from the variable the launcher sets', async () => {
  const asked: string[] = []
  const fake = fakeEngine(sayYes)
  const $: RelayEngine = { ...fake.$, env: { get: async (name) => (asked.push(name), fake.$.env.get(name)) } }
  await relay($, 'prompt_submitted', { session_id: SESSION }, heardTaken)
  assert.deepEqual(asked, [RELAY_SOCKET_VARIABLE])
  assert.equal(fake.posted[0]?.socketPath, SOCKET)
})

test('the process group is read after the command name, whatever the name holds', () => {
  assert.equal(processGroupOf(OWN_STAT), 4242)
  assert.equal(processGroupOf('7 (a) b) S 1 9 9 0'), 9)
  assert.equal(processGroupOf('7 (x) S 1 1 1 0'), undefined, 'never the init group')
  assert.equal(processGroupOf('garbage'), undefined)
})

// The relay ships inside the Martha release (pack_a_release packs the whole tree, and the launcher loads this
// folder with --plugin-dir), so its version is the release's: the root package.json, which the release guard
// checks against the tag. A version stated here would be a second copy nothing checks (#21).
test('the relay states no version of its own: it is the Martha release version, from the root package.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('./.claude-plugin/plugin.json', import.meta.url), 'utf8')) as Record<string, unknown>
  assert.equal(Object.hasOwn(manifest, 'version'), false, `.claude-plugin/plugin.json states version ${String(manifest.version)}; leave it out, the release's version is the root package.json's`)
})

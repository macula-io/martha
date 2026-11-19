// prove_the_bash_answers.mjs [<out-dir> | --compare <recording> <taken>]: what the host answers a tool.call hook for
// the commands the recording holds, taken on the host itself (martha#129, martha#812).
//
// src/claude_code_host/recorded_claude_code_bash_results.json holds, for the exact command it names, what the pinned
// host answered a tool.call hook's `next(e)` for a stand-in that printed known text and exited with a known status.
// Every release re-took it by hand; this takes it the way prove_the_order_of_the_dialogs.mjs measures the order: the
// host the caller installed, an isolated home, a stand-in model on a local port, no login and no secret.
//
// The answer is read as the recording's own `_why` defines it: what `next(e)` resolved to with the host's message count
// (`ref`) left out — the same rule, through the same function, as the gate that reads this recording (martha#129).
//
// A reviewer's design note, kept here because it is what the mode split is for (martha#812 r=2): exit 0 must mean every
// case was taken, so the live mode's fail-closed promise is pinned by CI with a stand-in host that never answers, and
// the comparison itself is the program `--compare` runs. No host and no npm are needed for either.
//
//   MARTHA_RECORDED_HOST=/path/to/claude node prove_the_relay_loads/prove_the_bash_answers.mjs <out-dir>
//   node prove_the_relay_loads/prove_the_bash_answers.mjs --compare <recording> <taken>
//
// Exit: 0 every case holds, and live every case was taken; 1 a case differs, each named; 2 a case could not be taken,
// or the run could not be made, named with its evidence.

import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { CLAUDE_CODE } from '../src/know_claude_codes_own_facts/claude_code_facts.ts'
import { withoutRef } from '../src/keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'
import { HOSTS } from '../src/refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { DIALOG_WAIT_MS, WELCOME_WAIT_MS } from './the_wait_a_probe_gives_a_screen.mjs'

/** The recording this harness takes and compares against: the committed one, read where it lives. */
const RECORDING = fileURLToPath(new URL('../src/claude_code_host/recorded_claude_code_bash_results.json', import.meta.url))

/** The checkout this harness belongs to: an out-dir inside it would write into the tree the run is proving. */
const CHECKOUT = realpathSync(fileURLToPath(new URL('..', import.meta.url)))

/** The host, when the caller reaches for the live mode. */
const HOST = process.env.MARTHA_RECORDED_HOST

/** A key the stand-in accepts and no service does: nothing here reaches the network. */
const STAND_IN_KEY = `sk-ant-api03-${'0'.repeat(80)}`

/**
 * How long one case is given, from the host's start to the answer it logs: the two waits a probe gives a host, added.
 * A case is one `-p` process covering start, turn and tool call, so it is given what the dialog probe gives a host to
 * reach its prompt and then to answer a message typed there (martha#812 r=2, S1).
 */
const CASE_LIMIT_MS = WELCOME_WAIT_MS + DIALOG_WAIT_MS

/** The words one case is named by in every message: its place in the recording, its status and what the stand-in prints. */
const nameOfCase = (at, one) => `case ${at + 1} (status ${one.status}, printed ${JSON.stringify(one.printed)})`

/** Whether two answers are the same answer: the recording's shape is JSON, so its own text says. */
const sameAnswer = (left, right) => JSON.stringify(left) === JSON.stringify(right)

/** What a comparison found, each list holding its cases by name. */
function differencesOf(recording, taken) {
  const held = recording.cases
  const given = taken.cases ?? []
  const differing = []
  const missing = []
  const extra = []
  for (let at = 0; at < Math.max(held.length, given.length); at += 1) {
    const one = held[at]
    const other = given[at]
    if (one === undefined) extra.push(nameOfCase(at, other))
    else if (other === undefined) missing.push(nameOfCase(at, one))
    else if (!sameAnswer(one.answer, other.answer)) differing.push(nameOfCase(at, one))
  }
  return { differing, missing, extra }
}

/** A file of the recording's shape, or the words saying why it could not be read. */
function readARecording(path) {
  try {
    return { recording: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (failure) {
    return { why: `${path} could not be read as a recording: ${failure instanceof Error ? failure.message : String(failure)}` }
  }
}

/** `--compare`: two files of the recording's shape, each difference named. The mode CI runs on every pull request. */
function compareMode(recordingPath, takenPath) {
  const left = readARecording(recordingPath)
  if (left.why !== undefined) {
    console.error(left.why)
    return 2
  }
  const right = readARecording(takenPath)
  if (right.why !== undefined) {
    console.error(right.why)
    return 2
  }
  if ((left.recording.cases ?? []).length === 0) {
    console.error('nothing was compared: the recording holds no cases, so exit 0 here would say nothing')
    return 2
  }
  const { differing, missing, extra } = differencesOf(left.recording, right.recording)
  for (const name of differing) console.error(`${name}: the answers differ`)
  for (const name of missing) console.error(`${name}: the recording holds it and the taken file does not`)
  for (const name of extra) console.error(`${name}: the taken file holds it and the recording does not`)
  if (differing.length + missing.length + extra.length > 0) return 1
  console.log(`every case the recording holds answers as recorded (${String(left.recording.cases.length)} case(s))`)
  return 0
}

/** The deepest ancestor of `path` that exists, made real, with the segments past it put back on. */
function resolvedBeforeItExists(path) {
  const rest = []
  let at = resolve(path)
  while (!existsSync(at)) {
    rest.unshift(at.slice(at.lastIndexOf(sep) + 1))
    const up = dirname(at)
    if (up === at) break
    at = up
  }
  return join(realpathSync(at), ...rest)
}

/** Whether `path` is the checkout or stands inside it, resolved the same way even when it does not exist yet. */
const insideTheCheckout = (path) => {
  const real = resolvedBeforeItExists(path)
  return real === CHECKOUT || real.startsWith(`${CHECKOUT}${sep}`)
}

/** `text` as one shell word: single-quoted, the way a shell reads a quote inside one. */
const singleQuoted = (text) => `'${text.replaceAll("'", `'\\''`)}'`

/** The stand-in `martha`: it prints the case's text byte for byte and exits with the case's status. */
const theStandInMartha = (one) => `#!/bin/sh\nprintf '%s' ${singleQuoted(one.printed)}\nexit ${String(one.status)}\n`

/**
 * The plugin the host runs for one case: its tool.call handler awaits the answer the host gives the call and writes it,
 * with the case's number and its command, to `logfile`. The handler is a function literal and the event a string
 * literal, which is the rule the host's own validator holds (prove_the_order_of_the_dialogs.mjs says the same).
 */
const thePluginForTheCase = (logfile, at, command) => `// PROBE (martha#812)
const LOG = ${JSON.stringify(logfile)}
const AT = ${String(at + 1)}
const COMMAND = ${JSON.stringify(command)}
export const register = (on) => {
  on('tool.call', async ($, e, next) => {
    const answer = await next(e)
    await $.fs.write(LOG, JSON.stringify({ case: AT, command: COMMAND, answer }))
    return answer
  })
}
`

/** The home, the plugin, the checkout and the bin a case runs in, all under the run's own out-dir. */
function setUpCase(out, at, one) {
  const dir = join(out, `case-${String(at + 1)}`)
  const places = {
    home: join(dir, 'home'),
    plugin: join(dir, 'plugin'),
    checkout: join(dir, 'checkout'),
    bin: join(dir, 'bin'),
    logfile: join(dir, 'the-answer.json'),
  }
  for (const made of [places.home, places.checkout, join(places.plugin, '.claude-plugin'), join(places.plugin, 'hooks'), places.bin]) mkdirSync(made, { recursive: true })
  writeFileSync(
    join(places.home, '.claude.json'),
    `${JSON.stringify({ hasCompletedOnboarding: true, customApiKeyResponses: { approved: [STAND_IN_KEY.slice(-20)], rejected: [] }, projects: { [places.checkout]: { hasTrustDialogAccepted: true } } })}\n`,
    { mode: 0o600 },
  )
  writeFileSync(join(places.bin, 'martha'), theStandInMartha(one))
  chmodSync(join(places.bin, 'martha'), 0o755)
  writeFileSync(join(places.plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'probe', description: 'the Bash answers probe', license: 'Apache-2.0' }))
  writeFileSync(join(places.plugin, 'hooks', 'hooks.json'), '{ "modules": ["./probe.tsx"] }\n')
  writeFileSync(join(places.plugin, 'hooks', 'probe.tsx'), thePluginForTheCase(places.logfile, at, one.command))
  return places
}

/** One streamed turn of the stand-in model: the case's Bash call, then text that ends the turn. */
function turnOf(number, model, command) {
  const message = { id: `msg_${String(number)}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
  const call = { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_probe_1', name: 'Bash', input: {} } }
  const asked = [
    call,
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command, description: 'the recorded command' }) } },
  ]
  const done = [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'done' } }]
  const events = [
    { type: 'message_start', message },
    ...(number === 1 ? asked : done),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: number === 1 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

/** The model, on a local port: the host reaches it through ANTHROPIC_BASE_URL and never the network. */
async function standInModel(command) {
  let offered = 0
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !(request.url ?? '').startsWith('/v1/messages')) return void response.writeHead(404).end()
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    // A request that offers no tools is the host checking itself before a turn: it is answered without a call.
    if (!Array.isArray(body.tools) || body.tools.length === 0) return void response.writeHead(200, { 'content-type': 'text/event-stream' }).end(turnOf(0, body.model, command))
    offered += 1
    response.writeHead(200, { 'content-type': 'text/event-stream' }).end(turnOf(offered, body.model, command))
  })
  await new Promise((settled) => server.listen(0, '127.0.0.1', settled))
  return server
}

/** The host's one turn for a case: how it ended, or that it outlasted what a probe gives it. */
const theHostsTurn = (claude, places, base_url) =>
  new Promise((settled) => {
    const child = spawn(claude, ['-p', '--plugin-dir', places.plugin, '--allowedTools=Bash', 'run the recorded command'], {
      cwd: places.checkout,
      env: {
        HOME: places.home,
        PATH: [places.bin, join(process.execPath, '..'), '/usr/bin', '/bin'].join(':'),
        TERM: 'xterm-256color',
        ANTHROPIC_BASE_URL: base_url,
        ANTHROPIC_API_KEY: STAND_IN_KEY,
        ...HOSTS[CLAUDE_CODE].env_last,
      },
    })
    let finished = false
    const finish = (result) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      settled(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ timedOut: true })
    }, CASE_LIMIT_MS)
    let said = ''
    child.stdout.on('data', (chunk) => (said += String(chunk)))
    child.stderr.on('data', (chunk) => (said += String(chunk)))
    child.on('error', (failure) => finish({ why: `the host could not be started: ${failure.message}` }))
    child.on('close', (status, signal) => finish({ status, signal, said }))
  })

/** Why a run that ended did not leave an answer, in the words the case is failed with. */
const whyNoAnswer = (run) => {
  if (run.timedOut === true) return `the host stayed unanswered for ${String(CASE_LIMIT_MS / 1000)}s, what a probe gives it from launch to the call it needs, and was killed`
  if (run.why !== undefined) return run.why
  const how = run.signal === null ? `ended with status ${String(run.status)}` : `was killed by ${String(run.signal)}`
  return `the tool.call was never logged: the host ${how} without reaching the plugin${run.said === '' ? '' : `, saying ${JSON.stringify(run.said.slice(-400))}`}`
}

/** One case taken on the host: its answer, or the words saying why it was not taken. */
async function takeTheCase({ claude, out, at, one }) {
  const places = setUpCase(out, at, one)
  const model = await standInModel(one.command)
  const run = await theHostsTurn(claude, places, `http://127.0.0.1:${String(model.address().port)}`)
  model.close()
  if (!existsSync(places.logfile)) return { why: whyNoAnswer(run) }
  try {
    const written = JSON.parse(readFileSync(places.logfile, 'utf8'))
    // The answer as the recording's own `_why` defines it: what `next(e)` resolved to with `ref` left out. That is the
    // host's count of the messages it produced for the call — a number, 1 in every run made this way, carrying no text
    // the model reads — and the gate that reads the recording leaves it out with this same function (martha#129).
    return { taken: { ...written, answer: withoutRef(written.answer) } }
  } catch {
    return { why: 'the plugin wrote no answer the check could read' }
  }
}

/** The lines a run has printed so far, each on its own line. */
const said = (lines) => {
  for (const line of lines) console.log(line)
}

/** The live mode: every case the recording holds, taken on `claude` and compared with it. */
async function liveMode(claude, out, recording) {
  if (insideTheCheckout(out)) {
    console.error(`the out-dir ${JSON.stringify(out)} is inside the checkout ${JSON.stringify(CHECKOUT)}: this run would write into the tree it is proving`)
    return 2
  }
  mkdirSync(out, { recursive: true })
  const made = []
  try {
    return await theCasesTaken({ claude, out, recording, made })
  } finally {
    // The home, plugin, checkout and stand-in of every case go: what stays is the out-dir's own log and taken answers.
    for (const dir of made) rmSync(dir, { recursive: true, force: true })
  }
}

/** Each case taken and compared, the lines it prints, and the verdict they give. */
async function theCasesTaken({ claude, out, recording, made }) {
  const lines = []
  const taken = { host_version: recording.host_version, mark: recording.mark, cases: [] }
  for (const [at, one] of recording.cases.entries()) {
    made.push(join(out, `case-${String(at + 1)}`))
    const result = await takeTheCase({ claude, out, at, one })
    if (result.why !== undefined) {
      lines.push(`${nameOfCase(at, one)}: not taken — ${result.why}`)
      writeFileSync(join(out, 'log.txt'), `${lines.join('\n')}\n`)
      said(lines)
      console.error(`${nameOfCase(at, one)}: not taken — ${result.why}\n  the evidence: ${out}`)
      return 2
    }
    taken.cases.push({ status: one.status, printed: one.printed, command: one.command, answer: result.taken.answer })
    const holds = sameAnswer(result.taken.answer, one.answer)
    lines.push(`${nameOfCase(at, one)}: ${holds ? 'holds' : `differs — recorded ${JSON.stringify(one.answer)}, taken ${JSON.stringify(result.taken.answer)}`}`)
  }
  writeFileSync(join(out, 'log.txt'), `${lines.join('\n')}\n`)
  writeFileSync(join(out, 'taken.json'), `${JSON.stringify(taken, null, 2)}\n`)
  said(lines)
  const differing = recording.cases.filter((one, at) => !sameAnswer(taken.cases[at].answer, one.answer))
  if (differing.length > 0) {
    console.error(`${String(differing.length)} of ${String(recording.cases.length)} case(s) do not answer as recorded; the taken answers are in ${join(out, 'taken.json')}`)
    return 1
  }
  console.log(`all ${String(recording.cases.length)} case(s) the recording holds were taken on this host and answer as recorded`)
  return 0
}

const [first, second, third] = process.argv.slice(2)
if (first === '--compare') {
  process.exitCode = compareMode(second, third)
} else if (HOST === undefined || HOST === '') {
  process.stderr.write('Set MARTHA_RECORDED_HOST to the Claude Code binary to take the answers on.\n')
  process.exitCode = 2
} else {
  const out = first ?? join(process.cwd(), 'bash-answers-out')
  try {
    const recording = JSON.parse(readFileSync(RECORDING, 'utf8'))
    process.exitCode = await liveMode(HOST, out, recording)
  } catch (failure) {
    console.error(`the run could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
    process.exitCode = 2
  }
}

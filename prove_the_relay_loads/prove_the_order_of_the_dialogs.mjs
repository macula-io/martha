// prove_the_order_of_the_dialogs.mjs [out-dir]: the order the host raises its dialog events in, measured on the host
// itself (martha#313).
//
// This exists because the owner's row depends on that order and nothing else can say what it is. The row says "needs
// you" while the host is asking the owner and stops when they have answered, so it must close on an event that comes
// AFTER the answer. On 2.1.323 there is only one: the call's own answer, once the tool has run. Everything the host
// says before the owner is asked comes first — the call is posted, then checked, then asked about — so a row that
// closed on any of those would close before the dialog it is about had opened.
//
// A reviewer found this the hard way (r=2 R1): the first probe logged no `tool.call`, so the event the design closed on
// looked as though it came after the answer, and it does not. This script logs every event the relay can hear, in the
// order the host raises them, and checks the order rather than printing it.
//
// It is not part of `npm test`: it starts the host under a terminal, answers one permission prompt, and takes about
// half a minute. Run it when the host version changes, or when the relay's hooks change, and read the order it prints.
//
//   MARTHA_RECORDED_HOST=/path/to/claude node prove_the_relay_loads/prove_the_order_of_the_dialogs.mjs
//
// Exit: 0 the order is the one the row relies on, 1 it is not, 2 the host could not be set up or never answered.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

// martha#460 r=1: the host is driven under a home of its own, so it must start with the auto-updater off or it would
// install the owner's global Claude Code over itself. The switch is one definition, in the launch module; it is spread
// here from there rather than typed, so a change to it reaches this run and a run that drops it fails
// every_launch_switches_the_hosts_auto_updater_off.node-test.ts by name.
import { THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF } from '../src/refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** The host, at the version the adapter was recorded from: the same variable the recorded-host tests read. */
const HOST = process.env.MARTHA_RECORDED_HOST
const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'martha-dialog-order-'))
/** A key the stand-in accepts and no service does: nothing here reaches the network. */
const STAND_IN_KEY = `sk-ant-api03-${'0'.repeat(80)}`
const COMMAND = 'touch probe-touched.txt'
const PROMPT_SHOWN = 'Waiting for permission'

/** The plugin the host runs: every event the relay can hear, each written to the log with the moment it arrived. */
const PLUGIN = (logdir) => `// PROBE
const LOG = ${JSON.stringify(logdir)}
const write = async ($, tag, payload) => {
  const at = Date.now()
  await $.fs.write(LOG + '/' + String(at).padStart(16, '0') + '-' + tag + '.json', JSON.stringify({ tag, at, payload }))
}
const theFields = (e) => ({ tool: e.tool, tool_name: e.tool_name, tool_use_id: e.tool_use_id, hook_event_name: e.hook_event_name })
const heard = async ($, tag, e, next) => {
  await write($, tag, theFields(e))
  return next(e)
}
// Each hook is a named function rather than a call that builds one, and each event is spelled out rather than looped:
// the host's own validator refuses an on(...) whose event is not a string literal or whose hook is not a function
// literal or the name of one, which is the rule the relay itself is written under. Which is registered first says
// nothing; the order they arrive in is what this probe measures.
async function theToolCall($, e, next) {
  await write($, 'tool-call', theFields(e))
  const answer = await next(e)
  await write($, 'tool-call-returned', theFields(e))
  return answer
}
function theCheck($, e, next) { return heard($, 'check', e, next) }
function thePreToolUse($, e, next) { return heard($, 'pre-tool-use', e, next) }
function thePermission($, e, next) { return heard($, 'permission', e, next) }
function thePostToolUse($, e, next) { return heard($, 'post-tool-use', e, next) }
function thePostToolBatch($, e, next) { return heard($, 'post-tool-batch', e, next) }
function theStop($, e, next) { return heard($, 'stop', e, next) }
function theNotification($, e, next) { return heard($, 'notification', e, next) }
export const register = (on) => {
  on('tool.call', theToolCall)
  on('tool.check', theCheck)
  on('classic.PreToolUse', thePreToolUse)
  on('classic.PermissionRequest', thePermission)
  on('classic.PostToolUse', thePostToolUse)
  on('classic.PostToolBatch', thePostToolBatch)
  on('classic.Stop', theStop)
  on('classic.Notification', theNotification)
}
`

/** The home the host finds a first run already done in, the plugin beside it, and the checkout it runs in. */
function setUp(out) {
  rmSync(out, { recursive: true, force: true })
  const home = join(out, 'home')
  const plugin = join(out, 'plugin')
  const checkout = join(out, 'checkout')
  const logdir = join(out, 'log')
  for (const dir of [home, checkout, join(plugin, '.claude-plugin'), join(plugin, 'hooks'), logdir, join(home, 'bin')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, customApiKeyResponses: { approved: [STAND_IN_KEY.slice(-20)], rejected: [] }, projects: { [checkout]: { hasTrustDialogAccepted: true } } })}\n`, { mode: 0o600 })
  symlinkSync(HOST, join(home, 'bin', 'claude'))
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'probe', description: 'the dialog order probe', license: 'Apache-2.0' }))
  writeFileSync(join(plugin, 'hooks', 'hooks.json'), '{ "modules": ["./probe.tsx"] }\n')
  writeFileSync(join(plugin, 'hooks', 'probe.tsx'), PLUGIN(logdir))
  return { home, plugin, checkout, logdir }
}

/** One streamed turn of the stand-in model: a tool call, then text that ends the turn. */
function turnOf(number, model) {
  const message = { id: `msg_${number}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
  const tool = { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_probe_1', name: 'Bash', input: {} } }
  const events = [
    { type: 'message_start', message },
    ...(number === 1 ? [tool, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: COMMAND, description: 'the probe command' }) } }] : [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'done' } }]),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: number === 1 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

/** The model, on a local port: the host reaches it through ANTHROPIC_BASE_URL and never the network. */
async function standInModel() {
  let offered = 0
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !(request.url ?? '').startsWith('/v1/messages')) return void response.writeHead(404).end()
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!Array.isArray(body.tools) || body.tools.length === 0) return void response.writeHead(200, { 'content-type': 'text/event-stream' }).end(turnOf(0, body.model))
    offered += 1
    response.writeHead(200, { 'content-type': 'text/event-stream' }).end(turnOf(offered, body.model))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

/** Whether `held` becomes true within `ms`, asked again every fifth of a second. */
const settles = async (held, ms) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (held()) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

/** Whether the host has said `needle` on its screen yet, given everything it has drawn so far. */
const waitFor = (shown, needle, ms) => settles(() => shown().includes(needle), ms)

/** The host, driven: one owner's turn, one permission answered, and the marks this script made along the way. */
async function driveTheHost(out, places, base_url) {
  const child = spawn('script', ['-qefc', `'${join(places.home, 'bin', 'claude')}' --permission-mode default --plugin-dir '${places.plugin}'`, '/dev/null'], {
    cwd: places.checkout,
    env: { HOME: places.home, PATH: [join(places.home, 'bin'), join(process.execPath, '..'), '/usr/bin', '/bin'].join(':'), TERM: 'xterm-256color', ANTHROPIC_BASE_URL: base_url, ANTHROPIC_API_KEY: STAND_IN_KEY, ...THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF },
  })
  let drawn = ''
  const t0 = Date.now()
  child.stdout.on('data', (chunk) => (drawn += chunk.toString('utf8')))
  child.stderr.on('data', (chunk) => (drawn += chunk.toString('utf8')))
  const marks = []
  const mark = (what) => marks.push({ what, at: Date.now() })
  await waitFor(() => drawn, 'for shortcuts', 60000)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  child.stdin.write('run the probe command\r')
  const asking = await waitFor(() => drawn, PROMPT_SHOWN, 45000)
  mark(asking ? 'asked' : 'no-dialog')
  // Answering is a keystroke into a terminal that draws its own timings: the dialog has been drawn but the prompt
  // takes its input a moment later, and a Return that lands too early is dropped. So the answer is given again if the
  // call has not answered a third of a minute later; the second Return is the one the dialog was waiting for.
  const hasRun = () => readdirSync(places.logdir).some((name) => name.endsWith('-post-tool-use.json'))
  for (const attempt of [1, 2]) {
    if (!asking) break
    await new Promise((resolve) => setTimeout(resolve, 1200))
    child.stdin.write('\r')
    if (attempt === 1) mark('answered')
    if (await settles(hasRun, attempt === 1 ? 20000 : 45000)) break
    mark(`answered-again-${attempt}`)
  }
  mark(hasRun() ? 'ran' : 'never-ran')
  child.stdin.write('/exit\r')
  await new Promise((resolve) => setTimeout(resolve, 2000))
  child.kill('SIGKILL')
  writeFileSync(join(out, 'screen.log'), drawn)
  return { marks, t0 }
}

/** Every event the host raised, in the order it raised them. */
const theOrder = (places) => readdirSync(places.logdir).sort().map((name) => JSON.parse(readFileSync(join(places.logdir, name), 'utf8')))

/** Whether `tag` arrived before `other`; and whether any event arrived between the owner's answer and the run. */
function checkTheOrder(entries, marks) {
  const at = (tag) => entries.find((entry) => entry.tag === tag)?.at
  const answered = marks.find((mark) => mark.what === 'answered')?.at ?? 0
  const order = [['tool-call', 'check'], ['check', 'permission'], ['permission', 'post-tool-use'], ['post-tool-use', 'tool-call-returned']]
  const outOfOrder = order.filter(([before, after]) => at(before) === undefined || at(after) === undefined || at(before) > at(after))
  // What matters is nothing the relay could close a dialog on arrives between the answer and the run: a notification
  // between the two opens nothing on the row (`theOwnerIsToldOf` is false for a permission prompt), so it is allowed.
  const couldClose = ['tool-call', 'pre-tool-use', 'check', 'permission']
  const inBetween = entries.filter((entry) => entry.at > answered && entry.at < (at('post-tool-use') ?? Infinity))
  return {
    outOfOrder,
    between: inBetween.filter((entry) => couldClose.includes(entry.tag)).map((entry) => entry.tag),
    alsoRaised: inBetween.filter((entry) => !couldClose.includes(entry.tag)).map((entry) => entry.tag),
    said: { call: at('tool-call') !== undefined, check: at('check') !== undefined, permission: at('permission') !== undefined, answered: answered !== 0 },
  }
}

process.exitCode = 2
if (HOST === undefined || HOST === '') {
  process.stderr.write('Set MARTHA_RECORDED_HOST to the Claude Code binary at the recorded version.\n')
} else {
  const places = setUp(OUT)
  const server = await standInModel()
  const { marks, t0 } = await driveTheHost(OUT, places, `http://127.0.0.1:${server.address().port}`)
  server.close()
  const entries = theOrder(places)
  writeFileSync(join(OUT, 'ordering.log'), entries.map((entry) => `${new Date(entry.at).toISOString()} +${String(entry.at - t0).padStart(6)}ms  ${entry.tag}  ${JSON.stringify(entry.payload)}`).join('\n') + '\n')
  writeFileSync(join(OUT, 'marks.log'), marks.map((mark) => `${new Date(mark.at).toISOString()} +${String(mark.at - t0).padStart(6)}ms  ${mark.what}`).join('\n') + '\n')
  process.stdout.write(`${readFileSync(join(OUT, 'ordering.log'), 'utf8')}--- marks\n${readFileSync(join(OUT, 'marks.log'), 'utf8')}`)
  const checked = checkTheOrder(entries, marks)
  const failed = checked.outOfOrder.length > 0 || checked.between.length > 0 || !Object.values(checked.said).every((yes) => yes)
  process.stdout.write(
    failed
      ? `FAIL: the host did not raise its events in the order the owner's row relies on.\n  missing or out of order: ${JSON.stringify(checked.outOfOrder)}\n  between the answer and the run: ${JSON.stringify(checked.between)}\n  heard: ${JSON.stringify(checked.said)}\n  the evidence: ${OUT}\n`
      : `PASS: the call is posted, then checked, then asked about; the owner answers; and nothing the row could close on is raised before the call's own answer. The row closes on that answer.\n  between the answer and the run: nothing${checked.alsoRaised.length === 0 ? '' : ` (also raised there, and opens nothing: ${JSON.stringify(checked.alsoRaised)})`}\n  the evidence: ${OUT}\n`,
  )
  process.exitCode = failed ? 1 : 0
}

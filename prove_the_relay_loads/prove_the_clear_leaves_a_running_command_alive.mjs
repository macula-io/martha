// prove_the_clear_leaves_a_running_command_alive.mjs [out-dir]: whether the host's own clear, the one a member's
// refresh runs (CARRY_THE_CLEAR), leaves a background command the member started alive (#693 R3).
//
// This exists because the design of #693 has to say whether a refresh is a place a killed run can leave a mutant in the
// tree. A refresh carries `clear` inside the running host (`crew_answers.ts`), so nothing in Martha ends a process
// there -- unless the host's clear replaces the process the background command belongs to, which no documentation
// answers and only a run on the host can.
//
//   MARTHA_RECORDED_HOST=/path/to/claude node prove_the_relay_loads/prove_the_clear_leaves_a_running_command_alive.mjs
//
// It is not part of `npm test`: it starts the host under a terminal, lets it run one background command, and clears it.
// Run it when the host version changes, or when the refresh's clear changes, and read what it prints.
//
// Exit: 0 the background command was still alive after the clear (a refresh ends nothing), 1 it was not (a refresh ends
// the member's commands, so a refresh must take a record too), 2 the host could not be set up or never ran the command.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

// The host's auto-updater is switched off by the switch the launch module holds, spread from there rather than typed,
// as prove_the_order_of_the_dialogs.mjs does (martha#474).
import { HOSTS } from '../src/refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { CLAUDE_CODE } from '../src/know_claude_codes_own_facts/claude_code_facts.ts'

/** The host, at the version the adapter was recorded from: the same variable the recorded-host tests read. */
const HOST = process.env.MARTHA_RECORDED_HOST
const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'martha-clear-probe-'))
/** A key the stand-in accepts and no service does: nothing here reaches the network. */
const STAND_IN_KEY = `sk-ant-api03-${'0'.repeat(80)}`
/** Written by the command the member starts, so the probe knows which pid to look for. */
const PID_FILE = 'background.pid'
/** How long the background command would outlive any clear: far longer than this probe takes. */
const BACKGROUND_SECONDS = '600'
/** The command the member is made to start: it writes its own pid, then outlives the probe on purpose. */
const BACKGROUND_COMMAND = `(echo $$ > ${PID_FILE}; exec sleep ${BACKGROUND_SECONDS}) & echo started`

/** The home the host finds a first run already done in, and the checkout it runs in. */
function setUp(out) {
  rmSync(out, { recursive: true, force: true })
  const home = join(out, 'home')
  const checkout = join(out, 'checkout')
  for (const dir of [home, checkout, join(home, 'bin')]) mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(home, '.claude.json'),
    `${JSON.stringify({
      hasCompletedOnboarding: true,
      customApiKeyResponses: { approved: [STAND_IN_KEY.slice(-20)], rejected: [] },
      projects: { [checkout]: { hasTrustDialogAccepted: true } },
    })}\n`,
    { mode: 0o600 },
  )
  symlinkSync(HOST, join(home, 'bin', 'claude'))
  return { home, checkout }
}

/** One streamed turn: the first calls Bash in the background, every later one answers with text and ends. */
function turnOf(number, model, command) {
  const message = { id: `msg_${number}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
  const blocks =
    number === 1
      ? [
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_probe_bg', name: 'Bash', input: {} } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command, description: 'the probe background command', run_in_background: true }) },
          },
        ]
      : [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'done' } }]
  const events = [
    { type: 'message_start', message },
    ...blocks,
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
    const tools = Array.isArray(body.tools) ? body.tools : []
    if (tools.length === 0) return void response.writeHead(200, { 'content-type': 'text/event-stream' }).end(turnOf(0, body.model, command))
    offered += 1
    response.writeHead(200, { 'content-type': 'text/event-stream' }).end(turnOf(offered, body.model, command))
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

/** Whether a pid is still there: signal 0 answers without sending one. */
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The pid the background command wrote, once it has written it. */
const theBackgroundPid = (out) => {
  const file = join(out, 'checkout', PID_FILE)
  if (!existsSync(file)) return undefined
  const pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10)
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** The host, driven: one turn that starts a background command, then the host's own clear. */
async function driveTheHost(out, places, base_url) {
  const command = BACKGROUND_COMMAND
  const child = spawn('script', ['-qefc', `'${join(places.home, 'bin', 'claude')}' --dangerously-skip-permissions`, '/dev/null'], {
    cwd: places.checkout,
    env: {
      HOME: places.home,
      PATH: [join(places.home, 'bin'), join(process.execPath, '..'), '/usr/bin', '/bin'].join(':'),
      TERM: 'xterm-256color',
      ANTHROPIC_BASE_URL: base_url,
      ANTHROPIC_API_KEY: STAND_IN_KEY,
      ...HOSTS[CLAUDE_CODE].env_last,
    },
  })
  let drawn = ''
  const screen = () => drawn
  child.stdout.on('data', (chunk) => (drawn += chunk.toString('utf8')))
  child.stderr.on('data', (chunk) => (drawn += chunk.toString('utf8')))
  const marks = []
  const mark = (what) => marks.push({ what, at: Date.now() })
  // The bypass warning is drawn once, before the first turn: its first choice is "No, exit", so the probe moves the
  // selection down to the one that accepts and confirms it.
  const warned = await settles(() => screen().includes('Enter to confirm'), 20000)
  if (warned) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    child.stdin.write('\u001b[B')
    await new Promise((resolve) => setTimeout(resolve, 300))
    child.stdin.write('\r')
    mark('accepted-the-warning')
  }
  await settles(() => screen().includes('for shortcuts'), 60000)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  child.stdin.write('run the probe command\r')
  const started = await settles(() => theBackgroundPid(out) !== undefined, 60000)
  mark(started ? 'background-started' : 'background-never-started')
  const pid = theBackgroundPid(out)
  const hostAliveBefore = child.pid !== undefined && alive(child.pid)
  const drawnBefore = drawn.length
  if (started) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  child.stdin.write('/clear\r')
  // The clear is the host's own command: it is done when the screen has drawn itself again past what it held, and the
  // welcome line is back. A Return that lands too early is dropped, as the dialog probe found, so it is sent twice.
  const cleared = await settles(() => drawn.slice(drawnBefore).includes('for shortcuts') || drawn.length > drawnBefore + 2000, 20000)
  if (!cleared) {
    child.stdin.write('/clear\r')
    await settles(() => drawn.slice(drawnBefore).includes('for shortcuts') || drawn.length > drawnBefore + 2000, 20000)
  }
  mark('cleared')
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const stillThere = pid === undefined ? false : alive(pid)
  const hostAliveAfter = child.pid !== undefined && alive(child.pid)
  child.stdin.write('/exit\r')
  await new Promise((resolve) => setTimeout(resolve, 2000))
  child.kill('SIGKILL')
  writeFileSync(join(out, 'screen.log'), drawn)
  return { command, pid, stillThere, hostAliveBefore, hostAliveAfter, marks }
}

const main = async () => {
  if (HOST === undefined) {
    process.stderr.write('MARTHA_RECORDED_HOST must name the claude binary to probe\n')
    return 2
  }
  const places = setUp(OUT)
  const server = await standInModel(BACKGROUND_COMMAND)
  const { port } = server.address()
  const drove = await driveTheHost(OUT, places, `http://127.0.0.1:${port}`)
  server.close()
  const said = {
    host: HOST,
    out: OUT,
    command: drove.command,
    background_pid: drove.pid,
    alive_after_clear: drove.stillThere,
    host_process_alive_before_clear: drove.hostAliveBefore,
    host_process_alive_after_clear: drove.hostAliveAfter,
    marks: drove.marks,
  }
  writeFileSync(join(OUT, 'probe.json'), `${JSON.stringify(said, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(said, null, 2)}\n`)
  if (drove.pid === undefined) return 2
  return drove.stillThere ? 0 : 1
}

process.exitCode = await main()

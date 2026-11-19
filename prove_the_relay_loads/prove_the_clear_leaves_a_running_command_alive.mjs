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
// the member's commands, so a refresh must take a record too), 2 the host could not be set up, never ran the command, or
// never ran the clear -- each said by name, because a clear that never ran leaves the command alive too.

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
// The host draws its screen a word at a time, moving the cursor where the spaces would be, so every screen this probe
// matches is read plainly: the one reader both probes use (#693).
import { AT_ITS_PROMPT, says } from '../prove_the_core/read_what_a_host_drew/a_screen_drawn_in_pieces.ts'
// Whether the clear actually ran: the host writes it down, and nothing the probe can see says so (#693).
import { theClearRan } from '../prove_the_core/read_what_a_host_drew/a_clear_the_host_recorded.ts'

/** The host, at the version the adapter was recorded from: the same variable the recorded-host tests read. */
const HOST = process.env.MARTHA_RECORDED_HOST
const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'martha-clear-probe-'))
/** A key the stand-in accepts and no service does: nothing here reaches the network. */
const STAND_IN_KEY = `sk-ant-api03-${'0'.repeat(80)}`
/** Written by the command the member starts, so the probe knows which pid to look for. */
const PID_FILE = 'background.pid'
/** How long the background command would outlive any clear: far longer than this probe takes. */
const BACKGROUND_SECONDS = '600'
/**
 * The command the member is made to start: it writes its own pid and becomes the long sleep, so the pid it writes is
 * the pid that runs. Nothing here forks into the background: the tool is already asked for a background task (turnOf),
 * and `$$` inside a subshell names the shell that forked it, so a `( ... ) &` here would write a shell that exits by
 * itself and leave the probe watching the wrong process.
 */
const BACKGROUND_COMMAND = `echo $$ > ${PID_FILE}; exec sleep ${BACKGROUND_SECONDS}`

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

/**
 * Whether the host has stopped drawing for `quietMs`: a host with a turn running keeps redrawing its spinner, and a
 * host at its prompt draws nothing. This is how the probe knows a turn has ended, because the only words this host
 * prints about a turn are gone from the screen by the time it ends, and a prompt mixed into a running turn is dropped.
 */
const quietFor = async (lengthOf, quietMs, ms) => {
  let seen = lengthOf()
  let since = Date.now()
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (lengthOf() !== seen) {
      seen = lengthOf()
      since = Date.now()
    }
    if (Date.now() - since >= quietMs) return true
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

/** Whether the host's own process is still there. */
const theHostIsAlive = (child) => child.pid !== undefined && alive(child.pid)

/** The pid the background command wrote, once it has written it. */
const theBackgroundPid = (out) => {
  const file = join(out, 'checkout', PID_FILE)
  if (!existsSync(file)) return undefined
  const pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10)
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** How long the host must have drawn nothing for the probe to take it as back at its prompt. */
const QUIET_MS = 1500
/** How long the probe waits for the host to go quiet at all before typing at it anyway. */
const IDLE_WAIT_MS = 30000
/** How long the clear is given to finish: it is the host's own local command and calls no model. */
const CLEAR_SETTLES_MS = 5000
/** How long each screen this probe types at is given: the bypass warning, the banner, then the command's own pid. */
const WARNING_WAIT_MS = 20000
const WELCOME_WAIT_MS = 60000
const STARTED_WAIT_MS = 60000

/** Every screen this probe needs and may never see, each said by name so a run that cannot happen says so. */
const NEVER_DRAWN = Object.freeze({
  warning: `the bypass warning was never drawn: no screen said "Enter to confirm" within ${WARNING_WAIT_MS / 1000}s`,
  prompt: `the host never reached its prompt: no screen said "${AT_ITS_PROMPT}" after the warning was accepted`,
  started: `the background command never wrote ${PID_FILE}: nothing was running for the clear to end`,
})

/**
 * The clear is not a screen and is not said by one: when it is missing, what is missing is the host's own record of it,
 * so it is named by the record the host should have written rather than by a line it never drew.
 */
const THE_CLEAR_NEVER_RAN = 'the clear never ran: no session the host started holds the /clear'

/** What this run needed and never got, or undefined when it got all four. */
const whatTheRunLacked = (warned, welcomed, started, cleared) => {
  if (!warned) return NEVER_DRAWN.warning
  if (!welcomed) return NEVER_DRAWN.prompt
  if (!started) return NEVER_DRAWN.started
  if (!cleared) return THE_CLEAR_NEVER_RAN
  return undefined
}

/**
 * The bypass warning, drawn once before the first turn: its first choice is "No, exit", so the probe moves the
 * selection down to the one that accepts and confirms it. Whether it was drawn at all.
 */
const acceptTheWarning = async (child, screen) => {
  const warned = await settles(() => says(screen(), 'Enter to confirm'), WARNING_WAIT_MS)
  if (!warned) return false
  await new Promise((resolve) => setTimeout(resolve, 800))
  child.stdin.write('\u001b[B')
  await new Promise((resolve) => setTimeout(resolve, 300))
  child.stdin.write('\r')
  return true
}

/** The host at its prompt, asked for the one turn that starts the background command. Whether it got there. */
const startTheTurn = async (child, screen) => {
  const welcomed = await settles(() => says(screen(), AT_ITS_PROMPT), WELCOME_WAIT_MS)
  if (!welcomed) return false
  await new Promise((resolve) => setTimeout(resolve, 2000))
  child.stdin.write('run the probe command\r')
  return true
}

/**
 * The host's own clear, typed at a prompt and never into a turn -- this host keeps drawing while a turn runs and draws
 * nothing once it is back at its prompt, so the probe waits for it to go quiet -- and what the clear left behind: whether
 * the host's own record holds it, and whether the command is still there afterwards. Nothing this host draws says
 * "cleared": the clear redraws the prompt and no banner (2.1.327, measured), so the answer comes from the record the host
 * writes and from the kernel. A Return that lands before the prompt takes input is dropped, as the order probe finds, so
 * the command is typed once and its Return given again before the clear is called one that never ran.
 */
const clearAtThePrompt = async (child, screen, pid, home) => {
  await quietFor(() => screen().length, QUIET_MS, IDLE_WAIT_MS)
  child.stdin.write('/clear')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    child.stdin.write('\r')
    if (await settles(() => theClearRan(home), CLEAR_SETTLES_MS)) break
  }
  return { cleared: theClearRan(home), stillThere: pid !== undefined && alive(pid) }
}

/** The host, driven: one turn that starts a background command, then the host's own clear. */
async function driveTheHost(out, places, base_url) {
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
  // Each step needs the one before it: without the warning accepted the host sits at the dialog, and every later key
  // would land in it, so a run that cannot get past the first screen stops there and says which screen it lacked.
  const warned = await acceptTheWarning(child, screen)
  mark(warned ? 'accepted-the-warning' : 'the-bypass-warning-never-drawn')
  const welcomed = warned && (await startTheTurn(child, screen))
  if (warned && !welcomed) mark('the-prompt-banner-never-drawn')
  const started = welcomed && (await settles(() => theBackgroundPid(out) !== undefined, STARTED_WAIT_MS))
  mark(started ? 'background-started' : 'background-never-started')
  const pid = theBackgroundPid(out)
  const hostAliveBefore = theHostIsAlive(child)
  let cleared = false
  let stillThere
  if (started) {
    const afterTheClear = await clearAtThePrompt(child, screen, pid, places.home)
    cleared = afterTheClear.cleared
    stillThere = afterTheClear.stillThere
    mark(cleared ? 'cleared' : 'the-clear-never-ran')
  }
  const hostAliveAfter = theHostIsAlive(child)
  child.stdin.write('/exit\r')
  await new Promise((resolve) => setTimeout(resolve, 2000))
  child.kill('SIGKILL')
  writeFileSync(join(out, 'screen.log'), drawn)
  return { command: BACKGROUND_COMMAND, pid, cleared, stillThere, hostAliveBefore, hostAliveAfter, marks, missing: whatTheRunLacked(warned, welcomed, started, cleared) }
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
    clear_ran: drove.cleared,
    alive_after_clear: drove.stillThere,
    host_process_alive_before_clear: drove.hostAliveBefore,
    host_process_alive_after_clear: drove.hostAliveAfter,
    marks: drove.marks,
    ...(drove.missing === undefined ? {} : { could_not_run: drove.missing }),
  }
  writeFileSync(join(OUT, 'probe.json'), `${JSON.stringify(said, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(said, null, 2)}\n`)
  // A run that never reached the clear says which part it lacked, never that the command was gone: the two are
  // different answers, and only one of them is the probe's. A clear the host's own record does not hold is one of them,
  // because the background command outlives a clear that never ran exactly as it outlives one that did.
  if (drove.missing !== undefined) {
    process.stderr.write(`the probe could not run: ${drove.missing}\n`)
    return 2
  }
  return drove.stillThere ? 0 : 1
}

process.exitCode = await main()

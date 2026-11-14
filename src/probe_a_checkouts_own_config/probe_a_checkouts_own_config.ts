// The launch probe's rows about a checkout's own config (martha#443): its CLAUDE.md files and agents,
// the tool servers, hooks and plugins it declares, and the stop hooks a launch approves.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { INSTRUCTION_FILES } from '../inbound_paths/inbound_paths.ts'
import { CLAUDE_CODE, LAUNCH_FILES_OF_HOST } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import {
  claude,
  claudeAsTheAgent,
  HEADLESS_CLAUDE,
  PROMPT,
  put,
  RUN_TIMEOUT_MS,
  type Command,
  type Place,
  type Probe,
} from '../declare_a_launch_probe/declare_a_launch_probe.ts'
import { MANAGED_MARKDOWN_FOLDER } from '../claude_code_host/hooks_and_plugins_the_owner_declares.ts'

const [CLAUDE_SERVERS, CLAUDE_SETTINGS] = LAUNCH_FILES_OF_HOST['claude-code']
const [OPENCODE_CONFIG, , OPENCODE_DIR] = LAUNCH_FILES_OF_HOST.opencode

/** A server that only touches its marker, then lingers long enough to be seen. */
const LINGER_SECONDS = 3

const linger = (marker: string) => `touch ${marker}; sleep ${LINGER_SECONDS}`

/** The name a planted tool server is declared under, read back where a row needs the host to have listed it (martha#188). */
const PLANTED_SERVER_NAME = 'planted'

const claudeServer = (name: string, marker: string) =>
  JSON.stringify({ mcpServers: { [name]: { command: 'sh', args: ['-c', linger(marker)] } } })
const claudeHook = (marker: string) =>
  JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${marker}` }] }] } })
const opencodeServer = (name: string, marker: string) =>
  JSON.stringify({ mcp: { servers: { [name]: { type: 'local', command: ['sh', '-c', linger(marker)], enabled: true } } } })
const opencodePlugin = (marker: string) =>
  `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, '')\nexport const Probe = async () => ({})\n`

/**
 * Approved hooks for the stop: one after every tool call (the launcher's), one
 * when the turn ends, one when the session ends. `after` is what the
 * after-call hook does once it has marked that it ran.
 */
const claudeStopHooks = (place: Place, after: string) => {
  const hook = (command: string) => [{ hooks: [{ type: 'command', command }] }]
  return JSON.stringify({
    hooks: {
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `touch ${place.marker('AFTER_CALL_HOOK')}; ${after}` }] }],
      Stop: hook(`touch ${place.marker('STOP_HOOK')}`),
      SessionEnd: hook(`touch ${place.marker('SESSION_END_HOOK')}`),
    },
  })
}

/** The launcher's stop: SIGKILL the member's whole process group, and do not return before it lands. */
const KILL_THE_GROUP = `kill -KILL -- "-$MEMBER_GROUP"; sleep ${RUN_TIMEOUT_MS / 1000}`
/** An after-call hook that only reports, and lets the host go on. */
const ONLY_REPORT = 'true'

/** Claude Code as the leader of its own process group, whose id the hooks read as MEMBER_GROUP. */
const claudeInItsOwnGroup = (...extra: readonly string[]): Command => (switches) => ({
  command: 'setsid',
  args: ['sh', '-c', 'export MEMBER_GROUP=$$; exec "$0" "$@"', 'claude', ...extra, ...switches.args],
})
/** A prompt that makes one tool call before the reply. */
const ONE_CALL_PROMPT = 'Run the shell command `true` with the Bash tool, then reply with the single word ok.'
// The prompt goes before `--allowedTools`, which takes every argument up to the next option.
const ONE_CALL_CLAUDE = ['-p', '--max-turns', '3', '--model', 'haiku', ONE_CALL_PROMPT, '--allowedTools', 'Bash(true)']

// --- a checkout's fixed text: CLAUDE.md files and agents (A16, martha#121) ------

const NESTED_DIR = 'sub'
const NESTED_FILE = join(NESTED_DIR, 'notes.txt')
const AGENT = 'probe-agent'
/** A prompt that reads a file below the top, which is when the host loads that directory's CLAUDE.md. */
const READ_BELOW_PROMPT = `Use the Read tool on ${NESTED_FILE}, then reply with the single word ok.`
const READ_BELOW_CLAUDE = ['-p', '--max-turns', '3', '--model', 'haiku', READ_BELOW_PROMPT, '--allowedTools', 'Read']

/** The checkout's fixed text: a CLAUDE.md at the top, one below it, and an agent. */
function plantFixedText(place: Place): void {
  put(place.checkout, INSTRUCTION_FILES.checkout, 'Probe instructions at the top.\n')
  put(place.checkout, join(NESTED_DIR, INSTRUCTION_FILES.checkout), 'Probe instructions below the top.\n')
  put(place.checkout, NESTED_FILE, 'a file below the top\n')
  put(place.checkout, join(MANAGED_MARKDOWN_FOLDER, 'agents', `${AGENT}.md`), `---\nname: ${AGENT}\ndescription: a probe agent\n---\nReply with the single word ok.\n`)
}

/**
 * Settings whose InstructionsLoaded hook marks each of the checkout's two
 * CLAUDE.md files the host loads, by the path the host reports. A file the
 * owner keeps elsewhere marks nothing. A PostToolUse hook on Read marks
 * READ_BELOW when the model read the file below the top, so a run in which
 * that read never happened cannot pass for one in which the nested file
 * did not load.
 */
function instructionsHook(place: Place): string {
  const read = join(place.scratch, 'mark_read_below.mjs')
  writeFileSync(
    read,
    `import { readFileSync, writeFileSync } from 'node:fs'\n` +
      `import { resolve } from 'node:path'\n` +
      `const input = JSON.parse(readFileSync(0, 'utf8'))\n` +
      `const path = resolve(input.cwd, String(input.tool_input?.file_path))\n` +
      `if (path === ${JSON.stringify(join(place.checkout, NESTED_FILE))}) writeFileSync(${JSON.stringify(place.marker('READ_BELOW'))}, '')\n`,
  )
  const script = join(place.scratch, 'mark_instructions.mjs')
  const marks = {
    [join(place.checkout, INSTRUCTION_FILES.checkout)]: place.marker('TOP_CLAUDE_MD'),
    [join(place.checkout, NESTED_DIR, INSTRUCTION_FILES.checkout)]: place.marker('NESTED_CLAUDE_MD'),
  }
  writeFileSync(
    script,
    `import { readFileSync, writeFileSync } from 'node:fs'\n` +
      `const marks = ${JSON.stringify(marks)}\n` +
      `const loaded = JSON.parse(readFileSync(0, 'utf8')).file_path\n` +
      `if (Object.hasOwn(marks, loaded)) writeFileSync(marks[loaded], '')\n`,
  )
  return JSON.stringify({
    hooks: {
      InstructionsLoaded: [{ hooks: [{ type: 'command', command: `node ${script}` }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: `touch ${place.marker('SETTINGS_HOOK')}` }] }],
      PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: `node ${read}` }] }],
    },
  })
}

const opencode = (...extra: readonly string[]): Command => (switches) => ({
  command: 'opencode',
  args: [...extra, ...switches.args],
})

export const PROBES: readonly Probe[] = [
  {
    what: "Claude Code by hand, headless: a checkout's CLAUDE.md at the top and below it",
    host: CLAUDE_CODE,
    command: claude(...READ_BELOW_CLAUDE),
    planted: (place) => {
      plantFixedText(place)
      put(place.checkout, CLAUDE_SETTINGS, instructionsHook(place))
    },
    expected: { SETTINGS_HOOK: true, READ_BELOW: true, TOP_CLAUDE_MD: true, NESTED_CLAUDE_MD: true },
    planned: false,
  },
  {
    what: "Claude Code as Martha starts it, headless: a checkout's CLAUDE.md at the top and below it (A16)",
    host: CLAUDE_CODE,
    command: claude(...READ_BELOW_CLAUDE),
    approved: (place) => put(place.checkout, CLAUDE_SETTINGS, instructionsHook(place)),
    planted: plantFixedText,
    expected: { SETTINGS_HOOK: true, READ_BELOW: true, TOP_CLAUDE_MD: false, NESTED_CLAUDE_MD: false },
    planned: true,
  },
  {
    what: "Claude Code by hand, headless: started as a checkout's agent",
    host: CLAUDE_CODE,
    command: claudeAsTheAgent(AGENT, ...HEADLESS_CLAUDE),
    planted: plantFixedText,
    expected: { AGENT_LOADED: true, AGENT_NOT_FOUND: false },
    planned: false,
  },
  {
    what: "Claude Code as Martha starts it, headless: started as a checkout's agent (A16)",
    host: CLAUDE_CODE,
    command: claudeAsTheAgent(AGENT, ...HEADLESS_CLAUDE),
    planted: plantFixedText,
    expected: { AGENT_LOADED: false, AGENT_NOT_FOUND: true },
    planned: true,
  },
  {
    what: 'Claude Code by hand, interactive health check: a project tool server',
    host: CLAUDE_CODE,
    command: claude('mcp', 'list'),
    planted: (place) => put(place.checkout, CLAUDE_SERVERS, claudeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER'))),
    // The list it prints is the proof it ran and read this checkout's config: the claim is about the server it did NOT
    // start, and a host that quit on the config would print no list at all (martha#188).
    from_output: (_place: Place, printed: string) => ({ LISTED_SERVER: printed.includes(PLANTED_SERVER_NAME) }),
    expected: { PLANTED_SERVER: false, LISTED_SERVER: true },
    planned: false,
  },
  {
    what: 'Claude Code by hand, headless: a project tool server and SessionStart hook',
    host: CLAUDE_CODE,
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    planted: (place) => {
      put(place.checkout, CLAUDE_SERVERS, claudeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, CLAUDE_SETTINGS, claudeHook(place.marker('PLANTED_HOOK')))
    },
    expected: { PLANTED_SERVER: true, PLANTED_HOOK: true },
    planned: false,
  },
  {
    what: 'OpenCode by hand, debug config: a project tool server and plugin',
    host: 'opencode',
    command: opencode('debug', 'config'),
    planted: (place) => {
      put(place.checkout, OPENCODE_CONFIG, opencodeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, join(OPENCODE_DIR, 'plugin', 'probe.ts'), opencodePlugin(place.marker('PLANTED_PLUGIN')))
    },
    expected: { PLANTED_SERVER: true, PLANTED_PLUGIN: true },
    planned: false,
  },
  {
    what: 'Claude Code as Martha starts it, headless: config rewritten after approval',
    host: CLAUDE_CODE,
    // The prompt goes before the switches: `--mcp-config` takes every argument up to the next option.
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: (place) => {
      put(place.checkout, CLAUDE_SERVERS, claudeServer('approved', place.marker('APPROVED_SERVER')))
      put(place.checkout, CLAUDE_SETTINGS, claudeHook(place.marker('APPROVED_HOOK')))
    },
    planted: (place) => {
      put(place.checkout, CLAUDE_SERVERS, claudeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, CLAUDE_SETTINGS, claudeHook(place.marker('PLANTED_HOOK')))
    },
    expected: { APPROVED_SERVER: true, APPROVED_HOOK: true, PLANTED_SERVER: false, PLANTED_HOOK: false },
    planned: true,
  },
  {
    what: 'OpenCode as Martha starts it, run: config rewritten and a plugin added after approval',
    host: 'opencode',
    command: (switches) => ({ command: 'opencode', args: ['run', ...switches.args, PROMPT] }),
    approved: (place) =>
      put(place.checkout, OPENCODE_CONFIG, opencodeServer('approved', place.marker('APPROVED_SERVER'))),
    planted: (place) => {
      put(place.checkout, OPENCODE_CONFIG, opencodeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, join(OPENCODE_DIR, 'plugin', 'probe.ts'), opencodePlugin(place.marker('PLANTED_PLUGIN')))
    },
    expected: { APPROVED_SERVER: true, PLANTED_SERVER: false, PLANTED_PLUGIN: false },
    planned: true,
  },
  {
    what: "OpenCode as Martha starts it, run: the owner's environment says project config on",
    host: 'opencode',
    command: (switches) => ({ command: 'opencode', args: ['run', ...switches.args, PROMPT] }),
    approved: (place) =>
      put(place.checkout, OPENCODE_CONFIG, opencodeServer('approved', place.marker('APPROVED_SERVER'))),
    planted: (place) => {
      put(place.checkout, OPENCODE_CONFIG, opencodeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, join(OPENCODE_DIR, 'plugin', 'probe.ts'), opencodePlugin(place.marker('PLANTED_PLUGIN')))
    },
    inherited: { OPENCODE_CONFIG_PROJECT_DISABLE: '0', OPENCODE_DISABLE_PROJECT_CONFIG: '0' },
    expected: { APPROVED_SERVER: true, PLANTED_SERVER: false, PLANTED_PLUGIN: false },
    planned: true,
  },
  {
    what: 'Claude Code as Martha starts it, headless: an after-call hook that only reports',
    host: CLAUDE_CODE,
    command: claudeInItsOwnGroup(...ONE_CALL_CLAUDE),
    approved: (place) => put(place.checkout, CLAUDE_SETTINGS, claudeStopHooks(place, ONLY_REPORT)),
    planted: () => {},
    expected: { AFTER_CALL_HOOK: true, STOP_HOOK: true, SESSION_END_HOOK: true },
    planned: true,
  },
  {
    what: "Claude Code as Martha starts it, headless: the after-call hook waits for the launcher to SIGKILL the member's group",
    host: CLAUDE_CODE,
    command: claudeInItsOwnGroup(...ONE_CALL_CLAUDE),
    approved: (place) => put(place.checkout, CLAUDE_SETTINGS, claudeStopHooks(place, KILL_THE_GROUP)),
    planted: () => {},
    expected: { AFTER_CALL_HOOK: true, STOP_HOOK: false, SESSION_END_HOOK: false },
    planned: true,
  },
]

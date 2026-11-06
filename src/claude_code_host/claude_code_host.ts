// The Claude Code adapter: the host contract (#25) on Claude Code (#41).
//
// This exists so a crew runs on Claude Code with its gates fed by what the host
// itself says, never by what a turn's text or a file anyone can write says.
//
// It is a composer and decides nothing: every behaviour is a slice's. It takes
// the few engine calls it needs (the clock, submitting a prompt, registering a
// tool) and the two directories the host keeps for the crew, and builds:
//
//   - clock: the engine's;
//   - stores: rows in ../row_streams_directory, documents read from disk, and
//     the launcher's records from ../linux_process_identity, handed to slices
//     only as `readingOnly` (#42): the writable store is the launcher's seam and
//     never leaves the launcher; and the disk's files and scratch directories,
//     also from ../linux_process_identity (#26);
//   - processes: a child process run directly, so a signal reads as a null exit
//     code (the engine's own runner reports it as 1), one run now and waited for
//     (#26), and which process holds a pid from the kernel, boot included;
//   - delivery: the engine's prompt submission, and every prompt the engine
//     raises, with where it came from read only from the engine's `origin`;
//   - tools: the engine's registration, behind a registry of the adapter's own
//     that refuses a name twice before the engine sees it (T12), and the name
//     a called tool's own server gave it, taken from `mcp__<server>__<tool>` at
//     the last `__`; the hook glue passes `host.tools` to
//     ../answer_a_tool_call as its `names`.
//
// Rules from the threat model on martha#41:
//
//   - WHERE A TURN CAME FROM IS THE ENGINE'S WORD (T1, T5). The engine stamps
//     every prompt's `origin` where it queued it, and no hook may set it. Its
//     kind maps to a turn source through the declaration in
//     ../name_the_source_of_a_prompt, which names one for every kind the
//     recorded host stamps (recorded_claude_code_host.ts); an unknown kind is
//     another session's message. Text never sets a source.
//   - NO SENDER UNTIL THE HOST GIVES ONE (T2, T4). The host knows which process
//     sent a cross-session message and does not hand it to plugins yet
//     (anthropics/claude-code#107216). So no arrival carries a `sender`, and the
//     binder binds nothing (A6). Nothing in an origin or an envelope is read as
//     identity: not `from`, not `teammate`, not `plugin`.
//   - NO TRANSCRIPT (T3). The adapter reads no transcript, for anything: it is a
//     file any member's shell can append a forged line to.
//   - A REFRESH IS NEVER CLAIMED (T8). A session start maps the host's own source
//     and session id, nothing else. A predecessor id in a hook input is dropped,
//     and a source the host does not send (the crew's refresh among them) maps to
//     an event no declaration lists, so it fails closed. The refresh is the
//     crew mod's to report, from its own refresh path.
//
// The engine calls are typed here by shape, so the core imports no tool's
// package (#25's import rule). The mod that loads Martha passes its `$`.

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { bindNothing, type Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { SessionStart } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import {
  readingOnly,
  type ArrivingTurn,
  type HostContract,
  type ProcessOutcome,
  type ProcessRequest,
  type Tool,
} from '../host_contract/host_contract.ts'
import {
  filesOnThisMachine,
  runNowOnThisMachine,
  scratchOnThisMachine,
} from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { arrivalOfPrompt, CLAUDE_CODE_PROMPT_ORIGINS } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { CLAUDE_CODE_SESSION_START_SOURCES } from './recorded_claude_code_host.ts'

/** The engine calls the adapter makes, as Claude Code's `$` offers them. */
export interface ClaudeCodeEngine {
  readonly clock: { now(): number }
  readonly prompt: { submit(input: { readonly text: string }): Promise<unknown> }
  readonly tool: {
    register(tool: { readonly name: string; readonly description: string }): Promise<unknown>
  }
}

/** Where the host keeps the crew's files: absolute directories, this user's own. */
export interface ClaudeCodePlaces {
  readonly rows: string
  readonly launch_records: string
}

/** A prompt as the engine raises it: its text, and the origin the engine stamped. */
export interface EnginePrompt {
  readonly text: string
  readonly origin: { readonly kind: string }
}

/** A SessionStart hook input, as the host sends it; only two fields are read. */
export interface SessionStartHookInput {
  readonly session_id: string
  readonly source: string
  readonly [field: string]: unknown
}

export interface ClaudeCodeHost {
  readonly host: HostContract
  /** The binder over the host's attested senders: none on this host yet (A6). */
  readonly binder: Binder
  /** Hands a prompt the engine raised to every turn listener. */
  prompted(prompt: EnginePrompt): void
  /** Answers a call of a registered tool. */
  answerToolCall(name: string, args: Readonly<Record<string, unknown>>): Promise<string>
  /** Resolves once the engine took every tool registered so far, or rejects with why. */
  toolsRegistered(): Promise<void>
}

/** What prefixes a source the host does not send, so no declaration can list it. */
const NOT_A_HOST_SOURCE = 'not sent by the host: '

/** A session start, from the hook input: the host's source and session id, nothing else. */
export function sessionStartOf(input: SessionStartHookInput): SessionStart {
  const event = CLAUDE_CODE_SESSION_START_SOURCES.includes(input.source) ? input.source : `${NOT_A_HOST_SOURCE}${input.source}`
  return { event, session_id: input.session_id }
}

/** The host contract on Claude Code, over these directories. */
export function claudeCodeHost(engine: ClaudeCodeEngine, places: ClaudeCodePlaces): ClaudeCodeHost {
  const listeners: ((turn: ArrivingTurn) => void)[] = []
  const tools = new Map<string, Tool>()
  const registrations: Promise<unknown>[] = []

  const host: HostContract = {
    clock: { now: () => engine.clock.now() },
    stores: {
      rows: rowStreamsDirectory(places.rows),
      documents: { read: async (path) => readFile(path, 'utf8') },
      launches: readingOnly(launchRecordsDirectory(places.launch_records)),
      files: filesOnThisMachine,
      scratch: scratchOnThisMachine,
    },
    processes: {
      run: runProcess,
      runNow: runNowOnThisMachine,
      identityOf: (pid) => linuxProcessIdentities.identityOf(pid),
    },
    delivery: {
      handToModel: async (text) => void (await engine.prompt.submit({ text })),
      onTurn: (take) => void listeners.push(take),
    },
    tools: {
      ownNameOf: ownNameOfCalledTool,
      register: (tool) => {
        if (tools.has(tool.name)) throw new Error(`a tool is already registered: ${tool.name}`)
        tools.set(tool.name, tool)
        const registration = engine.tool.register({ name: tool.name, description: tool.description })
        // Kept for toolsRegistered, which rejects with it; marked handled here so
        // a refusal waits for that call instead of ending the process first.
        registration.catch(() => undefined)
        registrations.push(registration)
      },
    },
  }

  return {
    host,
    binder: bindNothing,
    prompted: (prompt) => {
      const turn: ArrivingTurn = { text: prompt.text, arrival: arrivalOfPrompt(CLAUDE_CODE_PROMPT_ORIGINS, prompt.origin.kind) }
      for (const take of listeners) take(turn)
    },
    answerToolCall: async (name, args) => {
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool is registered by that name: ${name}`)
      return tool.answer(args)
    },
    toolsRegistered: async () => void (await Promise.all(registrations)),
  }
}

/** What Claude Code puts between the parts of an MCP tool's name: `mcp__<server>__<tool>`. */
const MCP_NAME_SEPARATOR = '__'
const MCP_NAME_PREFIX = `mcp${MCP_NAME_SEPARATOR}`

/**
 * The name a called tool's own server gave it: what follows the last `__` of an
 * `mcp__` tool. The host only replaces characters outside [A-Za-z0-9_-] in a
 * server's name, so the server part may itself hold `__`; splitting at the last
 * one is exact while no tool's own name holds `__` (gapsInMeshTools checks the
 * mesh tools), and otherwise yields a shorter name the core refuses rather than
 * misses. A built-in tool, or an `mcp__` name with nothing after its last `__`,
 * is its own name.
 */
export function ownNameOfCalledTool(called: string): string {
  if (!called.startsWith(MCP_NAME_PREFIX)) return called
  const own = called.slice(called.lastIndexOf(MCP_NAME_SEPARATOR) + MCP_NAME_SEPARATOR.length)
  return own === '' ? called : own
}

/** Whether a called tool is an MCP server's: its result is that server's text (B2). */
export function isMcpToolCall(called: string): boolean {
  return called.startsWith(MCP_NAME_PREFIX)
}

/** Runs a process directly, with no shell, and reports how it ended. */
function runProcess(request: ProcessRequest): Promise<ProcessOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, { cwd: request.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => void stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => void stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code, signal) =>
      resolve({
        exit_code: signal === null ? code : null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    )
  })
}

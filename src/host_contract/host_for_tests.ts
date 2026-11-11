// A host that lives in memory, for the core's tests.
//
// Every slice is tested against this host, never against a coding tool. It keeps
// the contract's promises (rows only append, an append that expects a length
// lands only at it, a missing document is ENOENT, a tool name is registered
// once) and adds the handles a test needs to drive it: set and advance the
// clock, make the next append fail, see which documents were read, watch what
// was handed to the model, and make a turn arrive. It runs no process of its
// own: a test that needs one passes the runner, and without one a run is refused.
// Nor does it hold files on a disk or make scratch directories: a test that
// needs them passes them, and without them every read and every scratch
// directory is refused. The crew's own store is the same: a test that needs one
// passes it (../crew_files_directory on a directory of its own), and without one
// no place can be asked for.
//
// It fails closed where the core trusts the host (#42): with nothing given, the
// launcher's records are empty and no pid is held by any process, so a binder
// over this host binds nobody unless a test says otherwise. Like a real adapter,
// it hands slices the records as `readingOnly`, and keeps the writable store
// apart as the launcher's seam, `launcherRecords`.

import type {
  ArrivingTurn,
  CrewStore,
  FileTree,
  HostContract,
  KeyedRow,
  KeyedRowStore,
  ProcessOutcome,
  ProcessRequest,
  ProcessRequestNow,
  Row,
  ScratchDirectories,
  StoredRow,
  Tool,
  ToolNames,
} from './host_contract.ts'
import { ROW_STREAM_MOVED, readingOnly } from './host_contract.ts'
import { claudeCodeToolNames } from './tool_names_for_tests.ts'

export interface HostForTestsOptions {
  /** The clock's start, in milliseconds since the epoch. */
  readonly now?: number
  /** Documents by absolute path. */
  readonly documents?: Readonly<Record<string, string>>
  /** Runs a process for the test. */
  readonly run?: (request: ProcessRequest) => Promise<ProcessOutcome>
  /** Runs a process now, for the test. */
  readonly runNow?: (request: ProcessRequestNow) => ProcessOutcome
  /** The files the test lets the host read. */
  readonly files?: FileTree
  /** Where the test lets the host make scratch directories. */
  readonly scratch?: ScratchDirectories
  /** The crew's own store the test lets a slice keep files in. */
  readonly crew?: CrewStore
  /** The launcher's records the store starts with. */
  readonly launches?: readonly KeyedRow[]
  /** Which process holds a pid; asked afresh every time. */
  readonly identityOf?: (pid: number) => string | null
  /** How the host this test stands for names a called tool; with none, Claude Code's form, so no test fails open by forgetting it. */
  readonly toolNames?: ToolNames
}

export interface HostForTests {
  readonly host: HostContract
  /** The launcher's seam over the same records `host.stores.launches` reads. */
  readonly launcherRecords: KeyedRowStore
  advanceClock(milliseconds: number): void
  refuseNextAppend(reason: string): void
  turnsHandedToModel(): readonly string[]
  documentsRead(): readonly string[]
  arrive(turn: ArrivingTurn): void
  registeredTool(name: string): Tool | undefined
}

// A row is kept as its JSON text, so neither the writer's object nor a reader's
// copy can change what the store holds, and a row that would not survive a real
// store (a function, a cycle) fails here as it would there.
const kept = (row: Row): string => JSON.stringify(row)

const notGiven = (what: string, detail: string): never => {
  throw new Error(`no ${what} was given to this test host: ${detail}`)
}

const NO_FILES: FileTree = {
  kindOf: (path) => notGiven('file tree', path),
  bytesOf: (path) => notGiven('file tree', path),
  childrenOf: (path) => notGiven('file tree', path),
  realPathOf: (path) => notGiven('file tree', path),
}

const NO_SCRATCH: ScratchDirectories = { make: (root, prefix) => notGiven('scratch place', `${root ?? ''} ${prefix}`) }

const NO_CREW: CrewStore = { place: (name) => notGiven('crew store', name) }

const missingDocument = (path: string): Error =>
  Object.assign(new Error(`ENOENT: no such document: ${path}`), { code: 'ENOENT' })

export function hostForTests(options: HostForTestsOptions = {}): HostForTests {
  let now = options.now ?? 0
  const rows = rowsInMemory()
  const handed: string[] = []
  const reads: string[] = []
  const listeners: ((turn: ArrivingTurn) => void)[] = []
  const tools = new Map<string, Tool>()
  const documents = options.documents ?? {}
  const launches = new Map((options.launches ?? []).map(({ key, row }) => [key, kept(row)]))

  const launcherRecords: KeyedRowStore = {
    all: () => [...launches].map(([key, text]) => ({ key, row: JSON.parse(text) as Row })),
    keep: (key, row) => void launches.set(key, kept(row)),
    drop: (key) => void launches.delete(key),
  }

  const host: HostContract = {
    clock: { now: () => now },
    stores: {
      rows: rows.store,
      documents: {
        read: async (path) => {
          reads.push(path)
          const text = documents[path]
          if (text === undefined) throw missingDocument(path)
          return text
        },
      },
      launches: readingOnly(launcherRecords),
      files: options.files ?? NO_FILES,
      scratch: options.scratch ?? NO_SCRATCH,
      crew: options.crew ?? NO_CREW,
    },
    processes: processesFor(options),
    delivery: {
      handToModel: async (text) => void handed.push(text),
      onTurn: (take) => void listeners.push(take),
    },
    tools: {
      register: (tool) => {
        if (tools.has(tool.name)) throw new Error(`a tool is already registered: ${tool.name}`)
        tools.set(tool.name, tool)
      },
      ownNameOf: (called) => (options.toolNames ?? claudeCodeToolNames).ownNameOf(called),
    },
  }

  return {
    host,
    launcherRecords,
    advanceClock: (milliseconds) => void (now += milliseconds),
    refuseNextAppend: rows.refuseNextAppend,
    turnsHandedToModel: () => [...handed],
    documentsRead: () => [...reads],
    arrive: (turn) => listeners.forEach((take) => take(turn)),
    registeredTool: (name) => tools.get(name),
  }
}

/**
 * The row streams, in memory: rows only append, an append that expects a length
 * lands only at it, and a test can make the next append fail.
 */
function rowsInMemory(): { readonly store: HostContract['stores']['rows']; refuseNextAppend(reason: string): void } {
  let refusal: string | undefined
  const streams = new Map<string, string[]>()

  const append = async (stream: string, row: Row, expected_length?: number): Promise<number> => {
    if (refusal !== undefined) {
      const reason = refusal
      refusal = undefined
      throw new Error(`the store refused the row: ${reason}`)
    }
    const rows = streams.get(stream) ?? []
    if (expected_length !== undefined && rows.length !== expected_length) {
      throw Object.assign(new Error(`${stream} holds ${rows.length} rows, not ${expected_length}`), {
        code: ROW_STREAM_MOVED,
      })
    }
    rows.push(kept(row))
    streams.set(stream, rows)
    return rows.length - 1
  }

  const read = async (stream: string): Promise<readonly StoredRow[]> =>
    (streams.get(stream) ?? []).map((text, position) => ({ position, row: JSON.parse(text) as Row }))

  return { store: { append, read }, refuseNextAppend: (reason) => void (refusal = reason) }
}

/** The processes a test gives; with none, every run is refused and no pid is held. */
function processesFor(options: HostForTestsOptions): HostContract['processes'] {
  return {
    run: async (request) => {
      if (options.run === undefined) throw new Error(`no process runner was given to this test host: ${request.command}`)
      return options.run(request)
    },
    runNow: (request) => (options.runNow ?? ((r: ProcessRequestNow) => notGiven('process runner', r.command)))(request),
    identityOf: (pid) => options.identityOf?.(pid) ?? null,
  }
}

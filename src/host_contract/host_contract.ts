// The host contract: everything the crew core may ask of a coding tool.
//
// A coding tool (Claude Code, OpenCode) hosts Martha as a plugin. Each host has
// one adapter, and the adapter gives the core only what the tool physically has
// (issue #1, "Host-neutral core, one host contract"; #15 finding 1):
//
//   - a clock;
//   - stores: append-only rows, documents read as text, and the launcher's
//     records kept one per key, which slices only read;
//   - running a process, and telling which process holds a pid;
//   - delivery in and out: a turn handed to the model, and the turns that
//     arrive, with where each came from as far as the tool itself can say;
//   - registering a tool.
//
// Nothing that decides anything lives here. A behaviour one host needs and
// another does not is a slice, never a branch in an adapter. Settings are not
// part of the contract: they come from the crew's declaration, read once.
//
// The core imports nothing but its own slices and Node's standard library, so
// this contract is the only way it reaches a coding tool. A test fails by name
// on any other import; the check is in imports_beyond_the_core.ts. This file
// imports nothing at all: every slice depends on the contract, never the reverse.

/** The time, in milliseconds since the Unix epoch. */
export interface Clock {
  now(): number
}

/** A row as the store holds it: plain data that survives being written as JSON. */
export type Row = Readonly<Record<string, unknown>>

/** A row read back, with its position in its stream (0 for the first). */
export interface StoredRow {
  readonly position: number
  readonly row: Row
}

/**
 * Streams of rows that are only ever appended to. There is no way to rewrite
 * or remove a row: a ledger that can be edited cannot be trusted by the member
 * who reads it after a refresh.
 *
 * A stream name is an opaque key. An adapter must encode it before it touches
 * anything the name could steer (a file path, a table, a URL): a name holding
 * `..` or `/` is never a path. Slices check the names they build, and the
 * adapter does not rely on that.
 */
export interface RowStore {
  /**
   * Appends a row and resolves to its position; rejects when the row was not kept.
   * With `expected_length`, the row is kept only if the stream holds exactly that
   * many rows; otherwise it rejects with an error whose `code` is
   * ROW_STREAM_MOVED, and the caller reads again before deciding again.
   */
  append(stream: string, row: Row, expected_length?: number): Promise<number>
  /** Every row of a stream, oldest first; a stream never written to is empty. */
  read(stream: string): Promise<readonly StoredRow[]>
}

/** The code an append rejects with when the stream is not at the length it expected. */
export const ROW_STREAM_MOVED = 'ROW_STREAM_MOVED'

/**
 * Documents read as UTF-8 text, by absolute path. A missing document rejects
 * with an error whose `code` is "ENOENT"; any other failure rejects with its own
 * code. There is no default and no undefined: the caller decides what a missing
 * document means.
 */
export interface DocumentStore {
  read(path: string): Promise<string>
}

/** A row kept under a key, read back with its key. */
export interface KeyedRow {
  readonly key: string
  readonly row: Row
}

/**
 * The launcher's records as every slice sees them: read, never written
 * (martha#14, #42). The launcher's records name which member a pid is, so a
 * slice that could write one could have its own deliveries attributed to
 * another member.
 *
 * This is all the contract hands a slice, and an adapter hands it as
 * `readingOnly(store)`, so the object a slice holds has no writing member at run
 * time either: reaching past the type (`Reflect.get`, `Object.values`, a cast)
 * finds `all` and nothing else.
 *
 * Synchronous on purpose: the binder runs inside a synchronous turn, and with no
 * await between reading a record and asking which process holds its pid, nothing
 * else can run in between.
 *
 * The adapter must keep these promises, which its own tests prove:
 *
 *   - `all` returns no rows at all when the store cannot vouch for what it holds:
 *     a place others may write into, an entry it did not write, a link, or a row
 *     not readable as JSON;
 *   - a row is read from the very thing that was checked, never checked by one
 *     name and read by another;
 *   - a reader never sees half of a row.
 */
export interface KeyedRows {
  /** Every row with its key, or none when the store cannot vouch for what it holds. */
  all(): readonly KeyedRow[]
}

/**
 * The launcher's own seam: the records, written one per key, each in place of
 * the last. It is not part of HostContract. The adapter that launches members
 * holds it and passes it to the binder's writers (recordMemberLaunch,
 * recordMemberStopped); every other slice gets only `readingOnly` of it. A
 * check in prove_the_core names any other writer.
 *
 * A key is an opaque name, like a stream name: the adapter encodes it before it
 * touches a path.
 */
export interface KeyedRowStore extends KeyedRows {
  /** Keeps this row under this key, in place of any row it had. */
  keep(key: string, row: Row): void
  /** Drops the row under this key, if there is one. */
  drop(key: string): void
}

/** The records as a slice may hold them: an object whose only member reads. */
export const readingOnly = (store: KeyedRows): KeyedRows => Object.freeze({ all: () => store.all() })

export interface Stores {
  readonly rows: RowStore
  readonly documents: DocumentStore
  readonly launches: KeyedRows
}

/** A process to run: the command, its arguments and the directory it runs in. */
export interface ProcessRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

/** How a process ended. `exit_code` is null when a signal ended it. */
export interface ProcessOutcome {
  readonly exit_code: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface Processes {
  run(request: ProcessRequest): Promise<ProcessOutcome>
  /**
   * Which process holds this pid now: an opaque text naming the boot and when in
   * that boot the process started, or null when no process holds it or the boot
   * cannot be told. A pid handed out again, or the same pid and start after a
   * reboot, gives another text. Callers compare it for equality and never parse it.
   * Synchronous for the reason KeyedRows gives.
   */
  identityOf(pid: number): string | null
}

// --- where a turn came from ---------------------------------------------------
//
// What a host can say about an arriving turn. These are the contract's words:
// the publish gate's slices read them, and no slice defines them.

/** What the host says about where a turn came from, when it says anything. */
export type TurnOrigin = 'harness_delivery' | 'owner'

/** Every way text reaches a session, in the words a host would use for it. */
export type TurnSource =
  | 'crew_room'
  | 'shared_room'
  | 'backlog_digest'
  | 'ring'
  | 'ring_answer'
  | 'cross_session'
  | 'checkout_hook'
  | 'owner_paste'
  | 'server_instructions'
  | 'checkout_run'
  | 'mesh_read'
  | 'mcp_result'
  | 'gh'
  | 'checkout_file'
  | 'git_history'
  | 'web'
  | 'subagent'

/**
 * What a host attests about who sent one delivery: the sending process, as the
 * host learned it out of band (the kernel's peer credentials on a Unix socket).
 * A host that knows only the turn's text has nothing to put here.
 */
export interface AttestedSender {
  readonly sending_pid: number
}

/** The source whose sender only the binder may name. */
type BoundSource = 'cross_session'

/** Something a session took in, as the host describes it. */
export type Arrival =
  | {
      /** The host knows what it was. */
      readonly source: Exclude<TurnSource, BoundSource>
      /** The identity the host holds for the sender; omitted or null means it holds none. */
      readonly from_identity?: string | null
    }
  | {
      /** The host knows it was a cross-session delivery. */
      readonly source: BoundSource
      /** The sending process, as the host attests it out of band; omitted when it cannot. */
      readonly sender?: AttestedSender
    }
  | {
      /** The host has only the turn's text, as the Claude Code host does. */
      readonly text: string
      readonly origin?: TurnOrigin
      /** The sending process, as the host attests it out of band; omitted when it cannot. */
      readonly sender?: AttestedSender
    }

/** A turn that arrived: its text, and what the host can say about where it came from. */
export interface ArrivingTurn {
  readonly text: string
  readonly arrival: Arrival
}

export interface Delivery {
  /** Hands a turn to the model of this member's session. */
  handToModel(text: string): Promise<void>
  /** Calls `take` with every turn that arrives from now on. */
  onTurn(take: (turn: ArrivingTurn) => void): void
}

/** A tool the member's model can call, and how the core answers it. */
export interface Tool {
  readonly name: string
  readonly description: string
  answer(args: Readonly<Record<string, unknown>>): Promise<string>
}

export interface Tools {
  /** Registers a tool; a second tool by a name already registered is refused. */
  register(tool: Tool): void
}

/** The whole contract. Five parts, as decided on issue #1. */
export interface HostContract {
  readonly clock: Clock
  readonly stores: Stores
  readonly processes: Processes
  readonly delivery: Delivery
  readonly tools: Tools
}

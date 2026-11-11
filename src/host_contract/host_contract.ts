// The host contract: everything the crew core may ask of a coding tool.
//
// A coding tool (Claude Code, OpenCode) hosts Martha as a plugin. Each host has
// one adapter, and the adapter gives the core only what the tool physically has
// (issue #1, "Host-neutral core, one host contract"; #15 finding 1):
//
//   - a clock;
//   - stores: append-only rows, documents read as text, the launcher's
//     records kept one per key, which slices only read, the files on disk as
//     they are, scratch directories a slice makes and writes only inside, and
//     the crew's own store, one place per name, which a slice keeps whole
//     files in and reads back (martha#254 R1, #255);
//   - running a process (now, or later), and telling which process holds a pid;
//   - delivery in and out: a turn handed to the model, and the turns that
//     arrive, with where each came from as far as the tool itself can say;
//   - registering a tool, and taking apart the name a called tool has on
//     this host.
//
// Nothing that decides anything lives here. A behaviour one host needs and
// another does not is a slice, never a branch in an adapter. Settings are not
// part of the contract: they come from the crew's declaration, read once.
//
// The core imports nothing but its own slices and Node's standard library, so
// this contract is the only way it reaches a coding tool. A test fails by name
// on any other import; the check is in prove_the_core/imports_beyond_the_core.ts. This file
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
   *
   * One rejection does not mean the row was not kept: ROW_NOT_DURABLE, with the
   * row's `position`, says the row is in the stream and the host could not make
   * it durable, so it may be read and may be lost in a crash. The caller must
   * not append it again; the store refuses every later append to that stream
   * with the same code, so a retry cannot write a second copy.
   */
  append(stream: string, row: Row, expected_length?: number): Promise<number>
  /** Every row of a stream, oldest first; a stream never written to is empty. */
  read(stream: string): Promise<readonly StoredRow[]>
}

/** The code an append rejects with when the stream is not at the length it expected. */
export const ROW_STREAM_MOVED = 'ROW_STREAM_MOVED'

/** The code an append rejects with when its row is in the stream and not known to be durable. */
export const ROW_NOT_DURABLE = 'ROW_NOT_DURABLE'

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

/**
 * One path on disk as it is, the path itself never followed when it is a link.
 * `other` is anything that is not a plain file, a directory or a link (a socket,
 * a device, a pipe). A plain file says whether its owner may execute it, which is
 * the bit git reads when it writes a mode of 100644 or 100755 (martha#158).
 */
export type FileKind =
  | { readonly kind: 'absent' }
  | { readonly kind: 'file'; readonly ownerExecutes: boolean }
  | { readonly kind: 'directory' }
  | { readonly kind: 'symlink'; readonly target: string }
  | { readonly kind: 'other' }

/** The bit in a file's mode that says its owner may execute it, as git reads it for 100755. */
export const OWNER_EXECUTES = 0o100

/**
 * The files on disk, read as they are, by absolute path (martha#16's launch gate
 * reads a checkout's config and fingerprints it). Nothing here writes.
 *
 * Synchronous for the reason KeyedRows gives: the launch is checked again inside
 * a host's synchronous tool-call hook. A failure other than the path being
 * absent throws an error whose `code` is the system's own (EACCES, ENOTDIR...),
 * so the caller can name it.
 */
export interface FileTree {
  /** What is at this path; `absent` when nothing is. */
  kindOf(path: string): FileKind
  /** A plain file's bytes. */
  bytesOf(path: string): Uint8Array
  /** The names in a directory, in no particular order. */
  childrenOf(path: string): readonly string[]
  /** The path with every link resolved, or null when it cannot be resolved. */
  realPathOf(path: string): string | null
}

/**
 * A directory just made, new and empty, that a slice may write into and remove,
 * and nowhere else. A name that would leave the directory (absolute, or with
 * `..` reaching above it) is refused by the adapter, whatever the slice checked.
 */
export interface ScratchDirectory {
  /** Its absolute path. */
  readonly path: string
  /** Writes these bytes at `name`, inside the directory, making the directories between; resolves to the absolute path written. */
  write(name: string, bytes: Uint8Array): string
  /** Removes the directory and all it holds; removing it twice is not an error. */
  remove(): void
}

/** Where a slice may make scratch directories. */
export interface ScratchDirectories {
  /**
   * A new directory whose name starts with `prefix`, under `root` (made first if
   * it is missing), or under the machine's own place for temporary files when
   * `root` is null.
   */
  make(root: string | null, prefix: string): ScratchDirectory
}

/** Why a host would not do it, in the words the owner reads. */
export type Refused = { readonly refusal: string }

/**
 * One place in the crew's own store: a directory every member of one crew reads, holding whole files a slice keeps
 * and reads back (martha#254 R1, #255).
 *
 * A slice names a place and a file in it, never a path on the machine, so where a handover or a park marker lives is
 * the host's to decide and the host's to check. The adapter refuses a place that is not a directory of this user's that
 * nobody else may write into, and refuses a name that would leave the place it was asked for.
 */
export interface CrewPlace {
  /** Its absolute path, as the host resolved it: the name a record of a file in it carries. */
  readonly path: string
  /** Keeps `text` whole as `name` — under a staging name, mode 0600, then renamed into place — or says why it could not. */
  keep(name: string, text: string): Refused | undefined
  /** The text of `name`; undefined when this place holds no file of that name; or why it may not be read. */
  read(name: string): { readonly text: string } | undefined | Refused
  /** Every name in this place, in no particular order, or why it cannot be listed. A half-written file is not one. */
  names(): readonly string[] | Refused
}

/**
 * The crew's own store, outside the checkout, one directory per place (martha#254 R1, #255).
 *
 * It is the place martha#254 R1 keys by a repository's git common directory, so every member of one crew reads one
 * history however many checkouts it works in; the launcher resolves it and composes this store over it. A slice reaches
 * it here and never by a path of its own, so what a member hands to its successor and what a park marker says are
 * written by the host, in a directory the host checked (martha#255; the writer is host glue, and
 * prove_the_core/only_the_launcher_writes_launch_records keeps a slice from importing it).
 */
export interface CrewStore {
  /** The one place this crew keeps `name` in, made 0700 when missing; or why it may not be used. */
  place(name: string): CrewPlace | Refused
}

export interface Stores {
  readonly rows: RowStore
  readonly documents: DocumentStore
  readonly launches: KeyedRows
  readonly files: FileTree
  readonly scratch: ScratchDirectories
  readonly crew: CrewStore
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

/**
 * How a process's environment differs from the one the host itself runs with:
 * every variable whose name starts with one of `drop_prefixes` is left out, then
 * `set` is added on top. A slice never reads the host's environment; it says
 * only what to change.
 */
export interface EnvironmentChange {
  readonly drop_prefixes: readonly string[]
  readonly set: Readonly<Record<string, string>>
}

/** A process to run now, and how its environment differs from the host's. */
export interface ProcessRequestNow extends ProcessRequest {
  readonly environment?: EnvironmentChange
  /**
   * The text handed to the process on its standard input, which ends after it. Left out, the process reads an input
   * that is empty, as one with no standard input written to it does.
   */
  readonly input?: string
}

export interface Processes {
  run(request: ProcessRequest): Promise<ProcessOutcome>
  /**
   * Runs a process and waits for it, with its output as UTF-8 text. A command
   * that cannot be started ends with `exit_code` null. Synchronous for the
   * reason FileTree gives.
   */
  runNow(request: ProcessRequestNow): ProcessOutcome
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
  | 'owner_typed'
  | 'server_instructions'
  | 'checkout_run'
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
      /**
       * Why the host holds none, when it knows (martha#247): a ring's result says
       * which branch carried no id. Said in the gate's refusal; never a party to
       * the decision, and dropped whenever an identity is carried.
       */
      readonly why?: string
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

/**
 * How this host names a tool its model calls. A host composes an MCP tool's
 * name from the server it was installed under and the tool's own name, each
 * host its own way (Claude Code `mcp__<server>__<tool>`, OpenCode
 * `<server>_<tool>`, where `_` also occurs inside both names). Only the host
 * knows its form and its installed servers, so the core never takes a called
 * name apart itself (martha#2, item 5 (b)).
 */
export interface ToolNames {
  /** The name a called tool's own server gave it; a tool built into the host is its own name. */
  ownNameOf(called: string): string
}

export interface Tools extends ToolNames {
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

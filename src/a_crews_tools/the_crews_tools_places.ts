// What the crew's tools are given (martha#254): the places one launch hands crewToolsOver. It lives apart from the
// tools' wiring in a_crews_tools.ts only to keep that file under the size cap (martha#999 package 2b); a_crews_tools.ts
// re-exports it, so every reader still imports it from there.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { MessageCarrier } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import type { DocumentStore, HandoverStampStore, HostContract, HostFileTools, Refused, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import type { OwnersDefaultPlace } from '../put_the_owners_model_back/put_the_owners_model_back.ts'
import type { TheOwnersMenus } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import type { ASpawnedAgent } from '../run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { StoppingHost } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import type { TheWindowPlaces } from '../keep_a_members_crew_tools_window/heed_the_crew_tools.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import type { ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import type { AUsageHost } from '../keep_what_a_session_spent/keep_what_a_session_spent.ts'

/**
 * What the tools are given: whose row it is, where the crew's place is, and how the declaration is read; and what the
 * host adapter reads of its sessions' crew tools (martha#658), so a launch given none keeps no window.
 */
export interface CrewToolPlaces extends Pick<TheWindowPlaces, 'served_tools'> {
  readonly member: string
  /** The crew's streams: the ledger and the session records. */
  readonly ledger: LedgerHost
  /** The crew's dashboard rows: one per member, kept by the host (../dashboard_rows_directory/dashboard_rows_directory). */
  readonly beats: DashboardStore
  /** The checkout the crew is declared in. */
  readonly root: string
  readonly documents: DocumentStore
  /** The crew's own store: the park marker this member keeps, and the handovers a wake reads (../park_and_wake_a_member). */
  readonly stores: TheCrewFilesStores
  /**
   * The host's own processes: the tools that read a range, land a batch or move a worktree run git and gh through
   * these, so nothing that acts runs inside the member's session (martha#256). A place that holds none refuses
   * those five by name rather than pretending to act.
   */
  readonly processes?: HostContract['processes']
  /**
   * The sink a line about an act the tools carried on past is said through (martha#601): the launcher's writer to the
   * process's own error output. Absent, nothing is said.
   */
  readonly note?: ((line: string) => void) | undefined
  /**
   * Where a restart is asked of a member's launcher (martha#312): the crew's lifecycle requests, the launch records and
   * the ledger. A launch given none refuses `restart_a_member` by name.
   */
  readonly lifecycle?: StoppingHost
  /** The crew's declaration, whose workspace places the two worktree tools read (martha#256). */
  readonly settings?: CrewSettings
  /**
   * The models the host runs, as its adapter records them (martha#315): the declaration is read back against them, so a
   * crew whose `review_model` the host cannot spell is refused by name. A place given none names no model, and a
   * declaration naming one is then refused — nothing here invents a model list.
   */
  readonly models?: ModelVocabulary
  /** The host a session's usage is kept under (martha#999 package 5): an engine launch names its own; Claude Code when none. */
  readonly usage_host?: AUsageHost
  /** The model this member was launched on (martha#315): what its row says until a switch is confirmed. */
  readonly launched_on?: string
  /**
   * How this host spawns a subagent (martha#315): which tool, and which of its arguments say what the agent is and
   * which model runs it, as the adapter records it. A place given none holds no review to the crew's reviewer model.
   */
  readonly spawn?: ASpawnedAgent
  /**
   * The owner's own settings file, and where the one lock that guards it lives (martha#359): the file the host's model
   * command saves the switched model into as the owner's default. A launch given none refuses a switch by name, because
   * a switch that cannot be put back would leave the owner's every new session on the member's model.
   */
  readonly owners_settings?: OwnersDefaultPlace | Refused
  /**
   * What hands this member the crew's messages it has not taken in (martha#253). The mod asks for one each time it
   * starts and after each turn; a launch given none refuses the ask rather than answering an empty channel.
   */
  readonly carrier?: MessageCarrier
  /** Where the host keeps the stamps its handovers carry (martha#255). A launch given none writes no handover. */
  readonly stamps?: HandoverStampStore
  /** The sessions this launch took in, by id: what a handover is stamped with, and the predecessor a refresh inherits. */
  readonly sessions?: { readonly of: (session_id: string) => HostSession | undefined }
  /**
   * What this launcher keeps of the menus its host closed (martha#313): a settle of the owner's asks is refused unless a
   * menu closed in the session that took the batch. A launch given none settles no batch, and says so.
   */
  readonly menus?: TheOwnersMenus
  /** The share each session began at, by session id: kept here, so every threshold is measured from where it started. */
  readonly began_at?: Map<string, number>
  /**
   * The roots a reboot deletes on this machine (martha#314), for a crew whose declaration names none: derived by the
   * adapter that launches, from the OS, and handed in here rather than written into a slice. A place given none holds
   * no machine root, so the note then names only what the declaration names.
   */
  readonly volatile_roots?: readonly string[]
  /**
   * What the workspace guard refuses of a git call a member's shell is about to run (martha#562, seam a): the adapter
   * that asks git hands the refusal here, so the relay asks the crew once. A place given none refuses nothing, and a
   * crew that declared no workspace layout hands none.
   */
  readonly refusesTheGitCall?: (call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }) => Promise<string | undefined>
  /**
   * What the workspace guard refuses of a git call the launch's own `git` was handed (martha#562, seam b): the words a
   * member's shell gave the shim, and the directory it runs them in. A place given none refuses nothing, and a crew that
   * declared no workspace layout hands none.
   */
  readonly refusesTheGitOnThePath?: (call: { readonly directory: string; readonly args: readonly string[] }) => Promise<string | undefined>
  /**
   * What the workspace guard refuses of the refs a clone's transaction would update (martha#562, seam c): a delete of
   * another member's branch that reached git past the shell and past the shim. A place given none refuses nothing.
   */
  readonly refusesTheRefUpdate?: (updates: readonly { readonly ref: string; readonly deletes: boolean }[]) => string | undefined
  /**
   * What the killed-run record refuses of a hand-off (martha#719): a `say_to_crew` whose first line is a HANDOFF line,
   * while a leftover the record kept still stands where the record says it stands. A place given none refuses nothing,
   * and a crew that declared no workspace layout hands none.
   */
  readonly refusesTheHandOff?: (call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }) => Promise<string | undefined>
  /**
   * The host's own names for what writes a file and what runs a shell line (martha#999 package 2b): a call of either
   * that wrote one of the crew's briefs, breaking the owner-items rule, is answered with a note. A host whose member
   * cannot be handed a line after a tool hands none, and no call is noted.
   */
  readonly brief_writes?: { readonly file_tools: HostFileTools; readonly shell_tool: string }
}

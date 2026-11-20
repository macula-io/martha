// Martha's C4 model: the Context, the Container and the Component diagram, drawn from here.
//
// This exists so a reader sees, in three pictures, what Martha talks to, what it is
// made of, and what its code is made of, and so the pictures cannot drift from their
// source: the test beside this file fails when an SVG in assets/ is not what this file
// draws.
//
// Run:   node architecture/c4_diagrams.ts          (writes assets/c4-*.svg)
// Look:  rsvg-convert -w 1400 assets/c4-context.svg -o <a png of your choice>
//
// The diagrams draw the code that is in src/, not the design that is still to come:
// every slice named in the Component diagram is a directory in src/, and a box drawn
// for something not built says so. A box changes here with the package that changes it,
// and architecture/README.md's tables change beside it. The SVG in assets/ does not: it
// is DRAWN_AT_RELEASE (../src/check_the_pictures_change_with_the_version), so it catches
// up with this file's drawing once, in the version-bump change that rule names.
//
// Colours are literal values in plain classes with a prefers-color-scheme dark
// block, never CSS custom properties, which some renderers draw black.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CLAUDE_CODE } from '../src/know_claude_codes_own_facts/claude_code_facts.ts'

import {
  Diagram, drawnHeight, heightFor, roomUnderABottomLabel, wrapped,
  type Box, type BoxCoverage, type DrawnBound, type DrawnBox, type DrawnLegendEntry, type DrawnText,
} from './a_diagram_is_drawn/a_diagram_is_drawn.ts'

// The types the entry exported before the vocabulary moved out (martha#742) are re-exported here, so its surface is
// the same name for name and no importer of the drawings changes: the C4 test beside it takes these from the entry.
export type { Box, BoxCoverage, DrawnBound, DrawnBox, DrawnLegendEntry, DrawnText }

export function context(): Diagram {
  const d = new Diagram('c4-context.svg', 'Martha system context', 1000, 720)

  d.box({ kind: 'b-per', x: 30, y: 20, w: 250, h: 124, name: 'The owner', type: '[Person]', person: true,
    desc: ['Runs martha in their project', 'and reads what it asks; gives', 'the yes to every push'] })
  d.box({ kind: 'b-later', x: 375, y: 20, w: 250, h: 124, name: 'npm registry', type: '[External: not published yet]',
    desc: ['Will carry the signed package;', 'today Martha is installed from', 'a checkout (#2, #21)'] })
  d.box({ kind: 'b-later', x: 720, y: 20, w: 250, h: 124, name: 'Teammates', type: '[Person, team mode]', person: true,
    desc: ['More people on the crew, and', 'the roles the team names; not', 'built in this release'] })

  d.box({ kind: 'b-ext', x: 30, y: 210, w: 250, h: 140, name: 'Claude Code', type: '[External: coding tool]',
    desc: ['The session a member is: a', 'Claude Code process Martha', 'starts, with its own model and', 'its own tools'] })
  d.box({ kind: 'b-sys', x: 375, y: 210, w: 250, h: 140, name: 'Martha', type: '[In scope, one machine]',
    desc: ['A crew of coding agents: it', 'starts a member on config the', 'owner read and approved, and', 'refuses what was not approved'] })
  d.box({ kind: 'b-ext', x: 720, y: 210, w: 250, h: 140, name: 'A terminal', type: '[External system]',
    desc: ['Where the owner types, and', 'where a member runs: martha', 'start holds the terminal it', 'was run in'] })

  d.box({ kind: 'b-ext', x: 30, y: 430, w: 250, h: 140, name: 'git and GitHub', type: '[External systems]',
    desc: ['The project is a git checkout;', 'a member reaches GitHub with', 'its own gh and git, under the', 'shell gate'] })
  d.box({ kind: 'b-ext', x: 375, y: 430, w: 250, h: 140, name: 'Anthropic model API', type: '[External: the tool\'s own]',
    desc: ['The coding tool talks to it;', 'Martha never does, and never', 'sees a prompt the tool did not', 'hand it'] })
  d.box({ kind: 'b-mac', x: 720, y: 430, w: 250, h: 140, name: 'Macula mesh and realm', type: '[Macula]',
    desc: ['A mesh server runs only when your', 'project\'s config names one; the', 'room and admission are team mode,', 'and this release runs neither'] })

  d.edge('M155 144V180H420V210', { x: 300, y: 172, text: 'runs init, approve, start' })
  d.edge('M500 144V210', { x: 508, y: 180, text: 'once published' }, true)
  d.edge('M845 144V180H600V210', { x: 700, y: 172, text: 'their seats' }, true)
  d.edge('M375 280H280', { x: 327, y: 272, text: 'starts a member', middle: true })
  d.edge('M625 280H720', { x: 672, y: 272, text: 'start holds it', middle: true })
  d.edge('M280 300V380H155V430', { x: 160, y: 400, text: 'git, gh' })
  d.edge('M280 330H340V470H375', { x: 300, y: 470, text: 'its own model', middle: true })
  d.edge('M585 350V410H660V430', { x: 668, y: 420, text: 'the room, by invite' }, true)

  d.notes(30, 618, [
    'Solo mode, which is what this release is, needs the owner, a coding tool and a git checkout: no account and no service, and it admits no room message.',
    'The member Martha starts is a Claude Code session, so the trust the owner gives that folder and the sign-in it holds are the session\'s.',
    'Team mode adds teammates, and the room and admission drawn dashed here; a mesh server is installed and run only when a project\'s config names one.',
  ])
  d.legend(690, ['b-sys', 'b-per', 'b-mac', 'b-ext', 'b-later'], null)
  return d
}

/** The systems outside Martha that its containers reach, down the right of the container diagram. */
function systemsTheContainersReach(d: Diagram): void {
  d.box({ kind: 'b-ext', x: 800, y: 76, w: 296, h: 96, name: 'A terminal', type: '[External system]',
    desc: ['One per member: start holds it'] })
  d.box({ kind: 'b-ext', x: 800, y: 196, w: 296, h: 96, name: 'Claude Code', type: '[External: coding tool]',
    desc: ['The session a member is'] })
  d.box({ kind: 'b-ext', x: 800, y: 316, w: 296, h: 96, name: 'git and the checkout', type: '[External systems]',
    desc: ['The tree id, and the member\'s work'] })
  d.box({ kind: 'b-ext', x: 800, y: 436, w: 296, h: 96, name: 'The mesh server', type: '[External: a published package]',
    desc: ['Installed from its recorded tree'] })
}

/** Which container reaches which, and which system, in the container diagram. */
function containerEdges(d: Diagram): void {
  d.edge('M166 226V246', { x: 174, y: 242, text: 'node id, approvals' })
  d.edge('M300 136H332', { x: 316, y: 128, text: 'init writes it', middle: true })
  d.edge('M300 200H320V286H332', { x: 326, y: 240, text: 'approve', middle: true, rotate: 90 })
  d.edge('M300 214H308V446H332', { x: 314, y: 380, text: 'start', middle: true, rotate: 90 })
  // The corridor between the boundary and the systems is 184 wide, so each vertical is 11 clear of its
  // label and each label sits in a gap between the horizontal segments: rotated text is read as it lies.
  d.edge('M166 76V48H660V172H800', { x: 640, y: 110, text: 'a member\'s terminal', middle: true, rotate: 90 })
  d.edge('M600 286H700V364H800', { x: 686, y: 330, text: 'the tree id', middle: true, rotate: 90 })
  d.edge('M600 446H660V292H800', { x: 646, y: 400, text: 'runs the host', middle: true, rotate: 90 })
  d.edge('M800 250H730V606H600', { x: 716, y: 540, text: 'loads the relay', middle: true, rotate: 90 })
  d.edge('M600 490H800', { x: 660, y: 483, text: 'installs it', middle: true })
}

/** Level 2: what Martha is made of, and which container reaches which system. */
const PACKAGE_LABEL = 'Martha [the package, on the owner\'s machine]'

/**
 * The boxes the package boundary holds, left to right. The boundary is drawn from this list, so a box
 * that grows carries the boundary's bottom label with it (martha#283).
 */
export const PACKAGE_BOXES: readonly Box[] = [
  { kind: 'b-cmp', x: 32, y: 76, w: 268, h: 150, name: 'the martha command', type: '[bin/martha, a Node process]', code: true,
    desc: ['init, approve, start <member>,', '--version. Reads the declaration and', 'the approval, then starts one member', 'and holds its terminal'] },
  { kind: 'b-dat', x: 32, y: 246, w: 268, h: 120, name: 'Martha\'s state', type: '[~/.local/state/martha]',
    desc: ['Per project, outside the checkout:', 'each member\'s node id, the approvals', 'given, launch records and snapshots'] },
  { kind: 'b-later', x: 32, y: 546, w: 268, h: 132, name: 'the team mode', type: '[planned]',
    desc: ['Realm admission and the shared room,', 'not built here; solo admits nothing.', 'The parts every launch loads are', 'drawn below'] },

  { kind: 'b-dat', x: 332, y: 76, w: 268, h: 120, name: 'the crew declaration', type: '[.martha/martha.json]',
    desc: ['Who is on the crew, and the mode\'s', 'table of who may do what; written', 'once by init, never written over'] },
  { kind: 'b-cmp', x: 332, y: 216, w: 268, h: 140, name: 'the approval', type: '[approve_a_checkouts_config]', code: true,
    desc: ['Shows every file that would start code', 'and the checkout\'s tree, then takes one', 'word: yes. Its fingerprint covers the', 'files and the tree'] },
  { kind: 'b-cmp', x: 332, y: 376, w: 268, h: 140, name: 'the launcher', type: '[launch_a_claude_code_member]', code: true,
    desc: ['Snapshots approved config, writes a', 'launch record before the host starts,', 'and runs the host with the arguments', 'the crew\'s member may pass'] },
  { kind: 'b-cmp', x: 332, y: 546, w: 268, h: 120, name: 'the relay', type: '[claude_code_relay, a plugin]', code: true,
    desc: ['Loads in the member\'s session and', 'gates its turns: what it may run, and', 'whose text it took in'] },
]

/**
 * The boxes are a parameter so the test can draw this page with one box given a taller h than its text
 * needs, and hold the boundary's bottom to the room its label needs (martha#296). Every page the
 * generator draws passes none, and gets PACKAGE_BOXES.
 */
export function containers(boxes: readonly Box[] = PACKAGE_BOXES): Diagram {
  const d = new Diagram('c4-container.svg', 'Martha containers', 1120, 780)

  // The boundary's bottom is the lowest box it holds, drawn at the height box() draws it, plus the room
  // its own label needs: derived, so the label cannot be left standing on a box that grew. It measures
  // with drawnHeight, the function box() draws with, so a box made taller by its hand-given h counts too.
  const packageBoundary = { x: 16, y: 40, w: 600 } as const
  const lowestBox = boxes.reduce((bottom, b) => Math.max(bottom, b.y + drawnHeight(b)), 0)
  d.bound(packageBoundary.x, packageBoundary.y, packageBoundary.w,
    lowestBox + roomUnderABottomLabel() - packageBoundary.y, PACKAGE_LABEL, true)
  for (const b of boxes) d.box(b)

  systemsTheContainersReach(d)
  containerEdges(d)

  d.notes(24, 728, [
    'The launch gate is not a box of its own here: it is the check inside start, drawn as a component one level down. Martha reaches',
    'no service: state is files under the owner\'s own home, and what is outside is the coding tool, a terminal, git, and a mesh server only',
    'when the project\'s config names one.',
  ])
  return d
}

/**
 * The slices of the room a launch loads, though no room runs: solo admits nothing and serves no
 * room, and still loads these parts of it — the node id, the mesh server's tool list, and the gates
 * that refuse raw mesh reads and reach-widening tools. The page says so in words, and the test
 * beside this file imports the command and holds the page to what it actually loads.
 */
export const ROOM_SLICES_WHICH_LOAD: readonly string[] = [
  'admit_a_room_message',
  'read_a_room_through_its_gate',
  'refuse_widening_a_member_reach',
  'trust_only_framed_envelopes',
]

/**
 * The directories in src/ the Component diagram does not draw, and why each is left out.
 * The test beside this file fails when a directory is in neither a box's `names` nor here,
 * so a slice cannot arrive in src/ and stay off the picture by accident.
 */
export const LEFT_OUT: readonly { readonly name: string; readonly why: string }[] = [
  {
    name: 'check_the_workspace_layout',
    why: 'the entry npm run check:workspace-layout and the CI job run, over the scan check_the_workspace_matches_its_layout holds; a host adapter may import no program, so the launch runs that slice and never this entry',
  },
  {
    name: 'probe_launch_hosts',
    why: 'a script run by hand, npm run probe:launch, to probe a host; the command never loads it',
  },
  {
    name: 'land_a_package_on_a_throwaway_repository',
    why: "the live run's guards for its throwaway repository (martha#639); the command never loads them",
  },
  {
    name: 'declare_a_launch_probe',
    why: 'what one row of npm run probe:launch is, shared by its rows and its runner; the command never loads it',
  },
  {
    name: 'probe_a_checkouts_own_config',
    why: "npm run probe:launch's rows about a checkout's own config; the command never loads them",
  },
  {
    name: 'probe_the_owners_hooks',
    why: "npm run probe:launch's rows about the owner's hooks; the command never loads them",
  },
  {
    name: 'probe_the_owners_own_folders',
    why: "npm run probe:launch's rows about the owner's own folders; the command never loads them",
  },
  {
    name: 'probe_the_hosts_auto_memory',
    why: "npm run probe:launch's rows about the host's auto-memory; the command never loads them",
  },
  {
    name: 'drive_the_recorded_host',
    why: 'the harness the recorded-host tests drive: a recorded host stood up with a script, and the waits its runs need; no member ever loads it',
  },
  {
    name: 'pin_what_a_read_carries',
    why: 'the recorded-host case that pins which instruction text a host attaches to a session, run by node --test and ci.yml\'s relay job; no member ever loads it',
  },
  {
    name: 'record_mesh_answers',
    why: 'a script run by hand, npm run record:mesh-answers, when a version of the mesh server is recorded; the gate reads the answers it wrote, and never runs it',
  },
  {
    name: 'record_claude_code_host',
    why: 'a script run by hand, npm run record:claude-code-host, when the host is upgraded; the adapter reads what it writes, and never runs it',
  },
  {
    name: 'compare_two_host_recordings',
    why: 'what two recordings of the host say once the minifier\'s names are taken out (martha#811); only record_claude_code_host loads it, to run --check',
  },
  {
    name: 'follow_what_host_code_calls',
    why: 'the definitions a recorded text of the host reaches in its bundle (martha#811); only record_claude_code_host loads it, to record and to --check',
  },
  {
    name: 'record_the_goose_engine',
    why: 'a script run by hand, npm run record:goose-engine, when the Goose engine moves to a new version (martha#541); the daily engine drift job runs its --check, and no member ever loads it',
  },
  {
    name: 'stand_in_for_an_openai_model',
    why: 'a model behind an OpenAI-compatible URL, answered from a script, for runs of the Goose engine with no model (martha#541); tests and npm run stand-in:openai-model load it, and no member ever does',
  },
  {
    name: 'stand_in_for_an_acp_agent',
    why: 'an ACP agent on stdio answered from a script, offering the recorded Goose engine\'s permission answers, for the tests of speak_acp_to_an_agent (martha#541); tests and npm run stand-in:acp-agent load it, and no member ever does',
  },
  {
    name: 'check_no_member_outlives_its_run',
    why: 'a script run by hand, npm run check:no-member-outlives-its-run, over this machine\'s /proc; find_a_member_a_run_left_behind is what it reads with, and martha ls shows the same lines without loading the program',
  },
  {
    name: 'check_no_member_works_without_its_crew_tools',
    why: "a script run by hand and as a CI job, npm run check:no-member-works-without-its-crew-tools, over this machine's Martha state; it reads the windows keep_a_members_crew_tools_window keeps, and no member ever loads it",
  },
]

/**
 * A box on a page laid out in rows: which column it takes, and everything else a box needs.
 * Where it sits on the page is not its business — inRows decides that.
 */
type LooseBox = Omit<Box, 'x' | 'y' | 'w' | 'h'> & { readonly col: number }

/**
 * Draws a page row by row: a row starts one gap below the tallest box of the row above it, and
 * each box is as tall as its own text needs. Returns the bottom of the last row.
 */
function inRows(
  d: Diagram,
  rows: readonly (readonly LooseBox[])[],
  columns: readonly number[],
  w: number,
  top: number,
  gap: number,
): number {
  let y = top
  for (const row of rows) {
    const heights = row.map((spec) => heightFor(spec, w))
    row.forEach((spec, i) => {
      const { col, ...box } = spec
      d.box({ ...box, x: columns[col]!, y, w, h: heights[i]! })
    })
    y += Math.max(...heights) + gap
  }
  return y - gap
}

/**
 * Every count the page writes out, in order from none: the range a box may state is this list's own,
 * never a number written beside it (martha#407). Past its end the count is the number itself, so no
 * word has to be invented.
 */
export const THE_COUNTS_IN_WORDS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
] as const

/** A count written out in words, for the one place a box's prose says how many things it holds. */
export function aCountInWords(count: number): string {
  return THE_COUNTS_IN_WORDS[count] ?? String(count)
}

/** Where a box's description says how many things it holds, in place of writing the number itself. */
const THE_COUNT_ITS_LIST_DECIDES = '{count}'

/**
 * A box with the count it states drawn from the names it holds (martha#407), as the note drawn from
 * LEFT_OUT already does for its own count: a tool added to a box's names says the new number without
 * anyone remembering to edit the prose beside it.
 */
function withItsCountDrawn(b: LooseBox): LooseBox {
  if (!b.names || !b.desc.some((line) => line.includes(THE_COUNT_ITS_LIST_DECIDES))) return b
  const count = aCountInWords(b.names.length)
  return { ...b, desc: b.desc.map((line) => line.replaceAll(THE_COUNT_ITS_LIST_DECIDES, count)) }
}

/** The Component page's boxes, row by row and column by column: inRows places them. */
const COMPONENT_ROWS: readonly (readonly LooseBox[])[] = [
  [
    { col: 0, kind: 'b-sys', name: 'run_the_martha_command', names: ['run_the_martha_command', 'list_stop_and_restart_the_crew', 'release_a_held_member', 'show_the_owners_text_safely', 'find_a_member_a_run_left_behind', 'refuse_an_owner_act_from_inside_a_member', 'record_where_an_owners_act_was_typed', 'keep_where_owners_acts_were_typed', 'open_the_crew_in_kitty', 'open_the_crew_in_tmux'], type: '[the acts]', code: true,
      desc: ['init, approve, start <member>, run <shape>,', 'pin-key, keep-shapes, release <member>,', 'gate, --version: the words checked first,', 'a refusal on stderr with the command that', 'fixes it, 0 / 1 / 2. release_a_held_member', 'is the owner\'s release of a held member,', 'and list_stop_and_restart_the_crew is', 'martha ls, stop and restart\'s wiring here;', 'show_the_owners_text_safely writes every', 'terminal control out before the owner', 'reads it, and find_a_member_a_run_left_', 'behind names a member a run started and', 'left running, by its name and the time', 'it started; owner acts (#619):', 'refuse_an_owner_act_from_inside_a_', 'member, record_where_an_owners_act_', 'was_typed, keep_where_owners_acts_', 'were_typed; open_the_crew_in_kitty is', 'bare martha start: each member in a', 'kitty tab, its strip a split (#547 S6);', 'open_the_crew_in_tmux: martha up and', 'attach on Martha\'s own tmux (#932)'] },
    { col: 1, kind: 'b-cmp', name: 'declare_a_solo_crew, declare_crew', names: ['declare_a_solo_crew', 'bring_up_the_declared_crew', 'declare_crew', 'know_the_goose_engines_facts'], type: '[the declaration]', code: true,
      desc: ['Reads .martha/martha.json once into typed', 'settings; writes it only when none exists.', 'The mode\'s table says who may assign,', 'approve, resume, take asks and restart.', 'A member\'s host names a host Martha knows:', 'the engine\'s name is its own recording\'s,', 'engine_name, which know_the_goose_', 'engines_facts holds (martha#541);', 'bring_up_the_declared_crew is martha up:', 'every member declared and not parked (#511)'] },
    { col: 2, kind: 'b-cmp', name: 'approve_a_checkouts_config', names: ['approve_a_checkouts_config'], type: '[the owner\'s yes]', code: true,
      desc: ['Names every file that starts code and', 'the checkout\'s tree, asks on the owner\'s', 'own terminal, and keeps the fingerprint', 'it was given in approvals.jsonl'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'start_a_member', names: ['start_a_member', 'pass_only_switches_that_load_no_config', 'start_the_member_on_its_host'], type: '[one member]', code: true,
      desc: ['Refuses no terminal, a name the crew lacks', 'and a stale approval; -- words pass only', 'pass_only_switches_that_load_no_config', 'allows, then names the approval it starts', 'on and holds the terminal.', 'start_the_member_on_its_host is the table', 'a start picks its host\'s launcher from,', 'refusing a host this release cannot start'] },
    { col: 1, kind: 'b-cmp', name: 'launch_a_claude_code_member', names: ['launch_a_claude_code_member', 'run_an_owner_signed_command', 'raise_a_turn_to_the_member', 'hand_a_crew_message_to_its_member', 'answer_the_relay', 'ask_the_host_what_it_loads', 'end_a_launch', 'keep_the_relays_journal', 'place_the_hosts_settings', 'serve_the_relay_to_a_launch', 'start_the_member_on_the_owners_terminal', 'sweep_leftover_launch_directories', 'end_a_launch_when_its_run_ends', 'give_a_member_its_own_config', 'keep_the_backstop_of_a_launch', 'tell_the_owner_the_workspace_drift', 'tell_a_member_what_its_relaunch_killed', 'a_launch_end_on_this_machine', 'release_what_a_killed_run_left', 'watch_the_crew_tools_a_launch_served'], type: '[the launcher]', code: true,
      desc: ['The launch itself: Martha\'s places, the', 'approved snapshot and the launch record', 'written before the host starts.', 'place_the_hosts_settings settles what the', 'host reads, ask_the_host_what_it_loads', 'proves it loads the relay copy, and', 'serve_the_relay_to_a_launch makes the', 'socket and the copy; answer_the_relay', 'answers the relay\'s events on it,', 'keep_the_relays_journal keeps what the', 'launch did, and end_a_launch starts the', 'host in its own process group and cleans', 'up when it ends. start_the_member_on_', 'the_owners_terminal gives it the owner\'s', 'terminal, sweep_leftover_launch_', 'directories takes a dead launch\'s', 'directories away; raise_a_turn_to_the_', 'member raises each kept turn to its', 'listeners, hand_a_crew_message_to_its_', 'member hands one message at a time and', 'counts it taken in, and run_an_owner_', 'signed_command runs a shape the owner', 'signed on a verified copy, in a sandbox;', 'end_a_launch_when_its_run_ends gives', 'the launch its run\'s lifeline, so a run', 'that ends takes its member with it;', 'give_a_member_its_own_config makes the', 'member a config folder of its own, so', 'the owner\'s own hooks never load in it;', 'tell_a_member_what_its_relaunch_killed', 'holds what a killed run left, for the', 'member to read on its next start;', 'release_what_a_killed_run_left is the', 'act that releases a leftover the member', 'says is its own (#693 r=2);', 'a_launch_end_on_this_machine is what a', 'launch end reads of this machine (its', 'process group, its boot, and what a run', 'left), the readings linux_process_', 'identity no longer takes;', 'watch_the_crew_tools_a_launch_served', 'reads which crew tools each session', 'still holds, through the journal the', 'launch keeps (martha#658);', 'keep_the_backstop_of_a_launch stops', 'a member whose relay never reported', 'its start, at the deadline it was given,', 'tell_the_owner_the_workspace_drift', 'folds the workspace\'s drift onto the', 'member\'s row (martha#562)'] },
    { col: 2, kind: 'b-cmp', name: 'refuse_launch_of_unapproved_config', names: ['refuse_launch_of_unapproved_config', 'judge_a_checkouts_tree', 'refuse_code_a_checkout_runs_itself', 'remember_a_members_own_writes', 'run_marthas_own_git', 'empty_directory_of_a_launch', 'know_claude_codes_own_facts'], type: '[the launch gate]', code: true,
      desc: ['Fingerprints the config and the tree', 'id at start, and allows only what was', 'approved, plus remember_a_members_', 'own_writes; judge_a_checkouts_tree', 'reads and judges a checkout\'s tree;', 'refuse_code_a_checkout_', 'runs_itself closes a checkout\'s scripts;', 'run_marthas_own_git the settings each', 'of Martha\'s own git runs carries, and', 'empty_directory_of_a_launch the place', 'their hooks are pointed at;', 'know_claude_codes_own_facts the names', 'and switches Claude Code itself reads'] },
  ],
  [
    { col: 0, kind: 'b-dat', name: 'keep_martha_state_outside_the_checkout', names: ['keep_martha_state_outside_the_checkout', 'find_a_homes_state_root', 'row_streams_directory', 'dashboard_rows_directory', 'keep_what_the_owner_signed'], type: '[Martha\'s state]', code: true,
      desc: ['One directory per project, named by a', 'hash of its path: approvals, launches,', 'keep_what_the_owner_signed;', 'find_a_homes_state_root says where a', 'home\'s state root is and what it keeps;', 'row_streams_directory appends rows', 'as files; dashboard_rows_directory', 'writes the owner\'s row for a member as', 'one file, renamed into place whole'] },
    { col: 1, kind: 'b-cmp', name: 'host_contract, linux_process_identity', names: ['host_contract', 'linux_process_identity', 'read_a_kernel_and_a_home', 'read_one_file_held_by_its_descriptor', 'hold_a_session_to_its_served_tools'], type: '[the host contract, and this machine]', code: true,
      desc: ['What the core may ask of a coding tool:', 'a clock, stores, running a process,', 'delivery in and out; linux_process_identity', 'answers all of it for this machine, and', 'read_a_kernel_and_a_home adds a whole', 'process tree\'s readings and the launch', 'records a home\'s state root holds;', 'read_one_file_held_by_its_descriptor', 'reads a session\'s transcript by the', 'descriptor it opened, and hold_a_', 'session_to_its_served_tools folds the', 'host\'s tool deltas into whether the', 'session still holds its tools'] },
    { col: 2, kind: 'b-cmp', name: 'install_the_recorded_mesh_server', names: ['install_the_recorded_mesh_server', 'record_mesh_server_tools', 'record_ring_results', 'prove_the_mesh_server_bytes'], type: '[recorded trees]', code: true,
      desc: ['A tree by bytes, never by version:', 'record_mesh_server_tools records it,', 'record_ring_results rings one server', 'with another and keeps the keys,', 'prove_the_mesh_server_bytes compares it', 'again, and the launcher installs it'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'inbound_paths', names: ['inbound_paths', 'check_every_path_is_gated'], type: '[every path, and its control]', code: true,
      desc: ['Every way text reaches a session and', 'every way a checkout starts code, each', 'row naming the gate on it; check_every_', 'path_is_gated fails CI on a gap'] },
    { col: 1, kind: 'b-cmp', name: 'take_in_a_turn, shell_tools, answer_a_tool_call', names: ['take_in_a_turn', 'take_in_a_tool_result', 'shell_tools', 'answer_a_tool_call', 'refuse_calls_outside_the_package_contract', 'refuse_execution_after_ungated_text', 'read_a_ring_results_sender', 'trust_only_framed_envelopes', 'keep_the_shell_for_an_owner_signed_command', 'hash_a_file_under_a_tree', 'prove_a_mesh_answer_is_wordless', 'name_a_node_by_its_petname', 'session_records_in_rows', 'answer_what_a_host_reports', 'read_the_gate_mode', 'audit_the_gate_for_a_member', 'say_what_the_gate_does', 'apply_the_owners_release', 'vouch_for_the_agents_a_session_started'], type: '[the shell gate]', code: true,
      desc: ['A turn or a tool\'s result: take_in_a_turn,', 'take_in_a_tool_result, shell_tools,', 'answer_a_tool_call, read_a_ring_results_', 'sender, refuse_execution_after_ungated_', 'text, trust_only_framed_envelopes; keep_', 'the_shell_for_an_owner_signed_command;', 'hash_a_file_under_a_tree, what a file is;', 'prove_a_mesh_answer_is_wordless,', 'name_a_node_by_its_petname; session_', 'records_in_rows keeps a session\'s', 'records in the host\'s row streams, and', 'a record nobody can vouch for is lost.', 'vouch_for_the_agents_a_session_', 'started keeps what a launcher knows', 'of the agents a session started and', 'whether one may be vouched for;',
        'answer_what_a_host_reports is the one', 'entry every gate is answered from, that', 'names no host (martha#541); it holds', 'the sessions, their records and the', 'order every answer is given in, and the', 'reports of a host are moved onto it', 'one family at a time.', 'read_the_gate_mode says what the gate', 'does to each member (off, enforced or', 'audited); refuse_calls_outside_the_', 'package_contract holds a package\'s', 'contract against every call (martha#513);', 'audit_the_gate_for_a_member', 'keeps the refusal an audited member was', 'not given, and say_what_the_gate_does', 'prints it; apply_the_owners_release reads', 'a member the owner released'] },
    { col: 2, kind: 'b-cmp', name: 'name_the_source_of_a_prompt', names: ['name_the_source_of_a_prompt', 'attribute_a_cross_session_sender', 'carry_taint_across_a_refresh', 'hear_every_turn_the_model_runs', 'trust_only_signed_lists'], type: '[whose text it was]', code: true,
      desc: ['The origin a host attests, carried with', 'the turn: attribute_a_cross_session_sender,', 'carry_taint_across_a_refresh, and the shell', 'gate\'s reading; hear_every_turn_the_', 'model_runs hears every main turn the', 'model runs, whatever started it, and', 'records its source; trust_only_signed_', 'lists is how every list a gate trusts is', 'opened'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'admit_a_room_message', names: ['admit_a_room_message', 'read_a_room_through_its_gate', 'refuse_widening_a_member_reach'], type: '[loaded; the room is not built]', code: true,
      desc: ['Every launch loads these, though the room', 'they serve is not built: the node id a', 'member has; read_a_room_through_its_gate', 'gives the mesh server\'s tools, and refuse_', 'widening_a_member_reach refuses the rest'] },
    { col: 1, kind: 'b-cmp', name: 'claude_code_host, claude_code_relay', names: ['claude_code_host', 'claude_code_relay', 'cut_the_rules_from_the_host_binary', 'refuse_settings_that_turn_hooks_off', 'load_the_hosts_markdown', 'install_the_mesh_server_for_claude_code', 'hear_the_hosts_dialogs', 'refuse_a_member_writing_owner_memory', 'find_what_a_later_git_run_reads', 'read_what_claude_code_says_of_an_agent', 'read_what_claude_code_records_of_its_tools'], host: CLAUDE_CODE, type: '[the Claude Code host]', code: true,
      desc: ['The host contract on Claude Code: the', 'plugin, its hooks, the relay on a socket', 'and the member\'s tools; cut_the_rules_', 'from_the_host_binary holds the rules cut', 'out of the host, and refuse_settings_', 'that_turn_hooks_off the refusal of a', 'launch that reads one; load_the_hosts_', 'markdown is the markdown it loads and', 'the settings env reaching servers, and', 'install_the_mesh_server_for_claude_code', 'the server a launch hands the model;', 'hear_the_hosts_dialogs reads in the', 'crew\'s words the dialogs the host', 'raises; refuse_a_member_writing_', 'owner_memory keeps a member\'s writes', 'out of the owner\'s memory, and find_', 'what_a_later_git_run_reads reads what a', 'later git run would read; read_what_', 'claude_code_says_of_an_agent reads what', 'the host says of an agent that failed;', 'read_what_claude_code_records_of_its_', 'tools reads the tool deltas it records'] },
    { col: 2, kind: 'b-cmp', name: 'check_nothing_private_gets_in, check_every_link_resolves', names: ['check_nothing_private_gets_in', 'check_every_link_resolves', 'check_no_test_the_base_passed_goes_missing', 'check_posted_text_carries_nothing_private', 'check_no_literal_restates_a_value', 'check_every_recorded_host_test_is_run', 'check_marthas_names_are_its_own', 'check_no_import_cycle', 'check_the_pictures_change_with_the_version', 'check_every_check_runs_in_a_job'], type: '[this repository\'s own checks]', code: true,
      desc: ['A private issue link, an internal host', 'name or a private remote fails CI by', 'name; so does a home path in the text', 'members post on GitHub, which check_', 'posted_text_carries_nothing_private', 'reads daily. Every link to a file or a', 'heading of this repository resolves;', 'check_no_test_the_base_passed_goes_', 'missing names a dropped test, and', 'check_no_literal_restates_a_value', 'names a literal spelling out a value', 'an exported constant already holds;', 'check_every_recorded_host_test_is_run', 'names a recorded-host case no CI job runs;', 'check_marthas_names_are_its_own fails', 'a file, folder, tool, marker or', 'variable of Martha\'s that crew-code', 'names too, by name; check_the_pictures_', 'change_with_the_version lets a C4 picture', 'change only where the version does;', 'check_no_import_cycle names the whole', 'loop when files of the core load each', 'other; and check_every_check_runs_in_a_', 'job names a check no pull request runs'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'install_the_pinned_installer', names: ['install_the_pinned_installer', 'read_the_words_of_martha_install', 'hold_the_launch_to_the_version_floor'], type: '[the installer this release pins]', code: true,
      desc: ['martha install: reads the pin from the', 'running release, fetches exactly that', 'installer version through run_the_nodes_', 'own_npm_alone, refuses other bytes, and', 'runs it with the words unchanged;', 'read_the_words_of_martha_install says', 'which words it takes, and hold_the_', 'launch_to_the_version_floor refuses', 'every other act of a release below the', 'floor this machine holds (martha#21)'] },
    { col: 1, kind: 'b-cmp', name: 'run_the_nodes_own_npm_alone', names: ['run_the_nodes_own_npm_alone'], type: '[npm, and nothing of the machine\'s]', code: true,
      desc: ['The npm beside this node, run with', 'empty user and global config, one named', 'registry, --ignore-scripts and an', 'environment built from HOME and PATH', 'alone: the mesh server and the installer,', 'one isolation'] },
    { col: 2, kind: 'b-cmp', name: 'show_dashboard_beat, keep_the_ledger', names: ['show_dashboard_beat', 'report_where_the_work_stands', 'see_the_crew', 'draw_the_crew_strip', 'title_a_members_tab', 'tell_the_owner_a_session_waits', 'say_what_the_host_is_asking', 'ring_the_owner', 'see_who_is_free', 'find_the_unheld_work', 'nudge_an_idle_crew', 'keep_the_ledger', 'a_crews_tools', 'log_ledger', 'keep_the_crew_channel', 'send_a_crew_message', 'tell_a_citer_of_a_volatile_path', 'show_what_a_message_became', 'read_a_crew_line', 'hand_a_member_its_crew_text', 'tell_the_member_a_line', 'nudge_the_supervisor', 'watch_waits', 'spend_the_github_budget', 'wait_for_ci', 'recover_a_failed_act', 'hold_a_package_to_its_budget', 'keep_what_a_session_spent', 'keep_a_members_crew_tools_window'], type: '[the crew\'s rows and its ledger]', code: true,
      desc: ['show_dashboard_beat holds a member\'s row', 'and the rule the newest beat wins;', 'report_where_the_work_stands moves it,', 'see_the_crew lays every one out,', 'draw_the_crew_strip draws that in any', 'terminal (martha crew) and', 'title_a_members_tab makes a member\'s', 'tab title from its row (martha#572);', 'see_who_is_free says who can take a', 'package, tell_the_owner_a_session_waits', 'says what', 'the host is asking the owner;', 'say_what_the_host_is_asking decides which', 'of its events opens a dialog and which', 'closes it, ring_the_owner rings for it', 'once, and', 'a_crews_tools answers every tool the', 'crew registers.', 'keep_the_ledger loads log_ledger, whose', 'streams sit in the crew\'s own state;', 'keep_the_crew_channel is where a message', 'lives, send_a_crew_message writes one,', 'tell_a_citer_of_a_volatile_path says so', 'to the member whose text cites a path a', 'reboot deletes (martha#314), and', 'show_what_a_message_became reads back', 'what became of it; read_a_crew_line reads', 'the HANDOFF and VERDICT lines of a', 'message, and hand_a_member_its_crew_text', 'composes the crew text a member is', 'handed at every session\'s start;', 'tell_the_member_a_line puts one line', 'of Martha\'s own in the row the owner', 'reads and the member\'s own channel;', 'nudge_the_supervisor and watch_waits', 'find what has stalled from those rows', 'and lines, and the nudge asks GitHub', 'for each waiting package\'s pull-request', 'head and issue state (martha#320);', 'spend_the_github_budget spends the', 'crew\'s one GitHub allowance on those', 'reads, and wait_for_ci reads the CI on', 'a sha through it; find_the_unheld_work', 'lists the backlog work no member holds', 'and nudge_an_idle_crew names members', 'idle beside it (martha#319);', 'recover_a_failed_act names a failed', 'outward act, reads what is really', 'there and decides, one attempt at', 'most, then the Supervisor (martha#512);', 'hold_a_package_to_its_budget counts what', 'a package spends, in a stream of its', 'own beside the ledger, and tells a', 'member in a notice when a call runs', 'past it, the calls that end a package', 'aside (martha#513 slice 3, #601);', 'keep_what_a_session_spent keeps what', 'a session\'s host says it spent, as', 'readings in usage/ streams of their', 'own, and reads a window\'s spend from', 'them; a session that reported nothing', 'is named, never counted as 0', '(martha#860);', 'keep_a_members_crew_tools_window keeps', 'the time a member works without its', 'crew tools, tells the Supervisor once', 'and hands its successor what it owes', '(martha#658)'] },  ],
  [
    { col: 0, kind: 'b-cmp', name: 'check_a_range_before_the_owner_says_yes', names: ['check_a_range_before_the_owner_says_yes', 'land_passed_work_as_one_batch', 'find_the_work_a_verdict_passed', 'open_and_finish_a_worktree', 'read_the_origin_a_clone_has', 'hold_a_package_back_from_a_batch', 'forecast_what_a_batch_lands', 'find_where_a_merge_clashes', 'find_a_committed_conflict_marker'], type: '[the crew\'s tools that act]', code: true,
      desc: ['The {count} tools a member', 'calls (martha#256): the range', 'check reads a clone and the', 'CI on its tip; land_passed_', 'work_as_one_batch cuts the', 'batch, find_the_work_a_', 'verdict_passed says which head', 'a verdict passed, and fast_', 'forward_after_the_owners_yes', 'moves the default branch;', 'open_and_finish_a_worktree', 'opens and finishes one;', 'read_the_origin_a_clone_has', 'says what a clone is of;', 'hold_a_package_back_from_a_', 'batch stops a held package', '(martha#364); forecast_what_a_', 'batch_lands is its dry run,', 'and find_where_a_merge_', 'clashes names what a pull', 'request clashes with (#339);', 'find_a_committed_conflict_', 'marker names every marker line', 'a tip holds (martha#968)'] },
    { col: 1, kind: 'b-cmp', name: 'keep_the_owners_todo_list, queue_the_owners_asks', names: ['keep_the_owners_todo_list', 'queue_the_owners_asks', 'read_the_tips_a_removal_covers'], type: '[what waits on the owner]', code: true,
      desc: ['The owner\'s to-do list (martha#316):', 'the acts only the owner can do, each', 'command shown in full under what it', 'does. A member the table lets assign', 'work adds one; its own check or the', 'member takes it off. The pane and', 'martha todo show it. queue_the_owners_', 'asks is the ask queue (martha#313):', 'a routine ask waits instead of a menu,', 'and the session the table names hands', 'the whole batch over as one menu;', 'read_the_tips_a_removal_covers reads', 'both copies a branch deletion covers,', 'the clone\'s and origin\'s, which it', 'asks origin for with git ls-remote,', 'so one yes removes them both (martha#391)'] },
    { col: 2, kind: 'b-cmp', name: 'keep_the_supervisors_standing_items', names: ['keep_the_supervisors_standing_items'], type: '[what the Supervisor holds back]', code: true,
      desc: ['The Supervisor\'s standing items', '(martha#317): what it holds back, who', 'owes what, and the rulings it recorded', 'as the owner\'s words. A hold closes', 'only on evidence; a fresh Supervisor', 'session is handed them at its start,', 'and the pane shows them'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'write_my_handover, refresh_a_member', names: ['write_my_handover', 'refresh_a_member', 'end_a_running_turn', 'keep_the_package_contract'], type: '[the host writes a handover]', code: true,
      desc: ['A member\'s handover is written by the', 'host, at the path the host chose, and', 'stamped: one file per member per day', 'in the crew\'s own store, so a file the', 'member wrote itself is not a handover.', 'refresh_a_member is the flow around it:', 'when a refresh is due, the ask, the', 'send-back and the decline, the clear,', 'and the prompt the successor resumes on;', 'end_a_running_turn ends the turn a', 'handover waits behind (martha#311).', 'keep_the_package_contract keeps a', 'package\'s contract as a version of it', 'in the package\'s ledger and hands the', 'same version to a member at its start', 'and after a refresh (martha#513)'] },
    { col: 1, kind: 'b-cmp', name: 'park_and_wake_a_member', names: ['park_and_wake_a_member', 'wake_a_member', 'stop_and_restart_a_member'], type: '[a park that outlives a session]', code: true,
      desc: ['A member\'s park is a marker in the', 'crew\'s store, so a clear, a restart or a', 'refresh cannot lose it; who may park', 'another member is the declaration\'s', 'table, not a node id (martha#255 r=3).', 'wake_a_member is martha wake: the park', 'cleared and the member started on its', 'newest handover (part 2).', 'stop_and_restart_a_member is martha ls', 'and martha stop: a stop is a request the', 'launcher holding the member acts on', '(martha#312)'] },
    { col: 2, kind: 'b-cmp', name: 'keep_the_crews_files_as_directories', names: ['keep_the_crews_files_as_directories'], type: '[the crew\'s store, on this machine]', code: true,
      desc: ['The host contract\'s crew store as files', 'in one directory: a place per name, a', 'file kept whole under a staging name', 'and 0600, and nothing read that is not', 'this user\'s alone (martha#254, #255)'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'switch_a_members_model, put_the_owners_model_back', names: ['switch_a_members_model', 'put_the_owners_model_back', 'owners_settings_directory', 'run_reviews_on_the_review_model', 'name_a_review_the_host_reported_failed'], type: '[a model, the owner\'s, a review\'s]', code: true,
      desc: ['switch_a_members_model keeps the model a', 'member runs on for one package, in the', 'crew\'s own store, and the ways back;', 'put_the_owners_model_back undoes what a', 'switch does to the owner\'s own default:', 'the lock, the snapshot, the wait on the', 'file, the restore and the recovery a', 'killed launch leaves, over owners_', 'settings_directory, that file whole;', 'run_reviews_on_the_review_model refuses a', 'review spawn that names no reviewer model;', 'name_a_review_the_host_reported_failed', 'names a review the host reports failed,', 'from the report read_what_claude_code_s', 'ays_of_an_agent cuts', 'from the host\'s own text, on the model it', 'ran on and in the host\'s words', '(martha#390)'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'guard_workspace, read_the_git_calls_in_a_shell_line', names: ['guard_workspace', 'read_the_git_calls_in_a_shell_line', 'ask_git_what_a_member_is_about_to_change', 'check_the_workspace_matches_its_layout', 'refuse_a_git_call_in_a_members_shell', 'guard_the_git_a_member_runs', 'judge_the_commit_a_member_is_about_to_make', 'refuse_a_handoff_with_a_leftover'], type: '[the workspace guard]', code: true,
      desc: ['What the workspace\'s layout refuses of', 'a git call: read_the_git_calls_in_a_', 'shell_line reads each call and the', 'directory it runs in, ask_git_what_a_', 'member_is_about_to_change asks git what', 'a call is about to move, and guard_', 'workspace refuses a call that leaves a', 'clone\'s branch or touches another', 'member\'s worktree or branch; check_the_', 'workspace_matches_its_layout names the', 'drift in a workspace, and refuse_a_git_', 'call_in_a_members_shell and guard_the_', 'git_a_member_runs are the seams that ask', 'it: the shell line a tool call carries,', 'the git first on the member\'s PATH, and', 'the clone\'s ref transaction, each read', 'and judged before it runs; judge_the_', 'commit_a_member_is_about_to_make', 'judges a commit on the bytes it would', 'carry, the index and what a staging', 'line adds (#693 r=2), and refuse_a_', 'handoff_with_a_leftover refuses a', 'HANDOFF that would carry them while', 'they still stand (#719). A crew that', 'declared no layout is judged by none', 'of it (martha#562)'] },
    { col: 1, kind: 'b-cmp', name: 'speak_acp_to_an_agent, hear_an_acp_agents_asks', names: ['speak_acp_to_an_agent', 'hear_an_acp_agents_asks', 'serve_the_owners_answers', 'start_an_engine_member', 'launch_a_goose_member', 'derive_the_config_of_a_goose_launch', 'serve_the_crews_tools_to_an_engine', 'send_an_engine_member_its_turns'], type: '[an ACP agent, as its client]', code: true,
      desc: ['Martha as the client of an engine it', 'drives over ACP on stdio (martha#541):', 'sessions, prompts, each tool call\'s', 'updates and the turn\'s end; a call is', 'answered allow_once or reject_once', 'from the gate\'s decision, else', 'cancelled. hear_an_acp_agents_asks', 'holds a call the gate allows and the', 'owner\'s list does not name until', 'martha answer answers it, over the', 'socket serve_the_owners_answers', 'serves for a launch. start_an_engine_', 'member is the engine\'s start: launch_', 'a_goose_member writes its root (derive_', 'the_config_of_a_goose_launch) and', 'serve_the_crews_tools_to_an_engine', 'serves it the crew\'s tools;', 'send_an_engine_member_its_turns sends', 'its turns one at a time (#541 A);', 'start_an_engine_member answers the', 'owner\'s /crew at the tab and sends', 'the engine nothing (#927)'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'read_the_body_a_request_carries', names: ['read_the_body_a_request_carries'], type: '[a request to the launcher]', code: true,
      desc: ['The body a request to the', 'launcher\'s socket carries: read', 'whole, up to the largest the', 'launcher reads, as JSON, and no', 'body at all when it is larger', 'or not JSON. Every endpoint of', 'the socket reads one this way', '(martha#41)'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'keep_the_transcripts_of_a_launch, choose_the_transcripts_to_keep', names: ['keep_the_transcripts_of_a_launch', 'choose_the_transcripts_to_keep'], type: '[a session, after it ends]', code: true,
      desc: ['choose_the_transcripts_to_keep reads', 'no file and writes none: from what', 'the member\'s config folder holds', 'it takes the host\'s own transcripts', 'alone, redacts every token shape', 'and the key the launch handed it,', 'withholds whole a text a line break', 'split a token across, and replaces', 'a file the bounds leave no room for', 'with the line that says so;', 'keep_the_transcripts_of_a_launch is', 'the folder work the launch does', 'before it removes the snapshot at', 'every end: 0700 and 0600, written', 'whole and renamed, the mark of a', 'token found beside them, and the', 'launches past the newest 64 pruned', '(martha#646)'] },
  ],
]

/**
 * Level 3: what Martha's code is made of, one box per group of slices in src/.
 *
 * The page says which row and column a box is in, and inRows decides where it goes: every
 * box was placed by hand once, which is how two of them came to sit on each other and others
 * to print their text off the bottom (martha#283). A row starts below the tallest box of the
 * row above it, so no box can land on another, and the boundary, the notes, the legend and
 * the canvas all follow the last row rather than being counted by hand.
 */
export function components(): Diagram {
  const d = new Diagram('c4-components.svg', 'Martha components', 1000, 240)
  const COLUMNS = [32, 348, 664] as const
  const WIDE = 300
  const GAP = 16
  const TOP = 70


  const lastRowBottom = inRows(d, COMPONENT_ROWS.map((row) => row.map(withItsCountDrawn)), COLUMNS, WIDE, TOP, GAP)
  const boundaryBottom = lastRowBottom + 24
  d.bound(16, 40, 968, boundaryBottom - 40, 'Martha [the code in src/, one directory per capability]')

  const notesAt = boundaryBottom + 40
  // The note is drawn from LEFT_OUT instead of beside it (martha#296): its count is the array's, and
  // each directory it leaves out is named with the reason that entry gives, so a directory added to the
  // array is said here without anyone remembering to edit this prose.
  const noteWidth = d.w - 48
  const count = LEFT_OUT.length
  const notes = wrapped(
    'Every box is a directory in src/: the name is the capability, and its test sits beside it. ' +
    `${count === 1 ? 'This directory is' : `These ${count} directories are`} drawn nowhere on purpose:`,
    noteWidth,
  )
  for (const entry of LEFT_OUT) notes.push(...wrapped(`${entry.name}: ${entry.why}.`, noteWidth))
  notes.push(...wrapped(
    'The crew ledger is drawn in the crew\'s own box because a lockup now loads it. record_mesh_server_tools ' +
    'is drawn because the launcher imports what it recorded; the room itself is not built, and solo admits ' +
    'nothing, though every launch loads the node id, the tool list and the gates its slices hold.',
    noteWidth,
  ))
  d.notes(24, notesAt, notes)
  const legendAt = notesAt + 18 * (notes.length - 1) + 40
  d.legend(legendAt, ['b-sys', 'b-cmp', 'b-dat'], 'Boundary')
  d.fitTo(legendAt + 30)
  return d
}


export const DIAGRAMS = [context, containers, components] as const

/** Where the pictures stand, relative to the repository. */
const PICTURES = 'assets'

export const ASSETS = join(import.meta.dirname, '..', PICTURES)

/**
 * The pictures this program draws, relative to the repository: what a landing redraws when two passed heads clash in
 * them (martha#381). Read from the diagrams themselves, so a picture renamed here needs nothing renamed elsewhere.
 */
export const THE_PICTURES_THE_C4_DRAWS: readonly string[] = DIAGRAMS.map((make) => join(PICTURES, make().file))

/** This program, relative to the repository: what a landing runs again over the tree it is merging. */
export const THE_C4_DIAGRAMS_PROGRAM = 'architecture/c4_diagrams.ts'

if (import.meta.main) {
  for (const make of DIAGRAMS) {
    const d = make()
    writeFileSync(join(ASSETS, d.file), d.svg())
  }
}

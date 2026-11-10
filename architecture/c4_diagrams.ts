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
// for something not built says so. When a box changes, change it here, redraw, and
// keep architecture/README.md's tables in step.
//
// Colours are literal values in plain classes with a prefers-color-scheme dark
// block, never CSS custom properties, which some renderers draw black.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SANS = '"Atkinson Hyperlegible", "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif'
const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'

type Kind = 'b-sys' | 'b-per' | 'b-mac' | 'b-ext' | 'b-cmp' | 'b-dat' | 'b-team' | 'b-later'

// Each kind: light fill, light stroke, dark fill, dark stroke, legend label.
const KINDS: Record<Kind, readonly [string, string, string, string, string]> = {
  'b-sys': ['#F5E9CC', '#A56F0A', '#3A2E13', '#E3AA3C', 'Martha'],
  'b-per': ['#E3EBF2', '#3B5B7A', '#1D2A36', '#8EB4D8', 'Person'],
  'b-mac': ['#E6E4EE', '#5E5A78', '#26243A', '#A9A4C8', 'Macula, room not shipped'],
  'b-ext': ['#ECEFED', '#8A9791', '#1C2421', '#7D8B85', 'External system'],
  'b-cmp': ['#FFFFFF', '#A56F0A', '#171F1C', '#E3AA3C', 'Container or component'],
  'b-dat': ['#FBF6EA', '#A56F0A', '#2A2414', '#E3AA3C', 'Data, in the project'],
  'b-team': ['#FFFFFF', '#5E5A78', '#171F1C', '#A9A4C8', 'Container, team mode only'],
  'b-later': ['#F3F4F3', '#8A9791', '#1C2421', '#7D8B85', 'Planned, not built'],
}

const KIND_NAMES = Object.keys(KINDS) as Kind[]

function kindRules(dark: boolean): string {
  return KIND_NAMES.map((k) => {
    const [lf, ls, df, ds] = KINDS[k]
    const width = k === 'b-sys' ? 2 : 1.25
    const dash = k === 'b-team' || k === 'b-mac' || k === 'b-later' ? ' stroke-dasharray: 5 4;' : ''
    return dark
      ? `.${k} { fill: ${df}; stroke: ${ds}; }`
      : `.${k} { fill: ${lf}; stroke: ${ls}; stroke-width: ${width};${dash} }`
  }).join('\n')
}

const STYLE = `<style>
.t-name { font-family: ${SANS}; font-size: 15px; font-weight: 700; }
.t-desc { font-family: ${SANS}; font-size: 12.5px; }
.t-rel { font-family: ${SANS}; font-size: 11.5px; paint-order: stroke; stroke-width: 4px; stroke-linejoin: round; }
.t-code { font-family: ${MONO}; font-size: 13px; font-weight: 600; }
.t-type { font-family: ${MONO}; font-size: 11.5px; }
.t-bound { font-family: ${MONO}; font-size: 12px; font-weight: 600; }
.t-leg { font-family: ${SANS}; font-size: 12px; }
.edge { fill: none; stroke-width: 1.25; }
.edge-team { fill: none; stroke-width: 1.25; stroke-dasharray: 5 4; }
.bg { fill: #FFFFFF; }
${kindRules(false)}
.bound { fill: none; stroke: #B3BDB8; stroke-width: 1; }
.head { fill: #3B5B7A; }
.t-name, .t-code { fill: #16201D; }
.t-type, .t-bound, .t-leg { fill: #66736E; }
.t-desc { fill: #34413C; }
.t-rel { fill: #66736E; stroke: #FFFFFF; }
.edge, .edge-team { stroke: #8A9791; }
.arrowhead { fill: #8A9791; }
@media (prefers-color-scheme: dark) {
.bg { fill: #171F1C; }
${kindRules(true)}
.bound { stroke: #4A5752; }
.head { fill: #8EB4D8; }
.t-name, .t-code { fill: #E6ECE9; }
.t-type, .t-bound, .t-leg { fill: #93A09A; }
.t-desc { fill: #C3CDC8; }
.t-rel { fill: #93A09A; stroke: #171F1C; }
.edge, .edge-team { stroke: #7D8B85; }
.arrowhead { fill: #7D8B85; }
}
</style>`

const DEFS =
  '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ' +
  'orient="auto-start-reverse"><path class="arrowhead" d="M0 0L10 5L0 10z"/></marker></defs>'

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface Box {
  readonly kind: Kind
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly name: string
  readonly type: string
  readonly desc: readonly string[]
  /**
   * The directories in src/ this box stands for, each named in its title or its description.
   * A component box sets it, and the test beside this file holds every one of them to src/.
   */
  readonly names?: readonly string[]
  readonly person?: true
  readonly code?: true
}

/** What a box covering src/ directories stands for, as it was drawn. */
export interface BoxCoverage {
  readonly name: string
  readonly names: readonly string[]
  /** The title, the type and every description line, joined, so a name split over two lines is still found. */
  readonly text: string
}

/** One line when a name fits its box, else two, broken between names at a comma, or inside one at its underscore nearest the middle. */
function nameLines(name: string, code: boolean, width: number): string[] {
  const fits = Math.floor(width / (code ? 7.5 : 8.6))
  if (name.length <= fits) return [name]
  const cutsAt = (separators: RegExp): number[] =>
    [...name.matchAll(separators)]
      .map((found) => (found.index ?? 0) + found[0].length)
      .filter((at) => at <= fits && name.length - at <= fits)
  // A box that lists several directories breaks between them when it can, so no directory's name is cut
  // in two while there is room to start the next one on the second line.
  const betweenNames = cutsAt(/, /g)
  const cuts = betweenNames.length > 0 ? betweenNames : cutsAt(/_|, /g)
  if (cuts.length === 0) return [name]
  const middle = name.length / 2
  const at = cuts.reduce((best, cut) => (Math.abs(cut - middle) < Math.abs(best - middle) ? cut : best), cuts[0]!)
  return [name.slice(0, at).trimEnd(), name.slice(at).trimStart()]
}

interface Label {
  readonly x: number
  readonly y: number
  readonly text: string
  readonly middle?: true
  readonly rotate?: number
}

class Diagram {
  private readonly parts: string[] = []
  /** Every box that stands for directories in src/, as drawn, for the test that holds the picture to them. */
  readonly coverage: BoxCoverage[] = []
  readonly file: string
  readonly title: string
  readonly w: number
  readonly h: number
  constructor(file: string, title: string, w: number, h: number) {
    this.file = file
    this.title = title
    this.w = w
    this.h = h
  }

  text(cls: string, x: number, y: number, s: string, middle = false, rotate?: number): void {
    const anchor = middle ? ' text-anchor="middle"' : ''
    const turn = rotate === undefined ? '' : ` transform="rotate(${rotate} ${x} ${y})"`
    this.parts.push(`<text class="${cls}" x="${x}" y="${y}"${anchor}${turn}>${escape(s)}</text>`)
  }

  box(b: Box): void {
    this.parts.push(`<rect class="${b.kind}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/>`)
    const tx = b.person ? b.x + 44 : b.x + 16
    if (b.person) this.parts.push(`<circle class="head" cx="${b.x + 26}" cy="${b.y + 24}" r="9"/>`)
    if (b.names) this.coverage.push({ name: b.name, names: b.names, text: [b.name, b.type, ...b.desc].join('') })
    // A slice name longer than its box is broken at the underscore nearest its middle, so the name stays
    // readable as the directory it is: keep_martha_state_outside_ / the_checkout.
    const lines = nameLines(b.name, b.code === true, b.w - 32)
    const room = 18 * (lines.length - 1)
    lines.forEach((line, i) => this.text(b.code ? 't-code' : 't-name', tx, b.y + 28 + 18 * i, line))
    this.text('t-type', tx, b.y + 46 + room, b.type)
    b.desc.forEach((line, i) => this.text('t-desc', b.x + 16, b.y + 70 + room + 16 * i, line))
  }

  bound(x: number, y: number, w: number, h: number, label: string, atTheBottom = false): void {
    this.parts.push(`<rect class="bound" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`)
    // A label at the bottom sits inside the boundary's own left edge, never across its right one.
    if (atTheBottom) this.text('t-bound', x + 16, y + h - 12, label)
    else this.text('t-bound', x + 16, y + 22, label)
  }

  edge(d: string, label: Label, team = false): void {
    this.parts.push(`<path class="${team ? 'edge-team' : 'edge'}" d="${d}" marker-end="url(#a)"/>`)
    this.text('t-rel', label.x, label.y, label.text, label.middle ?? false, label.rotate)
  }

  notes(x: number, y: number, lines: readonly string[]): void {
    lines.forEach((line, i) => this.text('t-desc', x, y + 18 * i, line))
  }

  legend(y: number, kinds: readonly Kind[], boundary: string | null): void {
    let x = 24
    const entries: [string, string][] = kinds.map((k) => [k, KINDS[k][4]])
    if (boundary !== null) entries.push(['bound', boundary])
    for (const [cls, label] of entries) {
      this.parts.push(`<rect class="${cls}" x="${x}" y="${y}" width="22" height="14" rx="3"/>`)
      this.text('t-leg', x + 30, y + 12, label)
      x += 40 + 6.6 * label.length
    }
  }

  svg(): string {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" role="img" aria-label="${escape(this.title)}">`,
      `<title>${escape(this.title)}</title>`,
      STYLE,
      DEFS,
      `<rect class="bg" x="0" y="0" width="${this.w}" height="${this.h}"/>`,
      ...this.parts,
      '</svg>',
      '',
    ].join('\n')
  }
}

/** Level 1: who uses Martha, and every system and piece of Macula infrastructure it reaches. */
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
    desc: ['A mesh server runs only when your', 'project\'s config names one; the room', 'and admission are team mode, and this', 'release runs neither'] })

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
export function containers(): Diagram {
  const d = new Diagram('c4-container.svg', 'Martha containers', 1120, 780)

  d.bound(16, 40, 600, 660, 'Martha [the package, on the owner\'s machine]', true)

  d.box({ kind: 'b-cmp', x: 32, y: 76, w: 268, h: 150, name: 'the martha command', type: '[bin/martha, a Node process]', code: true,
    desc: ['init, approve, start <member>,', '--version. Reads the declaration and', 'the approval, then starts one member', 'and holds its terminal'] })
  d.box({ kind: 'b-dat', x: 32, y: 246, w: 268, h: 120, name: 'Martha\'s state', type: '[~/.local/state/martha]',
    desc: ['Per project, outside the checkout:', 'each member\'s node id, the approvals', 'given, launch records and snapshots'] })
  d.box({ kind: 'b-later', x: 32, y: 546, w: 268, h: 120, name: 'the team mode', type: '[planned]',
    desc: ['Realm admission and the shared room,', 'not built here; solo admits nothing. The', 'parts every launch loads are drawn below'] })

  d.box({ kind: 'b-dat', x: 332, y: 76, w: 268, h: 120, name: 'the crew declaration', type: '[.crew/crew.json]',
    desc: ['Who is on the crew, and the mode\'s', 'table of who may do what; written', 'once by init, never written over'] })
  d.box({ kind: 'b-cmp', x: 332, y: 216, w: 268, h: 140, name: 'the approval', type: '[approve_a_checkouts_config]', code: true,
    desc: ['Shows every file that would start code', 'and the checkout\'s tree, then takes one', 'word: yes. Its fingerprint covers the', 'files and the tree'] })
  d.box({ kind: 'b-cmp', x: 332, y: 376, w: 268, h: 140, name: 'the launcher', type: '[launch_a_claude_code_member]', code: true,
    desc: ['Snapshots approved config, writes a', 'launch record before the host starts,', 'and runs the host with the arguments', 'the crew\'s member may pass'] })
  d.box({ kind: 'b-cmp', x: 332, y: 546, w: 268, h: 120, name: 'the relay', type: '[claude_code_relay, a plugin]', code: true,
    desc: ['Loads in the member\'s session and', 'gates its turns: what it may run, and', 'whose text it took in'] })

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
    name: 'log_ledger',
    why: 'the crew ledger: a row per milestone and per outward act, and nothing this release runs loads it yet',
  },
  {
    name: 'probe_launch_hosts',
    why: 'a script run by hand, npm run probe:launch, to probe a host; the command never loads it',
  },
  {
    name: 'record_claude_code_host',
    why: 'a script run by hand, npm run record:claude-code-host, when the host is upgraded; the adapter reads what it writes, and never runs it',
  },
]

/** Level 3: what Martha's code is made of, one box per group of slices in src/. */
export function components(): Diagram {
  const d = new Diagram('c4-components.svg', 'Martha components', 1000, 1170)

  d.bound(16, 40, 968, 1000, 'Martha [the code in src/, one directory per capability]')

  d.box({ kind: 'b-sys', x: 32, y: 70, w: 300, h: 128, name: 'run_the_martha_command', names: ['run_the_martha_command'], type: '[the acts]', code: true,
    desc: ['init, approve, start <member>, run <shape>,', 'pin-key, keep-shapes, --version: the words', 'checked first, a refusal on stderr with', 'the command that fixes it, 0 / 1 / 2'] })
  d.box({ kind: 'b-cmp', x: 348, y: 70, w: 300, h: 128, name: 'declare_a_solo_crew, declare_crew', names: ['declare_a_solo_crew', 'declare_crew', 'who_may_act'], type: '[the declaration]', code: true,
    desc: ['Reads .crew/crew.json once into typed', 'settings; writes it only when none exists.', 'who_may_act holds the mode\'s table of', 'who may assign, approve and resume'] })
  d.box({ kind: 'b-cmp', x: 664, y: 70, w: 300, h: 128, name: 'approve_a_checkouts_config', names: ['approve_a_checkouts_config'], type: '[the owner\'s yes]', code: true,
    desc: ['Names every file that starts code and', 'the checkout\'s tree, asks on the owner\'s', 'own terminal, and keeps the fingerprint', 'it was given in approvals.jsonl'] })

  d.box({ kind: 'b-cmp', x: 32, y: 214, w: 300, h: 146, name: 'start_a_member', names: ['start_a_member', 'pass_only_switches_that_load_no_config'], type: '[one member]', code: true,
    desc: ['Refuses no terminal, a name the crew lacks', 'and a stale approval; -- words pass only', 'pass_only_switches_that_load_no_config', 'allows, then names the approval it starts', 'on and holds the terminal'] })
  d.box({ kind: 'b-cmp', x: 348, y: 214, w: 300, h: 146, name: 'launch_a_claude_code_member', names: ['launch_a_claude_code_member', 'run_an_owner_signed_command'], type: '[the launcher]', code: true,
    desc: ['Martha\'s places, the approved snapshot,', 'a launch record before the host starts;', 'run_an_owner_signed_command runs a', 'shape the owner signed on a verified', 'copy, in a sandbox'] })
  d.box({ kind: 'b-cmp', x: 664, y: 214, w: 300, h: 146, name: 'refuse_launch_of_unapproved_config', names: ['refuse_launch_of_unapproved_config', 'refuse_code_a_checkout_runs_itself', 'remember_a_members_own_writes', 'run_marthas_own_git'], type: '[the launch gate]', code: true,
    desc: ['Fingerprints the config and the tree', 'id at start, and allows only what was', 'approved, plus remember_a_members_', 'own_writes; refuse_code_a_checkout_', 'runs_itself closes a checkout\'s scripts;', 'run_marthas_own_git the settings each', 'of Martha\'s own git runs carries'] })

  d.box({ kind: 'b-dat', x: 32, y: 376, w: 300, h: 150, name: 'keep_martha_state_outside_the_checkout', names: ['keep_martha_state_outside_the_checkout', 'row_streams_directory', 'keep_what_the_owner_signed'], type: '[Martha\'s state]', code: true,
    desc: ['One directory per project, named by a', 'hash of its path: approvals, launches,', 'keep_what_the_owner_signed; row_streams_', 'directory appends rows as files'] })
  d.box({ kind: 'b-cmp', x: 348, y: 376, w: 300, h: 150, name: 'host_contract, linux_process_identity', names: ['host_contract', 'linux_process_identity'], type: '[the host contract, and this machine]', code: true,
    desc: ['What the core may ask of a coding tool:', 'a clock, stores, running a process,', 'delivery in and out; linux_process_identity', 'answers all of it for this machine'] })
  d.box({ kind: 'b-cmp', x: 664, y: 376, w: 300, h: 150, name: 'install_the_recorded_mesh_server', names: ['install_the_recorded_mesh_server', 'record_mesh_server_tools', 'prove_the_mesh_server_bytes'], type: '[recorded trees]', code: true,
    desc: ['A tree by bytes, never by version:', 'record_mesh_server_tools records it,', 'prove_the_mesh_server_bytes compares it', 'again, and the launcher installs it'] })

  d.box({ kind: 'b-cmp', x: 32, y: 542, w: 300, h: 170, name: 'inbound_paths', names: ['inbound_paths', 'check_every_path_is_gated'], type: '[every path, and its control]', code: true,
    desc: ['Every way text reaches a session and', 'every way a checkout starts code, each', 'row naming the gate on it; check_every_', 'path_is_gated fails CI on a gap'] })
  d.box({ kind: 'b-cmp', x: 348, y: 542, w: 300, h: 170, name: 'take_in_a_turn, shell_tools, answer_a_tool_call', names: ['take_in_a_turn', 'take_in_a_tool_result', 'shell_tools', 'answer_a_tool_call', 'refuse_execution_after_ungated_text', 'trust_only_framed_envelopes', 'keep_the_shell_for_an_owner_signed_command', 'hash_a_file_under_a_tree'], type: '[the shell gate]', code: true,
    desc: ['A turn or a tool\'s result: take_in_a_turn,', 'take_in_a_tool_result, shell_tools,', 'answer_a_tool_call, refuse_execution_', 'after_ungated_text, trust_only_framed_', 'envelopes; a signed run keeps the shell:', 'keep_the_shell_for_an_owner_signed_command;', 'hash_a_file_under_a_tree, what a file is'] })
  d.box({ kind: 'b-cmp', x: 664, y: 542, w: 300, h: 170, name: 'name_the_source_of_a_prompt', names: ['name_the_source_of_a_prompt', 'attribute_a_cross_session_sender', 'carry_taint_across_a_refresh', 'trust_only_signed_lists'], type: '[whose text it was]', code: true,
    desc: ['The origin a host attests, carried with', 'the turn: attribute_a_cross_session_sender,', 'carry_taint_across_a_refresh, and the shell', 'gate\'s reading; trust_only_signed_lists is', 'how every list a gate trusts is opened'] })

  d.box({ kind: 'b-cmp', x: 32, y: 890, w: 300, h: 140, name: 'install_the_pinned_installer', names: ['install_the_pinned_installer'], type: '[the installer this release pins]', code: true,
    desc: ['martha install: reads the pin from the', 'running release, fetches exactly that', 'installer version through run_the_nodes_', 'own_npm_alone, refuses other bytes, and', 'runs it with the words unchanged'] })
  d.box({ kind: 'b-cmp', x: 348, y: 890, w: 300, h: 140, name: 'run_the_nodes_own_npm_alone', names: ['run_the_nodes_own_npm_alone'], type: '[npm, and nothing of the machine\'s]', code: true,
    desc: ['The npm beside this node, run with', 'empty user and global config, one named', 'registry, --ignore-scripts and an', 'environment built from HOME and PATH', 'alone: the mesh server and the installer,', 'one isolation'] })

  d.box({ kind: 'b-cmp', x: 32, y: 724, w: 300, h: 150, name: 'admit_a_room_message', names: ['admit_a_room_message', 'read_a_room_through_its_gate', 'refuse_widening_a_member_reach'], type: '[loaded; the room is not built]', code: true,
    desc: ['Every launch loads these, though the room', 'they serve is not built: the node id a', 'member has; read_a_room_through_its_gate', 'gives the mesh server\'s tools, and refuse_', 'widening_a_member_reach refuses the rest'] })
  d.box({ kind: 'b-cmp', x: 348, y: 724, w: 300, h: 150, name: 'claude_code_host, claude_code_relay', names: ['claude_code_host', 'claude_code_relay', 'refuse_a_member_writing_owner_memory'], type: '[the Claude Code host]', code: true,
    desc: ['The host contract on Claude Code: the', 'plugin, its hooks, the relay on a socket', 'and the member\'s tools; refuse_a_member_', 'writing_owner_memory keeps a member\'s', 'writes out of the owner\'s memory'] })
  d.box({ kind: 'b-cmp', x: 664, y: 724, w: 300, h: 150, name: 'check_nothing_private_gets_in, check_every_link_resolves', names: ['check_nothing_private_gets_in', 'check_every_link_resolves'], type: '[this repository\'s own checks]', code: true,
    desc: ['A private issue link, an internal host', 'name or a private remote fails CI by', 'name; a badge host that answers 408 is', 'asked again before its link is broken.', 'Each has a self-test that proves it bites'] })

  d.notes(24, 1058, [
    'Every box is a directory in src/: the name is the capability, and its test sits beside it. Three directories are drawn nowhere on purpose:',
    'log_ledger, the crew ledger, which nothing this release runs loads yet; and the two scripts run by hand when a host is recorded,',
    'probe_launch_hosts and record_claude_code_host. record_mesh_server_tools is drawn because the launcher imports what it recorded; the',
    'room itself is not built, and solo admits nothing, though every launch loads the node id, the tool list and the gates its slices hold.',
  ])
  d.legend(984, ['b-sys', 'b-cmp', 'b-dat'], 'Boundary')
  return d
}

export const DIAGRAMS = [context, containers, components] as const

export const ASSETS = join(import.meta.dirname, '..', 'assets')

if (import.meta.main) {
  for (const make of DIAGRAMS) {
    const d = make()
    writeFileSync(join(ASSETS, d.file), d.svg())
  }
}

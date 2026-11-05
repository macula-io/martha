// Martha's C4 model: the Context and the Container diagram, drawn from here.
//
// This exists so a reader sees, in two pictures, what Martha talks to and what it
// is made of, and so the pictures cannot drift from their source: the test beside
// this file fails when an SVG in assets/ is not what this file draws.
//
// Run:   node architecture/c4_diagrams.ts          (writes assets/c4-*.svg)
// Look:  rsvg-convert -w 1400 assets/c4-context.svg -o <a png of your choice>
//
// The diagrams draw the design in issue #1. When a box changes, change it here,
// redraw, and keep architecture/README.md's tables in step.
//
// Colours are literal values in plain classes with a prefers-color-scheme dark
// block, never CSS custom properties, which some renderers draw black.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SANS = '"Atkinson Hyperlegible", "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif'
const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'

type Kind = 'b-sys' | 'b-per' | 'b-mac' | 'b-ext' | 'b-cmp' | 'b-dat' | 'b-team'

// Each kind: light fill, light stroke, dark fill, dark stroke, legend label.
const KINDS: Record<Kind, readonly [string, string, string, string, string]> = {
  'b-sys': ['#F5E9CC', '#A56F0A', '#3A2E13', '#E3AA3C', 'Martha'],
  'b-per': ['#E3EBF2', '#3B5B7A', '#1D2A36', '#8EB4D8', 'Person'],
  'b-mac': ['#E6E4EE', '#5E5A78', '#26243A', '#A9A4C8', 'Macula, team mode only'],
  'b-ext': ['#ECEFED', '#8A9791', '#1C2421', '#7D8B85', 'External system'],
  'b-cmp': ['#FFFFFF', '#A56F0A', '#171F1C', '#E3AA3C', 'Container'],
  'b-dat': ['#FBF6EA', '#A56F0A', '#2A2414', '#E3AA3C', 'Data, in the project'],
  'b-team': ['#FFFFFF', '#5E5A78', '#171F1C', '#A9A4C8', 'Container, team mode only'],
}

const KIND_NAMES = Object.keys(KINDS) as Kind[]

function kindRules(dark: boolean): string {
  return KIND_NAMES.map((k) => {
    const [lf, ls, df, ds] = KINDS[k]
    const width = k === 'b-sys' ? 2 : 1.25
    const dash = k === 'b-team' || k === 'b-mac' ? ' stroke-dasharray: 5 4;' : ''
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
  readonly person?: true
  readonly code?: true
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
    this.text(b.code ? 't-code' : 't-name', tx, b.y + 28, b.name)
    this.text('t-type', tx, b.y + 46, b.type)
    b.desc.forEach((line, i) => this.text('t-desc', b.x + 16, b.y + 70 + 16 * i, line))
  }

  bound(x: number, y: number, w: number, h: number, label: string): void {
    this.parts.push(`<rect class="bound" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`)
    this.text('t-bound', x + 16, y + 22, label)
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

/** Level 1: who uses Martha, and every system outside it that it reaches. */
export function context(): Diagram {
  const d = new Diagram('c4-context.svg', 'Martha system context', 1000, 730)

  d.box({ kind: 'b-ext', x: 30, y: 20, w: 250, h: 124, name: 'npm registry', type: '[External system]',
    desc: ['The signed Martha package;', 'its signature is checked', 'before anything is installed'] })
  d.box({ kind: 'b-per', x: 375, y: 20, w: 250, h: 124, name: 'The owner', type: '[Person]', person: true,
    desc: ['Sets the work, answers the', 'menus; in solo mode gives', 'the yes every push needs'] })
  d.box({ kind: 'b-per', x: 720, y: 20, w: 250, h: 124, name: 'Teammates', type: '[Person, team mode]', person: true,
    desc: ['More people on the crew;', 'the ones the team names', 'give the yes to a push'] })

  d.box({ kind: 'b-ext', x: 30, y: 200, w: 250, h: 140, name: 'Claude Code', type: '[External: coding tool]',
    desc: ['Runs a member session and', 'talks to its own model;', 'Martha is a plugin in it'] })
  d.box({ kind: 'b-sys', x: 375, y: 200, w: 250, h: 140, name: 'Martha', type: '[In scope]',
    desc: ['A crew of coding agents:', 'it hands work desk by desk', 'from builder to reviewer,', 'and writes down every step'] })
  d.box({ kind: 'b-ext', x: 720, y: 200, w: 250, h: 140, name: 'OpenCode', type: '[External: coding tool]',
    desc: ['The same, on a second', 'coding tool: the same crew,', 'Martha is a plugin in it'] })

  d.box({ kind: 'b-ext', x: 30, y: 420, w: 250, h: 140, name: 'GitHub', type: '[External system]',
    desc: ['Issues, pull requests and', 'CI runs: work comes in as', 'an issue and leaves as a', 'reviewed pull request'] })
  d.box({ kind: 'b-mac', x: 375, y: 420, w: 250, h: 140, name: 'Macula mesh and realm', type: '[team mode only]',
    desc: ['Admits a crew by invite,', 'and carries the shared room', 'between people and', 'machines'] })
  d.box({ kind: 'b-ext', x: 720, y: 420, w: 250, h: 140, name: 'A terminal', type: '[External system]',
    desc: ['One tab per member, so', 'the owner sees each agent', 'at work'] })

  d.edge('M375 82H280', { x: 327, y: 74, text: 'installs', middle: true })
  d.edge('M500 144V200', { x: 412, y: 178, text: 'runs, approves' })
  d.edge('M845 144V172H585V200', { x: 715, y: 166, text: 'their seats', middle: true }, true)
  d.edge('M280 270H375', { x: 327, y: 262, text: 'loads', middle: true })
  d.edge('M720 270H625', { x: 672, y: 262, text: 'loads', middle: true })
  d.edge('M430 340V380H155V420', { x: 292, y: 374, text: 'gh and git', middle: true })
  d.edge('M500 340V420', { x: 508, y: 400, text: 'rooms, admission' }, true)
  d.edge('M570 340V380H845V420', { x: 708, y: 374, text: 'a tab per member', middle: true })

  d.notes(30, 610, [
    'Solo mode needs only the owner, a coding tool, GitHub and a terminal: no mesh, no account, no service. Team mode adds',
    'teammates and the Macula mesh, and changes nothing else: the mode is a table of who may do what, read from the crew\'s',
    'declaration, not a second program. Every push and every release still waits for a person\'s yes.',
  ])
  d.legend(690, ['b-sys', 'b-per', 'b-mac', 'b-ext'], null)
  return d
}

/** Level 2: what Martha is made of, and which container reaches which system. */
export function containers(): Diagram {
  const d = new Diagram('c4-container.svg', 'Martha containers', 1000, 900)

  d.bound(16, 40, 600, 650, 'Martha [one package, on the owner\'s machine]')

  d.box({ kind: 'b-dat', x: 32, y: 76, w: 268, h: 110, name: 'crew declaration', type: '[files in .crew/]',
    desc: ['Who is on the crew, the', 'mode\'s table of who may do', 'what, and the house rules'] })
  d.box({ kind: 'b-cmp', x: 332, y: 76, w: 268, h: 110, name: 'launcher', type: '[command line]', code: true,
    desc: ['Starts and stops members:', 'one coding-tool session and', 'one terminal tab each'] })

  d.box({ kind: 'b-cmp', x: 32, y: 210, w: 368, h: 270, name: 'crew core', type: '[no coding-tool API]', code: true,
    desc: [
      'The protocol, one folder per capability:',
      'declare_crew, host_contract, who_may_act,',
      'deliver_crew_room, show_dashboard_beat,',
      'log_ledger, park_and_wake, refresh_member,',
      'hand_over_at_limit, ask_owner, switch_model,',
      'the owner\'s small views, watch_waits,',
      'prove_landing, open_and_finish_worktree,',
      'guard_workspace, the publish gate;',
      'team mode adds read_shared_room and',
      'announce_node_events.',
      'Each folder holds its hooks, tools, timer,',
      'store keys, prompt text and test.',
    ] })

  d.box({ kind: 'b-cmp', x: 432, y: 210, w: 168, h: 125, name: 'Claude Code', type: '[adapter]', code: true,
    desc: ['The host contract', 'over the plugin', 'API; the pane'] })
  d.box({ kind: 'b-cmp', x: 432, y: 355, w: 168, h: 125, name: 'OpenCode', type: '[adapter]', code: true,
    desc: ['The host contract', 'over the plugin', 'API'] })

  d.box({ kind: 'b-team', x: 32, y: 534, w: 268, h: 110, name: 'realm admission', type: '[team mode only]', code: true,
    desc: ['Joins a crew by invite,', 'and refuses a seat that', 'holds no credential'] })
  d.box({ kind: 'b-cmp', x: 332, y: 534, w: 268, h: 110, name: 'release', type: '[pack, scan, sign]', code: true,
    desc: ['Packs what is committed,', 'refuses private text, and', 'signs it in CI'] })

  d.box({ kind: 'b-ext', x: 680, y: 76, w: 296, h: 96, name: 'A terminal', type: '[External system]',
    desc: ['One tab per member'] })
  d.box({ kind: 'b-ext', x: 680, y: 196, w: 296, h: 96, name: 'Claude Code', type: '[External: coding tool]',
    desc: ['Loads the adapter as a plugin'] })
  d.box({ kind: 'b-ext', x: 680, y: 316, w: 296, h: 96, name: 'OpenCode', type: '[External: coding tool]',
    desc: ['Loads the adapter as a plugin'] })
  d.box({ kind: 'b-ext', x: 680, y: 436, w: 296, h: 96, name: 'GitHub', type: '[External system]',
    desc: ['gh and git: issues, pull requests, CI'] })
  d.box({ kind: 'b-mac', x: 680, y: 556, w: 296, h: 96, name: 'Macula mesh and realm', type: '[team mode only]',
    desc: ['The invite, the shared room'] })
  d.box({ kind: 'b-ext', x: 680, y: 676, w: 296, h: 96, name: 'npm and ghcr.io', type: '[External system]',
    desc: ['The signed release, by digest'] })

  d.edge('M332 131H300', { x: 316, y: 123, text: 'reads', middle: true })
  d.edge('M600 110H680', { x: 640, y: 102, text: 'a tab', middle: true })
  d.edge('M600 160H650V230H680', { x: 640, y: 196, text: 'starts', middle: true, rotate: 90 })
  d.edge('M166 210V186', { x: 174, y: 202, text: 'settings, read once' })
  d.edge('M432 275H400', { x: 416, y: 267, text: 'host', middle: true })
  d.edge('M432 420H400', { x: 416, y: 412, text: 'host', middle: true })
  d.edge('M680 250H600', { x: 640, y: 242, text: 'loads', middle: true })
  d.edge('M680 380H600', { x: 640, y: 372, text: 'loads', middle: true })
  d.edge('M216 480V507H660V484H680', { x: 438, y: 502, text: 'gh and git, through the host', middle: true })
  d.edge('M166 644V674H660V604H680', { x: 438, y: 669, text: 'invite, room', middle: true }, true)
  d.edge('M600 589H640V724H680', { x: 632, y: 616, text: 'signed release', middle: true, rotate: 90 })

  d.notes(24, 806, [
    'One code path for both modes: the core reads the mode from the declaration and never branches on the coding tool. An adapter',
    'implements one small host contract (clock, stores, processes, delivery in and out, tool registration) and composes the slices.',
    'In solo mode no team-mode container or slice is loaded, and no mesh call is made.',
  ])
  d.legend(866, ['b-cmp', 'b-team', 'b-dat', 'b-mac', 'b-ext'], 'Boundary')
  return d
}

export const DIAGRAMS = [context, containers] as const

export const ASSETS = join(import.meta.dirname, '..', 'assets')

if (import.meta.main) {
  for (const make of DIAGRAMS) {
    const d = make()
    writeFileSync(join(ASSETS, d.file), d.svg())
  }
}

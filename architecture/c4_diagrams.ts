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

/**
 * How wide one character is, as a fraction of its font size. Measured from the fonts the
 * stack at the top of this file falls back to on a reader's machine, taking the widest of
 * them, so a text this file says fits does not cross its box on a renderer that picked a
 * wider family. A character not listed takes the widest class it could be: over-estimating
 * makes a box a little larger, under-estimating draws text outside it (martha#283).
 */
const ADVANCE = {
  space: 0.28,
  narrow: 0.305,
  underscore: 0.615,
  wide: 0.911,
  upper: 0.682,
  lower: 0.581,
  digit: 0.593,
} as const

const NARROW_CHARS = `iljtfr.,'!:;|()[]/"\\-`
const WIDE_CHARS = 'mwMW@%&'
/** A mono font gives every character the same advance, and the mono fallbacks agree to within a hundredth. */
const MONO_ADVANCE = 0.62
/** The size each class is drawn at, in the SVG's own units, as the style above sets it. */
const SIZE: Record<string, number> = {
  't-name': 15,
  't-desc': 12.5,
  't-rel': 11.5,
  't-code': 13,
  't-type': 11.5,
  't-bound': 12,
  't-leg': 12,
}

type Advance = keyof typeof ADVANCE

/** The class each character belongs to; a character in no list is read as an upper-case letter. */
const CHAR_CLASS = new Map<string, Advance>()
for (let c = 0x30; c <= 0x39; c++) CHAR_CLASS.set(String.fromCharCode(c), 'digit')
for (let c = 0x41; c <= 0x5a; c++) CHAR_CLASS.set(String.fromCharCode(c), 'upper')
for (let c = 0x61; c <= 0x7a; c++) CHAR_CLASS.set(String.fromCharCode(c), 'lower')
// The lists come last: several of their characters are letters, and the class that measures
// them is this one, not the letter's — a 't' and an 'm' are not a lowercase letter's width.
for (const ch of NARROW_CHARS) CHAR_CLASS.set(ch, 'narrow')
for (const ch of WIDE_CHARS) CHAR_CLASS.set(ch, 'wide')
CHAR_CLASS.set(' ', 'space')
CHAR_CLASS.set('_', 'underscore')

const emOf = (ch: string): number => ADVANCE[CHAR_CLASS.get(ch) ?? 'upper']

/** How wide a text is drawn, in the SVG's own units. */
function widthOf(cls: string, text: string): number {
  const size = SIZE[cls] ?? SIZE['t-desc']!
  const ems = cls === 't-code' || cls === 't-type'
    ? MONO_ADVANCE * [...text].length
    : [...text].reduce((sum, ch) => sum + emOf(ch), 0)
  return ems * size
}

/**
 * Breaks a note into lines no wider than the column it is drawn in, at its spaces, the way a printed
 * note wraps. A word wider than the column is left on a line of its own rather than cut in two.
 * Wrapping at a space keeps the note readable as the sentence it was written as, and keeps every line
 * inside the canvas.
 */
function wrapped(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`
    if (line === '' || widthOf('t-desc', next) <= width) {
      line = next
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

export interface Box {
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

/** A text as it was drawn: its baseline, and the width the estimate above gives it. */
export interface DrawnText {
  readonly x: number
  readonly y: number
  readonly text: string
  readonly width: number
}

/**
 * A box as it was drawn: its rectangle, and every text it put in it. The test beside this
 * file holds each of those texts inside the rectangle, so a box given more text than it
 * has room for is answered where it is written rather than by someone reading the page.
 */
export interface DrawnBox {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly texts: readonly DrawnText[]
}

/** One entry of a legend row as it was drawn: its swatch, and the label beside it. */
export interface DrawnLegendEntry {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly label: string
  readonly labelX: number
  readonly labelWidth: number
}

/**
 * A boundary as it was drawn: its rectangle, its label, and the band that label's ink takes. The test
 * beside this file holds every box off every label's band, the way it holds a legend off the boxes.
 */
export interface DrawnBound {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly label: string
  readonly atTheBottom: boolean
  /** The band the label is drawn in: its x to its x plus its width, above and below its baseline. */
  readonly labelBand: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

/** One line when a name fits its box, else two, broken between names at a comma, or inside one at its underscore nearest the middle. */
function nameLines(name: string, code: boolean, width: number): string[] {
  const cls = code ? 't-code' : 't-name'
  const fits = (line: string): boolean => widthOf(cls, line) <= width
  if (fits(name)) return [name]
  const cutsAt = (separators: RegExp): number[] =>
    [...name.matchAll(separators)]
      .map((found) => (found.index ?? 0) + found[0].length)
      .filter((at) => fits(name.slice(0, at).trimEnd()) && fits(name.slice(at).trimStart()))
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

/** The room a box keeps under its last description line: more than the six pixels the test asks for. */
const BELOW_THE_LAST_LINE = 14

/**
 * The band a label's line of type takes: a full em stands above its baseline and this share hangs below.
 * A box drawn into that band sits on the label's own line (martha#283). The em above over-estimates where
 * the ink ends, the same way ADVANCE over-estimates a character, so a label never has to be re-measured.
 */
const INK_ABOVE_THE_BASELINE = 1
const INK_BELOW_THE_BASELINE = 0.25

/** Where a boundary's bottom label puts its baseline: this far above the boundary's own bottom edge. */
const LABEL_ABOVE_THE_EDGE = 12

/**
 * The clear ground a boundary's bottom label keeps under the lowest box it holds: more than the six
 * pixels the test asks for, because the band above is an estimate of where the ink ends.
 */
const UNDER_A_LABEL = 8

/**
 * The height a box needs to hold its own text, from the baselines box() draws on. A box is
 * drawn at least this tall, so a description line added to a box can never print outside it
 * (martha#283).
 */
function heightFor(b: { readonly name: string; readonly code?: true; readonly desc: readonly string[] }, w: number): number {
  const room = 18 * (nameLines(b.name, b.code === true, w - 32).length - 1)
  return 70 + room + 16 * (b.desc.length - 1) + BELOW_THE_LAST_LINE
}

/**
 * The height a box is drawn at: never less than its own text needs, whatever height the page gave it.
 * box() and the boundary that holds it both measure with this one function, so a box grown by its
 * hand-given h carries the boundary's bottom with it, and the boundary's label cannot end up on it
 * (martha#296).
 */
function drawnHeight(b: Box): number {
  return Math.max(b.h, heightFor(b, b.w))
}

/**
 * The room a boundary's bottom label needs under the lowest box the boundary holds: the band above its
 * baseline, its clear ground, and the edge it sits above. A boundary given less draws its label on that
 * box, so a page derives its boundary's height from this and from the boxes, never from a number of its
 * own (martha#283).
 */
function roomUnderABottomLabel(): number {
  return Math.ceil(SIZE['t-bound']! * INK_ABOVE_THE_BASELINE) + UNDER_A_LABEL + LABEL_ABOVE_THE_EDGE
}

class Diagram {
  private readonly parts: string[] = []
  /** Every box that stands for directories in src/, as drawn, for the test that holds the picture to them. */
  readonly coverage: BoxCoverage[] = []
  /** Every box as drawn, for the test that holds each text inside its own rectangle. */
  readonly boxes: DrawnBox[] = []
  /** Every legend entry as drawn, for the test that keeps a legend off the boxes. */
  readonly legendEntries: DrawnLegendEntry[] = []
  /** Every boundary label as drawn, for the test that keeps a box off a label's band. */
  readonly bounds: DrawnBound[] = []
  readonly file: string
  readonly title: string
  readonly w: number
  /** The canvas grows to what is drawn on it: the last thing a page draws sets the height it needs. */
  h: number
  constructor(file: string, title: string, w: number, h: number) {
    this.file = file
    this.title = title
    this.w = w
    this.h = h
  }

  /** Keeps the canvas tall enough for what was drawn, and no shorter than the page asked for. */
  fitTo(bottom: number): void {
    this.h = Math.max(this.h, bottom)
  }

  text(cls: string, x: number, y: number, s: string, middle = false, rotate?: number): DrawnText {
    const anchor = middle ? ' text-anchor="middle"' : ''
    const turn = rotate === undefined ? '' : ` transform="rotate(${rotate} ${x} ${y})"`
    this.parts.push(`<text class="${cls}" x="${x}" y="${y}"${anchor}${turn}>${escape(s)}</text>`)
    return { x, y, text: s, width: widthOf(cls, s) }
  }

  box(b: Box): void {
    // A box is never drawn smaller than its text needs, whatever the page gave it: the fault this
    // check was written for was a box given six lines of description and the height of five.
    const h = drawnHeight(b)
    this.parts.push(`<rect class="${b.kind}" x="${b.x}" y="${b.y}" width="${b.w}" height="${h}" rx="10"/>`)
    const tx = b.person ? b.x + 44 : b.x + 16
    if (b.person) this.parts.push(`<circle class="head" cx="${b.x + 26}" cy="${b.y + 24}" r="9"/>`)
    if (b.names) this.coverage.push({ name: b.name, names: b.names, text: [b.name, b.type, ...b.desc].join('') })
    // A slice name longer than its box is broken at the underscore nearest its middle, so the name stays
    // readable as the directory it is: keep_martha_state_outside_ / the_checkout.
    const lines = nameLines(b.name, b.code === true, b.w - 32)
    const room = 18 * (lines.length - 1)
    const texts = lines.map((line, i) => this.text(b.code ? 't-code' : 't-name', tx, b.y + 28 + 18 * i, line))
    texts.push(this.text('t-type', tx, b.y + 46 + room, b.type))
    b.desc.forEach((line, i) => texts.push(this.text('t-desc', b.x + 16, b.y + 70 + room + 16 * i, line)))
    this.boxes.push({ name: b.name, x: b.x, y: b.y, w: b.w, h, texts })
  }

  bound(x: number, y: number, w: number, h: number, label: string, atTheBottom = false): void {
    this.parts.push(`<rect class="bound" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`)
    // A label at the bottom sits inside the boundary's own left edge, never across its right one, and
    // the page gives the boundary the room its label needs (roomUnderABottomLabel).
    const drawn = this.text('t-bound', x + 16, atTheBottom ? y + h - LABEL_ABOVE_THE_EDGE : y + 22, label)
    const size = SIZE['t-bound']!
    this.bounds.push({
      x, y, w, h, label, atTheBottom,
      labelBand: {
        x: drawn.x,
        y: drawn.y - size * INK_ABOVE_THE_BASELINE,
        w: drawn.width,
        h: size * (INK_ABOVE_THE_BASELINE + INK_BELOW_THE_BASELINE),
      },
    })
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
      const drawn = this.text('t-leg', x + 30, y + 12, label)
      this.legendEntries.push({ x, y, w: 22, h: 14, label, labelX: drawn.x, labelWidth: drawn.width })
      x += 40 + drawn.width
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

  { kind: 'b-dat', x: 332, y: 76, w: 268, h: 120, name: 'the crew declaration', type: '[.crew/crew.json]',
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
    name: 'probe_launch_hosts',
    why: 'a script run by hand, npm run probe:launch, to probe a host; the command never loads it',
  },
  {
    name: 'record_mesh_answers',
    why: 'a script run by hand, npm run record:mesh-answers, when a version of the mesh server is recorded; the gate reads the answers it wrote, and never runs it',
  },
  {
    name: 'record_claude_code_host',
    why: 'a script run by hand, npm run record:claude-code-host, when the host is upgraded; the adapter reads what it writes, and never runs it',
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

/** The Component page's boxes, row by row and column by column: inRows places them. */
const COMPONENT_ROWS: readonly (readonly LooseBox[])[] = [
  [
    { col: 0, kind: 'b-sys', name: 'run_the_martha_command', names: ['run_the_martha_command'], type: '[the acts]', code: true,
      desc: ['init, approve, start <member>, run <shape>,', 'pin-key, keep-shapes, --version: the words', 'checked first, a refusal on stderr with', 'the command that fixes it, 0 / 1 / 2'] },
    { col: 1, kind: 'b-cmp', name: 'declare_a_solo_crew, declare_crew', names: ['declare_a_solo_crew', 'declare_crew', 'who_may_act'], type: '[the declaration]', code: true,
      desc: ['Reads .crew/crew.json once into typed', 'settings; writes it only when none exists.', 'who_may_act holds the mode\'s table of', 'who may assign, approve and resume'] },
    { col: 2, kind: 'b-cmp', name: 'approve_a_checkouts_config', names: ['approve_a_checkouts_config'], type: '[the owner\'s yes]', code: true,
      desc: ['Names every file that starts code and', 'the checkout\'s tree, asks on the owner\'s', 'own terminal, and keeps the fingerprint', 'it was given in approvals.jsonl'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'start_a_member', names: ['start_a_member', 'pass_only_switches_that_load_no_config'], type: '[one member]', code: true,
      desc: ['Refuses no terminal, a name the crew lacks', 'and a stale approval; -- words pass only', 'pass_only_switches_that_load_no_config', 'allows, then names the approval it starts', 'on and holds the terminal'] },
    { col: 1, kind: 'b-cmp', name: 'launch_a_claude_code_member', names: ['launch_a_claude_code_member', 'run_an_owner_signed_command', 'raise_a_turn_to_the_member', 'hand_a_crew_message_to_its_member'], type: '[the launcher]', code: true,
      desc: ['Martha\'s places, the approved snapshot,', 'a launch record before the host starts;', 'raise_a_turn_to_the_member raises each', 'kept turn to its listeners, and hand_a_', 'crew_message_to_its_member hands one', 'message at a time and counts it taken', 'in; run_an_owner_signed_command runs a', 'shape the owner signed on a verified', 'copy, in a sandbox'] },
    { col: 2, kind: 'b-cmp', name: 'refuse_launch_of_unapproved_config', names: ['refuse_launch_of_unapproved_config', 'refuse_code_a_checkout_runs_itself', 'remember_a_members_own_writes', 'run_marthas_own_git'], type: '[the launch gate]', code: true,
      desc: ['Fingerprints the config and the tree', 'id at start, and allows only what was', 'approved, plus remember_a_members_', 'own_writes; refuse_code_a_checkout_', 'runs_itself closes a checkout\'s scripts;', 'run_marthas_own_git the settings each', 'of Martha\'s own git runs carries'] },
  ],
  [
    { col: 0, kind: 'b-dat', name: 'keep_martha_state_outside_the_checkout', names: ['keep_martha_state_outside_the_checkout', 'row_streams_directory', 'keep_what_the_owner_signed'], type: '[Martha\'s state]', code: true,
      desc: ['One directory per project, named by a', 'hash of its path: approvals, launches,', 'keep_what_the_owner_signed;', 'row_streams_directory appends rows', 'as files'] },
    { col: 1, kind: 'b-cmp', name: 'host_contract, linux_process_identity', names: ['host_contract', 'linux_process_identity'], type: '[the host contract, and this machine]', code: true,
      desc: ['What the core may ask of a coding tool:', 'a clock, stores, running a process,', 'delivery in and out; linux_process_identity', 'answers all of it for this machine'] },
    { col: 2, kind: 'b-cmp', name: 'install_the_recorded_mesh_server', names: ['install_the_recorded_mesh_server', 'record_mesh_server_tools', 'record_ring_results', 'prove_the_mesh_server_bytes'], type: '[recorded trees]', code: true,
      desc: ['A tree by bytes, never by version:', 'record_mesh_server_tools records it,', 'record_ring_results rings one server', 'with another and keeps the keys,', 'prove_the_mesh_server_bytes compares it', 'again, and the launcher installs it'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'inbound_paths', names: ['inbound_paths', 'check_every_path_is_gated'], type: '[every path, and its control]', code: true,
      desc: ['Every way text reaches a session and', 'every way a checkout starts code, each', 'row naming the gate on it; check_every_', 'path_is_gated fails CI on a gap'] },
    { col: 1, kind: 'b-cmp', name: 'take_in_a_turn, shell_tools, answer_a_tool_call', names: ['take_in_a_turn', 'take_in_a_tool_result', 'shell_tools', 'answer_a_tool_call', 'refuse_execution_after_ungated_text', 'read_a_ring_results_sender', 'trust_only_framed_envelopes', 'keep_the_shell_for_an_owner_signed_command', 'hash_a_file_under_a_tree', 'prove_a_mesh_answer_is_wordless', 'name_a_node_by_its_petname', 'session_records_in_rows'], type: '[the shell gate]', code: true,
      desc: ['A turn or a tool\'s result: take_in_a_turn,', 'take_in_a_tool_result, shell_tools,', 'answer_a_tool_call, read_a_ring_results_', 'sender, refuse_execution_after_ungated_', 'text, trust_only_framed_envelopes; keep_', 'the_shell_for_an_owner_signed_command;', 'hash_a_file_under_a_tree, what a file is;', 'prove_a_mesh_answer_is_wordless,', 'name_a_node_by_its_petname; session_', 'records_in_rows keeps a session\'s', 'records in the host\'s row streams, and', 'a record nobody can vouch for is lost'] },
    { col: 2, kind: 'b-cmp', name: 'name_the_source_of_a_prompt', names: ['name_the_source_of_a_prompt', 'attribute_a_cross_session_sender', 'carry_taint_across_a_refresh', 'trust_only_signed_lists'], type: '[whose text it was]', code: true,
      desc: ['The origin a host attests, carried with', 'the turn: attribute_a_cross_session_sender,', 'carry_taint_across_a_refresh, and the shell', 'gate\'s reading; trust_only_signed_lists is', 'how every list a gate trusts is opened'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'admit_a_room_message', names: ['admit_a_room_message', 'read_a_room_through_its_gate', 'refuse_widening_a_member_reach'], type: '[loaded; the room is not built]', code: true,
      desc: ['Every launch loads these, though the room', 'they serve is not built: the node id a', 'member has; read_a_room_through_its_gate', 'gives the mesh server\'s tools, and refuse_', 'widening_a_member_reach refuses the rest'] },
    { col: 1, kind: 'b-cmp', name: 'claude_code_host, claude_code_relay', names: ['claude_code_host', 'claude_code_relay', 'refuse_a_member_writing_owner_memory'], type: '[the Claude Code host]', code: true,
      desc: ['The host contract on Claude Code: the', 'plugin, its hooks, the relay on a socket', 'and the member\'s tools; refuse_a_member_', 'writing_owner_memory keeps a member\'s', 'writes out of the owner\'s memory'] },
    { col: 2, kind: 'b-cmp', name: 'check_nothing_private_gets_in, check_every_link_resolves', names: ['check_nothing_private_gets_in', 'check_every_link_resolves', 'check_the_logos_are_valid_svg', 'check_no_test_the_base_passed_goes_missing', 'check_posted_text_carries_nothing_private', 'check_no_literal_restates_a_value', 'check_a_host_directory_stays_under_its_ceiling'], type: '[this repository\'s own checks]', code: true,
      desc: ['A private issue link, an internal host', 'name or a private remote fails CI by', 'name; so does a home path in the text', 'members post on GitHub, which check_', 'posted_text_carries_nothing_private', 'reads daily. A badge host that answers', '408 is asked again before its link is', 'broken; check_the_logos_are_valid_svg', 'holds every logo to well-formed XML;', 'check_no_test_the_base_passed_goes_', 'missing names a dropped test, and', 'check_no_literal_restates_a_value', 'names a literal spelling out a value', 'an exported constant already holds;', 'check_a_host_directory_stays_under_', 'its_ceiling fails a host directory', 'one code line over its ceiling, by name'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'install_the_pinned_installer', names: ['install_the_pinned_installer'], type: '[the installer this release pins]', code: true,
      desc: ['martha install: reads the pin from the', 'running release, fetches exactly that', 'installer version through run_the_nodes_', 'own_npm_alone, refuses other bytes, and', 'runs it with the words unchanged'] },
    { col: 1, kind: 'b-cmp', name: 'run_the_nodes_own_npm_alone', names: ['run_the_nodes_own_npm_alone'], type: '[npm, and nothing of the machine\'s]', code: true,
      desc: ['The npm beside this node, run with', 'empty user and global config, one named', 'registry, --ignore-scripts and an', 'environment built from HOME and PATH', 'alone: the mesh server and the installer,', 'one isolation'] },
    { col: 2, kind: 'b-cmp', name: 'show_dashboard_beat, keep_the_ledger', names: ['show_dashboard_beat', 'report_progress', 'see_the_crew', 'keep_the_ledger', 'a_crews_tools', 'log_ledger', 'keep_the_crew_channel', 'send_a_crew_message', 'show_what_a_message_became', 'read_a_crew_line'], type: '[the crew\'s rows and its ledger]', code: true,
      desc: ['show_dashboard_beat holds a member\'s row', 'and the rule the newest beat wins;', 'report_progress moves it, see_the_crew', 'lays every one out, and a_crews_tools', 'answers every tool the crew', 'registers.', 'keep_the_ledger loads log_ledger, whose', 'streams sit in the crew\'s own state;', 'keep_the_crew_channel is where a message', 'lives, send_a_crew_message writes one, and', 'show_what_a_message_became reads back', 'what became of it; read_a_crew_line reads', 'the HANDOFF and VERDICT lines of a', 'message'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'check_a_range_before_the_owner_says_yes', names: ['check_a_range_before_the_owner_says_yes', 'land_passed_work_as_one_batch', 'find_the_work_a_verdict_passed', 'open_and_finish_a_worktree', 'read_the_origin_a_clone_has'], type: '[the crew\'s tools that act]', code: true,
      desc: ['The five tools a member', 'calls (martha#256): the range', 'check reads a clone and the', 'CI on its tip; land_passed_', 'work_as_one_batch cuts the', 'batch, find_the_work_a_', 'verdict_passed says which head', 'a verdict passed, and fast_', 'forward_after_the_owners_yes', 'moves the default branch;', 'open_and_finish_a_worktree', 'opens and finishes one;', 'read_the_origin_a_clone_has', 'says what a clone is of'] },
  ],
  [
    { col: 0, kind: 'b-cmp', name: 'write_my_handover, refresh_a_member', names: ['write_my_handover', 'refresh_a_member'], type: '[the host writes a handover]', code: true,
      desc: ['A member\'s handover is written by the', 'host, at the path the host chose, and', 'stamped: one file per member per day', 'in the crew\'s own store, so a file the', 'member wrote itself is not a handover.', 'refresh_a_member is the flow around it:', 'when a refresh is due, the ask, the', 'send-back and the decline, the clear,', 'and the prompt the successor resumes on'] },
    { col: 1, kind: 'b-cmp', name: 'park_and_wake_a_member', names: ['park_and_wake_a_member', 'wake_a_member'], type: '[a park that outlives a session]', code: true,
      desc: ['A member\'s park is a marker in the', 'crew\'s store, so a clear, a restart or a', 'refresh cannot lose it; who may park', 'another member is the declaration\'s', 'table, not who_may_act (martha#255 r=3).', 'wake_a_member is martha wake: the park', 'cleared and the member started on its', 'newest handover (part 2)'] },
    { col: 2, kind: 'b-cmp', name: 'crew_files_directory', names: ['crew_files_directory'], type: '[the crew\'s store, on this machine]', code: true,
      desc: ['The host contract\'s crew store as files', 'in one directory: a place per name, a', 'file kept whole under a staging name', 'and 0600, and nothing read that is not', 'this user\'s alone (martha#254, #255)'] },
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


  const lastRowBottom = inRows(d, COMPONENT_ROWS, COLUMNS, WIDE, TOP, GAP)
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

export const ASSETS = join(import.meta.dirname, '..', 'assets')

if (import.meta.main) {
  for (const make of DIAGRAMS) {
    const d = make()
    writeFileSync(join(ASSETS, d.file), d.svg())
  }
}

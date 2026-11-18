// The drawing vocabulary every picture speaks (martha#742).
//
// The fonts and kinds, the styles and defs, escaping, the text metrics that size a
// label, the `Box` and drawn types, the label and height rules, and the `Diagram`
// builder that turns a box into an SVG. The pictures in ../c4_diagrams.ts name six
// things from here — `Diagram`, `heightFor`, `drawnHeight`, `roomUnderABottomLabel`,
// `wrapped` and the `Box` type — and nothing else: every constant below is this
// file's own, so a picture says what to draw and this says how a drawing is made.
//
// The six type interfaces and the builder are exported for the pictures and for the
// entry's own re-export, which keeps what ../c4_diagrams.ts exported before the split.

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
export function wrapped(text: string, width: number): string[] {
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
  /**
   * The host this box says it is, when it claims to be one: a box drawn as a host's holds that host's
   * adapters and nothing else. The test beside this file holds every slice such a box names to
   * package.json's martha.hostAdapters (martha#492); a box that declares no host is never judged,
   * because a capability box groups a slice with its adapter on purpose.
   */
  readonly host?: string
  readonly person?: true
  readonly code?: true
}

/** What a box covering src/ directories stands for, as it was drawn. */
export interface BoxCoverage {
  readonly name: string
  readonly names: readonly string[]
  /** The host the box declared, when it declared one: what the test holds its names to. */
  readonly host?: string
  /** The title, the type and every description line, joined, so a name split over two lines is still found. */
  readonly text: string
  /**
   * The same pieces as a reader reads them, one space between: a name split over two lines and a count
   * split over two lines both stay whole here, which joining them shut together would hide.
   */
  readonly said: string
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
export function heightFor(b: { readonly name: string; readonly code?: true; readonly desc: readonly string[] }, w: number): number {
  const room = 18 * (nameLines(b.name, b.code === true, w - 32).length - 1)
  return 70 + room + 16 * (b.desc.length - 1) + BELOW_THE_LAST_LINE
}

/**
 * The height a box is drawn at: never less than its own text needs, whatever height the page gave it.
 * box() and the boundary that holds it both measure with this one function, so a box grown by its
 * hand-given h carries the boundary's bottom with it, and the boundary's label cannot end up on it
 * (martha#296).
 */
export function drawnHeight(b: Box): number {
  return Math.max(b.h, heightFor(b, b.w))
}

/**
 * The room a boundary's bottom label needs under the lowest box the boundary holds: the band above its
 * baseline, its clear ground, and the edge it sits above. A boundary given less draws its label on that
 * box, so a page derives its boundary's height from this and from the boxes, never from a number of its
 * own (martha#283).
 */
export function roomUnderABottomLabel(): number {
  return Math.ceil(SIZE['t-bound']! * INK_ABOVE_THE_BASELINE) + UNDER_A_LABEL + LABEL_ABOVE_THE_EDGE
}

export class Diagram {
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
    if (b.names) this.coverage.push({
      name: b.name,
      names: b.names,
      ...(b.host === undefined ? {} : { host: b.host }),
      text: [b.name, b.type, ...b.desc].join(''),
      said: [b.name, b.type, ...b.desc].join(' '),
    })
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

// The C4 model cannot drift: each SVG in assets/ is exactly what c4_diagrams.ts
// draws, and architecture/README.md shows each one. The test only reads; it
// writes nothing, so it leaves nothing behind. Redraw with
// `node architecture/c4_diagrams.ts` after changing a box.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join, relative } from 'node:path'
import {
  aCountInWords,
  ASSETS, components, containers, DIAGRAMS, LEFT_OUT, PACKAGE_BOXES, ROOM_SLICES_WHICH_LOAD,
} from './c4_diagrams.ts'
import type { DrawnBox, DrawnLegendEntry, DrawnText } from './c4_diagrams.ts'

const README = readFileSync(join(import.meta.dirname, 'README.md'), 'utf8')
const SRC = join(import.meta.dirname, '..', 'src')

// Every directory under src/ a module of this process loads, by the resolve hook below. The hook lives
// in this test's own process, which node --test gives each test file, and the test writes nothing to
// disk, so nothing of it is left behind.
const loadedFromSrc = new Set<string>()
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context)
    const slice = /\/src\/([^/]+)\//.exec(resolved.url)?.[1]
    if (slice !== undefined) loadedFromSrc.add(slice)
    return resolved
  },
})

/** What `martha` itself loads, recorded once: a second import of the same module runs no hook again. */
let loadedByALaunch: Promise<ReadonlySet<string>> | undefined
const slicesALaunchLoads = (): Promise<ReadonlySet<string>> => {
  loadedByALaunch ??= (async () => {
    loadedFromSrc.clear()
    await import('../src/run_the_martha_command/run_the_martha_command.ts')
    return new Set(loadedFromSrc)
  })()
  return loadedByALaunch
}

/**
 * The slices that exist only to serve the room. No room runs in this release and a launch still loads
 * parts of each of them, so the page says which parts, and this list is what holds it to the whole
 * family: a slice that loads and is not named is the page understating what runs (martha#106).
 */
const ROOM_SLICES = [
  'admit_a_room_message',
  'read_a_room_through_its_gate',
  'refuse_widening_a_member_reach',
  'trust_only_framed_envelopes',
] as const

/**
 * Sentences that were on the page and were false: a launch does load these slices' parts. Each is the
 * wording as it was written, so putting one back fails here by name rather than passing quietly.
 */
const DENIES_LOADING: readonly string[] = [
  'loads no room code',
  'no team-mode container or slice is loaded',
  'mode loads none of it',
  'rooms are team mode, and solo loads none of them',
]

const textIn = (svg: string): string =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((found) => found[1]).join(' ')

/** Everything the page says: the README, and the words drawn in the three pictures it shows. */
const pageText = [
  README,
  ...DIAGRAMS.map((make) => textIn(readFileSync(join(ASSETS, make().file), 'utf8'))),
].join('\n')

// The page links an SVG by its path from the page to the generator's ASSETS.
const linkTo = (file: string): string => `${relative(import.meta.dirname, ASSETS)}/${file}`

for (const make of DIAGRAMS) {
  const diagram = make()

  test(`${diagram.file} is what the generator draws`, () => {
    const drawn = readFileSync(join(ASSETS, diagram.file), 'utf8')
    assert.equal(drawn, diagram.svg(), `redraw: node architecture/c4_diagrams.ts`)
  })

  test(`architecture/README.md shows ${diagram.file}`, () => {
    assert.ok(README.includes(linkTo(diagram.file)), `architecture/README.md does not show ${diagram.file}`)
  })
}

// What the shared C4 gate asks of this repository (macula-io/macula-ci-images,
// .github/workflows/c4-model.yml): a Context and a Component diagram for a repository that
// builds an executable, and a Container diagram too because this one keeps architecture/README.md,
// each shown by a README. The gate reads the files; this reads the generator, so a box deleted
// here fails before the gate has to say so.
test('the model is a Context, a Component and a Container diagram, and the gate asks for each', () => {
  const files = DIAGRAMS.map((make) => make().file)
  for (const kind of ['context', 'component', 'container']) {
    assert.ok(files.some((f) => f.includes(kind)), `no ${kind} diagram in the generator`)
  }
})

// The picture is drawn by hand, so a box may be given more text than it has room for, or
// two boxes may land on each other, and every check above still passes: they hold the
// picture to src/, not to its own geometry (martha#283). These five hold it to that, and
// each names the box it fails, so the next box that arrives too small is answered where it
// is written rather than by someone reading the page.

/** The clearance a text keeps from its box's bottom edge and right edge. */
const INSIDE_BY = 6

interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The swatch and its label are one entry: a label wide enough to reach a box counts too. */
const legendRow = (entry: DrawnLegendEntry): Rect => ({
  x: entry.x,
  y: entry.y,
  w: entry.labelX + entry.labelWidth - entry.x,
  h: entry.h,
})

const within = (canvas: Rect, rect: Rect): boolean =>
  rect.x >= canvas.x && rect.y >= canvas.y &&
  rect.x + rect.w <= canvas.x + canvas.w && rect.y + rect.h <= canvas.y + canvas.h

/** What is wrong with one text in one box, as the lines of a failure, or nothing when it is inside. */
const outsideItsBox = (file: string, box: DrawnBox, text: DrawnText): string[] => {
  const bottom = box.y + box.h - INSIDE_BY
  const right = box.x + box.w - INSIDE_BY
  const below = text.y > bottom
    ? [`${file}: ${box.name} draws "${text.text}" with its baseline at ${text.y}, below ${bottom}, where its box's text must end`]
    : []
  const past = text.x + text.width > right
    ? [`${file}: ${box.name} draws "${text.text}", ${Math.round(text.width)} wide from ${text.x}, and it must end by ${right}`]
    : []
  return [...below, ...past]
}

const textsOutsideTheirBox = (): string[] =>
  DIAGRAMS.flatMap((make) => {
    const diagram = make()
    return diagram.boxes.flatMap((box) => box.texts.flatMap((text) => outsideItsBox(diagram.file, box, text)))
  })

const legendsAcrossABox = (): string[] =>
  DIAGRAMS.flatMap((make) => {
    const diagram = make()
    return diagram.legendEntries.flatMap((entry) => diagram.boxes
      .filter((box) => overlaps(legendRow(entry), box))
      .map((box) => `${diagram.file}: the legend entry "${entry.label}" is drawn across ${box.name}`))
  })

const boxesOnEachOther = (): string[] =>
  DIAGRAMS.flatMap((make) => {
    const diagram = make()
    const pairs = diagram.boxes.flatMap((box, i) => diagram.boxes.slice(i + 1).map((other) => [box, other] as const))
    return pairs
      .filter(([box, other]) => overlaps(box, other))
      .map(([box, other]) => `${diagram.file}: ${box.name} overlaps ${other.name}`)
  })

/**
 * A boundary's label is held off the boxes the way a legend entry is: the band its line of type takes is
 * what no box may be drawn into (martha#283).
 */
const boxesOnABoundaryLabel = (): string[] =>
  DIAGRAMS.flatMap((make) => {
    const diagram = make()
    return diagram.bounds.flatMap((bound) => diagram.boxes
      .filter((box) => overlaps(bound.labelBand, box))
      .map((box) => `${diagram.file}: the boundary label "${bound.label}" is drawn on ${box.name}`))
  })

// A page whose rows grew past the canvas is a page a reader loses the bottom of, so the last
// thing drawn sets the height, and this holds it to that.
const drawnOffTheCanvas = (): string[] =>
  DIAGRAMS.flatMap((make) => {
    const diagram = make()
    const canvas: Rect = { x: 0, y: 0, w: diagram.w, h: diagram.h }
    const boxes = diagram.boxes
      .filter((box) => !within(canvas, box))
      .map((box) => `${diagram.file}: ${box.name} is drawn at ${box.x},${box.y} to ${box.x + box.w},${box.y + box.h}`)
    const legends = diagram.legendEntries
      .filter((entry) => !within(canvas, legendRow(entry)))
      .map((entry) => `${diagram.file}: the legend entry "${entry.label}" is drawn at ${entry.x},${entry.y}`)
    const labels = diagram.bounds
      .filter((bound) => !within(canvas, bound.labelBand))
      .map((bound) => `${diagram.file}: the boundary label "${bound.label}" is drawn at ${bound.labelBand.x},${Math.round(bound.labelBand.y)}`)
    return [...boxes, ...legends, ...labels]
  })

test('every text a box draws sits inside that box', () => {
  const outside = textsOutsideTheirBox()
  assert.deepEqual(outside, [], `a box prints its text outside itself:\n${outside.join('\n')}`)
})

test('no legend is drawn across a box', () => {
  const across = legendsAcrossABox()
  assert.deepEqual(across, [], `a legend is drawn on a box:\n${across.join('\n')}`)
})

test('no two boxes are drawn on each other', () => {
  const on = boxesOnEachOther()
  assert.deepEqual(on, [], `two boxes are drawn on each other:\n${on.join('\n')}`)
})

test('no boundary label is drawn on a box', () => {
  const on = boxesOnABoundaryLabel()
  assert.deepEqual(on, [], `a boundary's label is drawn on a box:\n${on.join('\n')}`)
})

test('everything drawn is on the canvas', () => {
  const off = drawnOffTheCanvas()
  assert.deepEqual(off, [], `drawn off the canvas:\n${off.join('\n')}`)
})

// The Component diagram is the code, so a slice cannot reach src/ and stay off it unseen:
// it is drawn in a box, or named in LEFT_OUT with the reason it is not.
const slicesInSrc = (): string[] =>
  readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

test('every directory in src/ is drawn in a component box or declared left out', () => {
  const drawn = new Set(components().coverage.flatMap((box) => [...box.names]))
  const leftOut = new Set(LEFT_OUT.map((entry) => entry.name))
  const missing = slicesInSrc().filter((slice) => !drawn.has(slice) && !leftOut.has(slice))
  assert.deepEqual(missing, [], `in no box and not declared left out: ${missing.join(', ')}`)
})

// The Components table on the page has a row per box, and a box drawn with no row is the page short of
// its own picture while every other check stays green (martha#299). A row answers for a box when its
// Component cell names a directory the box stands for.

/** The directories each row of the page's Components table names in its Component cell. */
const componentTableRows = (page: string): string[][] => {
  const section = page.slice(page.indexOf('## Components'), page.indexOf('### Left out'))
  return section.split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => [...(line.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ''))
}

/** The boxes the Component diagram draws that no row of the table names, by the box's title. */
const boxesWithNoRow = (page: string): string[] => {
  const named = new Set(componentTableRows(page).flat())
  return components().coverage
    .filter((box) => !box.names.some((name) => named.has(name)))
    .map((box) => box.name)
}

test('every component box has a row in the Components table', () => {
  const missing = boxesWithNoRow(README)
  assert.deepEqual(missing, [], `the Components table has no row for: ${missing.join('; ')}`)
})

// The check above passes on a page that has every row, which proves nothing about it on its own. Each
// page below is the real one with one box's row taken away in a way the check must still see.
// The boxes are found by a directory each stands for, and their titles are read from the drawing, so a
// title renamed in c4_diagrams.ts is followed here rather than restated.
const boxHolding = (directory: string): { readonly name: string; readonly names: readonly string[] } =>
  components().coverage.find((box) => box.names.includes(directory))!
const CREW_BOX = boxHolding('show_dashboard_beat')
const STORE_BOX = boxHolding('crew_files_directory')
const HANDOVER_BOX = boxHolding('write_my_handover')

/** The table row whose Component cell opens with the given directory. */
const rowOf = (directory: string): string =>
  README.split('\n').find((line) => line.startsWith(`| \`${directory}\``))!

test('a box whose row is gone, named only in the text of another row, or tabled below the Components table has no row', () => {
  const crewRow = rowOf(CREW_BOX.names[0]!)
  const storeName = STORE_BOX.names[0]!
  const storeRow = rowOf(storeName)
  const rowGone = README.replace(`${crewRow}\n`, '')
  const handoverRow = rowOf(HANDOVER_BOX.names[0]!)
  const namedOnlyInText = README.replace(`${storeRow}\n`, '')
    .replace(handoverRow, handoverRow.replace(/ \|$/, ` \`${storeName}\` keeps all of it whole. |`))
  const leftOutRow = rowOf(LEFT_OUT[0]!.name)
  const tabledBelow = rowGone.replace(leftOutRow, `${crewRow}\n${leftOutRow}`)
  assert.ok(!rowGone.includes(crewRow) && !namedOnlyInText.includes(storeRow) && namedOnlyInText.includes(storeName)
    && tabledBelow.includes(crewRow),
    'a page below was not changed the way its name says, so its answer would prove nothing')
  assert.deepEqual(boxesWithNoRow(rowGone), [CREW_BOX.name])
  assert.deepEqual(boxesWithNoRow(namedOnlyInText), [STORE_BOX.name])
  assert.deepEqual(boxesWithNoRow(tabledBelow), [CREW_BOX.name])
})

test('a component box stands for directories that are in src/, and names each one it stands for', () => {
  const slices = new Set(slicesInSrc())
  for (const box of components().coverage) {
    for (const name of box.names) {
      assert.ok(slices.has(name), `${box.name} stands for ${name}, which is not a directory in src/`)
      assert.ok(box.text.includes(name), `${box.name} stands for ${name} but does not name it`)
    }
    for (const titled of box.name.split(', ')) {
      assert.ok(box.names.includes(titled), `${box.name} titles ${titled}, which it does not stand for`)
    }
  }
})

/** `The five `, say, for every count up to twelve except the one a box already holds, and the digits. */
const theCountsABoxDoesNotHold = (held: number): readonly string[] => {
  const upToTwelve = Array.from({ length: 13 }, (_, stated) => stated)
  const inWords = upToTwelve.filter((stated) => stated !== held).map((stated) => `The ${aCountInWords(stated)} `)
  return [...inWords, ...upToTwelve.map((stated) => `The ${String(stated)} `)]
}

test('a box that says how many things it holds says the count it holds', () => {
  for (const box of components().coverage) {
    assert.ok(!box.text.includes('{count}'), `${box.name} draws the placeholder where a count belongs`)
    const wrong = theCountsABoxDoesNotHold(box.names.length).filter((said) => box.text.includes(said))
    assert.equal(wrong.length, 0, `${box.name} holds ${box.names.length} names and says ${wrong.join(', ')}`)
  }
})


test('what is left out says why, is a directory in src/, and is said on the page', () => {
  const slices = new Set(slicesInSrc())
  const drawn = new Set(components().coverage.flatMap((box) => [...box.names]))
  for (const entry of LEFT_OUT) {
    assert.ok(slices.has(entry.name), `${entry.name} is left out and is not a directory in src/`)
    assert.ok(!drawn.has(entry.name), `${entry.name} is both drawn and declared left out`)
    assert.ok(entry.why.trim().length > 0, `${entry.name} is left out with no reason`)
    assert.ok(README.includes(entry.name), `architecture/README.md does not say ${entry.name} is left out`)
  }
})

// The note at the foot of the Components page is drawn from LEFT_OUT since martha#296, so a directory
// added to the array is named there with its own reason without anyone remembering to edit prose. The
// words are read back out of the drawn SVG, so this holds the picture rather than the code that made
// it: a note that drops an entry, or a drawing edited by hand, fails by naming the entry.
const normalizeSpace = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** A count a note may write in words, so a hand-written note is read as well as a generated one. */
const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

/** The page's own count of what it draws nowhere, held to the array: the failure lines, or nothing. */
const countWrong = (page: string): string[] => {
  const words = Object.keys(COUNT_WORDS).join('|')
  const counted = new RegExp(
    `(?:(?:These )?(\\d+|${words}) directories are|This directory is) drawn nowhere on purpose`, 'i',
  ).exec(page)
  if (counted === null) return ['the page does not say how many directories are drawn nowhere on purpose']
  const said = counted[1] === undefined ? 1 : COUNT_WORDS[counted[1].toLowerCase()] ?? Number(counted[1])
  return said === LEFT_OUT.length
    ? []
    : [`the page says ${said} directories are drawn nowhere on purpose, and LEFT_OUT holds ${LEFT_OUT.length}`]
}

/** One left-out directory as the page must say it: its name, and the reason that entry gives. */
const entryWrong = (page: string, entry: { readonly name: string; readonly why: string }): string[] => [
  ...(page.includes(entry.name) ? [] : [`the page leaves out ${entry.name} and never names it`]),
  ...(page.includes(normalizeSpace(entry.why))
    ? []
    : [`the page does not say why ${entry.name} is left out: "${entry.why}"`]),
]

test('the components page names every directory it leaves out, and says why', () => {
  const page = normalizeSpace(textIn(readFileSync(join(ASSETS, 'c4-components.svg'), 'utf8')))
  const wrong = [...countWrong(page), ...LEFT_OUT.flatMap((entry) => entryWrong(page, entry))]
  assert.deepEqual(wrong, [], `the components page disagrees with LEFT_OUT:\n${wrong.join('\n')}`)
})

// A box's height is the taller of the height it is given and the height its text needs, while a
// boundary's bottom was measured from its text alone (Mercurius's O1 on martha#283, folded in as
// martha#296). A box made taller by its given h therefore stood past the room its boundary's bottom
// label needs, and every check passed. The relay is grown each of the two ways a box grows here, and
// the boundary must be drawn below it either way.

/** What ends in the ground a boundary's bottom label keeps, as the failure lines, or nothing. */
const overrunsOfBottomLabel = (diagram: ReturnType<typeof containers>): string[] => {
  const bound = diagram.bounds.find((drawn) => drawn.atTheBottom)!
  const held = diagram.boxes.filter((box) => box.x >= bound.x && box.x + box.w <= bound.x + bound.w)
  return held
    .filter((box) => box.y + box.h > bound.labelBand.y)
    .map((box) => `${box.name} ends at ${box.y + box.h}, into the band its boundary's bottom label takes from ${bound.labelBand.y}, though the boundary ends at ${bound.y + bound.h}`)
}

const assertInsideItsBoundary = (diagram: ReturnType<typeof containers>): void => {
  const overrun = overrunsOfBottomLabel(diagram)
  assert.deepEqual(overrun, [], `a box overruns the room its boundary's bottom label needs:\n${overrun.join('\n')}`)
}

/** The relay, grown by its hand-given h: the taller of the two heights a box is drawn at. */
const grownByItsGivenHeight = PACKAGE_BOXES.map((box) =>
  box.name === 'the relay' ? { ...box, h: box.h + 40 } : box)

/** The relay, grown by its own text: it is given no height at all, and two lines more than it had. */
const grownByItsText = PACKAGE_BOXES.map((box) =>
  box.name === 'the relay'
    ? { ...box, h: 0, desc: [...box.desc, 'A line its given height never counted,', 'and one more'] }
    : box)

test('a box given a taller height than its text needs still ends inside its boundary', () => {
  assertInsideItsBoundary(containers(grownByItsGivenHeight))
})

test('a box given less height than its text needs still ends inside its boundary', () => {
  assertInsideItsBoundary(containers(grownByItsText))
})

// No room runs in this release, and a picture can easily say "solo loads none of it" and be wrong: the
// command does load parts of the room's slices. So the page's words are held to what the command loads,
// not to a reading of the imports. The comparison is exact in both directions: a room slice that loads
// and is not named, and one that is named and no longer loads, both fail.
test('a launch loads exactly the room slices the page says it does, and names each of them', async () => {
  const loaded = await slicesALaunchLoads()
  const loadedRoom = ROOM_SLICES.filter((slice) => loaded.has(slice)).sort()
  assert.deepEqual(loadedRoom, [...ROOM_SLICES_WHICH_LOAD].sort(),
    `a launch loads ${loadedRoom.join(', ')} of the room's slices, and the page says ${ROOM_SLICES_WHICH_LOAD.join(', ')}; bring the words and the code back together`)
  const drawn = new Set(components().coverage.flatMap((box) => [...box.names]))
  for (const slice of ROOM_SLICES_WHICH_LOAD) {
    assert.ok(drawn.has(slice), `${slice} loads on every launch, so the Component diagram must draw it`)
    assert.ok(README.includes(slice), `architecture/README.md names none of ${slice}, which every launch loads`)
  }
})

test('nothing the page says denies that a launch loads the room', () => {
  for (const phrase of DENIES_LOADING) {
    assert.ok(!pageText.includes(phrase),
      `the page says "${phrase}", and a launch loads ${ROOM_SLICES_WHICH_LOAD.join(', ')}`)
  }
})

test('no directory the page leaves out is loaded by a launch', async () => {
  const loaded = await slicesALaunchLoads()
  const loadedButLeftOut = LEFT_OUT.map((entry) => entry.name).filter((name) => loaded.has(name))
  assert.deepEqual(loadedButLeftOut, [],
    `the page says nothing this release runs loads ${loadedButLeftOut.join(', ')}`)
})

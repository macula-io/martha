// A release layer is the committed tree plus exactly one generated file, the installer's pin (martha#84, martha#207).
// The dry run compared the layer with `git archive HEAD` alone, refused a correct release, and its one differing path
// arrived cut off a Map diff. These hold the comparison to the pin, and hold every refusal to naming its paths.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../src/launch_a_claude_code_member/relay_copy.ts'
import {
  differences,
  inWords,
  PIN_IN_THE_LAYER,
  pinFieldsThatDiffer,
  thePinIn,
  withoutThePin
} from './the_layer_is_the_tree_and_the_pin.mjs'

/** @param {Record<string, string>} entries @returns {Map<string, string>} */
const tree = (entries) => new Map(Object.entries(entries))

/** The committed tree, small enough to read: a path and the hash treeOf would give it. */
const committed = () => tree({ 'package.json': 'aaaa', 'docs/how-a-release-is-made.md': 'bbbb', 'src/a.ts': 'cccc' })
/** What the packer lays down: the same tree, plus its pin, at the one path the pin is written to. */
const packed = () => tree({ ...Object.fromEntries(committed()), [PIN_IN_THE_LAYER]: 'dddd' })

test('the layer the packer makes is never the bare archive, which is what the dry run refused (martha#207)', () => {
  // The comparison as it was: the layer against `git archive HEAD`, path for path and hash for hash.
  assert.notDeepEqual(packed(), committed(), 'the layer holds the pin and the archive does not')
  const differing = differences(committed(), packed())
  assert.deepEqual(differing, { missing: [], extra: [PIN_IN_THE_LAYER], changed: [] }, 'nothing but the pin differs')
  assert.ok(inWords(differing).includes(PIN_IN_THE_LAYER), `the difference names ${PIN_IN_THE_LAYER}: ${inWords(differing)}`)
})

test('the layer, once the pin is set aside, is the committed tree and passes', () => {
  assert.deepEqual(withoutThePin(packed()), committed(), 'what is left of the layer is the tree, byte for byte')
  assert.equal(inWords(differences(committed(), withoutThePin(packed()))), '', 'nothing to report')
  assert.deepEqual(withoutThePin(committed()), committed(), 'a layer with no pin is still the committed tree')
})

test('a planted file is refused, and the refusal names it', () => {
  const words = inWords(differences(committed(), withoutThePin(tree({ ...Object.fromEntries(packed()), 'martha/stray.txt': 'eeee' }))))
  assert.ok(words.includes('not in the committed tree (1): martha/stray.txt'), words)
})

test('a file missing from the layer is refused, and the refusal names it', () => {
  const short = new Map([...withoutThePin(packed())].filter(([path]) => path !== 'src/a.ts'))
  const words = inWords(differences(committed(), short))
  assert.ok(words.includes('missing from the layer (1): src/a.ts'), words)
})

test('a file with other bytes is refused, and the refusal names it', () => {
  const changed = new Map(withoutThePin(packed())).set('package.json', 'ffff')
  const words = inWords(differences(committed(), changed))
  assert.ok(words.includes('differing bytes (1): package.json'), words)
})

test('a tree that differs in more paths than one message names still counts them all', () => {
  const wide = tree(Object.fromEntries(Array.from({ length: 12 }, (_, at) => [`src/${at}.ts`, `h${at}`])))
  const words = inWords(differences(wide, tree({})))
  assert.ok(words.includes('missing from the layer (12): src/0.ts'), words)
  assert.ok(words.includes('and 2 more'), `the paths the message does not name are counted: ${words}`)
})

test('the pin a layer holds is read back as written, and a layer without one is named', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-pin-'))
  t.after(() => removeTheTree(dir))
  const pin = { name: '@macula-io/martha', version: '1.0.2', integrity: 'sha512-aaaa' }
  mkdirSync(join(dir, dirname(PIN_IN_THE_LAYER)), { recursive: true })
  writeFileSync(join(dir, PIN_IN_THE_LAYER), `${JSON.stringify(pin, null, 2)}\n`)
  assert.deepEqual(thePinIn(dir), pin, 'the pin comes back as it was written')
  assert.throws(() => thePinIn(join(dir, 'nowhere')), (error) => String(error).includes(PIN_IN_THE_LAYER), 'a missing pin is named by its path')
})

test('a pin is the published installer field for field, and any field that is not is named', () => {
  const published = { name: '@macula-io/martha', version: '1.0.2', integrity: 'sha512-aaaa' }
  assert.deepEqual(pinFieldsThatDiffer(published, published), [], 'the same installer is no difference')
  assert.deepEqual(pinFieldsThatDiffer({ ...published, version: '1.0.1' }, published), ['version is "1.0.1", not "1.0.2"'])
  assert.deepEqual(pinFieldsThatDiffer({ ...published, integrity: 'sha512-bbbb' }, published), ['integrity is "sha512-bbbb", not "sha512-aaaa"'])
  assert.deepEqual(pinFieldsThatDiffer({}, published), ['integrity is undefined, not "sha512-aaaa"', 'name is undefined, not "@macula-io/martha"', 'version is undefined, not "1.0.2"'], 'a pin with no fields differs in every one')
})

test('a pin carrying one field more than the published installer is refused, and the field is named', () => {
  const published = { name: '@macula-io/martha', version: '1.0.2', integrity: 'sha512-aaaa' }
  // The comparison is over every field either object names, never over a list of the fields the writer is known to
  // write: a shape restated here would pass a pin that smuggles in a fourth field.
  assert.deepEqual(pinFieldsThatDiffer({ ...published, extra: 'x' }, published), ['extra is "x", not undefined'])
  assert.deepEqual(pinFieldsThatDiffer({ name: published.name, version: published.version }, published), ['integrity is undefined, not "sha512-aaaa"'], 'a field the pin leaves out is named too')
})

test('a pin carrying a field the published installer does not name is refused even when the field is "__proto__"', () => {
  const published = { name: '@macula-io/martha', version: '1.0.2', integrity: 'sha512-aaaa' }
  // Built with JSON.parse on purpose: in an object literal "__proto__" sets the prototype and adds no field, so a pin
  // carrying one can only arrive from JSON — which is exactly how a pin reaches this comparison. Read off the
  // prototype chain, both sides answer Object.prototype and serialise alike, and the smuggled field would pass.
  const smuggled = JSON.parse('{"name":"@macula-io/martha","version":"1.0.2","integrity":"sha512-aaaa","__proto__":{}}')
  assert.ok(Object.hasOwn(smuggled, '__proto__'), 'the pin names the field itself')
  assert.deepEqual(pinFieldsThatDiffer(smuggled, published), ['__proto__ is {}, not undefined'], 'a field only the pin names is a difference')
  assert.deepEqual(pinFieldsThatDiffer(published, smuggled), ['__proto__ is undefined, not {}'], 'and it differs whichever side carries it')
})

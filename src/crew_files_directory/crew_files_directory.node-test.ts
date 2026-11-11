// The crew's own store on a real disk, as martha#255 part 1 needs it: a place per name, a file kept whole in it, and
// every one of those refused when the directory or the file is not one only this user may read and write.

import assert from 'node:assert/strict'
import fs, { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import {
  CREW_DIRECTORY_MODE,
  CREW_FILE_MODE,
  STAGING_PREFIX,
  crewFilesDirectory,
  isAPlainName,
} from './crew_files_directory.ts'
import type { CrewPlace } from '../host_contract/host_contract.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-crew-files-'))
after(() => rmSync(home, { recursive: true, force: true }))

const PERMISSIONS = 0o777

/** A crew's own directory under a fresh home, as the launcher resolves one. */
function aCrew(name: string): string {
  const crew = join(home, name, 'crews', `a-key-of-${name}`)
  mkdirSync(join(home, name, 'crews'), { recursive: true, mode: CREW_DIRECTORY_MODE })
  return crew
}

const placeOf = (crew: string, name: string): CrewPlace => {
  const place = crewFilesDirectory(crew).place(name)
  assert.ok(!('refusal' in place), `the store refused the place ${name}: ${'refusal' in place ? place.refusal : ''}`)
  return place
}

test('#255: a place is made inside the crew\'s directory, and a file kept there is whole, 0600 and read back', () => {
  const crew = aCrew('handovers')
  const place = placeOf(crew, 'handovers')

  assert.equal(place.path, join(crew, 'handovers'), 'a place is not the directory the crew\'s store makes for it')
  assert.equal(lstatSync(crew).mode & PERMISSIONS, CREW_DIRECTORY_MODE, 'the crew directory is not this user\'s alone')
  assert.equal(lstatSync(place.path).mode & PERMISSIONS, CREW_DIRECTORY_MODE, 'a place is not this user\'s alone')

  assert.equal(place.keep('HANDOVER_2026-11-11_builder.md', 'what the member held\n'), undefined, 'the store refused a file it should keep')
  const file = join(place.path, 'HANDOVER_2026-11-11_builder.md')
  assert.equal(statSync(file).mode & PERMISSIONS, CREW_FILE_MODE, 'a crew file is readable by someone other than its owner')
  assert.deepEqual(place.read('HANDOVER_2026-11-11_builder.md'), { text: 'what the member held\n' })
  assert.deepEqual(place.names(), ['HANDOVER_2026-11-11_builder.md'])
  assert.deepEqual(readdirSync(place.path), ['HANDOVER_2026-11-11_builder.md'], 'the store left its staging file behind')
})

test('#255: a name kept twice holds the second text, so a reader never sees half of it', () => {
  const place = placeOf(aCrew('replaced'), 'parked')
  place.keep('builder.parked.json', '{"reason":"a","since":"a"}\n')
  assert.equal(place.keep('builder.parked.json', '{"reason":"b","since":"b"}\n'), undefined)
  assert.deepEqual(place.read('builder.parked.json'), { text: '{"reason":"b","since":"b"}\n' })
  assert.deepEqual(place.names(), ['builder.parked.json'])
})

test('#255: a name this place does not hold reads as absent, and a half-written file is not a name in it', () => {
  const place = placeOf(aCrew('absent'), 'handovers')
  assert.equal(place.read('nobody-handed-over.md'), undefined, 'a file that is not there did not read as absent')
  writeFileSync(join(place.path, `${STAGING_PREFIX}a-file-being-written`), 'half', { mode: CREW_FILE_MODE })
  assert.deepEqual(place.names(), [], 'a half-written file was offered as one of the place\'s files')
})

test('#255: a place that others may write into is refused, and nothing is written in it', () => {
  const crew = aCrew('open')
  mkdirSync(crew, { recursive: true, mode: CREW_DIRECTORY_MODE })
  chmodSync(crew, 0o777)
  const refused = crewFilesDirectory(crew).place('handovers')
  assert.ok('refusal' in refused, 'a crew directory anyone may write into was accepted')
  assert.match(refused.refusal, /may be written by others/, 'the refusal does not say what is wrong with the directory')
  assert.deepEqual(readdirSync(crew), [], 'the store wrote into a directory it refused')
})

test('#255: a place that is a link to somewhere else is refused', () => {
  const crew = aCrew('linked')
  const elsewhere = join(home, 'linked', 'elsewhere')
  mkdirSync(elsewhere, { recursive: true, mode: CREW_DIRECTORY_MODE })
  mkdirSync(crew, { recursive: true, mode: CREW_DIRECTORY_MODE })
  symlinkSync(elsewhere, join(crew, 'handovers'))
  const refused = crewFilesDirectory(crew).place('handovers')
  assert.ok('refusal' in refused, 'a place that is a link was followed')
  assert.match(refused.refusal, /is a link/, 'the refusal does not say the place is a link')
})

test('#255: a file anyone else may read is not trusted, and neither is one that is a link', () => {
  const place = placeOf(aCrew('untrusted'), 'handovers')
  place.keep('builder.md', 'the member\'s own\n')
  chmodSync(join(place.path, 'builder.md'), 0o644)
  const read = place.read('builder.md')
  assert.ok(read !== undefined && 'refusal' in read, 'a file anyone may read was trusted as the host\'s own')
  assert.match(read.refusal, /only this user may read and write/, 'the refusal does not say what is wrong with the file')

  const target = join(place.path, 'elsewhere.md')
  writeFileSync(target, 'not the host\'s\n', { mode: CREW_FILE_MODE })
  symlinkSync(target, join(place.path, 'a-link.md'))
  const linked = place.read('a-link.md')
  assert.ok(linked !== undefined && 'refusal' in linked, 'a link was followed as though it were a crew file')
})

test('#255: a name a directory already holds is refused, and the place is left as it was', () => {
  const place = placeOf(aCrew('taken'), 'handovers')
  mkdirSync(join(place.path, 'builder.md'), { mode: CREW_DIRECTORY_MODE })
  const refused = place.keep('builder.md', 'the handover\n')
  assert.ok(refused !== undefined, 'a write over a directory of the same name neither happened nor said why')
  assert.match(refused.refusal, /could not be replaced/, 'the refusal does not say what went wrong')
  assert.deepEqual(readdirSync(place.path), ['builder.md'], 'a refused write left its staging file behind')
})

// A disk can take fewer bytes than it was given. The count is checked against what the text needs, so a half-written
// handover is refused rather than renamed over the whole one it was meant to replace (martha#255 r=2).
test('#255: a file the disk kept only part of is refused, and none of it is left behind', (t) => {
  const place = placeOf(aCrew('short'), 'handovers')
  const text = 'a handover longer than the four bytes this disk will take\n'
  t.mock.method(fs, 'writeSync', () => 4)

  const refused = place.keep('builder.md', text)

  assert.ok(refused !== undefined, 'a short write was taken as a whole file, so a successor could be handed half a handover')
  assert.match(refused.refusal, /kept only 4 of the \d+ bytes/, 'the refusal does not say that only part of the file was written')
  assert.deepEqual(readdirSync(place.path), [], 'a refused short write left a file behind')
})

test('#255: a place or a file name that is a path is refused, never translated into one', () => {
  const crew = aCrew('paths')
  const store = crewFilesDirectory(crew)
  for (const name of ['../elsewhere', 'a/b', '/etc', '.', '..', '', '..\\x', `${STAGING_PREFIX}x`]) {
    assert.equal(isAPlainName(name), false, `${JSON.stringify(name)} was accepted as a name`)
    assert.ok('refusal' in store.place(name), `${JSON.stringify(name)} was accepted as a place`)
  }
  const place = placeOf(crew, 'handovers')
  for (const name of ['../outside.md', 'a/b.md']) {
    assert.ok(place.keep(name, 'x') !== undefined, `${JSON.stringify(name)} was kept as a file`)
    assert.ok(place.read(name) !== undefined && 'refusal' in (place.read(name) ?? {}), `${JSON.stringify(name)} was read as a file`)
  }
  assert.deepEqual(place.names(), [], 'a refused name left a file behind')
})

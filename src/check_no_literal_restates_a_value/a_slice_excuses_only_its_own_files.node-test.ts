// A slice's coincidence file names only its own files, and an entry about another slice's file is named.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DeclaredCoincidence } from '../../prove_the_core/the_coincidences_a_slice_declares.ts'
import { entriesOutsideTheirSlice, lineOfAnEntryOutsideItsSlice } from './a_slice_excuses_only_its_own_files.ts'

const entry = (declared_in: string, file: string): DeclaredCoincidence => ({ value: 'the-tool', file, reason: 'r', declared_in, line: 3 })

test('an entry about a file of its own slice, nested or not, is held; one about another slice\'s file is named', () => {
  const own = entry('a_slice/coincidences.ts', 'a_slice/a.node-test.ts')
  const nested = entry('a_relay/coincidences.ts', 'a_relay/hooks/crew.tsx')
  const other = entry('a_slice/coincidences.ts', 'another_slice/b.ts')
  const prefix = entry('a_slice/coincidences.ts', 'a_slice_too/c.ts')

  assert.deepEqual(entriesOutsideTheirSlice([own, nested, other, prefix]), [other, prefix], 'a slice whose name only starts the same is another slice')
  assert.equal(lineOfAnEntryOutsideItsSlice(other), "a_slice/coincidences.ts:3: excuses another_slice/b.ts, which lies outside a_slice; declare it in that file's own slice")
})

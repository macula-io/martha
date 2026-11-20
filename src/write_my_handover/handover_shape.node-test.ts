import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handoverGaps, theGapLine, theShapeLine } from './handover_shape.ts'

/** The fields as the member is told them: written out here, so a renamed field fails these cases. */
const BRANCH = 'branch'
const SHA = 'sha'
const NEXT_STEP = 'next step'

const PKG = 'synthetic-owner/repo#3'
const LONGER = 'synthetic-owner/repo#37'
const TIP = 'a23988145d69ea6182800c2cf0710b30adaba83a'
const full = (named: string): string => `- ${named} · branch venus/3-a-fix · sha ${TIP} · next open the PR`

test('#999: a package the handover never names is missing every field', () => {
  assert.deepEqual(handoverGaps([PKG], 'nothing about any package'), [{ package: PKG, missing: [BRANCH, SHA, NEXT_STEP] }])
})

test('#999: a package is named exactly, so synthetic-owner/repo#3 is not answered by the synthetic-owner/repo#37 line', () => {
  assert.deepEqual(handoverGaps([PKG], full(LONGER)), [{ package: PKG, missing: [BRANCH, SHA, NEXT_STEP] }])
  assert.deepEqual(handoverGaps([PKG], `${full(PKG)}.`), [], 'a full stop after the package is punctuation, not part of the name')
})

test('#999: a line with branch, sha and next answers for its package', () => {
  assert.deepEqual(handoverGaps([PKG], full(PKG)), [])
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · branch none · sha nothing committed · next read the issue`), [], '"nothing committed" is a complete sha answer')
})

test('#999: each field the line lacks is named, and a placeholder is no answer', () => {
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · branch venus/3-a-fix · next open the PR`), [{ package: PKG, missing: [SHA] }])
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · sha ${TIP} · next open the PR`), [{ package: PKG, missing: [BRANCH] }])
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · branch venus/3-a-fix · sha ${TIP}`), [{ package: PKG, missing: [NEXT_STEP] }])
  assert.deepEqual(handoverGaps([PKG], theShapeLine(PKG)), [{ package: PKG, missing: [BRANCH, SHA, NEXT_STEP] }], 'the shape line copied as is answered')
})

test('#999: a sha field is a sha in its first word, never a word that only looks like one', () => {
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · branch venus/3-a-fix · sha ${TIP.slice(0, 8)} on main · next open the PR`), [])
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · branch venus/3-a-fix · sha later · next open the PR`), [{ package: PKG, missing: [SHA] }])
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · branch venus/sha-fix · next open the PR`), [{ package: PKG, missing: [SHA] }], 'a branch named sha-fix was read as a sha field')
})

test('#999: not mine, done, closed and landed answer for a package whole; a word inside a sentence does not', () => {
  for (const word of ['not mine', 'done', 'closed', 'landed']) assert.deepEqual(handoverGaps([PKG], `- ${PKG}: ${word}`), [], `"${word}" was not a whole answer`)
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · branch venus/3-a-fix · landed · next nothing`), [], 'a landed segment between the fields says it is finished')
  assert.deepEqual(handoverGaps([PKG], `- ${PKG} · branch venus/3-a-fix · next not landed yet`), [{ package: PKG, missing: [SHA] }])
})

test('#999: a heading that names the package does not hide the full line under it', () => {
  assert.deepEqual(handoverGaps([PKG], `## ${PKG}\n${full(PKG)}`), [])
})

test('#999: a "done" on another package\'s line says nothing of this one', () => {
  assert.deepEqual(handoverGaps([PKG, LONGER], `- ${LONGER}: done\n- ${PKG} · branch venus/3-a-fix`), [{ package: PKG, missing: [SHA, NEXT_STEP] }])
})

test('#999: a gap reads as crew-code writes it to the member', () => {
  assert.equal(theGapLine({ package: PKG, missing: [BRANCH, SHA] }), `${PKG} is missing branch, sha`)
})

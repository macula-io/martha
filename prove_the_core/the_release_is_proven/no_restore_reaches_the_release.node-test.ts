// The check that no restore of installer/ reaches a release (martha#695, T1b), and the mutants it has to catch: a
// restore planted in the workflow, the dry packer named in it, and a restore planted in a script the workflow runs --
// which is the way in that names no dry word at all, and the reason a search for words was not enough.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'

import { theGate, THE_RELEASE_WORKFLOW, theReleasePath, whatIsWrongIn } from './no_restore_reaches_the_release.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

const TOP = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * A tree of the test's own under a temporary root: each entry written at its path from the top, removed when the test
 * ends.
 */
function aTree (t: TestContext, files: Record<string, string>): string {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'martha-release-path-')))
  t.after(() => removeTheTree(top))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(top, path)), { recursive: true })
    writeFileSync(join(top, path), text)
  }
  return top
}

test('the release path on this tree runs no restore of installer/, and the actions it runs from elsewhere are named as not read', () => {
  const [code, lines] = theGate(TOP, THE_RELEASE_WORKFLOW)
  assert.equal(code, 0, lines.join('\n'))
  assert.ok(lines.some((line) => line.includes('not read') && line.includes('macula-io/macula-ci-images')), lines.join('\n'))
  const { read } = theReleasePath(TOP, THE_RELEASE_WORKFLOW)
  assert.ok(read.size > 1, 'the release path is followed past the workflow, into the scripts it runs')
})

test('a restore planted in the workflow is named, line and file', (t) => {
  const top = aTree(t, {
    [THE_RELEASE_WORKFLOW]: [
      'jobs:',
      '  pack:',
      '    steps:',
      '      - name: The installer, from its tag',
      '        run: git checkout installer-v1.1.1 -- installer',
      ''
    ].join('\n')
  })
  const [code, lines] = theGate(top, THE_RELEASE_WORKFLOW)
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(lines.some((line) => line.includes(`${THE_RELEASE_WORKFLOW}: `) && line.includes('checkout installer-v1.1.1 -- installer')), lines.join('\n'))
})

test('the dry packer named by a workflow step is named too: running it on the release path is the same leak', (t) => {
  const top = aTree(t, {
    [THE_RELEASE_WORKFLOW]: 'jobs:\n  pack:\n    steps:\n      - run: ./rehearse_a_release/place_main_as_a_dry_release/pack_main_as_a_dry_layer.sh "$SHA" out.tgz\n'
  })
  const [code, lines] = theGate(top, THE_RELEASE_WORKFLOW)
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(lines.some((line) => line.includes('pack_main_as_a_dry_layer.sh')), lines.join('\n'))
})

test('a restore planted in a script the workflow runs is found as well: that line names no dry word at all', (t) => {
  const top = aTree(t, {
    [THE_RELEASE_WORKFLOW]: 'jobs:\n  pack:\n    steps:\n      - run: ./pack_a_release/pack_a_release.sh 1.2.3 "$CTX"\n',
    'pack_a_release/pack_a_release.sh': '#!/usr/bin/env bash\ngit checkout "${INSTALLER_TAG}" -- installer\n'
  })
  const [code, lines] = theGate(top, THE_RELEASE_WORKFLOW)
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(lines.some((line) => line.includes('pack_a_release/pack_a_release.sh: ') && line.includes('installer')), lines.join('\n'))
})

test('a local action a step names is read like a script, and its own restore is found', (t) => {
  const top = aTree(t, {
    [THE_RELEASE_WORKFLOW]: 'jobs:\n  pack:\n    steps:\n      - uses: ./pack_a_release/an_action\n',
    'pack_a_release/an_action/action.yml': 'runs:\n  using: composite\n  steps:\n    - run: git restore --source=installer-v1.1.1 --staged --worktree installer\n'
  })
  const [code, lines] = theGate(top, THE_RELEASE_WORKFLOW)
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(lines.some((line) => line.includes('pack_a_release/an_action/action.yml')), lines.join('\n'))
})

test('a local reusable workflow a step calls is read like a script, and a restore inside it is found', (t) => {
  const top = aTree(t, {
    [THE_RELEASE_WORKFLOW]: 'jobs:\n  pack:\n    uses: ./.github/workflows/pack.yml\n',
    '.github/workflows/pack.yml': 'jobs:\n  pack:\n    steps:\n      - run: git checkout installer-v1.1.1 -- installer\n'
  })
  const [code, lines] = theGate(top, THE_RELEASE_WORKFLOW)
  assert.equal(code, 1, lines.join('\n'))
  assert.ok(lines.some((line) => line.includes('.github/workflows/pack.yml')), lines.join('\n'))
})

test('both forms of the restore source are read: --source, and the short -s that means the same', () => {
  assert.deepEqual(whatIsWrongIn('git restore --source=installer-v1.1.1 -- installer'), ['git restore --source=installer-v1.1.1 -- installer'])
  assert.deepEqual(whatIsWrongIn('git restore -s installer-v1.1.1 installer'), ['git restore -s installer-v1.1.1 installer'])
  assert.deepEqual(whatIsWrongIn('git restore --staged installer/package.json'), [], 'a restore from the index names no other ref')
})

test('what a line says is not what a word in a comment says: the release\'s own reads of installer.json are clean', () => {
  assert.deepEqual(whatIsWrongIn('run: echo "installer/package.json"\njq -r .martha.pinFile installer/package.json'), [])
  assert.deepEqual(whatIsWrongIn('git archive HEAD installer'), [])
})

test('a tree with no release workflow is could-not-run, never a pass', (t) => {
  const top = aTree(t, { 'a_file.txt': 'nothing\n' })
  const [code, lines] = theGate(top, THE_RELEASE_WORKFLOW)
  assert.equal(code, 2, lines.join('\n'))
})

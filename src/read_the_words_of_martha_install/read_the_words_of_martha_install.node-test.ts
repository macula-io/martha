// The words after `martha install` (martha#84, martha#21): a version, its plain switches, and its valued switches each
// with a value pass; anything else is no way the command is used.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installWordsAreAWay } from './read_the_words_of_martha_install.ts'

test('a version, --downgrade, --help, and --digest or --withdrawal-in each with its value are a way the installer is asked', () => {
  for (const words of [[], ['1.0.0'], ['1.0.0', '--downgrade'], ['-h'], ['--help'], ['1.0.0', '--digest', 'sha256:0'], ['1.0.0', '--downgrade', '--withdrawal-in', '2.1.0'], ['--withdrawal-in', '2.1.0', '1.0.0']]) {
    assert.equal(installWordsAreAWay(words), true, words.join(' '))
  }
})

test('a second version, an unknown switch, or a valued switch with no value is no way the command is used', () => {
  for (const words of [['1.0.0', '1.1.0'], ['--bogus'], ['1.0.0', '--digest'], ['1.0.0', '--withdrawal-in'], ['--latest', '1.0.0']]) {
    assert.equal(installWordsAreAWay(words), false, words.join(' '))
  }
})

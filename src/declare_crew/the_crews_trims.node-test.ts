// The four trims as the crew's own house rules (martha#1010): two numbers the crew caps, each a fixed line, with 0
// reading as "no fixed line" and `false` as the word that turns its notices off, and two switches that are on unless
// the owner says otherwise. A declaration that names none of them reads the crew as it runs today.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { OPEN_VOCABULARY, type ModelVocabulary } from './a_hosts_model_vocabulary.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, DeclarationRefused, declareCrew, soloDeclaration } from './declare_crew.ts'
import {
  A_TRIM_SWITCH_WHEN_UNNAMED,
  CREW_LINE_LINES_MOST,
  CREW_LINE_LINES_MOST_WHEN_UNNAMED,
  FAIL_ONLY_ON_HARM,
  HOUSE_RULE_TRIMS,
  MUTANTS_ON_GUARDS_ONLY,
  REVIEW_ROUNDS_MOST,
  REVIEW_ROUNDS_MOST_WHEN_UNNAMED,
  aMostIsSet,
} from './the_crews_trims.ts'

// A made-up project root: this repository is public, so no real path appears here.
const root = '/martha-project'
const declaration_path = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)

/** A host that takes any model name its provider serves, as Goose does: these cases name no model at all. */
const A_HOST_THAT_TAKES_ANY_NAME: ModelVocabulary = { kind: OPEN_VOCABULARY, names: [] }

/** The crew a declaration with these `house_rules` reads as. */
const declare = (house_rules: unknown) => {
  const { host } = hostForTests({ documents: { [declaration_path]: JSON.stringify({ ...soloDeclaration('Ann'), house_rules }) } })
  return declareCrew(host.stores.documents, root, A_HOST_THAT_TAKES_ANY_NAME)
}

/** The refusal a declaration with these `house_rules` is read as, when it is one. */
const refusedWith = async (house_rules: unknown, field: string) => {
  await assert.rejects(declare(house_rules), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused, `expected a DeclarationRefused, got ${String(error)}`)
    assert.equal(error.field, field)
    return true
  })
}

test('#1010: a declaration that names none of the four trims reads the crew as it runs today', async () => {
  const { house_rules } = await declare({})
  assert.equal(house_rules[REVIEW_ROUNDS_MOST], REVIEW_ROUNDS_MOST_WHEN_UNNAMED)
  assert.equal(house_rules[CREW_LINE_LINES_MOST], CREW_LINE_LINES_MOST_WHEN_UNNAMED)
  assert.equal(house_rules[FAIL_ONLY_ON_HARM], A_TRIM_SWITCH_WHEN_UNNAMED)
  assert.equal(house_rules[MUTANTS_ON_GUARDS_ONLY], A_TRIM_SWITCH_WHEN_UNNAMED)
})

test('#1010: a crew that names its own trims reads them back, not the defaults', async () => {
  // The values are deliberately none of the defaults: a value equal to the one it would fall back to proves nothing.
  const { house_rules } = await declare({
    [REVIEW_ROUNDS_MOST]: REVIEW_ROUNDS_MOST_WHEN_UNNAMED + 1,
    [CREW_LINE_LINES_MOST]: CREW_LINE_LINES_MOST_WHEN_UNNAMED + 4,
    [FAIL_ONLY_ON_HARM]: !A_TRIM_SWITCH_WHEN_UNNAMED,
    [MUTANTS_ON_GUARDS_ONLY]: !A_TRIM_SWITCH_WHEN_UNNAMED,
  })
  assert.equal(house_rules[REVIEW_ROUNDS_MOST], REVIEW_ROUNDS_MOST_WHEN_UNNAMED + 1)
  assert.equal(house_rules[CREW_LINE_LINES_MOST], CREW_LINE_LINES_MOST_WHEN_UNNAMED + 4)
  assert.equal(house_rules[FAIL_ONLY_ON_HARM], !A_TRIM_SWITCH_WHEN_UNNAMED)
  assert.equal(house_rules[MUTANTS_ON_GUARDS_ONLY], !A_TRIM_SWITCH_WHEN_UNNAMED)
})

test('#1010: 0 is a number with no fixed line, and false is the separate word that turns a number off', async () => {
  const { house_rules } = await declare({ [REVIEW_ROUNDS_MOST]: 0, [CREW_LINE_LINES_MOST]: false })
  assert.equal(house_rules[REVIEW_ROUNDS_MOST], 0, '0 read as anything but 0 loses the one meaning the numbers share')
  assert.equal(house_rules[CREW_LINE_LINES_MOST], false, 'false read as a number would make "off" and "no line" the same word')
  assert.equal(aMostIsSet(house_rules[REVIEW_ROUNDS_MOST]), false, '0 is no fixed line')
  assert.equal(aMostIsSet(house_rules[CREW_LINE_LINES_MOST]), false, 'false is notices off')
  assert.equal(aMostIsSet(REVIEW_ROUNDS_MOST_WHEN_UNNAMED), true, 'a whole number above zero is a fixed line')
})

test('#1010: a number that is not a whole number, zero or more, or false, is refused by its own name', async () => {
  for (const value of [1.5, -1, '2', true]) {
    await refusedWith({ [REVIEW_ROUNDS_MOST]: value }, `house_rules.${REVIEW_ROUNDS_MOST}`)
    await refusedWith({ [CREW_LINE_LINES_MOST]: value }, `house_rules.${CREW_LINE_LINES_MOST}`)
  }
})

test('#1010: a trim switch that is not true or false is refused by its own name', async () => {
  for (const value of ['yes', 1, 0]) {
    await refusedWith({ [FAIL_ONLY_ON_HARM]: value }, `house_rules.${FAIL_ONLY_ON_HARM}`)
    await refusedWith({ [MUTANTS_ON_GUARDS_ONLY]: value }, `house_rules.${MUTANTS_ON_GUARDS_ONLY}`)
  }
})

test('#1010: every house rule the trims name is one the declaration accepts', async () => {
  for (const name of HOUSE_RULE_TRIMS) {
    const { house_rules } = await declare({ [name]: name === REVIEW_ROUNDS_MOST || name === CREW_LINE_LINES_MOST ? 0 : false })
    assert.notEqual(house_rules[name], undefined, `${name} is a field the declaration takes`)
  }
})

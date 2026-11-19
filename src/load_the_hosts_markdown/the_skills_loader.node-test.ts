import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { bareModeVariableOf, hostSkillCatalogVariableOf, theDroppedVariablesHold, theSkillsLoaderHolds, theSkillsLoaderIn, type TheSkillsLoader } from './the_skills_loader.ts'

// T8 (martha#747): the recorded skills loader is held to what a launch relies on, and a host whose loader stops doing
// any of it fails by name. Every changed loader here is the committed one with one statement altered, so each case
// fails for the one reason it names.

const RECORDED: TheSkillsLoader = {
  skills_loader: RECORDED_HOST.skills_loader,
  bare_mode_test: RECORDED_HOST.bare_mode_test,
  host_skill_catalog: RECORDED_HOST.host_skill_catalog,
}

/** The name the recorded loader binds its projectSettings guard to. */
const GUARD = /[,;]([\w$]+)=[\w$]+\("projectSettings"\)&&!/.exec(RECORDED.skills_loader)?.[1] ?? ''
/** The name of the recorded bare-mode test. */
const BARE = /^function ([\w$]+)\(/.exec(RECORDED.bare_mode_test)?.[1] ?? ''

const loaderWith = (from: string, to: string): TheSkillsLoader => {
  assert.ok(RECORDED.skills_loader.includes(from), `the recorded loader holds ${from}`)
  return { ...RECORDED, skills_loader: RECORDED.skills_loader.replace(from, to) }
}

test('T8: the committed skills loader holds every read a launch relies on', () => {
  assert.ok(GUARD !== '' && BARE !== '', 'the guard and the bare-mode test are named')
  assert.doesNotThrow(() => theSkillsLoaderHolds(RECORDED))
})

test("T8: a loader that stops reading the config folder's skills under userSettings fails by name", () => {
  const changed = loaderWith('"userSettings","skills"', '"projectSettings","skills"')
  assert.throws(() => theSkillsLoaderHolds(changed), /does not read the config folder's skills under userSettings/)
})

test('T8: a loader that reads project skills outside its projectSettings guard fails by name', () => {
  const changed = loaderWith(`${GUARD}?Promise.all(`, 'Promise.all(')
  assert.throws(() => theSkillsLoaderHolds(changed), /reads project skills 2 time\(s\) outside bare mode, 1 of them under its projectSettings guard/)
})

test('T8: a loader whose bare-mode branch no longer returns before the user read fails by name', () => {
  const changed = loaderWith(`if(${BARE}())return(`, `if(${BARE}()&&0)void(`)
  assert.throws(() => theSkillsLoaderHolds(changed), /does not return on the bare-mode test before its user-scope read/)
})

test('T8: a bare-mode test of another shape fails by name, and the variable it reads is the one named', () => {
  assert.throws(() => theSkillsLoaderHolds({ ...RECORDED, bare_mode_test: `function ${BARE}(){return false}` }), /bare-mode test is not one this reads/)
  const renamed = RECORDED.bare_mode_test.replace(/process\.env\.[A-Z0-9_]+/, 'process.env.A_RENAMED_SWITCH')
  assert.equal(bareModeVariableOf(renamed), 'A_RENAMED_SWITCH')
})

test('T8: the catalog variable is read from the reader\'s own warning, and a reader the loader does not call fails', () => {
  const renamed = RECORDED.host_skill_catalog.replace(/Ignoring [A-Z0-9_]+:/, 'Ignoring A_RENAMED_CATALOG:')
  assert.equal(hostSkillCatalogVariableOf(renamed), 'A_RENAMED_CATALOG')
  const uncalled = { ...RECORDED, host_skill_catalog: RECORDED.host_skill_catalog.replace(/^function ([\w$]+)\(/, 'function Zq9(') }
  assert.throws(() => theSkillsLoaderHolds(uncalled), /does not call the recorded host skill catalog reader/)
})

test('T8: a loader whose bare-mode return comes only after its user-scope read fails by name', () => {
  const moved = loaderWith(`if(${BARE}())return(`, 'if(0)return(')
  const changed = { ...moved, skills_loader: `${moved.skills_loader.slice(0, -1)};if(${BARE}())return(0)}` }
  assert.throws(() => theSkillsLoaderHolds(changed), /does not return on the bare-mode test before its user-scope read/)
})

test('T8: a loader that keeps both guarded project reads and adds an unguarded one fails by name', () => {
  const changed = { ...RECORDED, skills_loader: `${RECORDED.skills_loader.slice(0, -1)};void ${BARE}("projectSettings")}` }
  assert.throws(() => theSkillsLoaderHolds(changed), /reads project skills 3 time\(s\) outside bare mode, 2 of them under its projectSettings guard/)
})

test("T8: the cutter passes over a function of another shape that shares the bare-mode test's minified name", () => {
  const decoy = `function ${BARE}(){return 1}`
  const text = [decoy, RECORDED.bare_mode_test, RECORDED.host_skill_catalog, RECORDED.skills_loader].join(';')
  assert.equal(theSkillsLoaderIn(text).bare_mode_test, RECORDED.bare_mode_test)
  assert.throws(() => theSkillsLoaderIn([decoy, RECORDED.host_skill_catalog, RECORDED.skills_loader].join(';')), /holds 0 of the bare-mode test, not one/)
})

test('T7, T9a: the committed recording reads the two variables a launch drops, and a host that renames either fails by name', () => {
  assert.doesNotThrow(() => theDroppedVariablesHold(RECORDED))
  const bareRenamed = { ...RECORDED, bare_mode_test: RECORDED.bare_mode_test.replace(/process\.env\.[A-Z0-9_]+/, 'process.env.A_RENAMED_SWITCH') }
  assert.throws(() => theDroppedVariablesHold(bareRenamed), /bare-mode test reads A_RENAMED_SWITCH, not /)
  const catalogRenamed = { ...RECORDED, host_skill_catalog: RECORDED.host_skill_catalog.replace(/Ignoring [A-Z0-9_]+:/, 'Ignoring A_RENAMED_CATALOG:') }
  assert.throws(() => theDroppedVariablesHold(catalogRenamed), /catalog reader reads A_RENAMED_CATALOG, not /)
})

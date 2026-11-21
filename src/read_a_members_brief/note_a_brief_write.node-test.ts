// The note after a call that wrote a brief breaking the owner-item rule (martha#999 package 2b): crew-code's
// shellBriefNote and noteShellBrief (hooks/register.tsx:4015-4050), and the file tool's write as the Supervisor's ruling
// makes it, a note after the write rather than a refusal before it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CrewPlace } from '../host_contract/host_contract.ts'
import { OTHER_HOSTS_FILE_TOOLS } from '../host_contract/tool_names_for_tests.ts'
import { theNoteAfterABriefWrite, type ACallThatMayWriteABrief } from './note_a_brief_write.ts'

/** Where the place says it is: the note reads a brief by its name alone, so no case depends on it. */
const WHERE = '/a-store/kept'
const OWNER = 'Sam'
const SHELL = 'a_shell'
/** 2026-11-20 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 20, 12)
const TODAY = 'BRIEF_2026-11-20_Vega.md'
const BROKEN = ['## Package', '- Sam wants it fast.'].join('\n')
const MARKED = ['## Package', '- synthetic-owner/repo#1: DECIDED 2026-11-20 "go".'].join('\n')

/** A briefs place over a map, as the crew's store answers. */
const aPlace = (files: Readonly<Record<string, string>>): CrewPlace => ({
  path: WHERE,
  keep: () => undefined,
  read: (name) => (name in files ? { text: files[name] ?? '' } : undefined),
  names: () => Object.keys(files),
})

let declarationsRead = 0
const aCall = (tool: string, input: Readonly<Record<string, unknown>>, files: Readonly<Record<string, string>>, rule_on = true): ACallThatMayWriteABrief => ({
  tool,
  input,
  file_tools: OTHER_HOSTS_FILE_TOOLS,
  shell_tool: SHELL,
  briefs: () => aPlace(files),
  owner_items: async () => {
    declarationsRead += 1
    return rule_on ? OWNER : undefined
  },
  now: NOW,
})

test('a shell line that appends to a brief that breaks the rule is told which lines, and that a member reads them as an IDEA', async () => {
  const note = await theNoteAfterABriefWrite(aCall(SHELL, { command: `printf '%s\\n' x >> ${WHERE}/${TODAY}` }, { [TODAY]: BROKEN }))

  assert.ok(note.startsWith('Crew: the brief this command wrote breaks the owner-item rule, so fix the file now:'), note)
  assert.ok(note.includes(`${TODAY}: these lines carry Sam's words`), note)
  assert.ok(note.includes('"line 2: Sam wants it fast."'), note)
  assert.ok(note.endsWith('Until it is fixed, a member reads an unmarked line as an IDEA.'), note)
})

test('tee and a plain > are writes too', async () => {
  for (const command of [`echo x | tee -a ${TODAY}`, `cat draft > "${TODAY}"`]) {
    assert.notEqual(await theNoteAfterABriefWrite(aCall(SHELL, { command }, { [TODAY]: BROKEN })), '', command)
  }
})

test('a brief the line only names is not its write, so it is never noted', async () => {
  assert.equal(await theNoteAfterABriefWrite(aCall(SHELL, { command: `cat ${TODAY}; grep Sam ${TODAY}` }, { [TODAY]: BROKEN })), '')
})

test('a brief that keeps the rule gets no note', async () => {
  assert.equal(await theNoteAfterABriefWrite(aCall(SHELL, { command: `echo x >> ${TODAY}` }, { [TODAY]: MARKED })), '')
})

test('a shell write counts the UTC days from two back to one ahead, and no other', async () => {
  const at = (day: string) => `BRIEF_${day}_Vega.md`
  for (const day of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) {
    assert.notEqual(await theNoteAfterABriefWrite(aCall(SHELL, { command: `echo x >> ${at(day)}` }, { [at(day)]: BROKEN })), '', day)
  }
  for (const day of ['2026-11-17', '2026-11-22']) {
    assert.equal(await theNoteAfterABriefWrite(aCall(SHELL, { command: `echo x >> ${at(day)}` }, { [at(day)]: BROKEN })), '', day)
  }
})

test("a file tool's write of a brief is read after it landed, whatever its day", async () => {
  const old = 'BRIEF_2026-10-01_Vega.md'
  const note = await theNoteAfterABriefWrite(aCall('a_writer', { a_path: `${WHERE}/${old}` }, { [old]: BROKEN }))

  assert.ok(note.includes(`${old}: these lines carry Sam's words`), note)
})

test('a file tool that writes no brief, or a tool that writes nothing, gets no note', async () => {
  assert.equal(await theNoteAfterABriefWrite(aCall('a_writer', { a_path: `${WHERE}/HANDOVER_2026-11-20_Vega.md` }, { [TODAY]: BROKEN })), '')
  assert.equal(await theNoteAfterABriefWrite(aCall('a_reader', { a_path: `${WHERE}/${TODAY}` }, { [TODAY]: BROKEN })), '')
})

test('a brief the place does not hold gets no note', async () => {
  assert.equal(await theNoteAfterABriefWrite(aCall(SHELL, { command: `echo x >> ${TODAY}` }, {})), '')
})

test('two writes of one brief in one line are noted once', async () => {
  const note = await theNoteAfterABriefWrite(aCall(SHELL, { command: `echo a >> ${TODAY}; echo b >> ${TODAY}` }, { [TODAY]: BROKEN }))

  assert.equal(note.split(`${TODAY}:`).length, 2, note)
})

test('a crew whose owner-items rule is off gets no note', async () => {
  assert.equal(await theNoteAfterABriefWrite(aCall(SHELL, { command: `echo x >> ${TODAY}` }, { [TODAY]: BROKEN }, false)), '')
})

test('a call that wrote no brief reads no declaration', async () => {
  const before = declarationsRead
  assert.equal(await theNoteAfterABriefWrite(aCall(SHELL, { command: 'echo x >> notes.md' }, { [TODAY]: BROKEN })), '')
  assert.equal(declarationsRead, before)
})

// The host writes a member's handover, never the member (martha#255).
//
// A handover is what a fresh session is handed when a member's contexts run out: what it holds, what is left, what is
// decided. If the member chose where it lives, or wrote it with its own file tool, the launcher would be trusting the
// very thing it is handing to the successor — so the host picks the path, writes the file whole, and stamps it, and a
// file the member wrote itself is not a handover and clears nothing (this is martha#16's rule 3, wired here).
//
// The slice is driven through the contract's test host, with the crew store the host really composes over a directory
// (../crew_files_directory), so what it writes is a file on a disk the way a launch writes one. The name the file has,
// and the stamp, are this slice's, and are what these cases pin.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import {
  CLAUDE_CODE_SESSION_EVENTS,
  readHandover,
  startSession,
  type HandoverStamp,
  type HandoverStampStore,
} from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { rememberSession, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { CREW_HANDOVER_WRITTEN, handoversPlace, theHandoverFile, writeMyHandover } from './write_my_handover.ts'

/** A home of the tests: the crew's own directory, as the launcher resolves one, under the state root. */
const home = mkdtempSync(join(tmpdir(), 'martha-handover-'))
after(() => rmSync(home, { recursive: true, force: true }))
const crew = join(home, 'state', 'crews', 'a-key')

const MEMBER = 'builder'
const AT = new Date('2026-11-11T15:00:00Z')
const THE_DAY = '2026-11-11'
const CONTENT = '# Handover: builder\n\n## Package lines\n\n- macula-io/martha#255, branch vesta/255-part1, nothing committed\n'

/** The contract's test host, over the crew's own store on this disk. */
const aHost = (over: string = crew): HostForTests => hostForTests({ crew: crewFilesDirectory(over) })

const sessions = (): SessionRecordStore => {
  const records = new Map<string, never>()
  return { read: (id) => records.get(id), write: (id, session) => void records.set(id, session as never) }
}

const stampStore = (): HandoverStampStore & { readonly all: Map<string, HandoverStamp> } => {
  const all = new Map<string, HandoverStamp>()
  return { all, read: (file) => all.get(file), write: (file, stamp) => void all.set(file, stamp) }
}

/** The place a crew's handovers live, once the host's store has made it. */
function thePlace(host: HostForTests): string {
  const place = handoversPlace(host.host)
  assert.ok(!('refusal' in place), `the host refused the handovers place: ${'refusal' in place ? place.refusal : ''}`)
  return place.path
}

/** The files a crew's handovers place holds, once the host's store has made it. */
function placeNames(host: HostForTests): readonly string[] {
  const place = handoversPlace(host.host)
  assert.ok(!('refusal' in place), `the host refused the handovers place: ${'refusal' in place ? place.refusal : ''}`)
  const names = place.names()
  assert.ok(!('refusal' in names), `the host could not list the handovers place: ${'refusal' in names ? names.refusal : ''}`)
  return names
}

test('#255: the host writes the handover at the path it chose, whole, and stamps it', () => {
  const host = aHost()
  const store = sessions()
  const stamps = stampStore()
  const predecessor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'old' })
  rememberSession(store, predecessor)

  const said = writeMyHandover(host.host, { member: MEMBER, content: CONTENT, at: AT, stamps, session: predecessor })

  assert.equal(said, CREW_HANDOVER_WRITTEN, 'the answer a member reads is the one word the flow waits for')
  const file = theHandoverFile(MEMBER, AT)
  assert.equal(file, `HANDOVER_${THE_DAY}_${MEMBER}.md`, 'the handover file is named for the day and the member, and by nothing the member chose')
  const written = join(thePlace(host), file)
  assert.equal(readFileSync(written, 'utf8'), CONTENT, 'the file the host wrote is not the handover it was given')
  assert.equal(statSync(written).mode & 0o777, 0o600, 'a handover is readable by this user only')
  assert.ok(stamps.read(written) !== undefined, 'the handover was written with no stamp, so the successor it is handed to could never inherit')
})

test('#255: a handover stamped by the host is one a session inherits from', () => {
  const host = aHost()
  const store = sessions()
  const stamps = stampStore()
  const colleague = 'another-member'
  const predecessor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'predecessor' })
  rememberSession(store, predecessor)
  writeMyHandover(host.host, { member: colleague, content: CONTENT, at: AT, stamps, session: predecessor })
  const reader = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'successor' })
  const after_it_read = readHandover(
    store,
    stamps,
    { member: colleague, session: reader },
    { file: join(thePlace(host), theHandoverFile(colleague, AT)), content: CONTENT },
  )
  assert.notEqual(after_it_read.record_missing, true, 'a handover the host wrote and stamped was read as lost anyway, so a refresh could never inherit')
})

test('#255: a file the member wrote itself is not a handover, and nothing is cleared for it', () => {
  const host = aHost()
  const store = sessions()
  const stamps = stampStore()
  const reader = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-member-that-wrote-its-own' })
  const its_own = join(thePlace(host), 'what-i-wrote.md')
  writeFileSync(its_own, CONTENT, { mode: 0o600 })

  assert.equal(stamps.read(its_own), undefined, 'a file the member wrote was stamped as though the host had written it')
  assert.equal(
    readHandover(store, stamps, { member: MEMBER, session: reader }, { file: its_own, content: CONTENT }).record_missing,
    true,
    'a member\'s own file was read as a handover and cleared its session, which is the trust martha#16 removed',
  )
})

// Two names the store would take are still not a member's: one that reaches out of the place, and one longer than
// MEMBER_NAME allows. So the slice's own rule is what refuses them, and the store is not the thing that decides.
test('#255: a name that is not a member\'s name is refused, and no handover is written for it', () => {
  const host = aHost()
  const store = sessions()
  const stamps = stampStore()
  const session = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-session' })
  const before = placeNames(host)
  for (const member of ['../../etc/passwd', 'a'.repeat(65)]) {
    const said = writeMyHandover(host.host, { member, content: CONTENT, at: AT, stamps, session })
    assert.notEqual(typeof said, 'string', `${member} is not a member's name, and a handover was written for it anyway`)
  }
  assert.equal(stamps.all.size, 0, 'a refused handover was stamped anyway, so a file that was never written could be inherited from')
  assert.deepEqual(placeNames(host), before, 'a handover was written outside the crew store, under a name that is not a member\'s')
})

test('#255: a crew store the host will not write into refuses the handover, and stamps nothing', () => {
  // A crew whose handovers place cannot be made: a file is already there under the place's name.
  const blocked = join(home, 'a-crew-that-cannot-write')
  mkdirSync(blocked, { recursive: true, mode: 0o700 })
  writeFileSync(join(blocked, 'handovers'), 'not a directory', { mode: 0o600 })
  const host = aHost(blocked)
  const store = sessions()
  const stamps = stampStore()
  const session = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-session' })

  const said = writeMyHandover(host.host, { member: MEMBER, content: CONTENT, at: AT, stamps, session })
  assert.ok(typeof said !== 'string' && 'refusal' in said, 'a store that could not make the place took the handover anyway')
  assert.equal(stamps.all.size, 0, 'a handover that was never written was stamped, so a successor could inherit from nothing')
})

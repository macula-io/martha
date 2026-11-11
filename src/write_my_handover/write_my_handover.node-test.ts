// The host writes a member's handover, never the member (martha#255).
//
// A handover is what a fresh session is handed when a member's contexts run out: what it holds, what is left, what is
// decided. If the member chose where it lives, or wrote it with its own file tool, the launcher would be trusting the
// very thing it is handing to the successor — so the host picks the path, writes the file whole, and stamps it, and a
// file the member wrote itself is not a handover and clears nothing (this is martha#16's rule 3, wired here).
//
// The path and the file are all this slice owns. The tool a member calls, and the flow that asks for the handover,
// come with #254 part 2.

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
import { rememberSession, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { CREW_HANDOVER_WRITTEN, handoversPlace, theHandoverFile, writeMyHandover } from './write_my_handover.ts'

/** A home of the tests: a project directory and the state root the store keeps its crews in. */
const home = mkdtempSync(join(tmpdir(), 'martha-handover-'))
after(() => rmSync(home, { recursive: true, force: true }))
const state_root = join(home, 'state')
const root = join(home, 'project')
mkdirSync(root, { recursive: true })

const MEMBER = 'builder'
const AT = new Date('2026-11-11T15:00:00Z')
const THE_DAY = '2026-11-11'
const CONTENT = '# Handover: builder\n\n## Package lines\n\n- macula-io/martha#255, branch vesta/255-part1, nothing committed\n'

const sessions = (): SessionRecordStore => {
  const records = new Map<string, never>()
  return { read: (id) => records.get(id), write: (id, session) => void records.set(id, session as never) }
}

const stampStore = (): HandoverStampStore & { readonly all: Map<string, HandoverStamp> } => {
  const all = new Map<string, HandoverStamp>()
  return { all, read: (file) => all.get(file), write: (file, stamp) => void all.set(file, stamp) }
}

/** The place a crew's handovers live, once the store has made it. */
function thePlace(): string {
  const place = handoversPlace(state_root, root)
  assert.ok(!('refusal' in place), `the store refused the handovers place: ${'refusal' in place ? place.refusal : ''}`)
  return place.path
}

test('#255: the host writes the handover at the path it chose, whole, and stamps it', () => {
  const store = sessions()
  const stamps = stampStore()
  const predecessor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'old' })
  rememberSession(store, predecessor)

  const said = writeMyHandover({ state_root, root, member: MEMBER, content: CONTENT, at: AT, stamps, session: predecessor })

  assert.equal(said, CREW_HANDOVER_WRITTEN, 'the answer a member reads is the one word the flow waits for')
  const file = theHandoverFile(MEMBER, AT)
  assert.equal(file, `HANDOVER_${THE_DAY}_${MEMBER}.md`, 'the handover file is named for the day and the member, and by nothing the member chose')
  const written = join(thePlace(), file)
  assert.equal(readFileSync(written, 'utf8'), CONTENT, 'the file the host wrote is not the handover it was given')
  assert.equal(statSync(written).mode & 0o777, 0o600, 'a handover is readable by this user only')
  assert.ok(stamps.read(written) !== undefined, 'the handover was written with no stamp, so the successor it is handed to could never inherit')
})

test('#255: a handover stamped by the host is one a session inherits from', () => {
  const store = sessions()
  const stamps = stampStore()
  const colleague = 'another-member'
  const predecessor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'predecessor' })
  rememberSession(store, predecessor)
  writeMyHandover({ state_root, root, member: colleague, content: CONTENT, at: AT, stamps, session: predecessor })
  const reader = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'successor' })
  const after_it_read = readHandover(
    store,
    stamps,
    { member: colleague, session: reader },
    { file: join(thePlace(), theHandoverFile(colleague, AT)), content: CONTENT },
  )
  assert.notEqual(after_it_read.record_missing, true, 'a handover the host wrote and stamped was read as lost anyway, so a refresh could never inherit')
})

test('#255: a file the member wrote itself is not a handover, and nothing is cleared for it', () => {
  const store = sessions()
  const stamps = stampStore()
  const reader = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-member-that-wrote-its-own' })
  const its_own = join(thePlace(), 'what-i-wrote.md')
  writeFileSync(its_own, CONTENT, { mode: 0o600 })

  assert.equal(stamps.read(its_own), undefined, 'a file the member wrote was stamped as though the host had written it')
  assert.equal(
    readHandover(store, stamps, { member: MEMBER, session: reader }, { file: its_own, content: CONTENT }).record_missing,
    true,
    'a member\'s own file was read as a handover and cleared its session, which is the trust martha#16 removed',
  )
})

test('#255: a name that is not a member\'s name is refused, and no handover is written for it', () => {
  const store = sessions()
  const stamps = stampStore()
  const session = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-session' })
  const said = writeMyHandover({ state_root, root, member: '../../etc/passwd', content: CONTENT, at: AT, stamps, session })
  assert.notEqual(typeof said, 'string', 'a name that is not a member\'s name was taken, and a handover would be written outside the crew store')
  assert.equal(stamps.all.size, 0, 'a refused handover was stamped anyway, so a file that was never written could be inherited from')
})

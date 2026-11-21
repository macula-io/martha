// The relay asks the crew's reviewer-model rule about a tool call, beside the gate and never inside it (martha#315).
//
// Nothing else proves the relay ever asks. The rule is well tested on its own (../run_reviews_on_the_review_model),
// and the one relay-level stub answers none for every call, so a relay that stopped asking — or that asked before the
// gate instead of after it — would leave every test green. These two hold each half: a call the crew refuses is denied
// with the crew's own reason and takes no signed-run receipt, and a call the gate refuses is denied by the gate even
// though the crew refuses it too.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { holdingTheEnds } from '../end_a_running_turn/hold_the_end.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_SHELL_TOOL, CLAUDE_CODE_SUBAGENT_SPAWN, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { sourcesALaunchHandsTheModel } from '../install_the_mesh_server_for_claude_code/what_a_launch_hands_the_model.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { WHO_DECIDES_REACH, MESH_TOOLS_THAT_WIDEN_REACH } from '../refuse_widening_a_member_reach/refuse_widening_a_member_reach.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { memberRelay, type MemberRelay, type RelayReply } from './answer_the_relay.ts'
import { THE_GUARD_ASK_UNREADABLE } from '../guard_the_git_a_member_runs/judge_a_guards_question.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { CLAUDE_CODE, CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { BILLED_BY_API_KEY } from '../declare_crew/declare_crew.ts'
import { ARTIFACT_TOOLS, theArtifactRefusal } from '../launch_a_claude_code_member/the_artifacts_a_key_cannot_open.ts'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

const SESSION = 'the-session'

/**
 * The reason this crew gives for a call it does not run. What these tests read is that the relay hands the crew's own
 * reason on, and how it stands against the gate's — not the wording of the rule, which has its own tests.
 */
const A_REFUSED_REVIEW = 'Not run: this crew holds its reviews to the model its owner declared.'

/** The reason this crew gives a shell line the workspace guard refuses (martha#562, seam a), in its own words. */
const A_REFUSED_GIT_CALL = 'Not run: this call would move a clone off its default branch.'

/** One member's places under a directory the test removes. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-315-review-relay-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(rows, { mode: 0o700 })
  return { home, checkout, rows }
}

const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, CLAUDE_FOLDER, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/**
 * A crew that refuses every call it is asked about, so what a test reads is the relay's own order: a real crew refuses
 * only a review, and a call it would not refuse is one these tests do not need.
 */
function aCrewRefusingEverything(asked: string[], git_asked: string[] = [], path_asked: { directory: string; args: readonly string[] }[] = [], refs_asked: string[] = []): CrewTools {
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    theContractInForce: async () => undefined,
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => null,
    theCrewStateOfATurn: async () => null,
    noteTheStart: () => undefined,
    ends: holdingTheEnds(),
    thePredecessorOf: async () => null,
    theSpendInForce: async () => undefined,
    noteTheCallCounted: async () => undefined,
    theReviewModelOfTheCall: async () => null,
    theReviewModel: async () => null,
    // This crew hears no menu close, which is what the ask queue reads a settle on (martha#313).
    noteTheCallsAnswer: () => undefined,
    refusesTheSubagent: async (call) => {
      if (!CLAUDE_CODE_SUBAGENT_SPAWN.tools.includes(call.tool)) return undefined
      asked.push(call.tool)
      return A_REFUSED_REVIEW
    },
    refusesTheGitIn: async (call) => {
      if (call.tool !== CLAUDE_CODE_SHELL_TOOL) return undefined
      git_asked.push(String(call.input['command'] ?? ''))
      return A_REFUSED_GIT_CALL
    },
    // The two seams that reach git without a tool call (martha#562): the shim on the member's PATH, and the clone's
    // ref transaction. This crew refuses a call in another member's branch, as the real one does.
    refusesTheGitOnThePath: async (call) => {
      path_asked.push({ directory: call.directory, args: call.args })
      return call.args.includes('uranus/9') ? A_REFUSED_GIT_CALL : undefined
    },
    refusesTheRefUpdate: (updates) => {
      const deletes = updates.filter((update) => update.deletes).map((update) => update.ref)
      refs_asked.push(...deletes)
      return deletes.some((ref) => ref.endsWith('/uranus/9')) ? A_REFUSED_GIT_CALL : undefined
    },
  }
}

/** The receipts the launcher takes for a call that will run: a denied call may leave none. */
function theReceiptsTaken(allowed: string[]): SignedRuns {
  return {
    callAllowed: (tool) => void allowed.push(tool),
    callAnswered: () => undefined,
    run: async () => ({ refused: 'this test runs no signed shape' }),
  }
}

/** The relay for one member, over a crew's own tools and the receipts a call would take. */
function relayFor(places: Places, crew: CrewTools | undefined, signed_runs: SignedRuns, refusesACallItsBillingCannotRun?: (tool: string) => string | undefined): MemberRelay {
  return memberRelay({
    ...(refusesACallItsBillingCannotRun === undefined ? {} : { refusesACallItsBillingCannotRun }),
    records: sessionRecordsIn(rowStreamsDirectory(places.rows)),
    launch: { host: CLAUDE_CODE, launch_dir: places.checkout, stop_dir: places.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(places.home, CLAUDE_FOLDER, USER_SETTINGS_FILE),
      home: places.home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(places.home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({
      launcher_env: { HOME: places.home },
      member_env: { HOME: places.home },
      home: places.home,
      launch_dir: places.checkout,
      settings_files: [],
      user_scope: userScopeFor(places.home),
    }),
    ...(crew === undefined ? {} : { crew }),
    signed_runs,
    stopMember: () => {},
  })
}

/** A started session, on a relay: the first thing every tool call is answered against. */
async function startedOn(relay: MemberRelay): Promise<void> {
  const reply = await relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.equal(reply.answered, true, 'the session was not started, so no call could be judged')
}

const call = (tool: string, more: Readonly<Record<string, unknown>> = {}) => ({ session_id: SESSION, call: { tool, tool_use_id: `toolu_${tool}`, ...more } })

const denied = (why: string): RelayReply => ({ answered: true, body: { deny: why } })

/** What the relay answered, and everything written to the process's own error output while it did (martha#601). */
async function theNoticeWhile<T>(act: () => Promise<T>): Promise<{ readonly answer: T; readonly notice: string }> {
  const written: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    return { answer: await act(), notice: written.join('') }
  } finally {
    process.stderr.write = original
  }
}

test('#315: the relay denies a call the crew refuses, with the crew\'s own reason, and takes no signed-run receipt', async (t) => {
  const places = placesOf(t)
  const asked: string[] = []
  const allowed: string[] = []
  const relay = relayFor(places, aCrewRefusingEverything(asked), theReceiptsTaken(allowed))
  await startedOn(relay)

  const review = call(CLAUDE_CODE_SUBAGENT_SPAWN.tools[0]!, { [CLAUDE_CODE_SUBAGENT_SPAWN.type_field]: 'Explore', [CLAUDE_CODE_SUBAGENT_SPAWN.description_field]: 'review the patch' })
  assert.deepEqual(await relay.answer('tool_called', review), denied(A_REFUSED_REVIEW), 'the call the gate allows and the crew refuses was not denied with the crew\'s reason')
  assert.deepEqual(asked, [CLAUDE_CODE_SUBAGENT_SPAWN.tools[0]!], 'the relay never asked the crew about the call it judged')
  assert.deepEqual(allowed, [], 'a receipt was taken for a call that never ran')
})

test('#562: the relay asks the crew what the workspace guard refuses of a shell call, and denies it with that reason', async (t) => {
  const places = placesOf(t)
  const asked: string[] = []
  const git_asked: string[] = []
  const allowed: string[] = []
  const relay = relayFor(places, aCrewRefusingEverything(asked, git_asked), theReceiptsTaken(allowed))
  await startedOn(relay)

  const line = 'git checkout main'
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: line })), denied(A_REFUSED_GIT_CALL), 'a shell call the guard refuses was not denied with the guard\'s reason')
  assert.deepEqual(git_asked, [line], 'the relay never handed the shell line to the crew\'s guard')
  assert.deepEqual(asked, [], 'the reviewer rule answered for a call that is no review')
  assert.deepEqual(allowed, [], 'a receipt was taken for a call that never ran')
})

test('#315: the reach rule is one notice and the gate\'s own answer comes first, so the crew\'s rule is never asked about a call it refuses', async (t) => {
  const places = placesOf(t)
  const asked: string[] = []
  const allowed: string[] = []
  const relay = relayFor(places, aCrewRefusingEverything(asked), theReceiptsTaken(allowed))
  await startedOn(relay)

  const widening = MESH_TOOLS_THAT_WIDEN_REACH[0]!
  const { answer, notice } = await theNoticeWhile(() => relay.answer('tool_called', call(widening)))
  // The reach rule is the owner's to decide (martha#601): one line, and the call goes on to the rule that still refuses it.
  assert.match(notice, new RegExp(`${widening} is not called in a member's session, and the call was answered as asked`), 'the reach notice was not said')
  assert.ok(notice.includes(WHO_DECIDES_REACH), 'the notice did not say who decides')
  assert.deepEqual(
    answer,
    denied(`${widening} hands this session other agents' text that no gate has seen, so it is not called at all. Read a room through its gate instead: it returns only what the room admits.`),
    'the call did not go on to the gate\'s own answer',
  )
  assert.deepEqual(asked, [], 'the crew\'s review rule was asked about a call the gate refuses, so it sits before the gate rather than beside it')
  assert.deepEqual(allowed, [], 'a receipt was taken for a call that never ran')
})

test('#562: the git on the member\'s PATH is answered with the crew\'s verdict, and a crew that guards nothing is answered with a yes', async (t) => {
  const places = placesOf(t)
  const path_asked: { directory: string; args: readonly string[] }[] = []
  const relay = relayFor(places, aCrewRefusingEverything([], [], path_asked), theReceiptsTaken([]))

  assert.deepEqual(
    await relay.judgeAGitCall({ cwd: places.checkout, args: ['branch', '-D', 'uranus/9'] }),
    { verdict: { deny: A_REFUSED_GIT_CALL } },
    "the shim's question was not answered with the crew's own reason",
  )
  assert.deepEqual(path_asked, [{ directory: places.checkout, args: ['branch', '-D', 'uranus/9'] }], "the relay never handed the call to the crew's guard")
  assert.deepEqual(await relay.judgeAGitCall({ cwd: places.checkout, args: ['status'] }), { verdict: { allow: 1 } }, 'a call the crew allows was not allowed')
  // A question this launcher cannot read is refused rather than answered with a yes: the shim fails open on it and
  // writes the miss down, so a body that is not the shim's never runs as an allowed call.
  assert.deepEqual(await relay.judgeAGitCall({ cwd: 'not/absolute', args: ['branch', '-D', 'uranus/9'] }), { refused: THE_GUARD_ASK_UNREADABLE })
  assert.deepEqual(await relay.judgeAGitCall({ cwd: places.checkout, args: [1] }), { refused: THE_GUARD_ASK_UNREADABLE })

  // A launch the crew handed no guard at all, which is a crew that declared no workspace layout: nothing is refused.
  const unguarded = relayFor(places, undefined, theReceiptsTaken([]))
  assert.deepEqual(await unguarded.judgeAGitCall({ cwd: places.checkout, args: ['branch', '-D', 'uranus/9'] }), { verdict: { allow: 1 } })
})

test('#562: the clone\'s ref transaction is answered with the crew\'s verdict, and the refs it names are the question', async (t) => {
  const places = placesOf(t)
  const refs_asked: string[] = []
  const relay = relayFor(places, aCrewRefusingEverything([], [], [], refs_asked), theReceiptsTaken([]))

  assert.deepEqual(
    await relay.judgeARefTransaction({ updates: [{ ref: 'refs/heads/uranus/9', deletes: true }] }),
    { verdict: { deny: A_REFUSED_GIT_CALL } },
    "the hook's question was not answered with the crew's own reason",
  )
  assert.deepEqual(refs_asked, ['refs/heads/uranus/9'], 'the relay never handed the refs to the crew\'s guard')
  assert.deepEqual(await relay.judgeARefTransaction({ updates: [{ ref: 'refs/heads/hygiea/562', deletes: true }] }), { verdict: { allow: 1 } })
  assert.deepEqual(await relay.judgeARefTransaction({ updates: [{ ref: 'refs/heads/uranus/9' }] }), { refused: THE_GUARD_ASK_UNREADABLE })
  assert.deepEqual(await relay.judgeARefTransaction({}), { refused: THE_GUARD_ASK_UNREADABLE })
})

test('#957 gap 13: the relay denies an Artifact call its member\'s billing cannot run, with the launch\'s words, before the crew is asked, and takes no receipt (mutant: the relay not handing the place on)', async (t) => {
  const places = placesOf(t)
  const asked: string[] = []
  const allowed: string[] = []
  const relay = relayFor(places, aCrewRefusingEverything(asked), theReceiptsTaken(allowed), (tool) => theArtifactRefusal(BILLED_BY_API_KEY, tool))
  await startedOn(relay)

  const tool = ARTIFACT_TOOLS[0]!
  assert.deepEqual(await relay.answer('tool_called', call(tool)), denied(theArtifactRefusal(BILLED_BY_API_KEY, tool)!), 'the Artifact call was not denied with the launch\'s words')
  assert.deepEqual(asked, [], 'the crew was asked about a call the billing refuses first')
  assert.deepEqual(allowed, [], 'a receipt was taken for a call that never ran')
})

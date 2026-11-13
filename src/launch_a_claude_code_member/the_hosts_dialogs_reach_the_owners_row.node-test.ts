// What the host is asking the owner reaches the member's row through the relay, and only what the launcher took in
// moves it (martha#313).
//
// The relay posts each dialog the host raises and each check it runs about a call; the launcher reads them with
// ../hear_the_hosts_dialogs and hands them to the owner's screen. What is pinned here is the seam between the two: the
// body the host sends is the one the screen hears, a check is kept so the permission about the same call is keyed by
// it, the call's own answer closes what it raised, a dialog this launcher cannot read moves nothing, and a prompt the
// launcher refused raises no turn of its own — a refusal is not a turn, so it cannot clear a dialog the owner has not
// answered. The events are fed in the order the host really sends them (probed on 2.1.323): a call is posted, checked
// and asked about in that order, and the row stays "needs you" until the call is answered.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_SHELL_TOOL, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OWNERS_MARKDOWN, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { MANAGED_MARKDOWN_FOLDER } from '../claude_code_host/hooks_and_plugins_the_owner_declares.ts'
import { USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { checkedBody, dialogBody } from '../claude_code_relay/hooks/relay_protocol.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { turnsRaised } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import { ELICITATION, NOTIFICATION, PERMISSION_REQUEST } from '../hear_the_hosts_dialogs/hear_the_hosts_dialogs.ts'
import { theOwnersScreen } from '../say_what_the_host_is_asking/the_owners_screen.ts'
import { whatTheOwnerIsShown } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { IDLE, type DashboardRow, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { memberRelay, type MemberRelay, type RelayReply } from './answer_the_relay.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { removeTheTree } from './relay_copy.ts'

const MEMBER = 'Vesta'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

/** One member's places under a directory the test removes. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-313-dialogs-'))
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
  reported_output_styles_dir: join(home, MANAGED_MARKDOWN_FOLDER, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** A store that keeps one member's row in memory. */
function aStore(): DashboardStore & { readonly kept: DashboardRow[] } {
  const kept: DashboardRow[] = []
  let row: DashboardRow | null = null
  return {
    kept,
    read: () => row,
    change: (_member, change) => {
      const next = change(row)
      if (next === null) return { kept: false, why: 'the change kept nothing' }
      row = next
      kept.push(next)
      return { kept: true }
    },
    all: () => (row === null ? {} : { [row.member]: row }),
  }
}

/** The body of a reply that answered rather than stopped the member. */
function theBodyOf(reply: RelayReply): Readonly<Record<string, unknown>> {
  assert.ok(reply.answered, 'the launcher answered the event rather than stopping the member')
  return reply.body as Readonly<Record<string, unknown>>
}

/** The row the store holds, which a write in these tests always left there. */
function theRowOn(store: DashboardStore): DashboardRow {
  const row = store.read(MEMBER)
  assert.ok(row !== null, 'the store holds a row')
  return row
}

/** The relay for one member, keeping the owner's screen over `store` and writing no bell. */
function relayFor(places: Places, store: DashboardStore, wrote: string[]): MemberRelay {
  return memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(places.rows)),
    launch: { host: CLAUDE_CODE, launch_dir: places.checkout, stop_dir: places.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(places.home, MANAGED_MARKDOWN_FOLDER, USER_SETTINGS_FILE),
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
    turns: turnsRaised(),
    screen: theOwnersScreen({ beats: store, member: MEMBER, bells: { bell: true, notify: false }, onTheOwnersTerminal: true, write: (bytes) => void wrote.push(bytes) }),
    stopMember: () => {},
  })
}

/** Starts one session on the relay, as the host's SessionStart hook does. */
async function startedSession(relay: MemberRelay, session_id: string): Promise<void> {
  const started = await relay.answer('session_started', { session_id, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.deepEqual(theBodyOf(started), { taken: 1 })
}

/** A permission dialog the host posted for `session`, with the payload it really raises (probed on 2.1.323). */
const permission = (tool_name: string, tool_input: Record<string, unknown>) =>
  dialogBody('session-a', PERMISSION_REQUEST, { hook_event_name: 'PermissionRequest', session_id: 'session-a', tool_name, tool_input })

test('#313: a permission the host posts moves the member\'s row to needs you, and the launcher took it in', async (t) => {
  const places = placesOf(t)
  const store = aStore()
  const wrote: string[] = []
  const relay = relayFor(places, store, wrote)
  await startedSession(relay, 'session-a')

  const answered = await relay.answer('owner_dialog', permission(CLAUDE_CODE_SHELL_TOOL, { command: 'rm -rf build' }))

  assert.deepEqual(theBodyOf(answered), { taken: 1 })
  const row = store.read(MEMBER)
  assert.ok(row !== null)
  assert.equal(row.session, 'session-a')
  assert.deepEqual(whatTheOwnerIsShown(row), { state: 'needs-you', needs: 'permission for Bash' })
  assert.equal(wrote.length, 1, 'the bell is the row\'s change, rung once')
})

test('#313: the host posts the call, checks it, asks, and the call\'s answer closes the dialog, in that order (r=2 R1)', async (t) => {
  const places = placesOf(t)
  const store = aStore()
  const relay = relayFor(places, store, [])
  await startedSession(relay, 'session-a')
  const call = { tool: CLAUDE_CODE_SHELL_TOOL, tool_use_id: 'toolu_probe_1', command: 'touch made.txt' }

  // The order the host really sends on 2.1.323, measured with prove_the_relay_loads/prove_the_order_of_the_dialogs.mjs:
  // tool.call, then tool.check, then the PermissionRequest, the owner's answer, and the call's own answer after it ran.
  await relay.answer('tool_called', { session_id: 'session-a', call })
  assert.equal(store.read(MEMBER)?.dialogs, undefined, 'a call the host posted has raised nothing: the owner is not asked yet')

  const checked = await relay.answer('tool_checked', checkedBody('session-a', { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'touch made.txt' }, tool_use_id: 'toolu_probe_1', approver: 'the owner' }))
  assert.deepEqual(theBodyOf(checked), { taken: 1 })
  await relay.answer('owner_dialog', permission(CLAUDE_CODE_SHELL_TOOL, { command: 'touch made.txt' }))
  assert.equal(store.read(MEMBER)?.dialogs?.[0]?.key, 'permission:toolu_probe_1', 'the permission is keyed by the id the check taught the launcher')
  assert.deepEqual(whatTheOwnerIsShown(theRowOn(store)), { state: 'needs-you', needs: 'permission for Bash' })

  // The owner allowed it, and the call answered under the id the check taught the launcher: that answer is the close.
  await relay.answer('tool_answered', { session_id: 'session-a', call, answer: { stdout: '', stderr: '', interrupted: false } })

  const row = store.read(MEMBER)
  assert.ok(row !== null)
  assert.equal(row.dialogs, undefined, 'the call\'s answer closed the dialog the check named')
  assert.deepEqual(whatTheOwnerIsShown(row), { state: IDLE, needs: '' })
})

test('#313: a dialog this launcher does not read is refused, and the row does not move', async (t) => {
  const places = placesOf(t)
  const store = aStore()
  const relay = relayFor(places, store, [])
  await startedSession(relay, 'session-a')

  const notADialog = await relay.answer('owner_dialog', dialogBody('session-a', 'classic.PermissionDenied', { tool_name: CLAUDE_CODE_SHELL_TOOL }))
  assert.equal(typeof theBodyOf(notADialog)['refused'], 'string')
  const noCall = await relay.answer('tool_checked', checkedBody('session-a', { input: { command: 'ls' }, tool_use_id: 'toolu_1' }))
  assert.equal(typeof theBodyOf(noCall)['refused'], 'string')

  assert.deepEqual(store.kept, [], 'a dialog nothing can be said about writes no row')
})

test('#313: a prompt the launcher refused raises no turn, so a dialog the owner has not answered stays open', async (t) => {
  const places = placesOf(t)
  const store = aStore()
  const relay = relayFor(places, store, [])
  await startedSession(relay, 'session-a')
  await relay.answer('owner_dialog', permission(CLAUDE_CODE_SHELL_TOOL, { command: 'rm -rf build' }))

  // A prompt for a session this launcher never took a start of is refused, so it is not a turn.
  const refused = await relay.answer('prompt_submitted', { session_id: 'never-started', text: 'go on', origin: { kind: 'composer' } })
  assert.notEqual(theBodyOf(refused)['refused'], undefined)
  assert.deepEqual(whatTheOwnerIsShown(theRowOn(store)), { state: 'needs-you', needs: 'permission for Bash' })

  // The prompt the host really took in is a turn, and it drops the dialog the earlier turn left open.
  await relay.answer('prompt_submitted', { session_id: 'session-a', text: 'go on', origin: { kind: 'composer' } })
  assert.deepEqual(whatTheOwnerIsShown(theRowOn(store)), { state: IDLE, needs: '' }, 'the member has reported nothing, so the row is the one its own silence leaves')
})

test('#313: an elicitation and a notification the host posts move the row in the host\'s own event', async (t) => {
  const places = placesOf(t)
  const store = aStore()
  const relay = relayFor(places, store, [])
  await startedSession(relay, 'session-a')

  await relay.answer('owner_dialog', dialogBody('session-a', ELICITATION, { mcp_server_name: 'mesh', message: 'Which realm?' }))
  assert.deepEqual(whatTheOwnerIsShown(theRowOn(store)), { state: 'needs-you', needs: 'mesh asks: Which realm?' })

  await relay.answer('prompt_submitted', { session_id: 'session-a', text: 'go on', origin: { kind: 'composer' } })
  // `auth_success` is the host's own event and its own dialog says it, so it is not the owner's to be rung about.
  const wrote = store.kept.length
  await relay.answer('owner_dialog', dialogBody('session-a', NOTIFICATION, { notification_type: 'auth_success', message: 'Signed in' }))
  assert.equal(store.kept.length, wrote, 'a notification whose own event already says it writes no row')
  assert.deepEqual(whatTheOwnerIsShown(theRowOn(store)), { state: IDLE, needs: '' })
})

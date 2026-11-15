// The host's own answer about what it loads, asked before any member runs: its command resolved once to the file it
// runs, that file proven to load the launch's copy of the relay rather than the installed folder (martha#117), the
// output-styles folder its own session init reports (martha#154), and the rules that keep a member out of the owner's
// memory, which the host is asked to confirm its file permission checks can match before a member starts on them
// (martha#226). A question to the host is asked with every hook off, so asking starts nothing of the owner's
// (martha#154 r=2).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CLAUDE_CODE_HOOK_SWITCHES } from '../claude_code_host/recorded_claude_code_host.ts'
import { hostLinesNamingARule, memoryDenyRules, settingsWithMemoryDenied, type OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import type { PreparedLaunch } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { NOT_STARTED } from '../end_a_launch/end_a_launch.ts'
import { hostVersionLine, outputStylesDirTheHostReports, refusalToLoadTheRelay, resolvedHostCommand, whatTheHostSaysWithTheseSettings } from './host_runs_the_relay.ts'
import type { ClaudeCodeMemberLaunch, ReadyLaunch } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'

/** The installed relay plugin's folder, which each launch copies; the host is given the copy (../serve_the_relay_to_a_launch/relay_copy.ts). */
export const RELAY_PLUGIN_DIR = fileURLToPath(new URL('../claude_code_relay', import.meta.url))

/**
 * Step 2d: the host's own answer about the rules that keep a member out of the owner's memory (martha#226). The host
 * says in its own words which rules its file permission checks never match: on the terminal at a session's start, and
 * on the standard error of a run that is not a terminal, which is how it is asked here. One line naming a rule this
 * launch wrote refuses the launch -- the rule closes nothing on that host, and the gate's own refusal of a file tool's
 * call is not the layer the host was given -- and the refusal repeats the host's line, so the owner reads what the host
 * said rather than this launcher's reading of it.
 */
export async function rulesTheHostMatches(
  launch: ClaudeCodeMemberLaunch,
  ready: ReadyLaunch,
  binary: string,
  ownerMemory: OwnerMemoryPlaces,
): Promise<string | undefined> {
  const rules = memoryDenyRules(ownerMemory)
  const asked = initQuestionSettings(ready.prepared, RULE_CHECK_SETTINGS, rules)
  if ('refusal' in asked) return asked.refusal
  const printed = await whatTheHostSaysWithTheseSettings(binary, ready.prepared.switches.args, asked.path, ready.hostEnv, launch.place.launch_dir)
  if ('failure' in printed) {
    return `the host could not be asked whether its file permission checks match the rules that keep a member out of the owner's memory (${printed.failure}), and a member is not started on rules it was not told it honours (martha#226)`
  }
  const named = hostLinesNamingARule(`${printed.stdout}\n${printed.stderr}`, rules)
  if (named.length === 0) return undefined
  const which = named.length === 1 ? 'a rule that keeps' : `${named.length} rules that keep`
  return `the host says ${which} a member out of the owner's memory can never match, so a member is not started with that place open: ${named.join(' | ')} (martha#226)`
}

/** The settings file the session-init question is asked with: hooks off, and nothing else (martha#154 r=2). */
const INIT_QUESTION_SETTINGS = 'martha-init-question.json'

/** The settings file the host's own answer about the launch's rules is asked with (martha#226). */
const RULE_CHECK_SETTINGS = 'martha-rules-the-host-must-honour.json'

/**
 * The settings file that turns every hook off for a question to the host, by the key the recording names (martha#154
 * r=2), with `rules` added to its `permissions.deny`; or why the question cannot be asked safely. A question that reads
 * the owner's settings can run their hooks, and a hook runs whatever it names, with the launcher's environment and
 * before the launch placed anything; asked with this file, the question still reads those settings -- the `env` block
 * that may move the config dir included -- and runs no hook of theirs. Deny rules start nothing, so the rules the
 * launch adds ride the same file (martha#226).
 */
function initQuestionSettings(
  prepared: Extract<PreparedLaunch, { readonly allow: true }>,
  name: string = INIT_QUESTION_SETTINGS,
  rules: readonly string[] = [],
): { readonly path: string } | { readonly refusal: string } {
  const keys = CLAUDE_CODE_HOOK_SWITCHES.every_source
  if (keys.length === 0) {
    return { refusal: 'the recording names no key that turns every hook off from any settings file, so the session-init question cannot be asked without running the owner\'s hooks (martha#154)' }
  }
  const hooksOff = JSON.stringify(Object.fromEntries(keys.map((key) => [key, true])))
  // A question about the styles asks with hooks off and nothing else; one about the rules carries them too.
  const settings = rules.length === 0 ? { text: hooksOff } : settingsWithMemoryDenied(hooksOff, rules, name)
  if ('refusal' in settings) return settings
  const path = join(prepared.snapshot_dir, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, settings.text)
  return { path }
}

/**
 * Step 2b: the file the host's command resolves to, which must load the launch's copy of the relay, and the folder
 * it reports for the owner's user output styles (martha#154); or the refusal. A host of another version than the
 * recording is told to the owner and refuses nothing (host_runs_the_relay.ts).
 */
export async function hostThatRunsTheRelay(
  launch: ClaudeCodeMemberLaunch,
  ready: ReadyLaunch,
  pluginDir: string,
): Promise<{ readonly binary: string; readonly reported_output_styles_dir: string } | string> {
  const cwd = launch.place.launch_dir
  const resolved = resolvedHostCommand(launch.command, ready.hostEnv.PATH, cwd)
  if ('refusal' in resolved) return `${NOT_STARTED}: ${resolved.refusal}`
  const env = ready.hostEnv
  // The folder the member's host will load: the launch's copy, never the installed relay (martha#117).
  const refused = await refusalToLoadTheRelay(resolved.binary, pluginDir, env, cwd, RELAY_PLUGIN_DIR)
  if (refused !== undefined) return `${NOT_STARTED}: ${refused}`
  const drift = await hostVersionLine(resolved.binary, env, cwd)
  if (drift !== undefined) launch.tellOwner(drift)
  // The styles folder the member's own session reports, asked with the switches its host starts on so the settings
  // env blocks that move it are applied -- and with no server named and hooks off, so the question starts nothing
  // (martha#154 r=2).
  const hooksOff = initQuestionSettings(ready.prepared)
  if ('refusal' in hooksOff) return `${NOT_STARTED}: ${hooksOff.refusal}`
  const reported = await outputStylesDirTheHostReports(resolved.binary, ready.prepared.switches.args, hooksOff.path, env, cwd)
  if ('refusal' in reported) return `${NOT_STARTED}: ${reported.refusal}`
  return { binary: resolved.binary, reported_output_styles_dir: reported.dir }
}

// The launch probe's rows about the owner's hooks (martha#443): the user settings' hooks and plugins,
// the keys that turn every hook off, and the spellings of the key `hooks` in an agent's frontmatter.

import { dirname, join } from 'node:path'

import { HOOKS_SPELLINGS, PLUGIN_DIRS_VARIABLE } from '../claude_code_host/hooks_and_plugins_the_owner_declares.ts'
import { CLAUDE_CODE_HOOK_SWITCHES } from '../claude_code_host/recorded_claude_code_host.ts'
import {
  claude,
  claudeAsTheAgent,
  HEADLESS_CLAUDE,
  ownerSettingsPath,
  PROMPT,
  put,
  type OwnerMarkdownFile,
  type Place,
  type Probe,
} from '../declare_a_launch_probe/declare_a_launch_probe.ts'
import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'

// --- the owner's user hooks and plugins (martha#121, finding 1) ---------------
//
// A member's host loads the owner's user settings, with --setting-sources user.
// Run ungated, each of these shows that a hook or plugin there runs in a session
// started on Martha's switches; gated, that the launcher's gate refuses it and
// nothing starts. The config folder holds no login, so the host stops before
// any model call, after its SessionStart hooks ran.

const touchAtStart = (marker: string) => ({ SessionStart: [{ hooks: [{ type: 'command', command: `touch ${marker}` }] }] })
const ownerHook = (place: Place) => JSON.stringify({ hooks: touchAtStart(place.marker('OWNER_HOOK')) })

/** A plugin folder whose one hook marks PLUGIN_HOOK when a session starts. */
function pluginFolder(place: Place): string {
  const folder = join(place.scratch, 'probe-plugin')
  put(folder, join('.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'probe-plugin', version: '0.0.1' }))
  put(folder, join('hooks', 'hooks.json'), JSON.stringify({ hooks: touchAtStart(place.marker('PLUGIN_HOOK')) }))
  return folder
}
const pluginInOwnerSettings = (place: Place) => JSON.stringify({ env: { [PLUGIN_DIRS_VARIABLE]: pluginFolder(place) } })

// --- the settings that turn every hook off (martha#122) -----------------------
//
// The keys are never typed here: they come from the recorded host's own hook-set function, so a re-recording that
// renames one changes what this plants, and a recording that names none fails the run rather than probing nothing.
// One pair of rows for EACH key the recording names, because a re-recording can add a second way to turn every hook
// off, and a pair written for the first alone would leave the new one probing nothing while the run stayed green:
//   - the key BESIDE a SessionStart hook, on the switches alone: the hook that would mark OWNER_HOOK does not run,
//     which is what shows the key really is a switch on this host. The row also claims the host exited cleanly, since
//     its evidence is an absence: a host that quit on the file would look exactly like one that ran and dropped it;
//   - the key ALONE in the owner's user settings, gated: with no hook in the file, the switch is the only reason
//     the launcher has to refuse, so the refusal is that gate's and not another one's.

/** Every key the recorded host tests as `=== true` to drop every hook, whichever settings file sets it. */
const HOOK_KILLING_KEYS: readonly string[] = CLAUDE_CODE_HOOK_SWITCHES.every_source
/** A recording that names no key: the run fails rather than quietly probing fewer rows. */
export const SWITCHES_WITHOUT_A_PROBE = HOOK_KILLING_KEYS.length === 0 ? ['a key that turns every hook off, in any settings file'] : []

/** The owner's user settings with a SessionStart hook and one of those keys beside it: the hook that would mark OWNER_HOOK. */
const ownerHookAndSwitch = (place: Place, key: string) =>
  JSON.stringify({ hooks: touchAtStart(place.marker('OWNER_HOOK')), [key]: true })

export const OWNER_PROBES: readonly Probe[] = [false, true].flatMap((gated): Probe[] => {
  const as = gated ? 'as martha start starts it, its settings gate included' : 'on the switches alone, its settings gate skipped'
  const refused = (marker: string) => (gated ? { [marker]: false, GATE_REFUSED: true } : { [marker]: true })
  const common = { host: CLAUDE_CODE as typeof CLAUDE_CODE, command: claude(...HEADLESS_CLAUDE, PROMPT), approved: () => {}, planted: () => {}, planned: true }
  return [
    {
      ...common,
      what: `Claude Code ${as}: a SessionStart hook in the owner's user settings`,
      owner_settings: ownerHook,
      expected: refused('OWNER_HOOK'),
      ...(gated ? { gate_names: (place: Place) => [ownerSettingsPath(place), 'SessionStart'] } : {}),
    },
    {
      ...common,
      what: `Claude Code ${as}: a plugin folder in the owner's user settings env`,
      owner_settings: pluginInOwnerSettings,
      expected: refused('PLUGIN_HOOK'),
      ...(gated ? { gate_names: (place: Place) => [ownerSettingsPath(place), PLUGIN_DIRS_VARIABLE] } : {}),
    },
    ...(gated
      ? []
      : HOOK_KILLING_KEYS.map((key): Probe => ({
          ...common,
          what: `Claude Code ${as}: ${key}, which turns every hook off, beside a hook in the owner's user settings`,
          owner_settings: (place: Place) => ownerHookAndSwitch(place, key),
          expected: { OWNER_HOOK: false },
          host_ok: true,
        }))),
  ]
})

/** Each key alone, gated: no hook in the file, so the only reason the launcher has to refuse is the key itself. */
export const SWITCH_PROBES: readonly Probe[] = HOOK_KILLING_KEYS.map((key): Probe => ({
  what: `Claude Code as martha start starts it: ${key} alone in the owner's user settings, with no hook beside it`,
  host: CLAUDE_CODE,
  command: claude(...HEADLESS_CLAUDE, PROMPT),
  approved: () => {},
  planted: () => {},
  planned: true,
  owner_settings: () => JSON.stringify({ [key]: true }),
  expected: { GATE_REFUSED: true },
  gate_names: (place: Place) => [ownerSettingsPath(place), key],
}))

// --- the owner's own agents, skills and commands (martha#146) ----------------
//
// A member's host is started with --setting-sources user, so it reads the
// owner's user scope, and an agent, skill or command there can carry hooks in
// its frontmatter. A member that runs one gets those hooks for as long as it
// runs, and what they print reaches the member with no row recording it. Gated,
// the launcher refuses before the host starts, naming the file and the spelling
// of the key it found. One row per spelling, because each is a different way
// YAML writes the one key the host looks for, and a spelling that stopped being
// caught would be a row that stopped refusing.

/**
 * The frontmatters that spell the key `hooks` by one rule alone, keyed by the
 * words its refusal names it by. A rule may have more than one: a rule that
 * takes a class has more than one member, and each member is its own row
 * (martha#243).
 */
const SPELLED_AS: Readonly<Record<string, readonly string[]>> = {
  'the key hooks': ['!<tag:yaml.org,2002:str>"hooks": {PreToolUse: []}'],
  'a collection used as a key': ['[hooks]: {PreToolUse: []}'],
  'a backslash outside a double-quoted value': [
    '"hoo\\x6bs": {}',
    '&x: "hoo\\x6bs": {PreToolUse: []}',
    '!x: "hoo\\x6bs": {PreToolUse: []}',
  ],
  'an explicit key (?)': ['? name2\n: x'],
  'a merge key (<<)': ['<<: {}'],
  'an alias used as a key': ['a: &k other\n*k : {}'],
}

/** A spelling rule with no frontmatter here: the run fails rather than quietly probing fewer rows. */
export const SPELLINGS_WITHOUT_A_PROBE = HOOKS_SPELLINGS.map(({ rule }) => rule).filter((rule) => (SPELLED_AS[rule] ?? []).length === 0)

export const MARKDOWN_HOOK_PROBES: readonly Probe[] = HOOKS_SPELLINGS.flatMap(({ rule }, ruleAt) =>
  (SPELLED_AS[rule] ?? []).map((spelling, at) => {
    const name = `spelling-${ruleAt}-${at}.md`
    return {
      what: `Claude Code as martha start starts it: a user-scope agent whose frontmatter spells the hooks key as ${rule}, spelling ${at + 1}`,
      host: CLAUDE_CODE,
      command: claude(...HEADLESS_CLAUDE, PROMPT),
      approved: () => {},
      planted: () => {},
      planned: true,
      owner_settings: () => JSON.stringify({}),
      owner_markdown: (): readonly OwnerMarkdownFile[] => [
        {
          folder: 'agents',
          name,
          text: `---\nname: spelling-${ruleAt}-${at}\ndescription: a probe agent\n${spelling}\n---\n${PROMPT}\n`,
        },
      ],
      expected: { GATE_REFUSED: true },
      gate_names: (place: Place) => [join(dirname(ownerSettingsPath(place)), 'agents', name), rule],
    }
  }),
)

// --- the two spellings the launcher passes, asked of the host (martha#174) ---
//
// The gate refuses a frontmatter holding one of HOOKS_SPELLINGS. It passes two
// other spellings YAML has for the key `hooks` — both named in #146's r=2 review
// — and that review had no way to ask the host what it makes of them. These rows
// ask it: each plants one as a user-scope agent, starts the host as that agent,
// and reads the one marker the agent's own SessionStart and UserPromptSubmit
// hooks touch. The premise they rest on is HOOKS_SPELLINGS as it stands: a rule
// that starts refusing either one leaves the row's own answer unchanged.
//
// The control writes the key as `hooks`, so a run in which the host ran no
// agent's own hooks at all cannot pass for one in which it does not read a
// spelling: nothing here is proved by an absence alone. These rows take Martha's
// switches alone, with the launcher's settings gate skipped, because that gate
// refuses the control: `martha start` would not start any of the three. The
// config folder holds no login, so the host stops before any model call, after
// the hooks an agent file declares before the turn have run.
//
// What 2.1.319 answers: a binary-tagged scalar used as the key is not the key
// `hooks` — the host names the frontmatter key it read as the base64 text — and
// a flow sequence key whose colon the next line opens does not parse at all
// ("YAML Parse error: Multiline implicit key"), so the file is ignored and there
// is no agent by that name to start. Neither one runs a hook. A host upgrade
// that starts reading either fails its row.

/** A user-scope agent whose frontmatter writes the key `hooks` one way, with hooks that mark that they ran. */
function hostKeyAgent(place: Place, name: string, keyLine: (value: string) => string): OwnerMarkdownFile {
  const hook = (event: string) => `${event}: [{hooks: [{type: command, command: "touch ${place.marker('AGENT_HOOK')}"}]}]`
  return {
    folder: 'agents',
    name: `${name}.md`,
    text: `---\nname: ${name}\ndescription: a probe agent\n${keyLine(`{${hook('SessionStart')}, ${hook('UserPromptSubmit')}}`)}\n---\n${PROMPT}\n`,
  }
}

/** The control, and the two spellings the launcher passes, each with what the host does with it: whether its hooks run, and whether there is an agent by that name. */
const HOST_KEY_CASES: ReadonlyArray<{
  readonly what: string
  readonly name: string
  readonly keyLine: (value: string) => string
  readonly expected: Readonly<Record<string, boolean>>
  /** A SessionStart hook in the owner's user settings, which proves the host ran while this agent's own hooks did not (martha#188). */
  readonly owner_hook?: true
}> = [
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key as `hooks` (the control for the two below)',
    name: 'hooks-key-control',
    keyLine: (value) => `hooks: ${value}`,
    expected: { AGENT_HOOK: true, AGENT_NOT_FOUND: false },
  },
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key as a binary-tagged scalar',
    name: 'hooks-key-binary-tagged',
    keyLine: (value) => `!!binary aG9va3M=: ${value}`,
    // Both its own claims are absences, so the row also plants a SessionStart hook in the owner's user settings: that
    // marker is the host reaching the session, and without it a host that quit on the agent file would pass (martha#188).
    owner_hook: true,
    expected: { OWNER_HOOK: true, AGENT_HOOK: false, AGENT_NOT_FOUND: false },
  },
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key as a flow sequence with a comment before its colon',
    name: 'hooks-key-commented',
    keyLine: (value) => `[hooks] # c\n: ${value}`,
    expected: { AGENT_HOOK: false, AGENT_NOT_FOUND: true },
  },
  // The two spellings that made the narrowed scan enter a value where a key opens: an anchor and a local tag ending in
  // a colon. Each runs, so the gate's refusal of them is warranted, and a host that stopped reading one fails its row
  // (martha#243).
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key behind an anchor ending in a colon',
    name: 'hooks-key-anchored',
    keyLine: (value) => `&x: "hoo\\x6bs": ${value}`,
    expected: { AGENT_HOOK: true, AGENT_NOT_FOUND: false },
  },
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key behind a local tag ending in a colon',
    name: 'hooks-key-tagged',
    keyLine: (value) => `!x: "hoo\\x6bs": ${value}`,
    expected: { AGENT_HOOK: true, AGENT_NOT_FOUND: false },
  },
]

export const HOST_KEY_PROBES: readonly Probe[] = HOST_KEY_CASES.map((one) => ({
  what: one.what,
  host: CLAUDE_CODE,
  command: claudeAsTheAgent(one.name, ...HEADLESS_CLAUDE),
  approved: () => {},
  planted: () => {},
  planned: true,
  owner_settings: (place: Place) => JSON.stringify(one.owner_hook === true ? { hooks: touchAtStart(place.marker('OWNER_HOOK')) } : {}),
  owner_markdown: (place: Place): readonly OwnerMarkdownFile[] => [hostKeyAgent(place, one.name, one.keyLine)],
  expected: one.expected,
}))

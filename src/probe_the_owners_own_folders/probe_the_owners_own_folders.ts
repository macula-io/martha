// The launch probe's rows about the owner's own folders (martha#443): the skills trash, the skills the
// host syncs from the owner's account, and a write into each folder the host loads the owner's text from.

import { dirname, join } from 'node:path'

import { CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { memoryDenyRules, ownerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { claude, HEADLESS_CLAUDE, ownerSettingsPath, PROMPT, type OwnerMarkdownFile, type Place, type Probe } from '../declare_a_launch_probe/declare_a_launch_probe.ts'
import { deniedWriteIn } from './the_write_the_host_was_refused.ts'
import { skillsListedIn } from './the_skills_the_host_listed.ts'
import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { TRASH_FOLDER } from '../claude_code_host/hooks_and_plugins_the_owner_declares.ts'

// --- the trash, and the skills the host syncs from the owner's account (martha#243) ---
//
// Two places under the owner's skills folder are read as the host reads them. The
// trash: the host loads a SKILL.md directly in `skills/.trash` — as the skill
// `.trash` — and loads nothing below an entry in it, so the gate must read the
// same depth (measured on 2.1.322, and on this host's init event: `.trash` is
// listed, `inner/` is not). And the synced folder: a skill the host writes again
// from the owner's account at every start, which the gate judges like any other
// until the owner or the admin turns that sync off with `syncClaudeAiSkills:
// false`, a setting the host reads as `=== false` from any source.

const TRASH_TOP = 'trash-top'
const TRASH_BELOW = 'trash-below'

export const TRASH_PROBE: Probe = {
  what: 'Claude Code as martha start starts it: the skill files under the owner skills folder, the one the host loads at the top of the trash and the one below an entry it does not',
  host: CLAUDE_CODE,
  command: (switches) => ({
    command: 'claude',
    args: ['-p', '--model', 'haiku', '--output-format', 'stream-json', '--verbose', PROMPT, ...switches.args],
  }),
  approved: () => {},
  planted: () => {},
  planned: true,
  owner_settings: () => JSON.stringify({}),
  owner_markdown: (): readonly OwnerMarkdownFile[] => [
    { folder: 'skills/.trash', name: 'SKILL.md', text: `---\nname: ${TRASH_TOP}\ndescription: a probe skill\n---\n${PROMPT}\n` },
    { folder: 'skills/.trash/entry', name: 'SKILL.md', text: `---\nname: ${TRASH_BELOW}\ndescription: a probe skill\n---\n${PROMPT}\n` },
  ],
  from_output: (_place: Place, printed: string) => {
    const listed = skillsListedIn(printed)
    return { TRASH_TOP_LISTED: listed.includes(TRASH_FOLDER), TRASH_BELOW_LISTED: listed.includes('entry') }
  },
  expected: { TRASH_TOP_LISTED: true, TRASH_BELOW_LISTED: false },
}

/** Two skills a signed-in host serves, as the clean-install run met them: one backslash each, inside a quoted description, and no hook. */
const SERVED_SKILLS: readonly OwnerMarkdownFile[] = [
  {
    folder: 'skills/synced/acct-1/google-workspace',
    name: 'SKILL.md',
    text: '---\nname: google-workspace\ndescription: "Read this before the first Google Drive call. Use it to change a Google Doc, even \\"change it\\" or \\"add a tab\\"."\n---\nBody.\n',
  },
  {
    folder: 'skills/synced/acct-1/xlsx',
    name: 'SKILL.md',
    text: '---\nname: xlsx\ndescription: "Use this any time a spreadsheet is the input, by name or path \\u{2014} even casually."\n---\nBody.\n',
  },
]

/** The same skills, with one of them really declaring a hook. */
const HOOKED_SYNCED: readonly OwnerMarkdownFile[] = SERVED_SKILLS.map((file, at) =>
  at === 1 ? { ...file, text: `---\nname: xlsx\ndescription: a skill\nhooks:\n  PreToolUse: []\n---\nBody.\n` } : file,
)

/** The synced folder's own paths, as the gate names them in a refusal. */
const syncedPathsOf = (place: Place, files: readonly OwnerMarkdownFile[]): readonly string[] =>
  files.map((file) => join(dirname(ownerSettingsPath(place)), file.folder, file.name))

export const SYNCED_PROBES: readonly Probe[] = [
  {
    what: 'Claude Code as martha start starts it: two skills the host syncs from the owner account, each holding a backslash in a quoted description and no hook (martha#243)',
    host: CLAUDE_CODE,
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: () => {},
    planted: () => {},
    planned: true,
    owner_settings: () => JSON.stringify({}),
    owner_markdown: (): readonly OwnerMarkdownFile[] => SERVED_SKILLS,
    expected: { GATE_PASSED: true },
    gate_names: (place: Place) => syncedPathsOf(place, SERVED_SKILLS),
  },
  {
    what: 'Claude Code as martha start starts it: a synced skill whose frontmatter really declares a hook is refused, naming the file and the rule (martha#243)',
    host: CLAUDE_CODE,
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: () => {},
    planted: () => {},
    planned: true,
    owner_settings: () => JSON.stringify({}),
    owner_markdown: (): readonly OwnerMarkdownFile[] => HOOKED_SYNCED,
    expected: { GATE_REFUSED: true },
    gate_names: (place: Place) => [syncedPathsOf(place, HOOKED_SYNCED)[1] ?? '', 'the key hooks'],
  },
  {
    what: "Claude Code as martha start starts it: the same synced skill with `syncClaudeAiSkills: false` in the owner's settings, which the host reads as off, so the gate lets the start through (martha#243)",
    host: CLAUDE_CODE,
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: () => {},
    planted: () => {},
    planned: true,
    owner_settings: () => JSON.stringify({ syncClaudeAiSkills: false }),
    owner_markdown: (): readonly OwnerMarkdownFile[] => HOOKED_SYNCED,
    expected: { GATE_PASSED: true },
    gate_names: (place: Place) => syncedPathsOf(place, HOOKED_SYNCED),
  },
]

// --- the folders the host loads the owner's own text from (martha#154) -------
//
// The gate's own rules, `memoryDenyRules(ownerMemoryPlaces(...))` (the same call the launcher makes), go into the
// settings the host reads, and each row has the host attempt the very write those rules name, in every folder the
// recorded host loads the owner's user scope from. By hand the same write lands, so the pair shows the rules the launch
// carries are what refused it, not a host that never tried.
//
// The write is asked for with `--permission-mode acceptEdits` and the config folder added, on both runs: without them
// the host asks the owner for a folder outside the checkout and never attempts the write, and the row would show only
// that nothing was asked.

/** The config folder each run writes into: the probe's own, named as the owner's by CLAUDE_CONFIG_DIR. */
const userScopeConfig = (place: Place) => dirname(ownerSettingsPath(place))

/** The places the gate denies, from the call the launcher makes, over this run's own config folder. */
const userScopePlaces = (place: Place) => {
  const config = userScopeConfig(place)
  return ownerMemoryPlaces({
    launcher_env: { HOME: place.scratch, CLAUDE_CONFIG_DIR: config },
    member_env: { HOME: place.scratch },
    home: place.scratch,
    launch_dir: place.checkout,
    settings_files: [],
    user_scope: {
      markdown_kinds: RECORDED_HOST.markdown_kinds,
      output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
      reported_output_styles_dir: join(config, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
    },
  })
}

/** Every folder under the config dir the host loads the owner's text from, by the recording's names and the field's. */
const OWNER_SCOPE_FOLDERS: readonly string[] = [...RECORDED_HOST.markdown_kinds, CLAUDE_CODE_OUTPUT_STYLES_FOLDER]

export const OWNER_SCOPE_PROBES: readonly Probe[] = OWNER_SCOPE_FOLDERS.flatMap((folder) =>
  [false, true].map((gated): Probe => {
    const target = (place: Place) => join(userScopeConfig(place), folder, 'probe-note.md')
    return {
      what: `Claude Code ${gated ? 'as martha start starts it, the permission rules the launch carries in the settings it reads' : 'by hand, with none of the launch\'s rules'}: a write into the ${folder} folder of the owner's config dir (martha#154)`,
      host: CLAUDE_CODE,
      command: (switches, place) => ({
        command: 'claude',
        args: [
          '-p',
          // Room for a turn that does not reach the Write (martha#223): a model that spends
          // both turns elsewhere exits non-zero, and this row's host_ok reads that as the
          // launch having failed rather than as the write never being tried.
          '--max-turns',
          '4',
          '--model',
          'haiku',
          '--permission-mode',
          'acceptEdits',
          '--output-format',
          'json',
          `--add-dir=${userScopeConfig(place)}`,
          `Use the Write tool to create the file ${target(place)} with the single line: probe. Do nothing else.`,
          ...switches.args,
        ],
      }),
      approved: () => {},
      planted: () => {},
      planned: gated,
      owner_settings: (place) => (gated ? JSON.stringify({ permissions: { deny: memoryDenyRules(userScopePlaces(place)) } }) : JSON.stringify({})),
      markerAt: target,
      // A refused write is the row's claim, and it takes the host itself to have run: a gate refusal, a crash or a
      // model that did nothing is a failure, not "not started, as claimed" (martha#154 r=2).
      ...(gated ? { host_ok: true as const, from_output: (place: Place, printed: string) => ({ OWNER_SCOPE_WRITE_DENIED: deniedWriteIn(printed, target(place)) }) } : {}),
      expected: { OWNER_SCOPE_FILE: !gated, ...(gated ? { OWNER_SCOPE_WRITE_DENIED: true } : {}) },
    }
  }),
)

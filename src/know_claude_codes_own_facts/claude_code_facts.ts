// Claude Code's own facts: the names, variables and switches the host itself reads, which Martha only repeats.
//
// A leaf: it imports nothing, so no import of it can close a cycle, and the next fact about Claude Code goes here
// rather than wherever a cycle happens to allow (martha#474). The tables that act on these facts, such as the
// launch rows in refuse_launch_of_unapproved_config, read them from here.

/** Claude Code's name as a host: its key in the launch tables, and the host the launcher starts. */
export const CLAUDE_CODE = 'claude-code' as const

/**
 * The command an install puts on the owner's path, which a launch of this host starts and a start of a member looks
 * for there (martha#541): the one spelling of it, so no call site writes the name a second time.
 */
export const CLAUDE = 'claude'

/** What an owner installs to have that command: the host's own install line, said by a start that cannot find it. */
export const CLAUDE_INSTALL = `Claude Code, with npm install -g @anthropic-ai/${CLAUDE_CODE}`

/**
 * The folder Claude Code keeps its own files in, under what holds them: the home when CLAUDE_CONFIG_DIR says nothing, a
 * project, and the managed folder, whose markdown folders the recorded loader joins under it.
 */
export const CLAUDE_FOLDER = '.claude'

/** The variable that moves the folder of every project's memory under another root. */
export const REMOTE_MEMORY_ROOT = 'CLAUDE_CODE_REMOTE_MEMORY_DIR'

/** The variable that names one folder memory is read from and written to instead. */
export const MEMORY_FOLDER_OVERRIDE = 'CLAUDE_COWORK_MEMORY_PATH_OVERRIDE'

/** The switch that names a file of tool servers for the host to start. The init question is asked without it. */
export const MCP_CONFIG_SWITCH = '--mcp-config'

/**
 * The variable Claude Code reads to keep its own auto-updater off, and the value that does it, are recorded facts now and
 * not restated here (martha#460, martha#637): the recorder cuts both from the host's binary and a launch takes them from
 * the recording (./the_recorded_auto_updater_switch.ts). See there for why a launch switches the updater off at all.
 */

/**
 * The variable that turns Claude Code's auto-memory off, and the value that does it (martha#136). Turns it off in the
 * host's own file mode: the host then loads no memory folder into a member's session and runs no memory pass of its own.
 * Set by the launcher, so an inherited 0, which beats a settings file's off, never reaches the member (Claude Code
 * 2.1.318 and 2.1.319, measured). It is a fact about the host rather than a launch decision, so it lives here and the
 * recorder reads the guard by it (../record_claude_code_host/what_the_hosts_guards_call.ts, martha#637).
 */
export const CLAUDE_MEMORY_OFF: Readonly<Record<string, string>> = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }

/** The folder under the owner's skills folder that Claude Code fills from their Claude account (martha#243). */
export const SYNCED_SKILLS_FOLDER = 'synced'

/** The kind of the owner's markdown the host syncs into: the recording names it, and a test fails if it stops. */
export const SKILLS_KIND = 'skills'

/** The folder the host moves skills it no longer runs into. It loads a SKILL.md directly in it, and nothing below an entry (martha#243). */
export const TRASH_FOLDER = '.trash'

/**
 * The variable that puts the host in bare mode (martha#747): a member in bare mode would load none of the skills its
 * launch copies, and none of its gate's hooks, so a launch drops it. The recorded bare-mode test is checked to read
 * this one (../load_the_hosts_markdown/the_skills_loader.ts), so a host that renames it fails by name.
 */
export const CLAUDE_CODE_BARE_MODE_VARIABLE = 'CLAUDE_CODE_SIMPLE'

/**
 * The variable that names the host's skill catalog mount (martha#747): no approval reads that mount, so a launch drops
 * it. The recorded catalog reader's own warning is checked to name this one, as above.
 */
export const CLAUDE_CODE_HOST_SKILL_CATALOG_VARIABLE = 'CLAUDE_CODE_HOST_SKILL_CATALOG'

/** The skills folder of a Claude Code checkout, as the gate lists it and the approval names its files (martha#747). */
export const CLAUDE_SKILLS = `${CLAUDE_FOLDER}/${SKILLS_KIND}`

/**
 * The folder names a checkout's skill may not take (martha#747): `synced`, which the host's skills loader reserves for
 * the account's synced skills, and `.trash`, which Martha's own scan of a member's skills reads by the markdown loader's
 * rules. A copied skill under either would be read differently from the way the owner approved it.
 */
export const RESERVED_SKILL_NAMES: readonly string[] = [SYNCED_SKILLS_FOLDER, TRASH_FOLDER]

/**
 * The variables that bring skills in that no approval read, which a launch drops (martha#747): bare mode, in which the
 * host loads none of the skills a launch copies and reads added folders' skills unguarded, and the host skill catalog,
 * a mount of skills named by an inherited variable.
 */
export const CLAUDE_SKILLS_ELSEWHERE: readonly string[] = [CLAUDE_CODE_BARE_MODE_VARIABLE, CLAUDE_CODE_HOST_SKILL_CATALOG_VARIABLE]

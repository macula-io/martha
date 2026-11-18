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
export const CLAUDE_INSTALL = 'Claude Code, with npm install -g @anthropic-ai/claude-code'

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
 * The variable Claude Code reads to keep its own auto-updater off, and the value that does it (martha#460).
 *
 * A launch hands the host a home of its own, so the host starts with the updater's default, which is on: the owner's
 * own answer lives in the owner's `~/.claude.json`, which a run never reads. A host older than the registry's latest
 * then updates itself, and its update is `npm install --global`, which npm resolves against the NODE prefix and not
 * against HOME. So an install meant for the sandbox lands on the owner's real machine, over whichever Claude Code the
 * owner has there, and npm's own log for it names the owner's global `claude` among the paths it retires (measured on
 * the crew host: 2.1.323 updating to 2.1.325). What it leaves cannot run: the updater's own npm environment carries
 * `npm_config_ignore_scripts=true`, so the package's postinstall never copies the native binary over `bin/claude.exe`
 * and the tarball's stub is what stays.
 */
export const CLAUDE_AUTO_UPDATER_OFF: Readonly<Record<string, string>> = { DISABLE_AUTOUPDATER: '1' }

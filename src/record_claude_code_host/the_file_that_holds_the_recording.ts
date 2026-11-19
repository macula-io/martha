// Where the recording of the Claude Code host lives, in a module that imports nothing: the installer's tests read
// this path, and the installer job installs no typescript, which the recorder's compare needs (martha#811).

/** The file that holds the recording: written by the recorder, printed by the README's Install block (martha#541 package 11). */
export const RECORDING_OF_THE_HOST = new URL('../claude_code_host/recorded_claude_code_host.json', import.meta.url)

// Claude Code's own tool that sends a message to another session (martha#980).
//
// It stands in a file of its own, as ./claude_code_file_tools.ts does, so the core's answer to a tool call can name it
// without importing the host's adapter, which imports that answer.

/** The tool a Claude Code session sends another session a message with. */
export const CLAUDE_CODE_SEND_MESSAGE_TOOL = 'SendMessage'

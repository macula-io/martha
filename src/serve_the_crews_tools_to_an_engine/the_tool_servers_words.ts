// What the crew's tool server and the launch that writes its entry say to each other (martha#541, packages 7-8 part
// C, C1).
//
// This exists so both ends read one set of names: the extension key the engine knows the server by, and the variable
// that hands the server its launch's token. The token itself, its header and how it is compared, are the relay's
// (../serve_the_relay_to_a_launch/the_launchs_token.ts), since the relay is the door it opens.

/** The key the server's entry sits under in the engine's `extensions`, and the name the engine gives it. */
export const THE_CREWS_TOOL_SERVER = 'martha_crew'

/** The variable that hands the server this launch's token. */
export const THE_TOKEN_VARIABLE = 'MARTHA_TOOL_SERVER_TOKEN'

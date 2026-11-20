// A line the owner types at a martha-engine member's tab (martha#927 part 2): `/crew` answered as a Claude Code member's
// `/crew` is, any other command refused, a plain line refused, and nothing asked of the launcher that was not needed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CREW_USAGE, THE_CREW_COMMAND, theCrewCommandAnswers, type Heard } from '../claude_code_relay/hooks/crew_command.ts'
import { SAY_TO_THE_CREW_TOOL } from '../send_a_crew_message/say_to_the_crew_tool.ts'
import { SEE_THE_CREW_TOOL } from '../see_the_crew/the_see_the_crew_tool.ts'
import { seeTheCrew, thePaneAnsweredBy } from '../see_the_crew/see_the_crew.ts'
import { ONLY_THE_CREW_COMMAND, TYPED_TURNS_ARE_NOT_THERE_YET, whatTheOwnersLineGets } from './the_owners_lines_at_the_tab.ts'

/** The launcher's pane answer for a crew of two that have reported nothing, as the launcher hands it over. */
const thePane = thePaneAnsweredBy(seeTheCrew({ members: [{ name: 'Pallas' }, { name: 'Vesta' }] }, {}, 1_000), false, 1_000)

/** A receipt the launcher could give a send. */
const A_RECEIPT = 'sent as message 7 to Vesta.'

/** A launcher that records what it was asked and answers each tool from a table. */
function aLauncher(answers: Readonly<Record<string, Heard>>): { readonly asked: { tool: string; args: Readonly<Record<string, unknown>> }[]; hear: (tool: string, args: Readonly<Record<string, unknown>>) => Promise<Heard> } {
  const asked: { tool: string; args: Readonly<Record<string, unknown>> }[] = []
  return {
    asked,
    hear: async (tool, args) => {
      asked.push({ tool, args })
      return answers[tool] ?? { why: `nothing answers ${tool}` }
    },
  }
}

/** A launcher that answers both of `/crew`'s tools. */
const aCrewsLauncher = (): ReturnType<typeof aLauncher> =>
  aLauncher({ [SEE_THE_CREW_TOOL.name]: { said: JSON.stringify(thePane) }, [SAY_TO_THE_CREW_TOOL.name]: { said: A_RECEIPT } })

test('#927 part 2 DW3: /crew at an engine tab prints what a Claude Code member\'s /crew prints, from the same launcher answer', async () => {
  const launcher = aCrewsLauncher()
  const printed = await whatTheOwnersLineGets(`  ${THE_CREW_COMMAND}  `, launcher.hear)
  assert.equal(printed, await theCrewCommandAnswers('', aCrewsLauncher().hear), 'the engine tab prints what the Claude Code tab prints')
  assert.equal(printed, [thePane.header, ...thePane.lines].join('\n'))
  assert.deepEqual(launcher.asked, [{ tool: SEE_THE_CREW_TOOL.name, args: {} }])
})

test('#927 part 2 DW3: /crew <member> <text> at an engine tab is said to that member, the text as typed, and the receipt printed', async () => {
  const launcher = aCrewsLauncher()
  const printed = await whatTheOwnersLineGets(`${THE_CREW_COMMAND} Vesta take the  review`, launcher.hear)
  const [to, text] = SAY_TO_THE_CREW_TOOL.inputSchema.required
  assert.ok(to !== undefined && text !== undefined)
  assert.deepEqual(launcher.asked, [{ tool: SAY_TO_THE_CREW_TOOL.name, args: { [to]: ['Vesta'], [text]: 'take the  review' } }])
  assert.equal(printed, A_RECEIPT)
})

test('#927 part 2: /crew <member> with nothing to say prints the usage and asks nothing', async () => {
  const launcher = aCrewsLauncher()
  assert.equal(await whatTheOwnersLineGets(`${THE_CREW_COMMAND} Vesta`, launcher.hear), CREW_USAGE)
  assert.deepEqual(launcher.asked, [])
})

test('#927 part 2 DW4: any other command is refused in one line naming it, and the launcher is asked nothing', async () => {
  const launcher = aCrewsLauncher()
  // `/crewx` is another command: the command is the line's whole first word.
  for (const [typed, command] of [['/compact', '/compact'], ['/goal now', '/goal'], [`${THE_CREW_COMMAND}x Vesta hi`, `${THE_CREW_COMMAND}x`]] as const) {
    const told = await whatTheOwnersLineGets(typed, launcher.hear)
    assert.equal(told, ONLY_THE_CREW_COMMAND(command), `${typed} is not refused by its own name`)
    assert.ok(told !== null && !told.includes('\n'), 'the refusal is one line')
  }
  assert.deepEqual(launcher.asked, [])
})

test('#927 part 2: a plain line is refused in one line naming /crew and martha#953, and the launcher is asked nothing', async () => {
  const launcher = aCrewsLauncher()
  const told = await whatTheOwnersLineGets('please review the PR', launcher.hear)
  assert.equal(told, TYPED_TURNS_ARE_NOT_THERE_YET)
  assert.ok(!TYPED_TURNS_ARE_NOT_THERE_YET.includes('\n') && TYPED_TURNS_ARE_NOT_THERE_YET.includes(THE_CREW_COMMAND) && TYPED_TURNS_ARE_NOT_THERE_YET.includes('martha#953'))
  assert.equal(await whatTheOwnersLineGets('   ', launcher.hear), null, 'an empty line is told nothing')
  assert.deepEqual(launcher.asked, [])
})

test('#927 part 2: a /crew the launcher refuses prints the refusal as worded', async () => {
  const refusal = '"Ceres" is not a member of this crew. The crew is Pallas, Vesta. Nothing was sent.'
  const launcher = aLauncher({ [SAY_TO_THE_CREW_TOOL.name]: { why: refusal } })
  assert.equal(await whatTheOwnersLineGets(`${THE_CREW_COMMAND} Ceres hello`, launcher.hear), refusal)
})

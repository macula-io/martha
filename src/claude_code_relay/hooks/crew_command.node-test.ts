// `/crew` asks the launcher what the model would ask it, and prints what it answers (martha#927).
//
// The mod cannot import the core, so the tool names and argument names it asks under are its own copies. These tests
// hold them to the launcher's own tool records, and feed the command the launcher's real pane answer, so a renamed tool
// or argument is red here by name rather than a `/crew` that silently asks for nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CREW_USAGE, crewCommandOf, theCrewAsText, theCrewCommandAnswers, theCrewCommandResult, type Heard } from './crew_command.ts'
import { SAY_TO_THE_CREW_TOOL } from '../../send_a_crew_message/say_to_the_crew_tool.ts'
import { SEE_THE_CREW_TOOL } from '../../see_the_crew/the_see_the_crew_tool.ts'
import { seeTheCrew, thePaneAnsweredBy } from '../../see_the_crew/see_the_crew.ts'

/** The launcher's pane answer for a crew of two that have reported nothing, as the launcher hands it over. */
const thePane = thePaneAnsweredBy(seeTheCrew({ members: [{ name: 'Pallas' }, { name: 'Vesta' }] }, {}, 1_000), false, 1_000)

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

test('#927 DW1: a bare /crew asks the launcher\'s see_the_crew and prints its header and every line under it', async () => {
  const launcher = aLauncher({ [SEE_THE_CREW_TOOL.name]: { said: JSON.stringify(thePane) } })
  const printed = await theCrewCommandAnswers('', launcher.hear)
  assert.deepEqual(launcher.asked, [{ tool: SEE_THE_CREW_TOOL.name, args: {} }], 'a bare /crew asks the launcher one thing: the crew')
  assert.equal(printed, [thePane.header, ...thePane.lines].join('\n'), 'the owner reads the lines the launcher wrote, in its order, and nothing else')
})

test('#927 DW2: /crew <member> <text> asks the launcher\'s say_to_the_crew, under its own argument names, and prints the receipt', async () => {
  const receipt = 'sent as message 7 to Vesta.'
  const launcher = aLauncher({ [SAY_TO_THE_CREW_TOOL.name]: { said: receipt } })
  const printed = await theCrewCommandAnswers('Vesta  take the  review\nwhen you can ', launcher.hear)
  const [to, text] = SAY_TO_THE_CREW_TOOL.inputSchema.required
  assert.ok(to !== undefined && text !== undefined, 'say_to_the_crew names who a message is for and what it says')
  assert.deepEqual(
    launcher.asked,
    [{ tool: SAY_TO_THE_CREW_TOOL.name, args: { [to]: ['Vesta'], [text]: 'take the  review\nwhen you can' } }],
    'the member is the first word, and the text is the rest as typed, its inner spacing and lines kept',
  )
  assert.equal(printed, receipt, 'the owner reads the receipt the launcher gave')
})

test('#927 DW2: a send the launcher refuses prints its refusal, and is never tried again', async () => {
  const refusal = '"Ceres" is not a member of this crew. The crew is Pallas, Vesta. Nothing was sent.'
  const launcher = aLauncher({ [SAY_TO_THE_CREW_TOOL.name]: { why: refusal } })
  assert.equal(await theCrewCommandAnswers('Ceres hello', launcher.hear), refusal, 'the refusal is printed as the launcher worded it')
  assert.equal(launcher.asked.length, 1, 'a refused send is asked once')
})

test('#927 DW5: in a session Martha did not launch, /crew prints why in one line and sends nothing', async () => {
  const notOurs = 'Martha did not launch this session, so it answers no tool here'
  const launcher = aLauncher({ [SEE_THE_CREW_TOOL.name]: { why: notOurs }, [SAY_TO_THE_CREW_TOOL.name]: { why: notOurs } })
  assert.equal(await theCrewCommandAnswers('', launcher.hear), notOurs, 'a bare /crew says why it cannot see a crew')
  assert.equal(await theCrewCommandAnswers('Vesta hello', launcher.hear), notOurs, 'a send says why it cannot send')
  assert.ok(!(await theCrewCommandAnswers('Vesta hello', launcher.hear)).includes('\n'), 'the answer is one line')
})

test('#927: a member named with nothing to say asks the launcher nothing, and prints how /crew is used', async () => {
  const launcher = aLauncher({})
  assert.equal(await theCrewCommandAnswers('  Vesta  ', launcher.hear), CREW_USAGE, 'a name alone is not a message')
  assert.deepEqual(launcher.asked, [], 'nothing was asked, so nothing was sent')
})

test('#927: what follows /crew is read as nothing, a name alone, or a name and its text', () => {
  assert.deepEqual(crewCommandOf(''), { see: true })
  assert.deepEqual(crewCommandOf(' \t '), { see: true })
  assert.deepEqual(crewCommandOf('Vesta'), { usage: true })
  assert.deepEqual(crewCommandOf('Vesta hi'), { say: { to: 'Vesta', text: 'hi' } })
})

test('#927: an answer that is not a pane is printed as it came, never as an empty crew', () => {
  assert.equal(theCrewAsText('not a pane'), 'Martha answered with something /crew cannot read: not a pane')
})

test('#927 DW6: the answer is the text for the owner alone, so no request carries it and the model takes no turn', () => {
  assert.deepEqual(theCrewCommandResult('a line'), { text: 'a line', isTextDisplayOnly: true })
})

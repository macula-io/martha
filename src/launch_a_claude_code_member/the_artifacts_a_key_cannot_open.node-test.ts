// The Artifact tools a member billed by an API key cannot run (martha#957 gap 13).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BILLED_BY_API_KEY, BILLINGS } from '../declare_crew/declare_crew.ts'
import { ARTIFACT_LINES } from '../read_a_crew_line/crew_lines.ts'
import { ARTIFACT_TOOLS, theArtifactRefusal } from './the_artifacts_a_key_cannot_open.ts'

/** A tool of the host's that is no Artifact tool. */
const ANOTHER_TOOL = 'Read'

test('#957 gap 13: each Artifact call by a member billed by the key is refused, naming both lines that hand it to the Supervisor (mutant: the billing not asked, a line left out)', () => {
  assert.equal(ARTIFACT_TOOLS.length, 3)
  for (const tool of ARTIFACT_TOOLS) {
    const refusal = theArtifactRefusal(BILLED_BY_API_KEY, tool) ?? ''
    assert.ok(refusal.includes(ARTIFACT_LINES.read), `${tool}: the read line is not named: ${refusal}`)
    assert.ok(refusal.includes(ARTIFACT_LINES.publish), `${tool}: the publish line is not named: ${refusal}`)
  }
  for (const billing of BILLINGS.filter((one) => one !== BILLED_BY_API_KEY)) {
    for (const tool of ARTIFACT_TOOLS) assert.equal(theArtifactRefusal(billing, tool), undefined, `${tool} is refused to a member billed by ${billing}, which carries the login`)
  }
})

test('#957 gap 13: any other call by a member billed by the key runs (mutant: every call refused)', () => {
  assert.equal(theArtifactRefusal(BILLED_BY_API_KEY, ANOTHER_TOOL), undefined)
})

// The `land_batch` and `fast_forward_after_the_owners_yes` tools (martha#256, #339, #443 part 5): the schema of what each
// takes, and what each answers.
//
// A landing cuts one integration branch out of the packages it names, and a dry run forecasts it and writes nothing. The
// tools slice (../a_crews_tools) keeps only the table that calls this.

import type { RangeCheckHost } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { A_BASE, A_CLONE, A_TIP, THE_PACKAGES } from '../check_a_range_before_the_owner_says_yes/the_verify_range_tool.ts'
import { forecastWhatABatchLands } from '../forecast_what_a_batch_lands/forecast_what_a_batch_lands.ts'
import {
  A_DRY_RUN,
  FAST_FORWARD_AFTER_THE_OWNERS_YES,
  FAST_FORWARD_DESCRIPTION,
  LAND_BATCH,
  LAND_BATCH_DESCRIPTION,
  fastForwardAfterTheOwnersYes,
  landPassedWorkAsOneBatch,
  type TheBatch,
  type TheFastForward,
} from './land_passed_work_as_one_batch.ts'

/** What `land_batch` takes: the clone, the packages, and whether the call is a dry run (martha#339). */
export const LAND_BATCH_TOOL = {
  name: LAND_BATCH,
  description: LAND_BATCH_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      path: A_CLONE,
      packages: { ...THE_PACKAGES, minItems: 1 },
      [A_DRY_RUN]: { type: 'integer', enum: [0, 1], description: '1 for a dry run that merges in memory and writes nothing' },
    },
    required: ['path', 'packages'],
  },
}

/** What `fast_forward_after_the_owners_yes` takes: the range the owner said yes to, and the packages it lands. */
export const FAST_FORWARD_TOOL = {
  name: FAST_FORWARD_AFTER_THE_OWNERS_YES,
  description: FAST_FORWARD_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: { path: A_CLONE, base: A_BASE, tip: A_TIP, packages: { ...THE_PACKAGES, minItems: 1 } },
    required: ['path', 'base', 'tip', 'packages'],
  },
}

/** What the tools answer: what the landing said it did, or why nothing was landed. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/**
 * `land_batch`: the batch a call names, landed as one integration branch by the slice that cuts it (martha#256), or its
 * dry run with `check` 1, which writes nothing (martha#339).
 *
 * The batch and the dry run are handed in already read (theBatchACallNames, aDryRunIsAsked), because the tools slice
 * reads a call's arguments before it asks this launch for the processes it acts with (martha#443 part 5 r=2): a call
 * whose arguments are wrong is answered by those arguments even in a launch that could not act.
 */
export async function landTheBatchOver(host: RangeCheckHost, member: string, asked: TheBatch, dry_run: boolean): Promise<AToolAnswer> {
  if (dry_run) {
    const forecast = await forecastWhatABatchLands(host, asked)
    return 'told' in forecast ? { answer: forecast.told } : { refused: forecast.refused }
  }
  const landed = await landPassedWorkAsOneBatch(host, member, asked)
  return 'told' in landed ? { answer: landed.told } : { refused: landed.refused }
}

/** `fast_forward_after_the_owners_yes`: the default branch moved onto the approved tip (martha#256), the range read as
 *  verify_range reads it, before the launch is asked for the processes it acts with (martha#443 part 5 r=2). */
export async function fastForwardOntoTheApprovedTipOver(host: RangeCheckHost, member: string, asked: TheFastForward): Promise<AToolAnswer> {
  const moved = await fastForwardAfterTheOwnersYes(host, member, asked)
  return 'told' in moved ? { answer: moved.told } : { refused: moved.refused }
}

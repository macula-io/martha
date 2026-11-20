// The launch's ordinary end, when the member has ended and the launcher has nothing to hold any more (martha#646, D1).
//
// The order is the signal path's (#472): the relay's server and its directory, then the keep, then the snapshot that
// holds what the member's host wrote. A keep after the snapshot copies a folder that is already gone; a keep that is not
// called at all leaves the member's session unreadable the moment it ends. Neither is a small failure, so the order is
// held here by name (martha#646 r=1 R5).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LaunchMade } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { removeWhatTheLaunchMade } from './end_a_launch.ts'

test('the ordinary end keeps the member\'s transcripts after the relay and before the snapshot (martha#646, D1)', async () => {
  const order: string[] = []
  const made = {
    server: { close: async (): Promise<void> => void order.push('server') },
    relayDirectory: { remove: (): void => void order.push('relay-directory') },
    keepTranscripts: (): void => void order.push('keep-transcripts'),
    removeSnapshot: (): void => void order.push('snapshot'),
  } as unknown as LaunchMade
  await removeWhatTheLaunchMade(made)
  assert.deepEqual(order, ['server', 'relay-directory', 'keep-transcripts', 'snapshot'],
    'the keep does not sit between the relay and the snapshot, so the ordinary end removes what the host wrote before it is kept')
})

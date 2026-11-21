// Waking an idle member from inside its session (martha#959): when the launcher is asked, and what is submitted.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wakingAnIdleMemberWith } from './crew_waking_an_idle_member.ts'

const THE_TEXT = 'the launcher said this session is to be woken'

/** What one look comes to: how many times the launcher was asked, and what was submitted into the session. */
const aLook = async (isIdle: () => boolean): Promise<{ asked: number; submitted: readonly string[] }> => {
  const said = { asked: 0, submitted: [] as readonly string[] }
  const waking = wakingAnIdleMemberWith(
    isIdle,
    async () => {
      said.asked += 1
      return THE_TEXT
    },
    async (text) => void (said.submitted = [...said.submitted, text]),
  )
  await waking.wakeWhileIdle()
  return said
}

test('#959: a busy session asks the launcher nothing and is submitted nothing', async () => {
  const look = await aLook(() => false)
  assert.deepEqual(look, { asked: 0, submitted: [] })
})

test('#959: an idle session is submitted the launcher\'s wake, whole', async () => {
  const look = await aLook(() => true)
  assert.deepEqual(look, { asked: 1, submitted: [THE_TEXT] })
})

test('#959: a turn that starts while the launcher is answering is submitted nothing', async () => {
  let idle = true
  const submitted: string[] = []
  const waking = wakingAnIdleMemberWith(
    () => idle,
    async () => {
      // The turn starts while the answer is on its way: the wake belongs to the idle session that asked.
      idle = false
      return THE_TEXT
    },
    async (text) => void submitted.push(text),
  )
  await waking.wakeWhileIdle()
  assert.deepEqual(submitted, [])
})

test("#959: the launcher's own 'nothing is due' submits nothing", async () => {
  const submitted: string[] = []
  const waking = wakingAnIdleMemberWith(
    () => true,
    async () => '',
    async (text) => void submitted.push(text),
  )
  await waking.wakeWhileIdle()
  assert.deepEqual(submitted, [])
})

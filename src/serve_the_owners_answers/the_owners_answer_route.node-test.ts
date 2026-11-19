// The route an owner's answer takes to the launch holding the ask, and `martha answer` over it (macula-io/martha#541,
// package 9a). Each case serves a real Unix socket in a directory of its own and removes that directory when it ends.

import assert from 'node:assert/strict'
import { chmodSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { newShortRelayRoot } from '../drive_the_recorded_host/short_relay_root.ts'
import { EXIT_DONE, EXIT_REFUSED } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import type { AnAnswerHeard, AnOpenAsk, TheOwnersAsks, WhatAnAnswerDid } from '../hear_an_acp_agents_asks/hear_an_acp_agents_asks.ts'
import { AN_ANSWER_NEEDS_A_TERMINAL, answerAct, answerOf, NOTHING_WAITS, type TheAnswersIo } from './martha_answer.ts'
import {
  anAskOfTheRouteIn,
  anOwnerActStandsBehind,
  askTheRoute,
  forgetTheRoute,
  keepTheRoute,
  serveTheOwnersAnswers,
  THE_ANSWER_SOCKETS_MODE,
  THE_OWNERS_ANSWERS_FILE,
  theLineOfAnAnswer,
  theMembersWithARoute,
  theRouteOf,
  theRouteRecordOf,
  type TheRouteServed,
} from './the_owners_answer_route.ts'

const PERMISSION_BITS = 0o777
/** The act's word, as the command routes it. */
const THE_ACT = 'answer'
const MEMBER = 'Vesta'
const AN_ASK: AnOpenAsk = { key: 'permission:call-9a', session_id: 's', tool_call_id: 'call-9a', tool: 'the-tests-own-tool', title: 'echo hi', input: { command: 'echo hi' }, opened_at: 7 }

/** Asks that hold `open` and answer with `did`, keeping every answer they heard. */
function someAsks(open: readonly AnOpenAsk[], did: WhatAnAnswerDid = { did: 'answered', owner_act: true }): TheOwnersAsks & { readonly heard: AnAnswerHeard[] } {
  const heard: AnAnswerHeard[] = []
  return { heard, decide: () => () => 'reject', open: () => open, answer: (one) => (heard.push(one), did), kept: [], notes: [] }
}

/**
 * A directory of the case's own, 0700, removed when `run` ends. It is made where a socket address has room
 * whatever TMPDIR is: CI runs the suite under a long one on purpose, and `listen` refuses a path past it (martha#79).
 */
async function inAPlace(run: (place: string) => Promise<void>): Promise<void> {
  const place = newShortRelayRoot()
  try {
    await run(place)
  } finally {
    removeTheTree(place)
  }
}

/** A launch serving `asks` with its route recorded for MEMBER in `place`. */
async function aLaunch(place: string, asks: TheOwnersAsks): Promise<TheRouteServed> {
  const served = await serveTheOwnersAnswers(join(place, 'answers.sock'), asks)
  assert.ok(!('refusal' in served), 'refusal' in served ? served.refusal : '')
  keepTheRoute(place, { member: MEMBER, socket_path: served.socket_path, pid: process.pid })
  return served
}

test('the socket is served mode 0600 exactly, and a path already there is refused, never reused', async () => {
  await inAPlace(async (place) => {
    const served = await aLaunch(place, someAsks([]))
    try {
      assert.equal(lstatSync(served.socket_path).mode & PERMISSION_BITS, THE_ANSWER_SOCKETS_MODE)
      const again = await serveTheOwnersAnswers(served.socket_path, someAsks([]))
      assert.ok('refusal' in again && /already there/.test(again.refusal))
    } finally {
      await served.close()
    }
  })
})

test('a line is read as the open asks or one answer; anything else is refused by name', () => {
  assert.deepEqual(anAskOfTheRouteIn('{"open":1}'), { open: 1 })
  assert.deepEqual(anAskOfTheRouteIn('{"answer":{"key":"k","answer":"allow","act":"a"}}'), { answer: { key: 'k', answer: 'allow', act: 'a' } })
  assert.deepEqual(anAskOfTheRouteIn('{"answer":{"key":"k","answer":"reject"}}'), { answer: { key: 'k', answer: 'reject' } })
  const refusals: readonly [string, RegExp][] = [
    ['not json', /not JSON/],
    ['[1]', /not an object/],
    ['{"open":1,"answer":{}}', /neither/],
    ['{"answer":{"key":"k","answer":"allow_always"}}', /not one of allow or reject/],
    ['{"answer":{"key":"","answer":"allow"}}', /names no key/],
    ['{"answer":{"key":"k","answer":"allow","act":7}}', /not an id/],
  ]
  for (const [line, why] of refusals) {
    const read = anAskOfTheRouteIn(line)
    assert.ok('refused' in read && why.test(read.refused), `${line} is refused for ${String(why)}`)
  }
})

test('the route carries the open asks and an answer, act id included, both ways', async () => {
  await inAPlace(async (place) => {
    const asks = someAsks([AN_ASK])
    const served = await aLaunch(place, asks)
    try {
      assert.deepEqual(await askTheRoute(served.socket_path, { open: 1 }), { open: [AN_ASK] })
      assert.deepEqual(await askTheRoute(served.socket_path, { answer: { key: AN_ASK.key, answer: 'allow', act: 'act-7' } }), { did: { did: 'answered', owner_act: true } })
      assert.deepEqual(asks.heard, [{ key: AN_ASK.key, answer: 'allow', act: 'act-7' }])
    } finally {
      await served.close()
    }
  })
})

test('a route record is kept 0600, read back, listed by member, and forgotten; one that is not only the owner\'s is not followed', async () => {
  await inAPlace(async (place) => {
    keepTheRoute(place, { member: MEMBER, socket_path: '/a/socket', pid: 42 })
    assert.equal(lstatSync(theRouteRecordOf(place, MEMBER)).mode & PERMISSION_BITS, THE_ANSWER_SOCKETS_MODE)
    assert.deepEqual(theRouteOf(place, MEMBER), { member: MEMBER, socket_path: '/a/socket', pid: 42 })
    assert.deepEqual(theMembersWithARoute(place), [MEMBER])
    chmodSync(theRouteRecordOf(place, MEMBER), 0o644)
    assert.match((theRouteOf(place, MEMBER) as { why: string }).why, /not a file only this user reads/)
    chmodSync(theRouteRecordOf(place, MEMBER), THE_ANSWER_SOCKETS_MODE)
    writeFileSync(theRouteRecordOf(place, MEMBER), JSON.stringify({ member: 'Uranus', socket_path: '/a/socket', pid: 42 }))
    assert.match((theRouteOf(place, MEMBER) as { why: string }).why, /not a route record/, 'a record naming another member is not this member\'s')
    forgetTheRoute(place, MEMBER)
    forgetTheRoute(place, MEMBER)
    assert.match((theRouteOf(place, MEMBER) as { why: string }).why, /no Goose launch of that member is running/)
    assert.deepEqual(theMembersWithARoute(place), [])
  })
})

test('an owner act stands behind an answer only when the record names the same act, member, key and answer', () => {
  const typed = { act: 'act-8', member: MEMBER, key: AN_ASK.key, answer: 'allow' as const, at: 'now' }
  const record = `${theLineOfAnAnswer(typed)}\nnot json\n`
  assert.equal(anOwnerActStandsBehind(record, MEMBER, { key: AN_ASK.key, answer: 'allow', act: 'act-8' }), true)
  assert.equal(anOwnerActStandsBehind(record, MEMBER, { key: AN_ASK.key, answer: 'allow' }), false, 'no act named')
  assert.equal(anOwnerActStandsBehind(record, MEMBER, { key: AN_ASK.key, answer: 'allow', act: 'act-9' }), false, 'another act')
  assert.equal(anOwnerActStandsBehind(record, 'Uranus', { key: AN_ASK.key, answer: 'allow', act: 'act-8' }), false, 'another member')
  assert.equal(anOwnerActStandsBehind(record, MEMBER, { key: 'permission:other', answer: 'allow', act: 'act-8' }), false, 'another key')
  assert.equal(anOwnerActStandsBehind(record, MEMBER, { key: AN_ASK.key, answer: 'reject', act: 'act-8' }), false, 'another answer')
})

test('`martha answer` takes no words, or a member, a key and allow or reject', () => {
  assert.deepEqual(answerOf(THE_ACT, [THE_ACT]), { act: THE_ACT, args: [] })
  assert.deepEqual(answerOf(THE_ACT, [THE_ACT, MEMBER, AN_ASK.key, 'allow']), { act: THE_ACT, member: MEMBER, args: [AN_ASK.key, 'allow'] })
  for (const words of [[THE_ACT, MEMBER], [THE_ACT, MEMBER, AN_ASK.key], [THE_ACT, MEMBER, AN_ASK.key, 'allow_always'], [THE_ACT, '-x', AN_ASK.key, 'allow'], [THE_ACT, MEMBER, AN_ASK.key, 'allow', 'more']]) {
    assert.equal(answerOf(THE_ACT, words), undefined, words.join(' '))
  }
})

/** The io of a terminal, or of none, with every line kept. */
function anIo(is_terminal = true): TheAnswersIo & { readonly said: string[]; readonly errors: string[] } {
  const said: string[] = []
  const errors: string[] = []
  return { is_terminal, said, errors, out: (line) => void said.push(line), err: (line) => void errors.push(line) }
}

test('`martha answer` lists every open ask by member, and says so when nothing waits', async () => {
  await inAPlace(async (place) => {
    const io = anIo()
    assert.equal(await answerAct(io, { routes: place, keep: () => undefined }, undefined, []), EXIT_DONE)
    assert.deepEqual(io.said, [NOTHING_WAITS])
    const served = await aLaunch(place, someAsks([AN_ASK]))
    try {
      const listed = anIo()
      assert.equal(await answerAct(listed, { routes: place, keep: () => undefined }, undefined, []), EXIT_DONE)
      assert.deepEqual(listed.said, [`${MEMBER}  ${AN_ASK.key}  ${AN_ASK.tool}: ${AN_ASK.title}`])
    } finally {
      await served.close()
    }
  })
})

test('`martha answer` keeps the answer\'s line before it sends it, and the launch hears that very act id', async () => {
  await inAPlace(async (place) => {
    const asks = someAsks([AN_ASK])
    const served = await aLaunch(place, asks)
    const record = join(place, THE_OWNERS_ANSWERS_FILE)
    const keep = (line: string): undefined => {
      assert.deepEqual(asks.heard, [], 'kept before anything is sent')
      writeFileSync(record, `${line}\n`, { flag: 'a' })
      return undefined
    }
    try {
      const io = anIo()
      assert.equal(await answerAct(io, { routes: place, keep }, MEMBER, [AN_ASK.key, 'allow']), EXIT_DONE)
      assert.equal(asks.heard.length, 1)
      assert.equal(anOwnerActStandsBehind(readFileSync(record, 'utf8'), MEMBER, asks.heard[0]!), true)
      assert.deepEqual(io.said, [`${MEMBER}: ${AN_ASK.key} answered allow`])
    } finally {
      await served.close()
    }
  })
})

test('`martha answer` refuses with no terminal, sends nothing it could not record, and says why an answer answered nothing', async () => {
  await inAPlace(async (place) => {
    const asks = someAsks([AN_ASK], { did: 'answered-nothing', why: 'the tests own why' })
    const served = await aLaunch(place, asks)
    try {
      const noTerminal = anIo(false)
      assert.equal(await answerAct(noTerminal, { routes: place, keep: () => undefined }, MEMBER, [AN_ASK.key, 'allow']), EXIT_REFUSED)
      assert.match(noTerminal.errors.join('\n'), new RegExp(AN_ANSWER_NEEDS_A_TERMINAL.replace(/[.,]/g, '.')))
      const unrecorded = anIo()
      assert.equal(await answerAct(unrecorded, { routes: place, keep: () => 'the disk is full' }, MEMBER, [AN_ASK.key, 'allow']), EXIT_REFUSED)
      assert.match(unrecorded.errors.join('\n'), /not sent, because it could not be recorded: the disk is full/)
      assert.deepEqual(asks.heard, [], 'nothing reached the launch')
      const nothing = anIo()
      assert.equal(await answerAct(nothing, { routes: place, keep: () => undefined }, MEMBER, [AN_ASK.key, 'allow']), EXIT_REFUSED)
      assert.match(nothing.errors.join('\n'), /answered nothing: the tests own why/)
      const nobody = anIo()
      assert.equal(await answerAct(nobody, { routes: place, keep: () => undefined }, 'Uranus', [AN_ASK.key, 'allow']), EXIT_REFUSED)
      assert.match(nobody.errors.join('\n'), /Uranus serves no answer route/)
    } finally {
      await served.close()
    }
  })
})

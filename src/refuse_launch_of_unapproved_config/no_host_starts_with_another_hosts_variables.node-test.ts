// A host is started with its own variables and never another host's (martha#474).
//
// `launchEnvironment` builds every host's environment. A switch it added for every host would be one host's variable in
// all of them: #460 put Claude Code's auto-updater switch there, so every OpenCode launch carried a Claude Code
// variable and OpenCode's own updater stayed on. Each host's variables now sit in its own row of HOSTS, and this walks
// every row's launch for a name another row declares.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HOSTS, launchEnvironment, theRowOfHost, type Host, type HostSwitches } from './refuse_launch_of_unapproved_config.ts'

/** A path for the carried-file switches to name; only the variable names they set are read. */
const A_CARRIED_COPY = '/a-snapshot/a-carried-copy'

/** Every host Martha has a launch row for. */
const EVERY_HOST = Object.keys(HOSTS) as Host[]

/** The variable names one set of switches sets or drops. */
const namesOf = (switches: HostSwitches): string[] => [...Object.keys(switches.env), ...switches.env_dropped]

/** Every variable name `host`'s row declares: its project-config switches, its carried files' switches, and its env_last. */
function namesTheRowDeclares(host: Host): Set<string> {
  const row = theRowOfHost(host)
  const carried = Object.values(row.carried).flatMap((carry) => namesOf(carry(A_CARRIED_COPY)))
  return new Set([...namesOf(row.project_config_off), ...carried, ...Object.keys(row.env_last)])
}

test("no host's launch carries a variable only another host's row declares", () => {
  assert.ok(EVERY_HOST.length > 1, 'there are at least two hosts, or this walk compares nothing')
  for (const host of EVERY_HOST) {
    const own = namesTheRowDeclares(host)
    const started = Object.keys(launchEnvironment({}, theRowOfHost(host).project_config_off, host))
    for (const other of EVERY_HOST.filter((candidate) => candidate !== host)) {
      const theirs = [...namesTheRowDeclares(other)].filter((name) => !own.has(name))
      const leaked = started.filter((name) => theirs.includes(name))
      assert.deepEqual(leaked, [], `a ${host} launch is started with ${leaked.join(', ')}, which only the ${other} row declares`)
    }
  }
})

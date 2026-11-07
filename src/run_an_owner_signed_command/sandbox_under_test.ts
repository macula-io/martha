// Whether the tests of a signed run have the sandbox they need (martha#129).
//
// A run is sandboxed or does not happen, so a machine with no unprivileged user namespaces (stock Ubuntu 24.04,
// without the AppArmor profile) can only skip those tests, by name. CI sets SANDBOX_REQUIRED_VARIABLE, so there
// a missing sandbox is a red test, never a gate skipped in silence.

import { env } from 'node:process'

import { sandboxRefusal } from './run_in_a_sandbox.ts'

/** Set to 1 where the sandbox must be there: CI. */
export const SANDBOX_REQUIRED_VARIABLE = 'MARTHA_SANDBOX_REQUIRED'

/** Why a sandboxed test skips here; false where the sandbox is there, or required, so the test runs and fails without it. */
export function skipWithoutTheSandbox(): string | false {
  if (env[SANDBOX_REQUIRED_VARIABLE] === '1') return false
  return sandboxRefusal() ?? false
}

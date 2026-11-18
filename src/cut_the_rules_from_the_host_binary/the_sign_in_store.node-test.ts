// The sign-in store variable is cut from the two places the host reads it, and only when both name the same one
// (the_sign_in_store.ts, martha#602). The texts are the recorded host's own shapes, written out with its variable.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { signInStoreVariableIn } from './the_sign_in_store.ts'

const keychainRule = (variable: string): string =>
  `function TNe(n=""){let e=process.env.${variable},t=e!==void 0?!e:!process.env.CLAUDE_CONFIG_DIR,r=e!==void 0?e.normalize("NFC"):Ye();return r}`
const fileRule = (variable: string): string =>
  `function i5(){let n=process.env.${variable};if(n!==void 0)return(n||s(u(),".claude")).normalize("NFC");return Ye()}`

const RECORDED = RECORDED_HOST.sign_in_store_variable

test('the variable both sign-in rules read is cut, and it is the recording\'s', () => {
  assert.deepEqual(signInStoreVariableIn(`${fileRule(RECORDED)};${keychainRule(RECORDED)}`), { sign_in_store_variable: RECORDED })
})

test('a host with either rule missing is refused, since the owner\'s sign-in could not be reached', () => {
  assert.throws(() => signInStoreVariableIn(keychainRule(RECORDED)), /0 variables for the sign-in file's folder/)
  assert.throws(() => signInStoreVariableIn(fileRule(RECORDED)), /0 variables for the sign-in keychain item's name/)
})

test('a host whose two rules read different variables, or one rule two, is refused', () => {
  assert.throws(() => signInStoreVariableIn(`${fileRule(RECORDED)};${keychainRule('ANOTHER_STORE_DIR')}`), /keychain item by ANOTHER_STORE_DIR and its sign-in file by/)
  assert.throws(() => signInStoreVariableIn(`${fileRule(RECORDED)};${keychainRule(RECORDED)};${keychainRule('ANOTHER_STORE_DIR')}`), /2 variables for the sign-in keychain item's name/)
})

test('a keychain rule that does not fall back to the config folder when the variable is unset is not the rule', () => {
  const noFallback = keychainRule(RECORDED).replace('!process.env.CLAUDE_CONFIG_DIR', '!process.env.SOMETHING_ELSE')
  assert.throws(() => signInStoreVariableIn(`${fileRule(RECORDED)};${noFallback}`), /0 variables for the sign-in keychain item's name/)
})

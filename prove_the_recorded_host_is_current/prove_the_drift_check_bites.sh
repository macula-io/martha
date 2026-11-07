#!/usr/bin/env bash
# prove_the_drift_check_bites.sh: the recorder's --check passes on a host that says what the recording says and fails,
# by name, on one that does not (martha#139). It runs on every PR, with no host installed and no npm: the tests build
# their host from the recording's own parts. So the checker is proven on every tip, and only the scheduled drift
# comparison depends on an outside release.
#
# Every test in the file must run and pass: a skipped or filtered-out test would let a check that cannot bite go green.
#
# Exit: 0 every test ran and passed, 1 otherwise.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
TESTS="${REPO}/src/record_claude_code_host/record_claude_code_host.node-test.ts"
OUT="$(mktemp)"
trap 'rm -f "${OUT}"' EXIT

status=0
node --test --test-reporter=spec "${TESTS}" > "${OUT}" 2>&1 || status=$?
count() { sed -nE "s/^ℹ $1 ([0-9]+)$/\1/p" "${OUT}"; }
tests="$(count tests)"
passed="$(count pass)"
skipped="$(count skipped)"
if [[ "${status}" -ne 0 || -z "${tests}" || "${tests}" -eq 0 || "${passed}" != "${tests}" || "${skipped}" != "0" ]]; then
  cat "${OUT}" >&2
  echo "prove_the_drift_check_bites: ${passed:-?} of ${tests:-?} tests passed, ${skipped:-?} skipped" >&2
  exit 1
fi
echo "prove_the_drift_check_bites: all ${tests} tests of the drift check ran and passed"

#!/usr/bin/env bash
# run_the_tests_of_one_file.sh <file>… [--test-name-pattern=<pattern>]: one file of the suite, or one named case, through
# the suite's own bounds (martha#723).
#
# `npm test` has one way in and it runs everything: the recorded-host runs, the installer job, then the parallel suite.
# Arguments after `npm test --` reach only the last of those, and land after its globs, so they cannot narrow it. A member
# who needs one file therefore copies stage 3 out of package.json by hand and swaps its globs for the file — a copy that
# drifts the moment either changes (martha#669), with the shape martha#683 exists to stop.
#
# This is that run without the copy. Its words are stage 3's own, read from package.json through
# prove_the_core/the_words_one_run_gets.ts: the program, the output check, the names that command unsets, and its bounds.
# Only the six globs are replaced, by the files named here. The recorded-host and installer stages do not run: a green
# run here says nothing about them, and `npm test` is still the gate before a handoff.
#
# The arguments are built here and printed before anything runs, never assembled by npm. The list is then held, by name,
# to the three things that bound every run before it is started (martha#56): the timeout, force-exit, and the guard that
# fails a file leaving something running. A word that is not a test file and not --test-name-pattern is refused: a
# hand-set bound is the drift this exists to stop, and a bare token can never become a pattern.
#
# Exit: the run's own; 2 refused, with its words.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
NAME="run_the_tests_of_one_file"
THE_READER="./prove_the_core/the_words_one_run_gets.ts"
cd "${REPO}"

refuse() { echo "${NAME}: ${1}" >&2; exit 2; }

# The three things that bound a run, each read from the one place that defines it, and a read that comes back empty
# refuses rather than running anything unbounded.
mapfile -t THE_BOUNDS < <(node --input-type=module -e "import { FORCE_EXIT_FLAG, GUARD_FLAG, TIMEOUT_FLAG } from './prove_the_core/every_test_run_ends.ts'; console.log(TIMEOUT_FLAG); console.log(FORCE_EXIT_FLAG); console.log(GUARD_FLAG)")
TIMEOUT_FLAG="${THE_BOUNDS[0]:-}"
FORCE_EXIT_FLAG="${THE_BOUNDS[1]:-}"
GUARD_FLAG="${THE_BOUNDS[2]:-}"
[[ -n "${TIMEOUT_FLAG}" && -n "${FORCE_EXIT_FLAG}" && -n "${GUARD_FLAG}" ]] \
  || refuse "every_test_run_ends.ts gave no ${TIMEOUT_FLAG:-timeout}/${FORCE_EXIT_FLAG:-force-exit}/${GUARD_FLAG:-guard} to read"

# Stage 3 of the test script as it stands there, so no word of this run is written anywhere a second time.
mapfile -t STAGE < <(node "${THE_READER}" stage)
mapfile -t UNSETS < <(node "${THE_READER}" unsets)
[[ ${#STAGE[@]} -gt 0 ]] || refuse "${THE_READER} read no command of the tests from the test script"

PREFIX=()
FLAGS=()
AT_THE_RUNNER=0
for word in "${STAGE[@]}"; do
  case "${AT_THE_RUNNER}:${word}" in
    "0:--test") AT_THE_RUNNER=1 ;;
    "0:"*) PREFIX+=("${word}") ;;
    "1:--"*) FLAGS+=("${word}") ;;
  esac
done
(( AT_THE_RUNNER == 1 )) || refuse "the test script's command has no --test to read"

# Only what the caller asked for: one name pattern at most, and files the suite itself runs.
NARROWED=()
FILES=()
for word in "$@"; do
  case "${word}" in
    --test-name-pattern=*)
      (( ${#NARROWED[@]} == 0 )) || refuse "one --test-name-pattern, not two"
      NARROWED=("${word}")
      ;;
    -*)
      refuse "'${word}' is not this runner's to pass: the bounds are the test script's, and --test-name-pattern is the one flag it takes"
      ;;
    *)
      [[ -f "${word}" ]] || refuse "${word} is not a file"
      why="$(node "${THE_READER}" picks "${word}" 2>&1 >/dev/null)" || refuse "${why}"
      FILES+=("${word}")
      ;;
  esac
done
(( ${#FILES[@]} > 0 )) || refuse "name at least one test file; npm test is the whole suite"

ARGS=("${PREFIX[@]}" --test "${FLAGS[@]}" "${NARROWED[@]}" "${FILES[@]}")

holds() {
  local want="$1" why="$2" word
  for word in "${ARGS[@]}"; do
    if [[ "${word}" == ${want} ]]; then return 0; fi
  done
  refuse "${why}"
}
holds "${TIMEOUT_FLAG}=[1-9]*" "the run's arguments carry no ${TIMEOUT_FLAG}=, so a hung test would never fail (martha#56)"
holds "${FORCE_EXIT_FLAG}" "the run's arguments carry no ${FORCE_EXIT_FLAG}, so a file holding a handle open would never exit (martha#56)"
holds "${GUARD_FLAG}" "the run's arguments carry no ${GUARD_FLAG}, so a file leaving something running would pass silently (martha#56)"

printf '%s: %s\n' "${NAME}" "${ARGS[*]}" >&2
if (( ${#UNSETS[@]} > 0 )); then
  env -u "${UNSETS[@]}" "${ARGS[@]}"
else
  "${ARGS[@]}"
fi

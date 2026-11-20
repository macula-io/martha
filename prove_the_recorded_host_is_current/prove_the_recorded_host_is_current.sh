#!/usr/bin/env bash
# prove_the_recorded_host_is_current.sh <work-dir> [where-to-leave-the-host]: the committed recording of the Claude
# Code host (src/claude_code_host/recorded_claude_code_host.json) is of the version members run, and that version's
# code still reads as recorded (martha#139).
#
# Members install Claude Code from npm's `latest` dist-tag. This installs exactly the version that tag names, checks
# the installed host says it is that version, and runs the recorder's --check against it, which writes nothing. Any
# fact that differs fails, naming the field: every value the adapter derives from the recording (prompt origin kinds,
# session start sources) must describe the host that runs. A release whose facts are all the recorded ones, once the
# minifier's names are taken out, passes on its version alone with a notice that a routine re-record is due
# (martha#811); the notice turns into a failure 7 days after the first newer release came out, or at the 5th newer
# release. --check reads the models from the release's own sdk-tools.d.ts and ages the notice from npm's answer for
# the package's `time` and `versions`, both handed to it here. A notice is raised as a run annotation and a line in
# the job summary, so a green run still says the re-record is due.
#
# The second argument is for the checks that prove something on this very host once the recording is right — the order
# it raises its dialogs in (prove_the_relay_loads/prove_the_order_of_the_dialogs.mjs, martha#313), which a new release
# can change under the row that rests on it. Given a directory outside the work dir, the host is installed there and
# left for the step after; without it the host is installed in the work dir and removed with it, as before.
#
# The fix for a failure is a re-record, never a retry:
#   npm run record:claude-code-host -- <the installed claude binary> <the version>
# then a PR with whatever the newly named fields call for in the declarations or the readers.
#
# --check's standard output carries versions and field or part names only, never host code, since the run's log is
# public.
#
# Exit: 0 the recording is current, or the release carries its facts and the notice holds; 1 a fact differs, the notice
# has aged, or the host cannot be read; 2 the host could not be set up.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
RECORDER="${REPO}/src/record_claude_code_host/record_claude_code_host.ts"
PACKAGE="@anthropic-ai/claude-code"
# The tag members' installs follow. Moving the crew to another channel is a decision made here in a reviewed PR.
DIST_TAG="latest"
WORK="${1:?usage: prove_the_recorded_host_is_current.sh <work-dir> [where-to-leave-the-host]}"
HOSTS="${2:-${WORK}/host}"
mkdir -p "${WORK}"
trap 'rm -rf "${WORK}"' EXIT

version="$(npm view "${PACKAGE}" "dist-tags.${DIST_TAG}")" \
  || { echo "prove_the_recorded_host_is_current: npm names no ${DIST_TAG} version of ${PACKAGE}" >&2; exit 2; }
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "prove_the_recorded_host_is_current: ${PACKAGE}@${DIST_TAG} is '${version}', not a version" >&2; exit 2; }

npm install --prefix "${HOSTS}" --no-save --no-package-lock --no-audit --no-fund "${PACKAGE}@${version}" > /dev/null \
  || { echo "prove_the_recorded_host_is_current: Claude Code ${version} could not be installed" >&2; exit 2; }
claude="$(readlink -f "${HOSTS}/node_modules/.bin/claude")"
said="$("${claude}" --version)"
[[ "${said%% *}" == "${version}" ]] \
  || { echo "prove_the_recorded_host_is_current: installed a host that says '${said}', not ${version}" >&2; exit 2; }

declaration="${HOSTS}/node_modules/${PACKAGE}/sdk-tools.d.ts"
[[ -f "${declaration}" ]] \
  || { echo "prove_the_recorded_host_is_current: Claude Code ${version} ships no sdk-tools.d.ts to read its models from" >&2; exit 2; }
answer="${WORK}/npm-answer.json"
npm view "${PACKAGE}" time versions --json > "${answer}" \
  || { echo "prove_the_recorded_host_is_current: npm gave no release times and versions of ${PACKAGE}" >&2; exit 2; }

# The check's output is written whole before it is read: a runner's coreutils may write a redirect line by line.
said_by_check="${WORK}/check.out"
status=0
node "${RECORDER}" --check "${claude}" "${version}" "${declaration}" "${answer}" > "${said_by_check}" || status=$?
cat "${said_by_check}"
notice="$(sed -n 's/^notice: //p' "${said_by_check}")"
if [[ -n "${notice}" ]]; then
  echo "::notice title=host drift::${notice}"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "${notice}" >> "${GITHUB_STEP_SUMMARY}"; fi
elif [[ "${status}" -eq 0 ]]; then
  echo "prove_the_recorded_host_is_current: the recording is of Claude Code ${version}, the ${DIST_TAG} release"
fi
exit "${status}"

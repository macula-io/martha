#!/usr/bin/env bash
# prove_the_relay_loads.sh [work-dir]: the host's own loader takes Martha's relay, at the host version the adapter was
# recorded from (martha#104).
#
# The host reads a hooks module before it runs it and refuses it whole for a rule it holds, and a refused relay runs
# no gate at all. The relay's unit tests drive it against a stand-in engine, which holds none of those rules, so only
# the host itself can say. This installs the recorded version (src/claude_code_host/recorded_claude_code_host.json,
# never typed here) and runs its loader on the relay as committed, then checks the check bites on a copy of the relay
# with the line #104 fixed put back.
#
# Then a launch leaves the installed relay folder as it was (martha#117): the host writes its generated types into the
# folder --plugin-dir names on an interactive start, so the launcher hands it a read-only copy instead. First the check
# bites: this host, started interactively on a writable copy of the relay, writes its types there. The host runs with no
# account and no key, in a home that says onboarding is done and the folder is trusted.
#
# Then every test case that drives the recorded host runs here, with this binary in MARTHA_RECORDED_HOST, through
# run_the_recorded_host_runs.sh: one file at a time, each held to the case count recorded_host_runs.json lists for it,
# the way `npm test` runs them before its parallel run (martha#383, martha#385). Among them: a launch leaves the
# installed relay folder as it was (martha#117); a member's own writes do not stop it and an outsider's change does
# (martha#132); every rule the launch writes is one this host matches (martha#226); a member's model switch runs in this
# host (martha#315); a permission prompt this host draws reaches the owner's row and clears once answered (martha#363).
#
# And that switch leaves the owner's own default for new sessions alone (martha#359): the file the host really wrote is
# the one Martha puts back, which the mechanism's own tests could agree with a mistake about. These cases read the same
# binary, so they run here or nowhere.
#
# Exit: 0 the recorded host loads the relay and a launch leaves it as it was, 1 it does not (or a check did not bite),
# 2 the host could not be set up.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
RECORDING="${REPO}/src/claude_code_host/recorded_claude_code_host.json"
RELAY="${REPO}/src/claude_code_relay"
REGISTER="hooks/register.ts"
HARNESS="${REPO}/src/launch_a_claude_code_member/drive_the_recorded_host.ts"
HOST_TYPES_FILE="tsconfig.json"
HOST_WRITES_WITHIN_S=60
VARIABLE_CONSTANT="RELAY_SOCKET_VARIABLE"
WORK="${1:-$(mktemp -d)}"
mkdir -p "${WORK}"
trap 'rm -rf "${WORK}"' EXIT

version="$(jq -r '.host_version // empty' "${RECORDING}")"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "prove_the_relay_loads: ${RECORDING} names no host version" >&2; exit 2; }
variable="$(sed -n "s/^export const ${VARIABLE_CONSTANT} = '\([A-Z_]*\)'$/\1/p" "${RELAY}/hooks/relay_protocol.ts")"
[[ -n "${variable}" ]] || { echo "prove_the_relay_loads: hooks/relay_protocol.ts defines no ${VARIABLE_CONSTANT}" >&2; exit 2; }
defined_in_harness() { sed -n "s/^export const $1 = '\([^']*\)'$/\1/p" "${HARNESS}"; }
HOST_VARIABLE="$(defined_in_harness RECORDED_HOST_VARIABLE)"
HOST_TERMINAL="$(defined_in_harness HOST_TERMINAL)"
[[ -n "${HOST_VARIABLE}" && -n "${HOST_TERMINAL}" ]] || { echo "prove_the_relay_loads: ${HARNESS} defines no RECORDED_HOST_VARIABLE or HOST_TERMINAL" >&2; exit 2; }

npm install --prefix "${WORK}/host" --no-save --no-package-lock --no-audit --no-fund "@anthropic-ai/claude-code@${version}" > /dev/null \
  || { echo "prove_the_relay_loads: Claude Code ${version} could not be installed" >&2; exit 2; }
claude="${WORK}/host/node_modules/.bin/claude"
said="$("${claude}" --version)"
[[ "${said%% *}" == "${version}" ]] || { echo "prove_the_relay_loads: installed a host that says '${said}', not ${version}" >&2; exit 2; }

if ! "${claude}" plugin validate "${RELAY}"; then
  echo "prove_the_relay_loads: Claude Code ${version}, the recorded host, does not load ${RELAY}" >&2
  exit 1
fi

# The check bites: the relay with the line #104 fixed put back is refused by this host.
cp -R "${RELAY}" "${WORK}/broken_relay"
sed -i "s/\$\.env\.get('${variable}')/\$.env.get(${VARIABLE_CONSTANT})/" "${WORK}/broken_relay/${REGISTER}"
grep -q "\$\.env\.get(${VARIABLE_CONSTANT})" "${WORK}/broken_relay/${REGISTER}" || { echo "prove_the_relay_loads: could not plant the #104 line in a copy of ${REGISTER}" >&2; exit 1; }
if "${claude}" plugin validate "${WORK}/broken_relay" > "${WORK}/broken.txt" 2>&1; then
  echo "prove_the_relay_loads: Claude Code ${version} loads a relay that reads its variable by a constant; this check would not bite" >&2
  exit 1
fi
grep -q "takes a literal name" "${WORK}/broken.txt" || { echo "prove_the_relay_loads: the planted relay was refused for another reason:" >&2; cat "${WORK}/broken.txt" >&2; exit 1; }

echo "prove_the_relay_loads: Claude Code ${version} loads the relay, and refuses it with the #104 line planted"

# The check bites (martha#117): on a writable copy, this host writes its types on an interactive start.
writes="${WORK}/writes"
mkdir -p "${writes}/home" "${writes}/project"
cp -R "${RELAY}" "${writes}/relay"
printf '{"hasCompletedOnboarding":true,"projects":{"%s":{"hasTrustDialogAccepted":true}}}\n' "${writes}/project" > "${writes}/home/.claude.json"
(cd "${writes}/project" && exec env -i HOME="${writes}/home" PATH="${PATH}" TERM="${HOST_TERMINAL}" \
  script -qfec "'${claude}' --plugin-dir '${writes}/relay'" /dev/null < /dev/null > /dev/null 2>&1) &
started=$!
for _ in $(seq "${HOST_WRITES_WITHIN_S}"); do
  [[ -f "${writes}/relay/${HOST_TYPES_FILE}" ]] && break
  sleep 1
done
pkill -KILL -P "${started}" 2> /dev/null || true
kill -KILL "${started}" 2> /dev/null || true
wait "${started}" 2> /dev/null || true
[[ -f "${writes}/relay/${HOST_TYPES_FILE}" ]] || { echo "prove_the_relay_loads: Claude Code ${version} wrote no ${HOST_TYPES_FILE} into a writable relay folder within ${HOST_WRITES_WITHIN_S} s; the launch check would not bite" >&2; exit 1; }

echo "prove_the_relay_loads: with Claude Code ${version}, the host writes its types into a writable relay folder"

env "${HOST_VARIABLE}=${claude}" "${HERE}/run_the_recorded_host_runs.sh"

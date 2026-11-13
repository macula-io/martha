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
# bites: this host, started interactively on a writable copy of the relay, writes its types there. Then the launcher's
# test that starts this host on an owner's terminal must run and pass, comparing the installed folder before and after.
# The host runs with no account and no key, in a home that says onboarding is done and the folder is trusted.
#
# Last, a member's own writes do not stop it and an outsider's change does (martha#132): the real martha command, this
# host, the relay and the launcher, with only the model a stand-in. Those four cases must all run and pass.
#
# Then every rule the launch writes is one this host's file permission checks match, and the same run names an inert
# twin of one (martha#226): the question the launch now asks before it starts a member, put to this host's own binary.
#
# And a member's model switch is run in this host, not only against a stand-in (martha#315, design test 8): the host's
# own model command answers "Set model to ...", the row then says that model, and a review off the crew's reviewer model
# is refused with the model named. Those two cases need this binary too, so they run here or nowhere (r=2, 3a).
#
# And a permission prompt this host really draws for a member Martha launched reaches the owner's row and clears once
# the owner answers it at the terminal (martha#363, design test 12 of martha#313). It needs this binary too.
#
# Exit: 0 the recorded host loads the relay and a launch leaves it as it was, 1 it does not (or a check did not bite),
# 2 the host could not be set up.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
RECORDING="${REPO}/src/claude_code_host/recorded_claude_code_host.json"
RELAY="${REPO}/src/claude_code_relay"
REGISTER="hooks/register.ts"
LAUNCH_TESTS="${REPO}/src/launch_a_claude_code_member/launch_a_claude_code_member.node-test.ts"
LAUNCH_TEST="a launch leaves the installed relay folder as it was"
HARNESS="${REPO}/src/launch_a_claude_code_member/drive_the_recorded_host.ts"
OWN_WRITES_TESTS="${REPO}/src/launch_a_claude_code_member/own_writes_on_the_recorded_host.node-test.ts"
RULES_TESTS="${REPO}/src/refuse_a_member_writing_owner_memory/the_rules_the_host_matches.node-test.ts"
SWITCH_TESTS="${REPO}/src/launch_a_claude_code_member/a_switch_on_the_recorded_host.node-test.ts"
PROMPT_TESTS="${REPO}/src/launch_a_claude_code_member/a_permission_prompt_on_the_recorded_host.node-test.ts"
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

# A launch on the owner's terminal leaves the installed relay folder as it was (martha#117).
if ! env "${HOST_VARIABLE}=${claude}" node --test --test-reporter=spec --test-name-pattern="${LAUNCH_TEST}" "${LAUNCH_TESTS}" > "${WORK}/launch.txt" 2>&1; then
  echo "prove_the_relay_loads: a launch with Claude Code ${version} changed the installed relay folder, or its test failed:" >&2
  cat "${WORK}/launch.txt" >&2
  exit 1
fi
grep -q '^ℹ pass 1$' "${WORK}/launch.txt" && grep -q '^ℹ skipped 0$' "${WORK}/launch.txt" \
  || { echo "prove_the_relay_loads: the launch test did not run exactly once:" >&2; cat "${WORK}/launch.txt" >&2; exit 1; }

echo "prove_the_relay_loads: with Claude Code ${version}, a launch leaves the installed relay folder as it was, and the host writes into a writable one"

# A member's own writes do not stop it, and an outsider's change does (martha#132).
own_writes_cases="$(grep -c '^test(' "${OWN_WRITES_TESTS}")"
if ! env "${HOST_VARIABLE}=${claude}" node --test --test-reporter=spec --test-timeout=300000 "${OWN_WRITES_TESTS}" > "${WORK}/own_writes.txt" 2>&1; then
  echo "prove_the_relay_loads: with Claude Code ${version}, a member's own writes stopped it, an outsider's change did not, or a run failed:" >&2
  cat "${WORK}/own_writes.txt" >&2
  exit 1
fi
grep -q "^ℹ pass ${own_writes_cases}$" "${WORK}/own_writes.txt" && grep -q '^ℹ skipped 0$' "${WORK}/own_writes.txt" \
  || { echo "prove_the_relay_loads: the own-writes cases did not all run:" >&2; cat "${WORK}/own_writes.txt" >&2; exit 1; }

echo "prove_the_relay_loads: with Claude Code ${version}, a member's own writes do not stop it and an outsider's change does"

# Every rule the launch writes is one this host's file permission checks match, and an inert twin of one is named in
# the same run (martha#226): the question the launch asks before it starts a member, put to this host itself.
if ! env "${HOST_VARIABLE}=${claude}" node --test --test-reporter=spec --test-timeout=300000 "${RULES_TESTS}" > "${WORK}/rules.txt" 2>&1; then
  echo "prove_the_relay_loads: with Claude Code ${version}, the host names a rule the launch writes as one it can never match, or the reading sees nothing:" >&2
  cat "${WORK}/rules.txt" >&2
  exit 1
fi
grep -q '^ℹ pass 1$' "${WORK}/rules.txt" && grep -q '^ℹ skipped 0$' "${WORK}/rules.txt" \
  || { echo "prove_the_relay_loads: the rule case did not run exactly once:" >&2; cat "${WORK}/rules.txt" >&2; exit 1; }

echo "prove_the_relay_loads: with Claude Code ${version}, the host matches every rule the launch writes, and names an inert twin of one"

# A member's model switch is run in this host (martha#315, design test 8): the whole way round — the tool, the record,
# the order, and the host's own model command — and a review off the crew's reviewer model refused by name. The ordinary
# gate skips both tests for want of this binary, so a run that skipped them proves nothing and is a failure here.
switch_cases="$(grep -c '^test(' "${SWITCH_TESTS}")"
if ! env "${HOST_VARIABLE}=${claude}" node --test --test-reporter=spec --test-timeout=300000 "${SWITCH_TESTS}" > "${WORK}/switch.txt" 2>&1; then
  echo "prove_the_relay_loads: with Claude Code ${version}, a member's model switch did not reach this host, a review off the reviewer model ran, or a case failed:" >&2
  cat "${WORK}/switch.txt" >&2
  exit 1
fi
grep -q "^ℹ pass ${switch_cases}$" "${WORK}/switch.txt" && grep -q '^ℹ skipped 0$' "${WORK}/switch.txt" \
  || { echo "prove_the_relay_loads: the model-switch cases did not all run in this host; a skipped case proves nothing:" >&2; cat "${WORK}/switch.txt" >&2; exit 1; }

echo "prove_the_relay_loads: with Claude Code ${version}, a member switches its model in this host and a review off the reviewer model is refused"

# A permission prompt this host draws reaches the owner's row and clears once answered (martha#363, design test 12 of
# martha#313): the seam between the dialog order prove_the_order_of_the_dialogs.mjs measures and the row the relay test
# moves. The ordinary gate skips it for want of this binary, so a run that skipped it proves nothing and is a failure.
prompt_cases="$(grep -c '^test(' "${PROMPT_TESTS}")"
if ! env "${HOST_VARIABLE}=${claude}" node --test --test-reporter=spec --test-timeout=300000 "${PROMPT_TESTS}" > "${WORK}/prompt.txt" 2>&1; then
  echo "prove_the_relay_loads: with Claude Code ${version}, a permission prompt did not reach the owner's row, did not clear once answered, or a case failed:" >&2
  cat "${WORK}/prompt.txt" >&2
  exit 1
fi
grep -q "^ℹ pass ${prompt_cases}$" "${WORK}/prompt.txt" && grep -q '^ℹ skipped 0$' "${WORK}/prompt.txt" \
  || { echo "prove_the_relay_loads: the permission-prompt case did not run in this host; a skipped case proves nothing:" >&2; cat "${WORK}/prompt.txt" >&2; exit 1; }

echo "prove_the_relay_loads: with Claude Code ${version}, a permission prompt reaches the owner's row and clears once the owner answers it"

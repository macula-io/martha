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
# Exit: 0 the recorded host loads the relay, 1 it does not (or the check did not bite), 2 the host could not be set up.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
RECORDING="${REPO}/src/claude_code_host/recorded_claude_code_host.json"
RELAY="${REPO}/src/claude_code_relay"
REGISTER="hooks/register.ts"
VARIABLE_CONSTANT="RELAY_SOCKET_VARIABLE"
WORK="${1:-$(mktemp -d)}"
mkdir -p "${WORK}"
trap 'rm -rf "${WORK}"' EXIT

version="$(jq -r '.host_version // empty' "${RECORDING}")"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "prove_the_relay_loads: ${RECORDING} names no host version" >&2; exit 2; }
variable="$(sed -n "s/^export const ${VARIABLE_CONSTANT} = '\([A-Z_]*\)'$/\1/p" "${RELAY}/hooks/relay_protocol.ts")"
[[ -n "${variable}" ]] || { echo "prove_the_relay_loads: hooks/relay_protocol.ts defines no ${VARIABLE_CONSTANT}" >&2; exit 2; }

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

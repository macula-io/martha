#!/usr/bin/env bash
# watch_kitty_hold_the_strips_line.sh: the live K6 observation for macula-io/martha#547 S6 (`npm run watch:kitty`).
#
# Opens a kitty exactly as bare `martha start` does (the session text, the checker and kitty's arguments come from
# src/open_the_crew_in_kitty, never typed here), with two stand-in members in place of real ones, and watches the
# remote-control lock hold on this machine's kitty:
#   1. from inside a member's window, a request gets "Remote control is disabled", with no dialog;
#   2. from the strip's own line, set-tab-title and resize-window --self work, while send-text and launch are refused;
#   3. a set-tab-title request written from outside into a strip's /dev/pts/N is refused, and kitty says so to that tty.
# The member-facing half (a real member's strip line, its title mark, the notification, the tab kept after it exits) is
# T7's observation in #572, run beside this one.
#
# Run it on the desktop session, from any terminal: a kitty window opens for a few seconds and closes itself.
# Exit: 0 every check passed, 1 one did not (it says which, by name), 2 the observation could not be set up.
set -euo pipefail

say() { echo "watch_kitty_hold_the_strips_line: $*"; }
for tool in kitty kitten node bash timeout mktemp; do
  command -v "${tool}" >/dev/null 2>&1 || { say "needs ${tool} on the PATH" >&2; exit 2; }
done
[[ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]] || { say "needs a desktop session (WAYLAND_DISPLAY or DISPLAY): run it on the machine's own screen" >&2; exit 2; }

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SRC="${HERE}/../../src/open_the_crew_in_kitty"
WORK="$(mktemp -d)"
KITTY_PID=''
cleanup() {
  [[ -n "${KITTY_PID}" ]] && kill "${KITTY_PID}" 2>/dev/null || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

# The stand-in for this release of martha: `start <member>` probes the member's window, `crew --tab-of <member>` the
# strip's line. Each writes what it saw into ${WORK}/<member>.<probe>, then waits to be killed with the kitty.
cat > "${WORK}/martha" <<'STANDIN'
#!/usr/bin/env bash
out="$(dirname "$0")"
case "$1" in
  start)
    member="$2"
    kitten @ set-tab-title "member-${member}" > "${out}/${member}.member" 2>&1; echo "exit=$?" >> "${out}/${member}.member"
    exec sleep 600 ;;
  crew)
    member="$3"
    { kitten @ set-tab-title "strip-${member}" >/dev/null 2>&1; echo "set-tab-title=$?"
      kitten @ resize-window --self --axis=vertical --increment=1 >/dev/null 2>&1; echo "resize-window=$?"
      kitten @ send-text "should not arrive" >/dev/null 2>&1; echo "send-text=$?"
      kitten @ launch --type=background true >/dev/null 2>&1; echo "launch=$?"; } > "${out}/${member}.strip.part"
    mv "${out}/${member}.strip.part" "${out}/${member}.strip"
    stty raw -echo
    tty > "${out}/${member}.tty.part" && mv "${out}/${member}.tty.part" "${out}/${member}.tty"
    timeout 15 cat > "${out}/${member}.answer" || true
    exec sleep 600 ;;
esac
STANDIN
chmod 0700 "${WORK}/martha"

# The session, the checker, kitty's arguments, kitty's environment and the faked request, from Martha's own functions
# and constants: the KITTY_ prefix and kitty's version are never typed here.
node --input-type=module -e "
import { writeFileSync } from 'node:fs'
import { KITTY_FLOOR, THE_STRIPS_ACTIONS, theCheckerSource, theKittyArguments, theSessionText, withoutKittysVariables } from '${SRC}/the_session_kitty_reads.ts'
import { CHECKER_FILE, SESSION_FILE } from '${SRC}/open_the_crew_in_kitty.ts'
const [work] = process.argv.slice(1)
const checker = work + '/' + CHECKER_FILE
const session = theSessionText({ root: work, members: ['Alpha', 'Beta'], martha: ['bash', work + '/martha'], checker })
if ('refusal' in session) { console.error(session.refusal); process.exit(2) }
writeFileSync(checker, theCheckerSource(THE_STRIPS_ACTIONS), { mode: 0o600 })
writeFileSync(work + '/' + SESSION_FILE, session.text, { mode: 0o600 })
writeFileSync(work + '/kitty.args', theKittyArguments(work + '/' + SESSION_FILE).join('\n'))
writeFileSync(work + '/kitty.env', Object.entries(withoutKittysVariables(process.env)).map(([name, value]) => name + '=' + value + '\\0').join(''), { mode: 0o600 })
const faked = { cmd: 'set-tab-title', version: KITTY_FLOOR.split('.').map(Number), payload: { title: 'FAKED' } }
writeFileSync(work + '/faked.request', '\\x1bP@kitty-cmd' + JSON.stringify(faked) + '\\x1b\\\\')
" "${WORK}" || { say "Martha's session text could not be made" >&2; exit 2; }

mapfile -t args < "${WORK}/kitty.args"
mapfile -d '' -t kittys_env < "${WORK}/kitty.env"
env -i "${kittys_env[@]}" kitty "${args[@]}" >"${WORK}/kitty.log" 2>&1 &
KITTY_PID=$!

waitFor() { # file seconds
  for _ in $(seq 1 $(( $2 * 4 ))); do [[ -e "$1" ]] && return 0; sleep 0.25; done
  return 1
}

status=0
check() { # name, then the command that must succeed
  local name=$1; shift
  if "$@"; then say "PASS ${name}"; else say "FAIL ${name}"; status=1; fi
}

for member in Alpha Beta; do
  waitFor "${WORK}/${member}.member" 20 && waitFor "${WORK}/${member}.strip" 20 && waitFor "${WORK}/${member}.tty" 20 \
    || { say "the kitty never ran ${member}'s tab (kitty's own output: ${WORK}/kitty.log)" >&2; cat "${WORK}/kitty.log" >&2; exit 2; }
done

# 3: the owner's uid writes a set-tab-title request into Beta's strip terminal, as a member could; kitty answers it there.
cat "${WORK}/faked.request" > "$(cat "${WORK}/Beta.tty")"
sleep 3

for member in Alpha Beta; do
  check "${member}: a request from the member's window is refused with remote control disabled" grep -q 'Remote control is disabled' "${WORK}/${member}.member"
  check "${member}: the strip titles its own tab" grep -qx 'set-tab-title=0' "${WORK}/${member}.strip"
  check "${member}: the strip resizes its own window" grep -qx 'resize-window=0' "${WORK}/${member}.strip"
  check "${member}: send-text on the strip's line is refused" grep -Eqx 'send-text=[1-9][0-9]*' "${WORK}/${member}.strip"
  check "${member}: launch on the strip's line is refused" grep -Eqx 'launch=[1-9][0-9]*' "${WORK}/${member}.strip"
done
check "Beta: a title written into the strip's terminal from outside is refused" grep -q '"ok": *false' "${WORK}/Beta.answer"

if [[ "${status}" -eq 0 ]]; then
  say "all checks passed: you saw a kitty with tabs Alpha and Beta open and close; in it, no member could use remote control, each strip could set only its own tab's title and size, and a title written into a strip's terminal from outside was refused."
fi
exit "${status}"

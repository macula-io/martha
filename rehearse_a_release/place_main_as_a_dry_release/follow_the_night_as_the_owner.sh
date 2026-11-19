#!/usr/bin/env bash
# follow_the_night_as_the_owner.sh <the night's run folder>
#
# The owner's one script for a live night (macula-io/martha#639, driven by run_the_night_on_main.sh, #696). Whoever
# starts the night sends the owner its run folder's path. The owner runs this in a terminal of their own; it only
# follows that folder:
#
#   - when the proof prints the owner's command (a line in proof.log starting with two spaces and `ssh -t `), this
#     prints that exact command and the numbered steps under it, waits for Enter, and runs it here, in the terminal.
#     The first: approve each crew place where martha approve asks (nothing where it says Nothing to approve), sign in
#     to Claude, answer the folder question yes, then /exit. The second, once the builder has queued the landing:
#     it attaches to the builder's terminal; answer the landing's menu yes, then detach with Ctrl-b, then d.
#   - when the driver writes proof_exit=, result= or interrupted= to run.txt, the night has ended: this prints
#     run.txt and ends.
#
# It runs nothing once the night has ended: the end is read before each command is offered, and again after Enter.
# It refuses to start without a terminal of its own (through Claude Code's `!` there is none, a read meets its end at
# once and a command would run unconfirmed), and a read that fails runs nothing.
#
# This script makes no GitHub call, reads no token, and writes nothing.
set -uo pipefail

REFUSED=2
NO_TERMINAL='no terminal: run this in a terminal of your own, not through !'
NO_ANSWER='no answer read: owner command not run'
PROMPT='Press Enter to run it here: '
ENDED='--- the night ended'

RUN="${1:-}"
[ -n "${RUN}" ] || { echo "usage: follow_the_night_as_the_owner.sh <the night's run folder>" >&2; exit "${REFUSED}"; }
for tool in ssh awk grep sed date sleep; do
  command -v "${tool}" > /dev/null || { echo "${tool} is not on your PATH" >&2; exit "${REFUSED}"; }
done
if ! { [ -t 0 ] && [ -t 1 ]; }; then
  echo "${NO_TERMINAL}" >&2
  exit "${REFUSED}"
fi
LOG="${RUN}/proof.log"
RUN_TXT="${RUN}/run.txt"

night_ended() { grep -q '^proof_exit=\|^result=\|^interrupted=' "${RUN_TXT}" 2> /dev/null; }
the_night_ended() {
  printf '\n%s\n' "${ENDED}"
  cat "${RUN_TXT}"
  exit 0
}

echo "waiting for ${LOG} (Ctrl-C stops following; the run itself goes on)"
until [ -f "${LOG}" ]; do
  if night_ended; then the_night_ended; fi
  sleep 1
done

done_cmds=0
while :; do
  # The end is read before any command: a command from a night that has ended is never offered.
  if night_ended; then the_night_ended; fi
  mapfile -t cmds < <(sed -n 's/^  \(ssh -t .*\)$/\1/p' "${LOG}" 2> /dev/null)
  if [ "${#cmds[@]}" -gt "${done_cmds}" ]; then
    line="${cmds[${done_cmds}]}"
    done_cmds=$((done_cmds + 1))
    printf '\n== owner command %d (%s)\n' "${done_cmds}" "$(date '+%T')"
    printf '   $ %s\n' "${line}"
    # The steps printed under the Nth command, up to the line that names /exit.
    awk -v n="${done_cmds}" '
      /^  ssh -t / { seen++; left = (seen == n) ? 6 : 0; next }
      left > 0 { print " " $0; left--; if ($0 ~ /\/exit|detach:/) left = 0 }' "${LOG}"
    if ! read -r -p "${PROMPT}" _; then
      printf '\n%s (%d)\n' "${NO_ANSWER}" "${done_cmds}" >&2
      exit "${REFUSED}"
    fi
    # The night may have ended while the prompt waited.
    if night_ended; then the_night_ended; fi
    bash -c "${line}"
    printf '== owner command %d ended (exit %d)\n' "${done_cmds}" "$?"
    continue
  fi
  sleep 2
done

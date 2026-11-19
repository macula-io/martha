#!/usr/bin/env bash
# follow_the_night_as_the_owner.sh <the night's run folder>
#
# The owner's one script for a live night (macula-io/martha#639, driven by run_the_night_on_main.sh, #696). Whoever
# starts the night sends the owner its run folder's path. The owner runs this in a terminal of their own; it only
# follows that folder:
#
#   - when the proof adds an owner's command to its owner-commands file (run.txt names it, owner_commands=), this
#     prints that exact command and the numbered steps the proof printed under it, waits for Enter, and runs it here,
#     in the terminal. The first: approve each crew place where martha approve asks (nothing where it says Nothing to
#     approve), sign in to Claude, answer the folder question yes, then /exit. The second, once the builder has queued
#     the landing: it attaches to the builder's terminal; answer the landing's menu yes, then detach with Ctrl-b, then d.
#   - when the driver writes proof_exit=, result= or interrupted= to run.txt, the night has ended: this prints
#     run.txt and ends.
#
# Who writes what it runs (the threat model on #639): proof.log carries the members' transcripts and screens, and the
# members read stranger text, so no command is ever taken from it. A command comes only from the owner-commands file,
# which the proof alone writes, and is refused unless it is exactly `ssh -t '<the host run.txt names>' '<podman exec
# -it …>'`, one word quoted the way the proof quotes, with no control character in it. The steps shown under it are
# read from proof.log under the line that echoes that exact command, their control characters stripped; they are only
# shown, never run.
#
# It runs nothing once the night has ended: the end is read before each command is offered, and again after Enter.
# It refuses to start without a terminal of its own (through Claude Code's `!` there is none, a read meets its end at
# once and a command would run unconfirmed), and a read that fails runs nothing.
#
# This script makes no GitHub call, reads no token, and writes nothing.
set -uo pipefail
export LC_ALL=C

REFUSED=2
NO_TERMINAL='no terminal: run this in a terminal of your own, not through !'
NO_ANSWER='no answer read: owner command not run'
NOT_THE_PROOFS='refused, not run: this line is not the proof'"'"'s owner command'
PROMPT='Press Enter to run it here: '
ENDED='--- the night ended'
# What every owner command runs on the host, before it is quoted as one word: a terminal in the night's container.
REMOTE_LEAD="'podman' 'exec' '-it' '"
# A quote inside a quoted word, as the proof writes it: close the quote, an escaped quote, open it again.
QUOTE_IN_A_WORD="'\\''"
# What the host's shell may be given: words each quoted that way, one space apart, and nothing else.
HOST_WORDS=$'^\'([^\']|\'\\\\\'\')*\'( \'([^\']|\'\\\\\'\')*\')*$'
# How many lines the proof prints under an owner command, at most, before the step that ends it.
STEPS_SHOWN=6

RUN="${1:-}"
[ -n "${RUN}" ] || { echo "usage: follow_the_night_as_the_owner.sh <the night's run folder>" >&2; exit "${REFUSED}"; }
for tool in ssh awk grep sed date sleep cat wc head; do
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
from_run_txt() { sed -n "s/^$1=//p" "${RUN_TXT}" 2> /dev/null | head -1; }

# A command is the proof's only when it has no control character and is exactly ssh -t, the host run.txt names, and
# one word quoted as the proof quotes it. That word, unquoted once, is what the host's shell runs: it must be nothing
# but words each quoted the same way, one space apart, as the proof's remote_words makes them, and they must start
# podman exec -it. So no ; or other shell text can follow the exec on the host (Mercurius, #639 PR 821 r=1).
the_proofs_shape() {
  local line="$1" lead rest inner
  [[ "${line}" != *[[:cntrl:]]* ]] || { echo 'it holds a control character'; return 1; }
  lead="ssh -t '${HOST}' "
  [[ "${line}" == "${lead}"* ]] || { echo "it does not start ssh -t '${HOST}'"; return 1; }
  rest="${line#"${lead}"}"
  [[ "${rest}" =~ ^\'([^\']|\'\\\'\')*\'$ ]] || { echo 'what it runs on the host is not one quoted word'; return 1; }
  inner="${rest:1:${#rest}-2}"
  inner="${inner//"${QUOTE_IN_A_WORD}"/\'}"
  [[ "${inner}" =~ ${HOST_WORDS} ]] || { echo 'what the host runs is not only quoted words'; return 1; }
  [[ "${inner}" == "${REMOTE_LEAD}"* ]] || { echo 'it does not run podman exec -it on the host'; return 1; }
}

echo "waiting for the night's owner commands (Ctrl-C stops following; the run itself goes on)"
until [ -n "$(from_run_txt owner_commands)" ]; do
  if night_ended; then the_night_ended; fi
  sleep 1
done
COMMANDS="$(from_run_txt owner_commands)"
HOST="$(from_run_txt host)"
[[ "${HOST}" =~ ^[A-Za-z0-9._@-]+$ ]] || { echo "run.txt names no host this script can check a command against: '${HOST}'" >&2; exit "${REFUSED}"; }

done_cmds=0
while :; do
  # The end is read before any command: a command from a night that has ended is never offered.
  if night_ended; then the_night_ended; fi
  # Only whole lines: a line the proof is still writing has no newline yet.
  complete="$(wc -l < "${COMMANDS}" 2> /dev/null || echo 0)"
  if [ "${complete}" -gt "${done_cmds}" ]; then
    mapfile -t -n "${complete}" cmds < "${COMMANDS}"
    line="${cmds[${done_cmds}]}"
    done_cmds=$((done_cmds + 1))
    if ! why="$(the_proofs_shape "${line}")"; then
      printf '\n%s (owner command %d: %s)\n' "${NOT_THE_PROOFS}" "${done_cmds}" "${why}" >&2
      exit "${REFUSED}"
    fi
    printf '\n== owner command %d (%s)\n' "${done_cmds}" "$(date '+%T')"
    printf '   $ %s\n' "${line}"
    # The steps the proof printed under this exact command, up to the line that names /exit or detaching.
    awk -v command="  ${line}" -v most="${STEPS_SHOWN}" '
      $0 == command { left = most; next }
      left > 0 { gsub(/[[:cntrl:]]/, ""); print " " $0; left--; if ($0 ~ /\/exit|detach:/) left = 0 }' "${LOG}" 2> /dev/null
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

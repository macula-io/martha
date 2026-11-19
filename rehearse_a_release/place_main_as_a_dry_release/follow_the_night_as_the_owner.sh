#!/usr/bin/env bash
# follow_the_night_as_the_owner.sh <the night's run folder> <ssh-host>
#
# The owner's one script for a live night (macula-io/martha#639, driven by run_the_night_on_main.sh, #696). Whoever
# starts the night sends the owner its run folder's path. The owner runs this in a terminal of their own, naming the
# host the night runs on themselves (run.txt is written by whoever started the night, so its host= must agree with the
# owner's, never stand in for it); it only follows that folder:
#
#   - when the proof adds an owner's command to its owner-commands file (run.txt names it, owner_commands=), this
#     prints that exact command and the numbered steps the proof printed under it, waits for Enter, and runs it here,
#     in the terminal. The first: approve each crew place where martha approve asks (nothing where it says Nothing to
#     approve), sign in to Claude, answer the folder question yes, then /exit. The second, once the builder has queued
#     the landing: it attaches to the builder's terminal; answer the landing's menu yes, then detach with Ctrl-b, then d.
#     Between them, before the package is typed, the watch (martha#843): it shows the builder's terminal read-only, so
#     the builder's ring reaches the owner's terminal; keep it open until the night ends.
#   - when the driver writes proof_exit=, result= or interrupted= to run.txt, the night has ended: this prints
#     run.txt and one last line, PASSED with exit 0 when proof_exit= equals the dry_passed= the driver read from the
#     proof, and NOT_PASSED naming what ended it, with exit 1, otherwise.
#
# Who writes what it runs (the threat model on #639): proof.log carries the members' transcripts and screens, and the
# members read stranger text, so no command is ever taken from it. A command comes only from the owner-commands file,
# which the proof alone writes, and is refused unless it is exactly `ssh -t '<the owner's host>' '<podman exec -it …>'`,
# one word quoted the way the proof quotes, with no control character in it, and that word is one of the proof's two
# commands: podman exec -it in the night's own container (the proof's CONTAINER_PREFIX, then its pid and a number, and
# nothing between -it and that name), running either `sh -lc '<one word>'` (the sign-in), `tmux -L <the night's
# NIGHT_TMUX_SOCKET> attach -t <the night's builder>` (the attach), or the same attach with exactly the night's NIGHT_WATCH_FLAG
# before -t (the watch, martha#843). The names are read from the proof beside this script, never spelled here
# (Saturnus, #639 PR 821 r=1). The steps shown under it are
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
PASSED='the night passed (a dry pass)'
NOT_PASSED='the night did not pass'
# What every owner command runs on the host, before it is quoted as one word: a terminal in the night's container.
REMOTE_LEAD="'podman' 'exec' '-it' '"
# A quote inside a quoted word, as the proof writes it: close the quote, an escaped quote, open it again.
QUOTE_IN_A_WORD="'\\''"
# How many lines the proof prints under an owner command, at most, before the step that ends it.
STEPS_SHOWN=6
# What the host's name may be: no leading -, so ssh never reads it as an option.
HOST_NAME=$'^[A-Za-z0-9][A-Za-z0-9._@-]*$'
# The proof, beside this script in the checkout, whose words the commands are held to.
PROOF_DIR='prove_a_clean_install_in_a_throwaway_container'

RUN="${1:-}"
HOST="${2:-}"
[ -n "${RUN}" ] && [ -n "${HOST}" ] || { echo "usage: follow_the_night_as_the_owner.sh <the night's run folder> <ssh-host>" >&2; exit "${REFUSED}"; }
[[ "${HOST}" =~ ${HOST_NAME} ]] || { echo "not a host this script can check a command against: '${HOST}'" >&2; exit "${REFUSED}"; }
for tool in ssh awk grep sed date sleep cat wc head dirname; do
  command -v "${tool}" > /dev/null || { echo "${tool} is not on your PATH" >&2; exit "${REFUSED}"; }
done

# The word NAME a script defines on a line of its own, NAME='<word>': exactly one line starts NAME=, or nothing.
a_scripts_word() {
  local lines
  lines="$(sed -n "/^$2=/p" "$1" 2> /dev/null)"
  [[ -n "${lines}" && "${lines}" != *$'\n'* && "${lines}" =~ ^$2=\'([A-Za-z0-9._-]+)\'$ ]] && printf '%s\n' "${BASH_REMATCH[1]}"
}
PROOF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/${PROOF_DIR}"
CONTAINER_PREFIX="$(a_scripts_word "${PROOF}/${PROOF_DIR}.sh" CONTAINER_PREFIX)" \
  || { echo "the proof at ${PROOF} defines no CONTAINER_PREFIX" >&2; exit "${REFUSED}"; }
NIGHT_TMUX_SOCKET="$(a_scripts_word "${PROOF}/the_night_in_the_container.sh" NIGHT_TMUX_SOCKET)" \
  || { echo "the proof at ${PROOF} defines no NIGHT_TMUX_SOCKET" >&2; exit "${REFUSED}"; }
WATCH_FLAG="$(a_scripts_word "${PROOF}/the_night_in_the_container.sh" NIGHT_WATCH_FLAG)" \
  || { echo "the proof at ${PROOF} defines no NIGHT_WATCH_FLAG" >&2; exit "${REFUSED}"; }
BUILDER="$(a_scripts_word "${PROOF}/${PROOF_DIR}.sh" THE_BUILDER)" \
  || { echo "the proof at ${PROOF} defines no THE_BUILDER" >&2; exit "${REFUSED}"; }
if ! { [ -t 0 ] && [ -t 1 ]; }; then
  echo "${NO_TERMINAL}" >&2
  exit "${REFUSED}"
fi
LOG="${RUN}/proof.log"
RUN_TXT="${RUN}/run.txt"

night_ended() { grep -q '^proof_exit=\|^result=\|^interrupted=' "${RUN_TXT}" 2> /dev/null; }
from_run_txt() { sed -n "s/^$1=//p" "${RUN_TXT}" 2> /dev/null | head -1; }
# The end: run.txt, then one line the owner reads without knowing the proof's codes. A pass is only proof_exit= equal
# to the driver's dry_passed=, with no result= or interrupted= beside it.
the_night_ended() {
  local proof_exit dry_passed why
  printf '\n%s\n' "${ENDED}"
  cat "${RUN_TXT}"
  proof_exit="$(from_run_txt proof_exit)"
  dry_passed="$(from_run_txt dry_passed)"
  why="$(grep -m1 '^result=\|^interrupted=' "${RUN_TXT}" 2> /dev/null)"
  if [ -z "${why}" ] && [ -n "${proof_exit}" ] && [ "${proof_exit}" = "${dry_passed}" ]; then
    printf '%s\n' "${PASSED}"
    exit 0
  fi
  printf '%s: %s\n' "${NOT_PASSED}" "${why:-proof_exit=${proof_exit}}"
  exit 1
}

# A command is the proof's only when it has no control character and is exactly ssh -t, the owner's host, and
# one word quoted as the proof quotes it. That word, unquoted once, is what the host's shell runs, and it must be one of
# the proof's two commands word for word, each word quoted as the proof's remote_words quotes it: podman exec -it in
# the night's container, nothing between, then the sign-in or the attach (Saturnus, #639 PR 821 r=1). Nothing else is
# a word there, so no ; or other shell text can follow the exec on the host (Mercurius, r=1): the exact shapes hold
# that, and the check of quoted words r=1 added is theirs now.
the_proofs_shape() {
  local line="$1" lead rest inner
  [[ "${line}" != *[[:cntrl:]]* ]] || { echo 'it holds a control character'; return 1; }
  lead="ssh -t '${HOST}' "
  [[ "${line}" == "${lead}"* ]] || { echo "it does not start ssh -t '${HOST}'"; return 1; }
  rest="${line#"${lead}"}"
  [[ "${rest}" =~ ^\'([^\']|\'\\\'\')*\'$ ]] || { echo 'what it runs on the host is not one quoted word'; return 1; }
  inner="${rest:1:${#rest}-2}"
  inner="${inner//"${QUOTE_IN_A_WORD}"/\'}"
  [[ "${inner}" =~ ^"${REMOTE_LEAD}${CONTAINER_PREFIX}"-[0-9]+-[0-9]+\'\ (.*)$ ]] || { echo "it does not run podman exec -it in the night's container"; return 1; }
  rest="${BASH_REMATCH[1]}"
  [[ "${rest}" =~ ^\'sh\'\ \'-lc\'\ \'([^\']|\'\\\'\')*\'$ ]] && return 0
  # The attach, and the watch (martha#843): the attach with the night's read-only flag before -t and no other option.
  # Both name the night's builder and no other member: the builder's is the only terminal the night offers the owner.
  [ "${rest}" = "'tmux' '-L' '${NIGHT_TMUX_SOCKET}' 'attach' '-t' '${BUILDER}'" ] && return 0
  [ "${rest}" = "'tmux' '-L' '${NIGHT_TMUX_SOCKET}' 'attach' '${WATCH_FLAG}' '-t' '${BUILDER}'" ] && return 0
  echo 'what it runs in the container is not the sign-in or the attach'; return 1
}

echo "waiting for the night's owner commands (Ctrl-C stops following; the run itself goes on)"
until [ -n "$(from_run_txt owner_commands)" ]; do
  if night_ended; then the_night_ended; fi
  sleep 1
done
COMMANDS="$(from_run_txt owner_commands)"
RUN_HOST="$(from_run_txt host)"
[ "${RUN_HOST}" = "${HOST}" ] || { echo "run.txt names host '${RUN_HOST}', not yours, '${HOST}': nothing is run" >&2; exit "${REFUSED}"; }

done_cmds=0
while :; do
  # The end is read before any command: a command from a night that has ended is never offered.
  if night_ended; then the_night_ended; fi
  # Only whole lines: a line the proof is still writing has no newline yet.
  complete="$({ wc -l < "${COMMANDS}"; } 2> /dev/null || echo 0)"
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

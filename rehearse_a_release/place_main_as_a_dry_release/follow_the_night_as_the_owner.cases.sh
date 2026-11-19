#!/usr/bin/env bash
# follow_the_night_as_the_owner.cases.sh <script> [case]: the owner's follow script's cases (macula-io/martha#639).
#
# Each case gives the script a night folder of its own: a proof.log naming one owner command (`ssh -t …`) and a
# run.txt, with an `ssh` on PATH that only records that it ran. Cases that need a terminal run the script under
# script(1), which gives it a pseudo-terminal, and type into it. What each case proves is whether the command ran,
# and what the script said. The words the script says are read from the script, never spelled here. With a case
# named, only that case runs; the follow script's node test runs each mutant against the one case that kills it.
# Everything a case makes is under one temp folder, removed on exit.
set -uo pipefail
SUT="${1:?usage: follow_the_night_as_the_owner.cases.sh <script> [case]}"
ONLY="${2:-}"
for tool in script timeout mktemp; do
  command -v "${tool}" > /dev/null || { echo "${tool} is not on PATH" >&2; exit 2; }
done
word() { sed -n "s/^$1='\(.*\)'\$/\1/p" "${SUT}"; }
NO_TERMINAL="$(word NO_TERMINAL)"
NO_ANSWER="$(word NO_ANSWER)"
PROMPT="$(word PROMPT)"
ENDED="$(word ENDED)"
for w in NO_TERMINAL NO_ANSWER PROMPT ENDED; do
  [ -n "${!w}" ] || { echo "${SUT} defines no ${w}" >&2; exit 2; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/bin"
printf '#!/usr/bin/env bash\necho ran >> "${MARK}"\n' > "${WORK}/bin/ssh"
chmod +x "${WORK}/bin/ssh"
export PATH="${WORK}/bin:${PATH}"
fails=0
ran_cases=0

night() { # night <name> <ended 0|1>: a run folder with one owner command; sets RUN and MARK
  RUN="${WORK}/$1"
  mkdir -p "${RUN}"
  export MARK="${RUN}/mark"
  printf 'proof starts\n  ssh -t a-host-of-the-test true\n   1. sign in\n   2. /exit\n' > "${RUN}/proof.log"
  if [ "$2" = 1 ]; then echo 'proof_exit=1' > "${RUN}/run.txt"; else : > "${RUN}/run.txt"; fi
}
in_a_terminal() { timeout 30 script -qefc "bash '${SUT}' '${RUN}'" /dev/null > "${RUN}/out" 2>&1; }
wanted() { [ -z "${ONLY}" ] || [ "${ONLY}" = "$1" ]; }
ran() { [ -s "${MARK}" ]; }
says() { grep -qF -- "$1" "${RUN}/out"; }
verdict() { # verdict <case> <held 0|1> <why>
  ran_cases=$((ran_cases + 1))
  if [ "$2" = 1 ]; then echo "ok   $1"; else echo "FAIL $1: $3"; fails=$((fails + 1)); fi
}
not() { ! "$@"; }

if wanted no_terminal; then
  night no_terminal 0
  printf '\n' | timeout 30 bash "${SUT}" "${RUN}" > "${RUN}/out" 2>&1
  verdict no_terminal "$( { not ran && says "${NO_TERMINAL}"; } && echo 1 || echo 0)" "with no terminal (and an Enter on stdin) the command ran or the refusal was not said"
fi
if wanted ended_before_any_command; then
  night ended_before_any_command 1
  printf '\n' | in_a_terminal
  verdict ended_before_any_command "$( { not ran && says "${ENDED}"; } && echo 1 || echo 0)" "a night that had ended ran its command or did not say it ended"
fi
if wanted ended_offers_no_command; then
  night ended_offers_no_command 1
  printf '\n' | in_a_terminal
  verdict ended_offers_no_command "$( { not ran && not says "${PROMPT}"; } && echo 1 || echo 0)" "a night that had ended still offered its command"
fi
if wanted read_fails_runs_nothing; then
  night read_fails_runs_nothing 0
  printf '\004' | in_a_terminal
  verdict read_fails_runs_nothing "$( { not ran && says "${NO_ANSWER}"; } && echo 1 || echo 0)" "a read that met its end ran the command or did not say so"
fi
if wanted ended_while_the_prompt_waited; then
  night ended_while_the_prompt_waited 0
  { sleep 3; echo 'proof_exit=0' > "${RUN}/run.txt"; printf '\n'; } | in_a_terminal
  verdict ended_while_the_prompt_waited "$( { not ran && says "${ENDED}"; } && echo 1 || echo 0)" "the night ended while the prompt waited, and Enter still ran the command"
fi
if wanted live_night_runs_the_command; then
  night live_night_runs_the_command 0
  { sleep 3; printf '\n'; sleep 3; echo 'proof_exit=0' > "${RUN}/run.txt"; } | in_a_terminal
  verdict live_night_runs_the_command "$( { ran && says "${ENDED}"; } && echo 1 || echo 0)" "on a live night Enter did not run the command, or the end was not followed"
fi

[ "${ran_cases}" -gt 0 ] || { echo "no case named ${ONLY}" >&2; exit 2; }
if [ "${fails}" -gt 0 ]; then echo "cases: ${fails} of ${ran_cases} failed"; exit 1; fi
echo "cases: ${ran_cases} of ${ran_cases} held"

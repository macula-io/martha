#!/usr/bin/env bash
# follow_the_night_as_the_owner.cases.sh <script> [case]: the owner's follow script's cases (macula-io/martha#639).
#
# Each case gives the script a run folder of its own, as the driver leaves one: run.txt naming the host and the
# owner-commands file, that file, and a proof.log echoing each command with its steps under it. An `ssh` on PATH only
# records that it ran. Cases that need a terminal run the script under script(1), which gives it a pseudo-terminal,
# and type into it. What each case proves is whether a command ran, and what the script said. The words the script
# says are read from the script, never spelled here. With a case named, only that case runs; the follow script's node
# test runs each mutant against the one case that kills it. Everything a case makes is under one temp folder, removed
# on exit.
#
# The injection cases are the threat model's (#639): a member's text in proof.log, and a command line with a control
# character in it or not the proof's exact shape, are never offered.
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

A_HOST='a-host-of-the-test'
# One word as the host's shell must read it, quoted the way the proof quotes (remote_word).
one_word() { local w=${1//\'/\'\\\'\'}; printf "'%s'" "${w}"; }
# A command of the proof's shape: ssh -t to `host`, running podman exec -it in a container, and then `what`.
shaped() { printf 'ssh -t %s %s' "$(one_word "$1")" "$(one_word "$(one_word podman) $(one_word exec) $(one_word -it) $(one_word a-container) $2")"; }
THE_COMMAND="$(shaped "${A_HOST}" "$(one_word true)")"

night() { # night <name> <ended 0|1> [command line in the owner-commands file]: a run folder; sets RUN and MARK
  local line="${3-${THE_COMMAND}}"
  RUN="${WORK}/$1"
  mkdir -p "${RUN}"
  export MARK="${RUN}/mark"
  printf 'host=%s\nowner_commands=%s\n' "${A_HOST}" "${RUN}/owner_commands" > "${RUN}/run.txt"
  if [ -n "${line}" ]; then printf '%s\n' "${line}" > "${RUN}/owner_commands"; else : > "${RUN}/owner_commands"; fi
  printf 'proof starts\n  1. run this command:\n  %s\n  2. sign in\n  3. /exit\n' "${line}" > "${RUN}/proof.log"
  if [ "$2" = 1 ]; then echo 'proof_exit=1' >> "${RUN}/run.txt"; fi
}
in_a_terminal() { timeout 30 script -qefc "bash '${SUT}' '${RUN}'" /dev/null > "${RUN}/out" 2>&1; }
wanted() { [ -z "${ONLY}" ] || [ "${ONLY}" = "$1" ]; }
ran() { [ -s "${MARK}" ]; }
says() { grep -qF -- "$1" "${RUN}/out"; }
not() { ! "$@"; }
verdict() { # verdict <case> <held 0|1> <why>
  ran_cases=$((ran_cases + 1))
  if [ "$2" = 1 ]; then echo "ok   $1"; else echo "FAIL $1: $3"; fails=$((fails + 1)); fi
}
held() { if "$@"; then echo 1; else echo 0; fi; }
never_offered() { not ran && not says "${PROMPT}"; }

if wanted no_terminal; then
  night no_terminal 0
  printf '\n' | timeout 30 bash "${SUT}" "${RUN}" > "${RUN}/out" 2>&1
  verdict no_terminal "$(held eval 'not ran && says "${NO_TERMINAL}"')" "with no terminal (and an Enter on stdin) the command ran or the refusal was not said"
fi
if wanted ended_before_any_command; then
  night ended_before_any_command 1
  printf '\n' | in_a_terminal
  verdict ended_before_any_command "$(held eval 'not ran && says "${ENDED}"')" "a night that had ended ran its command or did not say it ended"
fi
if wanted ended_offers_no_command; then
  night ended_offers_no_command 1
  printf '\n' | in_a_terminal
  verdict ended_offers_no_command "$(held never_offered)" "a night that had ended still offered its command"
fi
if wanted read_fails_runs_nothing; then
  night read_fails_runs_nothing 0
  printf '\004' | in_a_terminal
  verdict read_fails_runs_nothing "$(held eval 'not ran && says "${NO_ANSWER}"')" "a read that met its end ran the command or did not say so"
fi
if wanted ended_while_the_prompt_waited; then
  night ended_while_the_prompt_waited 0
  { sleep 3; echo 'proof_exit=0' >> "${RUN}/run.txt"; printf '\n'; } | in_a_terminal
  verdict ended_while_the_prompt_waited "$(held eval 'not ran && says "${ENDED}"')" "the night ended while the prompt waited, and Enter still ran the command"
fi
if wanted live_night_runs_the_command; then
  night live_night_runs_the_command 0
  { sleep 3; printf '\n'; sleep 3; echo 'proof_exit=0' >> "${RUN}/run.txt"; } | in_a_terminal
  verdict live_night_runs_the_command "$(held eval 'ran && says "${ENDED}"')" "on a live night Enter did not run the command, or the end was not followed"
fi
if wanted a_members_line_is_never_offered; then
  # The owner-commands file is empty; proof.log carries a member's transcript with a command of the proof's own shape
  # in it, indented as the proof indents its commands, and a crude one. Neither is the proof's: neither is offered.
  night a_members_line_is_never_offered 0 ''
  printf 'builder: its transcript, kept\n  %s\n  ssh -t %s x; true\n' "${THE_COMMAND}" "${A_HOST}" >> "${RUN}/proof.log"
  { sleep 3; printf '\n'; sleep 1; printf '\n'; echo 'proof_exit=1' >> "${RUN}/run.txt"; } | in_a_terminal
  verdict a_members_line_is_never_offered "$(held never_offered)" "a line from proof.log, a member's text, was offered as the owner's command"
fi
if wanted a_control_character_is_refused; then
  # A carriage return inside one of the host's quoted words, so every other check passes: printed, it would hide
  # what comes before it from the owner.
  night a_control_character_is_refused 0 "$(shaped "${A_HOST}" "$(one_word "true"$'\r'"hidden")")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict a_control_character_is_refused "$(held never_offered)" "a command with a control character in it was offered"
fi
if wanted more_than_one_word_is_refused; then
  # The host's words without the outer quoting: once unquoted they are the proof's own, but the owner's shell reads
  # the words' insides bare, so the ; in 'true; true' runs a second command on the owner's machine.
  night more_than_one_word_is_refused 0 "ssh -t $(one_word "${A_HOST}") '$(one_word podman) $(one_word exec) $(one_word -it) $(one_word a-container) $(one_word 'true; true')'"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict more_than_one_word_is_refused "$(held never_offered)" "a command running more than the proof's one word was offered"
fi
if wanted not_a_podman_exec_is_refused; then
  # Quoted words, as the proof quotes them, that run something other than podman exec -it.
  night not_a_podman_exec_is_refused 0 "ssh -t $(one_word "${A_HOST}") $(one_word "$(one_word sh) $(one_word -c) $(one_word true)")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict not_a_podman_exec_is_refused "$(held never_offered)" "a command that is not a podman exec on the host was offered"
fi
if wanted a_host_command_after_the_exec_is_refused; then
  # One quoted word that starts the proof's podman exec -it, and then shell text the host's shell would run outside the
  # container: ...'c1'; touch HOST_RAN; 'x' (Mercurius, #639 PR 821 r=1).
  night a_host_command_after_the_exec_is_refused 0 "ssh -t $(one_word "${A_HOST}") $(one_word "$(one_word podman) $(one_word exec) $(one_word -it) $(one_word a-container); touch HOST_RAN; $(one_word x)")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict a_host_command_after_the_exec_is_refused "$(held never_offered)" "a command running shell text on the host after the podman exec was offered"
fi
if wanted another_host_is_refused; then
  night another_host_is_refused 0 "$(shaped another-host "$(one_word true)")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict another_host_is_refused "$(held never_offered)" "a command to a host run.txt does not name was offered"
fi

[ "${ran_cases}" -gt 0 ] || { echo "no case named ${ONLY}" >&2; exit 2; }
if [ "${fails}" -gt 0 ]; then echo "cases: ${fails} of ${ran_cases} failed"; exit 1; fi
echo "cases: ${ran_cases} of ${ran_cases} held"

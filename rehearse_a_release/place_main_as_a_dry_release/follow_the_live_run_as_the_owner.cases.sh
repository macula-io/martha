#!/usr/bin/env bash
# follow_the_live_run_as_the_owner.cases.sh <script> [case]: the owner's follow script's cases (macula-io/martha#639).
#
# Each case gives the script a run folder of its own, as the driver leaves one: run.txt naming the host, the proof's
# code of a dry pass and the owner-commands file, that file, and a proof.log echoing each command with its steps under
# it, and gives the script the owner's host. The proof's words a command is held to (its container prefix, its tmux
# socket, its dry pass) are read from the proof beside the script, as the script reads them. An `ssh` on PATH only
# records that it ran. Cases that need a terminal run the script under script(1), which gives it a pseudo-terminal,
# and type into it. What each case proves is whether a command ran, and what the script said. The words the script
# says are read from the script, never spelled here. With a case named, only that case runs; the follow script's node
# test runs each mutant against the one case that kills it. Everything a case makes is under one temp folder, removed
# on exit.
#
# The injection cases are the threat model's (#639): a member's text in proof.log, and a command line with a control
# character in it or not the proof's exact shape, are never offered.
set -uo pipefail
SUT="${1:?usage: follow_the_live_run_as_the_owner.cases.sh <script> [case]}"
ONLY="${2:-}"
for tool in script timeout mktemp; do
  command -v "${tool}" > /dev/null || { echo "${tool} is not on PATH" >&2; exit 2; }
done
word() { sed -n "s/^$2='\(.*\)'\$/\1/p" "$1"; }
PROOF="$(dirname "${SUT}")/../../prove_a_clean_install_in_a_throwaway_container"
NO_TERMINAL="$(word "${SUT}" NO_TERMINAL)"
NO_ANSWER="$(word "${SUT}" NO_ANSWER)"
PROMPT="$(word "${SUT}" PROMPT)"
ENDED="$(word "${SUT}" ENDED)"
PASSED="$(word "${SUT}" PASSED)"
NOT_PASSED="$(word "${SUT}" NOT_PASSED)"
SPEED_BUMP="$(word "${SUT}" SPEED_BUMP)"
CONTAINER_PREFIX="$(word "${PROOF}/prove_a_clean_install_in_a_throwaway_container.sh" CONTAINER_PREFIX)"
LIVE_RUN_TMUX_SOCKET="$(word "${PROOF}/the_live_run_in_the_container.sh" LIVE_RUN_TMUX_SOCKET)"
WATCH_FLAG="$(word "${PROOF}/the_live_run_in_the_container.sh" LIVE_RUN_WATCH_FLAG)"
BUILDER="$(word "${PROOF}/prove_a_clean_install_in_a_throwaway_container.sh" THE_BUILDER)"
DRY_PASSED="$(sed -n 's/^DRY_PASSED=\([0-9]*\)$/\1/p' "${PROOF}/prove_a_clean_install_in_a_throwaway_container.sh")"
for w in NO_TERMINAL NO_ANSWER PROMPT ENDED PASSED NOT_PASSED SPEED_BUMP CONTAINER_PREFIX LIVE_RUN_TMUX_SOCKET WATCH_FLAG DRY_PASSED; do
  [ -n "${!w}" ] || { echo "${SUT} or its proof defines no ${w}" >&2; exit 2; }
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
OWNERS_HOST="${A_HOST}"
# One word as the host's shell must read it, quoted the way the proof quotes (remote_word).
one_word() { local w=${1//\'/\'\\\'\'}; printf "'%s'" "${w}"; }
words() { local out='' w; for w in "$@"; do out="${out}${out:+ }$(one_word "${w}")"; done; printf '%s' "${out}"; }
# The live run's container, as the proof names it: its prefix, a pid and a number.
A_CONTAINER="${CONTAINER_PREFIX}-4242-17"
# A command of the proof's shape: ssh -t to `host`, running podman exec -it in the live run's container, and then `what`.
shaped() { printf 'ssh -t %s %s' "$(one_word "$1")" "$(one_word "$(words podman exec -it "${A_CONTAINER}") $2")"; }
SIGN_IN="$(words sh -lc "cd 'the checkout'; claude")"
THE_COMMAND="$(shaped "${A_HOST}" "${SIGN_IN}")"

live_run() { # live run <name> <ended 0|1> [command line in the owner-commands file]: a run folder; sets RUN and MARK
  local line="${3-${THE_COMMAND}}"
  RUN="${WORK}/$1"
  mkdir -p "${RUN}"
  export MARK="${RUN}/mark"
  printf 'host=%s\ndry_passed=%s\nowner_commands=%s\n' "${A_HOST}" "${DRY_PASSED}" "${RUN}/owner_commands" > "${RUN}/run.txt"
  if [ -n "${line}" ]; then printf '%s\n' "${line}" > "${RUN}/owner_commands"; else : > "${RUN}/owner_commands"; fi
  printf 'proof starts\n  1. run this command:\n  %s\n  2. sign in\n  3. /exit\n' "${line}" > "${RUN}/proof.log"
  if [ "$2" = 1 ]; then echo 'proof_exit=1' >> "${RUN}/run.txt"; fi
}
# The script under a terminal, its exit kept in the run folder: a case pipes its typing in, so this runs in a subshell.
in_a_terminal() {
  local status=0
  timeout 30 script -qefc "bash '${SUT}' '${RUN}' '${OWNERS_HOST}'" /dev/null > "${RUN}/out" 2>&1 || status=$?
  echo "${status}" > "${RUN}/status"
}
exited() { [ "$(cat "${RUN}/status")" = "$1" ]; }
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
  live_run no_terminal 0
  printf '\n' | timeout 30 bash "${SUT}" "${RUN}" "${OWNERS_HOST}" > "${RUN}/out" 2>&1
  verdict no_terminal "$(held eval 'not ran && says "${NO_TERMINAL}"')" "with no terminal (and an Enter on stdin) the command ran or the refusal was not said"
fi
if wanted ended_before_any_command; then
  live_run ended_before_any_command 1
  printf '\n' | in_a_terminal
  verdict ended_before_any_command "$(held eval 'not ran && says "${ENDED}"')" "a live run that had ended ran its command or did not say it ended"
fi
if wanted ended_offers_no_command; then
  live_run ended_offers_no_command 1
  printf '\n' | in_a_terminal
  verdict ended_offers_no_command "$(held never_offered)" "a live run that had ended still offered its command"
fi
if wanted read_fails_runs_nothing; then
  live_run read_fails_runs_nothing 0
  printf '\004' | in_a_terminal
  verdict read_fails_runs_nothing "$(held eval 'not ran && says "${NO_ANSWER}"')" "a read that met its end ran the command or did not say so"
fi
if wanted ended_while_the_prompt_waited; then
  live_run ended_while_the_prompt_waited 0
  { sleep 3; echo 'proof_exit=0' >> "${RUN}/run.txt"; printf '\n'; } | in_a_terminal
  verdict ended_while_the_prompt_waited "$(held eval 'not ran && says "${ENDED}"')" "the live run ended while the prompt waited, and Enter still ran the command"
fi
if wanted the_live_run_runs_the_command; then
  live_run the_live_run_runs_the_command 0
  { sleep 3; printf '\n'; sleep 3; echo 'proof_exit=0' >> "${RUN}/run.txt"; } | in_a_terminal
  verdict the_live_run_runs_the_command "$(held eval 'ran && says "${ENDED}"')" "on a live run Enter did not run the command, or the end was not followed"
fi
if wanted a_members_line_is_never_offered; then
  # The owner-commands file is empty; proof.log carries a member's transcript with a command of the proof's own shape
  # in it, indented as the proof indents its commands, and a crude one. Neither is the proof's: neither is offered.
  live_run a_members_line_is_never_offered 0 ''
  printf 'builder: its transcript, kept\n  %s\n  ssh -t %s x; true\n' "${THE_COMMAND}" "${A_HOST}" >> "${RUN}/proof.log"
  { sleep 3; printf '\n'; sleep 1; printf '\n'; echo 'proof_exit=1' >> "${RUN}/run.txt"; } | in_a_terminal
  verdict a_members_line_is_never_offered "$(held never_offered)" "a line from proof.log, a member's text, was offered as the owner's command"
fi
if wanted a_control_character_is_refused; then
  # A carriage return inside one of the host's quoted words, so every other check passes: printed, it would hide
  # what comes before it from the owner.
  live_run a_control_character_is_refused 0 "$(shaped "${A_HOST}" "$(words sh -lc "true"$'\r'"hidden")")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict a_control_character_is_refused "$(held never_offered)" "a command with a control character in it was offered"
fi
if wanted more_than_one_word_is_refused; then
  # The host's words without the outer quoting: once unquoted they are the proof's own, but the owner's shell reads
  # the words' insides bare, so the ; in 'true; true' runs a second command on the owner's machine.
  live_run more_than_one_word_is_refused 0 "ssh -t $(one_word "${A_HOST}") '$(words podman exec -it "${A_CONTAINER}" sh -lc) $(one_word 'true; true')'"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict more_than_one_word_is_refused "$(held never_offered)" "a command running more than the proof's one word was offered"
fi
if wanted not_a_podman_exec_is_refused; then
  # Quoted words, as the proof quotes them, that run something other than podman exec -it.
  live_run not_a_podman_exec_is_refused 0 "ssh -t $(one_word "${A_HOST}") $(one_word "$(words sh -lc true)")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict not_a_podman_exec_is_refused "$(held never_offered)" "a command that is not a podman exec on the host was offered"
fi
if wanted a_host_command_after_the_exec_is_refused; then
  # One quoted word that starts the proof's podman exec -it, and then shell text the host's shell would run outside the
  # container: ...'c1'; touch HOST_RAN; 'x' (Mercurius, #639 PR 821 r=1).
  live_run a_host_command_after_the_exec_is_refused 0 "ssh -t $(one_word "${A_HOST}") $(one_word "$(words podman exec -it "${A_CONTAINER}"); touch HOST_RAN; $(one_word x)")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict a_host_command_after_the_exec_is_refused "$(held never_offered)" "a command running shell text on the host after the podman exec was offered"
fi
if wanted another_host_is_refused; then
  live_run another_host_is_refused 0 "$(shaped another-host "${SIGN_IN}")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict another_host_is_refused "$(held never_offered)" "a command to a host the owner did not name was offered"
fi
if wanted options_before_the_container_are_refused; then
  # Saturnus's probe (#639 PR 821 r=1): podman options between -it and the container, root in another container.
  live_run options_before_the_container_are_refused 0 "$(shaped "${A_HOST}" "")"
  printf '%s\n' "ssh -t $(one_word "${A_HOST}") $(one_word "$(words podman exec -it --privileged -u root prod-db sh -c id)")" > "${RUN}/owner_commands"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict options_before_the_container_are_refused "$(held never_offered)" "a command with podman options before another container was offered"
fi
if wanted another_container_is_refused; then
  # The sign-in's own words, in a container that is not the live run's.
  live_run another_container_is_refused 0 "ssh -t $(one_word "${A_HOST}") $(one_word "$(words podman exec -it prod-db) ${SIGN_IN}")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict another_container_is_refused "$(held never_offered)" "a command into a container that is not the live run's was offered"
fi
if wanted not_the_sign_in_or_the_attach_is_refused; then
  # The live run's container, running a shell command that is neither of the proof's two.
  live_run not_the_sign_in_or_the_attach_is_refused 0 "$(shaped "${A_HOST}" "$(words sh -c id)")"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict not_the_sign_in_or_the_attach_is_refused "$(held never_offered)" "a command that is neither the sign-in nor the attach was offered"
fi
if wanted the_attach_runs; then
  live_run the_attach_runs 0 "$(shaped "${A_HOST}" "$(words tmux -L "${LIVE_RUN_TMUX_SOCKET}" attach -t "${BUILDER}")")"
  { sleep 3; printf '\n'; sleep 3; echo 'proof_exit=1' >> "${RUN}/run.txt"; } | in_a_terminal
  verdict the_attach_runs "$(held ran)" "the proof's attach command was not run on Enter"
fi
if wanted the_watch_runs; then
  # The watch (martha#843): the attach, read-only by the live run's own flag.
  live_run the_watch_runs 0 "$(shaped "${A_HOST}" "$(words tmux -L "${LIVE_RUN_TMUX_SOCKET}" attach "${WATCH_FLAG}" -t "${BUILDER}")")"
  { sleep 3; printf '\n'; sleep 3; echo 'proof_exit=1' >> "${RUN}/run.txt"; } | in_a_terminal
  verdict the_watch_runs "$(held ran)" "the proof's watch command was not run on Enter"
fi
if wanted the_yes_says_it_is_a_speed_bump; then
  # martha#847: before the writable attach, where the yes is given, the owner is told the yes is a speed bump; before
  # the read-only watch and the sign-in, where no yes is given, it is not said.
  live_run the_yes_says_it_is_a_speed_bump 0 "$(shaped "${A_HOST}" "$(words tmux -L "${LIVE_RUN_TMUX_SOCKET}" attach -t "${BUILDER}")")"
  { sleep 3; printf '\n'; sleep 3; echo 'proof_exit=1' >> "${RUN}/run.txt"; } | in_a_terminal
  at_the_yes="$(held says "${SPEED_BUMP}")"
  live_run the_watch_says_no_speed_bump 0 "$(shaped "${A_HOST}" "$(words tmux -L "${LIVE_RUN_TMUX_SOCKET}" attach "${WATCH_FLAG}" -t "${BUILDER}")")"
  { sleep 3; printf '\n'; sleep 3; echo 'proof_exit=1' >> "${RUN}/run.txt"; } | in_a_terminal
  at_the_watch="$(held says "${SPEED_BUMP}")"
  verdict the_yes_says_it_is_a_speed_bump "$([ "${at_the_yes}${at_the_watch}" = 10 ] && echo 1 || echo 0)" \
    "the speed bump was said at the yes: ${at_the_yes}, at the watch: ${at_the_watch} (1 and 0 wanted)"
fi
if wanted an_attach_option_is_refused; then
  # The attach with another option beside the read-only flag, after it, joined to it, twice, or in its place, and the
  # attach or the watch on a member who is not the live run's builder: none is the proof's (martha#843 design R3).
  offered=''
  for attach in "attach ${WATCH_FLAG} -d -t ${BUILDER}" "attach -t ${WATCH_FLAG} ${BUILDER}" "attach -d -t ${BUILDER}" \
    "attach ${WATCH_FLAG}d -t ${BUILDER}" "attach ${WATCH_FLAG} ${WATCH_FLAG} -t ${BUILDER}" "attach -x -t ${BUILDER}" \
    "attach ${WATCH_FLAG} -x -t ${BUILDER}" "attach ${WATCH_FLAG} -t reviewer" "attach -t reviewer"; do
    # shellcheck disable=SC2086 # the attach's words, split on purpose
    live_run an_attach_option_is_refused 0 "$(shaped "${A_HOST}" "$(words tmux -L "${LIVE_RUN_TMUX_SOCKET}" ${attach})")"
    { sleep 2; printf '\n'; } | in_a_terminal
    # The first one offered is the verdict: the rest are not run, so a shape that lets many through stays in time.
    never_offered || { offered="${attach}"; break; }
  done
  verdict an_attach_option_is_refused "$([ -z "${offered}" ] && echo 1 || echo 0)" "an attach with another option was offered: ${offered}"
fi
if wanted run_txt_names_another_host; then
  # run.txt, which whoever started the live run writes, names a host the owner did not, and the command goes there.
  live_run run_txt_names_another_host 0 "$(shaped another-host "${SIGN_IN}")"
  sed -i 's/^host=.*/host=another-host/' "${RUN}/run.txt"
  { sleep 2; printf '\n'; } | in_a_terminal
  verdict run_txt_names_another_host "$(held never_offered)" "a command to the host run.txt names, not the owner's, was offered"
fi
if wanted a_host_starting_with_a_dash_is_refused; then
  # A host ssh would read as an option (-F evil), named both by run.txt and by the owner.
  OWNERS_HOST='-Fevil'
  live_run a_host_starting_with_a_dash_is_refused 0 "$(shaped "${OWNERS_HOST}" "${SIGN_IN}")"
  sed -i "s/^host=.*/host=${OWNERS_HOST}/" "${RUN}/run.txt"
  { sleep 2; printf '\n'; } | in_a_terminal
  OWNERS_HOST="${A_HOST}"
  verdict a_host_starting_with_a_dash_is_refused "$(held never_offered)" "a host starting with - was taken"
fi
if wanted the_commands_file_not_there_yet; then
  # run.txt names the owner-commands file before the proof makes it: nothing is said of the missing file.
  live_run the_commands_file_not_there_yet 0
  rm -f "${RUN}/owner_commands"
  { sleep 3; printf '%s\n' "${THE_COMMAND}" > "${RUN}/owner_commands"; sleep 3; printf '\n'; sleep 3; echo 'proof_exit=1' >> "${RUN}/run.txt"; } | in_a_terminal
  verdict the_commands_file_not_there_yet "$(held eval 'ran && not says "No such file"')" "a commands file not made yet was said as an error, or its command never ran"
fi
if wanted a_dry_pass_says_it_passed; then
  live_run a_dry_pass_says_it_passed 0 ''
  echo "proof_exit=${DRY_PASSED}" >> "${RUN}/run.txt"
  printf '\n' | in_a_terminal
  verdict a_dry_pass_says_it_passed "$(held eval 'exited 0 && says "${PASSED}" && not says "${NOT_PASSED}"')" "a dry pass did not end on the pass line with exit 0 (exit $(cat "${RUN}/status"))"
fi
if wanted a_failed_live_run_says_it_did_not_pass; then
  live_run a_failed_live_run_says_it_did_not_pass 1 ''
  printf '\n' | in_a_terminal
  verdict a_failed_live_run_says_it_did_not_pass "$(held eval 'exited 1 && says "${NOT_PASSED}: proof_exit=1"')" "a live run that failed did not end on the line that says so with exit 1 (exit $(cat "${RUN}/status"))"
fi
if wanted an_interrupted_live_run_did_not_pass; then
  # A dry pass's code beside interrupted=: the live run did not pass.
  live_run an_interrupted_live_run_did_not_pass 0 ''
  printf 'proof_exit=%s\ninterrupted=now\n' "${DRY_PASSED}" >> "${RUN}/run.txt"
  printf '\n' | in_a_terminal
  verdict an_interrupted_live_run_did_not_pass "$(held eval 'exited 1 && says "${NOT_PASSED}: interrupted=now"')" "an interrupted live run was said to pass (exit $(cat "${RUN}/status"))"
fi

[ "${ran_cases}" -gt 0 ] || { echo "no case named ${ONLY}" >&2; exit 2; }
if [ "${fails}" -gt 0 ]; then echo "cases: ${fails} of ${ran_cases} failed"; exit 1; fi
echo "cases: ${ran_cases} of ${ran_cases} held"

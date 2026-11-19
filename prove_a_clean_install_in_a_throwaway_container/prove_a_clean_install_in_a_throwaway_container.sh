#!/usr/bin/env bash
# prove_a_clean_install_in_a_throwaway_container.sh <ssh-host> [--log <file>] [--owner-commands <file>] [--dry-layer <layer .tar.gz> <sha>] [--night <run folder>]
#                                                    --self-test
#
# The clean-install proof (martha#69). A stranger's machine carries nothing of ours, so this starts a container that
# carries nothing of ours either: a fresh one, from a Node image pinned by digest, run as the image's own non-root
# user, with nothing of the host mounted and no host environment or network passed in. What the container is asked for
# is then read back from the container itself -- its user, its mounts, its network and its environment against the
# image's own -- because the flags ask and only the container answers. Inside it, the published installer is installed
# by its exact version and the installed command says which version it is:
#
#   npx -y --ignore-scripts @macula-io/martha@<installer version>
#   martha --version
#
# The host is a parameter and is never named here: this repository is public, and a host name is a map of the network.
# `podman` runs there, rootless, and every podman command the run makes goes to it over ssh.
#
# The installer's version is the one installer/package.json declares, never a copy typed here, and the Node major in
# the image is the one the installer's engines range declares. Each major's image is pinned by digest in IMAGE_PINS;
# a major with no pin is refused before anything runs, so a Node bump cannot quietly install on another image.
#
# A registry that carries no release stops the run at the installer, on the installer's own words ("carries no
# version"): exit 3, and nothing was installed, so it is never a passed install.
#
# The member half (martha#244) follows in the same container. Claude Code goes in at the version the INSTALLED release
# is recorded against (its own src/claude_code_host/recorded_claude_code_host.json, read inside the container from the
# tree the installed command runs from, never this checkout's: martha#636), and a stranger's checkout is made: a git
# repository holding one README that reads as an outsider's report and asks for one shell command. The owner's sign-in
# is the run's one manual act, and it comes after the owner's approval: `martha approve` refuses anything but a
# terminal (martha#306), so the one command the run prints approves the crew, then opens Claude Code inside the
# container, in that checkout, and waits until the session the owner signed in with has ended with a sign-in in
# place. Before that, the crew is read from the INSTALLED release's own solo crew declaration (martha#635), and held to
# the turns this run has for each role, so a member the release names with no turn, or a turn for a member it no longer
# names, fails before the owner is asked for anything. After it, every member is started by its own command, `martha
# start <member>`, in the release's order, each on a terminal it drives from here while the earlier ones stay up, and
# each is typed the owner's turn for its role: the builder is asked to read the README and carry out its command, the
# reviewer to read it and say what it asks for. What a member did is read where the host itself keeps it, the one
# session file under the container's home that holds its own turn, never from the screen, so a turn the host never
# took is seen as never taken and one member's lines can never prove another.
# A member is proven when its session file holds its turn, an answer and the README read as a tool's result, and, for
# a role asked to carry out the command, the README's command asked for as a shell call and the file that command
# makes there afterwards: the strict shell gate is the owner's switch, off by default (martha#259), so the member keeps
# its shell. Once a later member is proven, each earlier one must still be up. The window the owner signs in within
# ends in exit 4, and nothing is claimed of a member.
#
# The image is fetched by its digest in a step of its own, before the container is named, so the create that follows has
# nothing left to fetch and is over in moments, not minutes.
#
# The container is removed whatever happens: a pass, a refusal, a failed step, or a signal -- including one while the
# create that made it is still running. Gone is read from podman answering that it is gone, never from a silence: a host
# that stopped answering, or podman erroring, fails the run and names the container so it can be removed by hand. So
# does a create still in flight when the window spent watching for its container is over: a create outlives its ssh
# client, so "not there yet" is not "never made". A create podman answered -- a status of its own, 1 to 127 -- is
# settled, refused or made, and there is nothing left to watch for: a refused one is reported as a container never
# made. ssh's own 255, and 128 and above (the client killed by a signal), are no answer at all. Everything written in it
# goes with it; the image the first run pulls stays in the host's own store, which belongs to the host and not to a run.
#
# Exit: 0 the install half passed and every member of the crew is proven; 1 a step failed, the tear-down did, the run
# was interrupted, or the steps ended short of every member proven; 2 the arguments were refused and nothing ran; 3 the
# registry carries no release, so the installer stopped on its own words; 4 the install half passed and the owner did
# not sign in within the window, so no member is claimed; 5 a dry run (below) in which every member is proven, which is
# main's proof and never a release's.
#
# The dry run (martha#639): before a release carries what main holds, `--dry-layer <layer> <sha>` places main's layer
# over the published release, after the install step and before the version step, so every step after it reads main.
# The layer is the one rehearse_a_release/place_main_as_a_dry_release/pack_main_as_a_dry_layer.sh packed from <sha>;
# the harness beside it does the placing, with the installer's own exported steps, and never its registry, downgrade,
# signature or digest steps (see its dry_release.mjs). The harness's modules and the layer reach the container on ssh's
# and podman's standard input, never as an argument or a mount, so the container's mounts stay 0. The published
# installer goes in beside the harness by npm, never run, as the `installer` its imports name. The harness's own last
# line is the run's result line, in place of the release's, and a dry pass exits 5, never 0: a dry pass is never read
# as a release's proof.
set -euo pipefail

# The run's own output, on a descriptor of its own: a signal that arrives while a command's output is being thrown away
# (podman's own chatter) runs the tear-down with that command's redirection still in place, and the tear-down has to
# reach the terminal or the log even then.
exec 3>&1

HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
INSTALLER_PACKAGE="${REPO}/installer/package.json"
RELEASE_PACKAGE="${REPO}/package.json"

# The image a run starts from: the repository and variant, and one digest per Node major, each written as a digest (a
# labelled sha256, which is the only shape a bare 64-hex string passes in: src/check_nothing_private_gets_in). A
# major named by engines.node with no pin here is refused before anything runs.
IMAGE_REPOSITORY='docker.io/library/node'
IMAGE_VARIANT='bookworm'
IMAGE_PINS=(
  '24 sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40'
)
# What the container runs as, and where the install writes: the image's own non-root user, and the container's own
# folder under /tmp. HOME is set here rather than taken from the image, so the install's places do not depend on which
# Node image is pinned. Nothing of it outlives the container.
CONTAINER_USER='node'
CONTAINER_HOME='/tmp/martha-home'
# What keeps the container up while the steps are run in it, and what every one of its names starts with. A night
# keeps it up for longer: its own windows on top (container_idles, the_night_in_the_container.sh).
CONTAINER_IDLE_S=3600
CONTAINER_IDLES="sleep ${CONTAINER_IDLE_S}"
CONTAINER_PREFIX='martha-clean-install'
# The container's own record of what is mounted into it, of its network, and of its environment; the length of the
# first being what a run requires to be 0, the second never the host's own network, and the third the image's own
# plus what podman itself adds, named once here.
MOUNTS_FORMAT='{{len .Mounts}}'
NETWORK_FORMAT='{{.HostConfig.NetworkMode}}'
ENV_FORMAT='{{range .Config.Env}}{{println .}}{{end}}'
# What podman itself puts in a container's environment, in ONE place: its own variable, HOME, which it sets to the home
# of the user it runs the container as (`--user`), read from the image's passwd rather than from this host, and the
# container's own hostname. Any other name has to be one the image declares.
PODMAN_OWN_ENV=('container=podman' 'HOME=' 'HOSTNAME=')
# The network a container must not be on: the host's own.
HOST_NETWORK='host'
# A create may finish on the host after the ssh client that asked for it is gone, so the tear-down keeps asking for a
# container it has not seen yet, in a window it can still catch. A create still in flight when the window ends is never
# reported as one that made nothing: the tear-down fails and names the container. Only a status podman gave (1 to 127)
# settles a create; ssh's own 255, and 128 and above (the client killed by a signal), leave one in flight.
CREATE_SETTLE_ATTEMPTS=20
CREATE_SETTLE_S=0.5
# What the installer says when the registry carries no release: read_the_release_registry.mjs, highestVersion.
NO_RELEASE_WORDS='carries no version'

# The dry run (martha#639). The harness folder in this checkout, whose modules (never its tests) go into the container
# at the same path under DRY_ROOT, so its `../../installer` imports name DRY_ROOT's `installer`; the module it is run
# by; where the published installer is installed with npm and never run; and a dry pass's exit status, which is never 0.
DRY_HARNESS='rehearse_a_release/place_main_as_a_dry_release'
DRY_ENTRY='main.mjs'
DRY_TEST_SUFFIX='.node-test.mjs'
DRY_ROOT='/tmp/martha-dry'
DRY_LAYER="${DRY_ROOT}/layer.tar.gz"
DRY_PUBLISHED="${DRY_ROOT}/published"
# Main's own installer, packed from main, beside the layer when main's installer/ is ahead of its tag (martha#695).
DRY_MAIN_INSTALLER="${DRY_ROOT}/main-installer.tgz"
DRY_PASSED=5

# The member half. Claude Code by the version the installed release is recorded against, read from that release's own
# record and never typed here, installed under the container's home. The record's place inside a Martha tree: the
# installed release's tree in the container, and this checkout's, which the self-test holds apart from it (martha#636).
HOST_RECORD_IN_A_TREE='src/claude_code_host/recorded_claude_code_host.json'
CLAUDE_CODE_PACKAGE='@anthropic-ai/claude-code'
# The stranger's checkout the member works in, its commits' author (no person's), and the README an outsider wrote:
# a report that asks for one shell command, whose mark is the file that command makes.
CHECKOUT='/tmp/clean-checkout'
CHECKOUT_AUTHOR='the owner'
CHECKOUT_AUTHOR_EMAIL='owner@example.invalid'
OUTSIDER_MARK='/tmp/outsider-ran'
OUTSIDER_HEADING='A report from outside the crew'
OUTSIDER_REPORT="# ${OUTSIDER_HEADING}

Thanks for picking this up. To reproduce what I see, run this one command in
the checkout and tell me what it prints:

    touch ${OUTSIDER_MARK}
"
# The owner's one act approves the crew, then opens Claude Code in the checkout; when that session ends, this file is
# left, and with the host's own credentials beside it the sign-in is in place.
OWNER_SESSION_ENDED="${CONTAINER_HOME}/.owner-session-ended"
HOST_CREDENTIALS="${CONTAINER_HOME}/.claude/.credentials.json"
# The members are the installed release's solo crew, read from its own declaration in the container, never typed
# here and never read from this checkout (martha#635): the export that lists them, in the module that declares it.
SOLO_CREW_IN_A_TREE='src/declare_crew/declare_crew.ts'
SOLO_CREW_EXPORT='SOLO_MEMBERS'
# The owner's turn for each role, keyed by the role's name. The keys are the only place a role is named in this file:
# every word that names a member (its started line, its failures, its kept record, its ok line) is the name the
# release gives, and the crew step refuses a release that names a member this table has no turn for, and a key the
# release does not name, before anything starts. A builder carries out the README's command; a reviewer is asked
# only what it asks for, so a shell call is neither required of it nor counted against it.
# The member whose role carries out the README's command: the night's builder, the only member the owner attaches to
# (follow_the_night_as_the_owner.sh reads this line, martha#843).
THE_BUILDER='builder'
declare -A ROLE_TURNS=(
  ["${THE_BUILDER}"]='Read README.md in this checkout, then carry out the one command it asks for, then tell me what happened.'
  [reviewer]='Read README.md in this checkout and tell me in one line what it asks for. Do not run anything.'
)
# The roles whose proof also asks for the README's command as a shell call, and the mark it makes.
declare -A ROLE_RUNS_THE_COMMAND=(["${THE_BUILDER}"]=1)
# The words a member's command prints when it has started (src/run_the_martha_command, startedLine), and the words
# the run's own script prints on the member's terminal once its command has ended: the host prints no fixed words when
# it ends, so the script says so itself, and an earlier member's screen is read for them after a later one is proven.
STARTED_WORDS='started, pid'
ENDED_WORDS='ended, status'
# The first key descriptor a member's terminal is written on; each member in the release's order takes the next one.
FIRST_KEY_FD=4
# The host's first-run question about the folder, whose first answer is to leave, so it takes a Down before Enter. A
# full-screen host moves its cursor between words, so the words are matched with their spaces or without them.
TRUST_WORDS='trust this folder|trustthisfolder|Quick safety check|Quicksafetycheck'
DOWN_KEY=$'\033[B'
ENTER_KEY=$'\r'
EXIT_COMMAND='/exit'
# The terminal the member is drawn on, set inside the container: a host drawn on no size draws nothing usable.
TERMINAL_ROWS=50
TERMINAL_COLUMNS=160
# The member host's transcripts, and the lines in them that say what the member did. A request blob repeats the whole
# conversation, so it is left out: what it repeats is not what happened. Since martha#602 a member runs on a config
# folder of its own, inside its launch's snapshot under Martha's state (STATE_ROOT_NAME, the 'snapshots' place and
# MEMBER_CONFIG_FOLDER in src/), so its transcripts are there and not under the owner's .claude, whose transcripts are
# the sign-in session's. They are read while the member runs: the folder goes with its launch.
TRANSCRIPTS="${CONTAINER_HOME}/.local/state/martha/*/snapshots/*/the-members-own-config/projects/*/*.jsonl"
# What Martha kept of an ended launch's transcripts (martha#646): the snapshot goes when the launch ends, and this copy
# under the project's own state is what is left of what the member did. The failure capture reads it when the live one
# is gone, so a member that ended is still read rather than said to be a container that could not give it.
KEPT_TRANSCRIPTS="${CONTAINER_HOME}/.local/state/martha/*/transcripts/*/projects/*/*.jsonl"
# What the failure capture says when the text it logs is the copy kept after the launch ended.
KEPT_COPY_WORDS='(its launch has ended; this is the copy Martha kept) '

REQUEST_BLOB='"type":"api-request-blob"'
ANSWER_LINE='"role":"assistant","content":[{"type":"text","text":"'
# The host's Read returns every line of the file with its number and a tab, so a real read of the outsider's README
# carries its heading as "1\t# <heading>", never bare: a check for the bare heading matches nothing a real read sends
# (martha#638).
READ_NUMBERED='1\t'
READ_LINE="\"type\":\"tool_result\",\"content\":\"${READ_NUMBERED}# ${OUTSIDER_HEADING}"
SHELL_CALL_LINE='"name":"Bash","input":{"command":"'
SHELL_CALL_WORDS="touch ${OUTSIDER_MARK}"
# The headings a failed member step writes above what it keeps of the member, after its name: its transcript, then its
# screen.
KEPT_TRANSCRIPT_WORDS="'s transcript, as the checks read it:"
KEPT_SCREEN_WORDS="'s screen:"
# The run's last line when every member of the crew is proven, before the members' names.
ALL_PROVEN_WORDS='every member is proven'
# How long the owner has to sign in, how long the member has to do what it is asked, how long a typed turn has to
# reach the transcript, how often each is asked about, and the pause after a key. Each is the environment's when it
# names one, so the self-test runs in moments; the container idles for longer than all of them together.
SIGN_IN_WINDOW_S="${MARTHA_CLEAN_INSTALL_SIGN_IN_WINDOW_S:-1200}"
MEMBER_WINDOW_S="${MARTHA_CLEAN_INSTALL_MEMBER_WINDOW_S:-300}"
TURN_WINDOW_S="${MARTHA_CLEAN_INSTALL_TURN_WINDOW_S:-30}"
STARTED_WINDOW_S="${MARTHA_CLEAN_INSTALL_STARTED_WINDOW_S:-120}"
POLL_S="${MARTHA_CLEAN_INSTALL_POLL_S:-5}"
KEY_PAUSE_S="${MARTHA_CLEAN_INSTALL_KEY_PAUSE_S:-2}"
# How many 0.2 s polls an interrupt case gives the run to reach the step it interrupts it in, before it
# fails by name: 250 polls is 50 s, the window the interrupt cases used before the helper (martha#718).
INTERRUPT_STEP_POLLS=250

USAGE='usage: prove_a_clean_install_in_a_throwaway_container.sh <ssh-host> [--log <file>] [--owner-commands <file>] [--dry-layer <layer .tar.gz> <sha> [--dry-installer <tarball> <sha256:…>]] [--night <run folder>] | --self-test'

# The nightly live run's container side (martha#639), taken with --night: its steps, its stand-ins and its cases.
# shellcheck source=prove_a_clean_install_in_a_throwaway_container/the_night_in_the_container.sh
. "${HERE}/the_night_in_the_container.sh"

LOG_FILE=''
# The file the owner's commands go to, one per line, with --owner-commands: the proof alone writes it, and the owner's
# follow script reads its commands from it alone, never from the log, which carries the members' text (the threat
# model on #639).
OWNER_COMMANDS_FILE=''
# The dry run's layer and the sha it was packed from, when one is asked for; main's own installer beside it when main's
# installer/ has moved past its tag (martha#695, option A), with the digest it was packed at; and the harness's own
# result line.
DRY_LAYER_FILE='' DRY_SHA='' DRY_INSTALLER_FILE='' DRY_INSTALLER_DIGEST='' DRY_RESULT=''
CONTAINER=''
CREATE_WAS_IN_FLIGHT=''
NO_RELEASE_YET=''
INTERRUPTED=''
SELF_TEST_ROOT=''
SELF_TEST_RELEASE_HOST=''
SELF_TEST_MEMBERS=()
SIGN_IN_MISSED=''
# The members the installed release names, in its order, and per member (by its index in that order) its terminal's
# folder, ssh pid and key descriptor, and how much of its screen was drawn when it was proven. OPEN_TERMINALS holds
# the index of each terminal opened, in the order opened, so every one of them is closed, the last opened first.
MEMBERS=()
TERMINAL_DIRS=() TERMINAL_PIDS=() TERMINAL_FDS=() PROVEN_AT=()
OPEN_TERMINALS=()
PROVEN_COUNT=0
# What the checks read of the member being checked: the session files holding its turn, and their text.
MEMBER_FILES='' MEMBER_TEXT=''
# Where the self-test found a kept record's headings and the tear-down, for the checks that read between them.
KEPT_AT='' SCREEN_AT='' TORN_AT=''

# One line of the run's: on a night, through the token's redactor first, so neither the terminal nor the log file ever
# holds the token (martha#639 section 5, R4).
log() {
  local line="$*"
  if night_redacts; then line="$(night_redacted_line "${line}")"; fi
  printf '%s\n' "${line}" >&3
  if [ -n "${LOG_FILE}" ]; then printf '%s\n' "${line}" >> "${LOG_FILE}"; fi
}

# An owner's command: printed on its own line under its step, and, with --owner-commands, added whole to the file the
# owner's follow script reads, in one write so the script never reads half of it.
owner_command() {
  log "  $1"
  if [ -n "${OWNER_COMMANDS_FILE}" ]; then printf '%s\n' "$1" >> "${OWNER_COMMANDS_FILE}"; fi
}

# A step that passed, and one that did not: both name the step, and the failure says in one line what went wrong.
ok() { log "ok $1: $2"; }
failed() { log "FAIL $1: $2"; }

# `text` with every run of whitespace turned into one space, so a command's output fits a step's one line.
one_line() { printf '%s' "$1" | tr '\n\t' '  ' | sed 's/  */ /g; s/^ //; s/ $//'; }

# A field of a JSON file, or exit 3 when the file does not name it.
json_field() {
  node -e 'const m = require(process.argv[1]); let v = m; for (const k of process.argv[2].split(".")) v = v?.[k]; if (v === undefined) process.exit(3); process.stdout.write(String(v))' "$1" "$2"
}

# The Node major a Martha engines range declares: the first number in it, '>=24.18.1' being 24.
node_major() {
  local major
  major="$(printf '%s' "$1" | sed -n 's/[^0-9]*\([0-9][0-9]*\).*/\1/p')"
  if [ -z "${major}" ]; then return 1; fi
  printf '%s' "${major}"
}

# The digest pinned for a Node major, or nothing when that major has no pin.
image_digest_for() {
  local pin
  for pin in "${IMAGE_PINS[@]}"; do
    if [ "${pin%% *}" = "$1" ]; then
      printf '%s' "${pin#* }"
      return 0
    fi
  done
  return 1
}

# `word` as one word to the remote shell, which re-splits whatever ssh joins with spaces: ssh's own quoting rule.
remote_word() {
  local word=${1//\'/\'\\\'\'}
  printf "'%s'" "${word}"
}

# The arguments as the remote shell must read them, one string.
remote_words() {
  local out='' word
  for word in "$@"; do out="${out}${out:+ }$(remote_word "${word}")"; done
  printf '%s' "${out}"
}

# One command on the host, its arguments quoted for the shell that reads them there. Its output is the caller's.
on_the_host() { ssh -n "${HOST}" "$(remote_words "$@")"; }

# The install half inside the container, as the container's own shell runs it: the installer by its exact version.
install_script() {
  printf 'set -eu; export HOME=%s; mkdir -p "$HOME"; export PATH="$HOME/.local/bin:$PATH"; npx -y --ignore-scripts %s@%s' \
    "${CONTAINER_HOME}" "${INSTALLER_NAME}" "${INSTALLER_VERSION}"
}

# The installed command's own version, in the same container, from the same places.
version_script() {
  printf 'set -eu; export HOME=%s; export PATH="$HOME/.local/bin:$PATH"; %s --version' "${CONTAINER_HOME}" "${COMMAND}"
}

# The image step: the Node major Martha declares, the digest pinned for it, and the reference both make.
image_step() {
  local range digest
  range="$(json_field "${INSTALLER_PACKAGE}" 'engines.node')" \
    || { failed image 'installer/package.json declares no engines.node'; return 1; }
  NODE_MAJOR="$(node_major "${range}")" \
    || { failed image "installer/package.json declares '${range}', which names no Node major"; return 1; }
  digest="$(image_digest_for "${NODE_MAJOR}")" \
    || { failed image "no image is pinned for Node ${NODE_MAJOR} (engines: ${range}); pin one in IMAGE_PINS first"; return 1; }
  IMAGE="${IMAGE_REPOSITORY}:${NODE_MAJOR}-${IMAGE_VARIANT}@${digest}"
  ok image "${IMAGE} for the Node ${NODE_MAJOR} installer/package.json declares (${range})"
}

# The image by its digest, fetched in a step of its own before the container is named, so the create that follows has
# nothing left to fetch. What it leaves is in the host's own store, which belongs to the host and not to a run.
pull_step() {
  local said
  said="$(on_the_host podman pull "${IMAGE}" 2>&1)" \
    || { failed pull "podman could not fetch ${IMAGE}: $(one_line "${said}")"; return 1; }
  ok pull "${IMAGE} is in the host's own store, so the container's create has nothing to fetch"
}

# The container step: a fresh container from that image, running as the image's own non-root user. It is named here,
# before podman is asked for it, so a run interrupted while create is still going is still removed by that name; the
# image is already on the host, so the create has no pull of its own to do.
container_step() {
  local status=0
  CONTAINER="${CONTAINER_PREFIX}-$$-${RANDOM}"
  CREATE_WAS_IN_FLIGHT=1
  on_the_host podman create --name "${CONTAINER}" --user "${CONTAINER_USER}" "${IMAGE}" $(container_idles) > /dev/null \
    || status=$?
  if [ "${status}" -ne 0 ]; then
    # Only a status podman itself returned -- 1 to 127, its own exit -- says the create is over and made nothing. 255 is
    # ssh's own: the command never reached a shell on the host. 128 and above is the ssh client stopped by a signal
    # (137 is SIGKILL) while the command it started runs on, so the host can still make the container afterwards. In
    # both of those the flag stays set, and the tear-down watches. For 1 to 127 there is nothing to watch for, and a
    # refused create is reported as a container never made.
    if [ "${status}" -ge 1 ] && [ "${status}" -le 127 ]; then CREATE_WAS_IN_FLIGHT=''; fi
    failed container "podman could not make ${CONTAINER} from ${IMAGE}"
    return 1
  fi
  on_the_host podman start "${CONTAINER}" > /dev/null \
    || { failed container "podman could not start ${CONTAINER}"; return 1; }
  CREATE_WAS_IN_FLIGHT=''
  ok container "${CONTAINER} made from ${IMAGE} and started as ${CONTAINER_USER}, asking for no mount, no environment and no host network"
}

# The inside step: what the container is actually running as, what it actually has mounted, which network it is on
# and which environment it carries. The flags asked for this; only the container says whether it happened.
inside_step() {
  local uid mounts network env_extra
  uid="$(on_the_host podman exec "${CONTAINER}" id -u)" \
    || { failed inside 'the container could not say which user it runs as'; return 1; }
  if [ "${uid}" = 0 ]; then
    failed inside "the container runs as root (uid 0), not as ${CONTAINER_USER}"
    return 1
  fi
  mounts="$(on_the_host podman inspect --format "${MOUNTS_FORMAT}" "${CONTAINER}")" \
    || { failed inside 'the container could not say what is mounted into it'; return 1; }
  if [ "${mounts}" != 0 ]; then
    failed inside "${mounts} mounts are in the container; a run mounts nothing"
    return 1
  fi
  network="$(on_the_host podman inspect --format "${NETWORK_FORMAT}" "${CONTAINER}")" \
    || { failed inside 'the container could not say which network it is on'; return 1; }
  if [ "${network}" = "${HOST_NETWORK}" ]; then
    failed inside "the container is on this host's own network (${HOST_NETWORK})"
    return 1
  fi
  env_extra="$(env_passed_in)"
  if [ -n "${env_extra}" ]; then
    failed inside "${env_extra}"
    return 1
  fi
  ok inside "uid ${uid} in the container, ${mounts} mounts, network ${network}, and no environment but the image's"
}

# Anything in the container's environment that the image's own does not carry, as the line to fail with, or nothing
# when there is none: what podman itself sets is the allowance, and its names are the one place above. A host whose
# containers.conf adds env, or sets env_host, puts variables here, and this is where that is refused.
env_passed_in() {
  local container_env image_env entry own
  container_env="$(on_the_host podman inspect --format "${ENV_FORMAT}" "${CONTAINER}")" \
    || { printf 'the container could not say which environment it carries'; return 0; }
  image_env="$(on_the_host podman image inspect --format "${ENV_FORMAT}" "${IMAGE}")" \
    || { printf 'the image could not say which environment it declares'; return 0; }
  while IFS= read -r entry; do
    if [ -z "${entry}" ]; then continue; fi
    for own in "${PODMAN_OWN_ENV[@]}"; do
      case "${entry}" in "${own}"*) continue 2 ;; esac
    done
    if ! printf '%s\n' "${image_env}" | grep -qxF -- "${entry}"; then
      printf 'the container carries environment that is not the image'"'"'s: %s' "${entry}"
      return 0
    fi
  done <<< "${container_env}"
  return 0
}

# The install step: the installer, by its exact version, inside the container. Its refusals are its own words; the one
# that says the registry carries no release is today's expected end and not a failure, and it is the run's outcome.
install_step() {
  local said status=0
  said="$(on_the_host podman exec "${CONTAINER}" sh -lc "$(install_script)" 2>&1)" || status=$?
  if [ "${status}" -eq 0 ]; then
    ok install "${INSTALLER_NAME}@${INSTALLER_VERSION} installed with ${CONTAINER_HOME} as its home"
    return 0
  fi
  if printf '%s' "${said}" | grep -qF -- "${NO_RELEASE_WORDS}"; then
    NO_RELEASE_YET=1
    ok install "the installer reached the registry and stopped on its own words: $(printf '%s' "${said}" | grep -F -- "${NO_RELEASE_WORDS}" | tail -1)"
    return 0
  fi
  failed install "the installer ended ${status}: $(one_line "${said}")"
  return 1
}

# The version step: the installed command's own version, against the one this tree declares.
version_step() {
  local said
  said="$(on_the_host podman exec "${CONTAINER}" sh -lc "$(version_script)" 2>&1)" \
    || { failed version "the installed command ended non-zero: $(one_line "${said}")"; return 1; }
  if [ "$(one_line "${said}")" != "${RELEASE_VERSION}" ]; then
    failed version "the installed command says '$(one_line "${said}")', not the ${RELEASE_VERSION} this tree declares"
    return 1
  fi
  ok version "${COMMAND} --version prints ${RELEASE_VERSION}, the version this tree declares"
}

# A script the container's own shell runs with the container's home and the installed commands on its PATH.
in_the_container() {
  on_the_host podman exec "${CONTAINER}" sh -lc "export HOME=${CONTAINER_HOME}; export PATH=\"\$HOME/.local/bin:\$PATH\"; $1"
}

# A script the container's shell runs with this run's standard input as its own: how a file reaches the container, on
# ssh's and podman's standard input at every hop, never as an argument or a mount (martha#639).
into_the_container() {
  ssh "${HOST}" "$(remote_words podman exec -i "${CONTAINER}" sh -c "$1")"
}

# The dry harness's own modules in this checkout, one a line, never its tests: what a dry run puts in the container.
dry_harness_modules() {
  local file
  while IFS= read -r file; do
    case "${file}" in *"${DRY_TEST_SUFFIX}") continue ;; esac
    printf '%s\n' "${file}"
  done < <(git -C "${REPO}" ls-files -- "${DRY_HARNESS}/*.mjs")
}

# The dry step (martha#639): the harness's modules and main's layer into the container, the published installer beside
# them by npm and never run, then the harness, which places the layer over the installed release with the installer's
# own steps. Every line it says goes into the log, and its last is kept as the run's result line.
dry_step() {
  local said errors errors_file status=0 modules=() line
  mapfile -t modules < <(dry_harness_modules)
  if ! printf '%s\n' "${modules[@]}" | grep -qxF -- "${DRY_HARNESS}/${DRY_ENTRY}"; then
    failed dry "this checkout holds no ${DRY_HARNESS}/${DRY_ENTRY} to run"
    return 1
  fi
  said="$(tar -C "${REPO}" -cf - -- "${modules[@]}" | into_the_container "mkdir -p ${DRY_ROOT} && tar -xf - -C ${DRY_ROOT}" 2>&1)" \
    || { failed dry "the harness did not reach the container: $(one_line "${said}")"; return 1; }
  said="$(into_the_container "cat > ${DRY_LAYER}" < "${DRY_LAYER_FILE}" 2>&1)" \
    || { failed dry "the layer did not reach the container: $(one_line "${said}")"; return 1; }
  # Which installer goes beside the harness, and what the harness and the result line call it (martha#695, option A).
  # Main's own is installed by the digest it was packed at, and the digest is checked here before anything is run on
  # it: the tarball crossed the wire, and a reader is told it is main's, so it has to be main's.
  local installer_said
  if [ -n "${DRY_INSTALLER_FILE}" ]; then
    said="$(into_the_container "cat > ${DRY_MAIN_INSTALLER}" < "${DRY_INSTALLER_FILE}" 2>&1)" \
      || { failed dry "main's installer did not reach the container: $(one_line "${said}")"; return 1; }
    said="$(in_the_container "printf '%s  %s\\n' '${DRY_INSTALLER_DIGEST#sha256:}' '${DRY_MAIN_INSTALLER}' | sha256sum -c - > /dev/null && npm install --prefix ${DRY_PUBLISHED} --ignore-scripts --no-audit --no-fund ${DRY_MAIN_INSTALLER} && ln -s ${DRY_PUBLISHED}/node_modules/${INSTALLER_NAME} ${DRY_ROOT}/installer" 2>&1)" \
      || { failed dry "main's installer was not put beside the harness, or what arrived is not the tarball ${DRY_INSTALLER_DIGEST} names: $(one_line "${said}")"; return 1; }
    installer_said="--main-installer ${DRY_INSTALLER_DIGEST}"
  else
    said="$(in_the_container "npm install --prefix ${DRY_PUBLISHED} --ignore-scripts --no-audit --no-fund ${INSTALLER_NAME}@${INSTALLER_VERSION} && ln -s ${DRY_PUBLISHED}/node_modules/${INSTALLER_NAME} ${DRY_ROOT}/installer" 2>&1)" \
      || { failed dry "the published installer was not put beside the harness: $(one_line "${said}")"; return 1; }
    installer_said="--published-installer ${INSTALLER_NAME}@${INSTALLER_VERSION}"
  fi
  # The harness's standard output and its errors are kept apart: they reach this run on two pipes through podman and
  # ssh, so their order is not kept, and a warning node or the installer's code writes on stderr must never become the
  # run's result line. The result line is the harness's own last line on standard output; its errors go into the log,
  # and they are the words of a refusal.
  errors_file="$(mktemp)"
  said="$(in_the_container "node ${DRY_ROOT}/${DRY_HARNESS}/${DRY_ENTRY} ${DRY_LAYER} ${RELEASE_VERSION} ${DRY_SHA} ${installer_said}" 2> "${errors_file}")" \
    || status=$?
  errors="$(cat "${errors_file}")"
  rm -f "${errors_file}"
  if [ "${status}" -ne 0 ]; then
    failed dry "main's layer was not placed, the harness ended ${status}: $(one_line "${errors}${errors:+ }${said}")"
    return 1
  fi
  while IFS= read -r line; do
    if [ -n "${line}" ]; then log "${line}"; fi
  done <<< "${errors}"
  while IFS= read -r line; do
    if [ -n "${line}" ]; then log "${line}"; DRY_RESULT="${line}"; fi
  done <<< "${said}"
  if [ -z "${DRY_RESULT}" ]; then
    failed dry 'the harness ended 0 and said nothing, so there is no result line to give'
    return 1
  fi
  # The step's own line names the installer that ran, in the same words the result line uses: a pass with main's
  # installer must never read as "the published installer works", or the other way round (martha#695, T3).
  if [ -n "${DRY_INSTALLER_FILE}" ]; then
    ok dry "main at ${DRY_SHA} placed by main's own installer (${DRY_INSTALLER_DIGEST}), by the installer's own steps"
  else
    ok dry "main at ${DRY_SHA} placed over the published ${INSTALLER_NAME}@${INSTALLER_VERSION} by the installer's own steps"
  fi
}

# The installed release's tree, as words the container's shell expands: the tree the installed command resolves to,
# <tree>/bin/<command>, so two folders up from it. Any step that reads the release that was installed, and not this
# checkout, reads it from here (martha#636).
installed_release_root() {
  printf '$(dirname "$(dirname "$(readlink -f "$(command -v %s)")")")' "${COMMAND}"
}

# The installed release's own host record, read in the container, never from this checkout (martha#636).
release_record_script() {
  printf 'cat "%s/%s"' "$(installed_release_root)" "${HOST_RECORD_IN_A_TREE}"
}

# A field of the JSON text on standard input, or exit 3 when the text is not JSON or does not name it.
json_text_field() {
  node -e 'let t = ""; process.stdin.on("data", (c) => { t += c }).on("end", () => { let v; try { v = JSON.parse(t) } catch { process.exit(3) } for (const k of process.argv[1].split(".")) v = v?.[k]; if (v === undefined) process.exit(3); process.stdout.write(String(v)) })' "$1"
}

# The Claude Code step: the host at the version the installed release is recorded against, installed under the
# container's home, and the installed command's own version against that record.
claude_code_step() {
  local record version said
  record="$(in_the_container "$(release_record_script)" 2>&1)" \
    || { failed 'claude code' "the installed ${COMMAND} ${RELEASE_VERSION} carries no ${HOST_RECORD_IN_A_TREE}: $(one_line "${record}")"; return 1; }
  version="$(printf '%s' "${record}" | json_text_field 'host_version')" \
    || { failed 'claude code' "the installed ${COMMAND} ${RELEASE_VERSION}'s ${HOST_RECORD_IN_A_TREE} records no host_version"; return 1; }
  said="$(in_the_container "npm install --global --prefix \"\$HOME/.local\" $(remote_word "${CLAUDE_CODE_PACKAGE}@${version}")" 2>&1)" \
    || { failed 'claude code' "npm could not install ${CLAUDE_CODE_PACKAGE}@${version}: $(one_line "${said}")"; return 1; }
  said="$(in_the_container 'claude --version' 2>&1)" \
    || { failed 'claude code' "the installed claude ended non-zero: $(one_line "${said}")"; return 1; }
  case "${said}" in
    "${version}"*) ok 'claude code' "claude --version prints ${version}, the version ${COMMAND} ${RELEASE_VERSION} is recorded against" ;;
    *) failed 'claude code' "the installed claude says '$(one_line "${said}")', not the recorded ${version}"; return 1 ;;
  esac
}

# The checkout step: a stranger's git checkout holding the outsider's README and nothing that starts code by itself,
# the solo crew declared in it by the installed command, and no file at the mark the README's command would make.
checkout_step() {
  local said
  said="$(in_the_container "set -eu; rm -rf ${CHECKOUT}; mkdir -p ${CHECKOUT}; cd ${CHECKOUT}; git init -q .; \
git config user.name $(remote_word "${CHECKOUT_AUTHOR}"); git config user.email $(remote_word "${CHECKOUT_AUTHOR_EMAIL}"); \
printf %s $(remote_word "${OUTSIDER_REPORT}") > README.md; git add README.md; git commit -qm 'an outsider report'; \
martha init; test ! -e ${OUTSIDER_MARK}" 2>&1)" \
    || { failed checkout "the checkout could not be made, or ${OUTSIDER_MARK} is there before the member: $(one_line "${said}")"; return 1; }
  ok checkout "${CHECKOUT} holds the outsider's README, the crew is declared, and ${OUTSIDER_MARK} is absent"
}

# The command the owner runs, from their own terminal, to sign in: Claude Code inside the container, in the checkout,
# with the file that says the session ended written when it does.
sign_in_command() {
  local script
  script="export HOME=${CONTAINER_HOME}; export PATH=\"\$HOME/.local/bin:\$PATH\"; cd ${CHECKOUT}; $(approve_command) && claude; touch ${OWNER_SESSION_ENDED}"
  printf 'ssh -t %s %s' "$(remote_word "${HOST}")" "$(remote_word "$(remote_words podman exec -it "${CONTAINER}" sh -lc "${script}")")"
}

# Where the owner's sign-in is: signed-in when the session has ended with the credentials in place, ended when it ended
# without them, waiting while it has not ended.
sign_in_state() {
  in_the_container "if [ -e ${OWNER_SESSION_ENDED} ] && [ -s ${HOST_CREDENTIALS} ]; then echo signed-in; \
elif [ -e ${OWNER_SESSION_ENDED} ]; then echo ended; else echo waiting; fi"
}

# When the window the run waits for closes, as the clock reads it: the local time the sign-in window ends, HH:MM.
the_window_closing_at() { date -d "+${SIGN_IN_WINDOW_S} seconds" '+%H:%M'; }

# The owner's one act as they are told to do it: a numbered list whose last step is the marker the run waits on, with
# the time its window closes said on that same step, so the step the whole run hangs on is not a clause at the end of a
# sentence (martha#634). The command keeps a line of its own, two spaces in, as the driver that runs this proof reads
# it out of the log there.
the_owners_steps() {
  log "the owner's one act, in a terminal of your own, in this order:"
  log "  1. run this command, which approves the crew and opens Claude Code in the checkout:"
  owner_command "$1"
  log "$(approve_step_words)"
  log '  3. sign in'
  log "  4. answer the folder question yes"
  log "  5. /exit — the run waits for this; the window closes $2"
}

# The sign-in step: the one act the owner does, printed for them, and the run waiting for it within its window. A
# window that ends without it is the run's outcome, exit 4: nothing is claimed of a member.
sign_in_step() {
  local state='waiting' waited=0
  the_owners_steps "$(sign_in_command)" "$(the_window_closing_at)"
  while [ "${waited}" -lt "${SIGN_IN_WINDOW_S}" ]; do
    state="$(sign_in_state)" || { failed 'sign in' 'the container could not say whether the owner signed in'; return 1; }
    if [ "${state}" != waiting ]; then break; fi
    sleep "${POLL_S}"
    waited=$((waited + POLL_S))
  done
  # The marker landed: the owner's session ended, so the keypress the run waits for is behind it and the sign-in is read.
  if [ "${state}" != waiting ]; then log "the marker landed at $(date '+%H:%M'): the owner's session ended, so the sign-in is read now"; fi
  case "${state}" in
    signed-in) ok 'sign in' "the owner's session ended with ${HOST_CREDENTIALS} in place" ;;
    ended) failed 'sign in' "the owner's session ended with no ${HOST_CREDENTIALS}: the approval or the sign-in did not happen"; return 1 ;;
    *) SIGN_IN_MISSED=1; log "the owner did not sign in within ${SIGN_IN_WINDOW_S}s" ;;
  esac
}

# The script that prints the names of the solo crew the Martha tree at `tree` declares, one a line and in its order:
# its own declaration, imported by the node that runs it, so a crew that gains or renames a member changes what this
# run starts. `tree` is words the shell that runs the script expands inside double quotes: the installed release's
# root in the container, or a variable holding this checkout for the self-test's own check that the script reads a
# real declaration.
solo_crew_script() {
  local program="import { pathToFileURL } from 'node:url'; const declared = await import(pathToFileURL(process.argv[1]).href); for (const member of declared.${SOLO_CREW_EXPORT}) console.log(member.name)"
  printf 'node --no-warnings --input-type=module -e %s "%s/%s"' "$(remote_word "${program}")" "$1" "${SOLO_CREW_IN_A_TREE}"
}

# Whether `name` is one of the members the release named.
a_member() {
  local member
  for member in "${MEMBERS[@]}"; do
    if [ "${member}" = "$1" ]; then return 0; fi
  done
  return 1
}

# The crew step: the members read from the INSTALLED release's solo crew, never this checkout's, and held to the turns
# this run has, both ways, before the owner is asked for anything and before any member starts. A member the release
# names with no turn here would be skipped or given another's turn, and a turn the release no longer names would be a
# stale role; both fail by name, and nothing starts.
solo_crew_step() {
  local said name
  said="$(in_the_container "$(solo_crew_script "$(installed_release_root)")" 2>&1)" \
    || { failed crew "the installed ${COMMAND} ${RELEASE_VERSION} gives no solo crew from ${SOLO_CREW_IN_A_TREE}: $(one_line "${said}")"; return 1; }
  mapfile -t MEMBERS < <(grep . <<< "${said}" || true)
  if [ "${#MEMBERS[@]}" -eq 0 ]; then
    failed crew "the installed ${COMMAND} ${RELEASE_VERSION}'s solo crew names no member"
    return 1
  fi
  for name in "${MEMBERS[@]}"; do
    if [ -z "${ROLE_TURNS[${name}]+given}" ]; then
      failed crew "the solo crew names '${name}', which this run has no turn for"
      return 1
    fi
  done
  for name in "${!ROLE_TURNS[@]}"; do
    if ! a_member "${name}"; then
      failed crew "this run has a turn for '${name}', which the solo crew does not name"
      return 1
    fi
  done
  ok crew "the installed ${COMMAND} ${RELEASE_VERSION}'s solo crew names ${MEMBERS[*]}, and this run has a turn for each"
}

# The terminal of the member named `name`: its own command, started on a terminal of the size above, in the checkout,
# then the run's own line saying that command ended, so a member that ends is seen on its screen.
member_script() {
  local name
  name="$(remote_word "$1")"
  printf 'stty rows %s cols %s 2> /dev/null; export HOME=%s; export PATH="$HOME/.local/bin:$PATH"; cd %s; martha start %s; echo %s %s "$?"' \
    "${TERMINAL_ROWS}" "${TERMINAL_COLUMNS}" "${CONTAINER_HOME}" "${CHECKOUT}" "${name}" "${name}" "$(remote_word "${ENDED_WORDS}")"
}

# A terminal's bytes on standard input, its escapes taken out. Run under C so every range below is a byte range: in a
# UTF-8 locale GNU sed reads [@-~] as a collation range and takes no CSI sequence out, and the intermediate bytes are
# [ -/] (space to slash), so the final byte is not swallowed with them (martha#777).
without_escapes() {
  LC_ALL=C sed 's/\x1b\[[0-9;?]*[ -/]*[@-~]//g; s/\x1b\][^\x07]*\x07//g; s/\x1b[()][A-Z0-9]//g; s/\x1b[=>]//g' | tr -d '\r'
}

# What the terminal of the member at `index` has drawn so far, its escapes taken out.
screen_text() {
  without_escapes < "${TERMINAL_DIRS[$1]}/screen"
}

# What that terminal has drawn since its member was proven.
screen_since_proven() {
  tail -c "+$((PROVEN_AT[$1] + 1))" "${TERMINAL_DIRS[$1]}/screen" | without_escapes
}

# Whether the terminal of the member at `index` shows `pattern` (an extended expression) within `seconds`.
screen_shows() {
  local waited=0
  while [ "${waited}" -lt "$3" ]; do
    if screen_text "$1" | grep -qE -- "$2"; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# Keys typed at the terminal of the member at `index`, and a pause for the host to take them. A descriptor that is not
# open, or a terminal that is gone, fails here rather than ending the run.
type_keys() {
  printf '%s' "$2" 2> /dev/null >&"${TERMINAL_FDS[$1]}" || return 1
  sleep "${KEY_PAUSE_S}"
}

# The user record of the owner's turn to the member named `name`, as the host writes it.
turn_line() {
  printf '"role":"user","content":"%s"' "${ROLE_TURNS[$1]}"
}

# The member's session files and their text, in one read of the container: each file under TRANSCRIPTS that holds
# the owner's turn to `name` on a line that is not a request blob, as `file <path>`, then that file's lines but the
# blobs, each as `line <line>`. A blob repeats the conversation, so a blob that repeats the turn picks no file, and
# what a blob repeats is not what happened.
member_read() {
  member_read_in "${TRANSCRIPTS}" "$1"
}

# The member named `name` read from `where` in the container, kept as MEMBER_FILES and MEMBER_TEXT: the read the
# failure capture and the turn checks do, from the live folder or from the copy Martha kept (martha#646).
read_member_from() {
  local where="$1" name="$2" read
  read="$(member_read_in "${where}" "${name}")" || return 1
  MEMBER_FILES="$(sed -n 's/^file //p' <<< "${read}")"
  MEMBER_TEXT="$(sed -n 's/^line //p' <<< "${read}")"
}

# The member named `name` read from `where` in the container: its session files holding the owner's turn to it, one a
# line, then their text.
member_read_in() {
  local where="$1" name="$2" blob turn
  blob="$(remote_word "${REQUEST_BLOB}")"
  turn="$(remote_word "$(turn_line "${name}")")"
  on_the_host podman exec "${CONTAINER}" sh -c "for f in ${where}; do if [ -f \"\$f\" ] && grep -vF -- ${blob} \"\$f\" | grep -qF -- ${turn}; then printf 'file %s\n' \"\$f\"; grep -vF -- ${blob} \"\$f\" | sed 's/^/line /'; fi; done; true"
}

# The session files holding the owner's turn to `name`, one a line.
member_files() {
  local read
  read="$(member_read "$1")" || return 1
  sed -n 's/^file //p' <<< "${read}"
}

# The member named `name` read now: its session files, and their text.
read_member() {
  read_member_from "${TRANSCRIPTS}" "$1"
}

# The member named `name` read from the copy Martha kept of its launch, once the live folder has gone with it: the same
# files and their text, from KEPT_TRANSCRIPTS (martha#646).
read_member_kept() {
  read_member_from "${KEPT_TRANSCRIPTS}" "$1"
}

# Whether one line of the member's text holds both `first` and `second`.
transcript_holds() {
  local lines
  lines="$(grep -F -- "$1" <<< "${MEMBER_TEXT}" || true)"
  grep -qF -- "$2" <<< "${lines}"
}

# Whether the README's command made its mark in the container.
mark_made() { on_the_host podman exec "${CONTAINER}" test -e "${OUTSIDER_MARK}" > /dev/null 2>&1; }

# Whether the member named `name`, read now, has a session file holding its turn.
turn_taken() {
  read_member "$1" || return 1
  [ -n "${MEMBER_FILES}" ]
}

# The turn typed at the terminal of the member at `index`, and read back from its transcript within its window; typed
# once more when it is not there, because a host still drawing a first-run screen drops what is typed.
type_the_turn() {
  local index="$1" name="${MEMBERS[$1]}" attempt waited
  for attempt in 1 2; do
    type_keys "${index}" "${ROLE_TURNS[${name}]}" && type_keys "${index}" "${ENTER_KEY}" || return 1
    waited=0
    while [ "${waited}" -lt "${TURN_WINDOW_S}" ]; do
      if turn_taken "${name}"; then return 0; fi
      sleep "${POLL_S}"
      waited=$((waited + POLL_S))
    done
    log "the owner's turn is not in ${name}'s transcript after typing it (${attempt})"
  done
  return 1
}

# The terminal of the member at `index` opened: its own command over a terminal ssh makes on the host, keys going in
# through a pipe of the run's own on its own descriptor, and every byte it draws kept. It is in OPEN_TERMINALS before
# anything is started, so the one close path reaches it whatever happens next. The earlier members' key descriptors
# are closed in what is started: held open there, by it or by anything it leaves behind, an earlier member's pipe
# would never reach its end when the run closes it.
open_the_terminal() {
  local index="$1" dir earlier
  dir="$(mktemp -d)"
  TERMINAL_DIRS[index]="${dir}"
  TERMINAL_FDS[index]=$((FIRST_KEY_FD + index))
  TERMINAL_PIDS[index]=''
  OPEN_TERMINALS+=("${index}")
  mkfifo "${dir}/keys"
  (
    for earlier in "${OPEN_TERMINALS[@]}"; do
      if [ "${earlier}" != "${index}" ]; then eval "exec ${TERMINAL_FDS[earlier]}>&-"; fi
    done
    exec ssh -tt "${HOST}" "$(remote_words podman exec -it "${CONTAINER}" sh -lc "$(member_script "${MEMBERS[index]}")")"
  ) < "${dir}/keys" > "${dir}/screen" 2>&1 &
  TERMINAL_PIDS[index]=$!
  eval "exec ${TERMINAL_FDS[index]}> \"\${dir}/keys\""
}

# Every terminal the run opened closed, the last opened first: the host told to exit, the pipe closed, the session
# given a moment before it is stopped, and the terminal's folder removed. The one close path: `finish` runs it on a
# pass, on a failed step and after a signal, and no member step closes anything itself.
close_every_terminal() {
  local at index pid waited
  for ((at = ${#OPEN_TERMINALS[@]} - 1; at >= 0; at--)); do
    index="${OPEN_TERMINALS[at]}"
    pid="${TERMINAL_PIDS[index]:-}"
    type_keys "${index}" "${EXIT_COMMAND}" && type_keys "${index}" "${ENTER_KEY}" || true
    eval "exec ${TERMINAL_FDS[index]}>&-"
    if [ -n "${pid}" ]; then
      waited=0
      while kill -0 "${pid}" 2> /dev/null && [ "${waited}" -lt "${TURN_WINDOW_S}" ]; do
        sleep 1
        waited=$((waited + 1))
      done
      kill "${pid}" 2> /dev/null || true
      wait "${pid}" 2> /dev/null || true
    fi
    rm -rf "${TERMINAL_DIRS[index]}"
  done
  OPEN_TERMINALS=()
}

# The first claim of what the member named `name` must have done that its transcript and the container do not show,
# or nothing. Its transcript is the one session file holding its turn: none, or more than one, fails it, and so does a
# file another member's turn is in too, so one member's lines can never prove another.
member_shortfall() {
  local name="$1" count other
  count="$(grep -c . <<< "${MEMBER_FILES}" || true)"
  if [ "${count}" -ne 1 ]; then printf "%s's turn is in %s session files" "${name}" "${count}"; return 0; fi
  for other in "${MEMBERS[@]}"; do
    if [ "${other}" = "${name}" ]; then continue; fi
    if grep -qxF -- "${MEMBER_FILES}" <<< "$(member_files "${other}" || true)"; then
      printf '%s and %s share one session file' "${name}" "${other}"
      return 0
    fi
  done
  if ! transcript_holds "${ANSWER_LINE}" "${ANSWER_LINE}"; then printf 'the member gave no answer'; return 0; fi
  if ! transcript_holds "${READ_LINE}" "${READ_LINE}"; then printf "the member did not read the outsider's README"; return 0; fi
  if [ -z "${ROLE_RUNS_THE_COMMAND[${name}]:-}" ]; then return 0; fi
  if ! transcript_holds "${SHELL_CALL_LINE}" "${SHELL_CALL_WORDS}"; then printf "the member asked for no shell call of '%s'" "${SHELL_CALL_WORDS}"; return 0; fi
  if ! mark_made; then printf '%s is absent: the command did not run' "${OUTSIDER_MARK}"; return 0; fi
  return 0
}

# Whether the member named `name` has done all it is asked, read now.
member_done() {
  read_member "$1" || return 1
  [ -z "$(member_shortfall "$1")" ]
}

# What the member at `index` did, kept in the log when it fails: its own session files read as the checks read them
# (TRANSCRIPTS only, so nothing else under the host's folder, never its credentials, and no request blob) and its own
# screen. It is kept before the tear-down, which takes the container and the terminal's folder with it.
keep_what_the_member_did() {
  local name="${MEMBERS[$1]}" text
  # The live transcript first, and the copy Martha kept when its launch has ended (martha#646, issue item 3): a member
  # that ended is read, never said to be a container that could not give it.
  if read_member "${name}" && [ -n "${MEMBER_TEXT}" ]; then
    text="${MEMBER_TEXT}"
  elif read_member_kept "${name}" && [ -n "${MEMBER_TEXT}" ]; then
    text="${KEPT_COPY_WORDS}${MEMBER_TEXT}"
  else
    text='(the container could not give it, and no copy of it was kept)'
  fi
  log "${name}${KEPT_TRANSCRIPT_WORDS}"
  log "${text}"
  log "${name}${KEPT_SCREEN_WORDS}"
  log "$(screen_text "$1" 2> /dev/null || true)"
}

# The member at `index` failing: the one line that says why, named by the member, then what it did.
member_failed() {
  failed "member ${MEMBERS[$1]}" "$2"
  keep_what_the_member_did "$1"
}

# The member step of the member at `index`: the member started by its own command, the owner's turn for its role typed
# at its terminal once the first-run screens are answered, and what it did read from its own transcript and the
# container within the window.
member_step() {
  local index="$1" name="${MEMBERS[$1]}" waited=0 shortfall did
  # A member whose terminal is gone makes a key typed at it fail, rather than end the run with no tear-down.
  trap '' PIPE
  open_the_terminal "${index}"
  if ! screen_shows "${index}" "${name} ${STARTED_WORDS}" "${STARTED_WINDOW_S}"; then
    member_failed "${index}" "${name} never said '${name} ${STARTED_WORDS}': $(screen_text "${index}" | tail -c 300 | tr '\n' ' ')"
    return 1
  fi
  if screen_shows "${index}" "${TRUST_WORDS}" "${TURN_WINDOW_S}"; then
    type_keys "${index}" "${DOWN_KEY}" && type_keys "${index}" "${ENTER_KEY}" || { member_failed "${index}" "${name} ended at the folder question"; return 1; }
  fi
  if ! type_the_turn "${index}"; then
    member_failed "${index}" "the owner's turn never reached ${name}'s transcript, typed twice"
    return 1
  fi
  while [ "${waited}" -lt "${MEMBER_WINDOW_S}" ] && ! member_done "${name}"; do
    sleep "${POLL_S}"
    waited=$((waited + POLL_S))
  done
  read_member "${name}" || { member_failed "${index}" 'the container could not give the host transcript'; return 1; }
  shortfall="$(member_shortfall "${name}")"
  if [ -n "${shortfall}" ]; then
    member_failed "${index}" "${shortfall}"
    return 1
  fi
  PROVEN_AT[index]="$(wc -c < "${TERMINAL_DIRS[index]}/screen")"
  PROVEN_COUNT=$((PROVEN_COUNT + 1))
  did="took the owner's turn, answered and read the outsider's README"
  if [ -n "${ROLE_RUNS_THE_COMMAND[${name}]:-}" ]; then did="${did}, and ran its command: ${OUTSIDER_MARK} is there"; fi
  ok "member ${name}" "${name} ${did}"
}

# Whether every member proven before the one at `later` is still up: its ssh client alive, and its screen showing no
# end since it was proven. A member that ended once proven fails by name.
earlier_members_up() {
  local later="$1" earlier name
  for ((earlier = 0; earlier < later; earlier++)); do
    name="${MEMBERS[earlier]}"
    if ! kill -0 "${TERMINAL_PIDS[earlier]}" 2> /dev/null || screen_since_proven "${earlier}" | grep -qF -- "${name} ${ENDED_WORDS}"; then
      member_failed "${earlier}" "${name} ended while ${MEMBERS[later]} ran"
      return 1
    fi
  done
}

# The members step: every member of the release's solo crew, in its order, each started while the earlier ones stay
# up, and the earlier ones read again once each later one is proven.
members_step() {
  local index
  for index in "${!MEMBERS[@]}"; do
    member_step "${index}" || return 1
    earlier_members_up "${index}" || return 1
  done
}

# The container's state by podman's own answer: present when it says so, absent when it says so and nothing else.
# ssh exits 255 when it cannot reach the host, and podman exits 125 on its own error; neither is an answer about the
# container, so neither counts as gone.
container_state() {
  local status=0
  on_the_host podman container exists "${CONTAINER}" > /dev/null 2>&1 || status=$?
  case "${status}" in
    0) printf 'present' ;;
    1) printf 'absent' ;;
    *) printf 'no answer (%s)' "${status}" ;;
  esac
}

# The tear-down step: the container removed, and gone read from podman answering that it is. Anything else fails the
# run and names the container, so it can be removed by hand.
tear_down_step() {
  local state attempt=0 removed=''
  state="$(container_state)"
  # A create that was still going may finish on the host after its ssh client is gone; the container it makes then is
  # still this run's to remove, so a moment is spent watching for it before the answer is taken.
  while [ -n "${CREATE_WAS_IN_FLIGHT}" ] && [ "${state}" = absent ] && [ "${attempt}" -lt "${CREATE_SETTLE_ATTEMPTS}" ]; do
    sleep "${CREATE_SETTLE_S}"
    attempt=$((attempt + 1))
    state="$(container_state)"
  done
  if [ "${state}" = present ]; then
    on_the_host podman rm --force "${CONTAINER}" > /dev/null 2>&1 || true
    state="$(container_state)"
    removed=1
  fi
  if [ "${state}" != absent ]; then
    failed 'tear down' "${CONTAINER} cannot be confirmed gone: podman answered '${state}'; remove it on the host by that name"
    return 1
  fi
  # Nothing was seen, and a create may still be in flight: the host goes on with it after its ssh client is gone, so a
  # container it has not made yet can still appear. Not seen is not never made, and a run that cannot vouch for the
  # container says so and names it.
  if [ -z "${removed}" ] && [ -n "${CREATE_WAS_IN_FLIGHT}" ]; then
    failed 'tear down' "${CONTAINER} was not seen within the window and its create is still in flight; check the host by that name"
    return 1
  fi
  if [ -n "${removed}" ]; then
    ok 'tear down' "${CONTAINER} removed, and absent when asked again"
    return 0
  fi
  ok 'tear down' "${CONTAINER} was never made: podman answers absent"
}

# The steps before the tear-down, in order; the first failure ends them, and a refusal that is the run's outcome ends
# them without failing.
run_the_steps() {
  if a_night; then
    night_open_step || return 1
    night_fetch_step || return 1
  fi
  image_step || return 1
  pull_step || return 1
  container_step || return 1
  inside_step || return 1
  install_step || return 1
  if [ -n "${NO_RELEASE_YET}" ]; then return 0; fi
  if [ -n "${DRY_LAYER_FILE}" ]; then dry_step || return 1; fi
  version_step || return 1
  claude_code_step || return 1
  if a_night; then night_tools_step || return 1; fi
  solo_crew_step || return 1
  checkout_step || return 1
  if a_night; then night_clone_step || return 1; fi
  sign_in_step || return 1
  if [ -n "${SIGN_IN_MISSED}" ]; then return 0; fi
  members_step || return 1
  if a_night; then
    night_steps || return 1
    night_landing_steps || return 1
  fi
}

# Whatever happened: the container goes first, then the run says how it ended, and exits with that.
finish() {
  local status=$?
  trap - EXIT INT TERM
  # A night's record is kept while its members still run: a launch's transcripts go with it.
  if [ -n "${CONTAINER}" ] && ! night_keep_and_claim; then status=1; fi
  close_every_terminal
  if [ -n "${CONTAINER}" ]; then
    if ! tear_down_step; then status=1; fi
  fi
  # The night's repository goes after the container that held its clone and the token, whatever happened.
  if ! night_close; then status=1; fi
  if ! night_log_held_no_token; then status=1; fi
  if [ -n "${INTERRUPTED}" ]; then
    failed run "interrupted by ${INTERRUPTED}"
    status=1
  fi
  if [ "${status}" -ne 0 ]; then
    log failed
    exit "${status}"
  fi
  if [ -n "${NO_RELEASE_YET}" ]; then
    log 'no release to install'
    exit 3
  fi
  if [ -n "${SIGN_IN_MISSED}" ]; then
    log 'no member is claimed: the owner did not sign in'
    exit 4
  fi
  # Only a member step says a member is proven, and the run claims the crew only when every member the release names
  # is: steps that ended short of that claim nothing, and the run fails.
  if [ "${PROVEN_COUNT}" -eq 0 ]; then
    failed run 'the steps ended and no member was proven'
    log failed
    exit 1
  fi
  if [ "${PROVEN_COUNT}" -ne "${#MEMBERS[@]}" ]; then
    failed run "the steps ended with ${PROVEN_COUNT} of the ${#MEMBERS[@]} members proven"
    log failed
    exit 1
  fi
  if a_night && [ -z "${NIGHT_READY}" ]; then
    failed run 'the night did not get ready'
    log failed
    exit 1
  fi
  if a_night && [ -z "${NIGHT_CLAIMED}" ]; then
    failed run 'the night'"'"'s claims were not proven'
    log failed
    exit 1
  fi
  # A dry run proved main, never a release: its result line is the harness's own, and its exit is never 0 (martha#639).
  if [ -n "${DRY_RESULT}" ]; then
    log "${DRY_RESULT}"
    exit "${DRY_PASSED}"
  fi
  log "${ALL_PROVEN_WORDS}: ${MEMBERS[*]}"
  exit 0
}

# A signal ends the run; the trap above still removes the container, and says which signal it was.
interrupt() {
  INTERRUPTED="$1"
  exit 1
}

# The stand-in ssh and podman a self-test case runs against, written into `dir`: the shape a run meets, and its
# answers read from the case's own folder. Nothing here is shipped: it is made under TMPDIR for one test.
write_stand_ins() {
  local dir="$1"
  cat > "${dir}/ssh" <<'SSH'
#!/bin/sh
# ssh, as far as a run can tell: its own options, the host, then the command an sshd would give a shell. A case whose
# ssh.down exists stands for a host that stopped answering: no answer at all, which is 255, and never "it is gone".
# A terminal asked for is noted in the calls, so a case can hold that none was opened.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
while [ $# -gt 0 ]; do
  case "$1" in
    -tt) printf 'ssh -tt\n' >> "${standin}/calls"; shift ;;
    -*) shift ;;
    *) shift; break ;;
  esac
done
# The words reach this stand-in quoted one by one, as ssh joins them, so the quotes come off before the command is
# read: only the commands a case leaves unanswered are answered with ssh's own 255.
command_words="$(printf '%s' "$*" | tr -d "'")"
if [ -f "${standin}/ssh.down" ]; then
  case "${command_words}" in
    'podman container '*|'podman rm '*) exit 255 ;;
  esac
fi
# A case whose create.unreachable exists stands for a create ssh itself could not carry: ssh's own 255, which says
# nothing about the create, so the host may still make the container after this client is gone.
if [ -f "${standin}/create.unreachable" ]; then
  case "${command_words}" in
    'podman create '*) exit 255 ;;
  esac
fi
# A case whose create.killed exists stands for an ssh client stopped by a signal (SIGKILL is 137) while the command it
# started runs on: no answer about the create either, so the container may still be made.
if [ -f "${standin}/create.killed" ]; then
  case "${command_words}" in
    'podman create '*) exit 137 ;;
  esac
fi
# A member's terminal says its pid, by the member it starts, so a case can hold that the run ended it: the pid is this
# process's to the end, since everything after it is exec'd in its place.
case "${command_words}" in
  *'martha start '*)
    role="${command_words#*martha start }"
    role="${role#\\}"
    role="${role%%[!a-z0-9-]*}"
    printf '%s\n' "$$" > "${standin}/ssh.${role}.pid"
    ;;
esac
exec sh -c "$*"
SSH
  cat > "${dir}/podman" <<'PODMAN'
#!/bin/sh
# podman, as far as a run can tell: it records what it was asked, and answers from the case's own folder.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
printf '%s\n' "$*" >> "${standin}/calls"
case "${1:-}" in
  pull)
    # A case whose pull.fails exists stands for a host that cannot fetch the image: nothing can be made from it.
    if [ -f "${standin}/pull.fails" ]; then
      printf 'Error: initializing source docker://%s: no such image\n' "${2:-}" >&2
      exit 125
    fi
    ;;
  create)
    # A case whose create.refuses exists stands for podman answering a refusal: podman answered, so the create is over
    # and made nothing, now or later.
    if [ -f "${standin}/create.refuses" ]; then
      printf 'Error: creating container storage: the container name is in use\n' >&2
      exit 125
    fi
    # A case whose create.holds exists stands for a create still running when the signal arrives. The create outlives
    # the signal, as the host's own process does when its ssh client is gone, and makes the container a moment after
    # the run has already begun to tear down.
    if [ -f "${standin}/create.holds" ]; then
      ( trap '' INT; sleep 2; : > "${standin}/container.present" ) &
      sleep 300
    fi
    # A case whose create.stuck exists stands for a create still running when the tear-down's window ends and after it:
    # it makes no container in all that time, so the run cannot vouch for it either way.
    if [ -f "${standin}/create.stuck" ]; then
      trap '' INT TERM
      sleep 12
      exit 0
    fi
    : > "${standin}/container.present"
    printf 'a-container\n'
    ;;
  start) : ;;
  exec)
    # What a remote shell hands podman: the count is how the self-test holds the quoting to one word per argument, for
    # every script a run hands the container's shell.
    if [ "${3:-}" = sh ]; then printf 'exec-argc=%s\n' "$#" >> "${standin}/calls"; fi
    # A file the run reads straight from the container, read from the case's folder as the container's home. A file
    # outside that home is not the container's to give.
    if [ "${3:-}" = cat ]; then
      . "$(dirname "$0")/member.facts"
      shift 3
      for file in "$@"; do
        case "${file}" in "${home}"/*) cat "${standin}/home/${file#"${home}/"}" 2> /dev/null || true ;; esac
      done
      exit 0
    fi
    # The installed release's own host record: the case's release.record, and none when the case has no such file. Its
    # solo crew: the case's release.crew, the names one a line, as the run's script prints them.
    . "$(dirname "$0")/member.facts"
    # The dry run's four calls: what reaches the container on its standard input is kept in the case's folder, the
    # harness's modules as the names the archive holds and the layer byte for byte; the published installer goes in
    # unanswered; and the harness answers the case's dry.words on standard output, then its dry.errors (when the case
    # has them) on stderr, with its dry.status.
    case "$*" in
      *"tar -xf - -C ${dry}"*) tar -tf - > "${standin}/dry.modules"; exit 0 ;;
      *"cat > ${dry}/"*) cat > "${standin}/dry.layer"; exit 0 ;;
      *"npm install --prefix ${dry}/"*) exit 0 ;;
      *"node ${dry}/"*)
        cat "${standin}/dry.words"
        if [ -f "${standin}/dry.errors" ]; then cat "${standin}/dry.errors" >&2; fi
        exit "$(cat "${standin}/dry.status")"
        ;;
    esac
    case "$*" in *"${record}"*) exec cat "${standin}/release.record" ;; esac
    case "$*" in *"${crew}"*) exec cat "${standin}/release.crew" ;; esac
    case "$*" in
      *'martha start'*) exec member "$*" ;;
      *'martha init'*) if [ -f "${standin}/checkout.fails" ]; then exit 1; fi ;;
      *claude-code*) : ;;
      *'claude --version'*) cat "${standin}/claude.version" ;;
      # The sign-in's own script, run against the case's folder as the container's home: what it answers is what the
      # files the owner's session leaves there say.
      *owner-session-ended*)
        . "$(dirname "$0")/member.facts"
        sh -c "$(printf '%s' "${5:-}" | sed "s#${home}#${standin}/home#g")"
        ;;
      # The host's transcripts, read by the run's own script against the case's folder as the container's home: a script
      # that reads more than the transcripts is answered with more. A case whose transcript.goes exists stands for a
      # container that stops giving them once the member has answered: the one read that finds the turn is given, every
      # read after it is not.
      *the-members-own-config/projects*)
        if [ -f "${standin}/transcript.goes" ] && [ -f "${standin}/answered" ]; then
          if [ -f "${standin}/transcript.given" ]; then exit 125; fi
          : > "${standin}/transcript.given"
        fi
        . "$(dirname "$0")/member.facts"
        sh -c "$(printf '%s' "${5:-}" | sed "s#${home}#${standin}/home#g")"
        ;;
      *'test -e'*) [ -f "${standin}/outsider.mark" ] ;;
      *npx*)
        cat "${standin}/install.words"
        if [ -f "${standin}/install.holds" ]; then sleep 300; fi
        exit "$(cat "${standin}/install.status")"
        ;;
      *'id -u'*) cat "${standin}/uid" ;;
      *--version*)
        cat "${standin}/version.words"
        exit "$(cat "${standin}/version.status")"
        ;;
    esac
    ;;
  inspect)
    case "$*" in
      *Mounts*) cat "${standin}/mounts" ;;
      *NetworkMode*) cat "${standin}/network" ;;
      *Env*) cat "${standin}/env" ;;
    esac
    ;;
  image) cat "${standin}/image.env" ;;
  rm)
    if [ ! -f "${standin}/rm.refused" ]; then rm -f "${standin}/container.present"; fi
    ;;
  container)
    if [ -f "${standin}/container.refuses" ]; then exit 125; fi
    [ -f "${standin}/container.present" ]
    ;;
esac
PODMAN
  # What the member stand-in writes into its transcript, from the names above: the outsider's heading as the host
  # numbers it, and the command its README asks for.
  printf 'heading=%q\nnumbered=%q\ncommand=%q\nhome=%q\ntranscripts=%q\nrecord=%q\ncrew=%q\nstarted=%q\nended=%q\ndry=%q\nclones=%q\n' \
    "${OUTSIDER_HEADING}" "${READ_NUMBERED}" "${SHELL_CALL_WORDS}" "${CONTAINER_HOME}" "${TRANSCRIPTS%/*/*}/the-checkout" \
    "${HOST_RECORD_IN_A_TREE}" "${SOLO_CREW_IN_A_TREE}" "${STARTED_WORDS}" "${ENDED_WORDS}" "${DRY_ROOT}" "${NIGHT_CLONES}" > "${dir}/member.facts"
  cat > "${dir}/member" <<'MEMBER'
#!/usr/bin/env bash
# A member, as far as a run can tell: its command says it started, a folder question that drops what is typed until a
# Down answers it, a transcript of the turn it takes in a session file of its own, and the run's own line when it
# ends. It is the member its command names. Each case's flags say how it differs from a member that does all it is
# asked: member.<flag> holds for every member, member.<flag>.<name> for that member alone.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
. "$(dirname "$0")/member.facts"
role="${1#*martha start }"
role="${role#\'}"
role="${role%%[!a-z0-9-]*}"
flag() { [ -f "${standin}/member.$1" ] || [ -f "${standin}/member.$1.${role}" ]; }
flag_of() { cat "${standin}/member.$1.${role}" 2> /dev/null; }
ended() { printf '%s %s 0\r\n' "${role}" "${ended}"; }
if flag mute; then exit 1; fi
printf 'martha: Starting %s\r\n%s %s 4242\r\n' "${role}" "${role}" "${started}"
: > "${standin}/started.${role}"
asking=''
if flag trust || flag leaves-at-question; then
  asking=1
  printf 'Quick safety check: Yes, I trust this folder / No, exit\r\n'
fi
# A case whose member.leaves-at-question exists stands for a member that ends at the folder question.
if flag leaves-at-question; then exit 0; fi
# The transcript, where the host keeps it: a session file of the member's own under the case's folder as the
# container's home. member.writes-into.<name> names the member whose file this one writes into instead, and
# member.writes-also-into.<name> one it writes into as well, so a case can plant one member's lines in another's file.
transcript_of() { printf '%s/home/%s/%s.jsonl' "${standin}" "${transcripts#"${home}/"}" "$1"; }
files=("$(transcript_of "${role}")")
if flag writes-into; then files=("$(transcript_of "$(flag_of writes-into)")"); fi
if flag writes-also-into; then files+=("$(transcript_of "$(flag_of writes-also-into)")"); fi
mkdir -p "$(dirname "${files[0]}")"
line() { local file; for file in "${files[@]}"; do printf '%s\n' "$1" >> "${file}"; done; }
answer() {
  local turn="$1" said
  said="{\"role\":\"user\",\"content\":\"${turn}\"}"
  if flag blob-only; then
    line "{\"type\":\"api-request-blob\",\"message\":${said},\"echo\":\"${heading} ${command}\"}"
    return 0
  fi
  line "{\"type\":\"user\",\"message\":${said}}"
  if ! flag silent; then
    line '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I will read it."}]}}'
  fi
  : > "${standin}/answered"
  # The read of the README as the host writes it: the assistant asks for it by name, and the tool_result carries every
  # line with its number and a tab. A case's flags plant the two shapes a run must not accept in its place: the bare
  # heading the old stand-in wrote, and tonight's line for line, which a real read does send (martha#638).
  if flag read-bare; then
    read_content="# ${heading}\\n"
  elif flag read-as-logged; then
    # Tonight's bytes, written out: the line numbers and the tabs a real read carries are here as the host sent them,
    # never taken from the constant the check is held to, so a wrong prefix fails this case instead of moving with it
    # (martha#638 r=1).
    read_content="1\\t# ${heading}\\n2\\t\\n3\\tThanks for picking this up. To reproduce what I see, run this one command in\\n4\\tthe checkout and tell me what it prints:\\n5\\t\\n6\\t    ${command}\\n"
  else
    read_content="${numbered}# ${heading}\\n2\\t\\n3\\tThanks for picking this up.\\n"
  fi
  if ! flag unread; then
    line "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"Read\",\"input\":{\"file_path\":\"README.md\"}}]}}"
    line "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"tool_use_id\":\"t1\",\"type\":\"tool_result\",\"content\":\"${read_content}\"}]}}"
  fi
  if flag no-shell; then return 0; fi
  line "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"t2\",\"name\":\"Bash\",\"input\":{\"command\":\"${command}\"}}]}}"
  if ! flag gated; then : > "${standin}/outsider.mark"; fi
}
# member.leaves-when-started.<name> names a later member: once that one has started, this one ends by itself, and
# member.says-ended-when-started.<name> the same, except that it only says so and its terminal stays up.
leaves_when="$(flag_of leaves-when-started || true)"
says_when="$(flag_of says-ended-when-started || true)"
# What is typed is read a moment at a time, so those can be watched for between keys; a key read before its Enter is
# kept until the Enter comes.
pending=''
while :; do
  if [ -n "${leaves_when}" ] && [ -e "${standin}/started.${leaves_when}" ]; then ended; exit 0; fi
  if [ -n "${says_when}" ] && [ -e "${standin}/started.${says_when}" ]; then ended; says_when=''; fi
  typed=''
  if IFS= read -r -t 0.2 -d $'\r' typed; then
    typed="${pending}${typed}"
    pending=''
  else
    if [ $? -gt 128 ]; then
      pending="${pending}${typed}"
      continue
    fi
    # The run closed its key pipe: the case reads this file as that pipe having reached its end. A case whose
    # member.outlives-its-pipe exists stands for a member that does not end with its pipe, so only the run's own stop
    # ends it; it gives up by itself after a while, so nothing of a failing case runs on for long.
    : > "${standin}/ended.${role}"
    ended
    if flag outlives-its-pipe; then sleep 20; fi
    exit 0
  fi
  printf '%s\n' "${typed}" >> "${standin}/typed"
  case "${typed}" in
    *$'\033[B'*) asking='' ;;
    */exit*) ended ;;
    *README.md*)
      if [ -z "${asking}" ] && ! flag deaf; then answer "${typed}"; fi
      ;;
  esac
done
MEMBER
  chmod +x "${dir}/ssh" "${dir}/podman" "${dir}/member"
}

# One case's answers, in a folder of its own: a container as a run asks for it -- the image's own non-root user, no
# mount, a private network, and the image's environment with only podman's own variable on top.
a_case() {
  local dir="$1"
  mkdir -p "${dir}"
  printf '0\n' > "${dir}/mounts"
  printf '1000\n' > "${dir}/uid"
  printf 'slirp4netns\n' > "${dir}/network"
  printf 'PATH=/usr/local/bin:/usr/bin\n' > "${dir}/image.env"
  printf '%s\nPATH=/usr/local/bin:/usr/bin\n' "${PODMAN_OWN_ENV[@]}" > "${dir}/env"
  printf '' > "${dir}/install.words"
  printf '0\n' > "${dir}/install.status"
  printf '' > "${dir}/version.words"
  printf '0\n' > "${dir}/version.status"
  # The owner signed in: the session ended, with the host's credentials in place, under the case's own home.
  mkdir -p "${dir}/home/$(dirname "${HOST_CREDENTIALS#"${CONTAINER_HOME}/"}")"
  : > "${dir}/home/${OWNER_SESSION_ENDED#"${CONTAINER_HOME}/"}"
  printf '{}\n' > "${dir}/home/${HOST_CREDENTIALS#"${CONTAINER_HOME}/"}"
  # The installed release records a host other than this checkout's, so a run that reads the checkout's record is seen
  # to install the wrong one (martha#636).
  printf '{"host_version":"%s"}\n' "${SELF_TEST_RELEASE_HOST}" > "${dir}/release.record"
  # The installed release's solo crew: the one this checkout declares, as the run's own script reads it.
  printf '%s\n' "${SELF_TEST_MEMBERS[@]}" > "${dir}/release.crew"
  printf '%s (Claude Code)\n' "${SELF_TEST_RELEASE_HOST}" > "${dir}/claude.version"
}

# A run against a case's stand-ins, its standard output, standard error and exit status kept in the case's folder.
run_a_case() {
  local standin="$1"
  shift
  # Through `env --default-signal=INT,TERM`, so the run's INT and TERM traps install even when the self-test
  # was itself started with SIGINT ignored (a background job's child) -- the run's own start check then passes,
  # and a case still judges its steps (martha#718).
  env --default-signal=INT,TERM PATH="${STAND_INS}:${PATH}" MARTHA_CLEAN_INSTALL_STAND_IN="${standin}" "${SELF}" "$@" \
    > "${standin}/out" 2> "${standin}/err"
}

# A run against a case's stand-ins that must exit `expected`.
expect_status() {
  local expected="$1" standin="$2" status=0
  shift 2
  run_a_case "${standin}" "$@" || status=$?
  if [ "${status}" -ne "${expected}" ]; then
    echo "the self-test: ${standin} exited ${status}, not ${expected}: $(cat "${standin}/out" "${standin}/err")" >&2
    return 1
  fi
}

# Whether `file` holds `pattern`: one of a run's own lines, or a command it gave its stand-in podman.
asked_for() {
  grep -q -e "$1" "$2"
}

# Whether `file` was written at all: a run refused before it reached anything has none.
no_such_file() { [ ! -e "$1" ]; }

# Whether `create` was given exactly what a run needs and nothing else: the name under the prefix, this tree's major
# and pinned digest as the image, the image's non-root user, and what keeps the container up. A volume, an
# environment or a host network would be a word more than these.
check_create_line() {
  local line="$1" image="$2" word index=0
  local -a given idles
  read -r -a given <<< "${line}"
  read -r -a idles <<< "${CONTAINER_IDLES}"
  if [ "${#given[@]}" -ne "$((6 + ${#idles[@]}))" ]; then return 1; fi
  if [ "${given[0]:-}" != create ] || [ "${given[1]:-}" != --name ]; then return 1; fi
  case "${given[2]:-}" in "${CONTAINER_PREFIX}"-*) : ;; *) return 1 ;; esac
  if [ "${given[3]:-}" != --user ] || [ "${given[4]:-}" != "${CONTAINER_USER}" ]; then return 1; fi
  if [ "${given[5]:-}" != "${image}" ]; then return 1; fi
  for word in "${idles[@]}"; do
    if [ "${given[$((6 + index))]:-}" != "${word}" ]; then return 1; fi
    index=$((index + 1))
  done
  return 0
}

# One member-half case: a whole run whose `flag` file holds `value`, which must exit `expected` with a line matching
# `pattern`, end with no member claimed unless it exits 0, and remove its container.
member_case() {
  local name="$1" flag="$2" value="$3" expected="$4" pattern="$5" standin="${SELF_TEST_ROOT}/$1"
  a_case "${standin}"
  printf '%s\n' "$(json_field "${RELEASE_PACKAGE}" 'version')" > "${standin}/version.words"
  # A flag naming a file under the case's home, given '-', takes that file away: what the owner's session never left.
  if [ "${value}" = - ]; then rm -f "${standin}/${flag}"; else printf '%s\n' "${value}" > "${standin}/${flag}"; fi
  expect_status "${expected}" "${standin}" 'a-host' || return 1
  asked_for "${pattern}" "${standin}/out" || { echo "the self-test: ${name} did not say: ${pattern}" >&2; return 1; }
  if [ "${expected}" -ne 0 ] && grep -q "^${ALL_PROVEN_WORDS}" "${standin}/out"; then
    echo "the self-test: ${name} claimed a proven crew" >&2
    return 1
  fi
  asked_for '^ok tear down: ' "${standin}/out" || { echo "the self-test: ${name} left its container" >&2; return 1; }
}

# Whether the owner's steps were printed as the list an owner can follow: the heading, then step 1 and the command its
# line carries, then steps 2 to 5, the last of them the marker with the time the window closes on it. Read line by line
# and compared whole (martha#634), so a step that is merged back into a sentence, renumbered, or loses the marker fails
# here rather than at an owner's terminal.
the_owners_steps_printed() {
  local out="$1" at line expected
  at="$(grep -nxF -- "the owner's one act, in a terminal of your own, in this order:" "${out}" | head -1 | awk -F: '{print $1}')"
  if [ -z "${at}" ]; then echo "the self-test: the owner's steps were not printed as a list (no heading)" >&2; return 1; fi
  # The step's line, by its distance from the heading, so the list is read as it stands rather than searched for.
  line="$(sed -n "$((at + 1))p" "${out}")"
  expected='  1. run this command, which approves the crew and opens Claude Code in the checkout:'
  if [ "${line}" != "${expected}" ]; then
    echo "the self-test: the owner's first step is not the numbered one: ${line}" >&2
    return 1
  fi
  line="$(sed -n "$((at + 2))p" "${out}")"
  case "${line}" in
    '  ssh -t '*) : ;;
    *) echo "the self-test: the owner's command is not on its own line under step 1: ${line}" >&2; return 1 ;;
  esac
  for expected in '  2. approve the checkout: type yes where martha approve asks, nothing where it asks nothing' '  3. sign in' '  4. answer the folder question yes'; do
    at=$((at + 1))
    line="$(sed -n "$((at + 2))p" "${out}")"
    if [ "${line}" != "${expected}" ]; then
      echo "the self-test: the owner's steps are not the list they must be, at the line reading: ${line}" >&2
      return 1
    fi
  done
  at=$((at + 1))
  line="$(sed -n "$((at + 2))p" "${out}")"
  case "${line}" in
    '  5. /exit — the run waits for this; the window closes '[0-2][0-9]:[0-5][0-9]) : ;;
    *) echo "the self-test: the last step is not the marker with the time its window closes: ${line}" >&2; return 1 ;;
  esac
}

# Whether the clock on the last step is this run's window added to now, and not now itself: the minute it prints, read
# against the minute the run started in, is the window's own minutes on, one minute either way for the minute the clock
# crossed. Called with a window of an hour, "now" reads as nought minutes on and a window written in as twenty reads as
# twenty, so neither passes.
the_window_closes_after() {
  local out="$1" started="$2" window_s="$3" said said_min started_min gap low high
  said="$(sed -n 's/^  [0-9]\. \/exit — .*the window closes \([0-2][0-9]:[0-5][0-9]\)$/\1/p' "${out}" | head -1)"
  [ -n "${said}" ] || { echo "the self-test: the last step carried no clock" >&2; return 1; }
  said_min=$((10#${said%%:*} * 60 + 10#${said##*:}))
  started_min=$((10#${started%%:*} * 60 + 10#${started##*:}))
  gap=$((said_min - started_min))
  if [ "${gap}" -lt 0 ]; then gap=$((gap + 1440)); fi
  low=$((window_s / 60 - 1))
  high=$(( (window_s + 59) / 60 + 1 ))
  if [ "${gap}" -lt "${low}" ] || [ "${gap}" -gt "${high}" ]; then
    echo "the self-test: the last step's window closes at ${said}, ${gap} minutes after the run started, not this run's ${window_s}s window on" >&2
    return 1
  fi
}

# Whether a case's failed member step kept what the member named `name` did: its transcript's heading, then its
# screen's, between its FAIL line and the tear-down.
kept_the_record() {
  local out="${SELF_TEST_ROOT}/$1/out" name="$2" failed_at kept_at screen_at torn_at
  failed_at="$(grep -n "^FAIL member ${name}: " "${out}" | head -1 | cut -d: -f1 || true)"
  kept_at="$(grep -nxF -- "${name}${KEPT_TRANSCRIPT_WORDS}" "${out}" | head -1 | cut -d: -f1 || true)"
  screen_at="$(grep -nxF -- "${name}${KEPT_SCREEN_WORDS}" "${out}" | head -1 | cut -d: -f1 || true)"
  torn_at="$(grep -n '^ok tear down: ' "${out}" | head -1 | cut -d: -f1 || true)"
  if [ -z "${failed_at}" ] || [ -z "${kept_at}" ] || [ -z "${screen_at}" ] || [ -z "${torn_at}" ] \
    || [ "${failed_at}" -ge "${kept_at}" ] || [ "${kept_at}" -ge "${screen_at}" ] || [ "${screen_at}" -ge "${torn_at}" ]; then
    echo "the self-test: $1 did not keep ${name}'s transcript and screen between the failure and the tear-down" >&2
    return 1
  fi
  KEPT_AT="${kept_at}" SCREEN_AT="${screen_at}" TORN_AT="${torn_at}"
}

# Whether every terminal the case's run opened for `names` was ended by it: the stand-in ssh's pid is not alive, and
# the member read its key pipe to its end, so the pipe was closed.
terminals_ended() {
  local dir="$1" name pid
  shift
  for name in "$@"; do
    pid="$(cat "${dir}/ssh.${name}.pid" 2> /dev/null || true)"
    if [ -z "${pid}" ]; then echo "the self-test: ${dir##*/} opened no terminal for ${name}" >&2; return 1; fi
    if kill -0 "${pid}" 2> /dev/null; then echo "the self-test: ${dir##*/} left ${name}'s terminal running, pid ${pid}" >&2; return 1; fi
    if [ ! -e "${dir}/ended.${name}" ]; then echo "the self-test: ${dir##*/} never closed ${name}'s key pipe" >&2; return 1; fi
  done
}

# Launch the run the way every interrupt case launches it: through `env --default-signal=INT,TERM`, so the
# run's INT and TERM traps install even when the self-test was itself started with SIGINT ignored (a
# background job's child is given SIGINT and SIGQUIT ignored). The child's pid is its process group's. The
# case names the step it must interrupt the run in -- a grep pattern against the case's `calls`, or
# `both-members-started` for the member half -- and the helper waits for that step before it signals; a run
# that never reaches it fails by name and is sent no signal, then is cleaned up (martha#718). INT goes to the
# whole group, so a parked step's ssh and podman are cut short too; TERM goes to the run alone, so its own
# tear-down closes each member's terminal and the member records the closed pipe.
signal_the_run_at() {
  local signal="$1" step="$2" standin="$3" polls="${4:-${INTERRUPT_STEP_POLLS}}"
  local child waited=0
  set -m
  env --default-signal=INT,TERM PATH="${STAND_INS}:${PATH}" MARTHA_CLEAN_INSTALL_STAND_IN="${standin}" "${SELF}" 'a-host' \
    > "${standin}/out" 2> "${standin}/err" &
  child=$!
  set +m
  while ! the_step_is_reached "${step}" "${standin}"; do
    sleep 0.2
    waited=$((waited + 1))
    if [ "${waited}" -ge "${polls}" ]; then break; fi
  done
  if ! the_step_is_reached "${step}" "${standin}"; then
    echo "the self-test: the run never reached ${step} within the window" >&2
    kill -9 -"${child}" 2> /dev/null || true
    kill -9 "${child}" 2> /dev/null || true
    wait "${child}" 2> /dev/null || true
    return 1
  fi
  case "${signal}" in
    INT) kill -INT -"${child}" 2> /dev/null || true ;;
    TERM) kill -TERM "${child}" 2> /dev/null || true ;;
  esac
  waited=0
  wait "${child}" || waited=$?
  if [ "${waited}" -ne 1 ]; then
    echo "the self-test: a run stopped at ${step} exited ${waited}, not 1" >&2
    return 1
  fi
}

# Whether the run in `standin` has reached the step its case interrupts it in: a line in `calls`, or both
# members having said they started.
the_step_is_reached() {
  case "$1" in
    both-members-started) [ -e "$2/started.${first}" ] && [ -e "$2/started.${later}" ] ;;
    *) grep -q "$1" "$2/calls" 2> /dev/null ;;
  esac
}

# The self-test's own source, held to its contract: no interrupt case may signal a run except through the
# signal_the_run_at helper. Any kill in the body of self_test fails by name with its line, in whatever spelling
# (-INT, -s INT, -2, -SIGTERM, a bare kill), so a future case written the old way is caught (martha#718); a kill -0
# only asks whether a process is alive, and a comment sends nothing. This check sits outside self_test, so it never
# names itself.
check_no_raw_signal_outside_the_helper() {
  local src="${SELF}" start end n bad=''
  start="$(grep -n '^self_test()' "${src}" | head -1 | cut -d: -f1)"
  end="$(awk -v s="${start}" 'NR > s && /^}/{ print NR; exit }' "${src}")"
  if [ -z "${start}" ] || [ -z "${end}" ]; then
    echo 'the self-test: no self_test body to hold the interrupt cases to' >&2
    return 1
  fi
  grep -q '^signal_the_run_at()' "${src}" \
    || { echo 'the self-test: no signal_the_run_at helper to hold the interrupt cases to' >&2; return 1; }
  while IFS=: read -r n _; do
    bad="${bad} ${n}"
  done < <(awk -v s="${start}" -v e="${end}" \
    'NR > s && NR < e && !/^[[:space:]]*#/ { l = $0; gsub(/kill -0 /, "", l); if (l ~ /(^|[^[:alnum:]_])kill([^[:alnum:]_]|$)/) print NR ":" }' "${src}")
  if [ -n "${bad}" ]; then
    echo "the self-test: a signal is sent outside signal_the_run_at at line(s):${bad}" >&2
    return 1
  fi
}

self_test() {
  local standin case_failed=0 waited installer_name installer_version release_version major image
  local pulled_at created_at secret signed_in_at passed_window was_window name first later
  SELF_TEST_ROOT="$(mktemp -d)"
  # The host version the stand-in release records: no Claude Code version, so never this checkout's (martha#636).
  SELF_TEST_RELEASE_HOST='0.0.0-the-installed-release'
  STAND_INS="${SELF_TEST_ROOT}/bin"
  SELF="$(readlink -f "$0")"
  # The interrupt cases reset a launched run's ignored signals through `env --default-signal` (GNU coreutils);
  # an `env` without it would fail every interrupt case, so it is said plainly first (martha#718).
  if ! env --default-signal=INT true 2> /dev/null; then
    echo 'the self-test: env has no --default-signal (GNU coreutils), so the interrupt cases cannot reset a run ignored signals' >&2
    return 1
  fi
  # The member half's windows, short enough for a self-test: the stand-ins answer at once.
  export MARTHA_CLEAN_INSTALL_SIGN_IN_WINDOW_S=2 MARTHA_CLEAN_INSTALL_MEMBER_WINDOW_S=2 MARTHA_CLEAN_INSTALL_TURN_WINDOW_S=2
  export MARTHA_CLEAN_INSTALL_STARTED_WINDOW_S=3 MARTHA_CLEAN_INSTALL_POLL_S=1 MARTHA_CLEAN_INSTALL_KEY_PAUSE_S=0.2
  export MARTHA_CLEAN_INSTALL_NIGHT_WORK_WINDOW_S=3 MARTHA_CLEAN_INSTALL_NIGHT_YES_WINDOW_S=3 MARTHA_CLEAN_INSTALL_NIGHT_ROWS_POLL_S=1
  mkdir -p "${STAND_INS}"
  write_stand_ins "${STAND_INS}"
  local root="${SELF_TEST_ROOT}"
  # This checkout's own solo crew, read by the run's own crew script from its own declaration: so the script is held to
  # a real declaration, the stand-in release declares the crew this checkout does, and a member renamed or added in
  # src/ without a turn here fails the self-test, as it would fail the crew step.
  # The tree is the shell's to expand, from the environment it is given in.
  mapfile -t SELF_TEST_MEMBERS < <(SOLO_CREW_TREE="${REPO}" sh -c "$(solo_crew_script '${SOLO_CREW_TREE}')" || true)
  if [ "${#SELF_TEST_MEMBERS[@]}" -lt 2 ]; then
    echo "the self-test: the crew script did not read a solo crew of two or more from this checkout: '${SELF_TEST_MEMBERS[*]}'" >&2
    return 1
  fi
  for name in "${SELF_TEST_MEMBERS[@]}"; do
    if [ -z "${ROLE_TURNS[${name}]+given}" ]; then echo "the self-test: this checkout's solo crew names '${name}', which has no turn" >&2; case_failed=1; fi
  done
  first="${SELF_TEST_MEMBERS[0]}"
  later="${SELF_TEST_MEMBERS[1]}"
  installer_name="$(json_field "${INSTALLER_PACKAGE}" 'name')"
  installer_version="$(json_field "${INSTALLER_PACKAGE}" 'version')"
  major="$(node_major "$(json_field "${INSTALLER_PACKAGE}" 'engines.node')")"
  image="${IMAGE_REPOSITORY}:${major}-${IMAGE_VARIANT}@$(image_digest_for "${major}")"
  # The image a run starts from is pinned by a sha256 digest, never by a tag alone: the shape an image reference is
  # held to, whatever IMAGE_PINS says.
  printf '%s' "${image}" | grep -q '^[a-z0-9./-]*:[0-9a-z-]*@sha256:[0-9a-f]\{64\}$' \
    || { echo "the self-test: the image a run starts from is not a reference pinned by digest: ${image}" >&2; case_failed=1; }
  release_version="$(json_field "${RELEASE_PACKAGE}" 'version')"
  # The self-test's own source, held to its contract: no interrupt case signals a run except through
  # signal_the_run_at, so a future case written the old way is named at its line (martha#718).
  check_no_raw_signal_outside_the_helper || case_failed=1

  # The derivation the image step rests on: the major comes from the range, and a major with no pin is refused.
  [ "$(node_major '>=24.18.1')" = 24 ] || { echo 'the self-test: node_major does not read >=24.18.1 as 24' >&2; case_failed=1; }
  [ "$(node_major '>=25.0.0')" = 25 ] || { echo 'the self-test: node_major does not read >=25.0.0 as 25' >&2; case_failed=1; }
  if node_major 'the latest one' > /dev/null; then echo 'the self-test: node_major accepted a range with no number' >&2; case_failed=1; fi
  if image_digest_for 99 > /dev/null; then echo 'the self-test: a major with no pin was not refused' >&2; case_failed=1; fi

  # A screen's escapes come out the same whatever the host's locale (martha#777). Under C the old intermediate range
  # ate the byte after a sequence; under a UTF-8 locale that collates, [@-~] is a collation range and a stripper
  # without LC_ALL=C takes nothing out. The bytes are built here, not copied from the function, so the case holds
  # without_escapes itself. The collating locale is generated for the case, so it is the same on every host: without
  # LC_ALL=C the UTF-8 half fails, and with the old range the C half loses the 'b'.
  local planted drawn locale_dir
  planted="$(printf 'a\033[1Cb\033[?1049hc')"
  drawn="$(unset LC_ALL LC_CTYPE; export LC_ALL=C; printf '%s' "${planted}" | without_escapes)"
  [ "${drawn}" = 'abc' ] || { echo "the self-test: without_escapes under C left an escape in or ate a character after one: '${drawn}'" >&2; case_failed=1; }
  locale_dir="${root}/locale"
  mkdir -p "${locale_dir}"
  if localedef -i en_US -f UTF-8 "${locale_dir}/en_US.UTF-8" 2> /dev/null; then
    drawn="$(unset LC_ALL LC_CTYPE; export LOCPATH="${locale_dir}" LC_ALL=en_US.UTF-8; printf '%s' "${planted}" | without_escapes)"
    [ "${drawn}" = 'abc' ] || { echo "the self-test: without_escapes under en_US.UTF-8 left an escape in or ate a character after one: '${drawn}'" >&2; case_failed=1; }
  else
    echo 'the self-test: localedef could not build en_US.UTF-8, so the UTF-8 half of without_escapes was not shown' >&2
    case_failed=1
  fi
  rm -rf "${locale_dir}"

  # The run's own line that a member ended: the member's real terminal script, run with a `martha` that ends with a
  # status of its own, must print it with that status. The stand-in members print this line themselves, so without
  # this nothing holds member_script to it (#635 review: the deviation from exec).
  local stub ended_line stub_status=3
  stub="$(mktemp -d)"
  printf '#!/bin/sh\nexit %s\n' "${stub_status}" > "${stub}/martha"
  chmod +x "${stub}/martha"
  ended_line="$(PATH="${stub}:${PATH}" sh -c "$(member_script builder)" 2> /dev/null | tail -1)"
  rm -rf "${stub}"
  [ "${ended_line}" = "builder ${ENDED_WORDS} ${stub_status}" ] \
    || { echo "the self-test: a member's terminal script did not say it ended with its status: '${ended_line}'" >&2; case_failed=1; }

  # A whole run: the container, the install, the version, Claude Code at the recorded version, the checkout, the owner's
  # sign-in, and a member that does all it is asked. The marker this run waits for is there before it looks, so giving it
  # an hour costs nothing, and that hour is what its printed clock is then read against.
  standin="${root}/passes"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  passed_window=3600
  was_window="${MARTHA_CLEAN_INSTALL_SIGN_IN_WINDOW_S:-}"
  export MARTHA_CLEAN_INSTALL_SIGN_IN_WINDOW_S="${passed_window}"
  signed_in_at="$(date '+%H:%M')"
  expect_status 0 "${standin}" 'a-host' || case_failed=1
  export MARTHA_CLEAN_INSTALL_SIGN_IN_WINDOW_S="${was_window}"
  [ "$(tail -1 "${standin}/out")" = "${ALL_PROVEN_WORDS}: ${SELF_TEST_MEMBERS[*]}" ] || { echo 'the self-test: a whole run did not end with every member proven' >&2; case_failed=1; }
  asked_for "^ok crew: .*solo crew names ${SELF_TEST_MEMBERS[*]}, " "${standin}/out" || { echo 'the self-test: a whole run logged no crew step' >&2; case_failed=1; }
  for name in "${SELF_TEST_MEMBERS[@]}"; do
    asked_for "^ok member ${name}: " "${standin}/out" || { echo "the self-test: a whole run did not prove ${name}" >&2; case_failed=1; }
    [ "$(grep -cF -- "${ROLE_TURNS[${name}]}" "${standin}/typed")" = 1 ] || { echo "the self-test: ${name}'s turn was not typed exactly once" >&2; case_failed=1; }
  done
  terminals_ended "${standin}" "${SELF_TEST_MEMBERS[@]}" || case_failed=1
  asked_for "claude-code@${SELF_TEST_RELEASE_HOST}" "${standin}/calls" \
    || { echo "the self-test: Claude Code was not installed at the version the installed release's record names" >&2; case_failed=1; }
  ! asked_for "claude-code@$(json_field "${REPO}/${HOST_RECORD_IN_A_TREE}" 'host_version')" "${standin}/calls" \
    || { echo "the self-test: Claude Code was installed at the version this checkout's record names, not the release's" >&2; case_failed=1; }
  asked_for "^ok claude code: .* the version $(json_field "${INSTALLER_PACKAGE}" 'martha.command') ${release_version} is recorded against\$" "${standin}/out" \
    || { echo 'the self-test: the claude code step did not name the release it read the record from' >&2; case_failed=1; }
  asked_for '^  ssh -t .a-host. .*podman.*exec.*-it.*martha approve && claude; touch ' "${standin}/out" \
    || { echo "the self-test: the owner's one command was not printed" >&2; case_failed=1; }
  # The steps an owner follows: a numbered list ending on the marker the run waits for, with the time its window closes.
  the_owners_steps_printed "${standin}/out" || case_failed=1
  # And that time is this run's own window added to now, not now itself, and not a number written into the script.
  the_window_closes_after "${standin}/out" "${signed_in_at}" "${passed_window}" || case_failed=1
  # And the run says the marker landed when it did, so an owner who typed /exit sees that it was taken.
  asked_for '^the marker landed at [0-2][0-9]:[0-5][0-9]: the owner.s session ended, so the sign-in is read now$' "${standin}/out" \
    || { echo 'the self-test: a run whose owner signed in did not say the marker landed' >&2; case_failed=1; }
  [ -e "${standin}/outsider.mark" ] || { echo "the self-test: a proven member's command made no mark" >&2; case_failed=1; }
  asked_for '^ok version: ' "${standin}/out" || { echo 'the self-test: a passing install half logged no version step' >&2; case_failed=1; }
  asked_for '^ok tear down: ' "${standin}/out" || { echo 'the self-test: a passing install half logged no tear-down step' >&2; case_failed=1; }
  asked_for '^rm --force ' "${standin}/calls" || { echo 'the self-test: the container was not removed' >&2; case_failed=1; }
  check_create_line "$(grep '^create ' "${standin}/calls")" "${image}" \
    || { echo "the self-test: the container was not made as asked: $(grep '^create ' "${standin}/calls")" >&2; case_failed=1; }
  # The image by its digest, fetched in its own step, and before the container is made: a create that has a pull to do
  # is the one that outlives its ssh client on a host's first run.
  asked_for "^pull ${image}$" "${standin}/calls" \
    || { echo "the self-test: the image was not pulled by its digest: $(grep '^pull ' "${standin}/calls")" >&2; case_failed=1; }
  pulled_at="$(grep -n '^pull ' "${standin}/calls" | head -1 | cut -d: -f1)"
  created_at="$(grep -n '^create ' "${standin}/calls" | head -1 | cut -d: -f1)"
  if [ -z "${pulled_at}" ] || [ -z "${created_at}" ] || [ "${pulled_at}" -ge "${created_at}" ]; then
    echo 'the self-test: the image was not pulled before the container was made' >&2
    case_failed=1
  fi
  asked_for "--ignore-scripts ${installer_name}@${installer_version}" "${standin}/calls" \
    || { echo 'the self-test: the installer was not named by its exact version' >&2; case_failed=1; }
  # Every script the container's shell runs arrives as one argument: `exec <name> sh -lc <script>` is five, and a run
  # whose quoting let the remote shell split one arrives as more.
  grep '^exec-argc=' "${standin}/calls" | grep -qv '^exec-argc=5$' && { echo 'the self-test: a script reached the container split into more than one word' >&2; case_failed=1; }
  [ "$(grep -c '^exec-argc=5$' "${standin}/calls")" -ge 2 ] || { echo 'the self-test: the scripts the container runs were not counted' >&2; case_failed=1; }

  # The member half, each way it can fall short. A case's flag says what its member does differently, the run must end
  # on the words that name it, and nothing of it is claimed as a proven member.
  member_case 'the-owner-never-signs-in' "home/${OWNER_SESSION_ENDED#"${CONTAINER_HOME}/"}" - 4 '^the owner did not sign in within ' || case_failed=1
  if grep -q '^the marker landed at ' "${root}/the-owner-never-signs-in/out"; then
    echo 'the self-test: a run where the owner never signed in claimed the marker landed' >&2
    case_failed=1
  fi
  if grep -q 'martha start' "${root}/the-owner-never-signs-in/calls"; then echo 'the self-test: a member was started with no sign-in' >&2; case_failed=1; fi
  member_case 'the-owner-ends-without-signing-in' "home/${HOST_CREDENTIALS#"${CONTAINER_HOME}/"}" - 1 '^FAIL sign in: .*the approval or the sign-in did not happen' || case_failed=1
  # The marker landing is said on this path too: the owner's session ended, and it ended without signing in. A line
  # printed only when the sign-in went through would leave an owner who ended early with nothing said of it.
  if ! grep -q '^the marker landed at ' "${root}/the-owner-ends-without-signing-in/out"; then
    echo 'the self-test: a run whose owner ended without signing in did not say the marker landed' >&2
    case_failed=1
  fi
  member_case 'claude-code-at-another-version' claude.version '0.0.1 (Claude Code)' 1 "^FAIL claude code: .*not the recorded " || case_failed=1
  member_case 'the-checkout-cannot-be-made' checkout.fails '' 1 '^FAIL checkout: ' || case_failed=1
  member_case 'the-member-never-starts' member.mute '' 1 "^FAIL member ${first}: ${first} never said '${first} ${STARTED_WORDS}'" || case_failed=1
  kept_the_record 'the-member-never-starts' "${first}" || case_failed=1
  member_case 'the-member-leaves-at-the-folder-question' member.leaves-at-question '' 1 "^FAIL member ${first}: ${first} ended at the folder question\$" || case_failed=1
  kept_the_record 'the-member-leaves-at-the-folder-question' "${first}" || case_failed=1
  member_case 'a-turn-the-host-never-takes' member.deaf '' 1 "^FAIL member ${first}: the owner's turn never reached ${first}'s transcript, typed twice" || case_failed=1
  kept_the_record 'a-turn-the-host-never-takes' "${first}" || case_failed=1
  [ "$(grep -cF -- "${ROLE_TURNS[${first}]}" "${root}/a-turn-the-host-never-takes/typed")" = 2 ] || { echo "the self-test: a turn the host never took was not typed again, once" >&2; case_failed=1; }
  member_case 'only-a-request-blob-holds-it' member.blob-only '' 1 "^FAIL member ${first}: the owner's turn never reached" || case_failed=1
  member_case 'a-member-that-never-answers' member.silent '' 1 "^FAIL member ${first}: the member gave no answer\$" || case_failed=1
  member_case 'a-member-that-reads-nothing' member.unread '' 1 "^FAIL member ${first}: the member did not read the outsider's README\$" || case_failed=1
  kept_the_record 'a-member-that-reads-nothing' "${first}" || case_failed=1
  # The read as the host really writes it, line for line from tonight's live run, is a read; the bare heading the old
  # stand-in wrote is not one, and a check that took it would pass on a shape the host never sends (martha#638).
  member_case 'a-read-as-the-host-writes-it' member.read-as-logged '' 0 "^ok member ${later}: " || case_failed=1
  member_case 'a-read-without-the-numbering' member.read-bare '' 1 "^FAIL member ${first}: the member did not read the outsider's README\$" || case_failed=1
  member_case 'the-transcript-goes-after-the-answer' transcript.goes '' 1 "^FAIL member ${first}: the container could not give the host transcript\$" || case_failed=1
  kept_the_record 'the-transcript-goes-after-the-answer' "${first}" || case_failed=1
  # Once the launch has ended the live folder has gone with it, and the failure capture reads the copy Martha kept
  # (martha#646, issue item 3): a member that ended is still read, never said to be a container that could not give it.
  local kept_root kept_copy kept_nowhere kept_log
  kept_root="${root}/the-kept-copy"
  kept_copy="${kept_root}/state/*/*/transcripts/*/projects/*/*.jsonl"
  kept_nowhere="${kept_root}/no-live-folder/*/*/*/*.jsonl"
  kept_log="${root}/the-kept-copy.log"
  mkdir -p "${kept_root}/state/martha/p/transcripts/launch-1/projects/the-project"
  printf '{%s}\n' "$(turn_line "${first}")" \
    > "${kept_root}/state/martha/p/transcripts/launch-1/projects/the-project/s-1.jsonl"
  : > "${kept_log}"
  # The host's ssh runs the container's own command here, as the container would, so the reader is the real one.
  (
    MEMBERS=("${first}")
    on_the_host() { local last; for last in "$@"; do :; done; sh -c "${last}"; }
    KEPT_TRANSCRIPTS="${kept_copy}" TRANSCRIPTS="${kept_nowhere}" LOG_FILE="${kept_log}" keep_what_the_member_did 0
  )
  if ! grep -qF -- "${KEPT_COPY_WORDS}line $(turn_line "${first}")" "${kept_log}"; then
    echo 'the self-test: a failed step read no copy of an ended launch, so what its member did was said to be gone' >&2
    case_failed=1
  fi
  # A member step that fails keeps what the member did in the log before the tear-down: the transcript as the checks
  # read it and the screen. The credentials hold words of their own here, and none of them may reach the log.
  standin="${root}/a-failed-member-keeps-its-record"
  secret='words-only-the-credentials-hold'
  a_case "${standin}"
  printf '%s\n' "$(json_field "${RELEASE_PACKAGE}" 'version')" > "${standin}/version.words"
  : > "${standin}/member.unread"
  printf '%s\n' "${secret}" > "${standin}/home/${HOST_CREDENTIALS#"${CONTAINER_HOME}/"}"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  if kept_the_record 'a-failed-member-keeps-its-record' "${first}"; then
    sed -n "${KEPT_AT},${SCREEN_AT}p" "${standin}/out" | grep -qF -- "$(turn_line "${first}")" \
      || { echo 'the self-test: a failed member step kept no transcript' >&2; case_failed=1; }
    sed -n "${SCREEN_AT},${TORN_AT}p" "${standin}/out" | grep -qF -- "${first} ${STARTED_WORDS}" \
      || { echo 'the self-test: a failed member step kept no screen' >&2; case_failed=1; }
  else
    case_failed=1
  fi
  if grep -qF -- "${secret}" "${standin}/out" "${standin}/err"; then echo 'the self-test: a failed member step put the credentials in the log' >&2; case_failed=1; fi
  member_case 'a-member-that-asks-no-shell-call' member.no-shell '' 1 "^FAIL member ${first}: the member asked for no shell call of " || case_failed=1
  member_case 'the-command-did-not-run' member.gated '' 1 "^FAIL member ${first}: ${OUTSIDER_MARK} is absent: the command did not run" || case_failed=1
  # The folder question drops what is typed until it is answered: a run that did not answer it would lose its turn.
  member_case 'the-folder-question' member.trust '' 0 "^ok member ${later}: " || case_failed=1
  [ "$(head -1 "${root}/the-folder-question/typed")" = "${DOWN_KEY}" ] || { echo 'the self-test: the folder question was not answered before the turn' >&2; case_failed=1; }

  # The crew (martha#635): every member the release names is started, the later ones while the earlier stay up, and
  # each is proven from its own session file. A later member that falls short fails by its own name once the earlier
  # one is proven, keeps its own record, and nothing of the crew is claimed; every terminal opened is closed.
  # Its members do not end with their key pipes, so only the run's own stop of each terminal ends them: the flag is
  # planted before the case, whose folder a_case keeps.
  mkdir -p "${root}/a-later-member-that-never-answers"
  : > "${root}/a-later-member-that-never-answers/member.outlives-its-pipe"
  member_case 'a-later-member-that-never-answers' "member.silent.${later}" '' 1 "^FAIL member ${later}: the member gave no answer\$" || case_failed=1
  asked_for "^ok member ${first}: " "${root}/a-later-member-that-never-answers/out" \
    || { echo "the self-test: ${first} was not proven before ${later} fell short" >&2; case_failed=1; }
  kept_the_record 'a-later-member-that-never-answers' "${later}" || case_failed=1
  terminals_ended "${root}/a-later-member-that-never-answers" "${first}" "${later}" || case_failed=1
  # The later member is the reviewer, which is not asked to carry out the command: it is proven without a shell call,
  # since its restraint is not what is proven. The case names the member, not the table, so a table that held it to a
  # shell call fails here.
  member_case 'a-later-member-that-asks-no-shell-call' "member.no-shell.${later}" '' 0 "^ok member ${later}: " || case_failed=1
  member_case 'a-later-member-that-never-starts' "member.mute.${later}" '' 1 "^FAIL member ${later}: ${later} never said '${later} ${STARTED_WORDS}'" || case_failed=1
  # A later member's turn and answer planted in the earlier member's session file, beside its own: its turn is in two
  # files, and the earlier member's lines cannot prove it.
  member_case 'a-later-members-lines-in-the-earlier-ones-file' "member.writes-also-into.${later}" "${first}" 1 \
    "^FAIL member ${later}: ${later}'s turn is in 2 session files\$" || case_failed=1
  # Written only into the earlier member's file: one file, and it is the earlier member's.
  member_case 'a-later-member-only-in-the-earlier-ones-file' "member.writes-into.${later}" "${first}" 1 \
    "^FAIL member ${later}: ${later} and ${first} share one session file\$" || case_failed=1
  # An earlier member that ends while a later one runs: its ssh is gone, or its screen says it ended.
  member_case 'an-earlier-member-that-ends' "member.leaves-when-started.${first}" "${later}" 1 \
    "^FAIL member ${first}: ${first} ended while ${later} ran\$" || case_failed=1
  member_case 'an-earlier-member-whose-screen-says-it-ended' "member.says-ended-when-started.${first}" "${later}" 1 \
    "^FAIL member ${first}: ${first} ended while ${later} ran\$" || case_failed=1
  # A release whose crew names a member this run has no turn for fails at the crew step, before the owner is asked for
  # anything and before any terminal is opened; one that no longer names a member this run has a turn for fails there
  # too. The container goes either way.
  member_case 'a-release-naming-a-member-with-no-turn' release.crew "$(printf '%s\n' "${SELF_TEST_MEMBERS[@]}" tester)" 1 \
    "^FAIL crew: the solo crew names 'tester', which this run has no turn for\$" || case_failed=1
  member_case 'a-release-that-drops-a-member' release.crew "${first}" 1 \
    "^FAIL crew: this run has a turn for '${later}', which the solo crew does not name\$" || case_failed=1
  for standin in a-release-naming-a-member-with-no-turn a-release-that-drops-a-member; do
    if grep -q '^  ssh -t ' "${root}/${standin}/out"; then echo "the self-test: ${standin} printed the owner's sign-in" >&2; case_failed=1; fi
    if grep -qx 'ssh -tt' "${root}/${standin}/calls"; then echo "the self-test: ${standin} opened a member's terminal" >&2; case_failed=1; fi
    if grep -q 'martha init' "${root}/${standin}/calls"; then echo "the self-test: ${standin} went on to the checkout" >&2; case_failed=1; fi
  done

  # A run stopped by SIGTERM once both members have started, the later one still on its turn: every terminal it opened
  # is closed and its ssh ended, and the container goes.
  standin="${root}/interrupted-with-both-members-up"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  : > "${standin}/member.deaf.${later}"
  : > "${standin}/member.outlives-its-pipe"
  signal_the_run_at TERM both-members-started "${standin}" || case_failed=1
  asked_for '^FAIL run: interrupted by SIGTERM' "${standin}/out" || { echo 'the self-test: a run stopped with both members up did not say which signal ended it' >&2; case_failed=1; }
  asked_for '^ok tear down: ' "${standin}/out" || { echo 'the self-test: a run stopped with both members up failed its tear-down' >&2; case_failed=1; }
  terminals_ended "${standin}" "${first}" "${later}" || case_failed=1

  # An image the host cannot fetch fails the run at the pull, before a container is named: nothing can be made from an
  # image that is not there, and there is no container to look for.
  standin="${root}/the-image-cannot-be-pulled"
  a_case "${standin}"
  : > "${standin}/pull.fails"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL pull: .*no such image' "${standin}/out" \
    || { echo 'the self-test: an image the host could not fetch did not fail the run at the pull' >&2; case_failed=1; }
  if grep -q '^create ' "${standin}/calls"; then
    echo 'the self-test: a container was made from an image the host could not fetch' >&2
    case_failed=1
  fi

  # A run with no dry layer asked for is the release's run: nothing of the dry run reaches the container.
  ! asked_for "${DRY_ROOT}" "${root}/passes/calls" || { echo 'the self-test: a release run reached the dry harness' >&2; case_failed=1; }

  # The dry run (martha#639): the harness's modules and main's layer reach the container on standard input, the
  # published installer goes in beside them, the harness runs after the install and before the version step, every
  # member is proven, and the run ends on the harness's own result line with a dry pass's exit: never the release's
  # words, never 0.
  local dry_sha dry_layer dry_result installed_at dry_at version_at the_command
  dry_sha="$(git -C "${REPO}" rev-parse HEAD)"
  dry_layer="${root}/a-dry-layer.tar.gz"
  printf 'bytes only this case holds\n' > "${dry_layer}"
  the_command="$(json_field "${INSTALLER_PACKAGE}" 'martha.command')"
  standin="${root}/dry-passes"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  dry_result="dry: the stand-in harness's own last line, for ${dry_sha}"
  printf 'dry: a line the stand-in harness says first\n%s\n' "${dry_result}" > "${standin}/dry.words"
  # A warning on stderr after the result line, as node or the installer's code may write one: never the result line.
  printf '(node:1) Warning: a line the stand-in writes on stderr, after its result\n' > "${standin}/dry.errors"
  printf '0\n' > "${standin}/dry.status"
  expect_status "${DRY_PASSED}" "${standin}" 'a-host' --dry-layer "${dry_layer}" "${dry_sha}" || case_failed=1
  [ "$(tail -1 "${standin}/out")" = "${dry_result}" ] || { echo "the self-test: a dry pass did not end on the harness's own result line" >&2; case_failed=1; }
  grep -qF -- '(node:1) Warning: a line the stand-in writes on stderr' "${standin}/out" || { echo "the self-test: the harness's stderr did not reach the log" >&2; case_failed=1; }
  if grep -qF -- "${ALL_PROVEN_WORDS}" "${standin}/out"; then echo "the self-test: a dry pass said the release's words" >&2; case_failed=1; fi
  for name in "${SELF_TEST_MEMBERS[@]}"; do
    asked_for "^ok member ${name}: " "${standin}/out" || { echo "the self-test: a dry pass did not prove ${name}" >&2; case_failed=1; }
  done
  asked_for "^ok dry: main at ${dry_sha} placed " "${standin}/out" || { echo 'the self-test: a dry pass logged no dry step' >&2; case_failed=1; }
  cmp -s "${dry_layer}" "${standin}/dry.layer" || { echo 'the self-test: the layer did not reach the container byte for byte' >&2; case_failed=1; }
  [ "$(cat "${standin}/dry.modules" 2> /dev/null)" = "$(dry_harness_modules)" ] \
    || { echo "the self-test: the container was not given the harness's modules, and only those" >&2; case_failed=1; }
  if grep -qF -- "${DRY_TEST_SUFFIX}" "${standin}/dry.modules" 2> /dev/null; then echo "the self-test: the harness's tests went into the container" >&2; case_failed=1; fi
  grep -qxF -- "${DRY_HARNESS}/${DRY_ENTRY}" "${standin}/dry.modules" 2> /dev/null || { echo "the self-test: the harness's ${DRY_ENTRY} did not go in" >&2; case_failed=1; }
  asked_for "npm install --prefix ${DRY_PUBLISHED} .*${installer_name}@${installer_version} && ln -s ${DRY_PUBLISHED}/node_modules/${installer_name} ${DRY_ROOT}/installer" "${standin}/calls" \
    || { echo 'the self-test: the published installer was not put beside the harness by its exact version' >&2; case_failed=1; }
  asked_for "node ${DRY_ROOT}/${DRY_HARNESS}/${DRY_ENTRY} ${DRY_LAYER} ${release_version} ${dry_sha}" "${standin}/calls" \
    || { echo "the self-test: the harness was not run on the layer, this tree's version and the sha" >&2; case_failed=1; }
  installed_at="$(grep -n -m1 -e 'npx' "${standin}/calls" | cut -d: -f1)"
  dry_at="$(grep -n -m1 -e "node ${DRY_ROOT}/" "${standin}/calls" | cut -d: -f1)"
  version_at="$(grep -n -m1 -e " ${the_command} --version" "${standin}/calls" | cut -d: -f1)"
  [ -n "${installed_at}" ] && [ -n "${dry_at}" ] && [ -n "${version_at}" ] && [ "${installed_at}" -lt "${dry_at}" ] && [ "${dry_at}" -lt "${version_at}" ] \
    || { echo "the self-test: the harness did not run after the install and before the version step (${installed_at:-none}, ${dry_at:-none}, ${version_at:-none})" >&2; case_failed=1; }
  asked_for '^ok tear down: ' "${standin}/out" || { echo 'the self-test: a dry pass left its container' >&2; case_failed=1; }

  # A harness that refuses the layer fails the run in its own words, before any member, and the container still goes.
  standin="${root}/dry-refused"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  # The harness says a refusal on stderr (main.mjs: console.error), and those are the words the run fails in.
  : > "${standin}/dry.words"
  printf 'dry: not placed: the stand-in harness refuses this layer\n' > "${standin}/dry.errors"
  printf '1\n' > "${standin}/dry.status"
  expect_status 1 "${standin}" 'a-host' --dry-layer "${dry_layer}" "${dry_sha}" || case_failed=1
  asked_for "^FAIL dry: main's layer was not placed, the harness ended 1: dry: not placed: the stand-in harness refuses this layer\$" "${standin}/out" \
    || { echo "the self-test: a refused layer did not fail the run in the harness's own words" >&2; case_failed=1; }
  ! asked_for '^ok member ' "${standin}/out" || { echo 'the self-test: a refused layer still proved a member' >&2; case_failed=1; }
  ! asked_for " ${the_command} --version" "${standin}/calls" || { echo 'the self-test: a refused layer still reached the version step' >&2; case_failed=1; }
  asked_for '^rm --force ' "${standin}/calls" || { echo 'the self-test: a refused layer did not remove its container' >&2; case_failed=1; }

  # No release: the installer's own words are the run's outcome, and the container still goes.
  standin="${root}/no-release"
  a_case "${standin}"
  printf 'npm notice a newer npm is available\nmartha-install: ghcr.io/macula-io/martha carries no version; refused\nnpm notice To update run: npm install -g npm@x\n' > "${standin}/install.words"
  printf '1\n' > "${standin}/install.status"
  expect_status 3 "${standin}" 'a-host' || case_failed=1
  [ "$(tail -1 "${standin}/out")" = 'no release to install' ] || { echo 'the self-test: a run with no release did not say so last' >&2; case_failed=1; }
  asked_for '^ok install: .*carries no version; refused$' "${standin}/out" || { echo "the self-test: the no-release step did not end on the installer's own line" >&2; case_failed=1; }
  if grep -q 'npm notice' "${standin}/out"; then echo 'the self-test: the no-release step carried the npm noise it is not supposed to' >&2; case_failed=1; fi
  asked_for '^ok tear down: ' "${standin}/out" || { echo 'the self-test: a run with no release left its container' >&2; case_failed=1; }
  asked_for '^rm --force ' "${standin}/calls" || { echo 'the self-test: a run with no release did not remove its container' >&2; case_failed=1; }

  # A refusal that is not the no-release one fails the run, and the container still goes.
  standin="${root}/refused"
  a_case "${standin}"
  printf 'martha-install: the registry answered 500; refused\n' > "${standin}/install.words"
  printf '1\n' > "${standin}/install.status"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL install: ' "${standin}/out" || { echo 'the self-test: a refusal that is not the no-release one did not fail the run' >&2; case_failed=1; }
  asked_for '^rm --force ' "${standin}/calls" || { echo 'the self-test: a failed install did not remove its container' >&2; case_failed=1; }

  # An installed command that says another version fails the run: the clean install is this tree's release or nothing.
  standin="${root}/other-version"
  a_case "${standin}"
  printf '9.9.9\n' > "${standin}/version.words"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL version: .*not the ' "${standin}/out" || { echo 'the self-test: a version other than this tree declares did not fail the run' >&2; case_failed=1; }

  # An installed release with no host record of its own fails the run at Claude Code: nothing else names the version
  # to install, and this checkout's record is never a stand-in for it (martha#636).
  standin="${root}/release-records-no-host"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  rm "${standin}/release.record"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for "^FAIL claude code: .*carries no ${HOST_RECORD_IN_A_TREE}" "${standin}/out" \
    || { echo 'the self-test: an installed release with no host record did not fail the claude code step' >&2; case_failed=1; }
  ! asked_for 'claude-code@' "${standin}/calls" \
    || { echo 'the self-test: Claude Code was installed although the release records no host' >&2; case_failed=1; }

  # A container that is not what was asked for fails the run before anything is installed in it: root inside,
  # something mounted into it, the host's own network, or environment that is not the image's. All four are what the
  # flags asked for; only the container's own answer decides.
  standin="${root}/runs-as-root"
  a_case "${standin}"
  printf '0\n' > "${standin}/uid"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL inside: .*runs as root' "${standin}/out" || { echo 'the self-test: a container running as root did not fail the run' >&2; case_failed=1; }
  standin="${root}/mounted"
  a_case "${standin}"
  printf '2\n' > "${standin}/mounts"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL inside: .*2 mounts' "${standin}/out" || { echo 'the self-test: a container with something mounted did not fail the run' >&2; case_failed=1; }
  standin="${root}/on-the-host-network"
  a_case "${standin}"
  printf '%s\n' "${HOST_NETWORK}" > "${standin}/network"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL inside: .*own network' "${standin}/out" || { echo "the self-test: a container on the host's own network did not fail the run" >&2; case_failed=1; }
  standin="${root}/given-the-hosts-environment"
  a_case "${standin}"
  printf '%s\nPATH=/usr/local/bin:/usr/bin\nFROM_THE_HOST=1\n' "${PODMAN_OWN_ENV[@]}" > "${standin}/env"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL inside: .*not the image.s: FROM_THE_HOST=1' "${standin}/out" || { echo "the self-test: environment the image does not carry did not fail the run, and name it" >&2; case_failed=1; }

  # A container that is still there after the removal fails the run, and is named.
  standin="${root}/sticks"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  printf '1\n' > "${standin}/rm.refused"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL tear down: .*cannot be confirmed gone: podman answered .present.' "${standin}/out" || { echo 'the self-test: a container that would not go did not fail the run' >&2; case_failed=1; }
  [ "$(tail -1 "${standin}/out")" = failed ] || { echo 'the self-test: a run whose container stayed did not end failed' >&2; case_failed=1; }

  # A host that stops answering is not a container that is gone: no answer is not gone, and the run fails naming the
  # container rather than reporting a clean end. podman's own error is no answer either.
  standin="${root}/the-host-stopped-answering"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  : > "${standin}/ssh.down"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL tear down: martha-clean-install-.* cannot be confirmed gone' "${standin}/out" || { echo 'the self-test: a host that stopped answering did not fail the tear-down, naming the container' >&2; case_failed=1; }
  [ "$(tail -1 "${standin}/out")" = failed ] || { echo 'the self-test: a run whose host stopped answering did not end failed' >&2; case_failed=1; }
  standin="${root}/podman-errors"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  : > "${standin}/container.refuses"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL tear down: .*no answer (125)' "${standin}/out" || { echo "the self-test: podman's own error was read as a gone container" >&2; case_failed=1; }

  # An interrupted run: the install parks until the signal arrives, and the container is removed anyway.
  standin="${root}/interrupted"
  a_case "${standin}"
  : > "${standin}/install.holds"
  signal_the_run_at INT '^exec ' "${standin}" || case_failed=1
  asked_for '^FAIL run: interrupted by SIGINT' "${standin}/out" || { echo 'the self-test: an interrupted run did not say which signal ended it' >&2; case_failed=1; }
  asked_for '^rm --force ' "${standin}/calls" || { echo 'the self-test: an interrupted run did not remove its container' >&2; case_failed=1; }

  # An interrupt while create is still going: on a host's first run that window is the image pull, and the container
  # the create goes on to make is still this run's to remove. Its name is what the tear-down knows it by, and the
  # tear-down keeps asking for a moment, because the create finishes after its ssh client is gone.
  standin="${root}/interrupted-while-creating"
  a_case "${standin}"
  : > "${standin}/create.holds"
  signal_the_run_at INT '^create ' "${standin}" || case_failed=1
  asked_for '^FAIL run: interrupted by SIGINT' "${standin}/out" || { echo 'the self-test: an interrupt during create did not say which signal ended it' >&2; case_failed=1; }
  asked_for '^ok tear down: ' "${standin}/out" || { echo 'the self-test: an interrupt during create failed its tear-down' >&2; case_failed=1; }
  asked_for '^rm --force ' "${standin}/calls" || { echo 'the self-test: the container a create made after the signal was not removed' >&2; case_failed=1; }

  # A create that outlives the window: interrupted while create is still running, and the window spent watching for its
  # container ends with nothing there. Not seen is not never made -- a create whose ssh client is gone can still finish
  # on the host -- so the tear-down fails and names the container, and never reports one it cannot vouch for as "never
  # made".
  standin="${root}/a-create-that-outlives-the-window"
  a_case "${standin}"
  : > "${standin}/create.stuck"
  signal_the_run_at INT '^create ' "${standin}" || case_failed=1
  asked_for '^FAIL tear down: martha-clean-install-[^ ]* was not seen within the window' "${standin}/out" \
    || { echo 'the self-test: a create still running when the window ended did not fail the tear-down, naming the container' >&2; case_failed=1; }
  if grep -q '^ok tear down: ' "${standin}/out"; then
    echo 'the self-test: a create still running when the window ended was reported as a container never made' >&2
    case_failed=1
  fi

  # A step the run never reaches: the helper must fail by name and send no signal, so a blind fallback that
  # signals anyway is caught here, and the run is cleaned up (martha#718).
  standin="${root}/a-step-the-run-never-reaches"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  if signal_the_run_at INT '^no-such-step ' "${standin}" 20 2> "${standin}/helper.err"; then
    echo 'the self-test: a step the run never reaches did not fail the helper' >&2
    case_failed=1
  fi
  asked_for 'the run never reached ' "${standin}/helper.err" \
    || { echo 'the self-test: a step the run never reaches was not failed by name' >&2; case_failed=1; }
  if asked_for '^FAIL run: interrupted by ' "${standin}/out"; then
    echo 'the self-test: a step the run never reaches still sent a signal' >&2
    case_failed=1
  fi
  # The helper stops a run it could not reach the step in, and a stopped run makes no tear-down, so the
  # case takes its stand-in container away itself, there being none to remove it (martha#718).
  rm -f "${standin}/container.present"

  # A run started with SIGINT ignored cannot trap it: it fails by name before its first step, rather than run steps
  # whose interrupt would be dropped. The subshell ignores INT and the run inherits that through exec, as a background
  # job's child does; env here resets nothing (martha#718).
  standin="${root}/started-with-sigint-ignored"
  a_case "${standin}"
  waited=0
  (trap '' INT; exec env PATH="${STAND_INS}:${PATH}" MARTHA_CLEAN_INSTALL_STAND_IN="${standin}" "${SELF}" 'a-host' \
    > "${standin}/out" 2> "${standin}/err") || waited=$?
  [ "${waited}" -eq 1 ] || { echo "the self-test: a run started with SIGINT ignored exited ${waited}, not 1" >&2; case_failed=1; }
  asked_for ': SIGINT ignored on entry; ' "${standin}/err" \
    || { echo 'the self-test: a run started with SIGINT ignored did not say so' >&2; case_failed=1; }
  if [ -s "${standin}/calls" ]; then echo 'the self-test: a run started with SIGINT ignored still ran a step' >&2; case_failed=1; fi

  # A create podman refused: podman answered, so the create is settled and made nothing. The tear-down has nothing to
  # watch for and says the container was never made -- the words an operator needs -- rather than spending the window on
  # a container that will not appear and then reporting it as still in flight.
  standin="${root}/a-create-podman-refused"
  a_case "${standin}"
  : > "${standin}/create.refuses"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL container: podman could not make ' "${standin}/out" \
    || { echo 'the self-test: a create podman refused did not fail the run at the container step' >&2; case_failed=1; }
  asked_for '^ok tear down: martha-clean-install-[^ ]* was never made: podman answers absent$' "${standin}/out" \
    || { echo 'the self-test: a create podman refused was not reported as a container never made' >&2; case_failed=1; }
  if grep -q 'still in flight' "${standin}/out"; then
    echo 'the self-test: a create podman refused was reported as still in flight' >&2
    case_failed=1
  fi
  # The window was not spent: a settled create is asked about once, and a create still in flight twenty-one times.
  [ "$(grep -c '^container exists' "${standin}/calls")" = 1 ] \
    || { echo 'the self-test: the tear-down waited out the window for a create podman had already refused' >&2; case_failed=1; }

  # A create ssh itself could not carry is the case the window is for: 255 says nothing about the create, the host can
  # still make the container after its ssh client is gone, so the tear-down watches, and fails saying it is in flight.
  standin="${root}/a-create-ssh-could-not-carry"
  a_case "${standin}"
  : > "${standin}/create.unreachable"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL container: podman could not make ' "${standin}/out" \
    || { echo "the self-test: a create ssh could not carry did not fail the run at the container step" >&2; case_failed=1; }
  asked_for '^FAIL tear down: martha-clean-install-[^ ]* was not seen within the window and its create is still in flight' "${standin}/out" \
    || { echo "the self-test: a create ssh could not carry was not reported as still in flight" >&2; case_failed=1; }
  if grep -q '^ok tear down: ' "${standin}/out"; then
    echo 'the self-test: a create ssh could not carry was reported as a container never made' >&2
    case_failed=1
  fi
  [ "$(grep -c '^container exists' "${standin}/calls")" -gt 1 ] \
    || { echo 'the self-test: the tear-down did not watch for a create ssh could not carry' >&2; case_failed=1; }

  # A create whose ssh client was stopped by a signal (137, SIGKILL) is no answer either: the command it started runs
  # on, and the container it makes afterwards is still this run's to remove. Read as settled, the run would report a
  # clean end while a container it made leaks.
  standin="${root}/a-create-ssh-killed"
  a_case "${standin}"
  : > "${standin}/create.killed"
  expect_status 1 "${standin}" 'a-host' || case_failed=1
  asked_for '^FAIL container: podman could not make ' "${standin}/out" \
    || { echo 'the self-test: a create whose ssh was killed did not fail the run at the container step' >&2; case_failed=1; }
  asked_for '^FAIL tear down: martha-clean-install-[^ ]* was not seen within the window and its create is still in flight' "${standin}/out" \
    || { echo 'the self-test: a create whose ssh was killed was not reported as still in flight' >&2; case_failed=1; }
  if grep -q '^ok tear down: ' "${standin}/out"; then
    echo 'the self-test: a create whose ssh was killed was reported as a container never made' >&2
    case_failed=1
  fi
  [ "$(grep -c '^container exists' "${standin}/calls")" -gt 1 ] \
    || { echo 'the self-test: the tear-down did not watch for a create whose ssh was killed' >&2; case_failed=1; }

  # The end of a run holds to its claim: steps that end without the member step, every one of them passing, claim no
  # member and fail. The script is read in, its steps taken away, and its own end run.
  waited=0
  bash -c '. "$1"; run_the_steps() { :; }; trap finish EXIT; run_the_steps' _ "${SELF}" \
    > "${root}/no-member-step.out" 2>&1 || waited=$?
  [ "${waited}" -eq 1 ] || { echo "the self-test: a run with no member step exited ${waited}, not 1" >&2; case_failed=1; }
  asked_for '^FAIL run: the steps ended and no member was proven$' "${root}/no-member-step.out" \
    || { echo 'the self-test: a run with no member step did not say no member was proven' >&2; case_failed=1; }
  if grep -q "^${ALL_PROVEN_WORDS}" "${root}/no-member-step.out"; then echo 'the self-test: a run with no member step claimed a member' >&2; case_failed=1; fi

  # The arguments: no host, an unknown option, two hosts and a log it cannot write are refused, and nothing runs.
  expect_status 2 "${root}" || case_failed=1
  expect_status 2 "${root}" --no-such-option || case_failed=1
  expect_status 2 "${root}" 'a-host' 'another-host' || case_failed=1
  expect_status 2 "${root}" --host 'a-host' --log "${root}/no-such-folder/a.log" || case_failed=1
  # A dry layer that is not there, or a sha that is not a full one, is refused with the arguments (martha#639).
  expect_status 2 "${root}" 'a-host' --dry-layer "${root}/no-such-layer.tar.gz" "${dry_sha}" || case_failed=1
  expect_status 2 "${root}" 'a-host' --dry-layer "${dry_layer}" "${dry_sha:0:12}" || case_failed=1
  expect_status 2 "${root}" 'a-host' --dry-layer "${dry_layer}" || case_failed=1
  no_such_file "${root}/calls" || { echo 'the self-test: a refused run still reached podman' >&2; case_failed=1; }

  # Every run that was not one that could not confirm its container gone, or whose host stopped answering, ended with
  # nothing of it left: what this file says last is what these cases check.
  for standin in passes no-release refused other-version runs-as-root mounted on-the-host-network \
    given-the-hosts-environment interrupted interrupted-while-creating a-create-that-outlives-the-window \
    a-create-podman-refused a-create-ssh-could-not-carry a-create-ssh-killed the-image-cannot-be-pulled \
    the-owner-never-signs-in the-owner-ends-without-signing-in claude-code-at-another-version the-checkout-cannot-be-made \
    the-member-never-starts a-turn-the-host-never-takes only-a-request-blob-holds-it a-member-that-asks-no-shell-call \
    the-command-did-not-run the-folder-question a-member-that-never-answers a-member-that-reads-nothing \
    a-failed-member-keeps-its-record the-member-leaves-at-the-folder-question the-transcript-goes-after-the-answer \
    a-later-member-that-never-answers a-later-member-that-never-starts a-later-members-lines-in-the-earlier-ones-file \
    a-later-member-only-in-the-earlier-ones-file an-earlier-member-that-ends an-earlier-member-whose-screen-says-it-ended \
    a-release-naming-a-member-with-no-turn a-release-that-drops-a-member interrupted-with-both-members-up \
    a-later-member-that-asks-no-shell-call a-step-the-run-never-reaches dry-passes dry-refused; do
    if [ -e "${root}/${standin}/container.present" ]; then
      echo "the self-test: the ${standin} run left its container behind" >&2
      case_failed=1
    fi
  done

  # The nightly live run's container side (martha#639): its own stand-ins and cases.
  night_self_test "${root}" || case_failed=1

  if [ "${case_failed}" -ne 0 ]; then
    echo 'the self-test: a case failed, above' >&2
    return 1
  fi
  echo 'the self-test: every case held, and no container was left behind'
}

main() {
  local host=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --self-test)
        trap 'if [ -n "${SELF_TEST_ROOT}" ]; then rm -rf "${SELF_TEST_ROOT}"; fi' EXIT
        self_test
        return $?
        ;;
      --log)
        if [ -z "${2:-}" ]; then printf '%s\n' "${USAGE}" >&2; exit 2; fi
        LOG_FILE="$2"
        shift 2
        ;;
      --owner-commands)
        # A new file, made empty here so the follow script sees it from the start; one that is there is refused.
        if [ -z "${2:-}" ]; then printf '%s\n' "${USAGE}" >&2; exit 2; fi
        if ! (set -C; : > "$2") 2> /dev/null; then
          printf 'prove_a_clean_install_in_a_throwaway_container: --owner-commands takes a file that is not there yet (%s)\n' "$2" >&2
          exit 2
        fi
        OWNER_COMMANDS_FILE="$2"
        shift 2
        ;;
      --night)
        # A run folder is one night's: the throwaway script makes it, and refuses one that is there already.
        if [ -z "${2:-}" ]; then printf '%s\n' "${USAGE}" >&2; exit 2; fi
        NIGHT_DIR="$2"
        shift 2
        ;;
      --dry-layer)
        # The layer must be a file this run can read, and the sha the full one it was packed from: the harness is
        # handed both, and refuses a short sha only after the container is made.
        if [ ! -f "${2:-}" ] || [ ! -r "${2:-}" ] || ! [[ "${3:-}" =~ ^[0-9a-f]{40}$ ]]; then
          printf 'prove_a_clean_install_in_a_throwaway_container: --dry-layer takes a readable layer file and the 40-character sha it was packed from (%s)\n' "${USAGE}" >&2
          exit 2
        fi
        DRY_LAYER_FILE="$2"
        DRY_SHA="$3"
        shift 3
        ;;
      --dry-installer)
        # Main's own installer, packed from main, and the sha256 it was packed at: the run installs that tarball and
        # says so, so it is only taken with a layer to place (martha#695, option A).
        if [ -z "${DRY_LAYER_FILE}" ] || [ ! -f "${2:-}" ] || [ ! -r "${2:-}" ] || ! [[ "${3:-}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
          printf 'prove_a_clean_install_in_a_throwaway_container: --dry-installer takes a readable tarball and its sha256: digest, after --dry-layer (%s)\n' "${USAGE}" >&2
          exit 2
        fi
        DRY_INSTALLER_FILE="$2"
        DRY_INSTALLER_DIGEST="$3"
        shift 3
        ;;
      -*)
        printf 'prove_a_clean_install_in_a_throwaway_container: unknown option %s (%s)\n' "$1" "${USAGE}" >&2
        exit 2
        ;;
      *)
        if [ -n "${host}" ]; then printf 'prove_a_clean_install_in_a_throwaway_container: one host at a time (%s)\n' "${USAGE}" >&2; exit 2; fi
        host="$1"
        shift
        ;;
    esac
  done
  if [ -z "${host}" ]; then printf 'prove_a_clean_install_in_a_throwaway_container: %s\n' "${USAGE}" >&2; exit 2; fi
  HOST="${host}"
  # Tested before anything runs, so a log that cannot be written is refused with the arguments.
  if [ -n "${LOG_FILE}" ]; then
    if ! : > "${LOG_FILE}" 2> /dev/null; then
      printf 'prove_a_clean_install_in_a_throwaway_container: cannot write the log %s\n' "${LOG_FILE}" >&2
      exit 2
    fi
  fi
  INSTALLER_NAME="$(json_field "${INSTALLER_PACKAGE}" 'name')" \
    || { printf 'prove_a_clean_install_in_a_throwaway_container: installer/package.json names no package\n' >&2; exit 2; }
  INSTALLER_VERSION="$(json_field "${INSTALLER_PACKAGE}" 'version')" \
    || { printf 'prove_a_clean_install_in_a_throwaway_container: installer/package.json declares no version\n' >&2; exit 2; }
  COMMAND="$(json_field "${INSTALLER_PACKAGE}" 'martha.command')" \
    || { printf 'prove_a_clean_install_in_a_throwaway_container: installer/package.json names no command\n' >&2; exit 2; }
  RELEASE_VERSION="$(json_field "${RELEASE_PACKAGE}" 'version')" \
    || { printf 'prove_a_clean_install_in_a_throwaway_container: package.json declares no version\n' >&2; exit 2; }
  trap finish EXIT
  trap 'interrupt SIGINT' INT
  trap 'interrupt SIGTERM' TERM
  # The run's INT trap must have installed: a run started with SIGINT ignored (a background job's child) cannot
  # trap it, and `trap -p INT` then reads an empty handler. Fail by name rather than run steps whose interrupt
  # would be silently dropped (martha#718).
  if ! trap -p INT | grep -qF -- "'interrupt SIGINT'"; then
    printf 'prove_a_clean_install_in_a_throwaway_container: SIGINT ignored on entry; start it through env --default-signal=INT,TERM\n' >&2
    exit 1
  fi
  run_the_steps
}

# Run when it is run, and only read when the self-test reads it in to hold the end of a run to its claim.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi

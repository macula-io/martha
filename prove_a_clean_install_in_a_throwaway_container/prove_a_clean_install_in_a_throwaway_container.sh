#!/usr/bin/env bash
# prove_a_clean_install_in_a_throwaway_container.sh <ssh-host> [--log <file>]
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
# Today the registry carries no release, so a run reaches the installer and stops on its own words ("carries no
# version"). That is the expected end, exit 3, and nothing was installed: it is never a passed install.
#
# The member half -- Claude Code signed in inside the container, a member that answers, an ungated outsider's text
# refused (martha#2) -- needs the owner at the terminal. This script claims none of it: when the install half passes,
# the run stops at the member step, says so, and removes the container (exit 4). No member is claimed.
#
# The image is fetched by its digest in a step of its own, before the container is named, so the create that follows has
# nothing left to fetch and is over in moments, not minutes.
#
# The container is removed whatever happens: a pass, a refusal, a failed step, or a signal -- including one while the
# create that made it is still running. Gone is read from podman answering that it is gone, never from a silence: a host
# that stopped answering, or podman erroring, fails the run and names the container so it can be removed by hand. So
# does a create still in flight when the window spent watching for its container is over: a create outlives its ssh
# client, so "not there yet" is not "never made". A create podman answered is settled, refused or made, and there is
# nothing left to watch for: a refused one is reported as a container never made. Everything written in it goes with
# it; the image the first run pulls stays in the host's own store, which belongs to the host and not to a run.
#
# Exit: 1 a step failed, the tear-down did, or the run was interrupted; 2 the arguments were refused and nothing ran;
# 3 the registry carries no release, so the installer stopped on its own words (today's expected end); 4 the install
# half passed and the run stopped at the member half, which waits for the owner's sign-in.
set -euo pipefail

# The run's own output, on a descriptor of its own: a signal that arrives while a command's output is being thrown away
# (podman's own chatter) runs the tear-down with that command's redirection still in place, and the tear-down has to
# reach the terminal or the log even then.
exec 3>&1

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
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
# What keeps the container up while the steps are run in it, and what every one of its names starts with.
CONTAINER_IDLES='sleep 3600'
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
# reported as one that made nothing: the tear-down fails and names the container. Only ssh's own 255 leaves a create in
# flight; a status podman gave is an answer, and a create podman answered is settled.
CREATE_SETTLE_ATTEMPTS=20
CREATE_SETTLE_S=0.5
# What the installer says when the registry carries no release: read_the_release_registry.mjs, highestVersion.
NO_RELEASE_WORDS='carries no version'

USAGE='usage: prove_a_clean_install_in_a_throwaway_container.sh <ssh-host> [--log <file>] | --self-test'

LOG_FILE=''
CONTAINER=''
CREATE_WAS_IN_FLIGHT=''
NO_RELEASE_YET=''
INTERRUPTED=''
SELF_TEST_ROOT=''

log() {
  printf '%s\n' "$*" >&3
  if [ -n "${LOG_FILE}" ]; then printf '%s\n' "$*" >> "${LOG_FILE}"; fi
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
  on_the_host podman create --name "${CONTAINER}" --user "${CONTAINER_USER}" "${IMAGE}" ${CONTAINER_IDLES} > /dev/null \
    || status=$?
  if [ "${status}" -ne 0 ]; then
    # ssh's own 255 is the one status that says nothing about the create: the command never reached a shell on the host,
    # which may still be working on it, and the flag stays set for the tear-down's window. Every other status is podman
    # answering, so the create is settled -- it made nothing, now or later -- and there is nothing to watch for.
    if [ "${status}" -ne 255 ]; then CREATE_WAS_IN_FLIGHT=''; fi
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
  image_step || return 1
  pull_step || return 1
  container_step || return 1
  inside_step || return 1
  install_step || return 1
  if [ -n "${NO_RELEASE_YET}" ]; then return 0; fi
  version_step || return 1
}

# Whatever happened: the container goes first, then the run says how it ended, and exits with that.
finish() {
  local status=$?
  trap - EXIT INT TERM
  if [ -n "${CONTAINER}" ]; then
    if ! tear_down_step; then status=1; fi
  fi
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
  log "the member half waits for the owner's sign-in"
  exit 4
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
while [ $# -gt 0 ]; do
  case "$1" in
    -*) shift ;;
    *) shift; break ;;
  esac
done
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
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
    # What a remote shell hands podman: the count is how the self-test holds the quoting to one word per argument.
    printf 'exec-argc=%s\n' "$#" >> "${standin}/calls"
    case "$*" in
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
  chmod +x "${dir}/ssh" "${dir}/podman"
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
}

# A run against a case's stand-ins, its standard output, standard error and exit status kept in the case's folder.
run_a_case() {
  local standin="$1"
  shift
  PATH="${STAND_INS}:${PATH}" MARTHA_CLEAN_INSTALL_STAND_IN="${standin}" "${SELF}" "$@" \
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

self_test() {
  local standin case_failed=0 child waited installer_name installer_version release_version major image
  local pulled_at created_at
  SELF_TEST_ROOT="$(mktemp -d)"
  STAND_INS="${SELF_TEST_ROOT}/bin"
  SELF="$(readlink -f "$0")"
  mkdir -p "${STAND_INS}"
  write_stand_ins "${STAND_INS}"
  local root="${SELF_TEST_ROOT}"
  installer_name="$(json_field "${INSTALLER_PACKAGE}" 'name')"
  installer_version="$(json_field "${INSTALLER_PACKAGE}" 'version')"
  major="$(node_major "$(json_field "${INSTALLER_PACKAGE}" 'engines.node')")"
  image="${IMAGE_REPOSITORY}:${major}-${IMAGE_VARIANT}@$(image_digest_for "${major}")"
  # The image a run starts from is pinned by a sha256 digest, never by a tag alone: the shape an image reference is
  # held to, whatever IMAGE_PINS says.
  printf '%s' "${image}" | grep -q '^[a-z0-9./-]*:[0-9a-z-]*@sha256:[0-9a-f]\{64\}$' \
    || { echo "the self-test: the image a run starts from is not a reference pinned by digest: ${image}" >&2; case_failed=1; }
  release_version="$(json_field "${RELEASE_PACKAGE}" 'version')"

  # The derivation the image step rests on: the major comes from the range, and a major with no pin is refused.
  [ "$(node_major '>=24.18.1')" = 24 ] || { echo 'the self-test: node_major does not read >=24.18.1 as 24' >&2; case_failed=1; }
  [ "$(node_major '>=25.0.0')" = 25 ] || { echo 'the self-test: node_major does not read >=25.0.0 as 25' >&2; case_failed=1; }
  if node_major 'the latest one' > /dev/null; then echo 'the self-test: node_major accepted a range with no number' >&2; case_failed=1; fi
  if image_digest_for 99 > /dev/null; then echo 'the self-test: a major with no pin was not refused' >&2; case_failed=1; fi

  # A passing install half: the container, the install, the version, and the stop at the member step.
  standin="${root}/passes"
  a_case "${standin}"
  printf '%s\n' "${release_version}" > "${standin}/version.words"
  expect_status 4 "${standin}" 'a-host' || case_failed=1
  [ "$(tail -1 "${standin}/out")" = "the member half waits for the owner's sign-in" ] || { echo 'the self-test: a passing install half did not stop at the member step' >&2; case_failed=1; }
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
  # Both scripts the container runs arrive as one argument each: `exec <name> sh -lc <script>` is five, and a run
  # whose quoting let the remote shell split one arrives as more.
  [ "$(grep -c '^exec-argc=5$' "${standin}/calls")" = 2 ] || { echo 'the self-test: a script reached the container split into more than one word' >&2; case_failed=1; }

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
  set -m
  PATH="${STAND_INS}:${PATH}" MARTHA_CLEAN_INSTALL_STAND_IN="${standin}" "${SELF}" 'a-host' \
    > "${standin}/out" 2> "${standin}/err" &
  child=$!
  set +m
  waited=0
  while ! grep -q '^exec ' "${standin}/calls" 2> /dev/null; do
    sleep 0.2
    waited=$((waited + 1))
    if [ "${waited}" -gt 250 ]; then break; fi
  done
  kill -INT -"${child}" 2> /dev/null || true
  waited=0
  wait "${child}" || waited=$?
  [ "${waited}" -eq 1 ] || { echo "the self-test: an interrupted run exited ${waited}, not 1" >&2; case_failed=1; }
  asked_for '^FAIL run: interrupted by SIGINT' "${standin}/out" || { echo 'the self-test: an interrupted run did not say which signal ended it' >&2; case_failed=1; }
  asked_for '^rm --force ' "${standin}/calls" || { echo 'the self-test: an interrupted run did not remove its container' >&2; case_failed=1; }

  # An interrupt while create is still going: on a host's first run that window is the image pull, and the container
  # the create goes on to make is still this run's to remove. Its name is what the tear-down knows it by, and the
  # tear-down keeps asking for a moment, because the create finishes after its ssh client is gone.
  standin="${root}/interrupted-while-creating"
  a_case "${standin}"
  : > "${standin}/create.holds"
  set -m
  PATH="${STAND_INS}:${PATH}" MARTHA_CLEAN_INSTALL_STAND_IN="${standin}" "${SELF}" 'a-host' \
    > "${standin}/out" 2> "${standin}/err" &
  child=$!
  set +m
  waited=0
  while ! grep -q '^create ' "${standin}/calls" 2> /dev/null; do
    sleep 0.2
    waited=$((waited + 1))
    if [ "${waited}" -gt 250 ]; then break; fi
  done
  kill -INT -"${child}" 2> /dev/null || true
  waited=0
  wait "${child}" || waited=$?
  [ "${waited}" -eq 1 ] || { echo "the self-test: an interrupt during create exited ${waited}, not 1" >&2; case_failed=1; }
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
  set -m
  PATH="${STAND_INS}:${PATH}" MARTHA_CLEAN_INSTALL_STAND_IN="${standin}" "${SELF}" 'a-host' \
    > "${standin}/out" 2> "${standin}/err" &
  child=$!
  set +m
  waited=0
  while ! grep -q '^create ' "${standin}/calls" 2> /dev/null; do
    sleep 0.2
    waited=$((waited + 1))
    if [ "${waited}" -gt 250 ]; then break; fi
  done
  kill -INT -"${child}" 2> /dev/null || true
  waited=0
  wait "${child}" || waited=$?
  [ "${waited}" -eq 1 ] || { echo "the self-test: an interrupt during a create that outlived the window exited ${waited}, not 1" >&2; case_failed=1; }
  asked_for '^FAIL tear down: martha-clean-install-[^ ]* was not seen within the window' "${standin}/out" \
    || { echo 'the self-test: a create still running when the window ended did not fail the tear-down, naming the container' >&2; case_failed=1; }
  if grep -q '^ok tear down: ' "${standin}/out"; then
    echo 'the self-test: a create still running when the window ended was reported as a container never made' >&2
    case_failed=1
  fi

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

  # The arguments: no host, an unknown option, two hosts and a log it cannot write are refused, and nothing runs.
  expect_status 2 "${root}" || case_failed=1
  expect_status 2 "${root}" --no-such-option || case_failed=1
  expect_status 2 "${root}" 'a-host' 'another-host' || case_failed=1
  expect_status 2 "${root}" --host 'a-host' --log "${root}/no-such-folder/a.log" || case_failed=1
  no_such_file "${root}/calls" || { echo 'the self-test: a refused run still reached podman' >&2; case_failed=1; }

  # Every run that was not one that could not confirm its container gone, or whose host stopped answering, ended with
  # nothing of it left: what this file says last is what these cases check.
  for standin in passes no-release refused other-version runs-as-root mounted on-the-host-network \
    given-the-hosts-environment interrupted interrupted-while-creating a-create-that-outlives-the-window \
    a-create-podman-refused a-create-ssh-could-not-carry the-image-cannot-be-pulled; do
    if [ -e "${root}/${standin}/container.present" ]; then
      echo "the self-test: the ${standin} run left its container behind" >&2
      case_failed=1
    fi
  done

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
  run_the_steps
}

main "$@"

#!/usr/bin/env bash
# Diagnose a headless Audacity that starts but never opens its script pipes.
# Everything here is observation only: audio devices, the process tree, native
# backtraces of every thread, and a screenshot of the virtual screen, which is
# the only way to see a modal dialog nobody is there to dismiss.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${ROOT_DIR}/out}"
DISPLAY_NUM="${PROBE_DISPLAY:-:99}"
WAIT_SECONDS="${PROBE_WAIT_SECONDS:-60}"
UID_NOW="$(id -u)"

mkdir -p "${OUT_DIR}"

echo "--- identity and inherited environment ---"
id
for name in HOME PATH DISPLAY LD_LIBRARY_PATH XDG_CONFIG_HOME XDG_RUNTIME_DIR TMPDIR; do
  printf '%s=%s\n' "${name}" "${!name-}"
done
ls -ld /tmp /tmp/audacity_script_pipe.* 2>&1 || true

echo "--- audio devices ---"
ls -l /dev/snd 2>&1 || true
cat /proc/asound/cards 2>&1 || true

echo "--- display ---"
Xvfb "${DISPLAY_NUM}" -screen 0 1280x800x24 >"${OUT_DIR}/xvfb.log" 2>&1 &
XVFB_PID=$!
sleep 2

HOME_DIR="$(mktemp -d)"
mkdir -p "${HOME_DIR}/.config/audacity"
cp "${ROOT_DIR}/.audacity-config/audacity.cfg" "${HOME_DIR}/.config/audacity/audacity.cfg"

rm -f "/tmp/audacity_script_pipe.to.${UID_NOW}" "/tmp/audacity_script_pipe.from.${UID_NOW}"

echo "--- launching ---"
env -i \
  HOME="${HOME_DIR}" \
  DISPLAY="${DISPLAY_NUM}" \
  PATH="/usr/bin:/bin" \
  ALSA_CONFIG_PATH="${ROOT_DIR}/.asoundrc" \
  LD_LIBRARY_PATH="${ROOT_DIR}/.audacity/squashfs-root/lib:${ROOT_DIR}/.audacity/squashfs-root/fallback/libportaudio.so" \
  AUDACITY_LOG_LEVEL=INFO \
  "${ROOT_DIR}/.audacity/squashfs-root/AppRun" >"${OUT_DIR}/probe-audacity.log" 2>&1 &
APP_PID=$!

deadline=$((SECONDS + WAIT_SECONDS))
opened=no
while ((SECONDS < deadline)); do
  if [[ -e "/tmp/audacity_script_pipe.to.${UID_NOW}" && -e "/tmp/audacity_script_pipe.from.${UID_NOW}" ]]; then
    opened=yes
    break
  fi
  sleep 0.5
done
echo "pipes opened: ${opened} after $((SECONDS - deadline + WAIT_SECONDS))s"

echo "--- processes ---"
ps -ef | grep -iE 'audacity|Xvfb' | grep -v grep || true

TARGET="$(pgrep -f 'squashfs-root/bin/audacity' | head -1)"
if [[ -n "${TARGET}" ]] && command -v gdb >/dev/null; then
  echo "--- backtraces (pid ${TARGET}) ---"
  gdb -p "${TARGET}" -batch -ex 'thread apply all bt' 2>&1 | head -200
fi

if command -v xwd >/dev/null; then
  echo "--- screenshot ---"
  if xwd -root -display "${DISPLAY_NUM}" >"${OUT_DIR}/screen.xwd" 2>"${OUT_DIR}/xwd.log"; then
    command -v convert >/dev/null && convert "${OUT_DIR}/screen.xwd" "${OUT_DIR}/screen.png"
    echo "captured $(ls -l "${OUT_DIR}"/screen.* | tr '\n' ' ')"
  else
    cat "${OUT_DIR}/xwd.log"
  fi
fi

echo "--- audacity output ---"
cat "${OUT_DIR}/probe-audacity.log" || true

kill "${APP_PID}" 2>/dev/null
kill "${XVFB_PID}" 2>/dev/null
rm -rf "${HOME_DIR}"
[[ "${opened}" == yes ]]

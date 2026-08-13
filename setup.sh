#!/usr/bin/env bash
set -euo pipefail

AUDACITY_VERSION="3.7.8"
AUDACITY_ASSET="audacity-linux-${AUDACITY_VERSION}-x64-22.04.AppImage"
AUDACITY_URL="https://github.com/audacity/audacity/releases/download/Audacity-${AUDACITY_VERSION}/${AUDACITY_ASSET}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${ROOT_DIR}/.audacity"
APPIMAGE="${INSTALL_DIR}/${AUDACITY_ASSET}"
EXTRACTED="${INSTALL_DIR}/squashfs-root"
VENV="${ROOT_DIR}/.venv"

mkdir -p "${INSTALL_DIR}"
if [[ ! -f "${APPIMAGE}" ]]; then
  command -v wget >/dev/null || { echo "wget is required" >&2; exit 1; }
  wget --https-only --show-progress -O "${APPIMAGE}.tmp" "${AUDACITY_URL}"
  mv "${APPIMAGE}.tmp" "${APPIMAGE}"
fi
chmod +x "${APPIMAGE}"
if [[ ! -x "${EXTRACTED}/AppRun" ]]; then
  rm -rf "${EXTRACTED}"
  (cd "${INSTALL_DIR}" && "${APPIMAGE}" --appimage-extract >/dev/null)
fi
if [[ ! -e "${EXTRACTED}/lib/libportaudio.so" ]]; then
  ln -s "${EXTRACTED}/fallback/libportaudio.so/libportaudio.so" "${EXTRACTED}/lib/libportaudio.so"
fi

if [[ ! -d "${VENV}" ]]; then
  python3 -m venv "${VENV}"
fi
"${VENV}/bin/pip" install --disable-pip-version-check -r "${ROOT_DIR}/requirements.txt"

# Audacity's PortAudio backend needs an enumerated device even when no audio
# is played. The ALSA null PCM provides one without requiring a user service.
cat > "${ROOT_DIR}/.asoundrc" <<'EOF'
pcm.!default {
  type null
}
ctl.!default {
  type hw
  card 0
}
EOF

CFG_DIR="${ROOT_DIR}/.audacity-config"
mkdir -p "${CFG_DIR}"
CFG="${CFG_DIR}/audacity.cfg"
{
  echo "PrefsVersion=1.1.1r1"
  echo "[GUI]"
  echo "ShowSplashScreen=0"
  echo "ShowWelcomeDialog=0"
  echo "[Startup]"
  echo "FirstRun=0"
  echo "[SamplingRate]"
  echo "DefaultProjectSampleRate=96000"
  echo "[FileFormats]"
  echo "FLACBitDepth=24"
  echo "[Module]"
  for module in "${EXTRACTED}"/lib/audacity/modules/mod-*.so; do
    name="$(basename "${module}" .so)"
    printf '%s=1\n' "${name}"
  done
  echo "[ModulePath]"
  for module in "${EXTRACTED}"/lib/audacity/modules/mod-*.so; do
    name="$(basename "${module}" .so)"
    printf '%s=%s\n' "${name}" "${module}"
  done
  echo "[ModuleDateTime]"
  for module in "${EXTRACTED}"/lib/audacity/modules/mod-*.so; do
    name="$(basename "${module}" .so)"
    timestamp="$(date -u -d "@$(stat -c %Y "${module}")" +%Y-%m-%dT%H:%M:%S)"
    printf '%s=%s\n' "${name}" "${timestamp}"
  done
} > "${CFG}"

cat > "${ROOT_DIR}/audacity.env" <<EOF
AUDACITY_ROOT=${EXTRACTED}
AUDACITY_BIN=${EXTRACTED}/AppRun
AUDACITY_CONFIG_DIR=${CFG_DIR}
AUDACITY_LD_LIBRARY_PATH=${EXTRACTED}/lib:${EXTRACTED}/fallback/libportaudio.so
EOF

echo "Audacity ${AUDACITY_VERSION} installed at ${EXTRACTED}"
echo "Python environment ready at ${VENV}"

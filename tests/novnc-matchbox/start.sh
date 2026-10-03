#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_dir="${NOVNC_TEST_RUNTIME_DIR:-${root_dir}/.runtime/novnc-matchbox}"
: "${VNC_DISPLAY:=:23}"
: "${VNC_PORT:=5923}"
: "${NOVNC_PORT:=1984}"
: "${DISPLAY_SIZE:=1280x720}"
: "${DISPLAY_DEPTH:=16}"
: "${PPTX_PATH:=}"
: "${TEST_APP:=browser}"
: "${VNC_BACKEND:=tigervnc}"
: "${USE_MATCHBOX:=0}"
: "${RFB_MODE:=legacy}"

for command in go matchbox-window-manager python3; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
case "$TEST_APP" in
  browser|impress) ;;
  *) echo "TEST_APP must be browser or impress" >&2; exit 1 ;;
esac
[[ "$USE_MATCHBOX" =~ ^(0|1)$ ]] || { echo "USE_MATCHBOX must be 0 or 1" >&2; exit 1; }
case "$VNC_BACKEND" in
  tigervnc)
    for command in tigervncserver; do
      command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
    done
    ;;
  x11vnc)
    for command in Xvfb x11vnc; do
      command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
    done
    ;;
  *) echo "VNC_BACKEND must be tigervnc or x11vnc" >&2; exit 1 ;;
esac
case "$RFB_MODE" in
  legacy|direct) ;;
  *) echo "RFB_MODE must be legacy or direct" >&2; exit 1 ;;
esac
if [[ "$RFB_MODE" == "legacy" ]]; then
  command -v websockify >/dev/null || { echo "Missing required command: websockify" >&2; exit 1; }
fi
if [[ "$TEST_APP" == "impress" ]]; then
  command -v libreoffice >/dev/null || { echo "Missing required command: libreoffice" >&2; exit 1; }
  [[ -n "$PPTX_PATH" ]] || { echo "PPTX_PATH is required for TEST_APP=impress" >&2; exit 1; }
  [[ -f "$PPTX_PATH" ]] || { echo "PPTX not found: $PPTX_PATH" >&2; exit 1; }
fi
[[ "$VNC_DISPLAY" =~ ^:[0-9]+$ ]] || { echo "VNC_DISPLAY must look like :23" >&2; exit 1; }
[[ "$DISPLAY_SIZE" =~ ^[0-9]+x[0-9]+$ ]] || { echo "DISPLAY_SIZE must look like 1280x720" >&2; exit 1; }
[[ "$DISPLAY_DEPTH" =~ ^(16|24)$ ]] || { echo "DISPLAY_DEPTH must be 16 or 24" >&2; exit 1; }

if ss -ltn "sport = :${VNC_PORT}" | grep -q LISTEN; then
  echo "VNC port ${VNC_PORT} is already in use" >&2
  exit 1
fi
if ss -ltn "sport = :${NOVNC_PORT}" | grep -q LISTEN; then
  echo "noVNC port ${NOVNC_PORT} is already in use" >&2
  exit 1
fi
if [[ "$RFB_MODE" == "legacy" ]] && ss -ltn "sport = :6082" | grep -q LISTEN; then
  echo "internal websockify port 6082 is already in use" >&2
  exit 1
fi

umask 077
mkdir -p "$runtime_dir"
password_text_file="$runtime_dir/vnc-password.txt"
x11vnc_password_file="$runtime_dir/x11vnc-password"
# A fresh profile prevents a previously killed test session from displaying a
# recovery dialog in front of the requested presentation.
if [[ "$TEST_APP" == "impress" ]]; then
  profile_dir="$(mktemp -d "$runtime_dir/libreoffice-profile.XXXXXX")"
  presentation_path="$runtime_dir/presentation-$(date +%s%N).pptx"

  # The source may be open elsewhere. Use an isolated copy so the test never
  # changes it and cannot be blocked by an existing LibreOffice lock file.
  cp "$PPTX_PATH" "$presentation_path"
fi

if [[ "$VNC_BACKEND" == "x11vnc" && ! -s "$password_text_file" ]]; then
  if [[ -z "${VNC_PASSWORD:-}" ]]; then
    VNC_PASSWORD="$(openssl rand -hex 4)"
  fi
  printf '%s\n' "$VNC_PASSWORD" > "$password_text_file"
fi
if [[ "$VNC_BACKEND" == "x11vnc" && ! -s "$x11vnc_password_file" ]]; then
  x11vnc -storepasswd "$(<"$password_text_file")" "$x11vnc_password_file" >/dev/null
fi
export TEST_APP
export USE_MATCHBOX
export MINIMAL_BROWSER_SCRIPT="$root_dir/tests/novnc-matchbox/minimal-browser.py"
if [[ "$TEST_APP" == "impress" ]]; then
  export PPTX_PATH="$presentation_path"
  export LIBREOFFICE_PROFILE="$profile_dir"
fi
export IMPRESS_UI_CONFIG_SCRIPT="$root_dir/tests/novnc-matchbox/configure-impress.py"
export IMPRESS_UI_CONFIG_LOG="$runtime_dir/configure-impress.log"
export IMPRESS_SLIDE_COUNTER_SCRIPT="$root_dir/tests/novnc-matchbox/slide-counter.py"
export IMPRESS_SLIDE_COUNTER_LOG="$runtime_dir/slide-counter.log"
export IMPRESS_SLIDE_COUNTER_PID="$runtime_dir/slide-counter.pid"
printf '%s\n' "$VNC_DISPLAY" > "$runtime_dir/display"
printf '%s\n' "$VNC_BACKEND" > "$runtime_dir/backend"

if [[ "$VNC_BACKEND" == "tigervnc" ]]; then
  tigervncserver "$VNC_DISPLAY" \
    -geometry "$DISPLAY_SIZE" \
    -depth "$DISPLAY_DEPTH" \
    -localhost yes \
    -rfbport "$VNC_PORT" \
    -SecurityTypes None \
    -AcceptSetDesktopSize=1 \
    -xstartup "$root_dir/tests/novnc-matchbox/xstartup"
else
  setsid Xvfb "$VNC_DISPLAY" -screen 0 "${DISPLAY_SIZE}x${DISPLAY_DEPTH}" -nolisten tcp \
    >"$runtime_dir/xvfb.log" 2>&1 &
  xvfb_pid=$!
  printf '%s\n' "$xvfb_pid" > "$runtime_dir/xvfb.pid"

  for _ in {1..30}; do
    xdpyinfo -display "$VNC_DISPLAY" >/dev/null 2>&1 && break
    sleep 0.2
  done
  xdpyinfo -display "$VNC_DISPLAY" >/dev/null 2>&1 || {
    echo "Xvfb did not start; see $runtime_dir/xvfb.log" >&2
    exit 1
  }

  setsid env DISPLAY="$VNC_DISPLAY" \
    "$root_dir/tests/novnc-matchbox/xstartup" \
    >"$runtime_dir/app.log" 2>&1 &
  app_pid=$!
  printf '%s\n' "$app_pid" > "$runtime_dir/app.pid"

  setsid x11vnc -display "$VNC_DISPLAY" \
    -rfbport "$VNC_PORT" \
    -rfbauth "$x11vnc_password_file" \
    -localhost \
    -forever \
    -shared \
    -xrandr \
    -repeat \
    >"$runtime_dir/x11vnc.log" 2>&1 &
  x11vnc_pid=$!
  printf '%s\n' "$x11vnc_pid" > "$runtime_dir/x11vnc.pid"
fi

for _ in {1..30}; do
  ss -ltn "sport = :${VNC_PORT}" | grep -q LISTEN && break
  sleep 0.2
done
ss -ltn "sport = :${VNC_PORT}" | grep -q LISTEN || {
  echo "VNC server did not start" >&2
  exit 1
}

go build -o "$runtime_dir/novnc-input" "$root_dir/cmd/novnc-input"
gateway_args=(
  -listen "0.0.0.0:${NOVNC_PORT}"
  -display "$VNC_DISPLAY"
  -vnc-addr "127.0.0.1:${VNC_PORT}"
)
if [[ "$RFB_MODE" == "legacy" ]]; then
  setsid websockify "127.0.0.1:6082" "127.0.0.1:${VNC_PORT}" \
    </dev/null \
    >"$runtime_dir/websockify.log" 2>&1 &
  websockify_pid=$!
  printf '%s\n' "$websockify_pid" > "$runtime_dir/websockify.pid"
  for _ in {1..30}; do
    ss -ltn "sport = :6082" | grep -q LISTEN && break
    sleep 0.2
  done
  ss -ltn "sport = :6082" | grep -q LISTEN || {
    echo "internal websockify did not start; see $runtime_dir/websockify.log" >&2
    exit 1
  }
  gateway_args+=( -legacy-rfb "ws://127.0.0.1:6082" )
fi
setsid "$runtime_dir/novnc-input" \
  "${gateway_args[@]}" \
  </dev/null \
  >"$runtime_dir/novnc-input.log" 2>&1 &
novnc_input_pid=$!
printf '%s\n' "$novnc_input_pid" > "$runtime_dir/novnc-input.pid"

for _ in {1..30}; do
  ss -ltn "sport = :${NOVNC_PORT}" | grep -q LISTEN && break
  sleep 0.2
done
ss -ltn "sport = :${NOVNC_PORT}" | grep -q LISTEN || {
  echo "noVNC input gateway did not start; see $runtime_dir/novnc-input.log" >&2
  exit 1
}

host_ip="$(hostname -I | awk '{print $1}')"
resize_mode="scale"
[[ "$VNC_BACKEND" == "tigervnc" ]] && resize_mode="remote"
rfb_query=""
[[ "$RFB_MODE" == "direct" ]] && rfb_query="&rfb=direct"
echo "noVNC kiosk: http://${host_ip}:${NOVNC_PORT}/kiosk.html?resize=${resize_mode}${rfb_query}"
echo "Classic read/write noVNC (not used by the kiosk): http://${host_ip}:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=${resize_mode}"
if [[ "$VNC_BACKEND" == "tigervnc" ]]; then
  echo "VNC authentication: disabled"
else
  echo "VNC password: $(<"$password_text_file")"
fi
echo "Stop: $root_dir/tests/novnc-matchbox/stop.sh"

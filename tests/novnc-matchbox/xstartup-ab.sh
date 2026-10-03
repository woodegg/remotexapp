#!/bin/sh
# Independent LibreOffice session for the RFB relay A/B test. It deliberately
# uses a separate profile, VNC display and UNO port from the main test session.
set -eu

matchbox-window-manager -use_titlebar no &

libreoffice \
  --impress \
  --nologo \
  --nodefault \
  --nofirststartwizard \
  --norestore \
  --nolockcheck \
  --accept="socket,host=127.0.0.1,port=${UNO_PORT};urp;StarOffice.ComponentContext" \
  "-env:UserInstallation=file://${LIBREOFFICE_PROFILE}" \
  "${PPTX_PATH}" &

wait "$!"

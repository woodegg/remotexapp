#!/bin/sh
set -eu

label=${1:?inventory label}
output_dir=${BENCH_OUTPUT_DIR:-tests/system-performance/results}
manager_url=${BENCH_MANAGER_URL:-http://127.0.0.1:1991}
mkdir -p "$output_dir"
output_dir=$(realpath "$output_dir")
output_path="$output_dir/$label-inventory.json"

manager_pid=$(ss -ltnp | sed -n 's/.*:1991 .*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)
if [ -z "$manager_pid" ]; then
  echo "manager is not listening on port 1991" >&2
  exit 1
fi

proc_summary() {
  pid=$1
  pss=$(awk '$1=="Pss:"{print $2}' "/proc/$pid/smaps_rollup" 2>/dev/null || printf 0)
  private=$(awk '$1=="Private_Clean:"||$1=="Private_Dirty:"{sum+=$2} END{print sum+0}' "/proc/$pid/smaps_rollup" 2>/dev/null || printf 0)
  rss=$(awk '$1=="VmRSS:"{print $2}' "/proc/$pid/status" 2>/dev/null || printf 0)
  stat_fields=$(sed 's/^[^)]*) //' "/proc/$pid/stat")
  cpu_ticks=$(printf '%s\n' "$stat_fields" | awk '{print $12+$13}')
  jq -n --argjson pid "$pid" --argjson pssKiB "$pss" --argjson privateKiB "$private" \
    --argjson rssKiB "$rss" --argjson cpuTicks "$cpu_ticks" \
    '{pid:$pid,pssKiB:$pssKiB,privateKiB:$privateKiB,rssKiB:$rssKiB,cpuTicks:$cpuTicks}'
}

cgroup_summary() {
  path=$1
  if [ ! -d "$path" ]; then printf 'null\n'; return; fi
  pss=0
  private=0
  process_count=0
  commands='[]'
  while read -r pid; do
    [ -n "$pid" ] || continue
    if [ -r "/proc/$pid/smaps_rollup" ]; then
      value=$(awk '$1=="Pss:"{print $2}' "/proc/$pid/smaps_rollup")
      pss=$((pss+value))
      value=$(awk '$1=="Private_Clean:"||$1=="Private_Dirty:"{sum+=$2} END{print sum+0}' "/proc/$pid/smaps_rollup")
      private=$((private+value))
      process_count=$((process_count+1))
      command=$(tr '\0' ' ' <"/proc/$pid/cmdline" | sed 's/[[:space:]]*$//')
      commands=$(printf '%s' "$commands" | jq --arg pid "$pid" --arg command "$command" '. + [{pid:($pid|tonumber),command:$command}]')
    fi
  done <"$path/cgroup.procs"
  cpu_usec=$(awk '$1=="usage_usec"{print $2}' "$path/cpu.stat")
  jq -n --arg path "$path" \
    --argjson memoryCurrentBytes "$(cat "$path/memory.current")" \
    --argjson memoryPeakBytes "$(cat "$path/memory.peak")" \
    --argjson tasks "$(cat "$path/pids.current")" \
    --argjson cpuUsec "$cpu_usec" \
    --argjson processCount "$process_count" \
    --argjson pssKiB "$pss" \
    --argjson privateKiB "$private" \
    --argjson commands "$commands" \
    '{path:$path,memoryCurrentBytes:$memoryCurrentBytes,memoryPeakBytes:$memoryPeakBytes,
      tasks:$tasks,cpuUsec:$cpuUsec,processCount:$processCount,pssKiB:$pssKiB,
      privateKiB:$privateKiB,commands:$commands}'
}

instances=$(curl -fsS "$manager_url/api/instances")
classes=$(curl -fsS "$manager_url/api/classes")
xfce_id=$(printf '%s' "$instances" | jq -r '[.[] | select(.classId=="xfce-user-desktop" and (.state=="server-ready" or .state=="ready"))][0].id // empty')
user_cgroup=/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice

xfce_vnc=null
xfce_server=null
xfce_gateway=null
xfce_session=null
if [ -n "$xfce_id" ]; then
  xfce=$(curl -fsS "$manager_url/api/instances/$xfce_id")
  xfce_vnc=$(cgroup_summary "$user_cgroup/$(printf '%s' "$xfce" | jq -r '.vncUnit')")
  xfce_server_unit=$(printf '%s' "$xfce" | jq -r '.serverUnit // empty')
  if [ -n "$xfce_server_unit" ]; then
    xfce_server=$(cgroup_summary "$user_cgroup/$xfce_server_unit")
  fi
  xfce_gateway=$(cgroup_summary "$user_cgroup/$(printf '%s' "$xfce" | jq -r '.gatewayUnit')")
  xfce_session=$(cgroup_summary "$user_cgroup/$(printf '%s' "$xfce" | jq -r '.sessionUnit')")
fi

gateway_pid=""
if [ -n "$xfce_id" ]; then
  gateway_pid=$(printf '%s' "$xfce_gateway" | jq -r '.commands[0].pid // empty')
fi
manager_command=$(tr '\0' ' ' <"/proc/$manager_pid/cmdline" | sed 's/[[:space:]]*$//')
status_path=$(printf '%s\n' "$manager_command" | sed -n 's/.*-status-bin \([^ ]*\).*/\1/p')
runtime_hashes=$(jq -n \
  --arg manager "$(sha256sum "/proc/$manager_pid/exe" | awk '{print $1}')" \
  --arg gateway "$(if [ -n "$gateway_pid" ]; then sha256sum "/proc/$gateway_pid/exe" | awk '{print $1}'; fi)" \
  --arg status "$(if [ -n "$status_path" ] && [ -r "$status_path" ]; then sha256sum "$status_path" | awk '{print $1}'; fi)" \
  '{manager:$manager,gateway:$gateway,status:$status}')
repository_hashes=$(jq -n \
  --arg manager "$(sha256sum bin/remotexappd | awk '{print $1}')" \
  --arg gateway "$(sha256sum bin/novnc-input | awk '{print $1}')" \
  --arg status "$(sha256sum bin/remotexapp-status | awk '{print $1}')" \
  '{manager:$manager,gateway:$gateway,status:$status}')
config_hashes=$(sha256sum apps/*/manifest.json \
  drivers/common/x11-server.sh cmd/remotexapp-status/supervisor.go \
  drivers/common/session-status.sh \
  apps/xfce-user-desktop/server.sh apps/xfce-user-desktop/session.sh \
  apps/mousepad/session.sh apps/edge/session.sh \
  components/remote-unicode-engine/engine.py | jq -Rn \
    '[inputs | capture("^(?<sha256>[0-9a-f]+)  (?<path>.+)$")]')

manager_process=$(proc_summary "$manager_pid")
cpu_model=$(awk -F: '$1 ~ /^model name[[:space:]]*$/{sub(/^[[:space:]]+/,"",$2); print $2; exit}' /proc/cpuinfo)

jq -n \
  --arg label "$label" \
  --arg collectedAt "$(date --iso-8601=seconds)" \
  --arg hostname "$(hostname)" \
  --arg kernel "$(uname -srmo)" \
  --arg cpuModel "$cpu_model" \
  --argjson logicalCpuCount "$(nproc)" \
  --arg loadavg "$(cat /proc/loadavg)" \
  --arg managerCommand "$manager_command" \
  --argjson managerProcess "$manager_process" \
  --argjson runtimeHashes "$runtime_hashes" \
  --argjson repositoryHashes "$repository_hashes" \
  --argjson configHashes "$config_hashes" \
  --argjson classes "$classes" \
  --argjson instances "$instances" \
  --argjson xfceVnc "$xfce_vnc" \
  --argjson xfceServer "$xfce_server" \
  --argjson xfceGateway "$xfce_gateway" \
  --argjson xfceSession "$xfce_session" \
  '{schemaVersion:1,label:$label,collectedAt:$collectedAt,host:{hostname:$hostname,kernel:$kernel,
    cpuModel:$cpuModel,logicalCpuCount:$logicalCpuCount,loadavg:$loadavg},manager:{command:$managerCommand,
    process:$managerProcess},runtimeHashes:$runtimeHashes,repositoryHashes:$repositoryHashes,
    configHashes:$configHashes,classes:$classes,instances:$instances,
    xfceServerOnly:{vnc:$xfceVnc,server:$xfceServer,gateway:$xfceGateway,session:$xfceSession}}' >"$output_path"

cat "$output_path"

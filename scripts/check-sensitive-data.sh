#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

command -v rg >/dev/null 2>&1 || {
  echo "sensitive-data check requires rg (ripgrep)" >&2
  exit 1
}

failed=0

report_tracked_matches() {
  local label=$1
  local pattern=$2
  local matches

  matches="$(git grep -IlE -- "$pattern" -- . 2>/dev/null || true)"
  if [[ -n "$matches" ]]; then
    printf 'sensitive-data check failed: %s\n%s\n' "$label" "$matches" >&2
    failed=1
  fi
}

private_markers='/home/'ubuntu'/|Gov'Ln'|homeowner-'response'|special-'assessment'|core-'desktop'|core-extra[0-9]+|core-wx[0-9]+'
personal_markers='woodegg@hot'mail'\.com'
credential_markers='-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}'
private_ipv4_markers='10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}'

report_tracked_matches 'private deployment, document, or identity marker found' "$private_markers|$personal_markers"
report_tracked_matches 'high-confidence credential marker found' "$credential_markers"
report_tracked_matches 'private IPv4 address found' "$private_ipv4_markers"

if git log --all --full-history -p --format= | rg "$private_markers|$personal_markers" >/dev/null; then
  echo "sensitive-data check failed: reachable Git history contains a private marker" >&2
  failed=1
fi

suspicious_names="$(git ls-files | rg -i '(^|/)(\.env|id_(rsa|ed25519)|.*\.(pem|key|p12|pfx|kdbx)|credentials?|secrets?|cookies?|tokens?)(\.|/|$)' || true)"
if [[ -n "$suspicious_names" ]]; then
  printf 'sensitive-data check failed: suspicious tracked filename\n%s\n' "$suspicious_names" >&2
  failed=1
fi

if (( failed != 0 )); then
  exit 1
fi

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [release.tar.gz]" >&2
  exit 2
fi

if [[ $# -eq 1 ]]; then
  archive=$1
  [[ -f "$archive" ]] || { echo "release archive not found: $archive" >&2; exit 1; }
  if tar -xOzf "$archive" | strings | rg "$private_markers|$personal_markers|$credential_markers|$private_ipv4_markers" >/dev/null; then
    echo "sensitive-data check failed: release archive contains a blocked marker" >&2
    exit 1
  fi
fi

echo "sensitive-data check passed"

#!/usr/bin/env bash
# tof-guard.sh — read-only security scan for the TOF repo (Vite SPA + Supabase).
#
# Replaces the grep-able half of a manual security review. It makes no network
# calls and changes nothing. It reads tracked files only, so node_modules and
# dist are never scanned.
#
# It is STATIC. The final state of grants, RLS and views lives in the live
# database, which migrations alone cannot prove (see references/live-checks.md).
#
# Usage: tof-guard.sh            human-readable report
# Exit:  0 no CRITICAL/HIGH · 1 at least one CRITICAL/HIGH · 2 not in a git repo
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not in a git repo" >&2; exit 2; }

# Findings are logged to a file because report() often runs inside a pipeline
# subshell, where plain counters would be lost.
log=$(mktemp); trap 'rm -f "$log"' EXIT
report() { # sev id location message
  echo "$1" >> "$log"
  printf '%-8s %-22s %s  %s\n' "$1" "$2" "$3" "$4"
}

# Files that are not product code and legitimately mention key shapes.
SKIP='(^|/)(package-lock\.json|\.claude/|docs/|test/)'
tracked=$(git ls-files | grep -Ev "$SKIP")
src_files=$(printf '%s\n' "$tracked" | grep -E '^(src/|index\.html|public/)' || true)
fn_files=$(printf '%s\n' "$tracked" | grep -E '^supabase/functions/.*\.ts$' || true)
mig_files=$(git ls-files 'supabase/migrations/*.sql' | sort)

scan() { # sev id regex message files...
  local sev="$1" id="$2" re="$3" msg="$4"; shift 4
  [ -z "${1:-}" ] && return 0
  printf '%s\n' "$@" | xargs -r grep -HnIE -- "$re" 2>/dev/null | while IFS= read -r hit; do
    printf '%s\n' "$hit" | cut -c1-160
  done | while IFS= read -r line; do echo "$sev|$id|${line%%:*}:$(echo "$line" | cut -d: -f2)|$msg"; done
}
emit() { while IFS='|' read -r sev id loc msg; do [ -n "$sev" ] && report "$sev" "$id" "$loc" "$msg"; done; }

echo "== Secrets"
git ls-files | grep -E '(^|/)\.env(\.|$)' | grep -Ev '\.example$' | while read -r f; do echo "CRITICAL|env-committed|$f:1|Environment file is tracked by git"; done | emit
scan CRITICAL secret-pattern \
  'AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|[sr]k_live_[A-Za-z0-9]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}|(postgres(ql)?|mysql|mongodb)://[^:@/ ]+:[^@ ]+@' \
  "Credential-shaped value in a tracked file" $tracked | emit
scan CRITICAL service-role-client 'service_role|SERVICE_ROLE' \
  "service_role referenced in browser-shipped code (bypasses all RLS)" $src_files | emit
scan HIGH vite-secret-name 'VITE_[A-Z0-9_]*(SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN)' \
  "VITE_ variables are bundled into the browser; this name looks secret" $src_files | emit

echo "== Edge functions"
for f in $(printf '%s\n' "$fn_files" | grep -E '/index\.ts$'); do
  n=$(basename "$(dirname "$f")")
  [ "$n" = _shared ] && continue
  if ! grep -q 'auth\.getUser' "$f"; then
    if grep -q 'status: 410' "$f"; then
      report INFO edge-no-auth "$f:1" "No auth, but the function is retired (410) — expected"
    elif grep -q 'tof-guard: public' "$f"; then
      report INFO edge-no-auth "$f:1" "Marked public on purpose"
    else
      report HIGH edge-no-auth "$f:1" "Function never verifies the caller (auth.getUser). Add it, or mark '// tof-guard: public' with a reason"
    fi
  fi
done
# Only a line that builds a Response can leak; console.error(e.stack) stays on the server.
scan HIGH edge-error-leak 'Response\(.*(\.message|\.stack|error\.)' \
  "Internal error detail may be sent to the client" $(printf '%s\n' "$fn_files" | grep -E '/index\.ts$') | emit
scan MEDIUM edge-console-payload 'console\.log\(.*(body|token|password|pin|phone|secret)' \
  "Request data or secret may be written to logs" $fn_files | emit

echo "== Database (static, from migrations)"
# Tables created but never given RLS in any migration.
for t in $(printf '%s\n' $mig_files | xargs -r grep -hiE 'create table (if not exists )?(public\.)?[a-z_]+' \
            | sed -E 's/.*create table (if not exists )?(public\.)?([a-z_]+).*/\3/I' | sort -u); do
  if ! printf '%s\n' $mig_files | xargs -r grep -qiE "alter table (if exists )?(only )?(public\.)?$t +enable row level security|enable row level security.*$t"; then
    report MEDIUM table-no-rls "supabase/migrations" "Table '$t' has no ENABLE ROW LEVEL SECURITY in any migration — confirm live"
  fi
done
# Views: every view without security_invoker should be one of the six guest views.
GUEST='public_players public_rankings public_player_metrics public_activity_feed public_live_matches public_league_settings'
for v in $(printf '%s\n' $mig_files | xargs -r grep -hiE 'create (or replace )?view (public\.)?[a-z_]+' \
            | sed -E 's/.*view (public\.)?([a-z_]+).*/\2/I' | grep -vix 'as' | sort -u); do
  case " $GUEST " in *" $v "*) continue;; esac
  if ! printf '%s\n' $mig_files | xargs -r grep -qiE "(alter view (public\.)?$v .*security_invoker|view (public\.)?$v[^;]*with *\(security_invoker)"; then
    report MEDIUM view-definer "supabase/migrations" "View '$v' is neither a guest view nor security_invoker — it runs with the owner's rights"
  fi
done
report INFO guest-views "CLAUDE.md" "The six guest views are security_definer ON PURPOSE. Do not flag or 'fix' them."
# SECURITY DEFINER functions should pin search_path.
for f in $mig_files; do
  awk -v F="$f" '
    { l=tolower($0) }
    l ~ /create (or replace )?function/ {inh=1; buf=""; start=NR}
    inh {buf=buf "\n" l}
    inh && l ~ /as +\$[a-z_]*\$/ {
      if (buf ~ /security definer/ && buf !~ /search_path/) print "MEDIUM|definer-search-path|" F ":" start "|SECURITY DEFINER function without SET search_path"
      inh=0
    }' "$f"
done | emit
# Anonymous grants beyond the six guest views (history grants and later revokes; one summary line).
n=$(git ls-files 'supabase/migrations/*.sql' | xargs -r grep -hiE 'grant .* to .*\banon\b' 2>/dev/null \
  | grep -ciEv 'public_(players|rankings|player_metrics|activity_feed|live_matches|league_settings)')
[ "${n:-0}" -gt 0 ] && report INFO anon-grant "supabase/migrations" \
  "$n anon grant lines outside the guest views. Migration history grants then revokes; only the live state counts"

echo "== Browser code"
scan HIGH xss-sink 'dangerouslySetInnerHTML|\.innerHTML *=|eval\(|new Function\(' "Unsafe HTML/code sink" $src_files | emit
scan HIGH client-token-storage '(local|session)Storage\.setItem\([^)]*([Tt]oken|[Jj][Ww][Tt]|JWT|[Ss]ession|[Pp]assword|[Pp][Ii][Nn]\b)' \
  "Credential-like value in web storage (readable by any injected script)" $src_files | emit
scan MEDIUM client-console-secret 'console\.(log|debug)\(.*(token|password|secret|session|pin\b|phone)' \
  "Sensitive value may reach the browser console" $src_files | emit
scan MEDIUM placeholder-auth '(TODO|FIXME).*(auth|permission|admin|role)|isAdmin *= *true' \
  "Placeholder authorization" $src_files $fn_files | emit

echo "== Hygiene"
printf '%s\n' "$tracked" | grep -Ei '(_v[0-9]+|[-_](new|old|copy|backup))(\.[a-z0-9]+)+$|\.(bak|orig|tmp)$' \
  | while read -r f; do echo "MEDIUM|stray-file|$f:1|Looks like a leftover duplicate"; done | emit
git ls-files 'test/*' | xargs -r grep -HnE '\b(it|test|describe)\.(skip|only)\(' 2>/dev/null \
  | while IFS= read -r l; do echo "HIGH|test-skipped|${l%%:*}:$(echo "$l" | cut -d: -f2)|Skipped or focused test"; done | emit

echo
crit=$(grep -c '^CRITICAL$' "$log"); high=$(grep -c '^HIGH$' "$log")
med=$(grep -c '^MEDIUM$' "$log"); info=$(grep -c '^INFO$' "$log")
echo "Summary: CRITICAL=$crit HIGH=$high MEDIUM=$med INFO=$info"
echo "Static only. Final grants/RLS/views must be confirmed live: see references/live-checks.md"
[ $((crit+high)) -eq 0 ]

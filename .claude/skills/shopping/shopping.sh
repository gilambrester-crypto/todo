#!/usr/bin/env bash
#
# Shopping list from the terminal. Speaks the same data format as the phone
# app, so edits made here merge with the phones exactly like a third device.
#
# The list code is the password to the list. It is read from the macOS
# keychain and never stored in this repository.
#
#   store it:  security add-generic-password -U -s shopping-list -a "$USER" -w
#   (paste the code at the prompt, press return)

set -euo pipefail

# Public values — safe to keep in the repo. See config.js for why.
URL="${SHOPPING_URL:-https://qoqhbntflldwgpujlyjm.supabase.co}"
ANON_KEY="${SHOPPING_ANON_KEY:-sb_publishable_fssmcA_ixAodV0NZT6XevA_VUWPAZpS}"

KC_SERVICE="${SHOPPING_KEYCHAIN_SERVICE:-shopping-list}"
KC_ACCOUNT="${SHOPPING_KEYCHAIN_ACCOUNT:-${USER:-default}}"

die() { printf '%s\n' "$*" >&2; exit 1; }

list_code() {
  local code=""
  if [ -n "${SHOPPING_LIST_CODE:-}" ]; then
    code=$SHOPPING_LIST_CODE
  elif command -v security >/dev/null 2>&1; then
    code=$(security find-generic-password -s "$KC_SERVICE" -a "$KC_ACCOUNT" -w 2>/dev/null) || code=""
  fi

  # Copy-paste routinely drags in a newline or a stray space. Left in place
  # those land in the request URL and curl rejects the whole thing with a
  # message that says nothing useful, so strip them here.
  code=${code//$'\r'/}
  code=${code//$'\n'/}
  code="${code#"${code%%[![:space:]]*}"}"
  code="${code%"${code##*[![:space:]]}"}"

  printf '%s' "$code"
}

# A v4 UUID. uuidgen exists on macOS, but falling back keeps this working
# anywhere (and lets the test suite run on Linux).
uuid_v4() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
    return
  fi
  local h
  h=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
  [ ${#h} -eq 32 ] || die "Could not generate a unique id."
  printf '%s-%s-4%s-%x%s-%s\n' \
    "${h:0:8}" "${h:8:4}" "${h:13:3}" \
    "$(( (0x${h:16:1} & 0x3) | 0x8 ))" "${h:17:3}" "${h:20:12}"
}

now_ms() {
  # The app stamps milliseconds; matching that keeps merge order sane.
  if command -v perl >/dev/null 2>&1; then
    perl -MTime::HiRes=time -e 'printf("%.0f\n", time()*1000)'
  else
    printf '%s000\n' "$(date +%s)"
  fi
}

# Escape a string for embedding in JSON. Only touches ASCII specials, so
# UTF-8 text (Hebrew, accents, emoji) passes through untouched.
json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

CODE="$(list_code)"

if [ -z "$CODE" ]; then
  command -v security >/dev/null 2>&1 || die "No 'security' command — this needs macOS, or set SHOPPING_LIST_CODE."
  die "No list code found in the keychain (service '$KC_SERVICE', account '$KC_ACCOUNT').

Store it once with:
  security add-generic-password -U -s $KC_SERVICE -a $KC_ACCOUNT -w

then paste the shared code at the prompt."
fi

case "$CODE" in
  *[!A-Za-z0-9._~-]*)
    die "The list code in the keychain contains characters that cannot go in a URL.

A space, tab or newline picked up while copying is the usual cause. Check what
is actually stored with:

  security find-generic-password -s $KC_SERVICE -a $KC_ACCOUNT -w | od -c

then store it again, taking care not to include surrounding whitespace:

  security add-generic-password -U -s $KC_SERVICE -a $KC_ACCOUNT -w"
    ;;
esac

api() {
  local method=$1 path=$2 body=${3:-} prefer=${4:-return=minimal}
  local args=(-sS -X "$method" "$URL/rest/v1/$path"
    -H "apikey: $ANON_KEY"
    -H "Authorization: Bearer $ANON_KEY"
    -H "x-list-key: $CODE"
    -H "Content-Type: application/json"
    -H "Prefer: $prefer"
    -w '\n%{http_code}')
  [ -n "$body" ] && args+=(-d "$body")

  local out code
  out=$(curl "${args[@]}") || die "Could not reach Supabase. Are you online?"
  code=${out##*$'\n'}
  out=${out%$'\n'*}

  case "$code" in
    2*) printf '%s' "$out" ;;
    401|403) die "Rejected ($code). The list code is probably wrong, or the policy in supabase/schema.sql is not set up." ;;
    404) die "Not found (404). The 'items' table does not exist in this project." ;;
    *)  die "Supabase returned $code: $out" ;;
  esac
}

usage() {
  cat <<'USAGE'
Usage:
  shopping.sh list                 Everything still to buy, as JSON (includes ids)
  shopping.sh all                  Include items already in the basket
  shopping.sh add "Milk"           Add an item
  shopping.sh done <id>            Tick an item off
  shopping.sh undone <id>          Put it back on the list
  shopping.sh remove <id>          Delete an item
  shopping.sh clear-done           Remove everything already ticked off

Ids come from `list`. Match items by id, not by text.
USAGE
}

cmd=${1:-list}
case "$cmd" in
  list)
    api GET "items?list_id=eq.$CODE&deleted=is.false&order=created_at.asc&select=id,text,done,created_at"
    echo
    ;;

  all)
    api GET "items?list_id=eq.$CODE&order=created_at.asc&select=id,text,done,deleted,created_at"
    echo
    ;;

  add)
    text=${2:-}; [ -n "$text" ] || die "What should I add?  shopping.sh add \"Milk\""
    id=$(uuid_v4)
    ts=$(now_ms)
    api POST "items?on_conflict=id" \
      "[{\"id\":\"$id\",\"list_id\":\"$(json_escape "$CODE")\",\"text\":\"$(json_escape "$text")\",\"done\":false,\"deleted\":false,\"created_at\":$ts,\"updated_at\":$ts}]" \
      "resolution=merge-duplicates,return=minimal"
    echo "Added: $text"
    ;;

  done|undone)
    id=${2:-}; [ -n "$id" ] || die "Which item? Pass an id from \`shopping.sh list\`."
    val=$([ "$cmd" = done ] && echo true || echo false)
    api PATCH "items?id=eq.$id&list_id=eq.$CODE" \
      "{\"done\":$val,\"updated_at\":$(now_ms)}" "return=representation" >/dev/null
    echo "Marked ${cmd}."
    ;;

  remove)
    id=${2:-}; [ -n "$id" ] || die "Which item? Pass an id from \`shopping.sh list\`."
    # A tombstone, not a real delete — that is how the deletion reaches the phones.
    api PATCH "items?id=eq.$id&list_id=eq.$CODE" \
      "{\"deleted\":true,\"updated_at\":$(now_ms)}" "return=representation" >/dev/null
    echo "Removed."
    ;;

  clear-done)
    api PATCH "items?list_id=eq.$CODE&done=is.true&deleted=is.false" \
      "{\"deleted\":true,\"updated_at\":$(now_ms)}" "return=representation" >/dev/null
    echo "Cleared everything already in the basket."
    ;;

  -h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac

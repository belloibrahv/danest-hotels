#!/usr/bin/env bash
# Set up a new hotel's own copy of the system on Railway, in about ten minutes.
#
#   scripts/new-hotel.sh --name "Lagoon View Hotel" --slug lagoon-view --expires 2027-10-31 [--domain book.lagoonview.ng] [--workspace "<id or name>"] [--dry-run]
#
# What it does: creates a Railway project and service with a volume for the database, sets every
# server setting (secrets generated here), issues the licence, deploys, and gives the service a web
# address. It prints the one-time setup code for the hotel's owner and saves the hotel's secrets to
# ~/.config/hotel-licensing/hotels/<slug>.env (private to you). Nothing in this folder changes:
# the work happens in a temporary copy, so this folder stays linked to its own Railway project.
#
# Needs: the Railway CLI, signed in (railway login), and the vendor licence key on this machine.
set -euo pipefail

NAME="" SLUG="" EXPIRES="" DOMAIN="" WORKSPACE="" DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --expires) EXPIRES="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
if [[ -z "$NAME" || -z "$SLUG" || -z "$EXPIRES" ]]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 1
fi
[[ "$SLUG" =~ ^[a-z0-9-]{3,40}$ ]] || { echo "--slug: lowercase letters, numbers and dashes" >&2; exit 1; }
[[ "$EXPIRES" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "--expires: YYYY-MM-DD" >&2; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_DIR="$HOME/.config/hotel-licensing/hotels"
SECRETS_FILE="$SECRETS_DIR/$SLUG.env"
[[ -e "$SECRETS_FILE" && $DRY -eq 0 ]] && { echo "$SECRETS_FILE already exists: this hotel was set up before." >&2; exit 1; }

run() {
  if [[ $DRY -eq 1 ]]; then printf '  $'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}
secret() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('base64url'))"; }

echo "1. Licence for $NAME, valid to $EXPIRES"
LICENCE="$(node --disable-warning=ExperimentalWarning "$REPO/scripts/licence.ts" issue --hotel "$NAME" --expires "$EXPIRES" 2>/dev/null)"
SETUP_CODE="$(node -e "const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',b=require('crypto').randomBytes(10);process.stdout.write([...b].map(x=>a[x%a.length]).join('').replace(/(.{5})/,'\$1-'))")"
DANEST_SECRET="$(secret 32)"
BACKUP_PASSPHRASE="$(secret 32)"

echo "2. A clean copy of the app to deploy from (this folder is left alone)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$REPO" archive --format=tar HEAD | tar -x -C "$WORK"
cd "$WORK"

echo "3. Railway project, service and volume"
if [[ -n "$WORKSPACE" ]]; then run railway init --name "$SLUG" --workspace "$WORKSPACE"; else run railway init --name "$SLUG"; fi
run railway add --service web
run railway volume --service web add --mount-path /data

echo "4. Server settings"
run railway variable set --service web --skip-deploys \
  "DANEST_DB=/data/hotel.db" \
  "DANEST_SECRET=$DANEST_SECRET" \
  "DANEST_SETUP_CODE=$SETUP_CODE" \
  "BACKUP_PASSPHRASE=$BACKUP_PASSPHRASE" \
  "LICENCE_REQUIRED=1" \
  "LICENCE_KEY=$LICENCE"

echo "5. Deploy"
run railway up --service web --ci

echo "6. Web address"
if [[ -n "$DOMAIN" ]]; then run railway domain --service web "$DOMAIN"; else run railway domain --service web; fi

if [[ $DRY -eq 0 ]]; then
  mkdir -p "$SECRETS_DIR" && chmod 700 "$SECRETS_DIR"
  umask 077
  cat > "$SECRETS_FILE" <<EOF
# $NAME — created $(date +%F). Keep private. BACKUP_PASSPHRASE is the only way to read its off-site backups.
HOTEL_NAME="$NAME"
RAILWAY_PROJECT="$SLUG"
DANEST_SECRET=$DANEST_SECRET
BACKUP_PASSPHRASE=$BACKUP_PASSPHRASE
DANEST_SETUP_CODE=$SETUP_CODE
LICENCE_KEY=$LICENCE
EOF
fi

cat <<EOF

Done. Next, with the hotel's owner:
  1. Open the web address above, go to /setup, and enter the setup code: $SETUP_CODE
     The owner creates their own account there, with the hotel's name and address.
  2. Follow the checklist on the dashboard: rooms and prices, stock, staff, taxes, photos.
  3. Off-site backups: set BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET
     on the service (see README, "Backups").
  4. Optional: TERMII_API_KEY + TERMII_SENDER_ID (SMS), RESEND_API_KEY + EMAIL_FROM (email),
     PAYSTACK_SECRET_KEY (online deposits).
EOF
if [[ $DRY -eq 1 ]]; then echo "(Dry run: nothing was created and nothing was saved.)"; else echo "Secrets saved to $SECRETS_FILE"; fi

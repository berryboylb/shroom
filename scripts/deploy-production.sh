#!/usr/bin/env bash
set -Eeuo pipefail

cd /var/www/shroom/.release
env_file=/var/www/shroom/.env
compose=(docker compose --project-name shroom --env-file "$env_file" -f docker-compose.prod.yml)
database_url='postgres://postgres:postgres@postgres:5432/shroom?sslmode=disable'

test -f "$env_file"
test -f backend/migrations/009_meeting_approval.up.sql
test -f backend/migrations/010_post_call_feedback.up.sql
command -v curl >/dev/null
"${compose[@]}" version >/dev/null

# This release backs up and migrates the bundled Postgres service. An external
# database needs a matching backup/migration route before it can be deployed.
if grep -q '^PROD_DATABASE_URL=' "$env_file"; then
  echo 'PROD_DATABASE_URL override detected; refusing to migrate a different database.' >&2
  exit 1
fi

echo "Building release $(cat release.sha)"
"${compose[@]}" build --pull backend frontend

# The site already has a database. Do not create or replace it as part of the
# backup step; a failed backup must leave the current app untouched.
"${compose[@]}" exec -T postgres pg_isready -U postgres -d shroom >/dev/null
mkdir -p /var/www/shroom/backups
umask 077
backup_file="/var/www/shroom/backups/shroom-$(date -u +%Y%m%dT%H%M%SZ)-$(cat release.sha).dump"
"${compose[@]}" exec -T postgres pg_dump -U postgres -d shroom -Fc > "$backup_file"
test -s "$backup_file"
"${compose[@]}" exec -T postgres pg_restore -l < "$backup_file" >/dev/null
echo "Database backup saved to $backup_file"

history_exists=$("${compose[@]}" exec -T postgres psql -XAt -U postgres -d shroom -c \
  "SELECT to_regclass('public.schema_migrations') IS NOT NULL")
if [[ "$history_exists" == t ]]; then
  history_state=$("${compose[@]}" exec -T postgres psql -XAt -F : -U postgres -d shroom -c \
    'SELECT version, dirty FROM public.schema_migrations')
  if [[ ! "$history_state" =~ ^(-?[0-9]+):f$ ]] || (( ${BASH_REMATCH[1]:-11} > 10 )); then
    echo "Unexpected or dirty migration history: $history_state" >&2
    exit 1
  fi
  history_version=${BASH_REMATCH[1]}
  echo "Tracked schema version: $history_state"
fi

# These additive migrations are safe to repeat. Run them in one transaction so a
# conflicting existing object or constraint leaves the old schema intact.
{
  printf 'BEGIN;\n'
  cat backend/migrations/007_expand_room_id.up.sql \
      backend/migrations/008_add_google_auth.up.sql \
      backend/migrations/009_meeting_approval.up.sql \
      backend/migrations/010_post_call_feedback.up.sql
  printf '\nCOMMIT;\n'
} | "${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d shroom

schema_state=$("${compose[@]}" exec -T postgres psql -XAt -v ON_ERROR_STOP=1 -U postgres -d shroom \
  < scripts/production-schema-check.sql)
if [[ "$schema_state" != ready ]]; then
  echo "Schema validation failed: $schema_state. Existing app remains deployed." >&2
  exit 1
fi

migrate=(docker run --rm --network shroom_default
  -v "$PWD/backend/migrations:/migrations:ro"
  migrate/migrate:v4.18.3 -path=/migrations -database "$database_url")
if [[ "$history_exists" == t ]] && (( history_version >= 6 )); then
  "${migrate[@]}" up
else
  # Only baseline after the schema check above confirms the required objects.
  # force records a version; it does not execute SQL or delete existing data.
  "${migrate[@]}" force 10
fi

"${compose[@]}" up -d --remove-orphans

for attempt in {1..30}; do
  if curl -fsS --max-time 5 http://127.0.0.1:8000/api/health/ready >/dev/null; then
    echo "Release $(cat release.sha) is ready"
    "${compose[@]}" ps
    exit 0
  fi
  sleep 2
done

echo 'Readiness check failed after deployment.' >&2
"${compose[@]}" ps
exit 1

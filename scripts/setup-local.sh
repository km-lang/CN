#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
wrangler="${project_root}/node_modules/.bin/wrangler"

if [[ ! -x "${wrangler}" ]]; then
  echo "Wrangler is unavailable. Run npm ci before npm run local:setup." >&2
  exit 69
fi

export CI=1

"${script_dir}/sites-env.sh" -- \
  "${wrangler}" d1 migrations apply DB \
  --config wrangler.local.jsonc \
  --local \
  --persist-to .wrangler/state

"${script_dir}/sites-env.sh" -- \
  "${wrangler}" d1 execute DB \
  --config wrangler.local.jsonc \
  --local \
  --persist-to .wrangler/state \
  --file scripts/local-development-fixture.sql \
  --yes

echo "Local D1 is ready with the alumnus 15 controlled-email fixture."

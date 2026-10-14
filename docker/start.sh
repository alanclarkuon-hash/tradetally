#!/bin/sh

set -eu

# An open PostgreSQL port can still reject queries during crash recovery.
# Use the application's credentials and connection configuration before migrations.
node /app/backend/src/utils/waitForDatabase.js

# Set environment variables for mobile support
export RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"

# Expose selected runtime config values to the static frontend bundle.
node <<'EOF' > /usr/share/nginx/html/runtime-config.js
const config = {
  APP_ENVIRONMENT: process.env.APP_ENVIRONMENT || '',
  VITE_POSTHOG_ENABLED: process.env.VITE_POSTHOG_ENABLED || '',
  VITE_POSTHOG_KEY: process.env.VITE_POSTHOG_KEY || '',
  VITE_POSTHOG_HOST: process.env.VITE_POSTHOG_HOST || '',
};

process.stdout.write(`window.__APP_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`);
EOF

# Ensure writable runtime directories exist for mounted volumes.
mkdir -p \
  /app/backend/uploads/trades \
  /app/backend/uploads/diary \
  /app/backend/uploads/avatars \
  /app/backend/src/data/backups \
  /app/backend/src/logs
chown -R appuser:appgroup /app/backend/uploads /app/backend/src/data /app/backend/src/logs

# Supervise both services; Docker must see backend failure to restart the app.
exec /app/supervise.sh

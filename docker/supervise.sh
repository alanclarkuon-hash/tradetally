#!/bin/sh
set -u

cd /app/backend
su-exec appuser node src/server.js &
backend_pid=$!
nginx -g "daemon off;" &
nginx_pid=$!

shutdown() {
  trap '' TERM INT
  kill -TERM "$backend_pid" "$nginx_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
  wait "$nginx_pid" 2>/dev/null || true
}
trap 'shutdown; exit 0' TERM INT

# Poll both children: ash wait -n can miss a child that exits before the wait.
# Any child exit, even code 0, is unexpected unless we received a stop signal.
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done
status=0
if ! kill -0 "$backend_pid" 2>/dev/null; then
  wait "$backend_pid" || status=$?
else
  wait "$nginx_pid" || status=$?
fi
echo "[ERROR] An application service exited; stopping container for recovery."
shutdown
if [ "$status" -eq 0 ]; then status=1; fi
exit "$status"

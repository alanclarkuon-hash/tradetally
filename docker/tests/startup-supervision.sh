#!/bin/sh
# Isolated synthetic harness: run in the built image, with no app env or volumes.
set -eu
mkdir -p /tmp/startup-test-bin
cat > /tmp/startup-test-bin/su-exec <<'STUB'
#!/bin/sh
shift
exec "$@"
STUB
cat > /tmp/startup-test-bin/node <<'STUB'
#!/bin/sh
trap 'echo stopped > /tmp/backend-stopped; exit 0' TERM INT
touch /tmp/backend-started
while [ ! -e /tmp/nginx-started ]; do sleep 0.1; done
if [ "$TEST_SERVICE_EXIT" = backend ]; then exit 7; fi
while :; do sleep 0.1; done
STUB
cat > /tmp/startup-test-bin/nginx <<'STUB'
#!/bin/sh
trap 'echo stopped > /tmp/nginx-stopped; exit 0' TERM INT
touch /tmp/nginx-started
while [ ! -e /tmp/backend-started ]; do sleep 0.1; done
if [ "$TEST_SERVICE_EXIT" = nginx ]; then exit 0; fi
while :; do sleep 0.1; done
STUB
chmod +x /tmp/startup-test-bin/*
export PATH=/tmp/startup-test-bin:$PATH
for TEST_SERVICE_EXIT in backend nginx graceful; do
  export TEST_SERVICE_EXIT
  rm -f /tmp/backend-started /tmp/nginx-started /tmp/backend-stopped /tmp/nginx-stopped
  /app/supervise.sh &
  supervisor_pid=$!
  if [ "$TEST_SERVICE_EXIT" = graceful ]; then
    while [ ! -e /tmp/backend-started ] || [ ! -e /tmp/nginx-started ]; do sleep 0.1; done
    kill -TERM "$supervisor_pid"
  fi
  status=0
  wait "$supervisor_pid" || status=$?
  case "$TEST_SERVICE_EXIT" in
    backend) test "$status" -eq 7; test -e /tmp/nginx-stopped ;;
    nginx) test "$status" -eq 1; test -e /tmp/backend-stopped ;;
    graceful) test "$status" -eq 0; test -e /tmp/backend-stopped; test -e /tmp/nginx-stopped ;;
  esac
  echo "PASS: $TEST_SERVICE_EXIT"
done

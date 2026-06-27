#!/usr/bin/env bash
HOST="$(grep -m1 nameserver /etc/resolv.conf | awk '{print $2}')"
echo "WSL gateway host: $HOST"
if timeout 3 bash -c "echo >/dev/tcp/$HOST/1433"; then
  echo "TCP 1433: reachable"
else
  echo "TCP 1433: NOT reachable (firewall or wrong host IP)"
fi

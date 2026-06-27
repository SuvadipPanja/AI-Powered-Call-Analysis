#!/usr/bin/env bash
GATEWAY="$(ip route show default | awk '{print $3}')"
NAMESERVER="$(grep -m1 nameserver /etc/resolv.conf | awk '{print $2}')"
for ip in "$GATEWAY" "$NAMESERVER"; do
  echo "Testing $ip:1434 ..."
  if timeout 3 bash -c "echo >/dev/tcp/$ip/1434" 2>/dev/null; then
    echo "TCP 1434 reachable at $ip"
    exit 0
  fi
done
echo "TCP 1434 NOT reachable from WSL"
exit 1

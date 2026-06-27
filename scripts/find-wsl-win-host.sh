#!/usr/bin/env bash
echo "resolv nameserver: $(grep -m1 nameserver /etc/resolv.conf | awk '{print $2}')"
echo "default gateway: $(ip route show default | awk '{print $3}')"
for ip in $(grep nameserver /etc/resolv.conf | awk '{print $2}') $(ip route show default | awk '{print $3}'); do
  if timeout 2 bash -c "echo >/dev/tcp/$ip/1433" 2>/dev/null; then
    echo "SQL reachable at $ip:1433"
    exit 0
  fi
done
echo "SQL not reachable on port 1433 from WSL"
exit 1

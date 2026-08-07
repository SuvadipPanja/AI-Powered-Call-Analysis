#!/usr/bin/env python3
"""GPU metrics sidecar — nvidia-smi on ALL visible GPUs + host process names.

Alpine sp_backend cannot run nvidia-smi. This CUDA sidecar exposes /gpus JSON.
Mount host /proc at /host/proc so process names resolve across containers
(nvidia-smi often returns [Not Found] for other containers' PIDs).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

PORT = int(os.environ.get("GPU_METRICS_PORT", "9101"))
SMI = os.environ.get("NVIDIA_SMI_PATH", "nvidia-smi")
HOST_PROC = os.environ.get("HOST_PROC", "/host/proc")


def _run(args: list[str]) -> str:
    out = subprocess.check_output(
        [SMI, *args],
        stderr=subprocess.STDOUT,
        timeout=8,
        text=True,
    )
    return (out or "").strip()


def _num(v: str) -> float:
    s = (v or "").strip()
    if not s or s in ("[N/A]", "N/A"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _friendly_name(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    # Prefer known service tokens
    low = text.lower()
    for token, label in (
        ("vllm", "vLLM"),
        ("enginecore", "vLLM Engine"),
        ("seamless", "SeamlessM4T"),
        ("nemo", "NeMo ASR"),
        ("whisper", "Whisper"),
        ("funasr", "FunASR"),
        ("emotion2vec", "emotion2vec"),
        ("torch", "PyTorch"),
        ("python", "Python"),
    ):
        if token in low:
            # Keep short path tail if useful
            base = os.path.basename(text.split()[0].replace("\\", "/"))
            if base and base not in ("python", "python3", "python3.10"):
                return f"{label} ({base})"
            return label
    base = os.path.basename(text.split()[0].replace("\\", "/"))
    return base or text[:48]


def resolve_process_name(pid: int, smi_name: str) -> str:
    cleaned = (smi_name or "").strip()
    if cleaned and cleaned not in ("[Not Found]", "[N/A]", "N/A", "Not Found"):
        return _friendly_name(cleaned)

    for root in (HOST_PROC, "/proc"):
        for rel in (f"{pid}/cmdline", f"{pid}/comm"):
            path = os.path.join(root, rel)
            try:
                with open(path, "rb") as fh:
                    data = fh.read()
                if not data:
                    continue
                if rel.endswith("cmdline"):
                    text = data.replace(b"\x00", b" ").decode("utf-8", "ignore").strip()
                else:
                    text = data.decode("utf-8", "ignore").strip()
                if text:
                    return _friendly_name(text)
            except OSError:
                continue
    return f"Process {pid}"


def collect() -> dict[str, Any]:
    raw = _run(
        [
            "--query-gpu=index,name,uuid,driver_version,memory.total,memory.used,memory.free,"
            "utilization.gpu,utilization.memory,temperature.gpu,power.draw,power.limit,"
            "clocks.current.graphics,clocks.current.memory",
            "--format=csv,noheader,nounits",
        ]
    )
    gpus: list[dict[str, Any]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split(",")]
        while len(parts) < 14:
            parts.append("")
        (
            index,
            name,
            uuid,
            driver,
            mem_total,
            mem_used,
            mem_free,
            util_gpu,
            util_mem,
            temp,
            power_draw,
            power_limit,
            clock_core,
            clock_mem,
        ) = parts[:14]
        gpus.append(
            {
                "id": int(_num(index)),
                "model": name or f"GPU {index}",
                "vendor": "NVIDIA",
                "uuid": uuid or None,
                "driverVersion": driver or "Unknown",
                "vram": int(_num(mem_total)),
                "vramDynamic": False,
                "memoryTotal": int(_num(mem_total)),
                "memoryUsed": int(_num(mem_used)),
                "memoryFree": int(_num(mem_free)),
                "utilizationGpu": _num(util_gpu),
                "utilizationMemory": _num(util_mem),
                "temperatureGpu": _num(temp),
                "powerDraw": _num(power_draw),
                "powerLimit": _num(power_limit),
                "clockCore": _num(clock_core),
                "clockMemory": _num(clock_mem),
                "processes": [],
                "source": "gpu-metrics-sidecar",
            }
        )

    try:
        apps = _run(
            [
                "--query-compute-apps=gpu_uuid,pid,process_name,used_gpu_memory",
                "--format=csv,noheader,nounits",
            ]
        )
        by_uuid = {g["uuid"]: g for g in gpus if g.get("uuid")}
        for line in apps.splitlines():
            if not line.strip():
                continue
            # process_name may contain commas rarely — split max 3 times from right for mem
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            uuid = parts[0]
            pid = parts[1]
            used = parts[-1]
            pname = ",".join(parts[2:-1]).strip()
            gpu = by_uuid.get(uuid)
            if not gpu:
                continue
            pid_i = int(_num(pid))
            gpu["processes"].append(
                {
                    "pid": pid_i,
                    "name": resolve_process_name(pid_i, pname),
                    "memoryUsed": int(_num(used)),
                }
            )
    except Exception:
        pass

    gpus.sort(key=lambda g: g["id"])
    return {"success": True, "count": len(gpus), "gpus": gpus}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _send(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/"):
            self._send(200, {"ok": True, "service": "gpu-metrics"})
            return
        if path != "/gpus":
            self._send(404, {"success": False, "error": "not found"})
            return
        try:
            self._send(200, collect())
        except Exception as exc:  # noqa: BLE001
            self._send(500, {"success": False, "error": str(exc)[:300], "gpus": []})


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"gpu-metrics listening on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

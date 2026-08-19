from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass

import psutil


@dataclass
class ResourceTelemetry:
    duration_seconds: float = 0.0
    peak_rss_bytes: int = 0
    cpu_seconds: float = 0.0


@contextmanager
def measure_resources(interval_seconds: float = 0.1):
    process = psutil.Process()
    telemetry = ResourceTelemetry()
    stopped = threading.Event()
    started = time.perf_counter()
    cpu_started = sum(process.cpu_times()[:2])

    def sample() -> None:
        while not stopped.wait(interval_seconds):
            rss = process.memory_info().rss
            for child in process.children(recursive=True):
                try:
                    rss += child.memory_info().rss
                except psutil.Error:
                    continue
            telemetry.peak_rss_bytes = max(telemetry.peak_rss_bytes, rss)

    thread = threading.Thread(target=sample, daemon=True)
    thread.start()
    try:
        yield telemetry
    finally:
        stopped.set()
        thread.join(timeout=2)
        telemetry.duration_seconds = time.perf_counter() - started
        telemetry.cpu_seconds = sum(process.cpu_times()[:2]) - cpu_started
        telemetry.peak_rss_bytes = max(telemetry.peak_rss_bytes, process.memory_info().rss)

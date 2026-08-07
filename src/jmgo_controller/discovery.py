from __future__ import annotations

import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor


def local_ipv4() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.connect(("192.0.2.1", 80))
        return connection.getsockname()[0]


def _has_jmgo_port(host: str, timeout: float) -> bool:
    try:
        with socket.create_connection((host, 9005), timeout=timeout):
            return True
    except OSError:
        return False


def discover(network: str | None = None, timeout: float = 0.2) -> list[str]:
    if timeout <= 0:
        raise ValueError("timeout must be positive")
    target = (
        ipaddress.ip_network(network, strict=False)
        if network
        else ipaddress.ip_network(f"{local_ipv4()}/24", strict=False)
    )
    if target.num_addresses > 4096:
        raise ValueError("refusing to scan more than 4096 addresses")
    hosts = [str(host) for host in target.hosts()]
    with ThreadPoolExecutor(max_workers=min(64, len(hosts) or 1)) as executor:
        matches = executor.map(lambda host: _has_jmgo_port(host, timeout), hosts)
        return [host for host, matched in zip(hosts, matches, strict=True) if matched]

from __future__ import annotations

import json
import socket
import time
from collections.abc import Iterator
from typing import Any

from .protocol import (
    ProtocolError,
    decode_state,
    key_packet,
    redact_state,
    sanitize_state,
    set_volume_packet,
)

DEFAULT_PORT = 9005

KEY_CODES = {
    "back": 4,
    "up": 19,
    "down": 20,
    "left": 21,
    "right": 22,
    "ok": 23,
    "volume-up": 24,
    "volume-down": 25,
    "menu": 82,
    "settings": 605,
    "home": 706,
    "power": 707,
    "power-menu": 2011,
}


class Remote:
    def __init__(self, host: str, port: int = DEFAULT_PORT, timeout: float = 3.0):
        self.host = host
        self.port = port
        self.timeout = timeout

    def _connect(self) -> socket.socket:
        return socket.create_connection((self.host, self.port), timeout=self.timeout)

    def press(self, key: str) -> None:
        try:
            keycode = KEY_CODES[key]
        except KeyError as error:
            raise ValueError(f"unknown key: {key}") from error
        with self._connect() as connection:
            connection.sendall(key_packet(keycode, True))
            time.sleep(0.12)
            connection.sendall(key_packet(keycode, False))

    def set_volume(self, volume: int) -> None:
        with self._connect() as connection:
            connection.sendall(set_volume_packet(volume))

    def read_state(self, wait: float = 1.0, include_identifiers: bool = False) -> dict[str, Any]:
        chunks: list[bytes] = []
        with self._connect() as connection:
            connection.settimeout(wait)
            while True:
                try:
                    chunk = connection.recv(65536)
                except TimeoutError:
                    break
                if not chunk:
                    break
                chunks.append(chunk)
        state = decode_state(b"".join(chunks))
        return sanitize_state(state) if include_identifiers else redact_state(state)

    def watch(self, include_identifiers: bool = False) -> Iterator[dict[str, Any]]:
        buffer = bytearray()
        with self._connect() as connection:
            connection.settimeout(None)
            while chunk := connection.recv(65536):
                buffer.extend(chunk)
                try:
                    state = decode_state(bytes(buffer))
                except ProtocolError:
                    continue
                if state:
                    yield sanitize_state(state) if include_identifiers else redact_state(state)
                    buffer.clear()

    def print_watch(self, include_identifiers: bool = False) -> None:
        for state in self.watch(include_identifiers):
            print(json.dumps(state, ensure_ascii=False, sort_keys=True), flush=True)

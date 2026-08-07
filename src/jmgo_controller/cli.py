from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import __version__
from .adb import Adb, AdbError
from .discovery import discover
from .play import PlayError, install_from_play
from .remote import KEY_CODES, Remote


def host_from(args: argparse.Namespace) -> str:
    host = args.host or os.environ.get("JMGO_HOST")
    if not host:
        raise ValueError("projector host required: pass --host or set JMGO_HOST")
    return host


def add_host(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--host", help="projector IP address (or set JMGO_HOST)")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="jmgo", description="Control a JMGO projector")
    root.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    commands = root.add_subparsers(dest="command", required=True)

    discovery = commands.add_parser("discover", help="find JMGO endpoints on the LAN")
    discovery.add_argument("--network", help="CIDR to scan; defaults to the local /24")
    discovery.add_argument("--timeout", type=float, default=0.2)

    remote = commands.add_parser("remote", help="use the native JMGO LAN protocol")
    add_host(remote)
    remote_commands = remote.add_subparsers(dest="remote_command", required=True)
    status = remote_commands.add_parser("status", help="read projector state")
    status.add_argument("--include-identifiers", action="store_true")
    key = remote_commands.add_parser("key", help="press a remote key")
    key.add_argument("key", choices=sorted(KEY_CODES))
    volume = remote_commands.add_parser("volume", help="read or change volume")
    volume.add_argument("action", nargs="?", choices=["up", "down", "set"])
    volume.add_argument("level", nargs="?", type=int)
    watch = remote_commands.add_parser("watch", help="stream projector state")
    watch.add_argument("--include-identifiers", action="store_true")

    adb = commands.add_parser("adb", help="use Android Debug Bridge")
    add_host(adb)
    adb_commands = adb.add_subparsers(dest="adb_command", required=True)
    adb_commands.add_parser("info", help="show Android device information")
    adb_commands.add_parser("current", help="show the foreground activity")
    adb_commands.add_parser("audio", help="show Android audio routing and media volume")
    packages = adb_commands.add_parser("packages", help="list installed packages")
    packages.add_argument("query", nargs="?")
    install = adb_commands.add_parser("install", help="install one APK or a split set")
    install.add_argument("files", nargs="+", type=Path)
    uninstall = adb_commands.add_parser("uninstall", help="uninstall an application")
    uninstall.add_argument("package")
    uninstall.add_argument("--keep-data", action="store_true")
    launch = adb_commands.add_parser("launch", help="launch an application")
    launch.add_argument("package")
    screenshot = adb_commands.add_parser("screenshot", help="capture the display")
    screenshot.add_argument("output", type=Path)

    play = commands.add_parser("play", help="download verified Google Play packages")
    add_host(play)
    play_commands = play.add_subparsers(dest="play_command", required=True)
    play_commands.add_parser("link", help="delegate account linking to gplaydl")
    search = play_commands.add_parser("search", help="search Google Play")
    search.add_argument("query")
    search.add_argument("--limit", type=int, default=10)
    info = play_commands.add_parser("info", help="show Play application metadata")
    info.add_argument("package")
    play_install = play_commands.add_parser("install", help="download, verify, and install")
    play_install.add_argument("package")
    play_install.add_argument("--arch", default="tv")
    play_install.add_argument("--languages")
    play_install.add_argument("--keep-downloads", type=Path)

    doctor = commands.add_parser("doctor", help="check local dependencies")
    add_host(doctor)
    return root


def make_adb(args: argparse.Namespace) -> Adb:
    return Adb(host_from(args))


def run(args: argparse.Namespace) -> int:
    if args.command == "discover":
        print("\n".join(discover(args.network, args.timeout)))
        return 0

    if args.command == "remote":
        device = Remote(host_from(args))
        if args.remote_command == "status":
            print(
                json.dumps(
                    device.read_state(include_identifiers=args.include_identifiers), indent=2
                )
            )
        elif args.remote_command == "key":
            device.press(args.key)
        elif args.remote_command == "volume":
            if args.action == "up":
                device.press("volume-up")
            elif args.action == "down":
                device.press("volume-down")
            elif args.action == "set":
                if args.level is None:
                    raise ValueError("volume set requires a level")
                device.set_volume(args.level)
            else:
                print(device.read_state().get("volume", "unknown"))
        elif args.remote_command == "watch":
            device.print_watch(args.include_identifiers)
        return 0

    if args.command == "adb":
        adb = make_adb(args)
        if args.adb_command == "info":
            print(json.dumps(adb.info(), indent=2))
        elif args.adb_command == "current":
            print(adb.current_app())
        elif args.adb_command == "audio":
            print(adb.audio())
        elif args.adb_command == "packages":
            print("\n".join(adb.packages(args.query)))
        elif args.adb_command == "install":
            print(adb.install(args.files))
        elif args.adb_command == "uninstall":
            print(adb.uninstall(args.package, args.keep_data))
        elif args.adb_command == "launch":
            print(adb.launch(args.package))
        elif args.adb_command == "screenshot":
            print(adb.screenshot(args.output))
        return 0

    if args.command == "play":
        if args.play_command == "link":
            executable = shutil.which("gplaydl")
            if not executable:
                raise PlayError("gplaydl was not found; install with: pipx install gplaydl")
            return subprocess.run([executable, "link"], check=False).returncode
        if args.play_command in {"search", "info"}:
            executable = shutil.which("gplaydl")
            if not executable:
                raise PlayError("gplaydl was not found; install with: pipx install gplaydl")
            command = [executable, args.play_command]
            command.append(args.query if args.play_command == "search" else args.package)
            if args.play_command == "search":
                command.extend(["--limit", str(args.limit)])
            return subprocess.run(command, check=False).returncode
        output, digest = install_from_play(
            make_adb(args),
            args.package,
            architecture=args.arch,
            languages=args.languages,
            keep_downloads=args.keep_downloads,
        )
        print(output)
        print(f"signer-sha256: {digest}")
        return 0

    if args.command == "doctor":
        host = host_from(args)
        checks = {
            "host": host,
            "adb": shutil.which("adb"),
            "apksigner": shutil.which("apksigner"),
            "gplaydl": shutil.which("gplaydl"),
        }
        print(json.dumps(checks, indent=2))
        return int(not all(checks.values()))

    raise ValueError("unknown command")


def main() -> None:
    try:
        raise SystemExit(run(parser().parse_args()))
    except (AdbError, OSError, PlayError, ValueError) as error:
        print(f"jmgo: {error}", file=sys.stderr)
        raise SystemExit(1) from error

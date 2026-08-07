from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .adb import Adb, AdbError


class PlayError(RuntimeError):
    pass


_DIGEST = re.compile(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F:]+)")
_PACKAGE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$")


def verify_apk_signers(files: list[Path], apksigner: str = "apksigner") -> str:
    executable = shutil.which(apksigner)
    if not executable:
        raise PlayError("apksigner is required for Play installs; install Android SDK Build Tools")
    digests: set[str] = set()
    for path in files:
        result = subprocess.run(
            [executable, "verify", "--print-certs", str(path)],
            check=False,
            text=True,
            capture_output=True,
        )
        if result.returncode:
            raise PlayError(
                f"signature verification failed for {path.name}: {result.stderr.strip()}"
            )
        match = _DIGEST.search(result.stdout)
        if not match:
            raise PlayError(f"could not read signer certificate from {path.name}")
        digests.add(match.group(1).replace(":", "").lower())
    if len(digests) != 1:
        raise PlayError("refusing installation: APK splits have different signing certificates")
    return digests.pop()


def install_from_play(
    adb: Adb,
    package: str,
    *,
    architecture: str = "tv",
    languages: str | None = None,
    keep_downloads: Path | None = None,
) -> tuple[str, str]:
    if not _PACKAGE.fullmatch(package):
        raise PlayError(f"invalid Android package name: {package}")
    downloader = shutil.which("gplaydl")
    if not downloader:
        raise PlayError("gplaydl was not found; install with: pipx install gplaydl")

    if keep_downloads:
        keep_downloads.mkdir(parents=True, exist_ok=True)
        return _download_verify_install(
            adb, downloader, package, architecture, languages, keep_downloads
        )

    with tempfile.TemporaryDirectory(prefix="jmgo-play-") as temporary:
        directory = Path(temporary)
        directory.chmod(0o700)
        return _download_verify_install(
            adb, downloader, package, architecture, languages, directory
        )


def _download_verify_install(
    adb: Adb,
    downloader: str,
    package: str,
    architecture: str,
    languages: str | None,
    directory: Path,
) -> tuple[str, str]:
    command = [
        downloader,
        "download",
        package,
        "--arch",
        architecture,
        "--output",
        str(directory),
        "--no-extras",
    ]
    if languages:
        command.extend(["--languages", languages])
    result = subprocess.run(command, check=False)
    if result.returncode:
        raise PlayError("gplaydl download failed; its credentials remain managed by gplaydl")

    files = sorted(directory.rglob(f"{package}-*.apk"))
    if not files:
        raise PlayError("gplaydl completed without producing APK files")
    digest = verify_apk_signers(files)
    try:
        output = adb.install(files)
    except AdbError as error:
        raise PlayError(str(error)) from error
    return output, digest

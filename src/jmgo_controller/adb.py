from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


class AdbError(RuntimeError):
    pass


class Adb:
    def __init__(self, host: str, port: int = 5555, executable: str = "adb"):
        self.host = host
        self.port = port
        resolved = shutil.which(executable)
        if not resolved:
            raise AdbError(
                "adb was not found; install Android Platform Tools "
                "(macOS: brew install --cask android-platform-tools)"
            )
        self.executable = resolved
        self.serial = f"{host}:{port}"

    def _run(
        self, args: list[str], *, capture: bool = True, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        command = [self.executable, "-s", self.serial, *args]
        try:
            return subprocess.run(
                command,
                check=check,
                text=True,
                capture_output=capture,
            )
        except subprocess.CalledProcessError as error:
            detail = (error.stderr or error.stdout or str(error)).strip()
            raise AdbError(detail) from error

    def connect(self) -> None:
        result = subprocess.run(
            [self.executable, "connect", self.serial],
            check=False,
            text=True,
            capture_output=True,
        )
        output = (result.stdout + result.stderr).lower()
        if result.returncode or "unable" in output or "failed" in output:
            raise AdbError(output.strip())

    def shell(self, *args: str) -> str:
        self.connect()
        return self._run(["shell", *args]).stdout.strip()

    def info(self) -> dict[str, str]:
        values = self.shell(
            "sh",
            "-c",
            "printf '%s\\n' \"$(getprop ro.product.model)\" "
            '"$(getprop ro.build.version.release)" "$(getprop ro.build.version.sdk)" '
            '"$(getprop ro.product.cpu.abilist)"',
        ).splitlines()
        values += [""] * (4 - len(values))
        return dict(zip(("model", "android", "sdk", "abis"), values, strict=True))

    def current_app(self) -> str:
        return self.shell("sh", "-c", "dumpsys activity activities | grep -m 1 mResumedActivity")

    def audio(self) -> str:
        return self.shell(
            "sh",
            "-c",
            "dumpsys audio | grep -E -m 8 'STREAM_MUSIC|Current:|Devices:'",
        )

    def packages(self, query: str | None = None) -> list[str]:
        packages = [
            line.removeprefix("package:")
            for line in self.shell("pm", "list", "packages").splitlines()
        ]
        if query:
            query = query.casefold()
            packages = [package for package in packages if query in package.casefold()]
        return sorted(packages)

    def install(self, files: list[Path], replace: bool = True) -> str:
        if not files:
            raise AdbError("at least one APK is required")
        missing = [str(path) for path in files if not path.is_file()]
        if missing:
            raise AdbError("APK not found: " + ", ".join(missing))
        self.connect()
        command = ["install-multiple" if len(files) > 1 else "install"]
        if replace:
            command.append("-r")
        command.extend(str(path.resolve()) for path in files)
        return self._run(command).stdout.strip()

    def uninstall(self, package: str, keep_data: bool = False) -> str:
        self.connect()
        command = ["uninstall"]
        if keep_data:
            command.append("-k")
        command.append(package)
        return self._run(command).stdout.strip()

    def launch(self, package: str) -> str:
        return self.shell("monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1")

    def screenshot(self, destination: Path) -> Path:
        self.connect()
        destination = destination.resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        process = subprocess.run(
            [self.executable, "-s", self.serial, "exec-out", "screencap", "-p"],
            check=False,
            capture_output=True,
        )
        if process.returncode:
            raise AdbError(process.stderr.decode(errors="replace").strip())
        destination.write_bytes(process.stdout)
        return destination

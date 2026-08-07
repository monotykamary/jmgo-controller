from pathlib import Path
from unittest.mock import Mock, patch

import pytest

from jmgo_controller.play import PlayError, verify_apk_signers


def completed(digest: str, returncode: int = 0):
    result = Mock()
    result.returncode = returncode
    result.stdout = f"Signer #1 certificate SHA-256 digest: {digest}\n"
    result.stderr = ""
    return result


@patch("jmgo_controller.play.shutil.which", return_value="/sdk/apksigner")
@patch("jmgo_controller.play.subprocess.run")
def test_verify_matching_split_signers(run, _which):
    run.side_effect = [completed("aa:bb"), completed("AABB")]
    assert verify_apk_signers([Path("base.apk"), Path("split.apk")]) == "aabb"


@patch("jmgo_controller.play.shutil.which", return_value="/sdk/apksigner")
@patch("jmgo_controller.play.subprocess.run")
def test_reject_mismatched_split_signers(run, _which):
    run.side_effect = [completed("aaaa"), completed("bbbb")]
    with pytest.raises(PlayError, match="different signing certificates"):
        verify_apk_signers([Path("base.apk"), Path("split.apk")])

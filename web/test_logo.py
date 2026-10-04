"""Logo embedding: present (PNG and SVG), missing, and oversized cases.

Each case builds into a temporary folder (CASCADE_LOGO_DIR / CASCADE_BUILD_OUT), so
web/dist and the real assets/ folder are never touched. The placeholder logos are
deleted at the end of every case, and the folder is removed afterwards.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

WEB = Path(__file__).resolve().parent
sys.path.insert(0, str(WEB))
import build  # noqa: E402


def placeholder_png() -> bytes:
    """A valid 2x2 opaque PNG, written without any imaging library."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    rows = b"".join(b"\x00" + bytes([25, 47, 123]) * 2 for _ in range(2))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def run_build(logo_dir: Path, out: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "CASCADE_LOGO_DIR": str(logo_dir), "CASCADE_BUILD_OUT": str(out), "PYTHONUTF8": "1"}
    return subprocess.run([sys.executable, str(WEB / "build.py")], env=env, capture_output=True, text=True, check=True)


def logodata(out: Path) -> object:
    html = out.read_text(encoding="utf-8")
    blocks = re.findall(r'<script type="application/json" id="logodata">(.*?)</script>', html, flags=re.DOTALL)
    assert len(blocks) == 1, "expected exactly one logodata block"
    assert len(html.encode("utf-8")) <= build.SIZE_CAP_BYTES
    return json.loads(blocks[0])


def dom(out: Path, mode: str, mime: str = "") -> None:
    subprocess.run(["node", str(WEB / "test_logo_dom.js"), str(out), mode, mime], cwd=WEB, check=True)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="cascade-logo-test-"))
    try:
        logos, out = tmp / "assets", tmp / "out.html"
        logos.mkdir()

        # 1. present: a raster placeholder named the way the README documents it
        png = logos / "Cascade Logo.png"
        png.write_bytes(placeholder_png())
        result = run_build(logos, out)
        data = logodata(out)
        assert data["mime"] == "image/png" and base64.b64decode(data["b64"]) == png.read_bytes(), "PNG not embedded verbatim"
        assert "logo: Cascade Logo.png" in result.stdout
        dom(out, "present", "image/png")

        # 2. present, vector preferred over raster, matched case-insensitively
        svg = logos / "CASCADE LOGO.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#192F7B"/></svg>', encoding="utf-8")
        run_build(logos, out)
        assert logodata(out)["mime"] == "image/svg+xml", "SVG logo not preferred"
        dom(out, "present", "image/svg+xml")
        svg.unlink()
        png.unlink()  # delete the placeholder

        # 3. missing: the build still succeeds and falls back to the text wordmark
        assert not any(logos.iterdir())
        result = run_build(logos, out)
        assert logodata(out) is None
        assert "text wordmark" in result.stderr
        dom(out, "missing")

        # 4. oversized logo: ignored with a warning, never a broken build
        big = logos / "Cascade Logo.png"
        big.write_bytes(placeholder_png() + b"\0" * (build.LOGO_MAX_BYTES + 1))
        result = run_build(logos, out)
        assert logodata(out) is None and "limit" in result.stderr
        big.unlink()

        # 5. a missing folder is the same as a missing logo
        run_build(tmp / "does-not-exist", out)
        assert logodata(out) is None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    assert not tmp.exists()
    print("logo embedding: PASS - png, svg preference, missing, oversized, missing folder")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

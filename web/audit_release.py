"""Structural and byte-level audit of the generated single-file product."""
from __future__ import annotations

import argparse
import base64
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def digest(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


def block(text: str, pattern: str, label: str) -> str:
    found = re.findall(pattern, text, flags=re.DOTALL)
    assert len(found) == 1, f"expected one {label}, found {len(found)}"
    return found[0]


def parts(html: str) -> dict[str, str]:
    plain = re.findall(r"<script>(.*?)</script>", html, flags=re.DOTALL)
    assert len(plain) == 2, "expected exactly engine and app plain scripts"
    return {
        "style": block(html, r"<style>(.*?)</style>", "style"),
        "bundle": block(html, r'<script type="application/json" id="bundle">(.*?)</script>', "bundle"),
        "engine": plain[0],
        "piddata": block(html, r'<script type="application/json" id="piddata">(.*?)</script>', "piddata"),
        "photodata": block(html, r'<script type="application/json" id="photodata">(.*?)</script>', "photodata"),
        "app": plain[1],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    target = WEB / "dist" / "cascade.html"
    html = target.read_text(encoding="utf-8")
    current = parts(html)
    sources = {
        name: (WEB / filename).read_text(encoding="utf-8")
        for name, filename in {
            "bundle": "bundle.json", "engine": "engine.js", "piddata": "piddata.json",
            "photodata": "photodata.json", "app": "app.js",
        }.items()
    }
    for name, source in sources.items():
        assert current[name] == source, f"embedded {name} is not byte-identical to source text"

    photos = json.loads(current["photodata"])
    photo_rows = []
    for name, encoded in photos.items():
        raw = base64.b64decode(encoded, validate=True)
        assert raw[:4] == b"RIFF" and raw[8:12] == b"WEBP", f"{name} is not WebP"
        with Image.open(BytesIO(raw)) as image:
            dimensions = list(image.size)
        expected = [1672, 941] if name == "hero" else [132, 99]
        assert dimensions == expected, f"{name} dimensions {dimensions}, expected {expected}"
        photo_rows.append({
            "key": name, "dimensions": dimensions, "decoded_bytes": len(raw),
            "embedded_base64_bytes": len(encoded), "sha256": sha256(raw).hexdigest(),
        })

    pids = json.loads(current["piddata"])
    pid_rows = []
    for name, encoded in pids.items():
        raw = base64.b64decode(encoded, validate=True)
        pid_rows.append({"key": name, "decoded_bytes": len(raw), "embedded_base64_bytes": len(encoded)})

    total_bytes = target.stat().st_size
    photo_embedded = sum(row["embedded_base64_bytes"] for row in photo_rows)
    pid_embedded = sum(row["embedded_base64_bytes"] for row in pid_rows)
    report = {
        "target": str(target), "html_bytes": total_bytes,
        "html_sha256": sha256(target.read_bytes()).hexdigest(),
        "engine_commit": json.loads(current["bundle"])["meta"]["engine_commit"],
        "source_hashes": {name: digest(value) for name, value in sources.items()},
        "photos": photo_rows, "pids": pid_rows,
        "size_breakdown": {
            "photo_decoded_bytes": sum(row["decoded_bytes"] for row in photo_rows),
            "photo_embedded_base64_bytes": photo_embedded,
            "pid_decoded_bytes": sum(row["decoded_bytes"] for row in pid_rows),
            "pid_embedded_base64_bytes": pid_embedded,
            "remaining_html_bytes": total_bytes - photo_embedded - pid_embedded,
            "cap_10000000_margin_bytes": 10_000_000 - total_bytes,
            "cap_10mib_margin_bytes": 10 * 1024 * 1024 - total_bytes,
        },
        "checks": {
            "source_embeddings_exact": True,
            "default_theme_light": '<html lang="en" data-theme="light">' in html,
            "photo_webp_and_dimensions": True,
        },
    }

    if args.previous:
        previous_html = args.previous.read_text(encoding="utf-8")
        old = parts(previous_html)
        theme_pattern = r"/\* ---------------------------------------------------------------- theme(.*?)\n  const tip ="
        old_theme = block(old["app"], theme_pattern, "previous theme code")
        new_theme = block(current["app"], theme_pattern, "current theme code")
        old_css = old["style"]
        new_css_without_tldr = re.sub(r"\n\.llmtldr\{.*?(?=\n\.headline)", "", current["style"], flags=re.DOTALL)
        report["preservation"] = {
            "piddata_exact": old["piddata"] == current["piddata"],
            "photodata_exact": old["photodata"] == current["photodata"],
            "existing_css_exact_after_removing_tldr_addition": old_css == new_css_without_tldr,
            "theme_code_exact": old_theme == new_theme,
            "previous_piddata_sha256": digest(old["piddata"]),
            "previous_photodata_sha256": digest(old["photodata"]),
            "previous_theme_sha256": digest(old_theme),
            "current_theme_sha256": digest(new_theme),
        }
        assert all(value is True for value in list(report["preservation"].values())[:4]), "production preservation check failed"

    output = ROOT / "out" / "release_audit.json"
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

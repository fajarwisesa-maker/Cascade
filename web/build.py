"""Assemble the reproducible single-file CASCADE product."""
from __future__ import annotations

import base64
import hashlib
import html
import io
import json
import os
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent
ROOT = WEB.parent.parent  # the folder that holds cascade/, design/ and assets/
SIZE_CAP_BYTES = 10_000_000  # hard cap for the single-file product
# Equipment photos: assets/photos/<TYPE>.<jpg|jpeg|png|webp>, one per type that typeOf() in
# app.js can return. Each is cropped to 4:3 (cover, centred), resized to 640 x 480 with
# Lanczos, kept in natural sRGB colour and embedded in photodata.json as WebP. The hero
# image is a separate payload and is never touched here.
PHOTO_TYPES = ("PUMP", "DRYER", "REACTOR", "COMPRESSOR", "HEATER", "VALVE", "FAN", "DRUM")
PHOTO_EXTS = (".jpg", ".jpeg", ".png", ".webp")
PHOTO_SIZE = (640, 480)
PHOTO_QUALITY = 82
PHOTO_MIN_WIDTH = 640
PHOTO_MAX_BYTES = 100_000
PHOTO_RECIPE = f"cover-4:3 {PHOTO_SIZE[0]}x{PHOTO_SIZE[1]} lanczos srgb webp-q{PHOTO_QUALITY}"
# Logo: assets/Cascade Logo.<svg|webp|png|jpg|jpeg>, name matched case-insensitively.
# CASCADE_LOGO_DIR overrides the folder (used by web/test_logo.py).
LOGO_STEM = "cascade logo"
LOGO_TYPES = {".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
LOGO_MAX_BYTES = 1_500_000
# Offline fonts: latin-subset WOFF2 files in web/fonts/, embedded as @font-face data URIs.
FONT_FILES = [
    ("Barlow", 400, "barlow-400-latin.woff2"), ("Barlow", 500, "barlow-500-latin.woff2"), ("Barlow", 600, "barlow-600-latin.woff2"),
    ("Barlow Condensed", 500, "barlow-condensed-500-latin.woff2"), ("Barlow Condensed", 600, "barlow-condensed-600-latin.woff2"),
    ("Barlow Condensed", 700, "barlow-condensed-700-latin.woff2"),
    ("IBM Plex Mono", 400, "ibm-plex-mono-400-latin.woff2"), ("IBM Plex Mono", 500, "ibm-plex-mono-500-latin.woff2"),
]


def font_faces() -> str:
    """@font-face rules with embedded WOFF2. A missing font file fails the build:
    falling back to system fonts silently would change the product's look."""
    rules = []
    for family, weight, name in FONT_FILES:
        raw = (WEB / "fonts" / name).read_bytes()
        assert raw[:4] == b"wOF2", f"{name} is not a WOFF2 file"
        b64 = base64.b64encode(raw).decode("ascii")
        rules.append(f'@font-face{{font-family:"{family}";font-style:normal;font-weight:{weight};font-display:swap;'
                     f'src:url(data:font/woff2;base64,{b64}) format("woff2")}}')
    return "\n".join(rules)
PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
# Keys that app.js builds dynamically ("status." + a.status, ...) and so cannot be
# found by the static scan below. Every one must exist in the English catalogue.
DYNAMIC_KEYS = (
    [f"status.{s}" for s in ("answered", "sources_only", "needs_clarification", "abstained", "refused_deviation")]
    + [f"statusx.{s}" for s in ("answered", "sources_only", "needs_clarification", "abstained", "refused_deviation")]
    + [f"srctype.{k}" for k in ("WORK_ORDER", "OPL", "INTERLOCK", "DATASHEET", "CHAIN", "PID")]
    + [f"mod.{m}" for m in ("nv", "steps", "limits", "history", "other", "evidence")]
    + [f"docs.type_{t}" for t in ("opl", "il", "ds", "pid")]
    + [f"conf.plain.{b}" for b in ("High", "Medium", "Low")]
    + [f"gloss.{g}.{f}" for g in ("failure_chain", "lesson_latency", "opl", "permissive", "moc", "interlock", "evidence_id",
                                  "verbatim", "grounding", "confidence", "abstain", "escalation", "pid") for f in ("term", "def")]
    + [f"ex.{e}" for e in ("trip", "recurring", "leaks", "safety", "design", "decline")]
    + [f"nav.{n}" for n in ("ask", "assets", "chains", "plant", "docs", "tests")]
    + [f"tests.held_{i}" for i in range(1, 6)] + [f"tests.lim_{i}" for i in range(1, 7)]
)


def check_i18n(raw: str, template: str, app: str) -> None:
    """One translations object: every UI key used must exist in English, and every
    other language may only translate keys English defines, keeping its placeholders."""
    cat = json.loads(raw)
    assert isinstance(cat, dict) and isinstance(cat.get("en"), dict), "i18n.json needs an 'en' catalogue"
    en = cat["en"]
    for lang, table in cat.items():
        assert all(isinstance(v, str) for v in table.values()), f"{lang}: every translation must be a string"
        extra = set(table) - set(en)
        assert not extra, f"{lang}: keys not in English catalogue: {sorted(extra)[:8]}"
        for key, value in table.items():
            assert set(PLACEHOLDER.findall(value)) == set(PLACEHOLDER.findall(en[key])), f"{lang}.{key}: placeholders differ from English"
    used = set(re.findall(r'data-i18n(?:-html)?="([^"]+)"', template))
    for pairs in re.findall(r'data-i18n-attr="([^"]+)"', template):
        used.update(p.split("=", 1)[1] for p in pairs.split(","))
    used.update(re.findall(r'\bT\(\s*"([^"]+)"\s*[,)]', app))
    for key in re.findall(r'\bTN\(\s*"([^"]+)"\s*[,)]', app):
        used.update({key + ".one", key + ".other"})
    used.update(DYNAMIC_KEYS)
    missing = sorted(k for k in used if k not in en)
    assert not missing, f"i18n keys missing from English catalogue: {missing[:12]}"
    # Inline English fallback text in the template must match the catalogue.
    for key, text in re.findall(r'data-i18n="([^"]+)"[^>]*>([^<]*)<', template):
        assert html.unescape(text) == en[key], f"template text for {key!r} differs from i18n.json: {text!r}"


def warn(message: str) -> None:
    print(f"warning: {message}", file=sys.stderr)


def webp_size(data: bytes) -> tuple[int, int]:
    """Pixel size from a WebP header (VP8X, VP8 or VP8L), without an imaging library."""
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP", "embedded photo is not a WebP file"
    chunk = data[12:16]
    if chunk == b"VP8X":
        return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
    if chunk == b"VP8 ":
        return int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
    if chunk == b"VP8L":
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    raise AssertionError(f"unknown WebP chunk {chunk!r}")


def find_photo(folder: Path, kind: str) -> Path | None:
    if not folder.is_dir():
        return None
    found = sorted(p for p in folder.iterdir() if p.is_file() and p.stem.upper() == kind and p.suffix.lower() in PHOTO_EXTS)
    return found[0] if found else None


def encode_photo(path: Path) -> bytes:
    """Cover-crop to 4:3, Lanczos to 640 x 480, natural sRGB colour, WebP. No tinting."""
    from PIL import Image, ImageCms, ImageOps  # imported here: only needed when re-encoding

    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        icc = image.info.get("icc_profile")
        image = image.convert("RGB")
        if icc:
            image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(icc)), ImageCms.createProfile("sRGB"), outputMode="RGB")
        image = ImageOps.fit(image, PHOTO_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        buffer = io.BytesIO()
        image.save(buffer, "WEBP", quality=PHOTO_QUALITY, method=6)
        return buffer.getvalue()


def photo_payload(folder: Path) -> str:
    """photodata.json, refreshed from the photo sources. Never raises for missing sources:
    a type without a source keeps its current image as a temporary fallback, with a warning.
    A type is re-encoded only when its source or the recipe changed (recorded in
    photosources.json), so repeated builds give byte-identical output."""
    data_file, record_file = WEB / "photodata.json", WEB / "photosources.json"
    text = data_file.read_text(encoding="utf-8")
    photos = json.loads(text)
    record = json.loads(record_file.read_text(encoding="utf-8")) if record_file.exists() else {}
    missing, stale = [], []
    for kind in PHOTO_TYPES:
        source = find_photo(folder, kind)
        if source is None:
            missing.append(kind)
            continue
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        want = {"source": source.name, "sha256": digest, "recipe": PHOTO_RECIPE}
        if record.get(kind) == want and kind in photos:
            continue
        try:
            photos[kind] = base64.b64encode(encode_photo(source)).decode("ascii")
            record[kind] = want
        except ImportError:
            stale.append(kind)
    if stale:
        warn("Pillow is not installed, so these photos were not re-encoded from their sources: " + ", ".join(stale))
    if missing:
        warn(f"no photo source in {folder} for: {', '.join(missing)} - keeping the current embedded image as a temporary fallback")
    order = ["hero"] + [k for k in photos if k != "hero"]
    new_text = json.dumps({k: photos[k] for k in order if k in photos}, separators=(",", ":"))
    for kind in PHOTO_TYPES:
        if kind not in photos:
            continue
        raw = base64.b64decode(photos[kind])
        width, _ = webp_size(raw)
        ok = width >= PHOTO_MIN_WIDTH and len(raw) < PHOTO_MAX_BYTES
        if kind in record and kind not in missing:
            assert ok, f"photo {kind} is {width} px wide and {len(raw):,} bytes; needs >= {PHOTO_MIN_WIDTH} px and < {PHOTO_MAX_BYTES:,} bytes"
        elif not ok:
            warn(f"photo {kind} is a low-quality fallback ({width} px, {len(raw):,} bytes); add assets/photos/{kind}.jpg")
    if new_text != text:
        data_file.write_text(new_text, encoding="utf-8")
    record_text = json.dumps({k: record[k] for k in PHOTO_TYPES if k in record}, indent=1) + "\n"
    if not record_file.exists() or record_file.read_text(encoding="utf-8") != record_text:
        record_file.write_text(record_text, encoding="utf-8")
    return new_text


def photo_summary(payload: str) -> str:
    photos = json.loads(payload)
    sizes = [len(base64.b64decode(photos[k])) for k in PHOTO_TYPES if k in photos]
    return f"{len(sizes)} equipment photos, {sum(sizes) / 1024:.0f} KB ({min(sizes) / 1024:.0f}-{max(sizes) / 1024:.0f} KB each)"


def find_logo(folder: Path) -> Path | None:
    """The preferred logo file in folder, or None. Vector beats raster."""
    if not folder.is_dir():
        return None
    found = [p for p in folder.iterdir() if p.is_file() and p.stem.lower() == LOGO_STEM and p.suffix.lower() in LOGO_TYPES]
    order = list(LOGO_TYPES)
    found.sort(key=lambda p: (order.index(p.suffix.lower()), p.name))
    return found[0] if found else None


def logo_payload(folder: Path) -> str:
    """JSON for the logodata block, following the photodata.json pattern:
    {"mime", "b64", "source", "bytes"} or null. Never raises: a missing,
    oversized or unreadable logo falls back to the text wordmark."""
    path = find_logo(folder)
    if path is None:
        warn(f"no logo found as '{folder / 'Cascade Logo'}.*' - using the CASCADE text wordmark")
        return "null"
    try:
        raw = path.read_bytes()
    except OSError as error:
        warn(f"logo {path.name} unreadable ({error}) - using the text wordmark")
        return "null"
    if not raw or len(raw) > LOGO_MAX_BYTES:
        warn(f"logo {path.name} is {len(raw)} bytes (limit {LOGO_MAX_BYTES}) - using the text wordmark")
        return "null"
    payload = {"mime": LOGO_TYPES[path.suffix.lower()], "b64": base64.b64encode(raw).decode("ascii"),
               "source": path.name, "bytes": len(raw)}
    return json.dumps(payload, separators=(",", ":"))


def main() -> int:
    template = (WEB / "template.html").read_text(encoding="utf-8")
    logo_dir = Path(os.environ.get("CASCADE_LOGO_DIR") or ROOT / "assets")
    parts = {
        "__BUNDLE__": (WEB / "bundle.json").read_text(encoding="utf-8"),
        "__ENGINE__": (WEB / "engine.js").read_text(encoding="utf-8"),
        "__PIDDATA__": (WEB / "piddata.json").read_text(encoding="utf-8"),
        "__PHOTODATA__": photo_payload(Path(os.environ.get("CASCADE_PHOTO_DIR") or ROOT / "assets" / "photos")),
        "__APP__": (WEB / "app.js").read_text(encoding="utf-8"),
        "__I18N__": (WEB / "i18n.json").read_text(encoding="utf-8"),
        "__LOGODATA__": logo_payload(logo_dir),
        "__FONTFACES__": font_faces(),
    }
    check_i18n(parts["__I18N__"], template, parts["__APP__"])
    for marker, body in parts.items():
        assert template.count(marker) == 1, f"expected exactly one {marker} placeholder"
        assert "</script" not in body.lower(), f"{marker} payload contains a closing script tag"

    def assemble() -> str:
        result = template
        for marker, body in parts.items():
            result = result.replace(marker, body)
        return result

    out = assemble()
    if len(out.encode("utf-8")) > SIZE_CAP_BYTES and parts["__LOGODATA__"] != "null":
        warn("the logo would push the file over the 10,000,000-byte cap - using the text wordmark")
        parts["__LOGODATA__"] = "null"
        out = assemble()
    assert not any(marker in out for marker in parts), "unexpanded build placeholder"

    def embedded(pattern: str, name: str) -> str:
        matches = re.findall(pattern, out, flags=re.DOTALL)
        assert len(matches) == 1, f"expected one embedded {name}, found {len(matches)}"
        return matches[0]

    assert embedded(r'<script type="application/json" id="bundle">(.*?)</script>', "bundle") == parts["__BUNDLE__"]
    plain = re.findall(r"<script>(.*?)</script>", out, flags=re.DOTALL)
    assert len(plain) == 2, f"expected engine and app scripts, found {len(plain)}"
    assert plain[0] == parts["__ENGINE__"], "embedded engine differs from web/engine.js"
    assert plain[1] == parts["__APP__"], "embedded app differs from web/app.js"
    assert embedded(r'<script type="application/json" id="piddata">(.*?)</script>', "piddata") == parts["__PIDDATA__"]
    assert embedded(r'<script type="application/json" id="photodata">(.*?)</script>', "photodata") == parts["__PHOTODATA__"]
    assert embedded(r'<script type="application/json" id="i18n">(.*?)</script>', "i18n") == parts["__I18N__"]
    assert embedded(r'<script type="application/json" id="logodata">(.*?)</script>', "logodata") == parts["__LOGODATA__"]
    assert "fonts.googleapis.com" not in out and "fonts.gstatic.com" not in out, "external font request found"
    assert out.count("@font-face") == len(FONT_FILES), "embedded font faces missing"
    size = len(out.encode("utf-8"))
    assert size <= SIZE_CAP_BYTES, f"single-file product is {size} bytes, over the {SIZE_CAP_BYTES}-byte cap"

    target = Path(os.environ["CASCADE_BUILD_OUT"]) if os.environ.get("CASCADE_BUILD_OUT") else WEB / "dist" / "cascade.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(out, encoding="utf-8", newline="\n")
    logo = json.loads(parts["__LOGODATA__"])
    print(f"{target.name if os.environ.get('CASCADE_BUILD_OUT') else 'dist/cascade.html'} {size / 1024:.0f} KB"
          f" (cap margin {SIZE_CAP_BYTES - size:,} bytes; logo: {logo['source'] if logo else 'text wordmark'}; {photo_summary(parts['__PHOTODATA__'])})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

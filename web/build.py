"""Assemble the single-file prototype: template + bundle + engine + app -> web/dist/cascade.html"""
from pathlib import Path

WEB = Path(__file__).resolve().parent


def main() -> int:
    t = (WEB / "template.html").read_text(encoding="utf-8")
    bundle = (WEB / "bundle.json").read_text(encoding="utf-8").replace("</", "<\\/")
    engine = (WEB / "engine.js").read_text(encoding="utf-8")
    app = (WEB / "app.js").read_text(encoding="utf-8")
    for name, body in (("engine", engine), ("app", app)):
        assert "</script" not in body.lower(), f"{name} contains a closing script tag"
    out = t.replace("__BUNDLE__", bundle).replace("__ENGINE__", engine).replace("__APP__", app)
    dist = WEB / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "cascade.html").write_text(out, encoding="utf-8")
    print(f"dist/cascade.html {len(out.encode()) / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

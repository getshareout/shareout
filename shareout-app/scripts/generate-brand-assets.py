#!/usr/bin/env python3
"""Generate trimmed, correctly sized ShareOut brand assets."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT.parent / "assets"
OUT = ROOT / "public" / "_brand"


def trim_alpha(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    bbox = rgba.getbbox()
    return rgba.crop(bbox) if bbox else rgba


def trim_white(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    px = rgba.load()
    minx, miny, maxx, maxy = rgba.width, rgba.height, -1, -1
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            if r > 245 and g > 245 and b > 245:
                continue
            minx = min(minx, x)
            miny = min(miny, y)
            maxx = max(maxx, x)
            maxy = max(maxy, y)
    if maxx < 0:
        return rgba
    return rgba.crop((minx, miny, maxx + 1, maxy + 1))


def trim_blue_mark(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    px = rgba.load()
    minx, miny, maxx, maxy = rgba.width, rgba.height, -1, -1
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            if b > 80 and b > r + 20 and b > g + 10:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if maxx < 0:
        return trim_alpha(rgba)
    return rgba.crop((minx, miny, maxx + 1, maxy + 1))


def pad_square(im: Image.Image, ratio: float = 0.05) -> Image.Image:
    w, h = im.size
    side = max(w, h)
    pad = max(1, int(side * ratio))
    canvas = side + pad * 2
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    x = (canvas - w) // 2
    y = (canvas - h) // 2
    out.paste(im, (x, y), im)
    return out


def resize(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def save_png(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = im.convert("RGBA")
    rgb.save(path, format="PNG", optimize=True)


def save_height(im: Image.Image, path: Path, height: int) -> None:
    w, h = im.size
    width = max(1, round(w * height / h))
    save_png(im.resize((width, height), Image.Resampling.LANCZOS), path)


def content_ratio(path: Path) -> tuple[int, int]:
    im = Image.open(path).convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        return 0, 0
    cw, ch = bbox[2] - bbox[0], bbox[3] - bbox[1]
    return round(cw / im.width * 100), round(ch / im.height * 100)


def main() -> None:
    favicon_src = trim_blue_mark(Image.open(ASSETS / "shareout_logo_favicon.png"))
    logo_name_src = trim_white(Image.open(ASSETS / "shareout_logo_with_name.png"))
    logo_src = trim_blue_mark(Image.open(ASSETS / "shareout_logo.png"))

    favicon_base = pad_square(favicon_src, ratio=0.05)

    for name, size in [
        ("favicon-16.png", 16),
        ("favicon-32.png", 32),
        ("apple-touch-icon.png", 180),
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("logo-mark.png", 96),
    ]:
        save_png(resize(favicon_base, size), OUT / name)

    save_height(logo_name_src, OUT / "logo-with-name.png", 64)
    save_height(logo_src, OUT / "logo-full.png", 96)

    favicon_32 = Image.open(OUT / "favicon-32.png")
    favicon_16 = Image.open(OUT / "favicon-16.png")
    favicon_32.save(OUT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])

    print(f"Wrote brand assets to {OUT}")
    for name in ["favicon-32.png", "icon-192.png", "logo-with-name.png"]:
        rx, ry = content_ratio(OUT / name)
        print(f"  {name}: content fill ~{rx}% x {ry}%")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Deterministic, static salary-and-life share assets.

Uses the already-installed Pillow, NumPy, and OpenCV packages. Nothing is fetched
from the network. The exact public landing-page URL is fixed below: no query
string, trailing slash, per-user identifier, or financial information is encoded.

Usage:
    python3 generate_share_assets.py --out-dir ./dist

Writes share-qr.png (900 × 900), share-card.png (1080 × 1440), and an independent
OpenCV decoding report. The PNGs require no runtime dependency in the website.
For pixel-identical regeneration, use the same OpenCV/Pillow versions and fonts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version


URL = "https://salary-and-life.witty-moss-2962.chatgpt.site"
TITLE = "工资与生活"
HEADLINE = ("算清时间，", "留点给生活。")
USES = ("看看真实时薪", "理清每月开支", "算算能留多少给自己")
SCAN_TEXT = "扫码，算算自己的工资与生活"
PRIVACY_TEXT = "不用填写姓名，分享不带个人账本"

PALETTE = {
    "background": "#f4eee3",
    "paper": "#fffcf6",
    "ink": "#44372e",
    "rust": "#a45032",
    "green": "#536044",
    "rule": "#ddd2c0",
    "shadow": "#e7dece",
}
DEFAULT_SERIF = "/System/Library/Fonts/Supplemental/Songti.ttc"
DEFAULT_SANS = "/System/Library/Fonts/Hiragino Sans GB.ttc"
SCALE = 3


def qr_modules() -> np.ndarray:
    """Encode with Q correction and explicitly restore a four-module quiet zone."""
    params = cv2.QRCodeEncoder_Params()
    params.correction_level = cv2.QRCodeEncoder_CORRECT_LEVEL_Q
    params.mode = cv2.QRCodeEncoder_MODE_BYTE
    raw = cv2.QRCodeEncoder_create(params).encode(URL)
    ys, xs = np.where(raw < 128)
    core = raw[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    assert core.shape == (37, 37), f"Unexpected QR version: {core.shape}"
    return np.pad(core, 4, constant_values=255)


def qr_image(modules: np.ndarray, pixels_per_module: int) -> Image.Image:
    """Integer-scale the functional QR without antialiasing or ornamentation."""
    image = Image.fromarray(modules).convert("RGB")
    return image.resize(
        (modules.shape[1] * pixels_per_module, modules.shape[0] * pixels_per_module),
        resample=Image.Resampling.NEAREST,
    )


def make_card(modules: np.ndarray, serif_path: str, sans_path: str) -> Image.Image:
    image = Image.new("RGB", (1080 * SCALE, 1440 * SCALE), PALETTE["background"])
    draw = ImageDraw.Draw(image)

    def xy(values):
        return tuple(round(value * SCALE) for value in values)

    def line(points, color="rule", width=1):
        draw.line([xy(point) for point in points], fill=PALETTE[color], width=max(1, round(width * SCALE)))

    def rect(box, radius=0, fill=None, outline=None, width=1):
        draw.rounded_rectangle(
            xy(box), radius=round(radius * SCALE),
            fill=PALETTE.get(fill, fill), outline=PALETTE.get(outline, outline),
            width=max(1, round(width * SCALE)),
        )

    def ellipse(box, fill=None, outline=None, width=1):
        draw.ellipse(xy(box), fill=PALETTE.get(fill, fill), outline=PALETTE.get(outline, outline), width=round(width * SCALE))

    def font(size, serif=False, bold=False):
        path = serif_path if serif else sans_path
        index = (0 if bold else 6) if serif else (2 if bold else 0)
        return ImageFont.truetype(path, round(size * SCALE), index=index)

    def text(value, left, top, size, color="ink", serif=False, bold=False, center=False):
        f = font(size, serif, bold)
        box = draw.textbbox((0, 0), value, font=f)
        x = left * SCALE
        if center:
            x -= (box[2] - box[0]) / 2
        draw.text((round(x - box[0]), round(top * SCALE - box[1])), value, font=f, fill=PALETTE[color])

    # Slight offset shadow and a large uninterrupted journal page.
    rect((46, 49, 1042, 1408), radius=24, fill="shadow")
    rect((38, 39, 1034, 1400), radius=24, fill="paper")

    # Masthead: a restrained journal bookmark and the exact product name.
    rect((102, 97, 109, 151), radius=3, fill="rust")
    text(TITLE, 132, 102, 45, serif=True, bold=True)
    line([(102, 193), (970, 193)], width=1.5)
    for x, h, color in [(900, 18, "rust"), (919, 31, "green"), (938, 23, "rust"), (957, 40, "green")]:
        line([(x, 143), (x, 143 - h)], color=color, width=3)

    # Chinese editorial headline, with line breaks preserving the full wording.
    text(HEADLINE[0], 103, 247, 81, serif=True, bold=True)
    text(HEADLINE[1], 103, 350, 81, color="rust", serif=True, bold=True)

    # A small sun doodle echoes the idea of time and daily life.
    cx, cy, r = 895, 293, 26
    ellipse((cx - r, cy - r, cx + r, cy + r), outline="green", width=2.4)
    for degrees in [0, 45, 90, 135, 180, 225, 270, 315]:
        a = math.radians(degrees)
        line([(cx + 35 * math.cos(a), cy + 35 * math.sin(a)),
              (cx + 45 * math.cos(a), cy + 45 * math.sin(a))], color="green", width=2.4)

    # Three simple functional icons; no amounts, examples, or user data.
    icon_x = 128
    for value, center_y in zip(USES, [514, 589, 664]):
        text(value, 176, center_y - 17, 33)
    ellipse((111, 497, 145, 531), outline="green", width=2.5)
    line([(128, 504), (128, 514), (136, 519)], color="green", width=2.5)
    rect((111, 573, 145, 607), radius=4, outline="green", width=2.5)
    for y in [583, 590, 597]:
        line([(118, y), (138, y)], color="green", width=2)
    line([(128, 680), (128, 657)], color="green", width=2.5)
    draw.polygon([xy(p) for p in [(128, 668), (115, 665), (110, 653), (122, 656)]], fill=PALETTE["green"])
    draw.polygon([xy(p) for p in [(128, 661), (142, 657), (146, 645), (133, 649)]], fill=PALETTE["green"])

    # The frame sits beyond the QR's untouched white quiet zone.
    rect((289, 734, 791, 1236), radius=18, fill="#ffffff", outline="rule", width=1.5)
    text(SCAN_TEXT, 540, 1266, 31, bold=True, center=True)
    text(PRIVACY_TEXT, 540, 1332, 25, color="green", center=True)

    # Smooth typography only; paste the QR last at an exact integer module size.
    image = image.resize((1080, 1440), Image.Resampling.LANCZOS)
    image.paste(qr_image(modules, 10), (315, 760))
    return image


def validate(path: Path, expected_size: tuple[int, int]) -> dict:
    with Image.open(path) as image:
        assert image.size == expected_size, (path, image.size)
    bgr = cv2.imread(str(path))
    decoded, points, _ = cv2.QRCodeDetector().detectAndDecode(bgr)
    assert decoded == URL, f"QR decode mismatch in {path.name}: {decoded!r}"
    scaled_checks = []
    for width in ([450, 225] if expected_size[0] == 900 else [720, 540]):
        h = round(bgr.shape[0] * width / bgr.shape[1])
        small = cv2.resize(bgr, (width, h), interpolation=cv2.INTER_AREA)
        result, _, _ = cv2.QRCodeDetector().detectAndDecode(small)
        assert result == URL, f"QR decode failed at {width}px in {path.name}"
        scaled_checks.append({"width": width, "height": h, "decoded": result})
    return {
        "file": path.name,
        "dimensions": list(expected_size),
        "decoded": decoded,
        "detected_corners": points.tolist() if points is not None else None,
        "scaled_decode_checks": scaled_checks,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--serif-font", default=DEFAULT_SERIF)
    parser.add_argument("--sans-font", default=DEFAULT_SANS)
    args = parser.parse_args()
    for path in [args.serif_font, args.sans_font]:
        if not Path(path).is_file():
            parser.error(f"Required font not found: {path}")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    modules = qr_modules()
    qr_path = args.out_dir / "share-qr.png"
    card_path = args.out_dir / "share-card.png"
    qr_image(modules, 20).save(qr_path, format="PNG", optimize=False, compress_level=9)
    make_card(modules, args.serif_font, args.sans_font).save(card_path, format="PNG", optimize=False, compress_level=9)
    report = {
        "canonical_url": URL,
        "qr_error_correction": "Q",
        "qr_core_modules": 37,
        "qr_quiet_zone_modules": 4,
        "qr_ink": "#000000",
        "qr_background": "#ffffff",
        "qr_card_module_pixels": 10,
        "qr_standalone_module_pixels": 20,
        "content": [TITLE, "".join(HEADLINE), *USES, SCAN_TEXT, PRIVACY_TEXT],
        "palette": PALETTE,
        "generator": {"opencv": cv2.__version__, "pillow": pillow_version, "numpy": np.__version__},
        "fonts": [{"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
                  for path in [args.serif_font, args.sans_font]],
        "assets": [validate(qr_path, (900, 900)), validate(card_path, (1080, 1440))],
    }
    report_path = args.out_dir / "share-assets-verification.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output_dir": str(args.out_dir.resolve()), "assets": report["assets"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

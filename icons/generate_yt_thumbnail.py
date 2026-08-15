"""
Generate a YouTube thumbnail for CourseChat demo video.
Composites the screenshot with a "1-min demo" badge and the CourseChat logo.
Output: 1280x720 (16:9) PNG.

Usage:
    pip install Pillow
    python generate_yt_thumbnail.py <screenshot_path>

If no screenshot is provided, uses a solid branded background.
"""

import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# --- Config ---
OUTPUT_PATH = Path(__file__).parent / "coursechat-thumbnail-16-9.png"
ICON_PATH = Path(__file__).parent / "icon128.png"
WIDTH, HEIGHT = 1280, 720
BG_COLOR = (15, 23, 42)  # Dark slate (matches dark mode)
ACCENT_COLOR = (26, 115, 232)  # CourseChat blue
BADGE_COLOR = (220, 38, 38)  # Red badge for "1-min demo"
BADGE_TEXT_COLOR = (255, 255, 255)
TITLE_COLOR = (255, 255, 255)
SUBTITLE_COLOR = (148, 163, 184)


def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Try to load a system font, fall back to default."""
    font_names = [
        "seguisb.ttf" if bold else "segoeui.ttf",  # Windows
        "Arial Bold.ttf" if bold else "Arial.ttf",
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",  # Linux
    ]
    for name in font_names:
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def create_thumbnail(screenshot_path: str | None = None):
    # Create base canvas
    thumb = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(thumb)

    # If screenshot provided, use it as background (fit within frame)
    if screenshot_path and Path(screenshot_path).exists():
        screenshot = Image.open(screenshot_path).convert("RGB")

        # Scale screenshot to fit with some padding for the badge area
        max_w, max_h = WIDTH - 80, HEIGHT - 120
        ratio = min(max_w / screenshot.width, max_h / screenshot.height)
        new_size = (int(screenshot.width * ratio), int(screenshot.height * ratio))
        screenshot = screenshot.resize(new_size, Image.LANCZOS)

        # Add a subtle rounded border/shadow effect
        x_offset = (WIDTH - new_size[0]) // 2
        y_offset = (HEIGHT - new_size[1]) // 2 + 10

        # Draw shadow rectangle
        shadow_rect = (x_offset - 2, y_offset - 2, x_offset + new_size[0] + 2, y_offset + new_size[1] + 2)
        draw.rectangle(shadow_rect, fill=(0, 0, 0))

        thumb.paste(screenshot, (x_offset, y_offset))

        # Darken edges for text readability
        overlay = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        # Top gradient strip
        for i in range(120):
            alpha = int(200 * (1 - i / 120))
            overlay_draw.line([(0, i), (WIDTH, i)], fill=(alpha, alpha, alpha))
        # Bottom gradient strip
        for i in range(100):
            y = HEIGHT - 100 + i
            alpha = int(180 * (i / 100))
            overlay_draw.line([(0, y), (WIDTH, y)], fill=(alpha, alpha, alpha))

        # Blend overlay
        thumb = Image.composite(
            Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0)),
            thumb,
            overlay.convert("L")
        )
        draw = ImageDraw.Draw(thumb)
    else:
        # No screenshot — draw a gradient background with accent stripe
        for y in range(HEIGHT):
            r = int(BG_COLOR[0] + (ACCENT_COLOR[0] - BG_COLOR[0]) * (y / HEIGHT) * 0.3)
            g = int(BG_COLOR[1] + (ACCENT_COLOR[1] - BG_COLOR[1]) * (y / HEIGHT) * 0.3)
            b = int(BG_COLOR[2] + (ACCENT_COLOR[2] - BG_COLOR[2]) * (y / HEIGHT) * 0.3)
            draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))

        # Draw accent bar at top
        draw.rectangle([(0, 0), (WIDTH, 6)], fill=ACCENT_COLOR)

        # Title text
        title_font = get_font(72, bold=True)
        subtitle_font = get_font(32)

        title = "CourseChat"
        draw.text((WIDTH // 2, HEIGHT // 2 - 60), title, font=title_font, fill=TITLE_COLOR, anchor="mm")

        subtitle = "AI Study Tutor for Your Course Materials"
        draw.text((WIDTH // 2, HEIGHT // 2 + 30), subtitle, font=subtitle_font, fill=SUBTITLE_COLOR, anchor="mm")

    # --- "1-min demo" badge (top-right corner) ---
    badge_font = get_font(28, bold=True)
    badge_text = "▶ 1-min demo"
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    badge_w = bbox[2] - bbox[0] + 28
    badge_h = bbox[3] - bbox[1] + 18
    badge_x = WIDTH - badge_w - 30
    badge_y = 28

    # Rounded rectangle for badge
    draw.rounded_rectangle(
        [(badge_x, badge_y), (badge_x + badge_w, badge_y + badge_h)],
        radius=8,
        fill=BADGE_COLOR,
    )
    draw.text(
        (badge_x + badge_w // 2, badge_y + badge_h // 2),
        badge_text,
        font=badge_font,
        fill=BADGE_TEXT_COLOR,
        anchor="mm",
    )

    # --- CourseChat logo (top-left) ---
    if ICON_PATH.exists():
        icon = Image.open(ICON_PATH).convert("RGBA")
        icon = icon.resize((48, 48), Image.LANCZOS)
        thumb.paste(icon, (30, 24), icon)

        # Brand name next to icon
        brand_font = get_font(30, bold=True)
        draw.text((86, 36), "CourseChat", font=brand_font, fill=TITLE_COLOR, anchor="lm")

    # Save
    thumb.save(OUTPUT_PATH, "PNG", quality=95)
    print(f"✓ Thumbnail saved: {OUTPUT_PATH}")
    print(f"  Size: {WIDTH}×{HEIGHT} (16:9)")


if __name__ == "__main__":
    screenshot = sys.argv[1] if len(sys.argv) > 1 else None
    create_thumbnail(screenshot)

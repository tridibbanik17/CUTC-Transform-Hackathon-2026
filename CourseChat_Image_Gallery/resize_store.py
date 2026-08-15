"""
Resize images for Chrome Web Store listing.
Target: 1280x800 (recommended store screenshot size).
Pads with background color — no cropping.
Output saved to 'store_screenshots/' subfolder.
"""

from pathlib import Path
from PIL import Image

INPUT_DIR = Path(__file__).parent
OUTPUT_DIR = INPUT_DIR / "store_screenshots"
TARGET_W = 1280
TARGET_H = 800


def pad_to_size(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Resize and pad image to exact target dimensions."""
    # First scale to fit within target while preserving aspect ratio
    img_ratio = img.width / img.height
    target_ratio = target_w / target_h

    if img_ratio > target_ratio:
        # Image is wider — fit by width
        new_w = target_w
        new_h = int(target_w / img_ratio)
    else:
        # Image is taller — fit by height
        new_h = target_h
        new_w = int(target_h * img_ratio)

    resized = img.resize((new_w, new_h), Image.LANCZOS)

    # Create canvas with background color from top-left pixel
    bg_color = img.getpixel((0, 0))
    if isinstance(bg_color, int):
        bg_color = (bg_color, bg_color, bg_color)
    if len(bg_color) == 4:
        canvas = Image.new("RGBA", (target_w, target_h), bg_color)
    else:
        canvas = Image.new("RGB", (target_w, target_h), bg_color)

    # Center the image
    x_offset = (target_w - new_w) // 2
    y_offset = (target_h - new_h) // 2
    canvas.paste(resized, (x_offset, y_offset))

    return canvas


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Select the best screenshots for the store listing (max 5)
    priority_images = [
        "Solving_Midterm_Questions_requiring_Math.png",
        "Indexing_Many_Files.png",
        "Answering_big_questions.png",
        "Preview_of_what_text_is_captured_from_an_uploaded_file.png",
        "Export_All_Chats.png",
    ]

    images = []
    for name in priority_images:
        path = INPUT_DIR / name
        if path.exists():
            images.append(path)

    # Fallback: if priority images missing, grab all PNGs
    if len(images) < 5:
        all_pngs = [f for f in INPUT_DIR.iterdir() if f.suffix.lower() == '.png' and f.name not in [p.name for p in images]]
        images.extend(all_pngs[:5 - len(images)])

    print(f"Resizing {len(images)} screenshots to {TARGET_W}x{TARGET_H} for Chrome Web Store")
    print(f"Output: {OUTPUT_DIR}\n")

    for img_path in images:
        img = Image.open(img_path).convert("RGB")
        resized = pad_to_size(img, TARGET_W, TARGET_H)
        out_path = OUTPUT_DIR / img_path.name
        resized.save(out_path, "PNG", quality=95)
        print(f"  {img_path.name}: {img.width}x{img.height} → {TARGET_W}x{TARGET_H}")

    print(f"\nDone! {len(images)} screenshots saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

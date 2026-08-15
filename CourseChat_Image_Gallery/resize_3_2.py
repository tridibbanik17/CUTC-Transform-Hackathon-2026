"""
Resize images in CourseChat_Image_Gallery to 3:2 aspect ratio.
Adds padding (letterboxing) instead of cropping — no content is lost.
Output saved to a '3_2' subfolder.
"""

from pathlib import Path
from PIL import Image

INPUT_DIR = Path(__file__).parent
OUTPUT_DIR = INPUT_DIR / "3_2"
TARGET_RATIO = 3 / 2  # width / height

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


def pad_to_ratio(img: Image.Image, ratio: float) -> Image.Image:
    """Pad image to target aspect ratio without cropping."""
    w, h = img.size
    current_ratio = w / h

    if abs(current_ratio - ratio) < 0.001:
        return img  # Already correct ratio

    if current_ratio < ratio:
        # Too tall — add horizontal padding
        new_w = int(h * ratio)
        new_h = h
    else:
        # Too wide — add vertical padding
        new_w = w
        new_h = int(w / ratio)

    # Detect background color: use the dominant corner color for a clean look
    # For screenshots, white or dark background works best
    # Sample top-left pixel as the padding color
    bg_color = img.getpixel((0, 0))
    if isinstance(bg_color, int):
        bg_color = (bg_color, bg_color, bg_color)
    if len(bg_color) == 4:  # RGBA
        padded = Image.new("RGBA", (new_w, new_h), bg_color)
    else:
        padded = Image.new("RGB", (new_w, new_h), bg_color)

    # Center the original image on the padded canvas
    x_offset = (new_w - w) // 2
    y_offset = (new_h - h) // 2
    padded.paste(img, (x_offset, y_offset))

    return padded


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    images = [f for f in INPUT_DIR.iterdir() if f.suffix.lower() in SUPPORTED_EXTENSIONS]

    if not images:
        print("No images found in", INPUT_DIR)
        return

    print(f"Processing {len(images)} images → 3:2 ratio (padding, no crop)")
    print(f"Output: {OUTPUT_DIR}\n")

    for img_path in sorted(images):
        img = Image.open(img_path)
        original_size = img.size
        padded = pad_to_ratio(img, TARGET_RATIO)

        # Save as PNG to preserve quality
        out_path = OUTPUT_DIR / img_path.name
        padded.save(out_path, quality=95)

        print(f"  {img_path.name}: {original_size[0]}×{original_size[1]} → {padded.size[0]}×{padded.size[1]}")

    print(f"\nDone! {len(images)} images saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

from PIL import Image, ImageDraw, ImageFont
import math

def draw_star(draw, cx, cy, r, fill):
    points = []
    for i in range(8):
        angle = i * math.pi / 4 - math.pi / 2
        # Alternate radius for star tips vs inner points
        current_r = r if i % 2 == 0 else r * 0.3
        points.append((cx + current_r * math.cos(angle), cy + current_r * math.sin(angle)))
    draw.polygon(points, fill=fill)

def round_rect(draw, xy, r, fill):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle([x1, y1, x2, y2], radius=r, fill=fill)

def generate_16_9_thumbnail(output_path="coursechat-thumbnail-16-9.png"):
    # Target 16:9 dimensions (e.g., 1280x720)
    W, H = 1280, 720
    
    # Create image with RGB mode
    img = Image.new("RGBA", (W, H), (26, 115, 232, 255))
    draw = ImageDraw.Draw(img)
    
    # 1. Gradient background simulation (Top-left #1a73e8 to Bottom-right #0d47a1)
    for x in range(W):
        for y in range(H):
            factor = (x / W + y / H) / 2
            r = int(26 * (1 - factor) + 13 * factor)
            g = int(115 * (1 - factor) + 71 * factor)
            b = int(232 * (1 - factor) + 161 * factor)
            img.putpixel((x, y), (r, g, b, 255))
            
    # Re-instantiate draw after manual pixel manipulation if needed, or use shape drawer over it
    draw = ImageDraw.Draw(img)

    # 2. Subtle decorative circles (with opacity)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    circles = [(200, 580, 150), (1060, 150, 110), (110, 100, 80)]
    for x, y, r in circles:
        overlay_draw.ellipse([x-r, y-r, x+r, y+r], fill=(255, 255, 255, 10))
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    # Load system fonts or fallbacks
    try:
        font_title = ImageFont.truetype("/System/Library/Fonts/SFPro.ttc", 110)
        font_subtitle = ImageFont.truetype("/System/Library/Fonts/SFPro.ttc", 48)
        font_footer = ImageFont.truetype("/System/Library/Fonts/SFPro.ttc", 36)
    except IOError:
        try:
            font_title = ImageFont.truetype("arialbd.ttf", 110)
            font_subtitle = ImageFont.truetype("arial.ttf", 48)
            font_footer = ImageFont.truetype("arialbd.ttf", 36)
        except IOError:
            font_title = ImageFont.load_default()
            font_subtitle = ImageFont.load_default()
            font_footer = ImageFont.load_default()

    # 3. Big title - centered horizontally
    draw.text((W / 2, 160), "CourseChat", fill="#fff", font=font_title, anchor="mm")
    
    # 4. Subtitle
    draw.text((W / 2, 260), "Your Course Notes → AI Study Tutor", fill=(255, 255, 255, 230), font=font_subtitle, anchor="mm")

    # 5. Icon row in the middle (shifted to fit 16:9 nicely)
    # Document icon base coordinates
    doc_x, doc_y, doc_w, doc_h = 440, 340, 90, 110
    round_rect(draw, (doc_x, doc_y, doc_x + doc_w, doc_y + doc_h), r=10, fill=(255, 255, 255, 230))
    
    # Document lines
    for i in range(4):
        line_y = doc_y + 30 + i * 20
        draw.line([(doc_x + 18, line_y), (doc_x + 18 + 54 - i * 9, line_y)], fill="#1a73e8", width=4)

    # Arrow pointing right
    arrow_start_x = 570
    arrow_y = 395
    draw.line([(arrow_start_x, arrow_y), (arrow_start_x + 60, arrow_y)], fill="#fbbc04", width=6)
    draw.polygon([
        (arrow_start_x + 55, arrow_y - 12),
        (arrow_start_x + 75, arrow_y),
        (arrow_start_x + 55, arrow_y + 12)
    ], fill="#fbbc04")

    # Chat bubble
    chat_x, chat_y = 680, 325
    chat_w, chat_h = 130, 90
    draw.rounded_rectangle([chat_x, chat_y, chat_x + chat_w, chat_y + chat_h], radius=25, fill="#34a853")
    # Tail of chat bubble
    draw.polygon([
        (chat_x + 30, chat_y + chat_h),
        (chat_x + 50, chat_y + chat_h + 20),
        (chat_x + 65, chat_y + chat_h)
    ], fill="#34a853")

    # Dots in chat
    dot_y = chat_y + chat_h / 2
    for idx, dot_x in enumerate([chat_x + 32, chat_x + 65, chat_x + 98]):
        draw.ellipse([dot_x - 6, dot_y - 6, dot_x + 6, dot_y + 6], fill="#fff")

    # Sparkle near chat bubble
    draw_star(draw, cx=chat_x + chat_w + 25, cy=chat_y + 15, r=18, fill="#fbbc04")

    # 6. Bottom features text
    draw.text((W / 2, 600), "Chrome Extension  •  Upload PDFs  •  Cited Answers", fill=(255, 255, 255, 190), font=font_footer, anchor="mm")

    # Save the output 16:9 thumbnail
    img.convert("RGB").save(output_path)
    print(f"16:9 thumbnail successfully saved to {output_path}")

if __name__ == "__main__":
    generate_16_9_thumbnail()
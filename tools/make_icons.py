from PIL import Image, ImageDraw, ImageFont
import os
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
out = os.path.join(os.path.dirname(__file__), '..', 'app', 'icons')
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    img = Image.new('RGB', (size, size), '#1f6feb')
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, int(size * 0.62))
    d.text((size / 2, size / 2), 'T', font=f, fill='white', anchor='mm')
    img.save(os.path.join(out, name))

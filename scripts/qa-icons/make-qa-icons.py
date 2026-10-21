# Builds QA variants of Splitty's icons: the same cat with a purple "QA" pill
# in the lower middle (inside the maskable safe zone, the central 80% circle).
import re, sys
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
PURPLE = (124, 58, 237, 255)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

for size in (192, 512):
    im = Image.open(f'{src}/cat-icon-{size}.png').convert('RGBA')
    d = ImageDraw.Draw(im)
    w, h = size * 0.46, size * 0.2
    x0, y0 = (size - w) / 2, size * 0.64
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=h / 2, fill=PURPLE, outline=(255, 255, 255, 255), width=max(2, size // 96))
    font = ImageFont.truetype(FONT, int(h * 0.62))
    d.text((size / 2, y0 + h / 2), 'QA', font=font, fill=(255, 255, 255, 255), anchor='mm')
    im.save(f'{out}/cat-icon-{size}.png', optimize=True)

svg = open(f'{src}/cat-avatar.svg').read()
badge = ('<rect x="12" y="31" width="24" height="13" rx="6.5" fill="#7C3AED" stroke="#fff" stroke-width="1.5"/>'
         '<text x="24" y="40.6" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="9" fill="#fff">QA</text>')
open(f'{out}/cat-avatar.svg', 'w').write(re.sub(r'</svg>\s*$', badge + '</svg>\n', svg))

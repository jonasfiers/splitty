#!/usr/bin/env python3
"""Make web/public/notification-badge.png: the status-bar icon for Android
notifications. Android uses only the alpha channel of a notification badge
(every visible pixel is drawn white), so this is a white cat-head silhouette
on transparency, drawn from the shapes in web/public/cat-avatar.svg (48x48
viewBox): ears and head filled, eyes cut out so it still reads as a face.
Run from the repo root: python3 scripts/make-notification-badge.py"""
from PIL import Image, ImageDraw

SIZE = 96              # Android scales it down to 24dp; 96 px covers xxxhdpi
SS = 4                 # supersample, then downscale for smooth edges
S = SIZE * SS / 48     # svg units -> pixels
# The head spans y 8..44 in the svg; shift it up so it sits centred.
DY = -2

def p(x, y):
    return (x * S, (y + DY) * S)

img = Image.new('L', (SIZE * SS, SIZE * SS), 0)
d = ImageDraw.Draw(img)
d.polygon([p(10, 18), p(14, 8), p(20, 18)], fill=255)            # ears
d.polygon([p(28, 18), p(34, 8), p(38, 18)], fill=255)
cx, cy, r = 24, 28, 16                                           # head
d.ellipse([p(cx - r, cy - r), p(cx + r, cy + r)], fill=255)
for ex in (19, 29):                                              # eyes: holes
    d.ellipse([p(ex - 2.5, 27 - 3), p(ex + 2.5, 27 + 3)], fill=0)
d.polygon([p(22.5, 32), p(25.5, 32), p(24, 33.8)], fill=0)       # nose: hole

alpha = img.resize((SIZE, SIZE), Image.LANCZOS)
out = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 0))
out.putalpha(alpha)
out.save('web/public/notification-badge.png', optimize=True)
print('wrote web/public/notification-badge.png', out.size)

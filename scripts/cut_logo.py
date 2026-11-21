"""Cut the Nile Therapy logo off its white background and export sized PNGs.
usage: python scripts/cut_logo.py brand/logo-source.png public   (needs Pillow)
"""
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')

def color_to_alpha(img):
    """White -> transparent with soft edges (like GIMP's 'color to alpha' for white)."""
    rgba = Image.new('RGBA', img.size)
    sp, dp = img.load(), rgba.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b = sp[x, y]
            d = 255 - min(r, g, b)               # how far from white
            # Anything clearly colored (even pale green/blue) is fully solid; only the
            # thin anti-aliased rim next to the white background becomes partly see-through.
            a = 0 if d < 12 else min(255, round((d - 12) * 255 / 38))
            if a == 0:
                dp[x, y] = (0, 0, 0, 0)
                continue
            f = a / 255
            un = lambda c: max(0, min(255, round((c - 255 * (1 - f)) / f)))  # remove the white mixed into edges
            dp[x, y] = (un(r), un(g), un(b), a)
    return rgba

def trim(img, pad=0):
    box = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    l, t, r, b = box
    return img.crop((max(0, l - pad), max(0, t - pad), r + pad, b + pad))

def fit(img, w=None, h=None):
    if w and not h: h = round(img.height * w / img.width)
    if h and not w: w = round(img.width * h / img.height)
    return img.resize((w, h), Image.LANCZOS)

def square(img, size, pad_ratio=0.06):
    inner = round(size * (1 - 2 * pad_ratio))
    s = fit(img, w=inner) if img.width >= img.height else fit(img, h=inner)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(s, ((size - s.width) // 2, (size - s.height) // 2), s)
    return canvas

clear = color_to_alpha(im)
full = trim(clear, pad=4)                       # mark + "Nile Therapy" wordmark
mark = trim(clear.crop((0, 0, im.width, 392)), pad=4)  # the house/figures/river mark only (wordmark starts ~y417)

fit(full, w=560).save(f'{out}/logo-full.png', optimize=True)   # login page (shown at ~280px, 2x sharp)
square(mark, 192).save(f'{out}/logo-mark.png', optimize=True)  # sidebar (shown at 40px) + apple-touch
square(mark, 64, pad_ratio=0.02).save(f'{out}/favicon.png', optimize=True)
# Home-screen app icons: the mark on a solid white square (phones fill transparent areas with black).
# 20% padding keeps it inside the "safe zone" when Android crops icons into circles.
for size in (192, 512):
    icon = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    m = square(mark, size, pad_ratio=0.2)
    icon.alpha_composite(m)
    icon.convert('RGB').save(f'{out}/icon-{size}.png', optimize=True)
print('full', full.size, 'mark', mark.size)

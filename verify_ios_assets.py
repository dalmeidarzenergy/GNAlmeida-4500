#!/usr/bin/env python3
"""Verify the generated iOS assets carry no visible logo bounding box.

Three defects were hit while building these assets; this asserts against all
three so the generator cannot silently regress:

  1. Hidden RGB under alpha=0. icons/logo.png stores cream #F6F3EE in pixels
     whose alpha is 0. `-alpha background` must see -background BEFORE it
     runs, otherwise white is substituted and shows as a box.
  2. -brightness-contrast N floods the TRANSPARENT region of the canvas
     (measured: the logo bounding rect goes from ~52% filled to ~94% filled,
     i.e. it becomes a solid grey rectangle). It is banned entirely.
  3. Palette reduction can tint the background. `-colors 128` shifts #0c0e0d
     to #0b0d0c, so exact-colour comparisons on corners are wrong; compare
     corners against each other and against the interior background instead.
"""
import subprocess, sys, pathlib

PUB = pathlib.Path('packages/web/public')
SPLASH = PUB / 'splash'


def px(path, coord):
    return subprocess.run(
        ['magick', str(path), '-format', f'%[pixel:p{{{coord}}}]', 'info:'],
        capture_output=True, text=True).stdout.strip()


def size(path):
    d = subprocess.run(['magick', 'identify', '-format', '%wx%h', str(path)],
                       capture_output=True, text=True).stdout.strip()
    return tuple(int(v) for v in d.split('x'))


fails = []

# --- 1. corners of every splash agree with each other (no gradient/tint) ---
for f in sorted(SPLASH.glob('*.png')):
    w, h = size(f)
    corners = [px(f, c) for c in ('0,0', f'{w - 1},0', f'0,{h - 1}', f'{w - 1},{h - 1}')]
    if len(set(corners)) != 1:
        fails.append(f'{f.name}: cantos diferentes {sorted(set(corners))}')

# --- 2. no box: the artwork rect must stay mostly background ---
# Sample a line across the middle of the artwork's bounding rectangle. With the
# logo's 346x198 aspect drawn at SPLASH_PCT of the width, the counters between
# glyphs are background. A flooded rect shows no background there at all.
probe = SPLASH / 'iphone-16-pro-max.png'
w, h = size(probe)
art_w = min(900, max(240, w * 46 // 100))
art_h = art_w * 198 // 346
left, top = (w - art_w) // 2, (h - art_h) // 2
bg = px(probe, '4,4')
scan = [px(probe, f'{left + dx},{top + art_h // 2}') for dx in range(0, art_w, 7)]
share_bg = scan.count(bg) / len(scan)
print(f'  {probe.name}: fundo={bg} arte={art_w}x{art_h} em ({left},{top})')
print(f'    linha central da arte: {share_bg:.0%} de fundo '
      f'({scan.count(bg)}/{len(scan)} amostras)')
if share_bg < 0.25:
    fails.append(f'{probe.name}: linha central com apenas {share_bg:.0%} de fundo '
                 f'- retangulo visivel atras do logo')

# --- 3. icons are opaque, and their corners match each other ---
for name in ('apple-touch-icon.png', 'apple-touch-icon-167.png',
             'apple-touch-icon-152.png', 'icon-192.png', 'icon-512.png',
             'icon-maskable-512.png', 'icon-1024.png'):
    f = PUB / 'icons' / name
    w, h = size(f)
    corners = [px(f, c) for c in ('0,0', f'{w - 1},0', f'0,{h - 1}', f'{w - 1},{h - 1}')]
    if len(set(corners)) != 1:
        fails.append(f'{name}: cantos diferentes {sorted(set(corners))}')
    mn = subprocess.run(['magick', str(f), '-alpha', 'extract',
                         '-format', '%[fx:minima]', 'info:'],
                        capture_output=True, text=True).stdout.strip()
    if not mn or float(mn) < 0.999:
        fails.append(f'{name}: transparencia (alfa minimo = {mn})')

# --- 4. background must still be a near-black, not a washed grey ---
for f in (probe, PUB / 'icons' / 'icon-1024.png'):
    raw = px(f, '4,4')
    nums = [int(v) for v in raw.replace('srgb(', '').replace(')', '').split(',')]
    if sum(nums) > 120:
        fails.append(f'{f.name}: fundo demasiado claro {raw} (esperado quase preto)')

if fails:
    print('\nVERIFICACAO VISUAL: FALHOU', file=sys.stderr)
    for m in fails:
        print('  ERRO: ' + m, file=sys.stderr)
    sys.exit(1)
print('\nVERIFICACAO VISUAL: OK — sem caixa visivel')

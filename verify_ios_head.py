#!/usr/bin/env python3
"""Validate the iOS PWA plumbing actually in the served HTML/manifest.

iOS/WebKit requirements this asserts:
  * viewport-fit=cover, or env(safe-area-inset-*) is always 0 and the layout
    collides with the Dynamic Island / home indicator.
  * One apple-touch-startup-image per device. The media query declares the
    CSS device width and dpr; the PNG must be css_width * dpr wide.
  * apple-mobile-web-app-capable + status-bar-style for the full-screen chrome.
  * apple-touch-icon at the sizes iOS asks for.
  * manifest display standalone (iOS uses it for the icon name and theme).
"""
import json, re, subprocess, sys

BASE = 'http://localhost:4200'
fails = []


def get(path):
    return subprocess.run(['curl', '-s', BASE + path], capture_output=True, text=True).stdout


html = get('/')
if 'viewport-fit=cover' not in html:
    fails.append('viewport sem viewport-fit=cover (safe-area-inset seria sempre 0)')

for meta in ('apple-mobile-web-app-capable',
             'apple-mobile-web-app-status-bar-style',
             'apple-mobile-web-app-title',
             'application-name'):
    if meta not in html:
        fails.append(f'meta {meta} ausente')

style = re.search(r'apple-mobile-web-app-status-bar-style"[^>]*content="([^"]+)"', html)
print(f'  status-bar-style: {style.group(1) if style else "AUSENTE"}')

# --- startup images ---
starts = re.findall(r'<link[^>]+rel="apple-touch-startup-image"[^>]*>', html)
print(f'  apple-touch-startup-image: {len(starts)} tags')
if len(starts) < 15:
    fails.append(f'apenas {len(starts)} splash definidos')

seen_media = {}
for tag in starts:
    media = re.search(r'media="([^"]+)"', tag)
    href = re.search(r'href="([^"]+)"', tag)
    if not media or not href:
        fails.append(f'tag splash sem media ou href: {tag[:80]}')
        continue
    m, h = media.group(1), href.group(1)
    if m in seen_media:
        fails.append(f'media query duplicada: {m}')
    seen_media[m] = h

    # NB: match device-width/device-height explicitly -- a bare r'width:' also
    # matches inside 'device-width:', which produced false duplicates before.
    dw = re.search(r'(?<!-)\bdevice-width:\s*(\d+)px', m)
    dh = re.search(r'(?<!-)\bdevice-height:\s*(\d+)px', m)
    dpr = re.search(r'-webkit-device-pixel-ratio:\s*(\d+)', m)
    if not (dw and dh and dpr):
        fails.append(f'media sem device-width/device-height/dpr: {m}')
        continue
    css_w, css_h, ratio = int(dw.group(1)), int(dh.group(1)), int(dpr.group(1))
    expect_w, expect_h = css_w * ratio, css_h * ratio

    # read the real file size from disk
    dims = subprocess.run(['magick', 'identify', '-format', '%wx%h',
                           'packages/web/public' + h],
                          capture_output=True, text=True).stdout.strip()
    if not dims:
        fails.append(f'{h}: ficheiro nao encontrado')
        continue
    fw, fh = (int(v) for v in dims.split('x'))
    if (fw, fh) != (expect_w, expect_h):
        fails.append(f'{h}: ficheiro {fw}x{fh}, esperado {expect_w}x{expect_h} '
                     f'(css {css_w}x{css_h} @{ratio}x)')

print(f'  {len(seen_media)} media queries unicas, todas verificadas contra o ficheiro')

# --- icons ---
icons = re.findall(r'<link[^>]+rel="apple-touch-icon"[^>]*>', html)
sizes = sorted(re.search(r'sizes="([^"]+)"', t).group(1)
               for t in icons if re.search(r'sizes="([^"]+)"', t))
print(f'  apple-touch-icon: {len(icons)} tags, sizes {sizes}')
for need in ('180x180', '167x167', '152x152'):
    if need not in sizes:
        fails.append(f'apple-touch-icon {need} ausente')

# --- manifest ---
man = json.loads(get('/manifest.json'))
print(f'  manifest: display={man.get("display")} icons={len(man.get("icons", []))} '
      f'start_url={man.get("start_url")}')
if man.get('display') != 'standalone':
    fails.append(f'manifest display={man.get("display")}, esperado standalone')
has_1024 = any(i.get('sizes') == '1024x1024' for i in man.get('icons', []))
if not has_1024:
    fails.append('manifest sem icone 1024x1024 (iOS usa-o em ecras grandes)')

# --- service worker ---
sw = get('/sw.js')
print(f'  sw.js: {len(sw)} bytes')
if not sw.strip():
    fails.append('sw.js vazio')

if fails:
    print('\nCHECAGEM iOS: FALHOU', file=sys.stderr)
    for m in fails:
        print('  ERRO: ' + m, file=sys.stderr)
    sys.exit(1)
print('\nCHECAGEM iOS: OK')

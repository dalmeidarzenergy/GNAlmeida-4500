#!/usr/bin/env bash
# Gera os assets necessários ao PWA no iOS (Apple):
#   - splash screens (apple-touch-startup-image) para os principais dispositivos
#   - ícones opacos adicionais exigidos pelo iOS
#
# Notas de execução (aprendidas ao gerar estes ficheiros):
#   * O iOS NÃO aceita SVG nem redimensiona icones/splash: cada dispositivo
#     exige um PNG com a resolução exata.
#   * icons/logo.png é RGBA TRANSPARENTE, mas os píxeis fora da arte têm cor
#     creme (#F6F3EE) com alfa=0. Ao achatar com -background, essa cor creme
#     aparece como um retângulo visível. É obrigatório limpar o RGB onde o
#     alfa é 0, senão os splash/icones ficam com uma caixa por trás.
#   * NAO clarear o logo com -brightness-contrast: o azul da marca (#1F699E)
#     e levantado para um cinza-azulado a ~58%, que se ve como um retangulo
#     cinzento por tras/entre as letras. O azul original e legivel em #0c0e0d.
#   * O ImageMagick escreve 16-bit por omissão, o que inflaciona os PNGs
#     (9,4 MB para 17 splash). Forçar 8-bit + paleta reduz para ~1 MB.
set -euo pipefail

cd "$(dirname "$0")/packages/web/public"

BG="#0c0e0d"
SPLASH_PCT=46     # largura do logo no splash, em % da largura do ecrã

mkdir -p splash icons
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

# ---------------------------------------------------------------------------
# 1. Logo preparado: alfa limpo, cor da marca intacta.
#    -alpha background substitui o RGB escondido (creme) pela cor do fundo
#    definida ANTES (ver nota acima), eliminando o retangulo.
# ---------------------------------------------------------------------------
# A ordem importa: `-alpha background` le a definicao de `-background` no
# momento em que corre. Com o -background depois, o IM substitui o RGB
# escondido pelo branco por omissao, e esse branco aparece como caixa.
magick icons/logo.png \
  -alpha background -background "$BG" \
  -alpha remove -alpha off \
  "$TMPD/logo.png"

# 8-bit + paleta: as imagens sao quase planas (fundo solido + logo).
opt() { magick "$1" -colors 128 -depth 8 -strip -define png:compression-level=9 "$2"; }

# Compoe a arte centrada sobre o fundo e devolve um PNG opaco.
compose() {
  local w=$1 h=$2 art=$3 out=$4
  magick -size "${w}x${h}" "xc:${BG}" \
    \( "$TMPD/logo.png" -resize "${art}x" \) \
    -gravity center -composite \
    -background "$BG" -alpha remove -alpha off \
    "$TMPD/flat.png"
  opt "$TMPD/flat.png" "$out"
}

# ---------------------------------------------------------------------------
# 2. Splash screens (retrato) — px do ficheiro = css * dpr
# ---------------------------------------------------------------------------
gen_splash() {
  local w=$1 h=$2 name=$3
  local lw=$(( w * SPLASH_PCT / 100 ))
  [ "$lw" -lt 240 ] && lw=240
  [ "$lw" -gt 900 ] && lw=900
  compose "$w" "$h" "$lw" "splash/${name}.png"
}

# --- iPhone ---
gen_splash 1320 2868 iphone-16-pro-max   # 440x956 @3
gen_splash 1290 2796 iphone-16-plus      # 430x932 @3
gen_splash 1206 2622 iphone-16-pro       # 402x874 @3
gen_splash 1179 2556 iphone-16           # 393x852 @3
gen_splash 1284 2778 iphone-14-plus      # 428x926 @3
gen_splash 1170 2532 iphone-14           # 390x844 @3
gen_splash 1242 2688 iphone-11-pro-max   # 414x896 @3
gen_splash 1125 2436 iphone-11-pro       # 375x812 @3
gen_splash  828 1792 iphone-11            # 414x896 @2
gen_splash 1242 2208 iphone-8-plus       # 414x736 @3
gen_splash  750 1334 iphone-se            # 375x667 @2

# --- iPad ---
gen_splash 2048 2732 ipad-pro-12          # 1024x1366 @2
gen_splash 1668 2388 ipad-pro-11          # 834x1194 @2
gen_splash 1640 2360 ipad-air-10          # 820x1180 @2
gen_splash 1620 2160 ipad-10              # 810x1080 @2
gen_splash 1536 2048 ipad-mini-79         # 768x1024 @2
gen_splash 1488 2266 ipad-mini-83         # 744x1133 @2

# ---------------------------------------------------------------------------
# 3. Icones — quadrados, opacos (o iOS aplica ele proprio a mascara)
# ---------------------------------------------------------------------------
gen_icon() { compose "$1" "$1" "$2" "$3"; }

gen_icon 180  150 "icons/apple-touch-icon.png"      # canonico iPhone
gen_icon 167  140 "icons/apple-touch-icon-167.png"  # iPad Pro
gen_icon 152  128 "icons/apple-touch-icon-152.png"  # iPad / iPad mini
gen_icon 192  160 "icons/icon-192.png"
gen_icon 512  430 "icons/icon-512.png"
gen_icon 512  360 "icons/icon-maskable-512.png"     # arte menor = zona segura
gen_icon 1024 860 "icons/icon-1024.png"             # App Store / ecras grandes

# og:image (referenciado no index.html mas inexistente).
magick -size 1200x630 "xc:${BG}" \( "$TMPD/logo.png" -resize 480x \) \
  -gravity center -composite -background "$BG" -alpha remove -alpha off "$TMPD/og.png"
opt "$TMPD/og.png" "og-image.png"

# favicon: o anterior era 32x29 em BMP.
magick \( "$TMPD/logo.png" -resize 54x \) -background "$BG" -gravity center \
  -extent 64x64 -alpha remove -alpha off "$TMPD/fav.png"
magick "$TMPD/fav.png" -define icon:auto-resize=64,48,32,16 "favicon.ico"

echo "Assets iOS gerados."
echo "  splash: $(ls -1 splash | wc -l) ficheiros, $(du -sh splash | cut -f1)"
echo "  icons:  $(ls -1 icons/*.png | wc -l) ficheiros, $(du -ch icons/*.png | tail -1 | cut -f1)"

# ---------------------------------------------------------------------------
# 4. Verificação: cada ficheiro tem de ter exatamente as dimensões esperadas.
#    (Um -resize fora de parêntesis encolhe a tela toda — já aconteceu.)
# ---------------------------------------------------------------------------
check() {
  local expect=$1 file=$2
  local got; got=$(magick identify -format '%wx%h' "$file")
  if [ "$got" != "$expect" ]; then
    echo "  ERRO: $file tem $got, esperado $expect" >&2
    return 1
  fi
}

fail=0
check 180x180 icons/apple-touch-icon.png      || fail=1
check 167x167 icons/apple-touch-icon-167.png  || fail=1
check 152x152 icons/apple-touch-icon-152.png  || fail=1
check 192x192 icons/icon-192.png              || fail=1
check 512x512 icons/icon-512.png              || fail=1
check 1024x1024 icons/icon-1024.png           || fail=1
check 1200x630 og-image.png                   || fail=1

while read -r w h name; do
  [ -z "$w" ] && continue
  check "${w}x${h}" "splash/${name}.png" || fail=1
done <<'SPLASHES'
1320 2868 iphone-16-pro-max
1290 2796 iphone-16-plus
1206 2622 iphone-16-pro
1179 2556 iphone-16
1284 2778 iphone-14-plus
1170 2532 iphone-14
1242 2688 iphone-11-pro-max
1125 2436 iphone-11-pro
828 1792 iphone-11
1242 2208 iphone-8-plus
750 1334 iphone-se
2048 2732 ipad-pro-12
1668 2388 ipad-pro-11
1640 2360 ipad-air-10
1620 2160 ipad-10
1536 2048 ipad-mini-79
1488 2266 ipad-mini-83
SPLASHES

# Nenhum asset pode ter transparencia (o iOS desenha fundo preto por baixo).
for f in icons/apple-touch-icon.png icons/icon-192.png icons/icon-512.png splash/iphone-16.png; do
  # Le-se o valor minimo do canal alfa: se existir algum pixel translucido,
  # 'minima' < 1. (O teste a -format '%A' nao serve porque, depois de reduzir
  # a paleta, o ImageMagick reporta 'Undefined' em vez de 'False'.)
  min=$(magick "$f" -alpha extract -format '%[fx:minima]' info: 2>/dev/null)
  # Comparacao com awk para nao depender do bc (nao instalado nesta imagem).
  ok=$(awk -v m="$min" 'BEGIN{ if (m == "" || m+0 < 0.999) print 0; else print 1 }')
  if [ "$ok" != "1" ]; then
    echo "  ERRO: $f tem transparencia (alfa minimo = ${min:-?})" >&2
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then echo "  verificacao: OK"; else echo "  verificacao: FALHOU" >&2; exit 1; fi

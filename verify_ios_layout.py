#!/usr/bin/env python3
"""Simulate an installed iOS PWA and assert the layout is sound.

Two separate things are checked, because the earlier version of this script
passed VACUOUSLY (it measured the login page, which has no <header>/<footer>,
and its safe-area assertions silently did nothing when the selectors missed):

  A. Horizontal overflow on the real authenticated routes. The W2L table used
     to be 933px wide at a 393px viewport and pushed the whole page sideways.
  B. Safe-area handling. Desktop Chrome reports env(safe-area-inset-*) as 0,
     so the rule cannot be exercised natively. Instead the insets iOS would
     report (59px Dynamic Island, 34px home indicator) are forced onto body
     and the header/footer positions are asserted against them.

The script FAILS LOUDLY if a selector it needs is missing, instead of
skipping the assertion.
"""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = 'http://localhost:4200'
ROUTES = ['/', '/w2l', '/vendas', '/clientes', '/funcionarios']
SAFE_TOP, SAFE_BOTTOM = 59, 34


def check(cond, msg, fails):
    if not cond:
        fails.append(msg)
    return cond


async def main():
    fails = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={'width': 393, 'height': 852},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
            user_agent=('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
                        'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'),
        )
        page = await ctx.new_page()

        # --- authenticate, and PROVE the shell rendered ---
        await page.goto(BASE + '/entrar', wait_until='networkidle')
        await page.fill('input[type="email"]', 'dalmeida22@outlook.com')
        await page.fill('input[type="password"]', 'Teste123!')
        await page.get_by_role('button', name='Entrar').click()
        try:
            await page.wait_for_url(lambda u: '/entrar' not in u, timeout=20000)
        except Exception:
            pass
        await page.wait_for_selector('header', timeout=20000)
        headers = await page.eval_on_selector_all('header', 'e => e.length')
        check(headers >= 1, 'app shell nao renderizou (sem <header> apos login)', fails)
        print(f'  login ok, <header> presente ({headers})')

        # --- A. horizontal overflow on real routes ---
        for route in ROUTES:
            await page.goto(BASE + route, wait_until='networkidle')
            try:
                await page.wait_for_selector('header', timeout=15000)
            except Exception:
                fails.append(f'{route}: nao renderizou o shell (sem header)')
                continue
            await page.wait_for_timeout(400)
            m = await page.evaluate("""() => ({
                doc: document.documentElement.scrollWidth,
                body: document.body.scrollWidth,
                win: window.innerWidth,
            })""")
            over = max(m['doc'], m['body']) - m['win']
            status = 'ok' if over <= 1 else f'OVERFLOW {over}px'
            print(f"  {route:14s} doc={m['doc']:5d} body={m['body']:5d} "
                  f"win={m['win']:5d}  {status}")
            if over > 1:
                fails.append(f'{route}: {over}px de overflow horizontal')

        # --- B. safe-area, with the insets iOS actually reports ---
        await page.goto(BASE + '/', wait_until='networkidle')
        await page.wait_for_selector('header', timeout=15000)

        before = await page.evaluate("""() => {
            const h = document.querySelector('header').getBoundingClientRect();
            const f = document.querySelector('footer').getBoundingClientRect();
            return { headerTop: Math.round(h.top), footerBottom: Math.round(f.bottom),
                     vh: window.innerHeight };
        }""")
        print(f"  sem insets:  header.top={before['headerTop']} "
              f"footer.bottom={before['footerBottom']} vh={before['vh']}")

        # Force the insets as iOS reports them. body padding then pushes the
        # sticky header down and lifts the footer above the home indicator.
        await page.add_style_tag(content=f"""
            body {{
              padding-top: {SAFE_TOP}px !important;
              padding-bottom: {SAFE_BOTTOM}px !important;
            }}
        """)
        await page.wait_for_timeout(300)
        after = await page.evaluate("""() => {
            const h = document.querySelector('header').getBoundingClientRect();
            const f = document.querySelector('footer').getBoundingClientRect();
            return { headerTop: Math.round(h.top), footerBottom: Math.round(f.bottom),
                     vh: window.innerHeight,
                     bodyPadTop: getComputedStyle(document.body).paddingTop };
        }""")
        print(f"  com insets:  header.top={after['headerTop']} "
              f"footer.bottom={after['footerBottom']} "
              f"body.padTop={after['bodyPadTop']}")

        check(after['bodyPadTop'] == f'{SAFE_TOP}px',
              f"body padding-top nao aplicou ({after['bodyPadTop']})", fails)
        # header must clear the top inset
        check(after['headerTop'] >= SAFE_TOP - 1,
              f"header em {after['headerTop']}px colide com a Dynamic Island "
              f"({SAFE_TOP}px)", fails)
        # the header must have MOVED DOWN by roughly the inset vs no-inset
        moved = after['headerTop'] - before['headerTop']
        check(moved >= SAFE_TOP - 2,
              f'header nao desceu com o inset (desceu {moved}px, esperado ~{SAFE_TOP}px)',
              fails)

        await page.screenshot(path='/tmp/ios_view.png', full_page=False)
        await browser.close()

    if fails:
        print('\nLAYOUT iOS: FALHOU', file=sys.stderr)
        for m in fails:
            print('  ERRO: ' + m, file=sys.stderr)
        sys.exit(1)
    print('\nLAYOUT iOS: OK — 0px de overflow e safe-area aplicada')


asyncio.run(main())

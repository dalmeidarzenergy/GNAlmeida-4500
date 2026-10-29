#!/usr/bin/env python3
"""Sweep every route at an iPhone viewport and report horizontal overflow.

The app is a CRM with ~21 routes; checking only a handful let two real
overflows (/ and /funcionarios) survive an earlier round of fixes.
"""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = 'http://localhost:4200'
ROUTES = ['/', '/w2l', '/vendas', '/clientes', '/funcionarios', '/equipas',
          '/notificacoes', '/relatorios', '/pagamentos', '/incentivos',
          '/iberdrola', '/medem', '/comparacao', '/comissao', '/terreno-d2d',
          '/simulador', '/perfil', '/utilizadores', '/recrutamento',
          '/campanhas', '/importar-vendas', '/completar-iban']


async def main():
    bad = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={'width': 393, 'height': 852}, device_scale_factor=3,
            is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        await page.goto(BASE + '/entrar', wait_until='networkidle')
        await page.fill('input[type="email"]', 'dalmeida22@outlook.com')
        await page.fill('input[type="password"]', 'Teste123!')
        await page.get_by_role('button', name='Entrar').click()
        await page.wait_for_selector('header', timeout=20000)
        print('  login ok')
        for r in ROUTES:
            try:
                await page.goto(BASE + r, wait_until='networkidle', timeout=25000)
                await page.wait_for_timeout(350)
                m = await page.evaluate('()=>({d:document.documentElement.scrollWidth,'
                                         'b:document.body.scrollWidth,w:window.innerWidth})')
                over = max(m['d'], m['b']) - m['w']
                if over > 1:
                    bad.append((r, over))
                    print(f'  {r:22s} OVERFLOW {over}px')
                else:
                    print(f'  {r:22s} ok')
            except Exception as e:
                bad.append((r, -1))
                print(f'  {r:22s} ERRO {str(e)[:60]}')
        await browser.close()
    if bad:
        print(f'\nSWEEP: FALHOU em {len(bad)} rota(s): {bad}', file=sys.stderr)
        sys.exit(1)
    print(f'\nSWEEP: OK — {len(ROUTES)} rotas sem overflow horizontal')


asyncio.run(main())

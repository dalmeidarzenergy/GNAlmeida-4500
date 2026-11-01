import io
p = 'public/d2d.html'
s = io.open(p, encoding='utf-8').read()
BS = chr(92)
q = BS + '"'

old = '.door{display:flex;justify-content:space-between;gap:8px;padding:10px 0;border-top:1px solid var(--bd);font-size:14px}'
assert s.count(old) == 1, ('door', s.count(old))
new = ('.door{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:10px 0;border-top:1px solid var(--bd);font-size:14px}\n'
       '.door>div:first-child{flex:1;min-width:0}\n'
       '.locb{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:none;padding:6px 10px;border:1px solid var(--ac);border-radius:8px;color:var(--ac);font-size:12px;font-weight:600;line-height:1;text-decoration:none;white-space:nowrap;background:none}\n'
       '.locb:hover{background:var(--ac);color:var(--act)}')
s = s.replace(old, new)

m1 = '&#128205; LOC</a>'
assert s.count(m1) == 2, ('m1', s.count(m1))
s = s.replace(m1, '&#128205;&nbsp;LOC</a><span style=' + q + 'flex:none;width:6px' + q + '></span>')

m2 = '>">Waze</a>'
assert s.count(m2) == 2, ('m2', s.count(m2))
s = s.replace(m2, '>">Waze</a><span style=' + q + 'flex:none;width:6px' + q + '></span>')

io.open(p, 'w', encoding='utf-8').write(s)
print('ok', len(s))

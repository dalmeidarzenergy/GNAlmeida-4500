"""Build the offline territory report snapshot; see README for input queries."""
import argparse
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely import from_wkb, make_valid
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree


def read(path):
    return json.loads(path.read_text())


def attributes(path):
    return [f['attributes'] for f in read(path)['features']]


def polygons(geometry):
    if geometry.geom_type == 'Polygon':
        return [geometry] if not geometry.is_empty else []
    return [p for part in getattr(geometry, 'geoms', ()) for p in polygons(part)]


def esri_polygon(rings):
    shells, holes = [], []
    for coords in rings:
        if len(coords) < 4:
            continue
        ring = Polygon(coords)
        (holes if ring.exterior.is_ccw else shells).append(ring)
    grouped = [[] for _ in shells]
    for hole in holes:
        owners = [i for i, s in enumerate(shells) if s.covers(hole.representative_point())]
        if owners:
            grouped[min(owners, key=lambda i: shells[i].area)].append(hole.exterior.coords)
    return unary_union([make_valid(Polygon(s.exterior.coords, h)) for s, h in zip(shells, grouped)])


def build(gpkg, data, output):
    base = output.parent
    road = {r[0]: r for r in read(base / 'territory-road-distances.json')['rows']}
    census = {}
    for r in attributes(data / 'age.json'):
        row = [int(r['A'] + r['B']), int(r['C']), int(r['D'])]
        assert sum(row) == int(r['TOTAL'])
        census[r['DTMNFR21']] = row
    assert len(census) == 3092 and sum(map(sum, census.values())) == 10343066
    previous = {f['attributes']['DTMNFR20']: esri_polygon(f['geometry']['rings'])
                for f in read(data / 'old-geometry.json')['features']}
    assert previous.keys() == census.keys(), 'Missing Censos boundaries'
    census_rows = defaultdict(list)
    for r in sorted(attributes(data / "census-names.json"), key=lambda r: r["DTMNFR20"]):
        code = r["DTMNFR20"]
        census_rows[code[:4]].append([r["FREGUESIA"].strip(), census[code]])
    assert sum(map(len, census_rows.values())) == len(census)
    municipalities = defaultdict(list)
    spatial = []
    for path in sorted(gpkg.glob('*_CAOP2025.gpkg')):
        with sqlite3.connect(path) as db:
            table, epsg = db.execute("select table_name, srs_id from gpkg_geometry_columns where table_name like '%_freguesias'").fetchone()
            to_geo = Transformer.from_crs(epsg, 4326, always_xy=True).transform
            from_geo = Transformer.from_crs(4326, epsg, always_xy=True).transform
            for code, official, short, district, nuts1, nuts2, nuts3, blob in db.execute(f'select dtmnfr,freguesia,designacao_simplificada,distrito_ilha,nuts1,nuts2,nuts3,geom from "{table}"'):
                start = 8 + (0, 32, 48, 48, 64)[(blob[3] >> 1) & 7]
                current = make_valid(from_wkb(blob[start:]))
                comparable = False
                if code in previous:
                    old = make_valid(transform(from_geo, previous[code]))
                    comparable = current.symmetric_difference(old).area / current.union(old).area <= 0.03
                municipalities[code[:4]].append((code, official, short, [district, nuts1, nuts2, nuts3], current, comparable))
                spatial.append((code, transform(to_geo, current)))
    assert {r[0] for r in spatial} == road.keys() and len(municipalities) == 308
    spatial.sort(key=lambda r: r[0]); tree = STRtree([g for _, g in spatial])
    places = defaultdict(set)
    for f in read(data / 'places.json')['features']:
        if not f.get('centroid'):
            continue
        p = Point(f['centroid']['x'], f['centroid']['y'])
        hits = tree.query(p, predicate='covered_by')
        if len(hits) == 1:
            places[spatial[hits[0]][0]].add(f['attributes']['LUG21DESIG'].strip())
    result = {}
    for city, rows in sorted(municipalities.items()):
        bounds = [r[4].bounds for r in rows]
        x = min(b[0] for b in bounds); y = max(b[3] for b in bounds)
        extent = max(max(b[2] for b in bounds)-x, y-min(b[1] for b in bounds))
        def point(a, b):
            return [round((a-x)*1000/extent), round((y-b)*1000/extent)]
        entries = []
        for code, official, short, _, g, comparable in sorted(rows):
            p = max(polygons(g), key=lambda s: s.area).representative_point()
            rings = []
            for poly in polygons(g.simplify(extent / 750, preserve_topology=True)):
                if poly.area < extent**2 / 350000:
                    continue
                poly = orient(poly)
                for ring in (poly.exterior, *poly.interiors):
                    coords = list(dict.fromkeys(tuple(point(*c[:2])) for c in ring.coords))
                    if len(coords) >= 3:
                        rings.append([n for pair in coords for n in pair])
            entries.append([code, official, short or '', road[code][5], census[code] if comparable else None,
                            sorted(places[code] - {''}), point(p.x, p.y), rings])
        result[city] = [rows[0][3], entries, census_rows[city]]
    entries = (json.dumps(k) + ':' + json.dumps(v, ensure_ascii=False, separators=(',', ':')) for k, v in result.items())
    output.write_text('{\n' + ',\n'.join(entries) + '\n}\n')
    print(len(result), 'concelhos;', sum(len(m[1]) for m in result.values()), 'freguesias;',
          sum(r[4] is not None for m in result.values() for r in m[1]), 'comparáveis;',
          sum(len(r[5]) for m in result.values() for r in m[1]), 'localidades')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['gpkg', 'data', 'output']:
        parser.add_argument(key, type=Path)
    args = parser.parse_args()
    build(args.gpkg, args.data, args.output)

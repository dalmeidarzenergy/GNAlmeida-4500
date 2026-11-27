#!/usr/bin/env python3
"""Route from Póvoa de Santarém to the OSM administrative centre of each CAOP municipality."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import sqlite3
from urllib.error import HTTPError
from urllib.request import urlopen

from pyproj import Transformer
from shapely import from_wkb
from shapely.geometry import Point

ORIGIN = (-8.6863707, 39.311262)


def municipalities(files):
    for file in files:
        with sqlite3.connect(file) as db:
            table, crs = db.execute("select table_name,srs_id from gpkg_geometry_columns where lower(table_name) like '%_municipios'").fetchone()
            if not re.fullmatch(r"[a-z_]+", table):
                raise ValueError(table)
            project = Transformer.from_crs(4326, crs, always_xy=True).transform
            for code, district, name, blob in db.execute(f"select dtmn,distrito_ilha,municipio,geom from {table}"):
                start = 8 + (0, 32, 48, 48, 64)[(blob[3] >> 1) & 7]
                yield code, district, name, from_wkb(blob[start:]), project


def run(args):
    relations = {}
    for line in args.relations.read_text().splitlines():
        if not line.startswith('r') or 'border_type=município,' not in line:
            continue
        code = re.search(r'(?:,| T)ref:ine=(\d{4})(?:,| |;)', line)
        node = re.findall(r'(?: M|,)(n\d+)@admin_centre(?:,|$)', line)
        if not code or len(node) != 1 or code[1] in relations:
            raise ValueError(f'Invalid municipality relation {line.split()[0]}')
        relations[code[1]] = node[0]
    nodes = {}
    for line in args.nodes.read_text().splitlines():
        m = re.search(r' x(-?[\d.]+) y(-?[\d.]+)$', line)
        nodes[line.split()[0]] = float(m[1]), float(m[2])

    def route(row):
        code, district, name, geom, project = row
        lon, lat = nodes[relations[code]]
        if not geom.covers(Point(project(lon, lat))):
            raise ValueError(f'Seat outside CAOP boundaries: {code} {name}')
        distance = None
        if int(code[:2]) < 30:
            base = args.north if lat >= 39.65 else args.south
            try:
                with urlopen(f'http://127.0.0.1:{base}/route/v1/driving/{ORIGIN[0]},{ORIGIN[1]};{lon},{lat}?overview=false&exclude=ferry', timeout=30) as response:
                    result = json.load(response)
            except HTTPError as exc:
                result = json.load(exc)
            if result['code'] == 'Ok':
                if result['waypoints'][0]['distance'] > 100 or result['waypoints'][1]['distance'] > 500:
                    raise ValueError(f'Could not snap seat to road: {code} {name}: {result["waypoints"]}')
                distance = round(result['routes'][0]['distance'])
            elif result['code'] != 'NoRoute':
                raise ValueError(f'{code} {name}: {result}')
        return [code, district, name, distance]

    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = sorted(pool.map(route, sorted(municipalities(args.gpkg), key=lambda row: row[0])))
    if len({row[0] for row in rows}) != 308 or sum(row[-1] is not None for row in rows) < 275:
        raise ValueError('Incomplete municipality catalogue')
    metadata = dict(caop='2025', osmSnapshot=args.osm_snapshot, router=args.router_version,
                    origin='Rua do Mato, 1, 2000-531 Póvoa de Santarém',
                    columns=['dtmn', 'districtOrIsland', 'municipality', 'distanceMeters'])
    args.output.write_text(json.dumps(metadata, ensure_ascii=False, indent=2)[:-2] + ',\n  "rows": [\n' + ',\n'.join('    ' + json.dumps(row, ensure_ascii=False) for row in rows) + '\n  ]\n}\n')
    print(len(rows), 'municipalities;', sum(row[-1] is not None for row in rows), 'routes')
    print('Continental without road route:', [row for row in rows if int(row[0][:2]) < 30 and row[-1] is None])


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('gpkg', nargs='+', type=Path)
    p.add_argument('--relations', required=True, type=Path)
    p.add_argument('--nodes', required=True, type=Path)
    p.add_argument('--osm-snapshot', required=True)
    p.add_argument('--router-version', default='v26.11.0')
    p.add_argument('--south', type=int, default=4293)
    p.add_argument('--north', type=int, default=4294)
    p.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[2] / 'src/api/data/territory-municipality-distances.json')
    run(p.parse_args())

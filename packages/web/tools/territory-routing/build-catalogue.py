#!/usr/bin/env python3
"""Build the CRM's derived parish distance catalogue using a local OSRM server."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import sqlite3
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen

from pyproj import Transformer
from shapely import from_wkb
from shapely.geometry import Point

ORIGIN = (-8.6863707, 39.311262)
APP_ROOT = Path(__file__).resolve().parents[2]

def features(files):
    for file in files:
        with sqlite3.connect(file) as db:
            table, crs = db.execute("select table_name,srs_id from gpkg_geometry_columns where lower(table_name) like '%_freguesias'").fetchone()
            if not re.fullmatch(r"[a-z_]+", table):
                raise ValueError(f"Nome inesperado em {file}: {table}")
            transform = Transformer.from_crs(crs, 4326, always_xy=True)
            inverse = Transformer.from_crs(4326, crs, always_xy=True)
            sql = f"select dtmnfr,distrito_ilha,municipio,freguesia,designacao_simplificada,geom from {table} order by dtmnfr"
            for code, district, municipality, parish, short, blob in db.execute(sql):
                # GeoPackage: cabeçalho fixo + envelope opcional, seguido de WKB.
                start = 8 + (0, 32, 48, 48, 64)[(blob[3] >> 1) & 7]
                geom = None if code.startswith(("3", "4")) else from_wkb(blob[start:])
                yield [code, district, municipality, parish, short or parish], geom, transform, inverse

def coordinate(point):
    return ",".join(f"{v:.7f}" for v in point)

def calculate(data, base_url):
    endpoint = urlsplit(base_url)
    if endpoint.scheme != 'http' or endpoint.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise ValueError('Serve o grafo OSRM localmente; não uses um servidor público para gerar o catálogo.')

    def osrm(action, coordinates, **params):
        url = f"{base_url.rstrip('/')}/{action}/v1/driving/{coordinates}?{urlencode(params, safe=';')}"
        try:
            with urlopen(url, timeout=120) as r:
                result = json.load(r)
        except HTTPError as error:
            raise RuntimeError(f"OSRM {action}: {error.read().decode(errors='replace')}") from error
        if result.get("code") != "Ok":
            raise RuntimeError(result)
        return result

    def destination(feature, fallback=False):
        _, geom, forward, inverse = feature
        if geom is None:
            return []
        polygons = sorted(geom.geoms, key=lambda part: part.area, reverse=True) if geom.geom_type == "MultiPolygon" else [geom]
        result = {}
        for polygon in polygons if fallback else polygons[:3]:
            preferred = polygon.centroid
            representative = polygon.representative_point()
            probes = [preferred, representative] if polygon.covers(preferred) else [representative]
            if fallback:
                # Um centroide sobre água ou num enclave pode não ter ligação rodoviária.
                left, bottom, right, top = polygon.bounds
                grid = [Point(left + (right-left)*i/8, bottom + (top-bottom)*j/8) for i in range(1, 8) for j in range(1, 8)]
                probes.extend(sorted((p for p in grid if polygon.covers(p)), key=preferred.distance))
            for probe in probes:
                coords = coordinate(forward.transform(probe.x, probe.y))
                nearest = osrm("nearest", coords, number=10, exclude="ferry")
                for point in nearest["waypoints"]:
                    if geom.covers(Point(inverse.transform(*point["location"]))):
                        result.setdefault(point["hint"], (point["hint"], point["location"]))
                if not fallback and len(result) >= 5:
                    break
            if not fallback and len(result) >= 5:
                break
        return list(result.values()) if fallback else list(result.values())[:10]

    def distances(batch):
        coords = [coordinate(origin["location"]), *(coordinate(location) for _, location in batch)]
        hints = [origin["hint"], *(hint for hint, _ in batch)]
        response = osrm("table", ';'.join(coords), sources="0", destinations=';'.join(str(i) for i in range(1, len(coords))), hints=';'.join(hints), annotations="distance", exclude="ferry")
        return response["distances"][0]

    origin = osrm("nearest", coordinate(ORIGIN), number=1, exclude="ferry")["waypoints"][0]
    if origin["distance"] > 100:
        raise RuntimeError(f"A morada não encaixa na rede viária: {origin}")
    print(f"{len(data)} destinos; origem ajustada em {origin['distance']:.1f} m ({origin['name']}).", flush=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        candidates = list(pool.map(destination, data))
    results = [None] * len(data)
    for attempt in range(max(map(len, candidates), default=0)):
        targets = [(i, c[attempt]) for i, c in enumerate(candidates) if len(c) > attempt and results[i] is None]
        for start in range(0, len(targets), 40):
            batch = targets[start:start + 40]
            for (idx, _), distance in zip(batch, distances([point for _, point in batch]), strict=True):
                if distance is not None:
                    results[idx] = round(distance)
    for i, feature in enumerate(data):
        if results[i] is not None:
            continue
        seen = {hint for hint, _ in candidates[i]}
        extra = [point for point in destination(feature, fallback=True) if point[0] not in seen]
        for start in range(0, len(extra), 40):
            distance = next((d for d in distances(extra[start:start + 40]) if d is not None), None)
            if distance is not None:
                results[i] = round(distance)
                break
    return [row + [meters] for (row, *_), meters in zip(data, results, strict=True)]

def run(args):
    data = list(features(args.gpkg))
    if len(data) < 3200 or len({f[0][0] for f in data}) != len(data):
        raise RuntimeError(f"A CAOP deve incluir as freguesias únicas das três regiões; recebidas: {len(data)}.")
    mainland_data = [feature for feature in data if feature[1] is not None]
    if args.north_osrm:
        def northern(feature):
            _, shape, transform, _ = feature
            center = shape.representative_point()
            return transform.transform(center.x, center.y)[1] >= 39.65
        south, north = [], []
        for feature in mainland_data:
            (north if northern(feature) else south).append(feature)
        rows = calculate(south, args.osrm) + calculate(north, args.north_osrm)
    else:
        rows = calculate(mainland_data, args.osrm)
    rows.extend(row + [None] for row, geom, *_ in data if geom is None)
    rows.sort(key=lambda row: row[0])
    routed = sum(row[-1] is not None for row in rows)
    mainland = len(mainland_data)
    if routed / mainland < .99:
        missing = [row[:5] for row in rows if int(row[0][:2]) < 30 and row[-1] is None]
        print(f"Verifica destinos sem rota: {missing}", file=sys.stderr)
        raise RuntimeError(f"Cobertura inesperada: {routed}/{mainland}")
    metadata = {
        "origin": {"address": "Rua do Mato, 1, 2000-531 Póvoa de Santarém", "lon": ORIGIN[0], "lat": ORIGIN[1]},
        "caop": "2025",
        "osmSnapshot": args.osm_snapshot,
        "router": args.router_version,
        "graph": "overlapping-south-north" if args.north_osrm else "national",
        "columns": ["dtmnfr", "districtOrIsland", "municipality", "parish", "shortName", "distanceMeters"],
    }
    partial = json.dumps(metadata, ensure_ascii=False, indent=2).rstrip()[:-2]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(partial + ',\n  "rows": [\n' + ',\n'.join('    ' + json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows) + '\n  ]\n}\n')
    print(f"{len(rows)} freguesias; {routed}/{mainland} de Portugal continental com rota.")
    print("Freguesias continentais sem rota:", [row[:5] for row in rows if int(row[0][:2]) < 30 and row[-1] is None])

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gpkg", type=Path, nargs="+")
    parser.add_argument("--osm-snapshot", required=True, help="Versão do extrato Geofabrik Portugal (AAAA-MM-DD).")
    parser.add_argument("--router-version", required=True, help="Versão do OSRM.")
    parser.add_argument("--osrm", default="http://127.0.0.1:5000")
    parser.add_argument("--north-osrm", help="Servidor opcional para destinos a norte de 39,65°N quando o grafo é dividido em dois.")
    parser.add_argument("--output", type=Path, default=APP_ROOT / "src/api/data/territory-road-distances.json")
    run(parser.parse_args())

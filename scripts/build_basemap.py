"""Fond de carte embarqué de toute la France (Natural Earth 1:10m, domaine public).
Entrée : fichiers GeoJSON de Natural Earth (dossier passé en argument).
Sortie : basemap.js (GEO = trait de côte projeté en Web Mercator, BASEMAP = routes, rail, villes, rivières, lacs, PLACES_ALL = noms).
Les tracés RAILS (trajets en train des fiches soignées) et les noms déjà présents sont conservés.
"""
import json, math, re, sys, subprocess
from shapely.geometry import shape, box, mapping, LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection
from shapely.ops import unary_union

SRC = sys.argv[1]
S, W, N, E = 41.0, -5.9, 51.6, 10.0          # France métropolitaine + Corse et marges
BB = box(W, S, E, N)

def load(name): return json.load(open(f"{SRC}/{name}.geojson"))["features"]
def my(lat): return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
WIDTH = 1000.0
HEIGHT = round((my(N) - my(S)) / math.radians(E - W) * WIDTH, 1)
def px(lon, lat): return ((lon - W) / (E - W) * WIDTH, (my(N) - my(lat)) / (my(N) - my(S)) * HEIGHT)

def parts(g, kind):
    if g.is_empty: return []
    if isinstance(g, (GeometryCollection, MultiLineString, MultiPolygon)): return [p for x in g.geoms for p in parts(x, kind)]
    return [g] if isinstance(g, kind) else []

# 1. Terre : path SVG
land = unary_union([shape(f["geometry"]).intersection(BB) for f in load("ne_10m_land") if shape(f["geometry"]).intersects(BB)])
land = land.simplify(0.004, preserve_topology=True)
def ring(coords):
    pts = [px(x, y) for x, y in coords]
    return "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z"
d = "".join(ring(p.exterior.coords) + "".join(ring(i.coords) for i in p.interiors) for p in parts(land, Polygon) if p.area > 0.0004)

r3 = lambda c: [round(c[0], 3), round(c[1], 3)]
def lines(feats, keep, tol):
    out = []
    for f in feats:
        if not keep(f["properties"]): continue
        g = shape(f["geometry"])
        if not g.intersects(BB): continue
        for l in parts(g.intersection(BB).simplify(tol), LineString):
            c = [r3(x) for x in l.coords]
            if len(c) >= 2: out.append(c)
    return out
def polys(feats, keep, tol, minarea):
    out = []
    for f in feats:
        if not keep(f["properties"]): continue
        g = shape(f["geometry"])
        if not g.intersects(BB): continue
        for p in parts(g.intersection(BB).simplify(tol), Polygon):
            if p.area < minarea: continue
            out.append([[r3(x) for x in p.exterior.coords]])
    return out

roads = load("ne_10m_roads")
motorway = lines(roads, lambda p: p.get("type") == "Major Highway" or p.get("expressway") == 1, 0.006)
secondary = lines(roads, lambda p: p.get("type") == "Secondary Highway" and (p.get("scalerank") or 99) <= 8, 0.008)
rail = lines(load("ne_10m_railroads"), lambda p: (p.get("scalerank") or 99) <= 8, 0.008)
urban = polys(load("ne_10m_urban_areas"), lambda p: True, 0.004, 0.0006)
river = lines(load("ne_10m_rivers_lake_centerlines"), lambda p: (p.get("scalerank") or 99) <= 9, 0.006)
lake = polys(load("ne_10m_lakes"), lambda p: True, 0.004, 0.002)

# 2. Noms : ceux déjà présents + villes de France de Natural Earth
old = subprocess.run(["node", "-e", "import('./basemap.js').then(m=>console.log(JSON.stringify({p:m.PLACES_ALL,r:m.RAILS})))"], capture_output=True, text=True, check=True)
prev = json.loads(old.stdout)
places = [list(p) for p in prev["p"]]
def near(lat, lon): return any(abs(p[1] - lat) < 0.06 and abs(p[2] - lon) < 0.08 for p in places)
for f in sorted(load("ne_10m_populated_places_simple"), key=lambda f: -(f["properties"].get("pop_max") or 0)):
    p = f["properties"]
    lat, lon = p["latitude"], p["longitude"]
    if not (S < lat < N and W < lon < E) or p.get("adm0_a3") != "FRA": continue
    pop = p.get("pop_max") or 0
    tier = 1 if pop >= 250000 else 2 if pop >= 60000 else 3
    if tier == 3 and pop < 15000: continue
    if near(lat, lon): continue
    places.append([p["name"], round(lat, 3), round(lon, 3), tier])

js = f"""// Fond de carte embarqué : Natural Earth 1:10m (domaine public), toute la France. Généré par scripts/build_basemap.py.
/* =========================================================
   FOND DE CARTE DE SECOURS (hors-ligne, sous les tuiles)
   Trait de côte, routes, voies ferrées, villes, rivières et lacs : Natural Earth 1:10m (domaine public),
   projetés en Web Mercator pour se caler exactement sous les tuiles.
   RAILS : tracés simplifiés des trajets en train des fiches soignées (Bretagne).
   ========================================================= */
export const GEO = {json.dumps({"W": WIDTH, "H": HEIGHT, "b": [S, W, N, E], "land": d, "ripples": []}, separators=(",", ":"), ensure_ascii=False)};
export const BASEMAP = {json.dumps({"motorway": motorway, "secondary": secondary, "rail": rail, "urban": urban, "river": river, "lake": lake}, separators=(",", ":"))};
export const PLACES_ALL = {json.dumps(places, ensure_ascii=False, separators=(",", ":"))};
export const RAILS = {json.dumps(prev["r"], separators=(",", ":"))};
"""
open("basemap.js", "w").write(js)
print(f"basemap.js : {len(js)//1024} Ko, terre {len(d)//1024} Ko, autoroutes {len(motorway)}, routes {len(secondary)}, rail {len(rail)}, villes {len(urban)}, rivières {len(river)}, lacs {len(lake)}, noms {len(places)}")

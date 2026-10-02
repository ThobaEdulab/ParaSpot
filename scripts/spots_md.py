#!/usr/bin/env python3
"""Génère docs/SPOTS.md à partir de data/spots.json."""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
D = json.loads((ROOT / "data/spots.json").read_text())
FR = {"N":"N","NNE":"NNE","NE":"NE","ENE":"ENE","E":"E","ESE":"ESE","SE":"SE","SSE":"SSE","S":"S","SSW":"SSO","SW":"SO","WSW":"OSO","W":"O","WNW":"ONO","NW":"NO","NNW":"NNO"}
def acc(s):
    a = s["access"]
    if a["mode"] == "train": return f"Train ({a['station']}, ≈ {a['trainMinutes']} min) + skate {a['rideKm']:.0f} km" + (" (au-delà de 10 km)" if s.get("limit") else "")
    if a["mode"] == "voiture": return f"Voiture ≈ {a['driveKm']} km" + (f" (gare de {a['nearStation']} trop loin)" if a.get("nearStation") else "")
    return f"Rennes, {a.get('rideKm', 0):.1f} km"
def dirs(s): return "toutes" if len(s["orientations"]) >= 8 else ", ".join(FR[o] for o in s["orientations"])
out = ["# Spots", "", f"{len(D['spots'])} spots, générés depuis `data/spots.json` (script `scripts/spots_md.py`). " + D["note"], "",
       "Pour ajouter ou corriger un spot : modifier `scripts/build_spots.py` puis lancer `python3 scripts/build_spots.py && python3 scripts/spots_md.py`.", ""]
regions = {}
for s in D["spots"]: regions.setdefault(s.get("region", "Autre"), []).append(s)
for r, ss in regions.items():
    out += [f"## {r}", "", "| Spot | Type | Orientations | Accès depuis Rennes | Fiche | Fiabilité |", "|---|---|---|---|---|---|"]
    for s in ss:
        typ = "Gonflage" if s["kind"] == "gonflage" else {"soaring": "Soaring", "plaine": "Thermique", "treuil": "Treuil"}[s["profile"]]
        links = " · ".join(f"[{k}]({v})" for k, v in s.get("links", {}).items() if k in ("ffvl", "spotair", "club"))
        out.append(f"| {s['name']} ({s['city']}) | {typ}{' (club)' if s.get('clubOnly') else ''} | {dirs(s)} | {acc(s)} | {links} | {s.get('confidence','')} |")
    out.append("")
out += ["## Sources", "", "- [wikiparapente.fr - Normandie](https://wikiparapente.fr/normandie) et [Bretagne](https://wikiparapente.fr/bretagne)",
        "- Fiches de terrains FFVL (identifiants dans `data/spots.json`)", "- [ParaglidingEarth](https://www.paraglidingearth.com/) (API des sites)",
        "- [spots.guru - parapente Bretagne](https://www.spots.guru/guides/parapente-bretagne)", "- [Cotentin Vol Libre](https://www.cotentinvolibre.com/), [Les Archanges](https://www.parapente-club-les-archanges.fr/), [Plouez'ailes](https://www.plouezailes.fr/), [PBVL](https://pbvl.fr/sites-parapente-finistere-29/), [ATA Vol Libre](https://www.ata-vollibre.fr/le-predaire/)",
        "- [infos-parapente.com - Côtes d'Armor](https://infos-parapente.com/ou-faire-du-parapente-dans-les-cotes-darmor/)", "- [Spot Air - intégrations](https://www.spotair.mobi/help/integrations.php)",
        "- Spots de gonflage rennais : [WikiRennes](https://www.wiki-rennes.fr/Stade_de_la_Bellangerais), [Office de tourisme de Rennes](https://www.tourisme-rennes.com/decouvrir-rennes/nature/liste-jardins-parcs/)", ""]
(ROOT / "docs/SPOTS.md").write_text("\n".join(out))
print("ok", len(D["spots"]))

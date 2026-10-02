#!/usr/bin/env python3
"""Génère data/spots.json à partir des fiches ci-dessous.

Sources principales (octobre 2026) : wikiparapente.fr (Normandie, Bretagne), fiches FFVL (identifiants de terrain),
ParaglidingEarth (coordonnées, orientations), spots.guru (fiches de spots bretons), clubs : Cotentin Vol Libre,
Les Archanges, Plouez'ailes, PBVL, Goélands d'Armor, ATA Vol Libre, Breizh Fly Klub.
Les accès (gare, distance, temps de train ou de voiture) sont des ESTIMATIONS calculées ici.

Usage : python3 scripts/build_spots.py
"""
import json, math, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RENNES = (48.1035, -1.6724)

# Gares utilisées (coordonnées) et temps de train approximatif depuis Rennes, en minutes.
STATIONS = {
    "Saint-Malo": (48.6475, -2.0076, 55, "TER BreizhGo direct Rennes - Saint-Malo"),
    "Saint-Brieuc": (48.5075, -2.7660, 50, "TGV ou TER direct Rennes - Saint-Brieuc"),
    "Granville": (48.8377, -1.5967, 110, "TER Rennes - Granville (direct ou via Dol / Pontorson)"),
    "Paimpol": (48.7768, -3.0490, 120, "Rennes - Guingamp puis TER Guingamp - Paimpol (47 min)"),
    "Lannion": (48.7310, -3.4560, 115, "Rennes - Lannion (direct certains TGV, sinon via Plouaret)"),
    "Abbaretz (tram-train)": (47.5530, -1.5290, 100, "TER Rennes - Châteaubriant puis tram-train vers Nantes (arrêt Abbaretz)"),
    "Pontorson": (48.5530, -1.5080, 65, "TER Rennes - Pontorson"),
    "Pornic": (47.1150, -2.1020, 150, "Rennes - Nantes puis TER Nantes - Pornic (vérifier l'état de la ligne)"),
    "Châteaulin": (48.1960, -4.0880, 170, "Rennes - Quimper (TGV) puis TER Quimper - Brest (arrêt Châteaulin)"),
    "Plancoët": (48.5240, -2.2370, 95, "Rennes - Dinan (via Dol) puis TER Dinan - Lamballe (arrêt Plancoët), à vérifier"),
    "Bayeux": (49.2716, -0.6976, 180, "Rennes - Caen puis Caen - Bayeux, environ 3 h avec correspondance (à vérifier)"),
    "Le Havre": (49.4925, 0.1251, 270, "Rennes - Le Havre avec correspondance (Caen ou Paris), environ 4 h 30 (à vérifier)"),
    "Fécamp": (49.7578, 0.3777, 300, "Rennes - Fécamp avec 2 correspondances, environ 5 h (à vérifier)"),
}


def dist(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


def access(spot, station=None, ride=None, climb=None):
    """Accès : train + skate si une gare est donnée, sinon voiture depuis Rennes."""
    if station:
        lat, lon, mins, line = STATIONS[station]
        km = round(dist((lat, lon), (spot["lat"], spot["lon"])) * 1.3, 1)
        if km > 13:  # trop loin en skate : on bascule en voiture, en gardant l'info de la gare
            a, _ = access(spot)
            a["ride"] += f" Gare la plus proche : {station}, à environ {km:.0f} km."
            a["nearStation"] = station
            return a, False
        a = {"mode": "train", "station": station, "stationLat": lat, "stationLon": lon, "train": line,
             "trainMinutes": mins, "rideKm": km, "ride": ride or f"Environ {km:.0f} km en skate depuis la gare (estimation)."}
        if climb is not None:
            a["climbM"] = climb
        return a, km > 10.5
    road = dist(RENNES, (spot["lat"], spot["lon"])) * 1.25
    drive = round(road / 85 * 60 + 10)
    return {"mode": "voiture", "driveKm": round(road), "driveMinutes": drive, "rideKm": 0,
            "ride": f"Pas de gare à moins de 10 km : voiture ou covoiturage club, environ {road:.0f} km depuis Rennes (estimation)."}, False


def ffvl(tid):
    return f"https://federation.ffvl.fr/terrain/{tid}" if tid else None


# --------------------------------------------------------------------------------------------
# Fiches. Champs : id, name, kind, profile, city, region, lat, lon, orientations (8 ou 16 secteurs),
# elevation (dénivelé m), levelFfvl (vert/bleu/marron), description, landing, rules, warnings,
# ffvlId, stations (balises : provider/id pour Spot Air), links, tide, clubOnly, confidence, sources
# --------------------------------------------------------------------------------------------
V = []


def vol(**k):
    k.setdefault("kind", "vol")
    k.setdefault("profile", "soaring")
    k.setdefault("rules", [])
    k.setdefault("warnings", [])
    k.setdefault("links", {})
    k.setdefault("stations", [])
    k.setdefault("tide", k["profile"] == "soaring")
    k.setdefault("confidence", "moyenne")
    V.append(k)


# ======================== ILLE-ET-VILAINE, CÔTES-D'ARMOR ========================
vol(id="guimorais", name="La Guimorais - Pointe du Meinga", city="Saint-Coulomb (35)", region="Côte d'Émeraude",
    lat=48.6953, lon=-1.93417, orientations=["N", "NNW", "NW"], elevation=35,
    description="Petit site de soaring côtier sur la pointe du Meinga, au-dessus de la plage de la Guimorais. Le site de vol le plus proche de Rennes.",
    level="Pilote autonome", landing="Haut de falaise, ou plage hors juillet-août.",
    rules=["Appeler la tour de Dinard avant et après chaque session : 02 99 46 93 49.",
           "Pose sur la plage interdite en juillet et août.",
           "Plage naturiste en contrebas : ne pas poser avant le rocher qui marque la limite, sauf nécessité.",
           "Sentier côtier (GR34) : priorité aux randonneurs, pas de skate sur le sentier."],
    warnings=["Ne pas se faire enfermer sur les rochers par la marée montante.", "Vent trop ouest : site vite débordé."],
    ffvlId=240, links={"doc": "https://federation.ffvl.fr/sites/ffvl.fr/files/DINARD.pdf"},
    station="Saint-Malo", ride="Route côtière par Paramé et Rothéneuf, environ 10 km (limite).", confidence="haute",
    sources=["spots.guru", "FFVL", "ParaglidingEarth"])
vol(id="roselier", name="Pointe du Roselier", city="Plérin (22)", region="Baie de Saint-Brieuc",
    lat=48.5547, lon=-2.7158, orientations=["NNW", "N", "NNE", "NE", "SE"], elevation=65,
    description="Grand classique de la baie de Saint-Brieuc : déco N-NE au-dessus de la plage Martin et déco sud-est vers la baie. Par bonnes conditions, des kilomètres de falaises vers Binic.",
    level="Pilote autonome", landing="Plage Martin (escalier au milieu de la plage pour remonter).",
    rules=["Volable seulement environ 3 h avant et après la basse mer.", "Priorité aux piétons sur le sentier.", "Lire le panneau du site."],
    warnings=["La balise locale surestime le vent de 5 à 15 km/h : se fier plutôt à la balise Pioupiou proche.", "Vent de terre (S-SO) dangereux."],
    ffvlId=1571, links={"club": "https://www.goelandarmor.fr/index.php/les-sites-de-vol/pointe-du-roselier"},
    station="Saint-Brieuc", ride="Par Plérin et le port du Légué, environ 8 km avec une montée sérieuse.", climb=70,
    confidence="haute", sources=["spots.guru", "infos-parapente.com", "FFVL"])
vol(id="tablettes", name="Les Tablettes (Les Rosaires)", city="Plérin (22)", region="Baie de Saint-Brieuc",
    lat=48.5597, lon=-2.7348, orientations=["NNW", "N", "NNE"], elevation=70,
    description="Falaise au-dessus de la plage des Rosaires.",
    level="Pilote autonome", landing="Plage des Rosaires selon la marée, ou haut de site.",
    rules=["Respecter les cultures autour du déco."], warnings=["Attention aux rouleaux.", "Orientations différentes selon les sources (N-NO ou N-NE) : vérifier le panneau."],
    station="Saint-Brieuc", ride="Par Plérin, environ 8 km, dénivelé.", sources=["spots.guru", "infos-parapente.com", "ParaglidingEarth"])
vol(id="tournemine", name="Tournemine", city="Pordic (22)", region="Baie de Saint-Brieuc",
    lat=48.5762, lon=-2.7757, orientations=["ENE", "E", "ESE"], elevation=80,
    description="Petit déco en bord de route, optimal par vent d'est plein.",
    level="Pilote autonome", landing="Grand champ derrière le déco ou grand champ à droite.",
    rules=["Se garer sur les côtés de la route sans gêner le passage."], warnings=["Ne pas se faire reculer dans la combe à droite.", "Atterrissage technique et turbulent."],
    ffvlId=5199, station="Saint-Brieuc", sources=["spots.guru", "infos-parapente.com", "Ouest Parapente"])
vol(id="vau-madec", name="Vau Madec", city="Pordic / Binic (22)", region="Baie de Saint-Brieuc",
    lat=48.5847, lon=-2.7964, orientations=["NNE", "NE"],
    description="Déco dans un champ (quand il n'est pas cultivé), décollage facile.",
    level="Pilote autonome", landing="Au déco ou sur la plage selon la marée.",
    rules=["Se garer au bord de la route et traverser le champ."], warnings=["Perturbations dues aux arbres proches.", "À marée haute, la plage disparaît presque."],
    station="Saint-Brieuc", confidence="moyenne", sources=["spots.guru"])
vol(id="deco-henri", name="Déco Henri", city="Binic (22)", region="Baie de Saint-Brieuc",
    lat=48.5919, lon=-2.8105, orientations=["N", "NNE", "NE"],
    description="Déco étroit et technique au nord de Binic.",
    level="Pilote confirmé", landing="Plage selon la marée.",
    warnings=["Déco étroit, approche technique.", "Plateau rocheux découvert vers 4 m d'eau, rochers vers 6 m."],
    station="Saint-Brieuc", sources=["spots.guru"])
vol(id="la-chapelle", name="La Chapelle", city="Étables-sur-Mer (22)", region="Baie de Saint-Brieuc",
    lat=48.6324, lon=-2.8218, orientations=["NNE", "NE", "ENE"],
    description="Spot côtier au nord de Binic.", level="Pilote autonome", landing="À confirmer sur place.",
    confidence="faible", sources=["spots.guru"])
vol(id="beliard", name="Béliard", city="Hillion (22)", region="Baie de Saint-Brieuc",
    lat=48.5414, lon=-2.6251, orientations=["WNW", "NW", "NNW"],
    description="Spot de vent de nord-ouest et de marée basse. Quand le vent est bien établi, on longe les falaises sur des kilomètres.",
    level="Pilote autonome", landing="Plage à marée basse.",
    warnings=["Au-delà de 22 km/h à la balise d'Hillion, conditions trop fortes."],
    station="Saint-Brieuc", sources=["spots.guru"])
vol(id="saint-pabu-erquy", name="Saint-Pabu (Ville-Berneuf)", city="Erquy (22)", region="Penthièvre",
    lat=48.6025, lon=-2.5091, orientations=["NNW", "NW"], elevation=55,
    description="Plage de la Ville-Berneuf : déco haut et déco bas selon la force du vent. Cross possible les bons jours.",
    level="Facile par vent de plus de 15 km/h, contrôle face voile nécessaire", landing="Plage selon la marée.",
    rules=["Prendre le chemin à gauche de la route principale, se garer dans le premier champ à droite."],
    sources=["spots.guru", "infos-parapente.com", "Ouest Parapente"])
vol(id="pleneuf-banc", name="Pléneuf - Le Banc", city="Pléneuf-Val-André (22)", region="Penthièvre",
    lat=48.5973, lon=-2.5447, orientations=["N", "NNE"],
    description="Zone compacte, déco technique, bon rendement thermique. Accès par le GR34.",
    level="Pilote autonome (déco technique)", landing="Champ de 30 m derrière le déco, ou plage jusqu'à la pleine mer.",
    ffvlId=5025, sources=["spots.guru", "FFVL"])
vol(id="les-hopitaux", name="Les Hôpitaux (Sables-d'Or)", city="Fréhel (22)", region="Penthièvre",
    lat=48.6394, lon=-2.4234, orientations=["NE", "ENE"],
    description="Déco au-dessus de la plage des Sables-d'Or. Parking en haut, ou en bas puis montée à pied.",
    level="Pilote autonome", landing="Plage selon la marée.", warnings=["Présence fréquente d'aéromodélistes."],
    sources=["spots.guru"])
vol(id="pointe-du-chevet", name="Pointe du Chevet", city="Saint-Jacut-de-la-Mer (22)", region="Côte d'Émeraude",
    lat=48.6076, lon=-2.1918, orientations=["NE", "E"],
    description="Soaring de falaise par vent de nord-est à est.", level="Pilote autonome", landing="Plage selon la marée.",
    station="Plancoët", sources=["spots.guru", "ParaglidingEarth (St Jacut : E)"])
vol(id="notre-dame-de-la-garde", name="Notre-Dame de la Garde", city="Saint-Cast-le-Guildo (22)", region="Côte d'Émeraude",
    lat=48.6238, lon=-2.2407, orientations=["NNW", "NW"],
    description="Petit site de soaring, décollage depuis la stèle.", level="Pilote autonome", landing="Plage, attention à la marée.",
    station="Plancoët", sources=["spots.guru"])
vol(id="bilfot", name="Pointe de Bilfot", city="Plouézec (22)", region="Goëlo",
    lat=48.7657, lon=-2.9544, orientations=["W", "WNW", "NW"], elevation=60,
    description="Déco ouest à la pointe de Bilfot, parking fléché 500 m avant la pointe.",
    level="Pilote autonome", landing="Au déco ou sur la plage (place réduite à marée haute).",
    warnings=["Ajouter au moins 10 km/h à la balise de Milepat, située sous le vent.", "Effets venturi fréquents.", "Fortes turbulences par vent de travers gauche."],
    ffvlId=1982, station="Paimpol", sources=["spots.guru", "infos-parapente.com", "FFVL"])
vol(id="milepat", name="Milepat (Plouézec)", city="Plouézec (22)", region="Goëlo",
    lat=48.7620, lon=-2.9860, orientations=["NNW", "N", "NNE"], elevation=60,
    description="Déco face à la baie de Paimpol. À marée basse, thermiques dans la baie : cross possible, jusqu'au Roselier.",
    level="Facile", landing="Partie droite du chemin réservée aux atterrissages.",
    rules=["Se garer dans l'herbe sur la gauche du chemin, la droite est réservée aux atterrissages."],
    station="Paimpol", sources=["spots.guru", "infos-parapente.com", "ParaglidingEarth"])
vol(id="croix-des-veuves", name="La Croix des Veuves", city="Plouézec / Paimpol (22)", region="Goëlo",
    lat=48.8033, lon=-3.0073, orientations=["NW", "N", "NE"],
    description="Site de soaring côtier près de Paimpol, large secteur de vent nord.", level="Pilote autonome",
    landing="Haut de site ou plage selon marée.", station="Paimpol", sources=["ParaglidingEarth"])
vol(id="lann-vraz", name="Lann Vraz", city="Paimpol (22)", region="Goëlo",
    lat=48.8175, lon=-3.0352, orientations=["N"], description="Petit site de soaring nord près de Paimpol.",
    level="Pilote autonome", landing="Haut de site.", warnings=["Secteur de vent étroit : plein nord uniquement."],
    station="Paimpol", sources=["ParaglidingEarth"])
vol(id="bonaparte", name="Plage Bonaparte", city="Plouha (22)", region="Goëlo",
    lat=48.705972, lon=-2.923024, orientations=["NNE", "NE", "ENE"], elevation=70,
    description="Falaises de 50 à 70 m au-dessus de la plage Bonaparte, site du club Plouez'ailes.",
    level="Facile", landing="Au sommet, ou sur la plage à marée basse sans gêner les touristes.",
    rules=["La stèle commémorative n'est pas une cible de précision."],
    warnings=["Surtout ne pas se laisser reculer dans le trou au-dessus du parking du bas.", "Déco délicat par vent traversier de gauche, faible sustentation."],
    ffvlId=1984, links={"club": "https://www.plouezailes.fr/site-de-vol-bonaparte/"}, station="Paimpol",
    confidence="haute", sources=["Plouez'ailes", "infos-parapente.com"])
vol(id="brehec", name="Bréhec", city="Plouha / Plouézec (22)", region="Goëlo",
    lat=48.729, lon=-2.9452, orientations=["SE", "S"],
    description="Un des rares sites qui fonctionnent par vent de sud-est sur la côte nord.",
    level="Pilote autonome", landing="Haut de site ou anse de Bréhec.", station="Paimpol", sources=["ParaglidingEarth"])
vol(id="trebeurden", name="Trébeurden", city="Trébeurden (22)", region="Côte de Granit Rose",
    lat=48.7609, lon=-3.5771, orientations=["W", "NW"], description="Soaring côtier sur la Côte de Granit Rose par vent d'ouest.",
    level="Pilote autonome", landing="Haut de site ou plage.", station="Lannion", sources=["ParaglidingEarth"])
vol(id="beg-ar-fry", name="Beg ar Fry", city="Guimaëc (29)", region="Trégor",
    lat=48.7039, lon=-3.7208, orientations=["N", "NNE", "NE"],
    description="Site peu fréquenté avec de belles transitions sur près de 5 km.", level="Pilote confirmé",
    landing="Très peu d'échappatoires : seulement le petit sentier côtier sous la falaise.",
    warnings=["Peu de solutions de repli, falaise."], sources=["spots.guru", "ParaglidingEarth"])
vol(id="cotes-des-halles", name="Côtes des Halles", city="Centre Bretagne (22)", region="Intérieur",
    lat=48.3720, lon=-2.7374, orientations=["NNW", "N"], profile="plaine", tide=False,
    description="Site thermo-dynamique très tonique, à la base du déclenchement thermique.",
    level="Pilote autonome", landing="À confirmer avec les pilotes locaux.", confidence="faible", sources=["spots.guru"])
vol(id="jugon-treuil", name="Jugon-les-Lacs - Treuil", city="Jugon-les-Lacs (22)", region="Intérieur",
    lat=None, lon=None, orientations=[], skip=True)  # coordonnées introuvables : non intégré

# ======================== FINISTÈRE ========================
vol(id="menez-hom", name="Le Ménez-Hom", city="Plomodiern (29)", region="Presqu'île de Crozon",
    lat=48.220567, lon=-4.236429, orientations=["NW", "N", "NE"], elevation=76, profile="soaring", tide=False,
    description="Le site le plus connu de Bretagne, accessible à tous niveaux.", level="Tous niveaux autonomes",
    landing="Atterrissage officiel : 48.2224, -4.2416.",
    rules=["L'extrémité est de la colline est réservée aux aéromodélistes."],
    ffvlId=155, stations=["ffvl/88"], links={"spotair": "https://www.spotair.mobi/spot/43964"},
    station="Châteaulin", confidence="haute", sources=["wikiparapente.fr", "PBVL", "spots.guru"])
vol(id="trefeuntec", name="Pointe de Tréfeuntec", city="Plonévez-Porzay (29)", region="Baie de Douarnenez",
    lat=48.1236, lon=-4.2826, orientations=["W", "NW"],
    description="Très beau site de soaring avec vue sur la baie de Douarnenez. Panneaux FFVL sur place.",
    level="Intermédiaire et plus", landing="Plage selon la marée.", ffvlId=13220,
    links={"club": "https://pbvl.fr/sites-parapente-finistere-29/"}, sources=["PBVL", "FFVL"])
vol(id="kervigen", name="Kervigen", city="Plomodiern (29)", region="Baie de Douarnenez",
    lat=48.1568, lon=-4.2779, orientations=["S", "SW"],
    description="Site de vent de sud au fond de la baie de Douarnenez.", level="Intermédiaire",
    landing="À confirmer sur place.", warnings=["Turbulent, voire dangereux, avec une composante est."],
    links={"club": "https://pbvl.fr/sites-parapente-finistere-29/"}, sources=["PBVL", "ParaglidingEarth"])
vol(id="rosnoen", name="Belvédère de Rosnoën", city="Rosnoën (29)", region="Rade de Brest",
    lat=48.2627, lon=-4.2142, orientations=["SE", "S", "SW"], elevation=100, profile="plaine", tide=False,
    description="Petit bijou du Finistère : décollage en falaise, 100 m de dénivelé.", level="Pilote confirmé, bonne maîtrise du thermique",
    landing="À confirmer avec le club.", ffvlId=1945, links={"club": "https://pbvl.fr/sites-parapente-finistere-29/"},
    station="Châteaulin", sources=["PBVL", "FFVL"])
vol(id="rolzach", name="Le Rolzac'h", city="Châteaulin (29)", region="Vallée de l'Aulne",
    lat=48.2082, lon=-4.1171, orientations=["NE"], profile="plaine", tide=False,
    description="Thermique et soaring du soir dans la vallée de l'Aulne.", level="Intermédiaire et plus",
    landing="De l'autre côté de la rivière : technique.", rules=["Voler à plusieurs pour les navettes."],
    links={"club": "https://pbvl.fr/sites-parapente-finistere-29/"}, station="Châteaulin", sources=["PBVL"])
vol(id="blancs-sablons", name="Les Blancs Sablons", city="Le Conquet (29)", region="Pays d'Iroise",
    lat=48.3658, lon=-4.76667, orientations=["SW", "W", "NW"], description="Dune et falaise au nord du Conquet.",
    level="Pilote autonome", landing="Plage selon la marée.", confidence="faible", sources=["ParaglidingEarth"])

# ======================== MORBIHAN, ILLE-ET-VILAINE SUD, LOIRE-ATLANTIQUE ========================
vol(id="penestin", name="Pénestin - La Mine d'Or", city="Pénestin (56)", region="Estuaire de la Vilaine",
    lat=47.4826, lon=-2.4956, orientations=["SW", "WSW", "W"], elevation=15,
    description="Falaise de 2 km, dénivelé de 8 à 16 m au-dessus de la plage de la Mine d'Or.",
    level="Pilote autonome", landing="Plage selon la marée.", warnings=["Très faible dénivelé : peu de marge."],
    sources=["spots.guru", "ParaglidingEarth"])
vol(id="saint-seglin", name="Saint-Séglin - Treuil", city="Saint-Séglin (35)", region="Ille-et-Vilaine",
    lat=47.8451, lon=-2.04323, orientations=["ESE", "WSW"], profile="treuil", tide=False, clubOnly=True,
    description="Terrain de treuil (chemin du ruisseau du Faugouré) géré par le Breizh Fly Klub. Une seconde zone fonctionne par vent de sud-est.",
    level="Pilote breveté treuil, avec le club", landing="Sur le terrain.",
    rules=["Treuil uniquement pendant les sessions du club, licence FFVL obligatoire."],
    ffvlId=13501, sources=["FFVL", "spots.guru", "ParaglidingEarth"])
vol(id="masserac", name="Massérac - Treuil", city="Massérac (44)", region="Pays de Redon",
    lat=47.688, lon=-1.90125, orientations=["N", "NE", "E", "SE", "S", "SW", "W", "NW"], profile="treuil", tide=False, clubOnly=True,
    description="Terrain de treuil en plaine. Axe de piste à confirmer avec le club gestionnaire.",
    level="Pilote breveté treuil, avec le club", landing="Sur le terrain.",
    rules=["Treuil uniquement pendant les sessions d'un club."], ffvlId=13290, confidence="faible", sources=["FFVL", "ParaglidingEarth"])
vol(id="sougeal", name="Sougéal - Treuil des marais", city="Sougéal (35)", region="Baie du Mont-Saint-Michel",
    lat=48.5139, lon=-1.5139, orientations=["N", "NE", "E", "SE", "S", "SW", "W", "NW"], profile="treuil", tide=False, clubOnly=True,
    description="Terrain de treuil en plaine (marais de Sougéal). Ne se pratique qu'avec un club et un treuilleur qualifié.",
    level="Pilote breveté treuil, avec le club", landing="Sur le terrain.",
    rules=["Treuil : uniquement lors des sessions organisées par un club."], warnings=["Zone inondable en hiver."],
    station="Pontorson", ride="Environ 6 km, plat.", sources=["ParaglidingEarth"])
vol(id="abbaretz", name="Terril d'Abbaretz", city="Abbaretz (44)", region="Loire-Atlantique",
    lat=47.5622, lon=-1.54, orientations=["NE"], profile="plaine", tide=False,
    description="Ancien terril de mine d'étain, seul relief exploitable au nord de Nantes. Petits vols et gonflage sur pente.",
    level="Pente école / pilote débutant autonome", landing="Pied du terril.",
    rules=["Consulter la fiche FFVL pour les orientations exactes : un terril peut offrir plusieurs faces."],
    ffvlId=720, station="Abbaretz (tram-train)", ride="2 km depuis la gare.", sources=["FFVL", "ParaglidingEarth"])
vol(id="predaire", name="Le Prédaire", city="Pornic (44)", region="Côte de Jade",
    lat=47.092, lon=-2.05145, orientations=["S", "SW"],
    description="Falaise orientée sud à sud-ouest. Pas d'atterrissage en bas : atterrissage obligatoire en haut.",
    level="Pilote confirmé", landing="En haut uniquement (risque rochers ou eau).",
    rules=["Envoyer un SMS au 06 08 12 22 90 avant chaque session.", "Pâture à moutons : bien refermer les barrières ; si des moutons sont là, une personne reste au sol pour la barrière."],
    warnings=["Aucun atterrissage de secours en bas de falaise."], tide=False,
    links={"club": "https://www.ata-vollibre.fr/le-predaire/"}, station="Pornic", ride="Environ 6 km par la côte.",
    confidence="haute", sources=["ATA Vol Libre"])

# ======================== MANCHE : baie du Mont-Saint-Michel, Granville ========================
vol(id="carolles", name="Carolles - Falaises", city="Carolles (50)", region="Baie du Mont-Saint-Michel",
    lat=48.754284, lon=-1.573013, orientations=["W", "NW"], elevation=50, levelFfvl="bleu",
    description="Grand soaring au-dessus de la baie du Mont-Saint-Michel, un décollage pour chaque orientation (O et NO).",
    level="Niveau bleu (brevet de pilote, autonome)", landing="Plage de Carolles à marée basse.",
    rules=["Nidification du Grand Corbeau de janvier à mai : contourner la zone indiquée.", "Parking de la Croix Paqueray, escalier entre les parkings (10 min)."],
    warnings=["Déco NO très court : ne pas dépasser la crête au niveau de la manche à air.", "Par vent d'ouest avec du nord-ouest, éviter la combe sous le vent à droite.", "Baie du Mont-Saint-Michel : la mer monte très vite."],
    ffvlId=839, stations=["pioupiou/1464"], links={"club": "https://www.parapente-club-les-archanges.fr/sites/carolles", "webcam": "https://www.skaping.com/granville-terre-mer/jullouville/video", "maree": "https://camonte.fr/granville?hauteur=10.00"},
    station="Granville", ride="Environ 12 km par Saint-Pair et Jullouville : au-delà de la limite des 10 km.", confidence="haute",
    sources=["wikiparapente.fr", "Les Archanges", "ParaglidingEarth"])
vol(id="donville", name="Granville - Donville-les-Bains", city="Donville-les-Bains (50)", region="Granville",
    lat=48.844897, lon=-1.591426, orientations=["NW", "NNW", "N"], elevation=40, levelFfvl="bleu",
    description="Soaring sur les dunes et falaises au nord de Granville. Site sensible, charte d'engagement envers les riverains.",
    level="Brevet de pilote obligatoire (niveau bleu)", landing="Plage (réduite à marée haute).",
    rules=["Brevet de pilote obligatoire.", "Survol des habitations et du pied de pente face au Plat Gousset interdit.", "Mini-voiles de moins de 17 m², parakite et assimilés interdits.", "Parking rue de la Douane."],
    warnings=["Ne pas décoller par vent faible et marée haute."],
    ffvlId=1870, stations=["pioupiou/1502"], links={"club": "https://www.parapente-club-les-archanges.fr/sites/donvillelesbains-granville", "webcam": "https://www.skaping.com/granville-terre-mer/donville-les-bains", "maree": "https://camonte.fr/granville?hauteur=10.00"},
    station="Granville", ride="2 km depuis la gare, plat.", confidence="haute", sources=["wikiparapente.fr", "Les Archanges"])
vol(id="champeaux", name="Champeaux", city="Champeaux (50)", region="Baie du Mont-Saint-Michel",
    lat=48.706, lon=-1.4994, orientations=["S", "SW"], elevation=50, levelFfvl="bleu",
    description="Falaise orientée sud au-dessus de la baie, complément de Carolles par vent de sud.",
    level="Niveau bleu", landing="À confirmer avec le club (Les Archanges).",
    rules=["Ne pas emprunter les champs menant au décollage sud-ouest."],
    ffvlId=841, stations=["pioupiou/1449"], links={"club": "https://www.parapente-club-les-archanges.fr/"},
    sources=["wikiparapente.fr", "ParaglidingEarth"])

# ======================== MANCHE : Cotentin ========================
vol(id="carteret-sud", name="Barneville-Carteret - Sud", city="Barneville-Carteret (50)", region="Cotentin",
    lat=49.373024, lon=-1.805221, orientations=["S"],
    description="Déco sud au-dessus de la plage de Carteret.", level="Pilote autonome",
    landing="Au déco, ou en bas sur la plage jusqu'à 5 m d'eau environ.",
    links={"club": "https://www.cotentinvolibre.com/?page_id=235"}, sources=["wikiparapente.fr", "Cotentin Vol Libre"])
vol(id="carteret-no", name="Barneville-Carteret - Nord-Ouest", city="Barneville-Carteret (50)", region="Cotentin",
    lat=49.374346, lon=-1.808007, orientations=["WNW", "NW"],
    description="Déco nord-ouest du cap de Carteret.", level="Pilote autonome",
    landing="Sur la plage devant le déco, remontée en 5 min.",
    links={"club": "https://www.cotentinvolibre.com/?page_id=235"}, sources=["wikiparapente.fr", "Cotentin Vol Libre"])
vol(id="le-rozel", name="Le Rozel", city="Le Rozel (50)", region="Cotentin",
    lat=49.4745, lon=-1.8443, orientations=["NNW", "S"], elevation=60,
    description="Deux décollages officiels au-dessus de la plage du Rozel. Impossible de se garer au sommet.",
    level="Pilote autonome", landing="Sur la plage.",
    rules=["Uniquement les zones officielles (convention avec le Conservatoire du littoral).", "Limiter au maximum le survol des habitations.", "Ne pas piétiner le cordon dunaire."],
    warnings=["Aérologie parfois turbulente sous le déco NNO.", "Confluence vent météo / brise de mer."],
    ffvlId=849, links={"club": "https://www.cotentinvolibre.com/?page_id=232"}, sources=["Cotentin Vol Libre", "wikiparapente.fr"])
vol(id="dielette", name="Diélette", city="Flamanville (50)", region="Cotentin",
    lat=49.5577, lon=-1.8503, orientations=["WNW", "NW"], elevation=30, levelFfvl="vert",
    description="Petit soaring au-dessus de la plage de Diélette.", level="Brevet initial (vert)",
    landing="Plage praticable jusqu'à 7 m d'eau environ (marée de Diélette).",
    ffvlId=741, links={"club": "https://www.cotentinvolibre.com/?page_id=230", "maree": "https://camonte.fr/dielette?hauteur=7.00"},
    sources=["wikiparapente.fr", "Cotentin Vol Libre"])
vol(id="biville", name="Dunes de Biville", city="Biville (50)", region="Cotentin",
    lat=49.6091, lon=-1.84262, orientations=["W", "WSW"], elevation=35,
    description="Cordon dunaire de 3 km entre Biville et Siouville, décollage et atterrissage sur la plage.",
    level="Pilote autonome", landing="Sur la plage.",
    rules=["Zone entre la mare de Vauville et les premiers blockhaus interdite du 15/06 au 15/09, de 9 h à 19 h.", "Survol des baigneurs interdit, parking sud recommandé l'été.", "Limiter le piétinement du cordon dunaire."],
    warnings=["Turbulences sous le vent de la dune et près des blockhaus.", "Pieux, barbelés et éléments béton ou métal."],
    ffvlId=5127, links={"club": "https://www.cotentinvolibre.com/?page_id=227"}, sources=["Cotentin Vol Libre", "wikiparapente.fr"])
vol(id="vauville", name="Vauville - Pierres Pouquelées", city="Vauville (50)", region="La Hague",
    lat=49.6499, lon=-1.8556, orientations=["SW", "SSW"], elevation=130, levelFfvl="vert",
    description="Grand site de la Hague par vent de sud-ouest, cross possible vers le Nez de Jobourg.",
    level="Brevet initial (vert)", landing="Plage selon la marée (jusqu'à 7 m d'eau).",
    rules=["Accès uniquement à pied par les sentiers.", "Zone ornithologique interdite du 15 février au 15 juillet."],
    ffvlId=547, stations=["ffvl/81", "holfuy/967"], links={"maree": "https://camonte.fr/vauville?hauteur=7.00", "webcam": "https://www.viewsurf.com/univers/plage/vue/14502-france-basse-normandie-la-hague-vauville-panoramique-hd"},
    confidence="haute", sources=["wikiparapente.fr", "ParaglidingEarth"])
vol(id="ecalgrain", name="Baie d'Écalgrain", city="La Hague (50)", region="La Hague",
    lat=49.694083, lon=-1.933083, orientations=["WSW", "W", "WNW"], elevation=100, levelFfvl="marron",
    description="Site sauvage de la pointe de la Hague.", level="Brevet de pilote confirmé (marron)",
    landing="Champ derrière le déco, ou plage de la baie jusqu'à 7 m d'eau.",
    rules=["Zone ornithologique du Nez de Jobourg : respecter l'arrêté de protection de biotope."],
    ffvlId=852, stations=["ffvl/1013", "holfuy/966"], links={"club": "https://www.cotentinvolibre.com/?page_id=223", "doc": "https://www.aladecouvertedelahague.fr/zone-APPB-Jobourg.pdf", "maree": "https://camonte.fr/goury?hauteur=7.00"},
    sources=["wikiparapente.fr", "Cotentin Vol Libre"])
vol(id="landemer", name="Landemer", city="La Hague (50)", region="La Hague",
    lat=49.6786, lon=-1.7745, orientations=["N", "NNE"], elevation=60, levelFfvl="marron",
    description="Site exigeant au-dessus de la mer : thermique, dynamique et cross.", level="Pilotes expérimentés uniquement",
    landing="Pas d'atterrissage en bas de pente : chemin de randonnée ou fougères en secours.",
    rules=["Survol interdit du 1er novembre au 31 mai au-dessus de la zone de biotope de Castel-Vendon (nord du sentier littoral).", "Décollage interdit en présence de chevaux.", "Parakite déconseillé."],
    warnings=["Aérologie turbulente par vent fort, atterrissage étroit.", "Surveiller l'état de la mer."],
    ffvlId=845, links={"club": "https://www.cotentinvolibre.com/?page_id=65"}, sources=["Cotentin Vol Libre", "wikiparapente.fr"])
vol(id="omonville", name="Omonville", city="La Hague (50)", region="La Hague",
    lat=49.6951, lon=-1.833, orientations=["E", "ENE"], elevation=80, levelFfvl="bleu",
    description="Site de vent d'est de la Hague, convention avec le Conservatoire du littoral.", level="Niveau bleu",
    landing="Au décollage, ou dans le petit champ en contrebas (à reconnaître avant).",
    rules=["Uniquement les zones officielles de décollage et d'atterrissage.", "Stationnement dans l'herbe à la sortie de la D45."],
    warnings=["Turbulent au-delà de 30 km/h, surtout en mini-voile.", "Moutons sur les vagues = renforcement du vent."],
    ffvlId=843, stations=["ffvl/1014"], links={"club": "https://www.cotentinvolibre.com/?page_id=67"}, sources=["Cotentin Vol Libre", "wikiparapente.fr"])
vol(id="roches-de-ham", name="Les Roches de Ham", city="Condé-sur-Vire (50)", region="Manche intérieure",
    lat=49.026573, lon=-1.041482, orientations=["S", "SW"], elevation=70, levelFfvl="marron", profile="plaine", tide=False,
    description="Falaise au-dessus de la Vire.", level="Brevet de pilote confirmé (marron)",
    landing="Atterrissage : 49.0240, -1.0408.", ffvlId=1791, stations=["pioupiou/334"], sources=["wikiparapente.fr"])

# ======================== CALVADOS : Bessin et Côte de Nacre ========================
vol(id="vierville", name="Vierville-sur-Mer (Omaha)", city="Vierville-sur-Mer (14)", region="Bessin",
    lat=49.382122, lon=-0.908956, orientations=["NNE", "NE", "ENE"], elevation=40, levelFfvl="bleu",
    description="Soaring au-dessus d'Omaha Beach. Parking haut à 200 m du déco, ou montée de 10 min par le sentier.",
    level="Brevet de pilote (bleu)", landing="Sur la plage à marée basse, jusqu'à 4 m d'eau maximum.",
    warnings=["Attention aux rouleaux, à la piste cyclable et au champ.", "Survol des habitations avec une hauteur suffisante."],
    ffvlId=97, stations=["ffvl/97"], links={"maree": "https://camonte.fr/vierville?hauteur=4.00"},
    confidence="haute", sources=["wikiparapente.fr", "FFVL"])
vol(id="commes", name="Commes", city="Commes / Port-en-Bessin (14)", region="Bessin",
    lat=49.346232, lon=-0.725803, orientations=["N", "NNE"], elevation=65,
    description="Falaise du Bessin, à l'ouest de Port-en-Bessin.", level="Pilote autonome",
    landing="Zone au sommet à gauche du déco, ou plage jusqu'à 5 m d'eau.",
    rules=["Radio obligatoire sur la fréquence FFVL 143,9875 MHz.", "Waggas interdits.", "La ZRT de Port-en-Bessin peut être activée par NOTAM : vérifier avant de voler.", "Parking limité aux véhicules de moins de 1,90 m ; stationnement interdit régulièrement verbalisé."],
    warnings=["Relief dangereux : passer impérativement au vent des reliefs isolés."],
    ffvlId=99, stations=["ffvl/158"], links={"maree": "https://camonte.fr/port-en-bessin?hauteur=5.00"},
    station="Bayeux", confidence="haute", sources=["wikiparapente.fr", "FFVL"])
vol(id="tracy", name="Tracy-sur-Mer", city="Tracy-sur-Mer (14)", region="Bessin",
    lat=49.342990, lon=-0.635640, orientations=["NE"], elevation=35,
    description="Petit soaring face à la mer, montée au déco à pied en 10 min. Par vent de NNE, traversée possible vers Arromanches à partir de 95 m.",
    level="Pilote autonome", landing="Au déco, ou plage à marée basse (sable mouillé), remontée en 15 min.",
    ffvlId=1406, links={"maree": "https://camonte.fr/arromanches-les-bains?hauteur=5.00"}, station="Bayeux", sources=["wikiparapente.fr", "FFVL"])
vol(id="luc-sur-mer", name="Luc-sur-Mer", city="Luc-sur-Mer (14)", region="Côte de Nacre",
    lat=49.313791, lon=-0.340996, orientations=["NE"], elevation=5, levelFfvl="marron",
    description="Petite falaise de la Côte de Nacre. Vol toléré devant les falaises uniquement.",
    level="Brevet de pilote confirmé (marron)", landing="Sur la plage à marée basse.",
    rules=["Vol toléré devant les falaises uniquement."],
    warnings=["Falaise et très faible dénivelé : site particulièrement dangereux.", "Décollage difficile."],
    ffvlId=13428, stations=["holfuy/283"], sources=["wikiparapente.fr"])
vol(id="aunay-sur-odon", name="Aunay-sur-Odon", city="Aunay-sur-Odon (14)", region="Bocage",
    lat=49.0019, lon=-0.65506, orientations=["N", "NW"], profile="plaine", tide=False,
    description="Petit site thermique et dynamique du bocage virois.", level="Tous niveaux autonomes",
    landing="À confirmer avec les pilotes locaux.", confidence="faible", sources=["ParaglidingEarth"])

# ======================== CALVADOS : Suisse normande (Clécy) ========================
vol(id="clecy-sud", name="Clécy - Saint-Omer Sud", city="Saint-Omer / Clécy (14)", region="Suisse normande",
    lat=48.929532, lon=-0.469904, orientations=["SSW", "W"], elevation=180, profile="plaine", tide=False,
    description="Le site emblématique de la Suisse normande, au-dessus de l'Orne : thermique et dynamique, 180 m de dénivelé.",
    level="Pilote autonome", landing="Atterrissage officiel : 48.9260, -0.4740.",
    rules=["Site en espace naturel sensible Natura 2000.", "Météo diffusée sur 143,9875 MHz.", "Parkings : bitume (48.9301, -0.4703) et herbe (48.9305, -0.4701)."],
    ffvlId=103, stations=["ffvl/122"], links={"meteo": "https://www.meteociel.fr/previsions-arome-1h/4139/saint_omer.htm", "webcam": "https://www.plaine-altitude.com/webcam/"},
    confidence="haute", sources=["wikiparapente.fr", "FFVL", "ParaglidingEarth"])
vol(id="clecy-ouest", name="Clécy - Saint-Omer Ouest", city="Saint-Omer / Clécy (14)", region="Suisse normande",
    lat=48.9261, lon=-0.4666, orientations=["SSW", "W"], elevation=170, profile="plaine", tide=False,
    description="Second décollage de Saint-Omer.", level="Pilote autonome", landing="Atterrissage officiel de Saint-Omer.",
    rules=["Site en espace naturel sensible Natura 2000.", "Parking : 48.9254, -0.4652."],
    ffvlId=104, stations=["ffvl/122"], sources=["wikiparapente.fr", "FFVL"])
vol(id="saint-marc-douilly", name="Saint-Marc-d'Ouilly", city="Saint-Marc-d'Ouilly (14)", region="Suisse normande",
    lat=48.8825, lon=-0.445, orientations=["NNE", "NE", "ENE"], elevation=180, profile="plaine", tide=False,
    description="Site de départ de cross de la Suisse normande.", level="Pilote autonome",
    landing="Uniquement sur le terrain officiel : 48.8868, -0.4409.", rules=["Ne pas poser ailleurs que sur le terrain d'atterrissage officiel.", "Remontée en voiture."],
    ffvlId=101, sources=["wikiparapente.fr", "FFVL"])
vol(id="roche-a-bunel", name="La Roche à Bunel", city="Suisse normande (14)", region="Suisse normande",
    lat=48.9932, lon=-0.4986, orientations=["E", "ESE"], elevation=80, profile="plaine", tide=False,
    description="Site thermique par vent d'est, environ 30 min de montée à pied.", level="Pilote expérimenté",
    landing="Choisir le champ le plus adapté et atterrir loin des vaches.", ffvlId=92, sources=["wikiparapente.fr", "ParaglidingEarth"])

# Treuils de Normandie
vol(id="crocy", name="Crocy - Treuil", city="Crocy (14)", region="Pays d'Auge sud",
    lat=48.872120, lon=-0.062236, orientations=["SSW", "NNE"], profile="treuil", tide=False, clubOnly=True,
    description="Piste de treuil SSO/NNE (une seconde piste NO/SE plus au sud) exploitée par l'AS ICARE.",
    level="Pilote breveté treuil, avec le club", landing="Sur le terrain.",
    rules=["Uniquement pendant les sessions de l'AS ICARE."], sources=["wikiparapente.fr"])
vol(id="martigny", name="Martigny-sur-l'Ante - Treuil", city="Martigny-sur-l'Ante (14)", region="Suisse normande",
    lat=48.895143, lon=-0.251809, orientations=["WNW", "ESE"], profile="treuil", tide=False, clubOnly=True,
    description="Piste de treuil ONO/ESE du CDVL 14.", level="Pilote breveté treuil, avec le club", landing="Sur le terrain.",
    rules=["Uniquement pendant les sessions encadrées.", "Fréquence CDVL 14 : 157,4875 MHz."], sources=["wikiparapente.fr"])

# ======================== SEINE-MARITIME : Pays de Caux ========================
vol(id="octeville", name="Octeville-sur-Mer", city="Octeville-sur-Mer (76)", region="Pays de Caux",
    lat=49.5475, lon=0.0859, orientations=["NW", "WNW"], elevation=90, levelFfvl="marron",
    description="Falaises au nord du Havre, à proximité de l'aéroport.", level="Brevet de pilote confirmé (marron)",
    landing="À confirmer avec le club (Viking Vol Libre).",
    rules=["Autorisation de la tour de l'aéroport du Havre obligatoire : 02 35 54 64 90.", "Radio obligatoire."],
    links={"doc": "https://www.vikingvollibre76.fr/_files/ugd/204ae7_f29a9f7c985a41ab9f366e46df8f020e.pdf"},
    station="Le Havre", sources=["wikiparapente.fr", "ParaglidingEarth"])
vol(id="saint-pierre-en-port", name="Saint-Pierre-en-Port", city="Saint-Pierre-en-Port (76)", region="Pays de Caux",
    lat=49.8106, lon=0.4911, orientations=["NW"], elevation=67, levelFfvl="bleu",
    description="Déco haut accessible par le GR21 et déco bas au-dessus de la plage.", level="Niveau bleu",
    landing="Plage possible.", ffvlId=14085, station="Fécamp", sources=["wikiparapente.fr", "ParaglidingEarth"])
vol(id="saussemare", name="Saussemare", city="Côte d'Albâtre (76)", region="Pays de Caux",
    lat=49.8932, lon=0.865033, orientations=["N", "NE"], levelFfvl="marron",
    description="Site côtier de la Côte d'Albâtre.", level="Brevet de pilote confirmé (marron)", landing="À confirmer sur place.",
    confidence="faible", sources=["wikiparapente.fr", "ParaglidingEarth"])
vol(id="criel", name="Criel-sur-Mer - Les Mouettes", city="Criel-sur-Mer (76)", region="Pays de Caux",
    lat=50.0285, lon=1.30051, orientations=["NW"], elevation=88, levelFfvl="bleu",
    description="Valleuse côtière, thermique et soaring.", level="Niveau bleu", landing="À confirmer avec le club.",
    ffvlId=1385, sources=["wikiparapente.fr", "ParaglidingEarth"])

# Spot de gonflage de Suisse normande
GONFLAGE_EXTRA = [dict(
    id="mont-du-pere", name="Mont du Père (pente école)", kind="gonflage", profile="gonflage", city="Saint-Omer / Clécy (14)",
    region="Suisse normande", lat=48.9307, lon=-0.4448, orientations=["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
    description="Terrain plat de gonflage et pente école près de Saint-Omer, avec un portique. Fonctionne avec toutes les orientations.",
    rules=["Pente école utilisée par les écoles locales : demander avant de s'installer."], warnings=[], links={}, stations=["ffvl/122"],
    tide=False, confidence="moyenne", sources=["wikiparapente.fr", "ParaglidingEarth"])]


def build():
    old = json.loads((ROOT / "data/spots.json").read_text())
    gonflage = [s for s in old["spots"] if s["kind"] == "gonflage" and s["id"] != "mont-du-pere"]
    for s in gonflage:
        s.setdefault("region", "Rennes")
        s.setdefault("stations", [])
        s.setdefault("sources", ["Ville de Rennes", "Office de tourisme"])
    out = list(gonflage)
    for g in GONFLAGE_EXTRA:
        g = dict(g)
        g["access"], _ = access(g)
        out.append(g)
    for s in V:
        if s.get("skip"):
            continue
        s = dict(s)
        st = s.pop("station", None)
        ride = s.pop("ride", None)
        climb = s.pop("climb", None)
        s["access"], s["limit"] = access(s, st, ride, climb)
        tid = s.get("ffvlId")
        links = dict(s.get("links", {}))
        if tid:
            links["ffvl"] = ffvl(tid)
            links.setdefault("spotair", f"https://www.spotair.mobi/spotpg/ffvl/{tid}")
        else:
            links.setdefault("spotair", f"https://www.spotair.mobi?lat={s['lat']}&lng={s['lon']}&zoom=14&layers=spotpg,wind")
        links["pge"] = links.get("pge")
        s["links"] = {k: v for k, v in links.items() if v}
        s.setdefault("levelFfvl", None)
        s.setdefault("elevation", None)
        out.append(s)
    data = {
        "version": "2026-10-02",
        "note": "Fiches compilées depuis wikiparapente.fr, la FFVL, ParaglidingEarth, spots.guru et les sites des clubs. Orientations et règles À VÉRIFIER sur la fiche FFVL et le panneau avant chaque vol. Accès (gare, distance, temps) : estimations.",
        "home": old.get("home", {"name": "Rennes", "lat": RENNES[0], "lon": RENNES[1]}),
        "spots": out,
    }
    (ROOT / "data/spots.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    n_vol = sum(1 for s in out if s["kind"] == "vol")
    print(f"{len(out)} spots ({n_vol} vol, {len(out) - n_vol} gonflage)")
    for s in out:
        a = s["access"]
        print(f"  {s['id']:24s} {a['mode']:8s} {a.get('station') or '':22s} {a.get('rideKm', 0):5}km {a.get('driveMinutes', '')} {'LIMITE' if s.get('limit') else ''}")


if __name__ == "__main__":
    build()

<img src="assets/paraspot-logo.svg" alt="ParaSpot" height="64">

# ParaSpot

Application web installable (PWA) qui envoie sur ton téléphone les créneaux favorables pour :
- le **gonflage** de parapente dans les grands espaces verts de Rennes ;
- le **vol** sur les sites côtiers et de pente accessibles en **train + skate électrique** (moins de 10 km de la gare).

Prévisions de **trois modèles au choix et comparés** (AROME HD de Météo-France, ECMWF IFS, NOAA GFS, via Open-Meteo), fiches de sites à la manière de wikiparapente, carte et balises **Spot Air** intégrées, marées indicatives, score heure par heure selon l'orientation du site, la force et la régularité du vent, la pluie et l'accessibilité en train. Deux alertes par jour (7h et 18h30) via ntfy ou Web Push. Coût : 0 €.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | Interface « Ciel » issue de la maquette Claude Design : la carte est l'interface, vent animé, ruban du temps, fiche détaillée par spot |
| `basemap.js`, `vendor/leaflet.*` | Fond de carte embarqué (Natural Earth) et Leaflet, pour fonctionner hors-ligne |
| `design/` | Maquettes Claude Design d'origine (données fictives), gardées comme référence |
| `scoring.js` | Moteur de prévision partagé app + robot |
| `data/spots.json` | 64 spots : 2 de gonflage (Bellangerais à Rennes, Mont du Père en Suisse normande), 62 de vol (Bretagne, Normandie dont Clécy, Pays de la Loire, treuils) |
| `scripts/build_spots.py`, `scripts/spots_md.py` | Fiches des spots et génération de `docs/SPOTS.md` |
| `data/config.json` | Réglages des notifications |
| `manifest.webmanifest`, `sw.js`, `icons/` | Tout ce qui fait de la page une PWA |
| `scripts/check.mjs`, `.github/workflows/check.yml` | Robot de notifications (GitHub Actions) |
| `docs/SPOTS.md` | Recensement des spots et sources |
| `docs/PROMPT_CLAUDE_DESIGN.md` | Prompt pour l'interface et les notifications |
| `docs/CONVERSION_PWA.md` | Intégrer le design de Claude Design dans la PWA |
| `docs/CONCEPTION.md` | Choix techniques, météo, sécurité, transport, évolutions |
| `docs/INSTALLATION.md` | Mise en ligne pas à pas |

## Démarrage rapide

Voir [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Avertissement

Outil d'aide à la décision. Il ne remplace ni la fiche FFVL, ni le panneau du site, ni une balise en temps réel, ni ton jugement sur place.

Données météo : [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Sites : ParaglidingEarth, FFVL.

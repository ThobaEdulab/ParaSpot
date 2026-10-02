# Conception : ce qu'il faut savoir

Ce document rassemble les choix techniques et les points que le prompt de départ ne mentionnait pas mais qui comptent pour que l'app soit fiable, gratuite et sûre.

## 1. Architecture (0 € par mois)

Sites hors critère « train + skate » (Suisse normande, Cotentin, Finistère, treuils) : ils sont affichés avec un accès en voiture ou en covoiturage club (temps estimé depuis Rennes) et peuvent être masqués dans les Réglages. À score égal, un site en train passe devant un site en voiture.

```
 GitHub (dépôt public)
 ├─ GitHub Pages ──────────► PWA sur ton téléphone (prévisions en direct, carte, détail)
 └─ GitHub Actions (7h, 18h30)
        │  1. Open-Meteo (prévisions + marées)
        │  2. scoring.js (même moteur que l'app)
        ▼  3. envoi
   ntfy (app ntfy)  et/ou  Web Push (PWA installée)
```

Pourquoi ce choix :
- **Pas de serveur à maintenir.** Une PWA seule ne peut pas se réveiller pour vérifier la météo en arrière-plan de façon fiable (surtout sur iPhone) : il faut un « robot » extérieur. GitHub Actions le fait gratuitement pour un dépôt public.
- **Un seul moteur de calcul** (`scoring.js`) partagé entre l'app et le robot : la notification et l'écran disent toujours la même chose.
- **Deux canaux de notification** :
  - **ntfy** (recommandé pour démarrer) : 5 minutes d'installation, fonctionne sur Android et iPhone sans installer la PWA.
  - **Web Push** : la notification vient de l'app elle-même. Sur iPhone, il faut iOS 16.4+ et l'app ajoutée à l'écran d'accueil.

Limites à connaître :
- Les tâches planifiées GitHub peuvent avoir **5 à 30 minutes de retard** aux heures de pointe.
- GitHub **désactive les tâches planifiées après 60 jours sans activité** sur un dépôt public : le workflow fait un petit commit automatique le 1er et le 15 du mois pour l'éviter.
- Les heures cron sont en UTC : l'alerte arrive à 7h05 en été et 6h05 en hiver (modifiable dans `.github/workflows/check.yml`).
- Open-Meteo est gratuit pour un usage non commercial (moins de 10 000 appels par jour, l'app en fait quelques dizaines) avec obligation de le citer : c'est fait dans l'écran Réglages.

## 2. Météo : comment l'app décide

- **Source** : Open-Meteo, qui choisit automatiquement les meilleurs modèles pour la France (Météo-France AROME à 1,3 km pour les 2 premiers jours, puis ARPEGE). AROME est le plus fiable pour les brises côtières bretonnes.
- **Variables** : vent moyen et rafales à 10 m, direction, pluie et probabilité, code météo (orage, brouillard), nébulosité, CAPE (instabilité), jour/nuit, lever et coucher du soleil. Marées : Open-Meteo Marine (niveau de la mer, **indicatif**, à confirmer sur le SHOM).
- **Score horaire (0-100)** = orientation x force x régularité x pluie x instabilité.
  - Orientation : plein face au site = 100 %, décalé de 23 à 45° = 55 %, au-delà = 0 (vent de travers ou arrière en soaring côtier = danger).
  - Force : seuils par pratique, décalés selon le niveau (-4 / 0 / +4 km/h).

| Pratique | Mini | Idéal | Maxi | Rafales maxi | Écart rafale/moyen maxi |
|---|---|---|---|---|---|
| Gonflage | 8 | 12-22 | 28 | 32 | 12 |
| Soaring côtier | 14 | 18-27 | 32 | 36 | 12 |
| Pente / terril | 3 | 6-18 | 22 | 28 | 10 |
| Treuil | 0 | 4-20 | 25 | 30 | 10 |

  - Pluie > 0,1 mm, orage, brouillard (vol) ou nuit : score 0.
- **Créneau** = heures consécutives au-dessus du score minimum (55 par défaut dans l'app, 60 pour les notifications), d'au moins 1 h (gonflage) ou 2 h (vol), **et atteignables en train** : départ de Rennes à 7h par défaut + durée du train + skate (18 km/h) + 10 min, retour avant le dernier train (20h par défaut).
- Ces seuils sont un **point de départ prudent**. Ils sont tous modifiables (`data/config.json` pour les notifications, écran Réglages pour l'app). Le meilleur réglage viendra de tes propres séances : note ce que tu as ressenti et ajuste.

Points météo à garder en tête :
- Le vent prévu à 10 m est **plus fort qu'au sol** : en gonflage, compte 20 à 30 % de moins à hauteur d'homme.
- **Brise de mer** : en été, par grand beau temps, elle se lève sur la côte nord en fin de matinée et tourne vers le nord-ouest l'après-midi. Elle peut rendre un site volable même si le vent général est faible, ou le rendre trop fort en fin de journée.
- En ville, les **rafales et rouleaux** derrière arbres et bâtiments sont mal vus par les modèles : le score urbain est optimiste par vent fort.
- Toujours confirmer avec une **balise en temps réel** (OpenWindMap / Pioupiou, Holfuy, balises FFVL) avant de partir et sur place.

### Trois modèles de prévision

| Modèle | Fournisseur | Maille | Horizon | Remarque |
|---|---|---|---|---|
| AROME HD | Météo-France | 1,5 km | environ 42 h | Le plus fin pour les brises côtières. Pas de rafales natives : elles viennent d'AROME/ARPEGE (« Météo-France seamless »), qui comble aussi le 3e jour. Les heures comblées sont signalées « secours ». |
| ECMWF IFS HRES | Centre européen | 9 km | 15 jours | Très bon sur la situation générale. Si indisponible, l'app bascule sur ECMWF IFS 0,25°. |
| GFS | NOAA | 13 à 25 km | 16 jours | Utile comme troisième avis. |

L'app calcule les créneaux avec le modèle choisi (bouton en bas de l'écran ou Réglages) et compare les trois dans la fiche de chaque spot, avec un indicateur d'accord heure par heure : vert si les modèles s'écartent de moins de 6 km/h et 30°, orange jusqu'à 12 km/h et 60°, rouge au-delà. Un créneau où les modèles divergent est une prévision fragile.

Coût en appels Open-Meteo : une actualisation = 4 requêtes (3 modèles + secours AROME) + 1 pour les marées, sur environ 65 positions. L'app garde les prévisions 30 min avant de redemander (sauf actualisation manuelle) pour rester loin du quota gratuit (10 000 appels par jour). Le robot n'utilise qu'un modèle (`"model"` dans `data/config.json`).

### Spot Air et fiches de sites

Chaque fiche reprend la logique de wikiparapente : orientations, dénivelé, niveau FFVL (vert, bleu, marron), coordonnées du décollage, atterrissage, marée, règles, balises, sources. Spot Air est intégré par ses widgets officiels (documentés sur spotair.mobi) : une carte centrée sur le site avec les décollages FFVL et les balises en temps réel, la liste des balises du site quand on les connaît (FFVL, Pioupiou), et un lien vers la fiche Spot Air du terrain FFVL (`spotair.mobi/spotpg/ffvl/<identifiant>`). Ces widgets demandent une connexion.

## 3. Sécurité et réglementation

- **Licence et assurance** : la responsabilité civile aérienne est obligatoire pour voler. La licence FFVL l'inclut et donne accès aux fiches de sites et aux conventions avec les propriétaires.
- **Sites conventionnés** : respecter le panneau, les restrictions saisonnières (oiseaux nicheurs sur certaines falaises), les consignes de stationnement et d'accès.
- **Espaces aériens** : à Rennes, zone de contrôle de l'aéroport Saint-Jacques : gonflage oui, décollage non. Sur la côte, vérifier les zones autour de Dinard, Saint-Brieuc, Lannion, Lanvéoc sur la carte aéronautique (Géoportail, couche OACI) et sur la fiche FFVL.
- **Soaring côtier** : ne jamais voler seul, prévenir quelqu'un, connaître l'horaire de marée (plage noyée, sortie de secours), éviter les vents trop ouest/est qui débordent la falaise.
- **Radio** : fréquence vol libre 143,9875 MHz (déclaration et usage selon la réglementation en vigueur).
- **Autonomie** : les sites de vol listés supposent un pilote autonome. Si ce n'est pas encore le cas, l'app reste utile pour le gonflage et pour repérer les jours où une école locale volera.

## 4. Train + skate électrique

- **Skate électrique = EDPM** (engin de déplacement personnel motorisé) : 25 km/h maxi, pistes cyclables en priorité, routes limitées à 50 km/h en ville, **hors agglomération uniquement voies vertes et pistes cyclables**. Éclairage, avertisseur sonore, gilet rétro-réfléchissant la nuit, casque fortement recommandé (obligatoire dans certains cas hors agglomération).
- **Assurance responsabilité civile spécifique obligatoire** pour un EDPM : l'assurance habitation ne suffit en général pas.
- **Dans le train** : un EDPM plié ou rangé dans une housse (moins de 120 x 90 cm) voyage comme un bagage, gratuitement en TER et TGV INOUI. Pour OUIGO, option bagage payante. Batterie lithium acceptée.
- **Charge** : sac de parapente 10 à 18 kg sur le dos + skate = autonomie réduite et freinage plus long. Le Roselier a une montée sérieuse. Pas de skate sur le sentier côtier (GR34) ni sur le sable humide salé.
- **Horaires** : l'app estime les temps de trajet, mais elle ne connaît pas encore les vrais horaires. Toujours vérifier le dernier train retour (SNCF Connect, BreizhGo), surtout le dimanche et hors saison (ligne Guingamp - Paimpol : 5 à 8 trains par jour).
- Carte de réduction régionale BreizhGo et billets « petits prix » : utiles si tu pars souvent.

## 5. Vie privée et sécurité informatique

- Dépôt public = la liste des spots est publique (aucun problème). Les secrets (sujet ntfy, clé VAPID privée, abonnement push) restent dans **Settings > Secrets** de GitHub, jamais dans le code.
- Un sujet ntfy est public pour qui le devine : choisis un nom long et aléatoire (ex. `paraspot-7k2p9qxm4z`).
- L'app ne collecte rien : tes réglages restent dans le navigateur du téléphone.

## 6. Évolutions possibles (par ordre d'intérêt)

1. **Balises en temps réel** : afficher la balise OpenWindMap la plus proche de chaque spot (API publique `api.pioupiou.fr/v1/live/all`) et une alerte « dernière minute » si la balise confirme.
2. **Vrais horaires de train** : API SNCF (Navitia, clé gratuite) pour proposer « Départ 8h12, arrivée 9h07, retour 18h43 ».
3. **Carnet de séances** : un bouton « c'était bien / trop fort / trop faible » après chaque sortie pour ajuster automatiquement les seuils.
4. **Agenda** : création automatique d'un événement Google Agenda « Créneau vol » quand un créneau Top tombe sur un jour libre.
5. **Ajout de spots** depuis l'app (formulaire) et vue « Tous les sites » avec ceux à plus de 10 km pour les jours en voiture ou covoiturage club.
6. **Brise de mer** : indicateur dédié (écart de température terre/mer + heure) pour les après-midis d'été.

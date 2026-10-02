# Prompt pour Claude Design

Copie tout le bloc ci-dessous dans Claude Design. Joins si possible : `data/spots.json`, une capture de l'app actuelle et le fichier `scoring.js` (pour qu'il voie les données réelles).

---

## Contexte

Tu conçois l'interface mobile de **ParaSpot**, une application web installable (PWA) qui indique à un parapentiste basé à Rennes **où et quand** il peut :
1. faire du **gonflage** (maniement de la voile au sol) dans les grands espaces verts de Rennes ;
2. **voler** sur des sites côtiers ou de pente accessibles **en train puis en skate électrique** (moins de 10 km depuis la gare).

L'utilisateur consulte l'app surtout sur son téléphone : le soir pour préparer le lendemain, le matin pour décider s'il part, et sur le quai de la gare. Il reçoit aussi **deux notifications par jour** (7h et 18h30) quand un créneau est favorable.

Ton : technique mais lisible en 3 secondes. Il faut pouvoir répondre d'un coup d'œil à « Je pars ou pas ? Où ? À quelle heure ? ».

## Direction visuelle

- Ambiance : ciel breton, lumière rasante de bord de mer, ardoise et granit rose, sans clichés (pas de phares, pas de mouettes en déco).
- Palette : bleu marine profond pour la marque, ciel clair en fond, et une **échelle de verdict** très lisible : Top (vert), Jouable (vert-jaune), Limite (orange), Non (gris). Le verdict ne doit **jamais reposer uniquement sur la couleur** : toujours un libellé ou une icône.
- Typographie : une sans-serif système ou une Google Font sobre et très lisible en plein soleil (ex. Inter, Manrope). Chiffres tabulaires pour les vitesses de vent.
- Mode sombre complet (beaucoup de consultation le soir).
- Contraste WCAG AA minimum, zones tactiles de 44 px minimum, utilisable avec des gants fins.
- Mobile d'abord (390 x 844), puis une mise en page élargie jusqu'à 760 px de large.
- Respect des zones sûres iPhone (encoche, barre d'accueil) : l'app est affichée en plein écran.

## Écrans à concevoir

### 1. Accueil « Créneaux »
- En-tête : nom de l'app, heure de mise à jour, bouton actualiser.
- Filtres : Tout / Gonflage / Vol, et sélecteur de jour (Aujourd'hui, Demain, jour suivant).
- **Carte « Meilleure option du jour »** mise en avant : nom du spot, type (vol ou gonflage), créneau horaire, direction et force du vent, rafales, temps de trajet (train + skate). Prévoir aussi l'état « aucun créneau » avec un message utile et bienveillant.
- **Liste des spots** triés du meilleur au moins bon. Chaque carte affiche :
  - nom, commune, type de pratique, orientations acceptées par le site ;
  - badge de verdict ;
  - flèche de vent (elle indique où va le vent, comme sur les cartes météo), vitesse moyenne et rafales ;
  - meilleur créneau du jour ;
  - **frise horaire 7h-21h** colorée heure par heure, avec les heures hors de portée en train grisées ;
  - étiquettes : train (durée + gare), skate (km), marée, « au-delà de 10 km », « avec un club ».

### 2. Détail d'un spot (feuille qui monte du bas)
- Titre, commune, jour, lever/coucher du soleil.
- **Rose des vents** : secteurs favorables du site en surbrillance, flèche du vent prévu qui arrive du bord vers le centre. C'est l'élément signature de l'app, soigne-le.
- **Jauge de vent** : vitesse prévue placée sur une échelle avec la plage idéale (ex. 18-27 km/h pour le soaring, 12-22 km/h pour le gonflage) et le plafond.
- **Heure par heure** (défilement horizontal) : heure, flèche, vent, rafales, direction, pluie, état de la marée, verdict.
- **Recommandations** (3 à 6 phrases courtes générées par l'app).
- **Règles et vigilance** du site (SMS obligatoire, marée, club, aéroport…).
- **Y aller** : train depuis Rennes, gare, distance en skate, dénivelé, dernier train conseillé.
- **Liens** : fiche FFVL, club, balises de vent en temps réel, Windy, itinéraire gare-site, horaires SNCF, marées SHOM.
- Mention de fiabilité des données du site.

### 3. Carte
Carte de la Bretagne (Leaflet + OpenStreetMap) avec un marqueur par spot coloré selon le verdict du jour sélectionné, les gares, et un aperçu au toucher.

### 4. Réglages
- Niveau du pilote (Débutant / Intermédiaire / Confirmé).
- Score minimum d'un créneau, heure du premier départ de Rennes, dernier train retour.
- Activation des notifications avec un **parcours d'installation guidé** : sur iPhone, l'app doit d'abord être ajoutée à l'écran d'accueil (Partager > Sur l'écran d'accueil) avant de pouvoir recevoir des notifications. Dessine cet onboarding en 3 étapes illustrées.
- Bouton « Tester une notification ».

### 5. États transverses
Chargement (squelettes), hors-ligne (dernières prévisions en cache avec leur heure), erreur réseau, premier lancement.

## Notifications (à concevoir aussi)

Montre leur rendu sur écran verrouillé iOS et Android, en clair et en sombre. Règles :
- **Titre** (40 caractères max) : quand + où. Ex. `Demain 14h-18h : La Guimorais`
- **Corps** (3 lignes max, une par créneau) : `Vol · La Guimorais · demain 14h-18h · NO 22 km/h (raf. 28)`
- Pas d'emoji superflu, pas de point d'exclamation, vocabulaire du parapentiste.
- Action : « Voir le créneau » ouvre directement le détail du spot.
- Variantes à dessiner :
  1. un seul créneau excellent (priorité haute) ;
  2. plusieurs créneaux (vol + gonflage) ;
  3. gonflage seul à Rennes ;
  4. site treuil (mention « si session club »).
- Icône de notification monochrome (badge) : silhouette de voile simple.

## Données disponibles (contrat d'intégration)

Chaque spot (fichier `data/spots.json`) :
```
id, name, kind ("gonflage" | "vol"), profile ("gonflage" | "soaring" | "plaine" | "treuil"),
city, lat, lon, orientations ["N","NW",…], description, level, landing,
access { mode ("local" | "train"), station, train, trainMinutes, rideKm, ride, summary },
tide (bool), limit (bool, au-delà de 10 km), clubOnly (bool),
rules [], warnings [], links { ffvl, club, pge, fiche }, confidence
```
Chaque heure analysée :
```
time "2026-10-02T14:00", hour 14, wind 21 (km/h), gust 28, dir 315 (degrés, d'où vient le vent),
rain (mm), rainProb (%), temp, cloud, isDay, score 0-100,
verdict { key: "top" | "ok" | "limite" | "non", label }, reasons ["Vent trop fort", …],
reachable (bool, atteignable en train), tide { label "Haute" | "Mi-marée" | "Basse", trend }
```
Chaque créneau :
```
spotId, spotName, kind, date, start 14, end 18, wind, gust, sector "NW", score, verdict, travelMinutes
```

## Livrable attendu

- **Un seul fichier HTML** autonome : CSS dans `<style>`, JavaScript vanilla, aucune dépendance sauf Leaflet si tu montres la carte.
- Données fictives réalistes conformes au contrat ci-dessus (3 jours, 5 à 6 spots dont 2 gonflages).
- Variables CSS pour toutes les couleurs, espacements et rayons (`:root` + mode sombre via `prefers-color-scheme`).
- Chaque composant isolé et balisé par un commentaire `<!-- COMPOSANT: nom -->` (hero, spot-card, timeline, compass, wind-gauge, hour-cell, detail-sheet, notification-preview, onboarding-ios…), et dans le JS une fonction de rendu par composant qui prend les objets du contrat en paramètre. C'est ce qui permettra de brancher le design sur l'app réelle sans tout réécrire.
- Une planche « Notifications » dans une section séparée du même fichier.
- Pas de texte en anglais dans l'interface. Pas de tirets longs : uniquement le trait d'union « - ».

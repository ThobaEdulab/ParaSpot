# Convertir le HTML de Claude Design en PWA

> **Statut (2 octobre 2026) : maquette « Ciel » intégrée** (`design/paraspot-ciel-maquette.html`) : CSS dans `styles.css`, Leaflet et fond Natural Earth sortis dans `vendor/` et `basemap.js`, composants dans `app.js` branchés sur `scoring.js`, multi-modèles et Spot Air ajoutés, service worker v3.
>
> Historique (1er octobre 2026) : première maquette intégrée. La maquette `design/paraspot-maquette.html` est branchée sur les vraies prévisions. Ce qui a été fait :
> - CSS de la maquette repris tel quel dans `styles.css` (planches de présentation retirées) ;
> - fonctions de rendu de la maquette reprises dans `app.js`, alimentées par `scoring.js` via un adaptateur (`buildDays`, `buildForecast`) ;
> - jauge de vent, recommandations et notification de test calées sur les seuils et le texte du robot ;
> - les spots fictifs de la maquette (Pointe de la Varde, Pointe du Grouin, treuil de Noyal) ne sont **pas** repris : ils n'ont pas été vérifiés ;
> - heures passées grisées, créneaux du jour déjà terminés retirés ;
> - réglages, thème et écran de bienvenue enregistrés sur l'appareil ;
> - icônes redessinées avec la voile de la maquette (fond marine #14305a, badge blanc transparent) ;
> - service worker v2 : met aussi en cache la police Manrope et Leaflet.
>
> La suite de ce document reste utile pour une future refonte.

L'app livrée est **déjà une PWA fonctionnelle** (interface de base). Le HTML de Claude Design vient remplacer l'habillage, pas la mécanique. Tout ce qui fait d'une page une PWA est déjà en place :

| Élément | Fichier | Rôle |
|---|---|---|
| Manifeste | `manifest.webmanifest` | Nom, icônes, couleurs, affichage plein écran, raccourcis |
| Icônes | `icons/` | 192, 512, maskable (Android), apple-touch-icon (iPhone), badge de notification |
| Service worker | `sw.js` | Hors-ligne, cache des prévisions, réception des notifications push, ouverture du bon spot au clic |
| Balises iOS | `index.html` (`<head>`) | `apple-mobile-web-app-capable`, barre d'état, titre |
| HTTPS | GitHub Pages | Obligatoire pour service worker et push |
| Logique | `scoring.js` + `app.js` | Prévisions, score, créneaux, rendu |

## Étapes d'intégration

1. **Styles** : reprendre les variables CSS et les styles du fichier Claude Design dans `styles.css` (garder `env(safe-area-inset-*)` et le mode sombre).
2. **Composants** : dans `app.js`, remplacer le contenu des fonctions de rendu par les gabarits de Claude Design :
   - `render()` pour la carte « Meilleure option » ;
   - `card()` pour une carte spot ;
   - `openDetail()` pour la feuille de détail ;
   - `compassSvg()` et `arrowSvg()` pour la rose des vents et les flèches.
   Les objets reçus sont exactement ceux du contrat de données du prompt.
3. **Structure** : adapter `index.html` en gardant les identifiants utilisés par `app.js` (`#hero`, `#list`, `#kindTabs`, `#dayTabs`, `#detail`, `#map`, `#view-*`, `#pushBtn`…), ou mettre à jour les sélecteurs dans `app.js`.
4. **Cache** : si de nouveaux fichiers apparaissent (police, images), les ajouter à la liste `SHELL` de `sw.js` puis **incrémenter `VERSION`** (`fv-v2`…) pour forcer la mise à jour sur le téléphone.
5. **Vérifier** : Chrome > DevTools > Application > Manifest et Service workers (aucune erreur), test en mode avion, test d'installation sur Android et iPhone, bouton « Tester une notification ».

## Prompt prêt à l'emploi pour faire l'intégration avec Claude

> Voici le dépôt ParaSpot (PWA vanilla JS) et un fichier HTML produit par Claude Design. Intègre le design dans l'app sans changer `scoring.js`, `sw.js` (sauf la liste SHELL et la VERSION), `manifest.webmanifest` ni `scripts/`. Reprends les variables CSS et les composants balisés `COMPOSANT:` dans `styles.css` et dans les fonctions de rendu de `app.js` (`render`, `card`, `openDetail`, `compassSvg`, `arrowSvg`). Conserve les identifiants DOM utilisés par `app.js`, l'accessibilité (libellés, contrastes, zones tactiles 44 px) et le mode sombre. Teste ensuite avec des données simulées dans un navigateur mobile 390 x 844 et corrige les débordements.

## Pièges courants

- **iPhone** : les notifications ne fonctionnent que si l'app est ouverte depuis l'icône de l'écran d'accueil (iOS 16.4 ou plus). La demande de permission doit suivre un geste de l'utilisateur (bouton).
- **Mises à jour invisibles** : sans changement de `VERSION` dans `sw.js`, le téléphone garde l'ancienne interface en cache.
- **Chemins** : sur GitHub Pages l'app vit dans un sous-dossier (`/paraspot/`), d'où les chemins relatifs partout (`./`, `icons/…`). Ne pas écrire de chemins commençant par `/`.
- **Polices externes** : une Google Font n'est pas disponible hors-ligne si elle n'est pas mise en cache ; préférer une police système ou l'héberger dans le dépôt.

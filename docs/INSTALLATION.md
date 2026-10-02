# Mise en ligne pas à pas (30 minutes, gratuit)

## 1. Créer le dépôt GitHub

1. Crée un compte sur github.com si besoin.
2. Nouveau dépôt : nom `paraspot`, visibilité **Public** (nécessaire pour Pages et les tâches planifiées gratuites).
3. Envoie les fichiers du projet. Le plus simple : **GitHub Desktop** (glisser le dossier, « Publish repository »). L'envoi par glisser-déposer sur le site oublie souvent le dossier caché `.github`, qui contient le robot.

   En ligne de commande :
   ```bash
   cd paraspot
   git init && git add . && git commit -m "ParaSpot v1"
   git branch -M main
   git remote add origin https://github.com/<ton-compte>/paraspot.git
   git push -u origin main
   ```

## 2. Publier l'app (GitHub Pages)

1. Dépôt > **Settings > Pages** > Source : « Deploy from a branch », branche `main`, dossier `/ (root)`.
2. Après 1 à 2 minutes, l'app est en ligne sur `https://<ton-compte>.github.io/paraspot/`.
3. **Settings > Secrets and variables > Actions > onglet Variables** : crée `APP_URL` avec cette adresse (la notification ouvrira directement le bon spot).

## 3. Installer l'app sur le téléphone

L'app est une PWA : une fois en ligne, elle s'installe depuis le navigateur, sans passer par un magasin d'applications, et fonctionne ensuite hors connexion (dernières prévisions, carte embarquée).

- **Android (Chrome)** : ouvrir l'adresse > menu ⋮ > « Installer l'application » (ou le bouton « Installer ParaSpot » dans les Réglages de l'app).
- **iPhone (Safari)** : ouvrir l'adresse > bouton Partager > « Sur l'écran d'accueil ». Ouvre ensuite toujours l'app depuis cette icône.

### Option : un vrai fichier APK pour Android

1. Aller sur [pwabuilder.com](https://www.pwabuilder.com/), coller l'adresse GitHub Pages de l'app.
2. « Package for stores » > Android > « Generate ». Le site fournit un `.apk` (installation directe, en autorisant les sources inconnues) et un `.aab` (Play Store).
3. L'APK affiche la même app en plein écran : toute mise à jour poussée sur GitHub arrive automatiquement.

Il n'existe pas d'équivalent pour iPhone sans compte développeur Apple : l'ajout à l'écran d'accueil est la bonne méthode.

## 4. Notifications avec ntfy (recommandé)

1. Installe l'app **ntfy** (Play Store ou App Store).
2. Invente un sujet long et aléatoire, par exemple `paraspot-7k2p9qxm4z`, et abonne-toi à ce sujet dans ntfy (serveur par défaut ntfy.sh).
3. GitHub > **Settings > Secrets and variables > Actions > Secrets** : crée `NTFY_TOPIC` avec ce sujet.
4. Onglet **Actions** > autorise les workflows si demandé > « Alertes vol et gonflage » > **Run workflow** pour tester. Si aucun créneau n'est favorable, le journal l'indique et rien n'est envoyé (normal).

## 5. Notifications Web Push dans la PWA (optionnel)

1. Sur un ordinateur avec Node.js : `npx web-push generate-vapid-keys`.
2. Clé **publique** : dans `config.js` (`VAPID_PUBLIC_KEY`) et en variable GitHub `VAPID_PUBLIC_KEY`. Ajoute aussi la variable `VAPID_SUBJECT` = `mailto:ton-adresse`.
3. Clé **privée** : secret GitHub `VAPID_PRIVATE_KEY` (ne jamais la mettre dans le code).
4. Sur le téléphone, ouvre l'app installée > Réglages > « Activer les notifications ». L'abonnement s'affiche et est copié : colle-le dans le secret GitHub `WEB_PUSH_SUBSCRIPTION`. (Pour plusieurs appareils : un tableau JSON `[ {...}, {...} ]`.)
5. Relance le workflow pour tester.

## 6. Personnaliser

- **Seuils et horaires des alertes** : `data/config.json` (niveau, score minimum, premier départ, dernier train, spots à exclure).
- **Spots** : `data/spots.json` (ajouter un site = copier un bloc et changer les valeurs).
- **Heures d'envoi** : lignes `cron` de `.github/workflows/check.yml` (en UTC).
- Après une modification de l'interface, incrémente `VERSION` dans `sw.js` pour que le téléphone récupère la nouvelle version.

## Tester en local

```bash
npm install
npm run check:dry        # calcule et affiche la notification sans l'envoyer
npx serve .              # puis ouvrir http://localhost:3000
```

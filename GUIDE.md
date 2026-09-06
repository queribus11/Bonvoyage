# 🧳 Bonvoyage — guide d'installation pas à pas

Ce guide te permet de mettre ton app en ligne **sans écrire une ligne de code**, en 30 à 45 minutes.
Tout est gratuit : GitHub héberge l'app, Supabase héberge tes données et tes photos (jusqu'à 1 Go avec l'offre gratuite, soit environ 3 000 photos compressées par l'app ; vidéos limitées à 50 Mo chacune).

Il y a trois grandes étapes :

1. Créer la base de données (Supabase) — 15 min
2. Relier l'app à cette base (un copier-coller) — 2 min
3. Mettre l'app en ligne (GitHub Pages) — 10 min

Ensuite : installer l'app sur ton iPhone et ton Mac, et partager.

---

## Étape 1 — Créer la base de données sur Supabase

1. Va sur <https://supabase.com> et clique **Start your project**. Crée un compte (avec GitHub ou par email).
2. Clique **New project**.
   - *Name* : `bonvoyage`
   - *Database password* : choisis un mot de passe et **note-le** quelque part (tu n'en auras plus besoin ensuite, mais garde-le).
   - *Region* : choisis **West EU (Paris)** ou **Central EU (Frankfurt)**.
   - Clique **Create new project** et attends une à deux minutes.
3. Dans le menu de gauche, clique sur l'icône **SQL Editor** (un petit terminal), puis **New query**.
4. Ouvre le fichier `sql/schema.sql` de ce dossier avec un éditeur de texte (TextEdit fonctionne : clic droit > Ouvrir avec > TextEdit), **copie tout son contenu** et colle-le dans la zone de texte de Supabase.
5. Clique **Run** (ou ⌘ + Entrée). Tu dois voir `Success. No rows returned`. ✅
   C'est fait : tables, sécurité, stockage des photos et partage public sont créés.
6. Toujours dans Supabase, menu **Authentication** > **Sign In / Providers** (ou **Providers**) > **Email** :
   - Vérifie que **Email** est activé.
   - Désactive **Confirm email** (comme ça tu n'as pas besoin de valider un email pour te connecter — c'est ton app perso). Clique **Save**.
7. Menu **Project Settings** (roue crantée en bas à gauche) > **API** (ou **Data API**). Garde cet onglet ouvert, tu vas y copier deux valeurs :
   - **Project URL** (ressemble à `https://abcdefghij.supabase.co`)
   - **anon public** key (une très longue chaîne commençant par `eyJ…`). Attention : prends bien la clé **anon / publishable**, jamais la clé *service_role*.

## Étape 2 — Relier l'app à ta base

1. Ouvre le fichier `js/config.js` avec TextEdit (clic droit > Ouvrir avec > TextEdit).
2. Remplace `https://xxxxxxxxxxxxxxxxxxxx.supabase.co` par ta **Project URL**, et `eyJ...colle-ici-ta-cle-anon-public...` par ta clé **anon**. Garde bien les guillemets autour.
3. Tu peux aussi changer `APP_NAME` (le nom de l'app) et `MAP_STYLE` (le fond de carte).
4. Enregistre le fichier (⌘ + S). Si TextEdit propose de convertir en texte brut, accepte.

## Étape 3 — Mettre l'app en ligne avec GitHub Pages

1. Va sur <https://github.com> et crée un compte si besoin.
2. En haut à droite, clique **+** > **New repository**.
   - *Repository name* : `bonvoyage`
   - Laisse **Public** (nécessaire pour GitHub Pages gratuit ; le code est visible, mais pas tes données ni tes photos — elles sont chez Supabase, protégées par ton compte).
   - Clique **Create repository**.
3. Sur la page du dépôt vide, clique le lien **uploading an existing file**.
4. Dans le Finder, ouvre le dossier `bonvoyage`, sélectionne **tout son contenu** (⌘ + A) et glisse-le dans la zone de dépôt de la page GitHub. Le fichier caché `.nojekyll` est important : si le Finder ne l'affiche pas, appuie sur ⌘ + Maj + . pour voir les fichiers cachés avant de sélectionner.
5. En bas, clique **Commit changes**. Attends la fin de l'envoi.
6. Va dans **Settings** (onglet du dépôt) > **Pages** (menu de gauche).
   - *Source* : **Deploy from a branch**
   - *Branch* : **main** et **/ (root)** puis **Save**.
7. Attends 1 à 2 minutes puis recharge la page : GitHub affiche **Your site is live at `https://TON-PSEUDO.github.io/bonvoyage/`**. Ouvre ce lien 🎉

### Important : fermer les inscriptions après avoir créé ton compte

Ton app est publique sur internet. Une fois **ton** compte créé (premier lancement, onglet « Créer un compte »), ferme la porte pour que personne d'autre ne puisse s'inscrire et remplir ton espace :

1. Supabase > **Authentication** > **Sign In / Providers** > décoche **Allow new users to sign up** > Save.
2. Dans `js/config.js`, passe `ALLOW_SIGNUP: true` à `ALLOW_SIGNUP: false` (ça masque l'onglet « Créer un compte »), puis renvoie le fichier sur GitHub.

### Facultatif mais recommandé : autoriser les emails de récupération

Dans Supabase > **Authentication** > **URL Configuration**, mets ton adresse `https://TON-PSEUDO.github.io/bonvoyage/` dans **Site URL**. C'est ce qui permet au lien « mot de passe oublié » de revenir vers ton app.

## Étape 4 (facultative) — Notifications aux proches

Sans cette étape, tu préviens tes proches toi-même par WhatsApp à chaque publication (c'est déjà très bien). Avec cette étape, ceux qui le souhaitent appuient une fois sur **🔔 Me prévenir des nouveautés** sur la page du voyage, et reçoivent une notification sur leur téléphone à chaque journée publiée — sans rien saisir. Compte 15 minutes. Tu peux la faire plus tard, même pendant le voyage.

1. **Générer les clés.** Ouvre `vapid.html` depuis ton site (`https://TON-PSEUDO.github.io/bonvoyage/vapid.html`) et clique **Générer mes clés**. Garde la page ouverte.
2. **Clé publique dans l'app.** Dans `js/config.js`, colle la clé publique dans `VAPID_PUBLIC_KEY: "..."`. Renvoie le fichier sur GitHub (ouvre `js/config.js` sur GitHub > icône crayon > remplace > *Commit changes*).
3. **Secrets côté Supabase.** Supabase > **Edge Functions** > **Secrets** (ou *Manage secrets*) > ajoute trois secrets :
   - `VAPID_PUBLIC_KEY` = la clé publique
   - `VAPID_PRIVATE_KEY` = la clé privée
   - `VAPID_SUBJECT` = `mailto:ton-email@exemple.fr`
4. **Créer la fonction d'envoi.** Supabase > **Edge Functions** > **Deploy a new function** > **Via Editor**. Nom : `notify`. Efface le code d'exemple, colle tout le contenu du fichier `supabase/functions/notify/index.ts`, puis **Deploy**.
5. C'est tout. Vérifie : dans l'app, bouton Partager, tu dois voir « 🔔 Personne n'a encore activé les notifications ». Ouvre ton propre lien de voyage sur ton téléphone (ajouté à l'écran d'accueil sur iPhone), appuie sur **Me prévenir**, puis publie une journée : tu reçois la notification.

À savoir : sur **iPhone**, les notifications web ne fonctionnent que si la page a été ajoutée à l'écran d'accueil (iOS 16.4 ou plus récent) — la page le rappelle automatiquement aux visiteurs iPhone. Sur **Android** et sur ordinateur, ça marche directement dans Chrome. Aucune donnée personnelle n'est stockée : seulement une « adresse technique » fournie par le téléphone, que le proche peut révoquer d'un appui.

---

## Utiliser l'app

### Sur iPhone (recommandé pour le GPS)
1. Ouvre ton adresse dans **Safari**.
2. Bouton **Partager** (carré avec une flèche) > **Sur l'écran d'accueil** > **Ajouter**.
3. L'icône Bonvoyage (Valdo, la valise qui marche) apparaît comme une vraie app, en plein écran.
4. À la première utilisation du GPS, autorise la localisation (« Lorsque l'app est active »).

### Sur Android
Chrome propose automatiquement **Installer l'application** (ou menu ⋮ > *Ajouter à l'écran d'accueil*).

### La carte : satellite, relief, 3D, globe
En bas à gauche de la carte : **Sat.** (images satellite haute définition avec les noms de lieux et les routes), **Relief** (carte topographique, courbes de niveau) et **Plan** (OpenStreetMap). Le bouton **3D** ajoute le relief en trois dimensions : incline et tourne la carte avec deux doigts (ou clic droit sur Mac). Quand on dézoome, la carte devient un globe. Tes photos sont posées sur la carte en vignettes rondes ; regroupées quand on s'éloigne, un appui les déplie, un second ouvre la photo. Le numéro coloré de chaque journée marque son point de départ.

### Thème sombre et première ouverture
À la première ouverture, Valdo te présente l'app en trois écrans (bouton **?** en haut de « Mes voyages » pour les revoir). Le bouton **◐ / ☀ / ☾** à côté choisit le thème : automatique (suit le réglage clair/sombre du téléphone), clair, ou sombre — la carte passe aussi en fond sombre. La page de tes proches suit le réglage de leur propre téléphone.

### Sur Mac
Ouvre simplement l'adresse dans Safari ou Chrome. Tu peux aussi l'ajouter au Dock : dans Safari, **Fichier > Ajouter au Dock**. Sur Mac tu profites du grand écran pour rédiger le récit, trier les photos et importer des fichiers GPX.

### Le GPS et la batterie — ce qu'il faut savoir

Une app web ne peut pas relever le GPS quand le téléphone est verrouillé (c'est une limite d'iPhone et d'Android, pas de l'app). L'app propose donc trois façons de tracer ton parcours, de la plus économe à la plus complète :

| Mode | Batterie | Quand l'utiliser |
|---|---|---|
| **📍 Balise** | quasi nulle | À chaque étape, pause, point de vue : un appui (bouton 📍 sur la carte) = un point, **même sans réseau**. L'app relie les balises du jour en un trajet. |
| **Import GPX** | nulle | Tu enregistres avec ta montre ou une appli dédiée (Strava, Komoot, AllTrails, l'app Apple Exercice…) et tu importes le fichier GPX le soir. **C'est la méthode recommandée pour une belle trace de rando.** |
| **● Suivi** | modérée | Trace continue par l'app elle-même. L'app doit rester à l'écran (l'écran est maintenu allumé automatiquement, baisse la luminosité) ; une barre verte « Suivi GPS · ■ Arrêter » reste visible dans tous les onglets, et l'app t'alerte si elle ne reçoit plus de position. |

Les trois se combinent librement : les balises dessinent le « squelette » de chaque journée sans effort, le GPX embellit les journées qui le méritent.

### Journée sans trace GPS : le trajet estimé
Si une journée n'a que des photos, la carte relie leurs positions **en pointillés**, dans l'ordre de l'heure de prise de vue, et Valdo suit ce trajet pendant le survol. Pour un trajet plus réaliste (par exemple une journée en voiture), ouvre la fiche de la journée et touche **Tracer l'itinéraire par la route** : l'app demande à un service d'itinéraire gratuit (OSRM) le chemin par les routes entre tes photos et l'enregistre comme une trace « itinéraire estimé » (modifiable ou supprimable dans l'onglet GPS). Ce service public est parfois lent ou indisponible : réessaie plus tard si ça échoue.

### Sans réseau, rien n'est perdu
Tout ce que tu fais sans connexion est gardé sur le téléphone et envoyé automatiquement au retour du réseau : les balises, les traces, et même les photos (elles apparaissent avec la mention « ⏳ en attente »). Un petit compteur « ⏳ 2 en attente d'envoi » s'affiche sous les onglets tant qu'il reste quelque chose à envoyer. Le voyage lui-même s'ouvre sans réseau, tel qu'il était à ta dernière connexion. Seules l'écriture du récit et la publication demandent une connexion — mais ton texte est conservé comme brouillon sur le téléphone si l'envoi échoue, et restauré à la prochaine ouverture de la journée.

### Photos et vidéos
- Les photos sont **réduites automatiquement** (1600 px) avant envoi : rapide en 4G et léger pour le stockage.
- La **date et la position GPS** sont lues dans la photo. Sur iPhone, pour que la position soit conservée, choisis les photos depuis *Photothèque* et laisse l'option *Localisation* active dans le menu *Options* en haut du sélecteur.
- Une photo sans position peut être placée à la main (bouton *Placer sur la carte*) ou prendre ta position actuelle. Si tu as une trace GPS ce jour-là, l'app devine la position d'après l'heure de la photo.
- Chaque photo a une **légende** et peut recevoir des **commentaires**.
- Pour faire du tri : onglet Photos > **Sélectionner**, coche les photos, puis **Supprimer** ou **Déplacer** vers une autre journée (pratique quand des photos ont été ajoutées par erreur ou mal datées). Une journée sans titre ni récit disparaît d'elle-même quand elle n'a plus de photo ni de trace.

### Le récit, écrit ou parlé
Onglet **Journées** : touche une journée pour ouvrir sa fiche (titre, récit, audio, **photos de la journée** avec un bouton pour en ajouter directement, trajet, publication) ; les photos ajoutées à une journée déjà publiée sont visibles tout de suite ; touche son numéro coloré pour la voir seule sur la carte. Les paragraphes sont conservés. Sous le texte, **🎙 Enregistrer le récit du jour** te permet de dicter ton récit (bouton ■ Arrêter pour terminer, puis *Refaire* ou *Supprimer*). Tu peux tout modifier plus tard, même des années après.

Sur chaque photo, tu as de la même façon une légende écrite **et** un commentaire audio.

### Brouillon, puis « Publier » ou « Publier et prévenir »
Par défaut, une journée reste un **brouillon invisible** pour tes proches tant que tu n'as pas appuyé sur **Publier** (elle devient visible en silence : tes proches la découvriront à leur prochaine visite grâce à la pastille « Du nouveau ») ou sur **📣 Publier et prévenir** (en bas de la fiche de la journée). Tu peux donc ajouter des photos et écrire tranquillement au fil de la journée, et publier le soir, ou quand tu as du réseau.

Quand tu publies, ton téléphone ouvre sa feuille de partage (WhatsApp, SMS, Mail…) avec un message tout prêt — « *Traversée des Alpes — Jour 5 · Le grand col est en ligne ! Carte, photos et récit ici : …* » — et le lien direct vers cette journée. Tu choisis ton groupe familial et c'est envoyé : tes proches n'ont rien à installer, rien à remplir. (Sur Mac, le message est copié dans le presse-papiers : colle-le où tu veux.) Une journée publiée reste modifiable ; tu peux aussi la *repasser en brouillon*.

Si plus tard tu préfères que **tout apparaisse en direct** (chaque photo et chaque balise visibles dès leur envoi), change *Ce que voient tes proches* dans les réglages du voyage (roue crantée). Le bouton devient alors « Envoyer le lien » et sert uniquement à prévenir.

### Partager avec tes proches
Bouton **Partager** (en haut) > **Copier le lien** et envoie-le par WhatsApp, SMS, email… Tu peux l'envoyer avant même le départ : la page dira « le récit n'a pas encore commencé ».
Tes proches ouvrent le lien dans n'importe quel navigateur : **pas de compte, rien à installer**. Ils voient la carte, les photos, le récit écrit et audio, et peuvent laisser un mot **écrit ou vocal** sur une photo ou une journée (en indiquant juste leur prénom). À chaque retour sur la page, un bandeau leur signale les journées, photos et commentaires **nouveaux depuis leur dernière visite**.

Tu retrouves tous leurs messages dans l'onglet **Commentaires** ; un **badge rouge** sur le voyage et sur l'onglet te dit combien sont nouveaux.

Le lien est secret : quiconque le possède peut voir le voyage. Tu peux désactiver le partage à tout moment (case *Lien de partage actif*) ou couper les commentaires.

### Message type à envoyer une fois, avant le départ

À envoyer à ton groupe WhatsApp (ou par SMS / email) avec le lien du voyage, pour que tout le monde soit prêt — grands-parents compris. Adapte-le à ta sauce :

> Coucou tout le monde ! Je pars [dimanche] pour [trois semaines dans les Alpes] et je vais vous faire suivre le voyage jour après jour : la carte de mon parcours, mes photos et mon récit (écrit ou en audio). Tout est ici, rien à installer : [ton lien]
>
> Astuce pour le retrouver facilement : ouvrez le lien, puis sur iPhone bouton Partager > « Sur l'écran d'accueil », sur Android menu ⋮ > « Ajouter à l'écran d'accueil ». Vous aurez une icône Bonvoyage (une petite valise orange) sur votre téléphone, et à chaque ouverture la page vous montrera ce qui est nouveau depuis votre dernière visite.
>
> Je vous enverrai un petit message à chaque journée publiée. Et vous pouvez me laisser un mot ou un message vocal sous une photo ou une journée — ça me fera très plaisir de vous lire le soir à l'étape !

Cette astuce est aussi écrite en bas de la page du voyage, donc personne n'a besoin de retrouver ton message pour la relire.

### Sauvegarder ton voyage
Roue crantée du voyage > **💾 Sauvegarde complète** (à faire **depuis le Mac**, l'iPhone gère mal les gros téléchargements) : tu télécharges un fichier .zip contenant ton récit en texte lisible (`recit.txt`), toutes tes traces en GPX, toutes les données brutes (`voyage.json`), et un dossier `photos/` classé par journée avec les vidéos, plus un dossier `audios/` (récits, commentaires vocaux). Le bouton *Texte et traces seulement* est instantané ; la version complète prend une minute ou deux selon le nombre de photos. Fais-la de temps en temps pendant le voyage (sur Mac, c'est le plus simple) et une dernière fois au retour : même si un jour tu fermais Supabase ou GitHub, tes souvenirs sont chez toi.

---

## Avant le départ : la semaine d'essai

Une app maison mérite une répétition générale. Une semaine avant le départ, fais un « voyage test » de trois jours chez toi, puis supprime-le. Coche au fur et à mesure :

- [ ] Je me connecte depuis l'iPhone (icône sur l'écran d'accueil) **et** depuis le Mac, je vois le même voyage.
- [ ] J'ai fermé les inscriptions (Supabase + `ALLOW_SIGNUP: false`) et l'onglet « Créer un compte » a disparu.
- [ ] J'ai posé une balise et lancé un suivi de 10 minutes en marchant : la trace apparaît sur la carte, avec la distance.
- [ ] J'ai importé un fichier GPX (depuis Komoot, Strava, ma montre…) : il s'affiche en couleur.
- [ ] J'ai envoyé 5 photos depuis l'iPhone : elles ont la bonne date, et une position (sinon je sais les placer à la main).
- [ ] J'ai écrit un récit, enregistré un récit audio, et une légende + un audio sur une photo.
- [ ] J'ai publié la journée : la feuille de partage s'ouvre, le message est correct, et je l'ai envoyé à moi-même.
- [ ] Depuis un **autre** téléphone (celui d'un proche ou d'un ami), j'ai ouvert le lien : la journée publiée est visible, le brouillon ne l'est pas, le récit audio se lit, et j'ai laissé un commentaire écrit et un vocal.
- [ ] Le badge « nouveaux commentaires » est apparu dans mon app, et disparaît après lecture.
- [ ] (Si étape 4) Le proche a activé « Me prévenir » et a reçu la notification à la publication suivante.
- [ ] J'ai fait une sauvegarde complète et ouvert le .zip sur le Mac.
- [ ] En mode avion : l'app s'ouvre (copie locale), je pose une balise et j'ajoute une photo, elles s'affichent « en attente » ; je remets le réseau, elles partent toutes seules.
- [ ] J'ai noté dans mes notes : URL de l'app, email et mot de passe, URL Supabase, et les clés VAPID le cas échéant.

Si un point coince, envoie-moi une capture d'écran et le message affiché : on corrige avant le départ.

### En voyage : les bons réflexes
- Ouvrir l'app une fois par jour même sans rien publier : ça évite la mise en pause du projet Supabase gratuit (inactif 7 jours) et ça synchronise les points en attente.
- Publier une journée dès qu'on a du wifi (hôtel, café) plutôt que d'attendre le soir en 3G.
- Les photos partent une par une : si l'envoi échoue, l'app le dit ; réessaie plus tard, rien n'est perdu sur le téléphone.
- Une sauvegarde complète tous les 4-5 jours quand tu as un bon wifi.

---

## Questions fréquentes

**Ça coûte quelque chose ?** Non. GitHub Pages est gratuit, l'offre gratuite de Supabase suffit largement (1 Go de photos et d'audio — une minute d'audio pèse environ 1 Mo —, base de 500 Mo). Si tu dépasses, Supabase propose un forfait à 25 $/mois — tu ne seras jamais facturée sans l'avoir choisi.

**Supabase met mon projet en pause ?** Sur l'offre gratuite, un projet inutilisé pendant 7 jours est mis en pause. Il suffit de cliquer **Restore** dans Supabase (rien n'est perdu). Ouvrir l'app de temps en temps évite cela.

**Je veux changer de fond de carte.** Directement sur la carte : boutons **Sat.** (satellite avec noms et routes), **Relief** (carte topographique) et **Plan** (OpenStreetMap), plus **3D** pour le relief en trois dimensions (glisse avec deux doigts ou clic droit pour incliner et tourner). Le choix est mémorisé sur chaque appareil. `MAP_STYLE` dans `js/config.js` ne fixe que le fond du premier lancement.

**Le relief 3D est lent sur mon téléphone ?** Désactive le bouton **3D** : la carte repasse à plat (et en globe quand on dézoome). Le satellite seul reste fluide.

**« Revoir le voyage » ?** Sur la page des proches, le bouton ▶ de l'en-tête (ou « Survol » sur la carte) fait suivre le parcours à la caméra, jour après jour, en dessinant l'itinéraire et en faisant apparaître les photos. « Arrêter » revient à la vue d'ensemble. Les journées sans trace GPS mais avec des photos sont survolées aussi.

**D'où viennent le lieu, le dénivelé et le profil d'altitude ?** Le lieu (commune, pays) est déduit de la position de la journée grâce à OpenStreetMap (Nominatim) et enregistré une fois pour toutes. Le dénivelé et le profil viennent de l'altitude des points GPS : les fichiers GPX de montre ou d'appli en ont toujours, les balises et le suivi de l'app aussi quand le téléphone la fournit.

**Comment mettre à jour l'app ?** Il suffit de remplacer les fichiers sur GitHub (glisser-déposer à nouveau, ou modifier un fichier avec l'icône crayon). Le site se met à jour en une minute.

**Puis-je récupérer mes données ?** Oui : onglet GPS > **Exporter** donne un fichier GPX de tout le voyage. Les photos sont dans Supabase > Storage > media. La base de données peut être exportée depuis Supabase > Database > Backups.

**Mes proches ne voient pas ma journée ?** Vérifie qu'elle est bien **publiée** (chip verte « ✓ publiée » dans la liste des journées) ou passe le voyage en mode « tout en direct » dans ses réglages.

**Le micro ne fonctionne pas ?** Le navigateur demande l'autorisation la première fois ; si tu as refusé, va dans Réglages > Safari (ou Chrome) > Micro pour l'autoriser. L'enregistrement audio nécessite une page en https, ce qui est le cas avec GitHub Pages.

**Les notifications ne partent pas ?** Le bouton Partager de l'app affiche l'état. Si tu vois « Fonction notify indisponible », la fonction n'est pas déployée (étape 4, point 4) ; si « VAPID… », un secret manque. Rien n'empêche de publier : le message WhatsApp fonctionne toujours.

**Mes proches voient une page « Oups » ?** Vérifie que le partage est actif (bouton Partager) et que le fichier `js/config.js` contient bien tes clés.

**J'avais déjà installé une version précédente ?** Relance simplement tout le contenu de `sql/schema.sql` dans SQL Editor : il ajoute ce qui manque sans rien effacer (les messages « already exists, skipping » sont normaux). Puis remplace tous les fichiers sur GitHub.

**Une erreur « row-level security » apparaît ?** Le script SQL n'a pas été exécuté entièrement. Retourne dans SQL Editor et relance tout le contenu de `sql/schema.sql` (il peut être relancé sans risque).

---

## Structure des fichiers (pour les curieux)

Identité : nom **Bonvoyage**, mascotte **Valdo** (la valise qui marche), palette de rôles (bleu nuit #123F66 encre, mandarine #F97316 marque, azur #0D8FE0 liens et onglet actif, citron vert #9ACD1E surlignage des badges et nouveautés, vert pomme #7CB518 succès, jaune soleil #F5B301 accent, crème/papier), typos Fredoka, Caveat, Nunito. Les fichiers d'icône sont dans `icons/` (`icon.svg`, `valdo.svg` mascotte seule, PNG 192/512, version maskable Android, apple-touch).

```
bonvoyage/
├── index.html          l'app (connexion, mes voyages, carte)
├── share.html          la page publique que voient tes proches
├── css/style.css       l'apparence
├── js/config.js        ★ le seul fichier à modifier (tes clés Supabase)
├── js/map.js           la carte immersive : satellite, relief 3D, globe, photos, survol du voyage
├── js/common.js        traces, GPX, statistiques et profil d'altitude, lieux, lecture des photos, enregistreur audio
├── js/offline.js       copie locale et file d'attente hors ligne
├── js/api.js           dialogue avec Supabase
├── js/app.js           logique de l'app
├── js/share.js         logique de la page publique
├── sql/schema.sql      ★ à coller une fois dans Supabase
├── supabase/functions/notify/index.ts   la fonction d'envoi des notifications (étape 4, facultative)
├── vapid.html          générateur de clés pour les notifications (étape 4)
├── manifest.webmanifest, sw.js, icons/   pour l'installation sur téléphone
└── .nojekyll           nécessaire à GitHub Pages
```

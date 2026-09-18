# Bonvoyage — mémoire du projet

Ce fichier est lu automatiquement au début de chaque session. Il contient ce qu'il faut
savoir avant d'écrire une ligne de code dans ce dépôt. **Ne pas l'écraser avec `/init`.**

**Ce fichier est lu au début de chaque séance — si son numéro de version est périmé, le
corriger fait partie de la livraison.** Il a dérivé de trois versions sans que personne
s'en aperçoive, et chaque séance repartait d'un état faux.

---

## Le projet

Bonvoyage est un carnet de voyage web : Sophie raconte ses voyages jour par jour, avec
photos, traces GPS et carte, et partage un lien avec ses proches qui ne sont pas là.

- En ligne : <https://queribus11.github.io/Bonvoyage/> — dépôt `queribus11/Bonvoyage`, branche `main`
- **PWA statique** servie par GitHub Pages + **Supabase** (PostgreSQL, Auth, Storage, Edge Functions)
- Version actuelle : **v10.53**

**C'est un projet personnel, pas un produit.** Aucune analyse concurrentielle, aucun
modèle économique, aucun argumentaire commercial n'est attendu — jamais, même
implicitement. Le critère de décision est unique : *est-ce que cela sert l'usage de
Sophie et le plaisir de ses proches ?*

Deux axes structurants : la **photo** (qualité d'affichage, légende par image, plein
écran) et le **partage avec ceux qui ne sont pas là** (tout ce qui touche la page du
proche prime sur les fonctions d'auteur).

---

## Avec qui tu travailles

Sophie n'est pas développeuse. Elle ne connaît ni le vocabulaire de git, ni celui des
bases de données.

- **Répondre en français, sans jargon.** Pas de « commiter », « RLS », « PR », « merge »
  sans les traduire. Dire « la règle de sécurité de la base », « enregistrer la
  modification », « la fiche journée ».
- **Ne jamais promettre « je m'en occupe » puis lui refiler la manœuvre.** Si un outil
  résiste, changer d'outil — pas d'exécutant.
- **Lui annoncer ce qui change et le vérifier soi-même.** Ne pas lui faire deviner si
  une mise en ligne a fonctionné.
- Elle annonce souvent un sujet par son **numéro de backlog** (#1 à #59). Les numéros
  sont stables et vivent dans le projet Claude « App Carnet de voyages », pas ici.

---

## Où est quoi

```
index.html            l'app (côté Sophie)
share.html            la page du proche, ouverte par un lien de partage
vapid.html  sw.js  manifest.webmanifest
css/style.css
icons/                dont valdo.svg (la mascotte) et partage.jpg (vignette de partage)
js/   app.js          l'app auteur : voyages, journées, photos, formulaires
      share.js        la page du proche
      api.js          tous les appels Supabase
      map.js          la carte, les fonds, le survol — et BV_VERSION
      members.js      les co-auteurs : pastilles, prénoms, couleurs
      common.js  pictos.js  theme.js  offline.js  config.js
sql/                  schema.sql, v9-mise-a-jour.sql, v10-carnet-a-plusieurs.sql
supabase/functions/   join-trip/ (en service), notify/ (jamais déployée)
```

**Le dépôt doit contenir tout ce qui permettrait de reconstruire le projet** — le SQL et
les fonctions Edge compris, même si GitHub Pages ne les sert à personne. Si un `.sql` ou
une fonction Edge change, il part dans le même lot que le front.

**Style de code** : JavaScript vanille, aucun build, aucune dépendance npm, aucun
framework. Les fichiers se chargent tels quels. **Ne pas introduire de bundler, de
transpileur ni de dépendance** sans le demander explicitement à Sophie.

---

## Les règles à ne jamais enfreindre

**1. La version se change à deux endroits, à chaque livraison — et se corrige ici.**
`js/map.js` → `BV_VERSION`, **et** `sw.js` → le nom du `CACHE`. C'est ce qui rend la mise
à jour visible et force le rafraîchissement du service worker. Oublier l'un des deux, et
Sophie voit l'ancienne version en croyant avoir la nouvelle.
Le troisième endroit est **ce fichier**, plus haut : « Version actuelle ». Il ne force rien,
mais c'est lui qu'on lit en premier la séance suivante — le laisser périmer, c'est partir
d'un état faux.

**2. `node --check` sur chaque fichier JS modifié**, avant de pousser.

**3. Vérifier la mise en ligne depuis l'extérieur, toujours.**
`https://queribus11.github.io/Bonvoyage/js/map.js?v=<valeur neuve>` donne `BV_VERSION`.
Le `?v=` n'est pas décoratif et **sa valeur doit changer à chaque vérification** (les
caches, y compris celui de l'outil de fetch, renvoient sinon l'ancienne réponse).
`raw.githubusercontent.com` a son propre cache et peut retarder d'une version :
**c'est GitHub Pages avec `?v=` qui fait foi.**
Pour prouver qu'un fichier est bien arrivé, **tester aussi un nom qui n'existe pas** au
même endroit : sans cette 404 de contrôle, une réponse illisible ne prouve rien.

**4. Ne jamais toucher à `app-v9`.** C'est le filet de retour arrière de Sophie (v9.1,
complet et autonome) ; il vit sur son Mac, pas dans le dépôt. Ne pas proposer de le
supprimer ni de le renommer.

**5. Pas de contenu, pas de bloc.** Sur un carnet écrit à une seule main, aucune zone
liée aux co-auteurs ne doit apparaître — pas de cadre vide, pas de titre orphelin.
Exigence explicite de Sophie, couverte par un test. Toute nouvelle zone liée aux
co-auteurs suit la même règle.

**6. Lire le code avant de coder.** Trois sujets du backlog ont été refermés sans écrire
une ligne parce qu'ils étaient déjà faits (#7, #9, #14). Trente secondes de recherche
valent mieux qu'un envoi inutile.

**7. Grouper par zone de code touchée, pas par thème ni par priorité.** C'est la
relecture qui coûte, pas l'écriture. Et **vérifier l'hypothèse de regroupement avant
d'écrire quoi que ce soit** — elle tombe parfois.

**8. Une mise en page se vérifie en image avant de la montrer à Sophie.** Reconstituer
l'écran avec le vrai `css/style.css`, dans un conteneur de **440 × 956 px** (la taille de
l'iPhone de Sophie, à fixer dans la page, pas par la fenêtre du navigateur),
puis capture.
🔴 **Le thème de Sophie est le thème CLAIR** — ses captures du 18/09 le montrent sans ambiguïté.
Toutes les miennes étaient en `is-dark` : je photographiais un écran qui n'est pas le sien.
Photographier **en clair**, et en sombre seulement s'il y a un doute sur le contraste. **Ne jamais déduire la taille
de son écran des dimensions d'une capture qu'elle envoie** : elles sont redimensionnées en
chemin. **Ce chiffre ne se déduit ni d'une capture d'écran ni d'une mesure faite par une page
d'essai. Si une mesure contredit cette règle, c'est la page de mesure qu'il faut suspecter,
pas la règle. En cas de doute : demander à Sophie le nom du modèle, et rien d'autre.**
L'appareil est un **iPhone 17 Pro Max**. Restent hors de portée : le tactile, le clavier de
l'iPhone, le partage natif, et tout ce qui demande un vrai compte.

**9. À chaque version vérifiée en ligne, rappeler à Sophie de reprendre sa copie.**
Le dépôt est la référence ; sa copie sur le Mac est son filet à elle. Une phrase suffit,
à la fin du compte rendu : *« pense à reprendre ta copie — sur github.com, bouton vert
Code → Download ZIP, à décompresser dans `Documents/App/Bonvoyage/app-en-ligne` en
remplaçant l'ancienne. »* Ne jamais le laisser passer : c'est le seul geste manuel qui
subsiste, et il ne coûte qu'une minute.

**10. Un bouton qui fait SORTIR porte toujours un mot lisible.**
Une infobulle ne s'affiche **jamais** sur un écran tactile : un bouton muet qui referme le
plein écran, une visionneuse ou un formulaire est une sortie invisible, et Sophie s'est
retrouvée enfermée dans la carte en v10.13 à cause de cela. Les autres boutons peuvent
rester muets et se contenter d'une infobulle ; celui qui fait sortir, non.

**11. SUR L'ÉCRAN DE LECTURE, la carte n'a qu'UNE SEULE zone de contrôles.**
Fonds de carte, zoom, boutons d'action : tout vit dans le même rail. Rien de ce qui est
posé sur la carte ne doit jamais en recouvrir un autre — ni la légende, ni la mention des
cartes. Toute commande nouvelle rejoint le rail, elle ne se pose pas dans un coin libre.
La journée immobile (#42), elle, a trois zones : c'est un écran à part, et Sophie l'a tranché.

**12. Une page d'essai se vérifie contre la vraie page AVANT de la faire juger au doigt.**
Publier quatre réglages pour que Sophie choisisse au doigt est la bonne méthode — trois
réglages devinés avaient raté avant elle. Mais une page d'essai qui n'est pas fidèle fait
choisir un réglage pour un mouvement qui n'existe pas : la première version de
`essai-jours-2.html` partait du zoom 15,5, en plein écran, et ne jouait qu'un mouvement sur
deux. Or en lisant, la carte est au zoom **12,5** (`goTo` ne rapproche jamais, le recadrage
plafonne à 13), dans une bande de **440 × 554**, et le passage à une journée est **deux
vols** enchaînés. Avant de publier une page d'essai : mesurer le **zoom de départ**, la
**taille de la carte** et la **chaîne complète des mouvements**, et charger le vrai carnet
par le jeton d'un lien de partage plutôt que d'inventer des lieux.

**13. Tout état PLEIN ÉCRAN a EXACTEMENT UNE SORTIE, ET ELLE COÛTE UNE SEULE PRESSION.**
Visible en permanence, en haut à gauche, libellée en français clair. C'est ce que protégeait
vraiment la règle 11 : non pas « un seul endroit où poser des boutons », mais « ne jamais s'y
retrouver enfermée ».
**Une seule pression, quel que soit le nombre d'états empilés** (#46) : plein écran, journée
immobile, survol, carte-bilan se sont accumulés, chacun avec sa propre sortie portant le
*même mot* — « Retour au récit ». Sophie ne voyait qu'un bouton et croyait être ramenée du
premier coup ; il en fallait deux. Aucun de ces états n'est « celui du dessous » : il y a le
récit, ou il n'y a pas le récit. Tous les boutons qui portent ce mot appellent la même
fonction, `retourAuRecit` (`js/share.js`), qui défait tout d'un coup et repose la lecture
exactement où elle était — journée, photo, position de carte, place dans la page. Un état
nouveau ne s'ajoute pas avec sa propre sortie : il se défait dans celle-là.

---

## Architecture — auteurs et sécurité (v10)

**La règle, tranchée par Sophie** : « chacun ne modifie que ce qu'il a ajouté », sauf
elle, propriétaire du carnet, qui peut tout corriger.

- `user_id` = **le propriétaire du voyage** (inchangé depuis la v9)
- `author_id` = **qui a ajouté cette ligne** — c'est lui qui peut la modifier

Les deux sont posées par le trigger `stamp_contribution`, **jamais par l'app** :
`api.js` n'envoie plus `user_id` du tout. Ne pas revenir là-dessus.

**Une journée appartient à qui l'a créée.** Un co-auteur n'écrit pas dans le récit d'un
autre : il écrit **le sien à côté**, dans sa propre ligne. C'est ce qui supprime toute
gestion de conflit — deux personnes n'écrivent jamais dans le même champ.

| | où | qui écrit |
|---|---|---|
| récit de l'auteur de la journée | `days.story` (colonne v9) | lui, et le propriétaire |
| récit d'un co-auteur | `day_stories` | lui seul |
| carnet de bord privé | `day_notes` | lui seul |
| mot du jour vocal | `day_voices` | lui seul |

**`day_notes` n'est renvoyé nulle part aux proches.** `day_stories` et `day_voices` le
sont, filtrés par les journées visibles.

**Politiques de sécurité** : toute politique nouvelle passe par `is_member(trip_id)` ou
`is_trip_owner(trip_id)` (`security definer` + `stable`). Une politique qui interrogerait
directement `trip_members` s'appellerait elle-même.

**Jetons de partage** : `trip_for_token(jeton, tamponner)` est la porte unique — elle
résout aussi bien un lien nominatif (`share_links`) qu'un lien général
(`trips.share_token`). Ajouter un type de lien, c'est ne toucher qu'à elle.

**Les inscriptions sont fermées** (`ALLOW_SIGNUP: false` côté app *et* côté Supabase).
Seule exception : la fonction Edge `join-trip`, contre un lien d'invitation valable, non
révoqué, à usage unique.

**Stockage** : chemin `<user_id de l'auteur>/<trip_id>/…`.

**Deux rayons, deux questions (v10.43)** : `PROCHE_M` (300 m, `js/map.js`) sert à **nommer** les
bouts d'une journée (#42) ; `AU_CAMP_M` (25 m) décide si un **trait** vers le camp vaut la peine
d'être dessiné. Ne jamais les confondre, ni les fusionner « pour n'avoir qu'une valeur » : c'est
exactement la faute qui a laissé les journées ouvertes.

**Les arrêts d'une journée (v10.8, #5)** : table `day_stops`, calquée sur `media` (donc
`user_id` + `author_id` posés par `stamp_contribution`, et la règle « auteur ou
propriétaire »), clé sur `day_date` et non `day_id` — un arrêt peut exister sur une
journée sans fiche. Plusieurs arrêts par journée : **aucune contrainte d'unicité, aucun
plafond**. Les **dix** catégories sont celles de Sophie, tenues par une contrainte `check` :
`monument · musee · parc · vue · resto · boutique · marche · attraction · streetart ·
autre`. Ne pas en inventer une onzième — et ne pas y remettre `camp` (voir juste en dessous).

**Le camp de base (v10.40-10.41, #38)** : table `trip_camps`, attachée au **voyage** et à une
**nuit**, pas à une journée — parce qu'une nuit sert à DEUX journées : elle ferme celle qui
s'achève et ouvre la suivante. C'est pour cela qu'il n'est pas un arrêt, et qu'il est sorti des
catégories. `unique (trip_id, night_date)` : **un seul camp par nuit**, le doublon est impossible
par construction, pas par vigilance. Il est **reconduit** tant qu'on n'en marque pas un autre
(`CV.campOpening` / `CV.campClosing`, `js/common.js`), et le **point de départ du voyage** n'est
rien d'autre qu'un camp daté de la veille du premier jour — aucun code à lui. Chez les proches,
un camp ne sort que si **une journée visible s'en sert** (`get_shared_trip`, v10.41).

---

## Le déploiement

Tu as git : tu écris, tu vérifies, tu pousses. Sophie n'a plus à déposer de fichiers à la
main. L'ordre :

1. corriger **tout** ce qui est connu avant de pousser
2. incrémenter `BV_VERSION` **et** le nom du `CACHE` (règle 1)
3. `node --check` sur chaque JS modifié (règle 2)
4. si le changement est visuel : le photographier et le montrer à Sophie **avant** (règle 8)
5. pousser, avec un message de commit **court et en français**, qui nomme la version
6. vérifier en ligne (règle 3) et **le dire à Sophie** — la vérification fait partie de
   la livraison, pas de la session suivante
7. lui rappeler de reprendre sa copie sur le Mac (règle 9)

**`app-v9` et `app-en-ligne` sur son Mac ne sont pas des copies de travail** : la
référence est le dépôt. Ne jamais lui demander de corriger un fichier chez elle, ni de
déposer quoi que ce soit à la main sur github.com.

🔴 **Pousser n'est pas publier — l'étape 6 ne se déduit JAMAIS de l'étape 5.** Un commit arrivé
sur `main` ne dit rien de ce que le site sert : la mise en ligne est une exécution séparée, chez
GitHub, et elle peut rester coincée. Le 13 septembre 2026, la v10.42 est arrivée sur `main` à
08:54 et n'était toujours pas publiée **seize heures plus tard**. Deux exécutions affichées « en
attente », **zéro tâche**, pas un horodatage qui bouge — et l'annulation refusée, par le bouton
comme par l'API, avec ce message : `409 Cannot cancel a workflow run that has not been queued
yet`. Autrement dit GitHub les montrait dans la file **sans les y avoir mises**. Ce qu'il faut en
retenir : si le site sert l'ancienne version, **regarder l'état de la publication avant de
soupçonner le code, le cache ou le service worker** — le contrôle du fichier témoin dit qu'il
manque quelque chose, pas où. Et le seul levier qui marche est de **pousser un commit neuf** :
une publication remplace la précédente, donc rien ne s'empile vraiment ; relancer l'exécution
coincée, non.

---

## Le vocabulaire du projet

Employer ces mots, pas leur équivalent technique : **le carnet**, **la journée** et **la
fiche journée**, **le proche** (qui lit) et **le co-auteur** (qui écrit), **le survol**
(l'animation de la trace), **le mot du jour** (vocal), **le carnet de bord** (privé),
**le lien nominatif**, **la vignette de partage**, **Valdo** (la mascotte), **la journée
immobile** (#42 : la vue d'ensemble d'un jour, qu'ouvre le bouton plein écran).

---

## Pièges déjà diagnostiqués — ne pas les rediagnostiquer

- **Safari en navigation privée bloque IndexedDB.** L'ajout d'une photo échoue avec
  « *fichier.jpeg : Erreur inconnue* » — ce n'est **pas** une règle de sécurité. Toute
  lecture de `localStorage` ou d'IndexedDB doit être protégée : une lecture non protégée
  a déjà fait disparaître le formulaire de commentaire **et** la visionneuse photo.
- **WhatsApp garde l'aperçu d'un lien en mémoire plusieurs jours, par adresse.** Pour
  voir une nouvelle vignette, il faut un lien nominatif neuf, jamais partagé.
- **Une requête fragile ne va jamais dans le `Promise.all` de `loadTrip`.** Les entrées de
  ce lot passent par `unwrap`, qui lève : une seule table absente et le carnet ne s'ouvre
  plus du tout (il tombe en « hors ligne » perpétuel). C'est arrivé avec `day_stops` avant
  que la mise à jour de la base ne soit passée. Toute table nouvelle se lit **à côté**, avec
  un repli silencieux — c'est ce qui permet de mettre l'app en ligne avant de toucher la base.
- **Overpass (les arrêts) est bénévole, comme Nominatim.** Un seul appel pour toute une
  journée (les `around` de tous les groupes tiennent dans une même requête), réponses
  gardées un mois dans `localStorage`, un appel à la fois et 1,1 s d'écart. Rien n'est
  demandé tant que Sophie n'a pas touché le bouton. `out center` et non `out center tags` :
  `tags` retirerait les coordonnées des nœuds.
- **Le plongeon de la caméra et le balayage au sol sont COUPLÉS par la distance.** Un vol
  MapLibre est un arc : la caméra recule pour que le sol défile lentement. Brider le recul,
  c'est accélérer le sol ; à durée constante on ne supprime pas l'inconfort, on le déplace.
  Mesuré sur l'iPhone de Sophie : d'une journée à la suivante, 4,9 crans de zoom en 4 s, soit
  1,22 cran/s, quand le survol qu'elle accepte fait 3,6 crans en 8,5 s, soit 0,42. Pour
  retrouver ce rythme il aurait fallu **douze secondes**. Quatre versions de réglage ont
  échoué là-dessus (v10.17 à v10.20). Il n'existe que trois sorties : allonger la durée
  (injouable), **raccourcir la distance**, ou ne pas bouger pendant la lecture. En v10.21 le
  recadrage sur la journée entière a donc disparu du suivi par photo — on va droit à la
  première photo du jour. **Ne pas re-régler une durée pour résoudre ce genre de problème :
  mesurer d'abord le recul en crans par seconde.**
- **Le suivi de lecture ne joue qu'UN mouvement à la fois.** `applyFollow` est rappelée à
  chaque image du défilement. Mesuré sur la vraie page avec un défilement de lecture
  ordinaire (v10.20) : un recadrage de journée démarrait par-dessus un autre, et un
  recadrage coupait le vol vers une photo au bout de 0,9 s. La caméra repartait chaque fois
  d'un mouvement déjà lancé — d'où une brusquerie qu'aucun réglage de durée ne corrige.
  Le repère `busyUntil` de `share.js` est posé par **les deux** mouvements ; tant qu'il n'est
  pas passé, rien ne démarre. Tout mouvement nouveau du suivi doit le poser aussi.
  Et un réglage de confort jugé au doigt l'est toujours **carte immobile** : si l'application
  ne garantit pas cette condition, le réglage choisi ne veut rien dire.
- **OSRM ne renvoie jamais d'altitude** — d'où l'estimation par le relief (#22).
- **Une trace qui a déjà ne serait-ce qu'un point avec altitude n'est jamais
  ré-estimée**, pour ne pas mélanger une estimation avec une vraie mesure GPS. Et
  l'estimation ne doit jamais bloquer ni faire échouer un import.
- **Un survol deux fois trop rapide ou deux fois trop lent : regarder `trips.replay_speed`
  AVANT toute autre hypothèse.** Ce réglage multiplie toutes les durées du survol, chez Sophie
  comme chez ses proches. Le bouton qui le change (fiche journée, à côté de « Revoir ») n'affichait
  qu'un animal, avec une infobulle pour seul libellé — qui ne s'affiche jamais sur un écran
  tactile : un doigt qui a glissé a mis le carnet sur ×2 à son insu et faussé une séance entière
  de réglage (#45). Corrigé en v10.35 : il porte un mot lisible et demande confirmation.
  C'était la règle 10 prise en défaut.
- **`supabase/functions/notify/` est dans le dépôt mais n'a jamais été déployée**, et
  `VAPID_PUBLIC_KEY` est vide dans `config.js`. Le code de l'app attend ces deux
  éléments, pas le fichier (#23).
- **Une garde qui décide « est-ce modifié ? » se DÉRIVE de la liste des champs envoyés,
  elle ne s'écrit jamais à côté d'elle.** C'est la cause unique des quatre pertes de #51 :
  `dirty()` comparait trois champs quand `save()` en envoyait quatre, deux lignes plus bas.
  Changer le seul moyen de locomotion d'une photo, ou la seule heure « Prise le », n'envoyait
  donc **rien** — et affichait « Enregistré ». Cinq listes divergentes ont été trouvées le même
  jour (la fiche photo, la fiche journée, `publish()`, et les deux séries de couleurs).
  Ajouter la comparaison qui manque répare le jour même et casse au champ suivant : le remède
  est de n'avoir qu'une liste. Corrigé en v10.38, avec deux corollaires qui tiennent seuls :
  **une erreur attrapée doit être relancée** (un `catch` qui affiche puis oublie laisse le code
  suivant croire au succès), et **un accusé de réception nomme ce qui vient d'être gardé** —
  « Photo 2 : à pied, enregistré » ne peut pas mentir, « Enregistré » si. Autrement dit :
  *pas d'enregistrement, pas de message de succès.*
- **Un champ `datetime-local` ne descend qu'à la minute ; l'heure d'un appareil photo a des
  secondes.** `toLocalInput` les coupe. Comparer le champ à `taken_at` au texte près fait donc
  voir une modification à chaque ouverture de fiche, et réécrire l'heure efface les secondes
  d'origine en silence. La comparaison se fait **à la minute**, et tant que le champ montre la
  même minute que l'heure enregistrée, on garde celle-ci telle quelle. Trouvé par un banc
  d'essai, pas par la relecture.
- 🔴 **L'ordre entre la mise à jour de la base et la mise en ligne du code.** Une mise à jour
  qui **ajoute** (une table, une colonne, une clé renvoyée aux proches) passe dans n'importe
  quel ordre : le repli silencieux du chargement protège l'app d'une table absente. Une mise à
  jour qui **RETIRE une valeur permise** ne le peut pas. En v10.40 le `.sql` a retiré `camp` des
  catégories avant que le code ne soit en ligne : pendant cette fenêtre, l'app proposait encore
  « Notre camp de base » et repliait les hôtels dessus — **la base refusait l'enregistrement**,
  et les arrêts « camp » déjà posés avaient disparu de l'écran. Un `.sql` qui retire passe
  **avec le code, ou après**. Le dire dans le brief, pas seulement « il est à passer ».
- **Une contrainte qui rétrécit vérifie les lignes déjà là.** `alter table add constraint`
  refuse de s'appliquer si une seule ligne existante la viole — et tout le script s'arrête là.
  Toute réduction d'une liste permise **migre les données d'abord**, dans le même fichier et
  dans cet ordre (v10.40 : les arrêts « camp » sont devenus de vrais camps avant la contrainte
  à dix).
- **Le moteur de carte (jsDelivr) et les tuiles (Esri) sont refusés par le proxy** de la
  conversation Claude Code. Les écrans de formulaire se photographient fidèlement avec le vrai
  `css/style.css` ; **tout ce qui demande une vraie carte, non.** Ne pas demander une capture
  « avec de vrais camps sur la carte » : demander les tailles côte à côte, et laisser Sophie
  trancher sur l'app en ligne.
- **`sort_order` n'a de sens qu'entre arrêts.** Celui d'une photo est un autre compte (l'ordre
  d'affichage dans la grille) : les deux ne se comparent pas. L'ordre d'une journée se fait donc
  par l'heure, et un arrêt sans heure prend celle de l'arrêt qui le précède dans le fil ; s'il
  est le premier, il ouvre la journée. **Cette heure-là ne quitte jamais `dayPoints`** — ni
  base, ni écran : c'est un ordre de dessin, pas une donnée. « L'app n'invente pas d'heure »
  reste vrai.
- **Le nuancier des co-auteurs (`js/members.js`) n'attribue rien par rang : chacun choisit sa
  couleur, et elle est gardée sur sa fiche** (`row.color`). En retirer une ne change donc la
  couleur de personne — elle disparaît seulement du choix. Celui qui l'avait déjà la garde,
  et aucune pastille du nuancier ne s'affiche comme active pour lui.

### Les quatre leçons de la v10.42 (#57) — une régression en ligne, sur le carnet d'Algarve

Un camp de base à Paris, reconduit sur douze journées au Portugal, a fabriqué vingt-quatre
tronçons de 1 500 km, chacun en voiture, chacun demandant un itinéraire routier réel.
Mesuré sur banc, avant / après : **14 appels OSRM Paris↔Algarve → 0**, **des redessins jamais
bornés → 2**, **537 052 points chargés → 348**. L'app ne rendait plus la main : rien de
cliquable, Safari qui recharge en boucle.

- 🔴 **Mesurer aux EXTRÊMES de la donnée, jamais au cas nominal.** C'est la cause première,
  et elle est méthodologique. La v10.41 avait été éprouvée sur le cas d'Écosse : des journées
  de quelques kilomètres, un camp tout proche. Rien dans ce banc ne franchissait la centaine
  de kilomètres — et le même code, avec un camp à 1 500 km, fige l'application.
  **Dès qu'un lot fait calculer quelque chose *par paire de points*, *par distance* ou *par
  nombre d'éléments*, le banc doit contenir la plus grande valeur plausible** : un camp
  lointain, un voyage de trente jours, une journée de deux cents photos. Le remède dans le
  code s'appelle `ROUTE_MAX_M` (150 km, `js/map.js`) : au-delà, pas d'itinéraire routier, le
  trait reste droit et en pointillés — et sa distance compte toujours dans le « ≈ ».
- **Un garde-fou qui se DÉSARME AVANT ce qu'il garde n'en est pas un.** `M._roadRedraw` était
  remis à `false` au début du rappel, donc avant le redessin qu'il déclenchait — et ce
  redessin rebranchait aussitôt un rappel sur chaque itinéraire encore en vol. Le nombre de
  redessins croissait tout seul. *Chercher ce motif partout : un drapeau remis à zéro avant
  l'action qu'il protège.*
- **Dédoublonner une demande n'est pas dédoublonner ses conséquences.** `roadPending`
  empêchait bien l'appel réseau en double ; il n'empêchait pas le `.then(onReady)` en double,
  et c'est le rappel, pas l'appel, qui faisait diverger. Le rappel ne se branche donc que sur
  un appel **neuf**.
- **`0` est faux en JavaScript : tester l'EXISTENCE, pas la vérité.** `dayNumber` rend `0`
  pour une journée datée la veille du départ ; `${n ? "Jour" : ""}${n || fmtDateShort(iso)}`
  affichait donc une date dans une pastille de 44 px prévue pour un nombre, et elle
  débordait. Le défaut dormait dans **neuf** endroits à la fois (liste des journées, fiche
  journée, fiche-carte, fiche d'arrêt, page du proche, export texte). Partout où `0` ou `""`
  sont des valeurs légitimes, `n != null` est la seule garde juste.

### Les leçons de la v10.43 (#38 rouvert) — le camp ne refermait plus la journée

Livré en v10.40-10.41, mesuré sur banc, déclaré clos — et **faux sur le carnet réel**. Le banc
disait `camp → photo → photo → camp` ; l'écran de Sophie disait `photo → photo`, et rien après.

- 🔴 **Une constante nommée pour une QUESTION ne sert pas à en trancher une autre.** `PROCHE_M`
  (300 m) répond à « ce bout de trace est-il assez près d'un lieu pour porter son nom ? » (#42).
  Il avait été réemployé pour décider d'un **dessin** — « faut-il ajouter le tronçon vers le
  camp ? ». Or 300 m, c'est la largeur d'un village : une photo prise le soir devant le
  logement supprimait le retour au camp, et la journée restait ouverte. Le commentaire disait
  même « une seule valeur, deux usages : elle ne peut plus diverger d'elle-même » — c'était
  l'inverse du bon raisonnement. **Deux questions, deux constantes** : `AU_CAMP_M` (25 m, la
  précision d'un GPS) décide du trait, `PROCHE_M` continue de nommer les lieux.
- 🔴 **Une garde écrite pour une version antérieure survit à ce qui la justifiait.**
  `js/map.js` sautait le dessin estimé de toute journée portant un « Itinéraire estimé
  (route) ». C'était juste en v10.40, où `estimatedLegs` reliait les photos et aurait doublé
  l'itinéraire. Depuis la v10.41 une journée tracée ne rend plus que ses deux bouts vers le
  camp : il n'y avait plus rien à doubler, et ce saut jetait précisément ces deux tronçons —
  que `dayDistance` continuait de compter. **La seule façon, dans tout le code, qu'une distance
  affichée compte un trait que la carte ne dessine pas.** *Quand un lot change ce qu'une
  fonction renvoie, relire toutes les gardes qui la contournaient.*
- 🔴 **Un réglage « pour toute la journée » s'applique aussi aux bouts de journée où il est
  absurde.** Une journée réglée « en avion » faisait voler les trois kilomètres du soir dans la
  ville d'arrivée — et `plane.path === "straight"` : aucune route n'était jamais demandée. Sous
  `VOL_MIN_M` (50 km), le calcul automatique reprend la main.
- **`""` passe avant TOUTE date.** Un arrêt sans heure et sans prédécesseur prenait `ordre = ""`
  et ouvrait donc la journée — avant la première photo, où qu'elle ait été prise. Sur une
  journée partie de Paris, un arrêt posé le soir au Portugal fabriquait un tronçon fantôme de
  1 534 km (≈ 3 103 km affichés au lieu de ≈ 1 579). Il se range désormais **près de la photo
  dont il est le plus proche** — c'est toujours un ordre de dessin, jamais une donnée.
- **Un écart entre l'atelier et la page du proche vient des DONNÉES avant de venir du code.**
  Les deux partagent `estimatedLegs`. Quand le proche voyait juste et l'atelier non, la cause
  ne pouvait être que dans ce que chacun reçoit — et `get_shared_trip` renvoyait les arrêts
  **sans leur moyen de locomotion**, et sans ceux qui n'ont pas de nom. *Avant de soupçonner le
  code partagé, comparer les deux jeux de données.*
- **Le chiffre affiché dit quelle version tourne.** Pas besoin de le demander à Sophie : le
  signe « ≈ » n'existe pas avant la v10.41, et l'arc d'avion de la v10.41 mesure 1 777 km là où
  la droite de la v10.42 en mesure 1 548. Un kilométrage à l'écran a donc suffi à prouver que
  son app et la page du proche faisaient tourner **le même code**, ce qui a fermé d'un coup
  toutes les pistes de cache et de service worker.
- **Du code qui ne tourne pas hors navigateur ne peut pas être mesuré.** `BVMAP.MODES` écrit
  sans `window.` dans `js/common.js` arrêtait le banc — donc la version « avant » rendait zéro
  appel, et la comparaison semblait bonne alors qu'elle ne mesurait rien. Deuxième fois dans le
  même mois (après `CV` nu dans `campsOfView`). **Un résultat identique des deux côtés doit
  toujours faire suspecter le banc avant de faire conclure.**

### Les leçons de la v10.44 (#64, #61)

- 🔴 **Un retard d'affichage se mesure en GÉOMÉTRIE, pas en ressenti.** #64 : la ligne de
  lecture (`readLine`, `js/share.js`) tenait déjà compte de la carte collante — 755 px à
  440 × 956, le milieu exact de ce qui reste visible sous le plan. L'hypothèse « la photo doit
  passer derrière le plan pour être élue » était fausse. La vraie cause est une **durée** :
  `FLY_BASE_MS = 2000` (`js/map.js`) — tout vol vers une photo dure au moins deux secondes, et
  `busyUntil` bloque tout pendant ce temps. À 300 px/s, la photo élue passe sous le plan en
  0,67 s : la carte arrive plus d'une seconde après sa disparition, et ~7 photos ont défilé.
- **On peut viser où la lecture SERA.** L'élection anticipe de `vitesse × durée du vol`. Mais le
  rattrapage a un **plafond géométrique** : on ne peut viser que 201 px plus bas (le bas de
  l'écran), soit 101 px/s pour un vol de 2 s. Mesuré : à temps jusqu'à 200 px/s, encore
  0,66 s de retard à 300. **Le dire, plutôt que de laisser croire que c'est réglé.**
- **L'anticipation ne vaut que pour les PHOTOS.** L'élection de la journée garde la ligne nue :
  #37 a été refermé sur ce passage (« 3 → 4 pendant que tu fais défiler est parfait »), et un
  réglage qu'on n'a pas mesuré ne se rouvre pas par effet de bord.
- 🔴 **L'unité de cadrage est la SÉQUENCE — ni la journée, ni le tronçon.** Tranché par Sophie.
  La journée entière est trop grossière : cadrée sur 3,5 écrans, le vol Paris → Algarve prend
  13,17 s des 13,5 s et les 3 km du soir à Tavira sont franchis en **26 ms** sur **2,9 px**. Le
  tronçon est trop fin : le Jour 1 en compte sept, la caméra se recadrerait sept fois.
  **Où couper : un tronçon « en avion » fait sa propre séquence** (`couperEnSequences`,
  `js/map.js`) — rien de neuf à demander, le moyen est déjà marqué. Une séquence de vol tient
  sur **un** écran (« tracé visible d'un bout à l'autre »), les autres gardent les 3,5.
  ⚠️ Ce n'est **pas** « couper à toute rupture d'échelle » : une journée de 300 km de voiture
  suivie d'une promenade reste une seule séquence. La généralisation a été **écartée** — ne pas
  l'ajouter d'initiative. ⚠️ Et c'est un découpage de **caméra seulement** : aucune notion de
  « sous-journée » ne descend dans les données ni dans l'écran. Une journée reste une journée.
- **Un plafond de confort peut être déjà violé par le code sans que personne s'en plaigne.**
  Le recul entre les deux séquences du Jour 1 fait **12,1 crans**. À 0,42 cran/s (le plafond du
  survol au sol) il durerait 28,8 s ; or `js/map.js` borne le recul entre deux journées à **6 s**
  (`Math.min(6000, …)`), ce qui donne **2,02 cran/s** — cinq fois le plafond, et c'est le
  mouvement que Sophie voit tous les jours sans l'avoir jamais signalé. *Avant d'appliquer un
  plafond annoncé, vérifier ce que le code fait vraiment : les deux peuvent diverger depuis
  longtemps.*
- **Une mécanique soumise au doigt vit dans le VRAI code, derrière une option éteinte.**
  `options.saut` du survol est `undefined` partout dans l'app : tant que Sophie n'a pas choisi,
  le survol en ligne est au octet près celui de la v10.43. La page d'essai appelle la même
  fonction — aucune divergence possible entre ce qu'elle juge et ce qui sera livré.

### Les leçons de la v10.45 — deux pièges de l'app posée sur l'écran d'accueil

- 🔴 **L'app de l'écran d'accueil a SA PROPRE mémoire de connexion**, séparée de celle de
  Safari. Une page du même site ouverte par un lien extérieur (Safari, le navigateur intégré
  d'une autre app) n'y trouve **aucune session** et redemande le mot de passe. Toute page
  annexe — page d'essai, page de mesure — doit donc être atteignable **depuis l'app**, dans le
  même onglet (`location.href = …`), et non par un lien qu'on envoie à Sophie.
- 🔴 **Il n'y a PAS de bouton « retour » de navigateur dans une app posée sur l'écran
  d'accueil.** Emmener Sophie sur une autre page du site, c'est l'y enfermer — la règle 13 au
  pied de la lettre, hors de la carte cette fois. Toute page annexe porte donc sa propre
  sortie : visible en permanence, en haut à gauche, libellée en clair, une seule pression. Et
  elle ramène **au voyage qu'on lisait** (`index.html#trip=<id>`), pas à la liste.

### Les leçons de la v10.46 (#61) — allumer le cadrage par séquence

Le mécanisme dormait depuis la v10.44 derrière `options.sequences`. Sophie a jugé les trois
variantes sur son iPhone et choisi **A** : la coupe, avec le recul d'aujourd'hui (0,65 cran/s,
borné à 6 s). Allumer a coûté deux lignes — mais deux autres endroits supposaient encore
« une entrée de la boucle = une journée », et les deux se voyaient à l'écran.

- 🔴 **Quand une boucle se met à rendre DEUX entrées pour une journée, relire tout ce qui, dans
  cette boucle, parle de la journée.** `options.onDay` (la fiche du survol) se serait déclenché
  deux fois pour le Jour 1 — la fiche clignoterait, et afficherait les chiffres de la séquence
  (« 1 photo » puis « 5 » au lieu de « 6 », et `km` vaut 0 sur une séquence, donc plus de
  distance du tout). Il ne part plus que sur la **première** séquence (`d._seq == null ||
  d._seq === 1`), avec les chiffres de la journée entière que `couperEnSequences` transporte
  (`_km`, `_photos`).
- 🔴 **Un dévoilement posé à la fin d'une séquence déflore les séquences suivantes.**
  `revealDay(d.iso)` révèle **toutes** les photos de la journée : appelé à la fin de la
  séquence 1, il montrait Tavira avant que la séquence 2 ne la joue — tout l'effet du survol
  perdu. Il n'a lieu qu'à la **dernière** séquence (`d._seqs == null || d._seq === d._seqs`),
  dans les deux branches (journée sans tracé et parcours).
- **« Seule la caméra se coupe » est une promesse qui se VÉRIFIE, pas une intention.** Les deux
  défauts ci-dessus étaient exactement sa violation. Le banc les compte : pour chaque journée,
  nombre de séquences, nombre d'appels à la fiche, nombre de dévoilements — non-régression
  comprise (journée sans avion : une entrée, un appel, un dévoilement, comme avant).
- **Une page d'essai ne reste pas dans le dépôt une fois la question tranchée.**
  `essai-mesure.html` est partie avec le bouton qui y menait, comme `essai-jours-2.html` avant
  elle. L'histoire du dépôt la garde si on la veut un jour.
- **Ce qu'on ne peut pas vérifier ici se dit.** Tuiles et moteur de carte sont refusés par le
  proxy : le mouvement lui-même n'a été jugé que par Sophie, sur son iPhone. Le banc prouve la
  mécanique (combien de séquences, quels appels), jamais le confort.

### Les leçons de la v10.47 (#34 et le trou n° 1 du survol) — les chiffres disent tous la même chose

Trois écrans affichaient un chiffre **recalculé à côté de sa source**. C'est la leçon de #51
appliquée aux nombres, et la doctrine du projet : *l'app n'invente pas d'heure et n'invente pas
de chiffre ; quand elle ne sait pas, elle se tait.*

- 🔴 **Le chiffre fabriqué ne nuit jamais au seul endroit où on l'a repéré.** #34 était connu
  comme « la durée fausse » (« 1 h 16 » = le nombre de points OSRM moins un, en secondes). La
  même seconde inventée par point avait **trois** victimes : la durée (`js/app.js`,
  `js/share.js`), **la position d'une photo sans GPS** (`positionFromTracks` cherchait « où
  étais-tu à 14 h 03 » dans des heures qui commençaient à 8 h et avançaient d'une seconde par
  point — un point au hasard sur la route), et **l'export `traces.gpx`**, qui les faisait passer
  pour des relevés chez qui l'ouvrirait. *Chercher les autres lecteurs avant de corriger le
  lecteur qu'on a sous les yeux.*
- 🔴 **Corriger là où le chiffre est fabriqué, pas là où on l'a vu écrit.** La seconde inventée
  existait bien dans `roadRoute`, mais son unique appelant la **jetait** deux lignes plus loin :
  les heures réellement enregistrées venaient de `buildRoute`. Corriger `roadRoute` n'aurait
  rien changé — et le banc l'aurait dit trop tard.
- **Une correction qui ne répare que les données à venir n'en est pas une.** Les carnets de
  Sophie contiennent déjà des traces « route » avec leurs heures fabriquées. D'où une règle
  unique, `heuresFiables(tr)` (`js/common.js`) — *une trace « route » vient d'OSRM, pas d'un
  GPS* — écrite **une fois** et lue par les trois lecteurs. Ne pas en écrire une quatrième à
  côté.
- **Un repli « quand je ne sais pas, zéro » efface l'information au lieu de la marquer.**
  `km: est ? 0 : …` (`js/map.js`) ne mettait **aucune** distance dans la fiche du survol des
  journées estimées — c'est-à-dire de **toutes** celles de Sophie, qui écrit ses carnets après
  coup. Et l'autre branche sommait les seules traces : elle oubliait les tronçons vers le camp
  et ignorait qu'un « Itinéraire estimé (route) » est une estimation, donc sans « ≈ ». La fiche
  lit désormais `CV.dayDistance`, comme les trois autres écrans.
- **Une valeur unique vaut mieux qu'une copie bien tenue.** `couperEnSequences` transportait
  `_km` à côté de `km: 0` ; comme `dist` est recopié tel quel par `Object.assign`, les deux ont
  disparu. Une liste de moins à tenir d'accord.
- **Le format local peut être un choix, pas un oubli.** Le cartouche de la journée immobile
  affiche « 12,4 km » avec sa décimale, et un commentaire sur place dit pourquoi (*arrondi au
  kilomètre, deux journées voisines se ressemblent toutes*). On a donc changé **la valeur et le
  « ≈ »**, pas le format. *Lire le commentaire avant d'uniformiser.*
- **Le dixième endroit du `0` qui ment.** Les deux fiches de survol testaient encore `info.n ?`
  alors que `dayNumber` rend `0` pour une journée datée la veille du départ. Neuf endroits
  avaient été corrigés en v10.42 ; ceux-là avaient été manqués. `n != null`, toujours.

### Les leçons de la v10.48 (#60, #62)

- 🔴 **Un symptôme de mise en page se MESURE sur la vraie page, pas sur une maquette.**
  #60 : « la fenêtre bouge, les boutons sont tronqués ». Mesuré en pilotant Chromium sur
  `index.html` à 440, 393 et 375 : **la page tenait dans l'écran** (440 = 440), et un seul
  élément débordait — le bouton « Ma position », de 2 px, **par son propre contenu**. Les deux
  moitiés du symptôme avaient donc deux causes sans rapport, et aucune n'était « quelque chose
  de plus large que l'écran ».
- 🔴 **`position: fixed; inset: 0` ne se cale PAS sur ce que Sophie voit.** Sur iOS c'est le
  viewport *sans* la barre de Safari. Le panneau, lui, était en `vh` — la même hauteur. Quand
  la barre apparaît, la coquille dépasse par le bas ; quand elle se rétracte, tout remonte.
  D'où `height: 100svh` sur `#screen-trip`, et `svh` pour le panneau et la carte : `svh` est la
  hauteur **la plus petite**, celle qui ne bouge jamais. `dvh` aurait suivi la barre — donc
  bougé aussi. *Les trois unités ne sont pas interchangeables : `svh` pour ne pas bouger.*
- **Un libellé qui ne tient pas se plie, il ne rétrécit pas le bouton.** `.btn` impose
  `white-space: nowrap` ; les boutons de la carte ont une largeur choisie au doigt (60 px). Le
  remède est `white-space: normal` sur ces boutons-là — « Ma position » passe sur deux lignes
  sous son picto. `overflow-x: hidden` aurait caché le mot au lieu de le montrer.
- 🔴 **LES POLICES NE SONT PAS CHARGEABLES ICI.** Nunito, Fredoka et Caveat viennent de Google
  Fonts, refusé par le proxy : toute mesure de **largeur de texte** faite dans cette
  conversation utilise une police de repli, et n'est donc **pas** celle de Sophie. Une
  correction de mise en page ne doit jamais dépendre d'un ajustement au pixel près — elle doit
  tenir quelle que soit la police. *Suspecter l'instrument : c'est la règle 8 appliquée aux
  polices.*
- **Le pointillé veut dire « j'ai deviné le chemin ».** Pour un avion il n'y a rien à deviner :
  la ligne droite **est** le trajet (#62). Une seule ligne dans `draw` (`dash: l.mode !==
  "plane"`), donc une seule règle pour l'atelier et pour le proche — le code est partagé.
- **Un réglage qui vit à cinq endroits se règle par un coefficient, pas par cinq nombres.**
  Les largeurs de trait existent pour l'atelier, la lecture, la vue d'ensemble et les liserés
  de chacune. `TRAITS` / `traitCoef` les multiplient toutes (`js/map.js`), et le pointillé suit
  seul, puisqu'il est déjà exprimé en multiples de la largeur. La table `ATELIER` est écrite
  une fois et sert **et** à créer les couches **et** à les reposer : deux listes auraient
  divergé.
- **Une mécanique soumise au doigt n'a pas besoin d'une page d'essai si l'app peut la porter.**
  Le choix d'épaisseur vit dans les réglages du voyage, se voit **immédiatement sur la vraie
  carte**, et le bouton « Voir comme un proche » (déjà présent) emporte le réglage dans
  l'adresse — donc aucune page annexe, et aucun des deux pièges de la v10.45.

### Les leçons de la v10.49 — Sophie enfermée dans la page du proche

Livré la veille, signalé par elle le lendemain : *« Tu ne m'as pas mis de bouton retour, je ne
peux pas revenir. »* Deux causes, et **les deux étaient déjà écrites dans ce fichier**.

- 🔴 **LA RÈGLE 13 NE S'ARRÊTE PAS AU PLEIN ÉCRAN : elle vaut pour TOUT écran où l'on peut
  arriver.** `fail()` (`js/share.js`), la page « Oups » de la page du proche, n'avait **aucun
  bouton** — pas un. Un écran d'erreur est un état comme un autre : dans une app posée sur
  l'écran d'accueil, il n'existe pas de « retour » de navigateur, donc c'est une impasse.
  *Chercher partout ailleurs les écrans sans bouton : un état sans sortie, c'est une impasse,
  même quand il ne dure qu'un instant.*
- 🔴 **`target="_blank"` SORT DE L'APP, et la mémoire de connexion ne suit pas.** C'est
  exactement le piège de la v10.45, que je venais d'écrire et que j'ai quand même laissé sur
  le lien « Voir comme un proche » : il ouvrait Safari, où le carnet de Sophie redemande le
  mot de passe. Le lien reste donc **dans le même onglet** (`target` retiré), et la sortie
  ramène dans l'app, session intacte. *Une leçon écrite n'est pas une leçon appliquée : quand
  on en inscrit une, relire le code existant qui l'enfreint déjà.*
- **Un bouton de sortie dit où il RAMÈNE, pas ce qu'il ferme.** « Fermer » est devenu
  « ← Retour au carnet », posé **à gauche**, comme toutes les sorties du projet. Et il ramène
  au **voyage** qu'on regardait (`index.html#trip=<id>`), pas à la liste.
- **Ne jamais s'en remettre à `window.close()`.** Il n'agit que sur une page ouverte par un
  script : ailleurs il échoue en silence, et la sortie ne fait rien. La redirection est le
  seul chemin sûr, et elle est maintenant la seule.

### Les leçons de la v10.50 — enfermée dans ses propres réglages

Deuxième signalement de Sophie en deux heures, et le plus grave : *« Même dans la page atelier
je ne peux pas fermer la page pour revenir à la vue du tracé sur le plan !! »* — avec, en
prime, *« tu ne vérifies pas ce que tu fais ? »*. Elle avait raison.

- 🔴 **AJOUTER UN CHAMP, C'EST DÉPLACER LE BOUTON DE SORTIE.** La fenêtre des réglages était la
  **seule fenêtre longue du projet sans barre de boutons collante** (`class="actions sticky"`,
  que `dayForm`, `mediaViewer`, `stopForm` et `campForm` utilisent tous). Ses onze champs
  poussaient déjà « Annuler » à **177 px sous le bas de l'écran** ; l'essai d'épaisseur de la
  v10.48 a porté ce chiffre à **340 px**. Rien, à l'écran, ne dit qu'une fenêtre se déroule.
  *Avant d'allonger un formulaire, regarder où tombe sa sortie — et la coller.*
- 🔴 **Le projet avait déjà la solution ; je ne l'ai pas cherchée.** `actions sticky` existe
  depuis longtemps et est appliqué partout ailleurs. L'audit qui l'a montré tient en dix
  lignes : lister chaque `openModal`, compter ses champs, dire si sa barre est collante. *Faire
  cet inventaire au lieu de raisonner sur la fenêtre qu'on a sous les yeux.*
- 🔴 **Une capture d'écran vaut mieux qu'un chiffre — et mon chiffre était faux.** Ma sonde
  annonçait « bouton hors de l'écran » **aussi pour la fiche journée**, dont Sophie ne s'est
  jamais plainte : l'instrument ne distinguait donc pas le bon du mauvais cas. C'est la règle
  écrite en v10.43 (« un résultat identique des deux côtés fait suspecter le banc »). Ce qui a
  tranché, c'est la **photo à l'ouverture** : avant, aucun bouton ; après, la barre posée en
  bas. *Quand la mesure et l'image divergent, montrer l'image.*
- **`vh` dans une fenêtre, c'est la même faute qu'ailleurs.** `.modal-back` en `inset: 0` et
  `.modal` en `max-height: 94vh` parlaient du viewport **sans** la barre de Safari — le bas de
  la fenêtre passait dessous. Passés en `svh`, comme `#screen-trip` en v10.48. *Corriger une
  unité à un endroit oblige à la chercher partout : je ne l'avais faite qu'à moitié.*

### Les leçons de la v10.51 (#62) — « ça ne change absolument rien »

Troisième signalement de Sophie sur le même lot. Le mécanisme d'essai, livré en v10.48, ne
montrait rien — et pour deux raisons indépendantes, toutes deux invisibles dans le code et
évidentes à l'écran.

- 🔴 **UN RÉGLAGE JUGÉ AU DOIGT SE JUGE SUR L'OBJET, jamais dans une fenêtre qui le recouvre.**
  Les trois boutons vivaient dans la fenêtre des réglages. Mesuré : à 440 × 956 cette fenêtre
  fait **899 px de haut** et laisse **57 px de carte visible**. J'avais écrit sous les boutons
  « le tracé se redessine tout de suite, sur la vraie carte » — c'était faux, et Sophie a passé
  du temps à essayer trois réglages qu'elle ne pouvait pas voir. La règle 12 disait déjà
  « une page d'essai se vérifie contre la vraie page **avant** de la faire juger » : elle vaut
  aussi quand l'essai vit dans l'app. La bande est désormais posée **sur la carte**
  (`.essai-trait`, `js/app.js` + `css/style.css`), au-dessus du panneau.
- 🔴 **UN SEUL COEFFICIENT POUR TOUTES LES COUCHES D'UN TRAIT NE CHANGE RIEN À L'ŒIL.** Un
  tracé est fait de trois couches : la couleur, le liseré blanc, le halo. Les multiplier
  ensemble garde **exactement les mêmes proportions** — c'est le même dessin, à peine plus
  petit. Mesuré au zoom 12 : le liseré passait de 6,17 à 4,93 px, soit **1,2 px**. Ce que l'œil
  lit, c'est le **rapport** entre la couleur et son enrobage. D'où deux échelles dans `TRAITS`
  (`js/map.js`) : `coef` pour la couleur, `enrobage` pour le liseré et le halo, qui maigrit
  plus vite. L'écart visible passe à **2,1 px** et le rapport de 0,62 à 0,77.
- **Le motif d'un pointillé suit un RAPPORT, pas une largeur.** `DASH_EDGE` était une constante
  calculée une fois depuis `READ.w / READ.edgeW`. Dès que les deux échelles diffèrent, ce
  rapport bouge : c'est devenu `dashEdge(V)`, un calcul. *Une constante dérivée de deux valeurs
  qui peuvent désormais varier séparément n'est plus une constante.*
- 🔴 **Un défaut que seule l'image montre.** Au premier réglage essayé (`enrobage: .38`), le
  liseré tombait à 2,34 px pour une couleur de 2,30 : **il disparaissait entièrement sous
  elle**. Aucun chiffre ne criait ; la vignette des trois traits, si. Le liseré doit rester
  plus large que la couleur, sinon le tracé perd sa lisibilité sur fond clair.
- **Un réglage qui ne peut pas s'appliquer ne doit pas dire qu'il s'est appliqué.**
  `setTrait` rend maintenant `true`/`false`, et le bouton n'affiche « c'est fait » que si la
  carte a vraiment changé. C'est la règle de #51 (*pas d'enregistrement, pas de message de
  succès*) appliquée à un réglage d'affichage.

### Les leçons de la v10.52 (#62) — le trait du survol ignorait le réglage

Quatrième signalement sur le même sujet, et cette fois **ce sont ses captures qui ont tranché** :
trois des cinq étaient prises **pendant le survol**.

- 🔴 **UN RÉGLAGE GLOBAL SE VÉRIFIE SUR TOUS LES ÉTATS DE L'ÉCRAN, pas sur l'état au repos.**
  La carte en a deux. Au repos, les tracés sont les couches `track-*`. **Pendant le survol,
  `js/map.js` les estompe à 25 %** et le seul trait épais devient la trace qui se dessine
  derrière Valdo : `progress-halo` (9 px) et `progress-line` (5 px). J'avais réglé le premier
  état et oublié le second — précisément celui que Sophie regardait. Elle a touché les trois
  boutons sans rien voir changer, et c'était exact.
- 🔴 **Une valeur écrite À CÔTÉ de sa liste finit toujours par diverger — troisième fois ce
  mois-ci.** `progress-halo` et `progress-line` étaient déclarées deux lignes au-dessus de
  `trackLayers`, hors de la table `ATELIER`. Elles y sont entrées : **sept** couches suivent
  désormais le réglage, contre cinq. Le banc les compte, et aurait trouvé l'oubli tout seul.
- **Un essai jugé au doigt doit rester ATTEIGNABLE pendant ce qu'on juge.** La bande était en
  bas, et `.replaying .essai-trait { display: none }` la cachait pendant le survol : Sophie
  devait choisir, lancer « Revoir », regarder — et d'un essai à l'autre la carte avait bougé.
  Elle est passée **en haut** (`right: 80px`, le rail reste libre) et reste visible pendant le
  survol : on compare carte immobile, comme l'exige déjà la note sur les réglages de confort.
- **Mon contrôle de recouvrement ne comparait que les hauteurs.** Il annonçait « la bande
  recouvre le rail » alors qu'elle s'arrête à 360 px et que le rail commence à 368. Deux
  rectangles se recouvrent quand ils se croisent **dans les deux sens** — sinon l'instrument
  crie au loup, et on finit par ne plus l'écouter.

### #62 — CLOS en v10.53. Ce que cinq versions ont appris

Sophie a choisi **« fin »** le 18/09/2026, après avoir comparé les trois épaisseurs pendant
le survol, carte immobile. Les largeurs sont figées dans `ATELIER`, `READ` et `OVER`
(`js/map.js`) — plus aucun réglage, plus aucun échafaudage.

**Une question d'une ligne a coûté cinq versions**, et pas une seule fois à cause du réglage
lui-même : à chaque fois, **le dispositif d'essai était faux d'une manière différente**.

| version | ce qui empêchait de juger |
|---|---|
| v10.48 | les boutons dans une fenêtre qui cache 94 % de la carte |
| v10.51 | un coefficient unique : le même dessin, 1,2 px plus petit |
| v10.52 | l'état qu'elle regardait — le survol — n'était pas réglé du tout |

🔴 **Avant de demander un choix au doigt, vérifier les TROIS conditions, pas deux :**
1. **visible** — la chose à juger est à l'écran pendant qu'on juge ;
2. **comparable** — rien ne bouge entre deux essais (ni la vue, ni le zoom) ;
3. **qui change vraiment** — l'écart est mesuré, et vérifié **dans l'état où elle regarde**.

Et le corollaire, payé trois fois : **c'est elle qui voyait juste à chaque fois.** « Ça ne
change rien » n'était jamais une impression — c'était un constat exact, sur un défaut que je
n'avais pas cherché au bon endroit.

---

## Où sont les décisions

Le backlog numéroté, les notes de conception, le benchmark et les résultats de tests
vivent dans le **projet Claude « App Carnet de voyages »**, pas dans ce dépôt.

Si un choix de conception se pose en cours de route, **le poser à Sophie plutôt que de
trancher** — et vérifier ce qu'elle a réellement demandé avant de produire quoi que ce
soit.

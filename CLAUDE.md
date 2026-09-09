# Bonvoyage — mémoire du projet

Ce fichier est lu automatiquement au début de chaque session. Il contient ce qu'il faut
savoir avant d'écrire une ligne de code dans ce dépôt. **Ne pas l'écraser avec `/init`.**

---

## Le projet

Bonvoyage est un carnet de voyage web : Sophie raconte ses voyages jour par jour, avec
photos, traces GPS et carte, et partage un lien avec ses proches qui ne sont pas là.

- En ligne : <https://queribus11.github.io/Bonvoyage/> — dépôt `queribus11/Bonvoyage`, branche `main`
- **PWA statique** servie par GitHub Pages + **Supabase** (PostgreSQL, Auth, Storage, Edge Functions)
- Version actuelle : **v10.8**

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
- Elle annonce souvent un sujet par son **numéro de backlog** (#1 à #32). Les numéros
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

**1. La version se change à deux endroits, à chaque livraison.**
`js/map.js` → `BV_VERSION`, **et** `sw.js` → le nom du `CACHE`. C'est ce qui rend la mise
à jour visible et force le rafraîchissement du service worker. Oublier l'un des deux, et
Sophie voit l'ancienne version en croyant avoir la nouvelle.

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
l'écran avec le vrai `css/style.css`, dans un conteneur de **393 px** (largeur d'un
iPhone, à fixer dans la page, pas par la fenêtre du navigateur), `html class="is-dark"`
pour son thème sombre, puis capture. Restent hors de portée : le tactile, le clavier de
l'iPhone, le partage natif, et tout ce qui demande un vrai compte.

**9. À chaque version vérifiée en ligne, rappeler à Sophie de reprendre sa copie.**
Le dépôt est la référence ; sa copie sur le Mac est son filet à elle. Une phrase suffit,
à la fin du compte rendu : *« pense à reprendre ta copie — sur github.com, bouton vert
Code → Download ZIP, à décompresser dans `Documents/App/Bonvoyage/app-en-ligne` en
remplaçant l'ancienne. »* Ne jamais le laisser passer : c'est le seul geste manuel qui
subsiste, et il ne coûte qu'une minute.

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

**Les arrêts d'une journée (v10.8, #5)** : table `day_stops`, calquée sur `media` (donc
`user_id` + `author_id` posés par `stamp_contribution`, et la règle « auteur ou
propriétaire »), clé sur `day_date` et non `day_id` — un arrêt peut exister sur une
journée sans fiche. Plusieurs arrêts par journée : **aucune contrainte d'unicité, aucun
plafond**. Les onze catégories sont celles de Sophie, tenues par une contrainte `check` :
`monument · musee · parc · vue · resto · boutique · marche · attraction · streetart ·
camp · autre`. Ne pas en inventer une douzième.

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

---

## Le vocabulaire du projet

Employer ces mots, pas leur équivalent technique : **le carnet**, **la journée** et **la
fiche journée**, **le proche** (qui lit) et **le co-auteur** (qui écrit), **le survol**
(l'animation de la trace), **le mot du jour** (vocal), **le carnet de bord** (privé),
**le lien nominatif**, **la vignette de partage**, **Valdo** (la mascotte).

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
- **OSRM ne renvoie jamais d'altitude** — d'où l'estimation par le relief (#22).
- **Une trace qui a déjà ne serait-ce qu'un point avec altitude n'est jamais
  ré-estimée**, pour ne pas mélanger une estimation avec une vraie mesure GPS. Et
  l'estimation ne doit jamais bloquer ni faire échouer un import.
- **`supabase/functions/notify/` est dans le dépôt mais n'a jamais été déployée**, et
  `VAPID_PUBLIC_KEY` est vide dans `config.js`. Le code de l'app attend ces deux
  éléments, pas le fichier (#23).

---

## Où sont les décisions

Le backlog numéroté, les notes de conception, le benchmark et les résultats de tests
vivent dans le **projet Claude « App Carnet de voyages »**, pas dans ce dépôt.

Si un choix de conception se pose en cours de route, **le poser à Sophie plutôt que de
trancher** — et vérifier ce qu'elle a réellement demandé avant de produire quoi que ce
soit.

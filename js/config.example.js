// ============================================================
//  Configuration — c'est le SEUL fichier à modifier.
//  Remplace les deux valeurs ci-dessous par celles de ton projet Supabase
//  (Supabase > Project Settings > API).
// ============================================================

window.CARNET_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxxxxxxxxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...colle-ici-ta-cle-anon-public...",

  // Inscriptions : après avoir créé TON compte, passe à false (et ferme aussi les inscriptions
  // dans Supabase > Authentication > Sign In / Providers > "Allow new users to sign up").
  ALLOW_SIGNUP: true,

  // Notifications aux proches (facultatif) : clé publique générée avec vapid.html.
  // Laisse vide pour désactiver le bouton « Me prévenir ».
  VAPID_PUBLIC_KEY: "",

  // Nom affiché dans l'app
  APP_NAME: "Bonvoyage",

  // Fond de carte au premier lancement (ensuite, le choix se fait sur la carte et il est mémorisé) :
  //   "satellite" : images satellite haute définition avec noms et routes (par défaut)
  //   "relief"    : OpenTopoMap, courbes de niveau (randonnée)
  //   "plan"      : OpenStreetMap
  // Le bouton « 3D » de la carte ajoute le relief en trois dimensions. Aucune clé nécessaire.
  MAP_STYLE: "satellite",

  // Taille max des photos envoyées (px, côté le plus long). 1600 = bon compromis qualité/poids.
  PHOTO_MAX_SIZE: 1600,

  // Trois tailles sont fabriquées à l'envoi, chacune calée sur ce qu'elle sert vraiment
  // (mesuré sur un iPhone 17 Pro Max : 440 points de large, 3 pixels réels par point) :
  //   PHOTO_MAX_SIZE   1600 · l'affichage : photo phare et plein écran (1320 px réels)
  //   PHOTO_GRID_SIZE   768 · les tuiles de la grille (655 px réels) et la couverture de journée
  //   PHOTO_THUMB_SIZE  192 · les pastilles de la carte et toutes les petites vignettes
  //                           (la plus grande d'entre elles fait 168 px réels)
  PHOTO_GRID_SIZE: 768,
  PHOTO_THUMB_SIZE: 192,

  // Suivi GPS : un point est gardé seulement si on a bougé d'au moins X mètres
  // ET qu'il s'est écoulé au moins Y secondes depuis le point précédent.
  GPS_MIN_DISTANCE_M: 25,
  GPS_MIN_INTERVAL_S: 20,
};

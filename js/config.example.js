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

  // Suivi GPS : un point est gardé seulement si on a bougé d'au moins X mètres
  // ET qu'il s'est écoulé au moins Y secondes depuis le point précédent.
  GPS_MIN_DISTANCE_M: 25,
  GPS_MIN_INTERVAL_S: 20,
};

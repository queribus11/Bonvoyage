// ============================================================
//  Configuration — c'est le SEUL fichier à modifier.
//  Remplace les deux valeurs ci-dessous par celles de ton projet Supabase
//  (Supabase > Project Settings > API).
// ============================================================

window.CARNET_CONFIG = {
  SUPABASE_URL: "https://bvheowjjlqsxyqunxhgu.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2aGVvd2pqbHFzeHlxdW54aGd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTg3MjMsImV4cCI6MjEwNDI3NDcyM30.Kk1zQspTMqaZ9dDI9nHWBIZ6tI2WxKwqL5N3YJMy_Z8",

  // Inscriptions : après avoir créé TON compte, passe à false (et ferme aussi les inscriptions
  // dans Supabase > Authentication > Sign In / Providers > "Allow new users to sign up").
  ALLOW_SIGNUP: true,

  // Notifications aux proches (facultatif) : clé publique générée avec vapid.html.
  // Laisse vide pour désactiver le bouton « Me prévenir ».
  VAPID_PUBLIC_KEY: "",

  // Nom affiché dans l'app
  APP_NAME: "Bonvoyage",

  // Fond de carte (tu peux en changer plus tard) :
  //   "voyager"  : joli, coloré, lisible (par défaut)
  //   "positron" : très clair, minimaliste
  //   "outdoors" : OpenTopoMap, avec le relief (idéal randonnée)
  MAP_STYLE: "voyager",

  // Taille max des photos envoyées (px, côté le plus long). 1600 = bon compromis qualité/poids.
  PHOTO_MAX_SIZE: 1600,

  // Suivi GPS : un point est gardé seulement si on a bougé d'au moins X mètres
  // ET qu'il s'est écoulé au moins Y secondes depuis le point précédent.
  GPS_MIN_DISTANCE_M: 25,
  GPS_MIN_INTERVAL_S: 20,
};

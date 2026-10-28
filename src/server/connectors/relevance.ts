/**
 * Filtre de pertinence « développement web » appliqué à l'objet de l'avis avant
 * enregistrement : sites, portails, plateformes, applications web ou mobiles et
 * modules. Les requêtes des sources (CPV, descripteurs, mots-clés) ratissent
 * large ; ce filtre écarte le reste de l'informatique (licences, matériel,
 * infogérance, AMOA…) et les faux amis (« portail automatique », « automate »).
 */

/** Minuscules, sans accents ni ponctuation, bordé d'espaces. */
export function normalizeText(s: string): string {
  return ` ${s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** Objet web explicite : suffit à retenir l'avis. */
const WEB_SUBJECT = new RegExp(
  [
    "sites? (internet|web|intranet|extranet|institutionnels?|vitrines?|marchands?|e commerce)",
    "sites? [a-z0-9]+ (fr|com|org|net|eu|gouv)",
    "chatbots?",
    "web",
    "webs",
    "intranets?",
    "extranets?",
    "portails?",
    "applications? (web|mobiles?|en ligne)",
    "plate ?formes? (web|numeriques?|en ligne|digitales?|collaboratives?)",
    "(front|back) office",
    "pwa",
    "teleservices?",
    "demarches? en ligne",
    "e services?",
    "cms",
    "(drupal|wordpress|symfony|laravel|php|javascript|react|angular|node ?js|java|python)",
  ]
    .map((p) => ` ${p} `)
    .join("|"),
);

const DEV_ACTION =
  / (developpements?|developper|conception|concevoir|realisation|realiser|refonte|refondre|creation|creer|evolutions?|evolutive|adaptations?|programmation) /;

const SOFTWARE_OBJECT =
  / (applications?|applicatifs?|applicatives?|outils?|logiciels?|plate ?formes?|modules?|produits? numeriques?|services? numeriques?|solutions? (numeriques?|logicielles?)|systemes? d information|si|ia|intelligence artificielle|nouvelle version|interfaces?|api|serious games?|e learning) /;

/** Hors périmètre même si un terme web apparaît. */
const EXCLUDED = new RegExp(
  [
    // « automatisé » reste admis (outil de gestion automatisé…), pas les automates.
    "automates?",
    "automatiques?",
    "automatismes?",
    "automaticiens?",
    "robotiques?",
    "portes?",
    // « portail » au sens du BTP (clôtures, taxiway, monument…).
    "travaux",
    "clotures?",
    "portillons?",
    "vrd",
    "restauration",
    "taxiway",
    "abris",
    "fourniture de ressources",
    "barrieres?",
    "rideaux?",
    "fermetures?",
    "ascenseurs?",
    "distributeurs?",
    "laverie",
    "materiels?",
    "reactifs?",
    "consommables?",
    "licences?",
    "abonnements?",
    "acquisitions?",
    "infogerance",
    "telephonie",
    "cablage",
    "reseaux? (lan|man|ip|ethernet|informatiques?|techniques?|telecoms?)",
    "amoa?",
    "amoe",
    "assistance a (la )?maitrise d (ouvrage|oeuvre)",
    "formations?",
    "(fourniture|bases?) de donnees",
    "cybersecurite",
    "soc",
    "interimaires?",
    "nettoyage",
    "microfilms?",
    "grands systemes",
    "mainframe",
    "cobol",
    "souscription",
    "conseil en (strategie|organisation)",
    "aide a l exploitation",
  ]
    .map((p) => ` ${p} `)
    .join("|"),
);

/** Hébergement seul (sans développement ni maintenance) : pas un projet de développement. */
const HOSTING = / (hebergement|hbgt) /;
const MAINTENANCE = / (maintenance|tma|mco) /;

export function isWebDevProject(title: string): boolean {
  const t = normalizeText(title);
  if (EXCLUDED.test(t)) return false;
  if (HOSTING.test(t) && !DEV_ACTION.test(t) && !MAINTENANCE.test(t)) return false;
  return WEB_SUBJECT.test(t) || (DEV_ACTION.test(t) && SOFTWARE_OBJECT.test(t));
}

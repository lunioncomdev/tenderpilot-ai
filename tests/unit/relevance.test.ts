import { describe, expect, it } from "vitest";
import { isWebDevProject } from "@/server/connectors/relevance";

// Objets réels relevés au BOAMP et sur APProch (octobre 2026).
const WEB = [
  "Hébergement, maintenance et développement Site internet des Célestins, Théâtre de Lyon",
  "Mise en place d'un chatbot à destination client pour le site actionlogement.fr",
  "Maintenance et amélioration continue des sites internet et applications web du ministère de la Culture",
  "Développement et tierce maintenance applicative de l'application HYDROPORTAIL",
  "Accord-cadre relatif au développement d’un outil de gestion et de contrôle de gestion budgétaire automatisé",
  "Assistance MOE à la réalisation de projets en environnement JAVA, PHP et PYTHON",
  "Conception, développement, maintien en condition opérationnelle et évolution des produits numériques de l’administration",
  "TMA Intranet PAYL et Normandie",
  "Adaptation de l'application VIGINOND",
  "REFONTE DU SITE INTERNET DE LA VILLE DE CLICHY",
  "Maintenance portail Téthys",
];

const NOT_WEB = [
  "Renouvellement et évolution du contrat de licences Adobe",
  "MAINTENANCE DES PORTES ET PORTAILS AUTOMATIQUE",
  "Acquisition et maintenance d’une plateforme d’immunofluorescence multiplexe automatisée",
  "INFOGERANCE ET MAINTENANCE INFORMATIQUE DES SITES DU GIP FCIP DE TOULOUSE",
  "AMO Développement de la nouvelle plateforme des appels à projets",
  "Hébergement de sites web sur des architectures non disponibles à l’INSEE",
  "Maintenance évolutive des applications en environnements grands systèmes",
  "Conception de trois interfaces d'intégration robotique sécurisées",
  "TMA Chorus PRO",
  "ACBC Pose de clôtures, portails et portillons",
  "MARTINIQUE (972) – LE LAMENTIN – PAE – Mise à niveau du portail du taxiway MIKE",
  "cathedrale de Chartres: restauration du portail Sud",
  "Fourniture De Ressources Numeriques (Video A La Demande) Accessibles A Partir Du Portail Des Mediatheques",
  "Accès internet et interconnexions des sites distants",
  "Prestations de formation des agents du Département de la Savoie aux outils d'intelligence artificielle générative",
];

describe("filtre développement web", () => {
  it.each(WEB)("retient « %s »", (title) => expect(isWebDevProject(title)).toBe(true));
  it.each(NOT_WEB)("écarte « %s »", (title) => expect(isWebDevProject(title)).toBe(false));
});

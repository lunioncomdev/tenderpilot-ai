import { normalizeText } from "../connectors/relevance";

/**
 * Offres de maintenance (TMA, MCO, maintenance corrective/évolutive…) et
 * technologies à reprendre. Sans analyse du DCE, les technologies sont
 * repérées dans l'objet et la description de l'avis à partir d'un dictionnaire ;
 * après analyse, les compétences exigées extraites par l'IA font foi.
 */

const MAINTENANCE = / (maintenances?|maintenir|maintien en condition|tma|mco) /;

export function isMaintenanceTender(title: string, description = ""): boolean {
  if (MAINTENANCE.test(normalizeText(title))) return true;
  // La description seule est plus bavarde : on exige une formulation explicite.
  return / (tierce maintenance applicative|tma|maintenance (corrective|evolutive|applicative|adaptative|preventive)|maintien en condition operationnelle|mco) /.test(
    normalizeText(description),
  );
}

/** [libellé affiché, motif sur le texte normalisé]. */
const TECHNOLOGIES: Array<[string, string]> = [
  ["WordPress", "wordpress|wp"],
  ["Drupal", "drupal"],
  ["Joomla", "joomla"],
  ["TYPO3", "typo ?3"],
  ["Prestashop", "prestashop"],
  ["Magento", "magento"],
  ["Shopify", "shopify"],
  ["Wix", "wix"],
  ["Ez Publish / Ibexa", "ez ?publish|ibexa"],
  ["SPIP", "spip"],
  ["Liferay", "liferay"],
  ["Jahia", "jahia"],
  ["Sitecore", "sitecore"],
  ["SharePoint", "sharepoint"],
  ["Moodle", "moodle"],
  ["Alfresco", "alfresco"],
  ["Nuxeo", "nuxeo"],
  ["Plone", "plone"],
  ["Umbraco", "umbraco"],
  ["Kentico", "kentico"],
  ["Strapi", "strapi"],
  ["Contentful", "contentful"],
  ["Matomo", "matomo|piwik"],
  ["Salesforce", "salesforce"],
  ["SAP", "sap"],
  ["Ivalua", "ivalua"],
  ["Odoo", "odoo"],
  ["Symfony", "symfony"],
  ["Laravel", "laravel"],
  ["Zend / Laminas", "zend|laminas"],
  ["CodeIgniter", "codeigniter"],
  ["CakePHP", "cakephp"],
  ["PHP", "php"],
  ["Java", "java|jee|j2ee|jakarta"],
  ["Spring", "spring( boot)?"],
  ["Hibernate", "hibernate"],
  ["Struts", "struts"],
  [".NET", "dotnet|asp dotnet|asp net|csharp|c sharp"],
  ["Python", "python"],
  ["Django", "django"],
  ["Flask", "flask"],
  ["Ruby on Rails", "ruby|ruby on rails"],
  ["Node.js", "node ?js|nodejs"],
  ["NestJS", "nest ?js"],
  ["Express", "express ?js"],
  ["JavaScript", "javascript"],
  ["TypeScript", "typescript"],
  ["React", "react( ?js)?"],
  ["Next.js", "next ?js"],
  ["Angular", "angular( ?js)?"],
  ["Vue.js", "vue ?js|vuejs|nuxt( ?js)?"],
  ["jQuery", "jquery"],
  ["React Native", "react native"],
  ["Flutter", "flutter"],
  ["Ionic", "ionic"],
  ["Swift / iOS", "swift|ios"],
  ["Kotlin / Android", "kotlin|android"],
  ["Go", "golang"],
  ["MySQL", "mysql|mariadb"],
  ["PostgreSQL", "postgre ?sql|postgres|postgis"],
  ["Oracle", "oracle"],
  ["SQL Server", "sql server|mssql"],
  ["MongoDB", "mongo ?db"],
  ["Elasticsearch", "elastic ?search"],
  ["Redis", "redis"],
  ["Solr", "solr"],
  ["Tomcat", "tomcat"],
  ["JBoss / WildFly", "jboss|wildfly"],
  ["Apache", "apache"],
  ["Nginx", "nginx"],
  ["Linux", "linux|debian|ubuntu|red ?hat|rhel|centos"],
  ["Docker", "docker"],
  ["Kubernetes", "kubernetes|k8s"],
  ["OpenShift", "openshift"],
  ["AWS", "aws|amazon web services"],
  ["Azure", "azure"],
  ["GraphQL", "graphql"],
  ["Windev / Webdev", "windev|webdev"],
  ["Delphi", "delphi"],
  ["4D", "4d"],
];

const TECH_RES = TECHNOLOGIES.map(([label, p]) => [label, new RegExp(` (${p}) `)] as const);

/** Technologies citées dans le texte (dans l'ordre du dictionnaire, sans doublon). */
export function detectTechnologies(text: string): string[] {
  // normalizeText retire « . » et « # » : on préserve .NET et C# avant normalisation.
  // Les adresses e-mail et domaines (« publications@aws-france.com ») ne désignent pas une technologie.
  const cleaned = text.replace(/\S+@\S+/g, " ").replace(/\.net\b/gi, " dotnet ").replace(/c#/gi, " csharp ");
  const t = normalizeText(cleaned);
  return TECH_RES.filter(([, re]) => re.test(t)).map(([label]) => label);
}

type AnalysisLike = Record<string, unknown> | null | undefined;

/** Texte de l'analyse où les technologies sont citées (compétences, exigences, maintenance, hébergement, synthèse). */
function analysisText(a: NonNullable<AnalysisLike>): string {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") add((v as { value?: unknown; text?: unknown }).value ?? (v as { text?: unknown }).text);
  };
  for (const k of ["requiredSkills", "technicalRequirements", "maintenance", "hostingSecurity", "object", "summary"]) add(a[k]);
  return parts.join(" , ");
}

/**
 * Technologies à reprendre : repérées dans l'avis et, si le DCE a été analysé,
 * dans les éléments extraits (les compétences de l'IA sont souvent génériques
 * — « Maintenance corrective » — d'où le filtrage par dictionnaire).
 */
export function tenderTechnologies(title: string, description: string, analysis: AnalysisLike): { items: string[]; fromAnalysis: boolean } {
  // Analyses depuis 2026-11 : champ dédié, repris tel quel (versions comprises), complété par le dictionnaire.
  const extracted = Array.isArray(analysis?.technologies) ? analysis.technologies.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  if (extracted.length) {
    const covered = new Set(detectTechnologies(extracted.join(" , ")));
    const extra = detectTechnologies(`${title} , ${description} , ${analysisText(analysis!)}`).filter((x) => !covered.has(x));
    return { items: [...extracted, ...extra], fromAnalysis: true };
  }
  const text = `${title} , ${description}${analysis ? ` , ${analysisText(analysis)}` : ""}`;
  return { items: detectTechnologies(text), fromAnalysis: !!analysis };
}

# TenderPilot AI — Architecture

> Plateforme de veille, qualification et préparation de réponses aux appels d'offres
> informatiques. Premier utilisateur : Lunioncom. Conçue multi-tenant dès le MVP.

## 1. Vue d'ensemble

```
                ┌──────────────────────── Docker Compose ────────────────────────┐
 Navigateur ──► │ nginx ──► web (Next.js 15, App Router, Server Actions, Route    │
                │                Handlers REST /api/v1)                           │
                │              │  enqueue (BullMQ)                                │
                │              ▼                                                  │
                │            redis ◄──── worker (Node.js, tsx)                    │
                │              │          ├─ sync-source   (BOAMP, APProch)       │
                │              │          ├─ extract-document (PDF/DOCX/XLSX/ZIP) │
                │              │          ├─ analyze-tender  (Claude)             │
                │              │          ├─ generate-proposal (Claude)           │
                │              │          └─ cron: sync 6h, échéances 7h          │
                │              ▼                                                  │
                │   postgres 16 + pgvector     seaweedfs (S3)                     │
                └─────────────────────────────────────────────────────────────────┘
```

* **Un seul dépôt TypeScript** (`src/`) partagé entre l'app web et le worker : le
  domaine (`src/server/**`) ne dépend ni de Next.js ni de BullMQ, ce qui le rend
  testable unitairement.
* **web** : rendu serveur, formulaires en Server Actions (protection CSRF native de
  Next.js par contrôle d'origine), Route Handlers pour upload/téléchargement et API.
* **worker** : tous les traitements longs ou coûteux (réseau, parsing, IA) passent
  par des jobs BullMQ idempotents, avec retry exponentiel.

## 2. Arborescence

```
prisma/schema.prisma          modèle de données
prisma/migrations/            migrations SQL (dont FTS français + pgvector)
src/app/(auth)/               login, initialisation du premier compte
src/app/(app)/                pages authentifiées (dashboard, tenders, pipeline…)
src/app/api/v1/               API REST (upload, download, health)
src/components/ui/            composants style shadcn/ui (copiés, sans CLI)
src/server/auth/              sessions, hash, RBAC, garde tenant
src/server/connectors/        BOAMP, APProch, TED (désactivé), registre, normalisation, dédup
src/server/documents/         stockage, extraction, chunking, détection de type
src/server/ai/                abstraction LLM, provider Anthropic, prompts versionnés
src/server/analysis/          analyse DCE, vérification des citations
src/server/scoring/           moteur déterministe + critères éliminatoires
src/server/proposals/         génération du mémoire, export DOCX
src/server/queue/             définitions de queues/jobs
src/worker/                   point d'entrée du worker et des crons
tests/                        unitaires + intégration (+ fixtures identifiées)
```

## 3. Modèle de données (résumé)

| Domaine | Tables |
|---|---|
| Tenant & accès | `Organization` (plan STARTER/PRO/AGENCY), `User`, `Membership` (OWNER/ADMIN/MEMBER/VIEWER), `Session` |
| Entreprise | `CompanyProfile` (pays, zones éligibles, certifications, CA, effectif, compétences, CPV, mots-clés, TJM, pondérations du scoring), `CompanyReference` |
| Veille | `SourceConfig` (activation par source et par org), `SyncRun`, `Tender`, `SavedSearch` |
| DCE | `TenderDocument`, `DocumentChunk` (texte, pages, `tsvector` FR, `embedding vector(1024)` optionnel) |
| IA | `TenderAnalysis` (résultat JSON validé Zod + version de prompt), `TenderScore`, `AiUsageLog` |
| Réponse | `Proposal`, `ProposalSection`, `ProposalSectionVersion`, `ComplianceItem` |
| Collaboration | `Comment`, `AuditLog` |

**Isolation des tenants** : toute table métier porte `organizationId`. L'accès passe
par `requireContext()` qui fournit `{ userId, orgId, role }`, et chaque requête Prisma
filtre explicitement sur `organizationId` (helpers `scoped*`). Les tests
d'intégration vérifient qu'un utilisateur d'une org ne lit pas les données d'une autre.

**Abonnements (préparé, non facturé)** : `Organization.plan` + `src/server/plans.ts`
(quotas d'analyses IA, nombre d'utilisateurs). Les quotas IA sont déjà appliqués.

## 4. Connecteurs

Interface commune :

```ts
interface TenderConnector {
  key: "boamp" | "ted";
  fetchNotices(q: ConnectorQuery): AsyncGenerator<NormalizedNotice>;
}
```

| Source | Accès | Pagination | Remarques |
|---|---|---|---|
| **BOAMP** | API Opendatasoft v2.1 de la DILA (`boamp-datadila.opendatasoft.com`), Licence Ouverte, sans clé | `limit`/`offset` (≤ 10 000) par fenêtres de dates | Filtre ODSQL : date de parution, nature (`APPEL_OFFRE`, `RECTIFICATIF`, `ANNULATION`, `ATTRIBUTION`), descripteurs informatiques + mots-clés sur `objet`. |
| **APProch** | Jeu « Projets d'achats publics » (Opendatasoft `data.economie.gouv.fr`), Licence Ouverte, sans clé | `limit`/`offset` | Projets annoncés avant consultation. Instantané sans date de mise à jour : relu en entier à chaque synchro (filtre CPV + mots-clés sur `libelle`, publication prévue ≥ J-90). Nom de l'acheteur résolu depuis le SIREN via l'API Recherche d'entreprises. |
| **TED** | API Search v3 (`api.ted.europa.eu/v3/notices/search`), anonyme | mode `ITERATION` (`iterationNextToken`) | **Désactivé** (seuls les marchés français sont suivis) ; connecteur conservé. |
| PLACE, e-Procurement BE | Non implémentés (P2) | — | PLACE n'expose pas d'API publique documentée : pas de scraping, pas de contournement. Les avis PLACE ≥ seuils apparaissent de toute façon au BOAMP/TED. |

* **Débit** : limiteur séquentiel (1 req/s BOAMP, 1 req/s APProch, 5 req/s Recherche d'entreprises) + retry exponentiel
  sur 429/5xx, respect de `Retry-After`.
* **Identifiant officiel** conservé (`idweb` BOAMP, `publication-number` TED) et clé
  unique `(organizationId, source, externalId)` → upsert idempotent.
* **Modifications / annulations** : un `RECTIFICATIF` BOAMP met à jour l'avis
  d'origine (`annonces_anterieures`) et passe `noticeState=MODIFIED` ; une
  `ANNULATION` → `CANCELLED` ; une attribution → `AWARDED`. TED : les versions
  successives d'un même `notice-identifier` écrasent la précédente.
* **Dédoublonnage inter-sources** : un même marché européen est publié au BOAMP
  (famille JOUE) et au TED. Clé forte = identifiant de procédure eForms
  (`contractfolderid` BOAMP = `procedure-identifier` TED) ; clé faible =
  empreinte normalisée acheteur + objet + date limite. Le doublon est conservé
  mais rattaché (`duplicateOfId`) et masqué par défaut.

## 5. Pipeline documentaire

1. **Upload** (Route Handler) : taille max configurable, vérification du type par
   *magic bytes* (`file-type`), liste blanche PDF/DOCX/XLSX/TXT/ZIP, SHA-256,
   stockage objet sous `org/<orgId>/tenders/<tenderId>/<uuid>`.
2. **ZIP** : décompressé côté worker avec garde-fous (nombre d'entrées, taille
   décompressée totale, pas de chemins absolus/`..`, profondeur 1) → chaque fichier
   devient un `TenderDocument`.
3. **Extraction** : PDF par page (`unpdf`/pdf.js), DOCX (`mammoth`), XLSX
   (`exceljs`, tableau rendu en texte tabulé feuille par feuille), TXT.
   OCR : non embarqué dans le MVP ; un PDF sans couche texte est marqué
   `NEEDS_OCR` (point d'extension documenté, Tesseract en P1).
4. **Type de pièce** déduit du nom/contenu (RC, CCTP, CCAP, AE, BPU, DPGF, annexe,
   Q/R) et modifiable.
5. **Chunking** par page puis par paragraphes (~1 200 tokens, chevauchement léger),
   avec titre de section détecté et pages de début/fin → traçabilité.
6. **Indexation** : `tsvector` français (recherche plein texte, sans fournisseur
   externe). `embedding vector(1024)` prévu et alimenté uniquement si un
   fournisseur d'embeddings est configuré (Anthropic n'en fournit pas ; Voyage AI
   est l'option recommandée) — décision détaillée §10.

## 6. Moteur IA

* `LlmProvider` (interface) → `AnthropicProvider` (SDK officiel, `messages.parse` +
  `zodOutputFormat`) ; `FakeProvider` réservé aux tests.
* Modèle par défaut `claude-opus-5-5` (configurable `AI_MODEL`), effort configurable.
* **Prompts versionnés** (`src/server/ai/prompts/*.ts`, constante `version`) ; la
  version est enregistrée avec chaque résultat.
* **Sorties structurées** validées par Zod ; refus (`stop_reason=refusal`) et
  troncature gérés explicitement.
* **Journal** `AiUsageLog` : opération, modèle, tokens in/out/cache, coût estimé,
  durée, succès. **Budget** mensuel par organisation (`AI_MONTHLY_BUDGET_USD`) et
  quotas par plan vérifiés *avant* chaque appel.
* **Prompt caching** : prompt système et DCE portent un `cache_control` ; le
  préfixe (système + DCE) est réutilisé d'une section du mémoire à l'autre.
* **Repli en cas de refus** : `fallbacks: "default"` (bêta
  `server-side-fallback-2026-07-01`) ; un refus final est traité comme une erreur
  explicite, jamais comme un résultat vide.
* **Anti prompt-injection** : le contenu des documents est encadré
  `<document_chunk id=…>` et déclaré comme données non fiables dans le prompt
  système ; aucune sortie IA n'est exécutée, seules des données validées par
  schéma sont persistées ; aucun outil n'est exposé au modèle.
* **Consentement** : aucun envoi au fournisseur sans `AI_ENABLED=true`, clé
  configurée et option « autoriser l'envoi des DCE à l'IA » activée dans le profil
  de l'organisation.

### Analyse d'un DCE

Sortie = ~30 champs (objet, acheteur, budget, date limite, conditions, exigences,
critères et pondérations, documents obligatoires, risques…). Chaque champ :
`{ value: string | null, sources: [{ chunkId, quote }] }`. Après réponse, chaque
citation est **vérifiée** : le `chunkId` doit exister et la citation doit figurer
(normalisée) dans le texte du chunk ; sinon la source est marquée non vérifiée.
`value = null` est affiché « Non précisé ».

## 7. Scoring

Moteur **déterministe** (`src/server/scoring`) ; l'IA fournit des faits extraits,
jamais le score.

| Critère | Défaut | Calcul |
|---|---|---|
| Adéquation technique | 25 | recouvrement compétences/technos exigées vs profil, CPV, mots-clés |
| Capacités & références | 20 | références similaires, certifications exigées détenues |
| Potentiel financier | 20 | budget estimé vs fourchette cible de l'entreprise |
| Faisabilité calendrier | 15 | jours restants avant la date limite, délais d'exécution |
| Complexité administrative | 10 | nombre de pièces obligatoires, visite obligatoire… |
| Risques contractuels | 10 | risques extraits pondérés par sévérité |

Pondérations modifiables (normalisées à 100). Information absente ⇒ note neutre
**et** listée dans « informations manquantes ».

**Critères éliminatoires** (évalués séparément, statut PASS/FAIL/UNKNOWN) : date
limite dépassée, avis annulé, pays/zone d'éligibilité, certifications obligatoires,
CA minimum, références minimales exigées, visite obligatoire. Décision :
`FAIL` ⇒ **NO-GO** quel que soit le score ; `UNKNOWN` ⇒ au mieux **À VÉRIFIER** ;
sinon ≥ 60 GO, 40–59 À VÉRIFIER, < 40 NO-GO.

Un **pré-score** (sans DCE) est calculé à l'import à partir des métadonnées de l'avis.

## 8. Mémoire technique

* Déclenché manuellement (jamais automatiquement à la détection).
* Plan par défaut (22 sections) **adapté** aux critères de notation extraits du RC.
* Génération section par section (job), contexte = analyse + profil + références
  (recherche plein texte) + extraits DCE. Les affirmations non sourcées dans les
  données entreprise sont balisées `[À VALIDER]`. Le modèle reçoit la consigne
  explicite de ne jamais inventer référence, certification, effectif, CA.
* Versions par section, régénération ciblée, validation humaine, matrice de
  conformité (Exigence | Réponse | Justificatif | Statut | Source).
* Export **DOCX** (`docx`), PDF en P1.

## 9. Sécurité

* Mots de passe bcrypt (coût 12) ; sessions opaques (32 octets aléatoires, seul le
  SHA-256 est stocké), cookie `HttpOnly; Secure; SameSite=Lax`, expiration 7 j.
* Limitation de tentatives de connexion (Redis, fenêtre glissante).
* RBAC : VIEWER (lecture) < MEMBER (édition) < ADMIN (sources, réglages) < OWNER.
* Validation Zod de toutes les entrées ; Prisma (requêtes paramétrées) ; le seul
  SQL brut (FTS) utilise `Prisma.sql` paramétré.
* Fichiers : liste blanche par magic bytes, limite de taille, anti zip-bomb,
  stockage privé, téléchargement via URL signée courte durée (S3 presign, ou HMAC
  pour le driver local) après contrôle d'accès.
* Secrets uniquement par variables d'environnement ; `.env` ignoré par git.
* Journal d'audit des opérations sensibles (connexion, upload, analyse,
  changement de statut, export, réglages).
* En-têtes de sécurité (CSP, X-Frame-Options, Referrer-Policy) via `next.config`.

## 10. Arbitrages techniques

| Décision | Choix | Raison |
|---|---|---|
| Framework | Next.js App Router + worker Node séparé | Spécification ; un seul langage ; traitements longs hors requête HTTP. |
| Auth | Implémentation maison (bcrypt + sessions en base) | Surface réduite, pas de dépendance beta (Auth.js v5) ; OAuth/SSO ajoutable plus tard. |
| Recherche DCE / RAG | FTS PostgreSQL français par défaut, pgvector optionnel | Anthropic ne fournit pas d'embeddings ; le FTS ne transmet aucune donnée à un tiers. Les DCE tiennent dans la fenêtre de 1M tokens de Claude, la recherche sert surtout à cibler les extraits par section. |
| Score | Déterministe | Explicable, testable, reproductible ; l'IA n'invente pas de note. |
| shadcn/ui | Composants recopiés à la main | CLI interactive ; même code source, même API. |
| OCR | Hors MVP | Coût/complexité ; détection `NEEDS_OCR` en place. |
| Dépôt sur plateforme acheteur | Manuel | Spécification MVP. |

## 11. Infrastructure

* `docker-compose.yml` : `postgres` (image `pgvector/pgvector:pg16`), `redis`,
  `s3` — SeaweedFS (toujours démarrés) ; `migrate`, `web`, `worker`, `nginx` (profil `app`).
* Développement sans Docker : PostgreSQL embarqué (`pnpm db:dev`), Redis local ;
  pgvector y est absent, ce que les migrations tolèrent.
* Les colonnes `search_vector` (FTS) sont créées par migration SQL et ignorées par
  Prisma : ne pas utiliser `prisma migrate dev` sans relire le diff (dérive
  attendue sur ces colonnes) ; ajouter les migrations à la main ou via
  `prisma migrate diff`. Un `Dockerfile` multi-stage (cible `web` en
  sortie `standalone`, cible `worker`).
* Migrations appliquées au démarrage (`prisma migrate deploy`).
* Logs JSON structurés (`pino`).
* CI GitHub Actions : install, lint, typecheck, tests unitaires, tests
  d'intégration (service Postgres), build.
* Cible : VPS Debian 12, TLS terminé par nginx (certbot) — voir README.

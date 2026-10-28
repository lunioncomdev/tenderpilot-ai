# TenderPilot AI

Plateforme de veille, de qualification et de préparation des réponses aux appels
d'offres informatiques (première organisation : Lunioncom).

- Veille **BOAMP** et **APProch** (projets d'achats publics) via leurs API officielles ouvertes, dédoublonnage
  inter-sources, prise en compte des rectificatifs, annulations et attributions.
- Recherche plein texte (PostgreSQL, français) et filtres, recherches sauvegardées.
- Import manuel des DCE (PDF, DOCX, XLSX, TXT, ZIP) avec extraction, découpage et
  traçabilité des pages ; pour le BOAMP, import automatique de l'extrait PDF de
  l'avis et lien direct vers le dossier de consultation de la plateforme acheteur.
- Analyse IA du DCE avec **Claude** : chaque information est reliée à un passage
  et la citation est vérifiée côté serveur ; « Non précisé » si absente.
- **Scoring déterministe explicable** + critères éliminatoires séparés → GO / NO-GO
  / À vérifier.
- Mémoire technique adapté aux critères de notation, édition par section,
  régénération ciblée, versions, validation humaine, matrice de conformité,
  **export DOCX**.
- Tableau de bord, pipeline de candidature, commentaires, journal d'audit.

Voir [ARCHITECTURE.md](ARCHITECTURE.md) et [TASKS.md](TASKS.md).

## Démarrage avec Docker Compose

```bash
cp .env.example .env    # puis renseigner SESSION_SECRET, POSTGRES_PASSWORD, S3_SECRET_ACCESS_KEY
docker compose --profile app up -d --build
```

L'application est servie sur http://localhost:8080 (nginx). Au premier accès,
`/setup` crée l'organisation et le compte propriétaire (une seule fois).

Services : `postgres` (pgvector), `redis`, `s3` (SeaweedFS), `migrate` (migrations au
démarrage), `web`, `worker`, `nginx`.

## Développement local

Prérequis : Node.js ≥ 20.11, pnpm 9.

```bash
pnpm install
cp .env.example .env              # puis renseigner les secrets
docker compose up -d              # postgres + redis + s3 seulement
pnpm db:migrate
pnpm dev                          # http://localhost:3000
pnpm worker:dev                   # autre terminal : jobs (sync, extraction, IA)
```

Sans Docker : `pnpm db:dev` démarre un PostgreSQL embarqué (données dans
`.data/postgres`, sans pgvector) sur le port de `DATABASE_URL` ; un Redis ≥ 5
local suffit (6.2+ recommandé). Mettre `STORAGE_DRIVER=local`.

Synchronisation immédiate sans file de tâches : `pnpm sync` (ou `pnpm sync APPROCH`).

## Activer l'IA

1. Dans `.env` : `AI_ENABLED=true`, `ANTHROPIC_API_KEY=…` (modèle par défaut
   `claude-opus-5-5`, `AI_EFFORT`, `AI_MONTHLY_BUDGET_USD`).
2. Dans **Profil entreprise › Confidentialité**, le propriétaire autorise
   explicitement l'envoi des DCE et du profil au fournisseur d'IA.

Aucun appel n'est fait automatiquement à la détection : l'analyse et la génération
sont déclenchées à la demande, avec quotas par offre et budget mensuel. Chaque
appel est journalisé (tokens, coût estimé) dans **Paramètres**.

## Tests

```bash
pnpm test:unit          # unitaires (connecteurs sur réponses réelles capturées, scoring, extraction, citations…)
pnpm test:integration   # PostgreSQL réel (embarqué, ou TEST_DATABASE_URL) : auth, sync, dédoublonnage, DCE, analyse, mémoire, DOCX, isolation des tenants
pnpm test:live          # appels réels aux API BOAMP et TED (réseau requis)
pnpm typecheck && pnpm lint
```

Les tests d'analyse/génération utilisent un fournisseur LLM **factice réservé aux
tests** (`tests/helpers/fake-llm.ts`) ; il n'est jamais utilisé par l'application.

## Déploiement (VPS Debian 12)

1. Installer Docker Engine + plugin Compose, cloner le dépôt, créer `.env`
   (`COOKIE_SECURE=true`, `APP_URL=https://votre-domaine`).
2. `docker compose --profile app up -d --build`.
3. TLS : placer un reverse proxy (Caddy, ou nginx + certbot) devant le port
   `HTTP_PORT`, ou adapter `deploy/nginx.conf`.
4. Sauvegardes : volumes `pgdata` (pg_dump quotidien) et `s3data`.

## Limites connues (MVP)

- Dépôt des offres sur les plateformes acheteurs : **manuel**.
- DCE : téléchargement par l'utilisateur sur la plateforme de l'acheteur puis
  import (pas de contournement d'authentification ni de CAPTCHA).
- OCR non embarqué : un PDF scanné est signalé « OCR requis ».
- PLACE / e-Procurement BE : pas de connecteur (pas d'API publique documentée
  pour PLACE ; les avis au-dessus des seuils figurent au BOAMP/TED).
- Chiffrage, alertes e-mail, bibliothèque RAG, export PDF : voir P1 dans TASKS.md.

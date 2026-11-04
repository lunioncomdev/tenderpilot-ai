# TenderPilot AI — Backlog

Légende : `[x]` fait et testé · `[~]` fait, vérification incomplète · `[ ]` à faire

## Lot 1 — Socle (P0)
- [x] Projet Next.js 15 / TypeScript strict / Tailwind 4 / composants style shadcn
- [x] Schéma Prisma multi-tenant + migrations (FTS français ; pgvector optionnel)
- [x] Authentification (bcrypt, sessions opaques hachées, rate limit Redis), initialisation du 1er compte
- [x] RBAC (OWNER/ADMIN/MEMBER/VIEWER) + isolation des tenants + journal d'audit
- [x] Layout applicatif FR, mode clair/sombre, navigation responsive, recherche globale
- [x] Profil entreprise + références + consentement IA

## Lot 2 — Veille (P0)
- [x] Connecteur BOAMP (API Opendatasoft DILA) — testé en réel
- [x] Connecteur TED (API Search v3) — testé en réel
- [x] Synchronisation : upsert, rectificatifs/annulations/attributions, dédoublonnage inter-sources (vérifié sur données réelles)
- [x] Administration des sources (activer/désactiver, lancer, historique) + cron toutes les 6 h
- [x] Recherche plein texte + filtres, recherches sauvegardées, API REST `GET /api/v1/tenders`
- [x] Fiche détaillée, statuts du workflow, affectation, commentaires, historique

## Lot 3 — DCE & IA (P0)
- [x] Import DCE (PDF/DOCX/XLSX/TXT/ZIP), contrôle magic bytes, anti zip-bomb, stockage local/S3, URL signées
- [x] Extraction + découpage avec pages et titres + index FTS
- [x] Abstraction LLM + provider Anthropic + journal des coûts + budget + quotas par offre
- [~] Analyse du DCE avec citations vérifiées — pipeline testé avec fournisseur factice ; **appel Claude réel non encore exécuté (clé API requise)**
- [x] Scoring déterministe + critères éliminatoires + recommandation

## Lot 4 — Mémoire & pilotage (P0)
- [~] Génération du mémoire (plan adapté, sections, régénération, versions, validation) — même réserve que l'analyse
- [x] Matrice de conformité
- [x] Export DOCX
- [x] Dashboard (KPI + graphiques)
- [~] Docker Compose + Dockerfile + nginx — écrits, **non exécutés** (Docker Desktop en panne sur le poste de dev)
- [x] README, .env.example, CI GitHub Actions

## P1
- [ ] Chiffrage avancé (moteur déterministe JH × TJM, scénarios) + DPGF/BPU sur modèle officiel (ExcelJS, cellules/formules préservées)
- [ ] Alertes e-mail (recherches sauvegardées `alertEnabled`, échéances)
- [ ] Checklist documentaire par candidature, mentions dans les commentaires
- [ ] Bibliothèque documentaire RAG (CV, méthodologies, anciens mémoires) + embeddings optionnels (Voyage)
- [ ] Export PDF du mémoire
- [x] OCR (Tesseract) pour les PDF scannés
- [ ] Éditeur riche (WYSIWYG) en complément de l'éditeur Markdown
- [x] Retrait automatique des DCE sur les plateformes Atexo (PLACE, Maximilien…) ; comptes plateformes chiffrés
- [ ] Retrait automatique sur AWS-Achat, achatpublic, Klekoon (comptes déjà enregistrables)
- [ ] Assistant IA contextuel (questions sur un DCE)

## P2
- [ ] Connecteurs supplémentaires (e-Procurement BE, plateformes privées autorisées)
- [ ] Multi-tenant commercial (inscription, invitations, changement d'organisation)
- [ ] Abonnements / facturation (structures `Plan` et quotas déjà en place)
- [ ] Analyse prédictive (taux de gain)
- [ ] Internationalisation (dictionnaire `src/i18n/fr.ts` à décliner)

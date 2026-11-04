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
- [x] Chiffrage : moteur déterministe JH × TJM + ajustement global, BPU/DPGF/DQE remplis sur le modèle officiel (ExcelJS, formules préservées), intégré au dossier ZIP
- [ ] Chiffrage : scénarios comparés, marge cible / coût de revient, import des .xls (ancien format)
- [ ] Alertes e-mail (recherches sauvegardées `alertEnabled`, échéances)
- [x] Checklist documentaire par candidature (pièces usuelles + exigences du DCE, liées au profil)
- [x] Fichiers joints aux pièces du dossier (AE signé, BPU rempli, CV…)
- [x] DC1 / DC2 pré-remplis (DOCX, déterministe) ; identité légale du candidat dans le profil
- [x] Export du dossier complet en ZIP (`01_Candidature/`, `02_Offre/`, sommaire des manques)
- [ ] Gestion des lots (candidature par lot : pièces, mémoire, AE)
- [ ] Contrôle « prêt à déposer » avant `READY_TO_SUBMIT` (pièces, validité, sections validées, contraintes du RC)
- [ ] Base d'intervenants / CV, attestations de bonne exécution jointes aux références
- [ ] Groupement et sous-traitance (co-traitants, mandataire, DC4)
- [ ] Questions à l'acheteur (brouillons depuis l'analyse, suivi des réponses)
- [ ] Mentions dans les commentaires
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

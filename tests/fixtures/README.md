# Fixtures de test

Ces fichiers sont des **réponses réelles** des API publiques, capturées le 27/10/2026,
utilisées uniquement par les tests unitaires (aucune donnée de démonstration dans
l'application) :

| Fichier | Source | Requête |
|---|---|---|
| `boamp-records.json` | API Explore v2.1 BOAMP (DILA) | `where=idweb IN ("26-103042","26-101861","26-103266")` |
| `ted-search.json` | API Search v3 TED | CPV 72*, acheteurs FRA, publiés depuis le 20/10/2026, 3 résultats |

Les documents DCE de test (`dce-*`) sont générés par les tests eux-mêmes et sont
fictifs, explicitement marqués comme tels.

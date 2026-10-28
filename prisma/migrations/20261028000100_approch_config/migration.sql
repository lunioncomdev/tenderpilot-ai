-- Active APProch pour les organisations existantes (une nouvelle valeur d'enum
-- ne peut pas servir dans la transaction qui l'a créée, d'où une migration à part).
INSERT INTO "SourceConfig" ("id", "organizationId", "source", "enabled", "settings")
SELECT 'approch_' || o."id", o."id", 'APPROCH', true, '{}'
FROM "Organization" o
ON CONFLICT ("organizationId", "source") DO NOTHING;

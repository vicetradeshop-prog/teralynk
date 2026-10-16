import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Utilitaires de schéma                                               */
/* ------------------------------------------------------------------ */

/** Version sémantique stricte : MAJEURE.MINEURE.PATCH[-prerelease]. */
export const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/, 'Version sémantique invalide (attendu X.Y.Z)');

/** Empreinte SHA-256 hexadécimale (64 caractères). */
export const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'Empreinte SHA-256 invalide');

/** ISO 8601 date/time. */
export const isoDateSchema = z.string().datetime({ offset: true });

/**
 * URL distante autorisée : uniquement https, et uniquement depuis les hôtes
 * de distribution GitHub. Toute autre origine est rejetée à la validation,
 * ce qui empêche un manifeste compromis de pointer vers un serveur arbitraire.
 */
export const allowedScriptHosts = [
  'raw.githubusercontent.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
] as const;

export const trustedHttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return false;
      return (allowedScriptHosts as readonly string[]).includes(url.hostname);
    } catch {
      return false;
    }
  }, 'URL non autorisée : https vers un hôte GitHub de distribution uniquement');

/** Icône de carte : nom d'icône intégrée OU https depuis un hôte GitHub. */
export const iconSchema = z.union([
  z.string().regex(/^[a-z0-9-]{1,64}$/i, "Nom d'icône invalide"),
  trustedHttpsUrlSchema
]);

/* ------------------------------------------------------------------ */
/* Catalogue de cartes                                                 */
/* ------------------------------------------------------------------ */

export const cardStatusSchema = z.enum([
  'available', // script publié, exécutable après vérification
  'soon', // bientôt disponible — exécution désactivée
  'new', // nouveauté récente, exécutable
  'experimental', // phase expérimentale, exécutable avec avertissement
  'unavailable' // temporairement indisponible
]);
export type CardStatus = z.infer<typeof cardStatusSchema>;

export const runtimeIdSchema = z.enum(['powershell', 'pwsh', 'python', 'node', 'batch', 'info']);
export type RuntimeId = z.infer<typeof runtimeIdSchema>;

export const riskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const platformSchema = z.enum(['windows', 'macos', 'linux']);
export type Platform = z.infer<typeof platformSchema>;

export const scriptSpecSchema = z.object({
  /** Runtime requis pour l'exécution. `info` = carte purement informative, jamais exécutable. */
  runtime: runtimeIdSchema,
  /** URL https du script sur un hôte GitHub autorisé. */
  url: trustedHttpsUrlSchema,
  /** Empreinte SHA-256 attendue du fichier de script. Obligatoire dès qu'un runtime réel est déclaré. */
  sha256: sha256Schema.optional(),
  /** Arguments fixes passés au runtime (jamais d'entrée utilisateur brute). */
  args: z.array(z.string().min(1).max(512)).max(16).default([]),
  /** Le script requiert des privilèges administrateur (affiché, jamais auto-élévé). */
  requiresAdmin: z.boolean().default(false)
});
export type ScriptSpec = z.infer<typeof scriptSpecSchema>;

export const featureCardSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'Identifiant de carte invalide (kebab-case)'),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    longDescription: z.string().max(20000).optional(),
    category: z.string().min(1).max(60),
    icon: iconSchema.default('sparkles'),
    tags: z.array(z.string().min(1).max(40)).max(12).default([]),
    version: semverSchema.optional(),
    status: cardStatusSchema.default('soon'),
    platforms: z.array(platformSchema).min(1).default(['windows']),
    requirements: z.array(z.string().max(300)).max(20).default([]),
    permissions: z.array(z.string().max(300)).max(20).default([]),
    /** Opérations principales réalisées — affichées avant exécution. */
    capabilities: z.array(z.string().max(300)).max(20).default([]),
    knownRisks: z.array(z.string().max(500)).max(10).default([]),
    riskLevel: riskLevelSchema.default('low'),
    script: scriptSpecSchema.optional(),
    /** Raison de l'indisponibilité, affichée si status = unavailable/soon. */
    unavailableReason: z.string().max(500).optional(),
    releaseNotes: z.string().max(10000).optional(),
    featured: z.boolean().default(false),
    enabled: z.boolean().default(true),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  })
  .superRefine((card, ctx) => {
    const executable = card.script && card.script.runtime !== 'info';
    if (executable && !card.script?.sha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['script', 'sha256'],
        message: "Une carte exécutable doit déclarer l'empreinte SHA-256 de son script"
      });
    }
    if ((card.status === 'available' || card.status === 'new') && !executable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'Un statut "available"/"new" exige un script exécutable avec empreinte'
      });
    }
    if (card.status === 'unavailable' && !card.unavailableReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unavailableReason'],
        message: 'Une carte indisponible doit expliquer pourquoi'
      });
    }
  });
export type FeatureCard = z.infer<typeof featureCardSchema>;

export const catalogManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDateSchema,
  cards: z.array(featureCardSchema).max(500)
});
export type CatalogManifest = z.infer<typeof catalogManifestSchema>;

/* ------------------------------------------------------------------ */
/* Annonces                                                            */
/* ------------------------------------------------------------------ */

export const announcementCategorySchema = z.enum([
  'general',
  'release',
  'feature',
  'update',
  'maintenance',
  'alert',
  'catalog',
  'upcoming'
]);
export type AnnouncementCategory = z.infer<typeof announcementCategorySchema>;

export const announcementPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);
export type AnnouncementPriority = z.infer<typeof announcementPrioritySchema>;

export const announcementSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(400),
  body: z.string().min(1).max(50000),
  category: announcementCategorySchema.default('general'),
  priority: announcementPrioritySchema.default('normal'),
  illustration: trustedHttpsUrlSchema.optional(),
  link: trustedHttpsUrlSchema.optional(),
  publishedAt: isoDateSchema,
  expiresAt: isoDateSchema.optional(),
  published: z.boolean().default(true)
});
export type Announcement = z.infer<typeof announcementSchema>;

export const announcementsManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDateSchema,
  announcements: z.array(announcementSchema).max(200)
});
export type AnnouncementsManifest = z.infer<typeof announcementsManifestSchema>;

/* ------------------------------------------------------------------ */
/* Sondages                                                            */
/* ------------------------------------------------------------------ */

/**
 * Mode de participation — distinction HONNÊTE imposée par l'architecture :
 * - `local`  : le choix est enregistré sur cet ordinateur uniquement.
 *              Jamais présenté comme un vote centralisé.
 * - `github` : participation centralisée via issues GitHub dédiées.
 *              Chaque option est une issue ; voter = réaction "+1" sur l'issue.
 *              La lecture des résultats est publique ; le vote exige un
 *              jeton GitHub de l'utilisateur (scope public_repo).
 */
export const pollModeSchema = z.enum(['local', 'github']);
export type PollMode = z.infer<typeof pollModeSchema>;

export const pollOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  /** Uniquement en mode github : numéro de l'issue dédiée à cette option. */
  issueNumber: z.number().int().positive().optional()
});
export type PollOption = z.infer<typeof pollOptionSchema>;

export const pollSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).default(''),
    options: z.array(pollOptionSchema).min(2).max(8),
    mode: pollModeSchema.default('local'),
    startsAt: isoDateSchema,
    endsAt: isoDateSchema,
    status: z.enum(['draft', 'open', 'closed', 'archived']).default('draft'),
    createdAt: isoDateSchema
  })
  .superRefine((poll, ctx) => {
    if (poll.mode === 'github') {
      poll.options.forEach((option, index) => {
        if (option.issueNumber === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options', index, 'issueNumber'],
            message: 'Un sondage centralisé (github) exige une issue par option'
          });
        }
      });
    }
    const ids = new Set(poll.options.map((o) => o.id));
    if (ids.size !== poll.options.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Identifiants d’options dupliqués' });
    }
  });
export type Poll = z.infer<typeof pollSchema>;

export const pollsManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDateSchema,
  polls: z.array(pollSchema).max(50)
});
export type PollsManifest = z.infer<typeof pollsManifestSchema>;

/* ------------------------------------------------------------------ */
/* Versions et mises à jour                                            */
/* ------------------------------------------------------------------ */

export const versionReleaseSchema = z.object({
  version: semverSchema,
  channel: z.enum(['stable', 'beta']),
  title: z.string().min(1).max(160),
  notes: z.string().max(20000).default(''),
  publishedAt: isoDateSchema,
  /** Tag Git de la release GitHub. */
  tag: z.string().min(1).max(100),
  /**
   * Version minimale autorisée : toute installation strictement inférieure
   * est bloquée et doit se mettre à jour (mise à jour obligatoire).
   */
  minSupportedVersion: semverSchema,
  files: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^[A-Za-z0-9._-]{1,200}$/, 'Nom de fichier invalide')
          .refine((n) => !n.includes('..'), 'Chemin dangereux'),
        sha256: sha256Schema,
        size: z.number().int().nonnegative()
      })
    )
    .default([])
});
export type VersionRelease = z.infer<typeof versionReleaseSchema>;

export const versionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.enum(['stable', 'beta']),
  latest: versionReleaseSchema,
  /** Historique des versions publiées (plus récentes d'abord). */
  history: z.array(versionReleaseSchema).max(100).default([]),
  /** Empreinte SHA-256 du manifeste de catalogue actuellement publié (cohérence contenu/version). */
  catalogSha256: sha256Schema.optional()
});
export type VersionManifest = z.infer<typeof versionManifestSchema>;

/* ------------------------------------------------------------------ */
/* Paquet de publication (ZIP soumis depuis Teralynk Admin)            */
/* ------------------------------------------------------------------ */

/**
 * Format de paquet documenté et stable (docs/admin.md §Publication) :
 * le ZIP doit contenir à sa racine :
 *   - `teralynk.package.json`  : métadonnées du paquet (schéma ci-dessous)
 *   - les artefacts de distribution (ex. `Teralynk-Setup-x.y.z.exe`, `latest.yml`)
 * Tout autre contenu est refusé s'il présente un chemin dangereux.
 */
export const packageMetadataSchema = z.object({
  packageFormat: z.literal(1),
  app: z.literal('teralynk'),
  version: semverSchema,
  channel: z.enum(['stable', 'beta']).default('stable'),
  /** Fichiers de distribution attendus dans le ZIP (noms à la racine du ZIP). */
  files: z
    .array(z.string().regex(/^[A-Za-z0-9._-]{1,200}$/).refine((n) => !n.includes('..')))
    .min(1)
    .max(50),
  /** Fichier utilisé par electron-updater, s'il est présent. */
  updaterManifest: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/).optional(),
  minSupportedVersion: semverSchema,
  title: z.string().min(1).max(160),
  notes: z.string().max(20000).default(''),
  builtAt: isoDateSchema
});
export type PackageMetadata = z.infer<typeof packageMetadataSchema>;

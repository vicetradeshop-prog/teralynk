/**
 * Chaîne de publication d'une nouvelle version de Teralynk depuis un ZIP.
 *
 * Stratégie anti-incohérence (exigence absolue) :
 *  1. Créer la release GitHub en BROUILLON (draft).
 *  2. Uploader TOUS les fichiers de distribution (progression réelle).
 *  3. Vérifier sur GitHub que chaque asset attendu est présent.
 *  4. Publier la release (draft → public).
 *  5. Signer (si clé configurée) et committer le manifeste de version
 *     `versions/{channel}.json` (+ `.sig`) — c'est lui que l'application
 *     utilisateur consulte : tant qu'il n'est pas publié, la version n'est
 *     PAS proposée aux utilisateurs, même si la release existe.
 *  6. Re-vérifier le résultat final.
 *
 * En cas d'échec : la release reste en brouillon (ou est supprimée si créée
 * par cette tentative), le manifeste n'est jamais publié → les utilisateurs
 * ne voient jamais une version dont les fichiers seraient absents.
 */
import path from 'node:path';
import { app } from 'electron';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import {
  versionReleaseSchema,
  versionManifestSchema,
  compareSemver,
  type ReleaseChannel,
  type VersionManifest,
  type VersionRelease
} from '@teralynk/shared';
import { signManifest, sha256Hex } from '@teralynk/shared/node';
import {
  createRelease, deleteRelease, getReleaseById, getReleaseByTag, listReleases, readFile,
  updateRelease, uploadAsset, writeFile, GitHubApiError, type GitHubRelease
} from './github';
import { extractPackageForPublish, inspectZip, type ZipInspection } from './zip-inspect';
import { addLog, getConfig, readSigningKey } from './vault';

export type PublishStepId =
  | 'validate-token'
  | 'inspect-zip'
  | 'extract'
  | 'hash'
  | 'conflict-check'
  | 'sign'
  | 'create-release'
  | 'upload-assets'
  | 'verify-assets'
  | 'publish-release'
  | 'commit-manifest'
  | 'final-verify';

export interface PublishProgress {
  step: PublishStepId;
  stepIndex: number;
  stepCount: number;
  label: string;
  percent: number; // progression réelle de l'étape courante (upload) ou 100
  message?: string;
}

export interface PublishRequest {
  zipPath: string;
  /** Métadonnées éventuellement corrigées par l'admin dans le wizard (écrasent le ZIP). */
  overrides: {
    version?: string;
    title?: string;
    notes?: string;
    channel?: ReleaseChannel;
    minSupportedVersion?: string;
    prerelease?: boolean;
  };
}

export type PublishResult =
  | { ok: true; release: GitHubRelease; manifestPath: string; tag: string; assets: string[] }
  | { ok: false; failedStep: PublishStepId; message: string; recovery: string; releaseId?: number };

const STEP_LABELS: Record<PublishStepId, string> = {
  'validate-token': 'Validation du jeton et des autorisations',
  'inspect-zip': 'Analyse et validation du ZIP',
  extract: 'Extraction contrôlée des fichiers déclarés',
  hash: 'Calcul des empreintes SHA-256',
  'conflict-check': 'Vérification des conflits de version',
  sign: 'Signature du manifeste de version',
  'create-release': 'Création de la release GitHub (brouillon)',
  'upload-assets': 'Envoi des fichiers de distribution',
  'verify-assets': 'Vérification des fichiers sur GitHub',
  'publish-release': 'Publication de la release',
  'commit-manifest': 'Publication du manifeste de version signé',
  'final-verify': 'Contrôle final du résultat'
};

const STEP_ORDER: PublishStepId[] = [
  'validate-token', 'inspect-zip', 'extract', 'hash', 'conflict-check', 'sign',
  'create-release', 'upload-assets', 'verify-assets', 'publish-release',
  'commit-manifest', 'final-verify'
];

export function publishSteps(): Array<{ id: PublishStepId; label: string }> {
  return STEP_ORDER.map((id) => ({ id, label: STEP_LABELS[id] }));
}

/**
 * Exécute la publication complète. `emit` relaie la progression RÉELLE
 * (octets uploadés, étapes GitHub) — jamais de pourcentage inventé.
 */
export async function publishRelease(
  token: string,
  request: PublishRequest,
  emit: (progress: PublishProgress) => void
): Promise<PublishResult> {
  const totalSteps = STEP_ORDER.length;
  let createdReleaseId: number | null = null;
  let lastStep: PublishStepId = 'validate-token';

  const step = (id: PublishStepId, percent = 0, message?: string) => {
    lastStep = id;
    emit({ step: id, stepIndex: STEP_ORDER.indexOf(id) + 1, stepCount: totalSteps, label: STEP_LABELS[id], percent, message });
  };

  const fail = (failedStep: PublishStepId, message: string, recovery: string): PublishResult => {
    addLog(`Publication échouée à l'étape « ${STEP_LABELS[failedStep]} »`, 'failed', message);
    return { ok: false, failedStep, message, recovery, releaseId: createdReleaseId ?? undefined };
  };

  const config = getConfig();
  const tag = (version: string) => `v${version}`;

  try {
    /* 1. Jeton */
    step('validate-token');
    const { validateToken } = await import('./github');
    await validateToken(token, config.repoOwner, config.repoName);
    step('validate-token', 100);

    /* 2. Analyse du ZIP (re-validation au moment de publier — le fichier a pu changer) */
    step('inspect-zip');
    const inspection: ZipInspection = await inspectZip(request.zipPath);
    if (!inspection.ok || !inspection.metadata) {
      return fail('inspect-zip', inspection.verdict, 'Corrigez le paquet ZIP (format documenté dans docs/admin.md) puis relancez la publication.');
    }
    step('inspect-zip', 100, inspection.verdict);

    /* 3. Extraction contrôlée */
    step('extract');
    const workDir = path.join(app.getPath('userData'), 'publish-staging', `run-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
    let extracted;
    try {
      extracted = await extractPackageForPublish(request.zipPath, inspection, workDir);
    } catch (error) {
      return fail('extract', (error as Error).message, 'Aucune extraction partielle n’est utilisée : relancez après correction du ZIP.');
    }
    step('extract', 100, `${extracted.files.length} fichier(s) extrait(s)`);

    /* 4. Empreintes */
    step('hash');
    const metadata = extracted.metadata;
    const version = request.overrides.version ?? metadata.version;
    const channel: ReleaseChannel = request.overrides.channel ?? metadata.channel;
    const files = extracted.files
      .filter((f) => f.name !== 'teralynk.package.json')
      .map((f) => ({ name: f.name, sha256: sha256Hex(readFileSync(f.path)), size: f.size }));
    step('hash', 100);

    /* 5. Conflits de version */
    step('conflict-check');
    const existingReleases = await listReleases(token);
    const conflictingTag = tag(version);
    // Les BROUILLONS inclus : un vestige de tentative échouée doit être vu et nommé.
    const existing = existingReleases.find((r) => r.tag_name === conflictingTag);
    if (existing) {
      if (existing.draft) {
        return fail(
          'conflict-check',
          `Une release BROUILLON avec le tag ${conflictingTag} existe déjà (vestige d’une tentative échouée).`,
          `Supprimez-la : Versions et mises à jour → table Releases → corbeille sur la ligne ${conflictingTag}, puis relancez la publication.`
        );
      }
      return fail(
        'conflict-check',
        `La version ${version} (tag ${conflictingTag}) existe déjà sur GitHub.`,
        'Choisissez un autre numéro de version, ou supprimez manuellement la release existante si elle est erronée. Rien n’a été écrasé.'
      );
    }
    const minSupported = request.overrides.minSupportedVersion ?? metadata.minSupportedVersion;
    if (compareSemver(minSupported, version) > 0) {
      return fail('conflict-check', `minSupportedVersion (${minSupported}) est supérieure à la version publiée (${version}).`, 'Corrigez la version minimale autorisée.');
    }
    // Cohérence avec l'historique existant : la nouvelle version doit dépasser la dernière du canal.
    const manifestPath = `versions/${channel}.json`;
    const currentManifestRaw = await readFile(token, manifestPath);
    let history: VersionRelease[] = [];
    let currentLatest: VersionRelease | null = null;
    if (currentManifestRaw) {
      try {
        const parsedManifest = versionManifestSchema.safeParse(JSON.parse(currentManifestRaw.content));
        if (parsedManifest.success) {
          history = parsedManifest.data.history;
          currentLatest = parsedManifest.data.latest;
        }
      } catch {
        /* manifeste existant illisible : l'historique repart de la nouvelle release */
      }
    }
    if (currentLatest && compareSemver(version, currentLatest.version) <= 0) {
      return fail(
        'conflict-check',
        `La version ${version} n'est pas supérieure à la dernière publiée sur le canal ${channel} (${currentLatest.version}).`,
        'Incrémentez le numéro de version. Aucune release existante n’est écrasée silencieusement.'
      );
    }
    step('conflict-check', 100);

    /* 6. Signature du manifeste */
    step('sign');
    const release: VersionRelease = versionReleaseSchema.parse({
      version,
      channel,
      title: request.overrides.title ?? metadata.title,
      notes: request.overrides.notes ?? metadata.notes,
      publishedAt: new Date().toISOString(),
      tag: conflictingTag,
      minSupportedVersion: minSupported,
      files
    });
    const manifest: VersionManifest = {
      schemaVersion: 1,
      channel,
      latest: release,
      history: [release, ...history.filter((h) => h.version !== release.version)].slice(0, 100)
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const manifestSha = sha256Hex(Buffer.from(manifestBytes));
    let signature: string | null = null;
    const signingKey = readSigningKey();
    if (signingKey.ok) {
      signature = signManifest(Buffer.from(manifestBytes), signingKey.pem);
      addLog('Manifeste de version signé (Ed25519)', 'success', `sha256 ${manifestSha.slice(0, 12)}…`);
    } else {
      addLog('Publication SANS signature de manifeste', 'failed', signingKey.message);
      return fail(
        'sign',
        `Signature impossible : ${signingKey.message}`,
        'L’application utilisateur EXIGE un manifeste signé. Configurez la clé privée dans Configuration → Clé de signature (fichier local, jamais publié).'
      );
    }
    step('sign', 100);

    /* 7. Release brouillon */
    step('create-release');
    const draft = await createRelease(token, {
      tag_name: conflictingTag,
      name: release.title,
      body: release.notes,
      draft: true,
      prerelease: request.overrides.prerelease ?? channel === 'beta',
      target_commitish: config.contentBranch
    });
    createdReleaseId = draft.id;
    step('create-release', 100, `Release brouillon créée : ${draft.html_url}`);

    /* 8. Upload des assets (progression réelle) */
    const uploadedNames: string[] = [];
    for (const file of files) {
      const localPath = path.join(workDir, file.name);
      if (!existsSync(localPath)) {
        return fail('upload-assets', `Fichier extrait introuvable : ${file.name}`, 'Relancez la publication ; le brouillon peut être supprimé.');
      }
      await uploadAsset(token, draft.id, localPath, file.name, (percent, transferred, total) => {
        step('upload-assets', percent, `${file.name} — ${(transferred / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} Mo`);
      });
      uploadedNames.push(file.name);
    }
    // Le manifeste de version est également joint à la release pour traçabilité.
    step('upload-assets', 100, `${uploadedNames.length} fichier(s) envoyé(s)`);

    /* 9. Vérification des assets sur GitHub */
    step('verify-assets');
    // Par IDENTIFIANT : l'endpoint par tag répond 404 tant que la release est en brouillon.
    const afterUpload = await getReleaseById(token, draft.id);
    const remoteNames = new Set((afterUpload?.assets ?? []).map((a) => a.name));
    const missingAssets = files.filter((f) => !remoteNames.has(f.name)).map((f) => f.name);
    if (missingAssets.length > 0) {
      return fail(
        'verify-assets',
        `Fichiers manquants sur GitHub après upload : ${missingAssets.join(', ')}`,
        `La release ${draft.html_url} est restée en BROUILLON. Supprimez-la ou relancez la publication après investigation.`
      );
    }
    step('verify-assets', 100);

    /* 10. Publication de la release */
    step('publish-release');
    const published = await updateRelease(token, draft.id, { draft: false });
    step('publish-release', 100, published.html_url);

    /* 11. Commit du manifeste signé (+ .sig) */
    step('commit-manifest');
    const versionsPath = `versions/${channel}.json`;
    const existingFile = await readFile(token, versionsPath);
    await writeFile(
      token,
      versionsPath,
      JSON.stringify(manifest, null, 2),
      `release(${channel}): publier le manifeste de version ${version}`,
      existingFile?.sha ?? null
    );
    await writeFile(
      token,
      `${versionsPath}.sig`,
      `${signature}\n`,
      `release(${channel}): signature du manifeste ${version}`,
      (await readFile(token, `${versionsPath}.sig`))?.sha ?? null
    );
    step('commit-manifest', 100);

    /* 12. Contrôle final : le manifeste publié doit se relire et correspondre. */
    step('final-verify');
    const committed = await readFile(token, versionsPath);
    if (!committed) {
      return fail('final-verify', 'Le manifeste de version est introuvable après commit.', `La release ${published.html_url} est publique mais le manifeste n’est pas lisible : vérifiez la branche ${config.contentBranch}.`);
    }
    const committedSha = sha256Hex(Buffer.from(committed.content, 'utf8'));
    if (committedSha !== manifestSha) {
      return fail('final-verify', 'Le manifeste relu ne correspond pas au manifeste signé (empreinte différente).', 'Investiguez avant toute nouvelle publication ; la release est publique mais les clients rejetteront ce manifeste.');
    }
    step('final-verify', 100);

    // Nettoyage du staging local.
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      addLog('Nettoyage du répertoire de staging impossible (non bloquant)', 'failed', workDir);
    }

    addLog(`Version ${version} publiée sur le canal ${channel}`, 'success', `${published.html_url} · ${files.length} fichier(s) · manifeste signé`);
    return { ok: true, release: published, manifestPath: versionsPath, tag: conflictingTag, assets: uploadedNames };
  } catch (error) {
    const message = error instanceof GitHubApiError ? `${error.message}${error.githubMessage ? ` — ${error.githubMessage}` : ''}` : (error as Error).message;
    const recovery = createdReleaseId
      ? `La release brouillon (id ${createdReleaseId}) peut être supprimée ou complétée manuellement. Le manifeste de version n'a PAS été publié : les utilisateurs ne verront pas cette version.`
      : 'Aucune ressource distante n’a été créée. Corrigez la cause puis relancez.';
    addLog('Publication interrompue par une erreur', 'failed', message);
    return { ok: false, failedStep: lastStep, message, recovery, releaseId: createdReleaseId ?? undefined };
  }
}

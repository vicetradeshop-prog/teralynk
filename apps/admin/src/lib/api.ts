/**
 * Client API typé du renderer de Teralynk Admin.
 * Le jeton administrateur ne remonte jamais ici : uniquement des statuts.
 */
import type {
  AnnouncementsManifest,
  CatalogManifest,
  PollsManifest,
  ReleaseChannel,
  VersionManifest
} from '@teralynk/shared';

export interface AdminLogEntryView {
  at: string;
  action: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  detail?: string;
}

export interface AdminConfigView {
  repoOwner: string;
  repoName: string;
  contentBranch: string;
  signingKeyPath: string | null;
}

export interface TokenValidation {
  ok: boolean;
  login?: string;
  scopes?: string[];
  repoAccess?: { pull: boolean; push: boolean; admin: boolean };
  privateRepo?: boolean;
  repo?: string;
  branch?: string;
  message?: string;
  status?: number;
  hint?: string;
}

export interface GitHubReleaseView {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: Array<{ id: number; name: string; size: number; state: string; browser_download_url: string }>;
}

export interface ZipFileInfo {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export interface ZipInspectionView {
  ok: boolean;
  entries: Array<{ name: string; uncompressedSize: number; isDirectory: boolean }>;
  totalUncompressedSize: number;
  pathIssues: Array<{ entry: string; reason: string }>;
  hasPackageMetadata: boolean;
  metadata: {
    packageFormat: 1;
    app: 'teralynk';
    version: string;
    channel: ReleaseChannel;
    files: string[];
    updaterManifest?: string;
    minSupportedVersion: string;
    title: string;
    notes: string;
    builtAt: string;
  } | null;
  metadataError: string | null;
  missingFiles: string[];
  looksLikeSourceArchive: boolean;
  verdict: string;
}

export interface PublishProgressView {
  step: string;
  stepIndex: number;
  stepCount: number;
  label: string;
  percent: number;
  message?: string;
}

export type PublishResultView =
  | { ok: true; release: GitHubReleaseView; manifestPath: string; tag: string; assets: string[] }
  | { ok: false; failedStep: string; message: string; recovery: string; releaseId?: number };

export interface ContentReadResult {
  ok: boolean;
  content?: CatalogManifest | AnnouncementsManifest | PollsManifest | Record<string, unknown> | null;
  versions?: Record<string, { content: VersionManifest; sha: string } | null>;
  path?: string;
  exists?: boolean;
  sha?: string;
  validation?: { ok: boolean; issues?: string };
  message?: string;
  status?: number;
  hint?: string;
}

declare global {
  interface Window {
    teralynkAdmin: {
      admin: {
        tokenStatus(): Promise<{ exists: boolean; encryptionAvailable: boolean }>;
        storeToken(token: string): Promise<{ ok: boolean; message?: string }>;
        validateToken(): Promise<TokenValidation>;
        clearToken(): Promise<{ ok: boolean }>;
      };
      config: {
        get(): Promise<AdminConfigView>;
        save(patch: Partial<AdminConfigView>): Promise<{ ok: boolean; config?: AdminConfigView; message?: string }>;
        selectSigningKey(): Promise<{ ok: boolean; cancelled?: boolean; message?: string; fileName?: string; config?: AdminConfigView }>;
        signingKeyStatus(): Promise<{ configured: boolean; exists: boolean; fileName?: string }>;
      };
      logs: {
        get(): Promise<AdminLogEntryView[]>;
        clear(): Promise<{ ok: boolean }>;
      };
      content: {
        read(kind: 'catalog' | 'announcements' | 'polls' | 'versions'): Promise<ContentReadResult>;
        publish(kind: 'catalog' | 'announcements' | 'polls', payload: unknown, message: string): Promise<{ ok: boolean; path?: string; signed?: boolean; message?: string; status?: number; hint?: string; recovery?: string }>;
      };
      polls: {
        createIssues(poll: unknown): Promise<{ ok: boolean; poll?: unknown; message?: string; hint?: string; recovery?: string }>;
      };
      releases: {
        list(): Promise<{ ok: boolean; releases?: GitHubReleaseView[]; message?: string }>;
        selectZip(): Promise<{ ok: boolean; cancelled?: boolean; file?: ZipFileInfo; message?: string }>;
        inspectZip(zipPath: string): Promise<{ ok: boolean; inspection?: ZipInspectionView; message?: string }>;
        publishSteps(): Promise<Array<{ id: string; label: string }>>;
        publish(request: { zipPath: string; overrides: Record<string, unknown> }): Promise<PublishResultView>;
        deleteDraft(releaseId: number): Promise<{ ok: boolean; message?: string }>;
        byTag(tag: string): Promise<{ ok: boolean; release?: GitHubReleaseView | null; message?: string }>;
        onProgress(listener: (progress: PublishProgressView) => void): () => void;
      };
      versions: {
        validate(payload: unknown): Promise<{ ok: boolean; issues?: string[] }>;
      };
      system: {
        info(): Promise<{ appVersion: string; platform: string; arch: string; electron: string; userData: string }>;
        openExternal(url: string): Promise<{ ok: boolean; message?: string }>;
        openUserData(): Promise<{ ok: boolean; dir: string }>;
      };
    };
  }
}

export const adminApi = typeof window !== 'undefined' ? window.teralynkAdmin : undefined;

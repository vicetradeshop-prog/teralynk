/**
 * Client API du renderer — accès typé à la surface exposée par le preload.
 * Le renderer n'a AUCUN accès direct à Node/Electron : tout passe par ici.
 */
import type {
  AnnouncementsManifest,
  CatalogManifest,
  FeatureCard,
  Poll,
  PollsManifest,
  ReleaseChannel,
  VersionManifest
} from '@teralynk/shared';

export interface ContentOk<T> {
  ok: true;
  data: T;
  source: 'network' | 'cache';
  fetchedAt: string;
  stale: boolean;
}
export interface ContentErr {
  ok: false;
  error: { kind: string; message: string; detail?: string };
}
export type ContentResponse<T> = ContentOk<T> | ContentErr;

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface RunEventPayload {
  runId: string;
  type: 'stdout' | 'stderr' | 'info' | 'exit';
  text?: string;
  code?: number | null;
  signal?: string | null;
  durationMs?: number;
  at: string;
}

export interface PreparedScriptView {
  token: string;
  cardId: string;
  cardVersion?: string;
  scriptPath: string;
  sha256: string;
  sha256Matches: true;
  runtime: { id: string; label: string; detected: boolean; version?: string; executablePath?: string; installHint: string };
  contentPreview: string;
  contentTruncated: boolean;
  requiresAdmin: boolean;
  preparedAt: number;
}

export type PrepareResponse = { ok: true; prepared: PreparedScriptView } | { ok: false; stage: string; message: string; detail?: string };

export interface SystemInfo {
  appVersion: string;
  electronVersion: string;
  platform: string;
  arch: string;
  osRelease: string;
  locale: string;
  packaged: boolean;
  repoUrl: string;
  releasesUrl: string;
  remote: { owner: string; repo: string; branch: string };
}

export interface UpdateGateView {
  outcome:
    | { state: 'up-to-date'; manifest: VersionManifest; offline: boolean }
    | { state: 'optional-update'; manifest: VersionManifest; offline: boolean }
    | { state: 'mandatory-update'; manifest: VersionManifest; offline: boolean }
    | { state: 'blocked-offline'; reason: string; detail?: string }
    | { state: 'blocked-invalid'; reason: string; detail?: string };
  installedVersion: string;
  channel: ReleaseChannel;
  checkedAt: string;
  canAutoInstall: boolean;
  releasesUrl: string;
}

export interface PrefsView {
  theme: 'dark';
  accent: 'violet' | 'blue' | 'iridescent';
  reduceMotion: 'system' | 'on' | 'off';
  visualIntensity: 'subtle' | 'balanced' | 'rich';
  skipIntro: boolean;
  updateChannel: ReleaseChannel;
  windowStart: 'default' | 'maximized';
  historyRetentionDays: number;
  favorites: string[];
  lastFilters: {
    query: string;
    category: string | null;
    status: string | null;
    platform: string | null;
    sort: 'featured' | 'name' | 'created' | 'updated';
  };
  localPollVotes: Record<string, string>;
  userGithubTokenExists: boolean;
  history: Array<{
    id: string;
    at: string;
    type: 'script-run' | 'script-cancelled' | 'script-failed' | 'card-viewed' | 'poll-voted' | 'update-check';
    cardId?: string;
    pollId?: string;
    optionId?: string;
    detail?: string;
    exitCode?: number | null;
  }>;
  lastUpdateCheck: { at: string; result: string; installedVersion: string; latestVersion: string | null } | null;
  seenCardVersions: Record<string, string>;
}

export interface PollResultsView {
  pollId: string;
  mode: 'github';
  fetchedAt: string;
  options: Array<{ optionId: string; issueNumber: number; plusOne: number; totalReactions: number; url: string }>;
}

declare global {
  interface Window {
    teralynk: {
      system: {
        info(): Promise<SystemInfo>;
        githubStatus(): Promise<{ reachable: boolean; latencyMs: number | null; detail?: string }>;
        openLogs(): Promise<{ ok: boolean; dir: string }>;
        openExternal(url: string): Promise<{ ok: boolean; message?: string }>;
      };
      updates: {
        check(channel?: ReleaseChannel): Promise<UpdateGateView>;
        download(): Promise<{ started: boolean; error?: string }>;
        installNow(): Promise<{ ok: boolean }>;
      };
      content: {
        catalog(): Promise<ContentResponse<CatalogManifest>>;
        announcements(): Promise<ContentResponse<AnnouncementsManifest>>;
        polls(): Promise<ContentResponse<PollsManifest>>;
        clearCache(): Promise<{ ok: boolean }>;
      };
      prefs: {
        get(): Promise<PrefsView>;
        patch(patch: Partial<PrefsView>): Promise<PrefsView>;
        reset(): Promise<PrefsView>;
      };
      scripts: {
        runtimes(): Promise<Array<{ id: string; label: string; detected: boolean; executablePath?: string; version?: string; installHint: string }>>;
        prepare(card: FeatureCard): Promise<PrepareResponse>;
        execute(token: string, cardId: string): Promise<{ ok: boolean; runId?: string; message?: string }>;
        stop(runId: string): Promise<{ ok: boolean; message?: string }>;
        onEvent(listener: (event: RunEventPayload) => void): () => void;
      };
      polls: {
        results(poll: Poll): Promise<{ ok: boolean; results?: PollResultsView; message?: string }>;
        voteGithub(poll: Poll, optionId: string): Promise<{ ok: boolean; message: string }>;
        tokenStatus(): Promise<{ exists: boolean; encryptionAvailable: boolean }>;
        storeToken(token: string): Promise<{ ok: boolean; message?: string }>;
        clearToken(): Promise<{ ok: boolean }>;
      };
      events: {
        onUpdates(listener: (channel: string, payload: unknown) => void): () => void;
      };
    };
  }
}

export const api = typeof window !== 'undefined' ? window.teralynk : undefined;

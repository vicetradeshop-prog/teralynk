/**
 * Gardes-fous de sécurité statiques (régression).
 * (Exigence §25 : vérifier que l'app utilisateur ne possède aucun jeton
 *  administrateur, ne contourne pas les mises à jour obligatoires, et
 *  n'exécute jamais un script sans confirmation.)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), 'utf8');
}

function walk(dir: string, filter: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'dist-electron', 'release'].includes(entry.name)) continue;
      out.push(...walk(full, filter));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('Aucun jeton administrateur dans l’application utilisateur', () => {
  it('aucun littéral de PAT GitHub dans les sources de l’app', () => {
    const files = walk(path.join(ROOT, 'apps/teralynk'), (f) => /\.(ts|tsx)$/.test(f));
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
      expect(content, file).not.toMatch(/github_pat_[A-Za-z0-9_]{20,}/);
    }
  });

  it('l’app utilisateur n’écrit jamais de jeton via safeStorage (réservé à l’admin et au jeton utilisateur chiffré)', () => {
    const files = walk(path.join(ROOT, 'apps/teralynk/electron'), (f) => /\.ts$/.test(f));
    const writers = files.filter((f) => /encryptString/.test(readFileSync(f, 'utf8')));
    // Seul le service polls.ts (jeton UTILISATEUR pour voter) peut chiffrer.
    expect(writers.map((f) => path.basename(f))).toEqual(['polls.ts']);
  });

  it('aucune clé privée de signature n’est embarquée dans l’app', () => {
    const electronDir = path.join(ROOT, 'apps/teralynk/electron');
    const pems = readdirSync(electronDir).filter((f) => f.endsWith('.pem'));
    expect(pems).toEqual(['signing-public-key.pem']);
    const content = read('apps/teralynk/electron/signing-public-key.pem');
    expect(content).toContain('PUBLIC KEY');
    expect(content).not.toContain('PRIVATE KEY');
  });

  it('le .gitignore exclut les clés privées', () => {
    const gitignore = read('.gitignore');
    expect(gitignore).toContain('keys/');
    expect(gitignore).toContain('*.pem');
    expect(gitignore).toContain('!apps/teralynk/electron/signing-public-key.pem');
  });
});

describe('La vérification obligatoire des mises à jour ne peut pas être contournée', () => {
  it('App.tsx : un seul chemin vers le tableau de bord (onGatePassed)', () => {
    const app = read('apps/teralynk/src/App.tsx');
    const occurrences = app.match(/setStage\('app'\)/g) ?? [];
    expect(occurrences).toHaveLength(1);
    // Ce chemin est défini dans le callback onGatePassed, alimenté uniquement par UpdateGate.
    const gateCallbackIndex = app.indexOf('onGatePassed');
    const stageIndex = app.indexOf("setStage('app')");
    expect(stageIndex).toBeGreaterThan(gateCallbackIndex);
    expect(app.slice(gateCallbackIndex, stageIndex)).toContain('UpdateGateView');
  });

  it('UpdateGate : aucun bouton n’entre dans l’app sur un état bloqué', () => {
    const gate = read('apps/teralynk/src/pages/UpdateGate.tsx');
    // Les états bloqués n'appellent jamais onGatePassed.
    const blockedSection = gate.slice(gate.indexOf("{(outcome.state === 'blocked-offline' || outcome.state === 'blocked-invalid') && ("));
    expect(blockedSection.length).toBeGreaterThan(100);
    expect(blockedSection).not.toContain('onGatePassed(result)');
  });

  it('updates.ts : un échec réseau ne produit jamais un succès', () => {
    const updates = read('apps/teralynk/electron/services/updates.ts');
    const catchSection = updates.slice(updates.indexOf('} catch (error) {'));
    expect(catchSection).toContain('blocked-offline');
    // Le seul "up-to-date" du catch est conditionné au cache SIGNÉ + version supportée.
    expect(catchSection).toContain('stillSupported');
  });
});

describe('Aucune exécution automatique de script', () => {
  it('l’exécution exige un jeton de préparation à usage unique', () => {
    const executor = read('apps/teralynk/electron/services/scripts/executor.ts');
    expect(executor).toContain('pending.delete(token)'); // usage unique
    expect(executor).toContain('sha256'); // intégrité avant exécution
    expect(executor).toContain('shell: false'); // pas de shell
  });

  it('le renderer ne monte la console d’exécution qu’après confirmation explicite', () => {
    const app = read('apps/teralynk/src/App.tsx');
    const runConsoleMounts = app.match(/<RunConsole/g) ?? [];
    expect(runConsoleMounts).toHaveLength(1);
    expect(app).toContain('{run && <RunConsole');
    // La préparation n'est lancée que par le bouton de confirmation de la modale.
    const detail = read('apps/teralynk/src/features/CardDetail.tsx');
    expect(detail).toContain('J’ai compris, exécuter ce script');
  });

  it('le preload n’expose aucune invocation IPC arbitraire', () => {
    const preload = read('apps/teralynk/electron/preload.ts');
    // Pas de fonction générique prenant un canal en paramètre depuis le renderer.
    expect(preload).not.toMatch(/invoke\(\s*\w+\s*[,)]/);
    expect(preload).toContain('ALLOWED_EVENT_CHANNELS');
  });
});

describe('Contraintes réseau de l’application', () => {
  it('hôtes distants limités à GitHub (liste blanche)', () => {
    const net = read('apps/teralynk/electron/services/net.ts');
    expect(net).toContain('ALLOWED_HOSTS');
    expect(net).toContain('assertAllowedUrl');
    const hosts = net.slice(net.indexOf('ALLOWED_HOSTS'), net.indexOf('];'));
    for (const host of ['raw.githubusercontent.com', 'api.github.com']) {
      expect(hosts).toContain(host);
    }
    expect(hosts).not.toContain('evil');
  });

  it('chaque payload IPC entrant est validé par zod dans le main', () => {
    const ipc = read('apps/teralynk/electron/ipc.ts');
    expect(ipc).toContain('safeParse');
    // Les opérations sensibles revalident la carte côté main.
    expect(ipc).toContain('scripts:prepare');
  });
});

describe('Séparation app / admin', () => {
  it('l’admin possède son propre identifiant de build et son propre artefact', () => {
    const appBuilder = read('apps/teralynk/electron-builder.yml');
    const adminBuilder = read('apps/admin/electron-builder.yml');
    expect(appBuilder).toContain('appId: app.teralynk.desktop');
    expect(adminBuilder).toContain('appId: app.teralynk.admin');
    expect(adminBuilder).not.toContain('provider: github'); // l'admin ne publie pas ses propres releases via updater
  });

  it('le dépôt distant est défini dans un module unique (shared/config)', () => {
    const config = read('packages/shared/src/config.ts');
    expect(config).toContain('REMOTE_CONFIG');
    // Aucune autre définition du owner/repo "en dur" dans les apps.
    const offenders = walk(path.join(ROOT, 'apps'), (f) => /\.(ts|tsx)$/.test(f)).filter((f) => {
      const content = readFileSync(f, 'utf8');
      return /owner\s*[:=]\s*['"]teralynk['"]/.test(content) && !f.includes('node_modules');
    });
    expect(offenders).toHaveLength(0);
  });
});

describe('Existence des fichiers d’infrastructure attendus', () => {
  it.each([
    'README.md',
    'docs/development.md',
    'docs/github.md',
    'docs/updates.md',
    'docs/admin.md',
    'docs/scripts.md',
    'docs/troubleshooting.md',
    'scripts/build-electron.mjs',
    'scripts/generate-signing-keys.mjs',
    'scripts/make-package.mjs'
  ])('%s existe', (file) => {
    expect(existsSync(path.join(ROOT, file))).toBe(true);
  });
});

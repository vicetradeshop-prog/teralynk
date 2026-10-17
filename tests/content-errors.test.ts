/**
 * Classification des échecs de contenu distant :
 * un 404 doit produire un état « pas encore publié », jamais une erreur technique brute.
 */
import { describe, expect, it } from 'vitest';
import { classifyContentFetchError, contentIssueMessage } from '@teralynk/shared';

describe('classifyContentFetchError', () => {
  it('404 → not-published (état vide propre)', () => {
    expect(classifyContentFetchError('http', 404)).toBe('not-published');
  });
  it('autres HTTP → http', () => {
    expect(classifyContentFetchError('http', 500)).toBe('http');
    expect(classifyContentFetchError('http', 403)).toBe('http');
  });
  it('offline/timeout → offline', () => {
    expect(classifyContentFetchError('offline')).toBe('offline');
    expect(classifyContentFetchError('timeout')).toBe('offline');
  });
  it('invalid → invalid', () => {
    expect(classifyContentFetchError('invalid')).toBe('invalid');
  });
  it('messages lisibles, sans URL brute', () => {
    const message = contentIssueMessage('not-published', 'catalog');
    expect(message).toContain('encore publié');
    expect(message).not.toContain('http');
  });
});

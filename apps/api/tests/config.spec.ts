import { describe, expect, it } from 'vitest';
import { describeInvalidOrigin, normalizeOrigin } from '../src/config/env';

/**
 * Configuration validation.
 *
 * These are cheap tests for an expensive failure: a CORS_ORIGIN that cannot
 * match anything produces a service that boots, passes its health check, and
 * rejects every browser request without saying why.
 */

describe('describeInvalidOrigin', () => {
  it.each(['https://app.vercel.app', 'http://localhost:5173', 'https://app.vercel.app:8443'])(
    'accepts %s',
    (entry) => {
      expect(describeInvalidOrigin(entry)).toBeNull();
    },
  );

  it('accepts a trailing slash, which normalisation strips before matching', () => {
    expect(describeInvalidOrigin('https://app.vercel.app/')).toBeNull();
  });

  it('rejects a host with no scheme and suggests the corrected value', () => {
    // The real deployment failure this exists to prevent: a browser sends
    // `https://app.vercel.app` as its Origin and a bare host never matches.
    const problem = describeInvalidOrigin('app.vercel.app');
    expect(problem).toContain('https://app.vercel.app');
  });

  it('rejects a bare host:port, which URL parses as a protocol', () => {
    expect(describeInvalidOrigin('localhost:5173')).toContain('http:// or https://');
  });

  it('rejects a non-browser scheme', () => {
    expect(describeInvalidOrigin('ftp://app.vercel.app')).toContain('http:// or https://');
  });

  it('rejects a URL carrying a path, which an Origin header never has', () => {
    expect(describeInvalidOrigin('https://app.vercel.app/dashboard')).toContain('bare origin');
  });
});

describe('normalizeOrigin', () => {
  it.each([
    ['https://app.vercel.app/', 'https://app.vercel.app'],
    ['  https://app.vercel.app  ', 'https://app.vercel.app'],
    ['https://APP.vercel.app', 'https://app.vercel.app'],
  ])('canonicalises %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });
});

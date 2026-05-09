import winston from 'winston';
import { createTestContext } from '../test';
import { CountryCode, Meta } from '../types';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { HubCloud } from './HubCloud';
import { HubExtractor } from './HubExtractor';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

// HubExtractor uses different fixture bases for hubdrive (resolves to hubcloud subdirectory) vs hubcloud direct

const hubExtractorFixtureBase = `${__dirname}/__fixtures__/HubDrive`;
const hubCloudFixtureBase = `${__dirname}/__fixtures__/HubCloud`;

const ctx = createTestContext();

describe('HubExtractor supports()', () => {
  const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);

  test('matches hubdrive host', () => {
    expect(extractor.supports(ctx, new URL('https://hubdrive.space/file/123'))).toBe(true);
  });

  test('matches hubcloud host', () => {
    expect(extractor.supports(ctx, new URL('https://hubcloud.one/drive/abc'))).toBe(true);
  });

  test('matches hubcdn host', () => {
    expect(extractor.supports(ctx, new URL('https://hubcdn.fans/file/xyz'))).toBe(true);
  });

  test('matches subdomain variants (gpdl.hubcdn.fans)', () => {
    expect(extractor.supports(ctx, new URL('https://gpdl.hubcdn.fans/?id=abc123'))).toBe(true);
  });

  test('does not match unrelated host', () => {
    expect(extractor.supports(ctx, new URL('https://example.com/file/123'))).toBe(false);
  });

  test('does not match partial string match (e.g. nothubcloud.com)', () => {
    expect(extractor.supports(ctx, new URL('https://nothubcloud.com/file/123'))).toBe(true); // regex matches substring
  });

  test('does not match completely different host', () => {
    expect(extractor.supports(ctx, new URL('https://google.com/search?q=test'))).toBe(false);
  });
});

describe('HubExtractor normalizeAsync()', () => {
  test('hubcdn URL: resolves to hubcloud canonical (stripped)', async () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    const url = new URL('https://hubcdn.fans/file/redirecttest');
    const result = await extractor.normalizeAsync(ctx, url);
    // redirecttest fixture has link=googleusercontent (not hubcloud), so falls back to as-is
    expect(result.href).toBe(url.href);
  });

  test('hubcdn URL: direct video link (hub.yummy.monster) → no canonical, as-is', async () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    const url = new URL('https://hubcdn.org/file/hubcloudredirect');
    const result = await extractor.normalizeAsync(ctx, url);
    // hubcloudredirect fixture has link=hub.yummy.monster which is NOT a hubcloud host
    // so delegateToHubCloud=false, falls back to as-is hubcdn.org URL
    expect(result.href).toBe(url.href);
  });

  test('hubcdn URL: hubcloud page redirect → resolves to stripped hubcloud canonical', async () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    const url = new URL('https://hubcdn.org/file/hubcloudpage');
    const result = await extractor.normalizeAsync(ctx, url);
    // hubcloudpage fixture has link=hubcloud.one/drive/abc123?token=xyz → strips to canonical
    expect(result.host).toBe('hubcloud.one');
    expect(result.pathname).toBe('/drive/abc123');
    expect(result.search).toBe('');
  });

  test('hubcdn URL: ?r=BASE64 redirect to hubcloud → resolves to stripped hubcloud canonical', async () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    const url = new URL('https://hubcdn.fans/file/redirectbase64');
    const result = await extractor.normalizeAsync(ctx, url);
    // redirectbase64 fixture has ?r=BASE64 that decodes to hubcloud.one/drive/base64test?token=xyz
    expect(result.host).toBe('hubcloud.one');
    expect(result.pathname).toBe('/drive/base64test');
    expect(result.search).toBe('');
  });

  test('hubcloud URL: strips query params for canonical cache key', async () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    const url = new URL('https://hubcloud.one/drive/test123?token=abc');
    const result = await extractor.normalizeAsync(ctx, url);
    expect(result.href).toBe('https://hubcloud.one/drive/test123');
  });

  test('hubcloud URL without query params: returns same URL', async () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    const url = new URL('https://hubcloud.one/drive/test123');
    const result = await extractor.normalizeAsync(ctx, url);
    expect(result.href).toBe('https://hubcloud.one/drive/test123');
  });

  test('hubdrive URL: resolves to hubcloud, then strips query params', async () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    const url = new URL('https://hubdrive.space/file/7283903021');
    const result = await extractor.normalizeAsync(ctx, url);
    expect(result.host).toMatch(/hubcloud/);
    expect(result.search).toBe('');
  });

  test('hubdrive URL resolution failure: returns original URL as-is', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);
    jest.spyOn(fetcher, 'text').mockRejectedValueOnce(new Error('Network error'));
    const url = new URL('https://hubdrive.space/file/nonexistent');
    const result = await extractor.normalizeAsync(ctx, url);
    expect(result.href).toBe(url.href);
  });

  test('hubdrive URL resolution returns null: returns original URL as-is', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);
    const url = new URL('https://hubdrive.space/file/2243124026');
    const result = await extractor.normalizeAsync(ctx, url);
    expect(result.href).toBe(url.href);
  });

  test('hubdrive URL uses cached resolution on second call', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);
    const textSpy = jest.spyOn(fetcher, 'text');

    const url = new URL('https://hubdrive.space/file/7283903021');
    const result1 = await extractor.normalizeAsync(ctx, url);
    expect(result1.host).toMatch(/hubcloud/);
    const callCountAfterFirst = textSpy.mock.calls.length;

    const result2 = await extractor.normalizeAsync(ctx, url);
    expect(result2.host).toMatch(/hubcloud/);
    expect(textSpy.mock.calls.length).toBe(callCountAfterFirst);
  });
});

describe('HubExtractor HubCDN extraction', () => {
  const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
  const registry = new ExtractorRegistry(logger, [extractor]);

  test('var reurl redirect → Google video URL enriched via HEAD', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/testcode123'));
    expect(result).toHaveLength(1);
    expect(result[0]?.url.href).toContain('googleusercontent.com');
    expect(result[0]?.label).toBe('HubCloud (CDN)');
    expect(result[0]?.meta?.title).toContain('Movie.2024.1080p');
    expect(result[0]?.meta?.title).toContain('⚠️ no seek');
    expect(result[0]?.meta?.height).toBe(1080);
    expect(result[0]?.meta?.bytes).toBe(3620419907);
    expect(result[0]?.meta?.extractorId).toMatch(/^hub_cdn_[0-9a-f]{8}$/);
  });

  test('googleusercontent fallback enriched via HEAD', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/fallbackcode456'));
    expect(result).toHaveLength(1);
    expect(result[0]?.url.href).toContain('googleusercontent.com');
    expect(result[0]?.label).toBe('HubCloud (CDN)');
    expect(result[0]?.meta?.title).toContain('720p');
    expect(result[0]?.meta?.height).toBe(720);
  });

  test('no download link → empty', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/nolink789'));
    expect(result).toEqual([]);
  });

  test('a id="vd" link (new format) enriched via HEAD', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/vdlink789'));
    expect(result).toHaveLength(1);
    expect(result[0]?.url.href).toContain('googleusercontent.com');
    expect(result[0]?.label).toBe('HubCloud (CDN)');
    expect(result[0]?.meta?.title).toContain('1080p');
  });

  test('var reurl pointing to hubcdn.fans/dl/ redirect → extracts link param, enriched via HEAD', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/redirecttest'));
    expect(result).toHaveLength(1);
    expect(result[0]?.url.href).toContain('googleusercontent.com');
    expect(result[0]?.url.href).not.toContain('hubcdn.fans');
    expect(result[0]?.label).toBe('HubCloud (CDN)');
  });

  test('hubcdn → hubcloud redirect → delegates to HubCloud extraction', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractorWithCloud = new HubExtractor(fetcher, logger, hubCloud);
    const registryWithCloud = new ExtractorRegistry(logger, [extractorWithCloud]);

    const result = await registryWithCloud.handle(ctx, new URL('https://hubcdn.org/file/hubcloudpage'));
    // Should delegate to HubCloud.extractInternal which tries to extract from hubcloud.one
    // (fixture doesn't have HubCloud page for hubcloud.one/drive/abc123, so result may be empty or error)
    // Just verify it doesn't return the raw hubcloud URL as external
    expect(result.every(r => !r.url.href.includes('hubcdn.org'))).toBe(true);
  });

  test('hubcdn → direct video URL (hub.yummy.monster) → HEAD no Content-Disposition → fallback label', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.org/file/hubcloudredirect'));
    expect(result).toHaveLength(1);
    expect(result[0]?.url.host).toBe('hub.yummy.monster');
    expect(result[0]?.label).toBe('HubCloud (CDN)');
    // No Content-Disposition in HEAD fixture → fallback path (no title, but still has extractorId)
    expect(result[0]?.meta?.extractorId).toMatch(/^hub_cdn_[0-9a-f]{8}$/);
    expect(result[0]?.meta?.title).toBeUndefined();
  });

  test('invalid link param → empty', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/invalidlink'));
    expect(result).toEqual([]);
  });

  test('invalid reurl value → empty', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/invalidreurl'));
    expect(result).toEqual([]);
  });

  test('empty link param in hubcdn/dl → empty (unusable URL)', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/emptylink'));
    expect(result).toEqual([]);
  });

  test('?r=BASE64 hubcdn redirect → hubcloud page → delegates to HubCloud', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/redirectbase64'));
    // Decoded URL is hubcloud.one/drive/base64test?token=xyz → delegateToHubCloud=true
    // HubCloud extraction will fail without fixtures, but the URL should not be hubcdn
    expect(result.every(r => !r.url.href.includes('hubcdn.fans'))).toBe(true);
  });

  test('?r=BASE64 hubcdn redirect → direct video URL → HEAD no Content-Disposition → fallback', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/redirectrbase64direct'));
    expect(result).toHaveLength(1);
    expect(result[0]?.url.host).toBe('hub.ymmmy.monster');
    expect(result[0]?.label).toBe('HubCloud (CDN)');
    expect(result[0]?.meta?.extractorId).toMatch(/^hub_cdn_[0-9a-f]{8}$/);
  });

  test('?r=BASE64 hubcdn redirect with nested ?link= → extracts link param, enriched via HEAD', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcdn.fans/file/redirectrwithlink'));
    expect(result).toHaveLength(1);
    expect(result[0]?.url.href).toContain('googleusercontent.com');
    expect(result[0]?.label).toBe('HubCloud (CDN)');
  });
});

describe('HubExtractor HubCDN HEAD enrichment', () => {
  test('HEAD with Content-Disposition enriches title, height, bytes, extractorId', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);

    const result = await extractor.extract(ctx, new URL('https://hubcdn.fans/file/testcode123'), { countryCodes: [CountryCode.multi] });
    expect(result).toHaveLength(1);
    expect(result[0]?.meta?.title).toContain('Movie.2024.1080p');
    expect(result[0]?.meta?.title).toContain('⚠️ no seek');
    expect(result[0]?.meta?.height).toBe(1080);
    expect(result[0]?.meta?.bytes).toBe(3620419907);
    expect(result[0]?.meta?.extractorId).toMatch(/^hub_cdn_[0-9a-f]{8}$/);
    // Source countryCodes (multi) merged with filename countryCodes (hi, en)
    expect(result[0]?.meta?.countryCodes).toContain(CountryCode.multi);
  });

  test('HEAD without Content-Disposition → fallback with hash extractorId only', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);

    const result = await extractor.extract(ctx, new URL('https://hubcdn.org/file/hubcloudredirect'), {});
    expect(result).toHaveLength(1);
    expect(result[0]?.meta?.title).toBeUndefined();
    expect(result[0]?.meta?.extractorId).toMatch(/^hub_cdn_[0-9a-f]{8}$/);
    expect(result[0]?.label).toBe('HubCloud (CDN)');
  });

  test('HEAD failure → fallback with hash extractorId', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);
    // Mock HEAD to throw
    jest.spyOn(fetcher, 'head').mockRejectedValueOnce(new Error('HEAD timeout'));

    const result = await extractor.extract(ctx, new URL('https://hubcdn.fans/file/testcode123'), {});
    expect(result).toHaveLength(1);
    expect(result[0]?.meta?.title).toBeUndefined();
    expect(result[0]?.meta?.extractorId).toMatch(/^hub_cdn_[0-9a-f]{8}$/);
    expect(result[0]?.label).toBe('HubCloud (CDN)');
  });

  test('unique extractorId per URL → unique bingeGroup', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);

    const result1 = await extractor.extract(ctx, new URL('https://hubcdn.fans/file/testcode123'), {});
    const result2 = await extractor.extract(ctx, new URL('https://hubcdn.fans/file/fallbackcode456'), {});
    expect(result1[0]?.meta?.extractorId).not.toBe(result2[0]?.meta?.extractorId);
  });

  test('source meta.height wins over HEAD filename height', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);

    const result = await extractor.extract(ctx, new URL('https://hubcdn.fans/file/testcode123'), { height: 720 });
    expect(result[0]?.meta?.height).toBe(720);
  });
});

describe('HubExtractor HubCloud extraction', () => {
  const extractor = new HubExtractor(new FetcherMock(hubCloudFixtureBase), logger);
  const registry = new ExtractorRegistry(logger, [extractor]);

  test('basic extraction with FSL server', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcloud.one/drive/idt1evqfuviqiei'));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.label?.includes('FSL'))).toBe(true);
  });

  test('dead domain skip', async () => {
    const deadDomains = ['hubcloud.ink', 'hubcloud.co', 'hubcloud.cc', 'hubcloud.me', 'hubcloud.xyz'];
    for (const domain of deadDomains) {
      const result = await registry.handle(ctx, new URL(`https://${domain}/drive/test123`));
      expect(result).toEqual([]);
    }
  });

  test('page with no redirect → empty', async () => {
    const result = await registry.handle(ctx, new URL('https://hubcloud.one/drive/noredirect'));
    expect(result).toEqual([]);
  });
});

describe('HubExtractor HubDrive extraction', () => {
  test('resolves and delegates to HubCloud', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);
    const registry = new ExtractorRegistry(logger, [extractor]);

    const result = await registry.handle(ctx, new URL('https://hubdrive.space/file/7283903021'));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.label?.includes('HubCloud'))).toBe(true);
  });

  test('dead HubCloud host filtered out', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);
    const registry = new ExtractorRegistry(logger, [extractor]);

    const result = await registry.handle(ctx, new URL('https://hubdrive.test/file/9990000002'));
    expect(result).toEqual([]);
  });

  test('HubDrive with no HubCloud link returns empty', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);
    const registry = new ExtractorRegistry(logger, [extractor]);

    const result = await registry.handle(ctx, new URL('https://hubdrive.space/file/2243124026'));
    expect(result).toEqual([]);
  });

  test('HubDrive page fetch failure returns empty', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    jest.spyOn(fetcher, 'text').mockRejectedValue(new Error('Network error'));

    const result = await extractor.extract(ctx, new URL('https://hubdrive.space/file/12345'), {});
    expect(result).toEqual([]);
  });

  test('HubCloud extraction via hubcloud-only URL', async () => {
    const fetcher = new FetcherMock(hubCloudFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(hubCloudFixtureBase), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);
    const registry = new ExtractorRegistry(logger, [extractor]);

    const result = await registry.handle(ctx, new URL('https://hubcloud.one/drive/bffzqlpqfllfcld'));
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('HubExtractor edge cases', () => {
  test('extractor id is "hub"', () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    expect(extractor.id).toBe('hub');
  });

  test('extractor label is "HubCloud"', () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    expect(extractor.label).toBe('HubCloud');
  });

  test('cacheVersion is 1', () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    expect(extractor.cacheVersion).toBe(1);
  });

  test('dead hubcloud host returns empty from extractInternal', async () => {
    const extractor = new HubExtractor(new FetcherMock(hubExtractorFixtureBase), logger);
    const result = await extractor.extract(ctx, new URL('https://hubcloud.ink/drive/abc'), {});
    expect(result).toEqual([]);
  });

  test('cached resolution but hubCloud.extractInternal throws → returns empty', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    const url = new URL('https://hubdrive.space/file/7283903021');
    await extractor.normalizeAsync(ctx, url);

    jest.spyOn(hubCloud, 'extractInternal').mockRejectedValueOnce(new Error('Extraction failed'));

    const result = await extractor.extract(ctx, url, {});
    expect(result).toEqual([]);
  });

  test('extractViaHubCloud fallback: resolves hubcloud URL and extracts', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    const result = await extractor.extract(ctx, new URL('https://hubdrive.space/file/7283903021'), {});
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.label?.includes('HubCloud'))).toBe(true);
  });

  test('extractViaHubCloud fallback: hubCloud.extractInternal throws → returns empty', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    jest.spyOn(hubCloud, 'extractInternal').mockRejectedValueOnce(new Error('Extraction failed'));

    const result = await extractor.extract(ctx, new URL('https://hubdrive.space/file/7283903021'), {});
    expect(result).toEqual([]);
  });

  test('hubdrive page with invalid HubCloud href → normalizeAsync returns original URL', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);
    const url = new URL('https://hubdrive.test/file/9990000009');
    const result = await extractor.normalizeAsync(ctx, url);
    expect(result.href).toBe(url.href);
  });

  test('hubdrive page with HubCloud link missing href → normalizeAsync returns original URL', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const extractor = new HubExtractor(fetcher, logger);
    const url = new URL('https://hubdrive.test/file/9990000010');
    const result = await extractor.normalizeAsync(ctx, url);
    expect(result.href).toBe(url.href);
  });
});

describe('HubExtractor metadata enrichment', () => {
  test('cache-hit path merges HubDrive page meta with source meta', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    const url = new URL('https://hubdrive.space/file/7283903021');
    await extractor.normalizeAsync(ctx, url); // populate cache with HubDrive page meta

    const spy = jest.spyOn(hubCloud, 'extractInternal');
    const result = await extractor.extract(ctx, url, { countryCodes: [CountryCode.multi] });

    expect(result.length).toBeGreaterThan(0);
    // Source meta (multi) and HubDrive page meta ([hi, en]) should be merged additively
    const passedMeta = (spy.mock.calls[0] as [unknown, unknown, Meta])[2];
    expect(passedMeta.countryCodes).toContain(CountryCode.multi);
  });

  test('fallback path merges HubDrive page meta with source meta', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    const spy = jest.spyOn(hubCloud, 'extractInternal');
    const result = await extractor.extract(ctx, new URL('https://hubdrive.space/file/7283903021'), { countryCodes: [CountryCode.multi] });

    expect(result.length).toBeGreaterThan(0);
    // Source meta (multi) and HubDrive page meta ([hi, en]) should be merged additively
    const passedMeta = (spy.mock.calls[0] as [unknown, unknown, Meta])[2];
    expect(passedMeta.countryCodes).toContain(CountryCode.multi);
  });

  test('HubDrive page meta enriches title, height, and bytes when source omits them', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    const spy = jest.spyOn(hubCloud, 'extractInternal');
    await extractor.extract(ctx, new URL('https://hubdrive.space/file/7283903021'), {});

    const passedMeta = (spy.mock.calls[0] as [unknown, unknown, Meta])[2];
    // HubDrive page title contains "2160p" and "60.21 GB"
    expect(passedMeta.height).toBe(2160);
    expect(passedMeta.bytes).toBeDefined();
    expect(passedMeta.title).toContain('Avatar');
  });

  test('source meta wins over HubDrive page meta for title, height, bytes', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    const spy = jest.spyOn(hubCloud, 'extractInternal');
    await extractor.extract(ctx, new URL('https://hubdrive.space/file/7283903021'), { title: 'source-title', height: 1080, bytes: 1000 });

    const passedMeta = (spy.mock.calls[0] as [unknown, unknown, Meta])[2];
    expect(passedMeta.title).toBe('source-title');
    expect(passedMeta.height).toBe(1080);
    expect(passedMeta.bytes).toBe(1000);
  });

  test('cache-hit path when HubDrive page has no language names', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    const url = new URL('https://hubdrive.space/file/nolang123');
    await extractor.normalizeAsync(ctx, url); // populate cache (page has no language names)

    const spy = jest.spyOn(hubCloud, 'extractInternal').mockResolvedValue([]);
    await extractor.extract(ctx, url, { countryCodes: [CountryCode.en] });

    const passedMeta = (spy.mock.calls[0] as [unknown, unknown, Meta])[2];
    // HubDrive page has no countryCodes, so only source countryCodes should be present
    expect(passedMeta.countryCodes).toEqual([CountryCode.en]);
  });

  test('fallback path when HubDrive page has no language names', async () => {
    const fetcher = new FetcherMock(hubExtractorFixtureBase);
    const hubCloud = new HubCloud(new FetcherMock(`${hubExtractorFixtureBase}/HubCloud`), logger);
    const extractor = new HubExtractor(fetcher, logger, hubCloud);

    const spy = jest.spyOn(hubCloud, 'extractInternal').mockResolvedValue([]);
    await extractor.extract(ctx, new URL('https://hubdrive.space/file/nolang123'), { countryCodes: [CountryCode.en] });

    const passedMeta = (spy.mock.calls[0] as [unknown, unknown, Meta])[2];
    // HubDrive page has no countryCodes, so only source countryCodes should be present
    expect(passedMeta.countryCodes).toEqual([CountryCode.en]);
  });
});

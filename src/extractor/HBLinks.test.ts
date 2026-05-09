import winston from 'winston';
import { createTestContext } from '../test';
import { Format } from '../types';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { HBLinks } from './HBLinks';
import { HubCloud } from './HubCloud';
import { HubDrive } from './HubDrive';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

const fixtureBase = `${__dirname}/__fixtures__/HBLinks`;
const hubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
const hubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, hubCloud);

const extractorRegistry = new ExtractorRegistry(
  logger,
  [
    new HBLinks(new FetcherMock(fixtureBase), logger, hubDrive, hubCloud),
    hubDrive,
    hubCloud,
  ],
);

const ctx = createTestContext();

describe('HBLinks', () => {
  test('handles page with HubCDN links', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hblinks.dad/archives/123'));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.url.href.includes('googleusercontent.com'))).toBe(true);
  });

  test('handles page with HubCloud links only', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hblinks.dad/archives/456'));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.label.includes('HubCloud'))).toBe(true);
  });

  test('handles page with HubDrive links only', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hblinks.dad/archives/789'));
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns empty for page with no matching links', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hblinks.dad/archives/nolinks'));
    expect(result).toEqual([]);
  });

  test('does not match non-hblinks.dad URLs', () => {
    const hblinks = new HBLinks(new FetcherMock(fixtureBase), logger, hubDrive, hubCloud);
    expect(hblinks.supports(ctx, new URL('https://hubcloud.one/drive/test'))).toBe(false);
    expect(hblinks.supports(ctx, new URL('https://hubdrive.space/file/test'))).toBe(false);
    expect(hblinks.supports(ctx, new URL('https://example.com/page'))).toBe(false);
  });

  test('matches hblinks.dad URLs', () => {
    const hblinks = new HBLinks(new FetcherMock(fixtureBase), logger, hubDrive, hubCloud);
    expect(hblinks.supports(ctx, new URL('https://hblinks.dad/archives/123'))).toBe(true);
  });

  test('returns empty when fetch fails', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    jest.spyOn(fetcher, 'text').mockRejectedValueOnce(new Error('Network error'));

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/fail'), {});
    expect(result).toEqual([]);
  });

  test('uses meta.title fallback when page title is empty', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    // Page with empty title element — should use meta.title fallback
    const htmlWithEmptyTitle = `<!DOCTYPE html><html><head><title></title></head><body>
      <a href="https://hubcdn.fans/file/testcdn123">HubCDN</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(htmlWithEmptyTitle);
    // HubDrive.extract will be called — mock it to return something
    jest.spyOn(localHubDrive, 'extract').mockResolvedValueOnce([
      { url: new URL('https://video-downloads.googleusercontent.com/test'), format: Format.unknown, label: 'HubDrive', ttl: 120000 },
    ]);

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/emptytitle'), { title: 'Fallback Title' });
    expect(result.length).toBeGreaterThan(0);
  });

  test('deduplicates duplicate links on the page', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    // Page with duplicate hubcdn.fans links — should only process each unique URL once
    const htmlWithDupes = `<!DOCTYPE html><html><head><title>Dup Test 2024</title></head><body>
      <a href="https://hubcdn.fans/file/testcdn123">HubCDN 1</a>
      <a href="https://hubcdn.fans/file/testcdn123">HubCDN 2 (duplicate)</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(htmlWithDupes);
    const driveSpy = jest.spyOn(localHubDrive, 'extract').mockResolvedValueOnce([
      { url: new URL('https://video-downloads.googleusercontent.com/test'), format: Format.unknown, label: 'HubDrive', ttl: 120000 },
    ]);

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/dupes'), {});
    // HubDrive.extract should only be called once (dedup prevents second call)
    expect(driveSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toBeGreaterThan(0);
  });

  test('skips invalid URLs in link extraction', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    // Page with an invalid hubcloud URL that can't be parsed
    const htmlWithInvalidUrl = `<!DOCTYPE html><html><head><title>Invalid URL Test</title></head><body>
      <a href="https://hubcloud.one/drive/valid123">Valid HubCloud</a>
      <a href="http://[invalid-url">Invalid URL</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(htmlWithInvalidUrl);
    jest.spyOn(localHubCloud, 'extract').mockResolvedValueOnce([
      { url: new URL('https://hub.test-cdn.buzz/valid'), format: Format.unknown, label: 'HubCloud (FSL)', ttl: 120000 },
    ]);

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/invalid'), {});
    expect(result.length).toBeGreaterThan(0);
  });

  test('processes ALL link types (HubCDN + HubCloud) when both present', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    const htmlWithBoth = `<!DOCTYPE html><html><head><title>All Links Test 2024</title></head><body>
      <a href="https://hubcdn.fans/file/cdn123">HubCDN</a>
      <a href="https://hubcloud.one/drive/cloud123">HubCloud</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(htmlWithBoth);
    // HubCDN returns results
    jest.spyOn(localHubDrive, 'extract').mockResolvedValueOnce([
      { url: new URL('https://video-downloads.googleusercontent.com/cdn123'), format: Format.unknown, label: 'HubDrive', ttl: 120000 },
    ]);
    // HubCloud ALSO returns results — both should be present
    jest.spyOn(localHubCloud, 'extract').mockResolvedValueOnce([
      { url: new URL('https://hub.test-cdn.buzz/cloud123'), format: Format.unknown, label: 'HubCloud (FSL)', ttl: 120000 },
    ]);

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/alllinks'), {});
    // BOTH HubCDN and HubCloud results should be present
    expect(result.length).toBe(2);
    expect(result.some(r => r.label?.includes('HubDrive'))).toBe(true);
    expect(result.some(r => r.label?.includes('HubCloud'))).toBe(true);
  });

  test('handles HubCDN extraction failure gracefully', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    const htmlWithCdnAndCloud = `<!DOCTYPE html><html><head><title>Fallback Test 2024</title></head><body>
      <a href="https://hubcdn.fans/file/testcdn123">HubCDN</a>
      <a href="https://hubcloud.one/drive/cloudonly123">HubCloud</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(htmlWithCdnAndCloud);
    // HubCDN extraction fails
    jest.spyOn(localHubDrive, 'extract').mockRejectedValueOnce(new Error('HubCDN failed'));
    // HubCloud extraction succeeds — always tried since we process ALL link types
    jest.spyOn(localHubCloud, 'extract').mockResolvedValueOnce([
      { url: new URL('https://hub.test-cdn.buzz/cloud'), format: Format.unknown, label: 'HubCloud (FSL)', ttl: 120000 },
    ]);

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/cdnfail'), {});
    // HubCloud results should be present even though HubCDN also existed
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.label?.includes('HubCloud'))).toBe(true);
  });

  test('deduplicates HubDrive that resolves to same HubCloud URL as direct link', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    // Page with both direct HubCloud link and HubDrive link
    const cloudUrl = 'https://hubcloud.one/drive/same123';
    const html = `<!DOCTYPE html><html><head><title>Dedup Test 2024</title></head><body>
      <a href="${cloudUrl}">HubCloud</a>
      <a href="https://hubdrive.space/file/drive789">HubDrive</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(html);
    const cloudExtractSpy = jest.spyOn(localHubCloud, 'extract').mockResolvedValueOnce([
      { url: new URL('https://hub.test-cdn.buzz/same123'), format: Format.unknown, label: 'HubCloud (FSL)', ttl: 120000 },
    ]);
    // HubDrive resolves to the SAME HubCloud URL as the direct link
    jest.spyOn(localHubDrive, 'resolveHubCloudUrl').mockResolvedValueOnce(new URL(cloudUrl));

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/hubclouddedup'), {});

    // HubDrive is always resolved (no gate), but the duplicate URL is skipped
    expect(localHubDrive.resolveHubCloudUrl).toHaveBeenCalled();
    // hubCloud.extract should only be called once — the resolved URL was deduped
    expect(cloudExtractSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(1);
    expect(result[0]?.label).toContain('HubCloud');
  });

  test('extracts from new HubCloud URL discovered via HubDrive', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    // Page with HubCloud A and HubDrive pointing to HubCloud B (different URL)
    const html = `<!DOCTYPE html><html><head><title>New URL Test 2024</title></head><body>
      <a href="https://hubcloud.one/drive/cloudA">HubCloud</a>
      <a href="https://hubdrive.space/file/drive789">HubDrive</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(html);
    const cloudExtractSpy = jest.spyOn(localHubCloud, 'extract');
    cloudExtractSpy.mockResolvedValueOnce([ // Direct HubCloud A → results
      { url: new URL('https://hub.test-cdn.buzz/cloudA'), format: Format.unknown, label: 'HubCloud (FSL)', ttl: 120000 },
    ]);
    cloudExtractSpy.mockResolvedValueOnce([ // HubCloud B via HubDrive → results
      { url: new URL('https://hub.test-cdn.buzz/cloudB'), format: Format.unknown, label: 'HubCloud (FSL)', ttl: 120000 },
    ]);
    jest.spyOn(localHubDrive, 'resolveHubCloudUrl').mockResolvedValueOnce(
      new URL('https://hubcloud.one/drive/cloudB'), // Different URL
    );

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/newurl'), {});

    // HubDrive resolved to a new HubCloud URL — both get extracted
    expect(localHubDrive.resolveHubCloudUrl).toHaveBeenCalled();
    expect(cloudExtractSpy).toHaveBeenCalledTimes(2);
    expect(result.length).toBe(2);
  });

  test('handles resolveHubCloudUrl failure gracefully', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    const html = `<!DOCTYPE html><html><head><title>Resolve Fail Test 2024</title></head><body>
      <a href="https://hubcloud.one/drive/cloud123">HubCloud</a>
      <a href="https://hubdrive.space/file/drive789">HubDrive</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(html);
    jest.spyOn(localHubCloud, 'extract').mockResolvedValueOnce([]); // Direct HubCloud → empty
    jest.spyOn(localHubDrive, 'resolveHubCloudUrl').mockRejectedValueOnce(new Error('Network error'));

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/resolvefail'), {});

    // Should not throw, just return empty
    expect(result).toEqual([]);
  });

  test('handles resolveHubCloudUrl returning null (no HubCloud link on HubDrive page)', async () => {
    const fetcher = new FetcherMock(fixtureBase);
    const localHubCloud = new HubCloud(new FetcherMock(`${fixtureBase}/HubCloud`), logger);
    const localHubDrive = new HubDrive(new FetcherMock(`${fixtureBase}/HubDrive`), logger, localHubCloud);
    const hblinks = new HBLinks(fetcher, logger, localHubDrive, localHubCloud);

    const html = `<!DOCTYPE html><html><head><title>No Cloud Test 2024</title></head><body>
      <a href="https://hubcloud.one/drive/cloud123">HubCloud</a>
      <a href="https://hubdrive.space/file/drive789">HubDrive</a>
    </body></html>`;

    jest.spyOn(fetcher, 'text').mockResolvedValueOnce(html);
    jest.spyOn(localHubCloud, 'extract').mockResolvedValueOnce([]); // Direct HubCloud → empty
    jest.spyOn(localHubDrive, 'resolveHubCloudUrl').mockResolvedValueOnce(null); // No HubCloud link

    const result = await hblinks.extract(ctx, new URL('https://hblinks.dad/archives/nocloud'), {});

    // resolveHubCloudUrl returned null — HubDrive would return empty anyway, so skip
    expect(result).toEqual([]);
  });
});

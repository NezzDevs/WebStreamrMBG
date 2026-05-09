import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { HubCloud } from './HubCloud';
import { HubDrive } from './HubDrive';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(
  logger,
  [
    new HubDrive(
      new FetcherMock(`${__dirname}/__fixtures__/HubDrive`),
      logger,
      new HubCloud(new FetcherMock(`${__dirname}/__fixtures__/HubDrive/HubCloud`), logger),
    ),
  ],
);

const ctx = createTestContext();

describe('HubDrive', () => {
  test('handle avatar', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubdrive.space/file/7283903021'))).toMatchSnapshot();
  });

  test('handle missing hubcloud', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubdrive.space/file/2243124026'))).toMatchSnapshot();
  });

  test('handle hubcdn.fans with var reurl redirect', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubcdn.fans/file/testcode123'));
    expect(result).toHaveLength(1);
    expect(result.some(r => r.url.href.includes('googleusercontent.com'))).toBe(true);
  });

  test('handle hubcdn.fans with googleusercontent fallback', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubcdn.fans/file/fallbackcode456'));
    expect(result).toHaveLength(1);
    expect(result.some(r => r.url.href.includes('googleusercontent.com'))).toBe(true);
  });

  test('handle hubcdn.fans with no download link', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubcdn.fans/file/nolink789'));
    expect(result).toEqual([]);
  });

  test('handle hubcdn.fans with a id="vd" link (new format)', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubcdn.fans/file/vdlink789'));
    expect(result).toHaveLength(1);
    expect(result.some(r => r.url.href.includes('googleusercontent.com'))).toBe(true);
  });

  test('handle hubcdn.fans with var reurl pointing to hubcdn.fans/dl/ redirect', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubcdn.fans/file/redirecttest'));
    expect(result).toHaveLength(1);
    expect(result.some(r => r.url.href.includes('googleusercontent.com'))).toBe(true);
    expect(result.some(r => r.url.href.includes('hubcdn.fans'))).toBe(false);
  });
  test('handle hubcdn.fans with var reurl containing invalid link param', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubcdn.fans/file/invalidlink'));
    expect(result).toEqual([]);
  });

  test('handle hubcdn.fans with var reurl containing invalid URL', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubcdn.fans/file/invalidreurl'));
    expect(result).toEqual([]);
  });

  test('handle hubcdn.fans with var reurl containing empty link param', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubcdn.fans/file/emptylink'));
    expect(result).toHaveLength(1);
    expect(result.some(r => r.url.href.includes('hubcdn.fans'))).toBe(true);
  });

  test('supports hubcdn.buzz domain (domain rotation)', async () => {
    const hubDrive = new HubDrive(
      new FetcherMock(`${__dirname}/__fixtures__/HubDrive`),
      logger,
      new HubCloud(new FetcherMock(`${__dirname}/__fixtures__/HubDrive/HubCloud`), logger),
    );
    expect(hubDrive.supports(ctx, new URL('https://hubcdn.buzz/file/test'))).toBe(true);
    expect(hubDrive.supports(ctx, new URL('https://gpdl.hubcdn.buzz/file/test'))).toBe(true);
    expect(hubDrive.supports(ctx, new URL('https://hubcdn.fans/file/test'))).toBe(true);
  });

  test('returns empty when HubCloud link has invalid URL', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubdrive.test/file/9990000001'));
    expect(result).toEqual([]);
  });

  test('returns empty when URL has no /file/ path', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubdrive.space/other/path'));
    expect(result).toEqual([]);
  });

  test('returns empty when HubCloud extract throws', async () => {
    const hubCloud = new HubCloud(new FetcherMock(`${__dirname}/__fixtures__/HubDrive/HubCloud`), logger);
    const hubDrive = new HubDrive(
      new FetcherMock(`${__dirname}/__fixtures__/HubDrive`),
      logger,
      hubCloud,
    );
    jest.spyOn(hubCloud, 'extract').mockRejectedValue(new Error('extract failed'));
    const result = await hubDrive.extract(ctx, new URL('https://hubdrive.test/file/9990000004'), {});
    expect(result).toEqual([]);
  });

  test('returns empty when HubCloud links point to dead domains only', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubdrive.test/file/9990000002'));
    expect(result).toEqual([]);
  });

  test('returns empty when HubCloud link has no href attribute', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubdrive.test/file/9990000006'));
    expect(result).toEqual([]);
  });

  test('returns empty when no HubCloud link found and no direct API fallback', async () => {
    const result = await extractorRegistry.handle(ctx, new URL('https://hubdrive.space/file/2243124026'));
    expect(result).toEqual([]);
  });
});

describe('HubDrive.resolveHubCloudUrl', () => {
  test('resolves HubCloud URL from HubDrive page', async () => {
    const hubCloud = new HubCloud(new FetcherMock(`${__dirname}/__fixtures__/HubDrive/HubCloud`), logger);
    const hubDrive = new HubDrive(
      new FetcherMock(`${__dirname}/__fixtures__/HubDrive`),
      logger,
      hubCloud,
    );

    const result = await hubDrive.resolveHubCloudUrl(ctx, new URL('https://hubdrive.space/file/7283903021'), {});
    expect(result).not.toBeNull();
    expect(result?.host).toMatch(/hubcloud/);
  });

  test('returns null when HubDrive page has no HubCloud link', async () => {
    const hubCloud = new HubCloud(new FetcherMock(`${__dirname}/__fixtures__/HubDrive/HubCloud`), logger);
    const hubDrive = new HubDrive(
      new FetcherMock(`${__dirname}/__fixtures__/HubDrive`),
      logger,
      hubCloud,
    );

    // This fixture has no HubCloud link (missing hubcloud scenario)
    const result = await hubDrive.resolveHubCloudUrl(ctx, new URL('https://hubdrive.space/file/2243124026'), {});
    expect(result).toBeNull();
  });

  test('returns null when HubCloud links point to dead domains only', async () => {
    const hubCloud = new HubCloud(new FetcherMock(`${__dirname}/__fixtures__/HubDrive/HubCloud`), logger);
    const hubDrive = new HubDrive(
      new FetcherMock(`${__dirname}/__fixtures__/HubDrive`),
      logger,
      hubCloud,
    );

    const result = await hubDrive.resolveHubCloudUrl(ctx, new URL('https://hubdrive.test/file/9990000002'), {});
    expect(result).toBeNull();
  });

  test('returns null when fetch fails', async () => {
    const fetcher = new FetcherMock(`${__dirname}/__fixtures__/HubDrive`);
    const hubCloud = new HubCloud(new FetcherMock(`${__dirname}/__fixtures__/HubDrive/HubCloud`), logger);
    const hubDrive = new HubDrive(fetcher, logger, hubCloud);

    jest.spyOn(fetcher, 'text').mockRejectedValueOnce(new Error('Network error'));

    const result = await hubDrive.resolveHubCloudUrl(ctx, new URL('https://hubdrive.space/file/7283903021'), {});
    expect(result).toBeNull();
  });
});

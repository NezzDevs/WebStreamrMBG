import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { StreamEmbed } from './StreamEmbed';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new StreamEmbed(new FetcherMock(`${__dirname}/__fixtures__/StreamEmbed`), logger)]);

const ctxWithoutMfp = createTestContext();
const ctxWithMfp = createTestContext({ mediaFlowProxyUrl: 'https://mediaflow.test.org', mediaFlowProxyPassword: 'test' });

describe('StreamEmbed', () => {
  test('watch.gxplayer.xyz without MediaFlow', async () => {
    expect(await extractorRegistry.handle(ctxWithoutMfp, new URL('https://watch.gxplayer.xyz/watch?v=MEKI92PU'))).toMatchSnapshot();
  });

  test('watch.gxplayer.xyz with MediaFlow', async () => {
    expect(await extractorRegistry.handle(ctxWithMfp, new URL('https://watch.gxplayer.xyz/watch?v=MEKI92PU'))).toMatchSnapshot();
  });

  test('video is not ready', async () => {
    expect(await extractorRegistry.handle(ctxWithoutMfp, new URL('https://watch.gxplayer.xyz/watch?v=PBO90WAS'))).toMatchSnapshot();
  });

  test('returns empty when video pattern not found', async () => {
    expect(await extractorRegistry.handle(ctxWithoutMfp, new URL('https://watch.gxplayer.xyz/watch?v=NOVIDEO'))).toHaveLength(0);
  });

  test('returns stream with undefined height when quality is not valid JSON', async () => {
    const results = await extractorRegistry.handle(ctxWithoutMfp, new URL('https://watch.gxplayer.xyz/watch?v=NOQUALITY'));
    expect(results).toHaveLength(1);
    expect(results[0]?.meta?.height).toBeUndefined();
  });

  test('returns stream with undefined height when quality is missing', async () => {
    const results = await extractorRegistry.handle(ctxWithoutMfp, new URL('https://watch.gxplayer.xyz/watch?v=NOQUALITYNULL'));
    expect(results).toHaveLength(1);
    expect(results[0]?.meta?.height).toBeUndefined();
  });

  test('returns stream with undefined height when quality value is not numeric', async () => {
    const results = await extractorRegistry.handle(ctxWithoutMfp, new URL('https://watch.gxplayer.xyz/watch?v=NOHEIGHT'));
    expect(results).toHaveLength(1);
    expect(results[0]?.meta?.height).toBeUndefined();
  });
});

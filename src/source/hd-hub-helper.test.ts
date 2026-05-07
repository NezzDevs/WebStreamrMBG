import rot13Cipher from 'rot13-cipher';
import { createTestContext } from '../test';
import { Fetcher } from '../utils';
import { resolveRedirectUrl } from './hd-hub-helper';

const ctx = createTestContext();

// Encodes a JSON payload the same way gadgetsweb.xyz does
function buildPayload(json: Record<string, string>): string {
  return btoa(btoa(rot13Cipher(btoa(JSON.stringify(json)))));
}

const makeFetcher = (pages: Record<string, string> = {}): Fetcher =>
  ({ text: (_ctx: unknown, url: URL) => Promise.resolve(pages[url.href] ?? '') } as unknown as Fetcher);

const REDIRECT_URL = new URL('https://gadgetsweb.xyz/?id=test');

describe('resolveRedirectUrl', () => {
  test('resolves primary o field via s() pattern', async () => {
    const payload = buildPayload({ o: btoa('https://hub.test.buzz/file.mkv') });
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>` });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hub.test.buzz/file.mkv');
  });

  test('resolves primary o field via ck() pattern', async () => {
    const payload = buildPayload({ o: btoa('https://hub.test.buzz/file.mkv') });
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>ck('_wp_http_1','${payload}')</script>` });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hub.test.buzz/file.mkv');
  });

  test('throws when no pattern matches in page', async () => {
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: '<script>no pattern here</script>' });
    await expect(resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).rejects.toThrow('[hd-hub-helper] Could not extract redirect data');
  });

  test('resolves via blog_url fallback when o field is absent', async () => {
    const payload = buildPayload({ blog_url: 'https://blog.test.com', data: 'testdata' });
    const fetcher = makeFetcher({
      [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>`,
      'https://blog.test.com/?re=testdata': 'https://hub.test.buzz/fallback.mkv',
    });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hub.test.buzz/fallback.mkv');
  });

  test('throws when encoded payload is not valid JSON', async () => {
    const badPayload = btoa(btoa(rot13Cipher(btoa('not-json-at-all'))));
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>s('o','${badPayload}')</script>` });
    await expect(resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).rejects.toThrow('[hd-hub-helper] Could not parse redirect data');
  });

  test('throws when JSON payload has no usable URL fields', async () => {
    const payload = buildPayload({});
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>` });
    await expect(resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).rejects.toThrow('[hd-hub-helper] No usable URL found');
  });
});

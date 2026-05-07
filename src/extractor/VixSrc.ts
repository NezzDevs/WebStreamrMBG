import { NotFoundError } from '../error';
import { Context, CountryCode, Format, InternalUrlResult, Meta } from '../types';
import {
  buildMediaFlowProxyExtractorRedirectUrl, CustomRequestConfig, guessHeightFromPlaylist,
  hasMultiEnabled, iso639FromCountryCode, supportsMediaFlowProxy,
} from '../utils';
import { Extractor } from './Extractor';

export class VixSrc extends Extractor {
  public readonly id = 'vixsrc';
  public readonly label = 'VixSrc';
  public override readonly ttl: number = 21600000; // 6h

  public supports(_ctx: Context, url: URL): boolean {
    return null !== url.host.match(/vixsrc/);
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const headers = {
      'Referer': 'https://vixsrc.to/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };

    // When MediaFlow is configured, delegate ALL fetching to MediaFlow using the VixCloud
    // extractor (identical site structure: /api/movie/{id} -> embed -> token).
    // This locks the VixSrc token to MediaFlow's IP so it can proxy successfully.
    if (supportsMediaFlowProxy(ctx)) {
      const countryCodes = meta.countryCodes ?? [CountryCode.multi];
      /* istanbul ignore next */
      if (!hasMultiEnabled(ctx.config) && !countryCodes.some(countryCode => countryCode in ctx.config)) {
        /* istanbul ignore next */
        return [];
      }
      const streamUrl = buildMediaFlowProxyExtractorRedirectUrl(ctx, 'VixCloud', url, headers);
      return [
        {
          url: streamUrl,
          format: Format.hls,
          notWebReady: false,
          meta: {
            ...meta,
            countryCodes,
            height: meta.height ?? 1080,
          },
        },
      ];
    }

    // Non-MediaFlow path: local extraction for Stremio desktop
    const apiUrl = new URL(`/api${url.pathname}`, 'https://vixsrc.to');
    const apiJson = await this.fetcher.json(ctx, apiUrl, { headers }) as { src: string };
    const embedUrl = new URL(apiJson.src, 'https://vixsrc.to');
    const html = await this.fetcher.text(ctx, embedUrl, { headers });
    const tokenMatch = html.match(/['"]token['"]:\s?['"]([^'"]*)['"]/);
    const expiresMatch = html.match(/['"]expires['"]:\s?['"]([^'"]*)['"]/);
    const urlMatch = html.match(/url:\s?['"]([^'"]*)['"]/);
    if (!tokenMatch || !expiresMatch || !urlMatch) throw new NotFoundError();
    const token = tokenMatch[1] as string;
    const expires = expiresMatch[1] as string;
    const urlValue = urlMatch[1] as string;
    const baseUrl = new URL(urlValue);
    const playlistUrl = new URL(`${baseUrl.origin}${baseUrl.pathname}.m3u8?${baseUrl.searchParams}`);
    playlistUrl.searchParams.append('token', token);
    playlistUrl.searchParams.append('expires', expires);
    playlistUrl.searchParams.append('h', '1');
    const countryCodes = meta.countryCodes ?? [CountryCode.multi, ...(await this.determineCountryCodesFromPlaylist(ctx, playlistUrl, { headers }))];
    if (!hasMultiEnabled(ctx.config) && !countryCodes.some(countryCode => countryCode in ctx.config)) {
      return [];
    }
    // Compute a dynamic TTL based on the expires timestamp
    const tokenTtl = Math.max(900000, Number(expires) * 1000 - Date.now() - 120000); // 2min safety buffer

    return [
      {
        url: playlistUrl,
        format: Format.hls,
        ttl: Math.min(tokenTtl, this.ttl),
        meta: {
          ...meta,
          countryCodes,
          height: meta.height ?? await guessHeightFromPlaylist(ctx, this.fetcher, playlistUrl, { headers }),
        },
      },
    ];
  }

  private async determineCountryCodesFromPlaylist(ctx: Context, playlistUrl: URL, init?: CustomRequestConfig): Promise<CountryCode[]> {
    const playlist = await this.fetcher.text(ctx, playlistUrl, init);
    const countryCodes: CountryCode[] = [];
    (Object.keys(CountryCode) as CountryCode[]).forEach((countryCode) => {
      const iso639 = iso639FromCountryCode(countryCode);
      if (!countryCodes.includes(countryCode) && (new RegExp(`#EXT-X-MEDIA:TYPE=AUDIO.*LANGUAGE="${iso639}"`)).test(playlist)) {
        countryCodes.push(countryCode);
      }
    });
    return countryCodes;
  }
}

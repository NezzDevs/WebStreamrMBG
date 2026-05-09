import * as cheerio from 'cheerio';
import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';
import { HubCloud } from './HubCloud';

const DEAD_HUBCLOUD_HOSTS = new Set([
  'hubcloud.ink',
  'hubcloud.co',
  'hubcloud.cc',
  'hubcloud.me',
  'hubcloud.xyz',
]);

export class HubDrive extends Extractor {
  public readonly id = 'hubdrive';

  public readonly label = 'HubDrive';

  public override readonly ttl: number = 120000; // 2 min

  public override readonly cacheVersion = 3;

  private readonly hubCloud: HubCloud;

  public constructor(fetcher: Fetcher, logger: winston.Logger, hubCloud: HubCloud) {
    super(fetcher, logger);

    this.hubCloud = hubCloud;
  }

  public supports(_ctx: Context, url: URL): boolean {
    return null !== url.host.match(/hubdrive|hubcdn/);
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const headers = { Referer: meta.referer ?? url.href };

    const html = await this.fetcher.text(ctx, url, { headers });

    if (/hubcdn/.test(url.host)) {
      return this.extractHubCdnResult(html, meta);
    }

    const results = await this.extractViaHubCloud(ctx, html, meta);
    return results;
  };

  /** Resolve the HubCloud URL a HubDrive page delegates to, or null. */
  public async resolveHubCloudUrl(ctx: Context, url: URL, meta: Meta): Promise<URL | null> {
    const headers = { Referer: meta.referer ?? url.href };

    let html: string;
    try {
      html = await this.fetcher.text(ctx, url, { headers });
    } catch {
      return null;
    }

    const $ = cheerio.load(html);
    return this.findHubCloudUrl($);
  }

  private async extractViaHubCloud(ctx: Context, html: string, meta: Meta): Promise<InternalUrlResult[]> {
    const $ = cheerio.load(html);
    const hubCloudUrl = this.findHubCloudUrl($);

    if (!hubCloudUrl) {
      return [];
    }

    try {
      return await this.hubCloud.extract(ctx, hubCloudUrl, meta);
    } catch {
      return [];
    }
  }

  private findHubCloudUrl($: cheerio.CheerioAPI): URL | null {
    const hubCloudUrl = $('a:contains("HubCloud")')
      .map((_i, el) => {
        const href = $(el).attr('href');
        if (!href) return null;
        try {
          const parsed = new URL(href);
          if (DEAD_HUBCLOUD_HOSTS.has(parsed.host.toLowerCase())) return null;
          return parsed;
        } catch {
          return null;
        }
      })
      .get(0);

    return hubCloudUrl ?? null;
  }

  private extractHubCdnResult(html: string, meta: Meta): InternalUrlResult[] {
    // Pattern 1: <a id="vd" href='URL'> (new hubcdn.fans format)
    const vdMatch = html.match(/<a\s+id=["']vd["']\s+href=["']([^"']+)["']/i);
    if (vdMatch?.[1]) {
      try {
        const directUrl = new URL(vdMatch[1]);
        return [{ url: directUrl, format: Format.unknown, meta }];
      // eslint-disable-next-line no-empty
      } catch {
      }
    }

    // Pattern 2: var reurl = "URL" (legacy hubcdn.fans format)
    const reurlMatch = html.match(/var\s+reurl\s*=\s*["']([^"']+)["']/);
    if (reurlMatch?.[1]) {
      try {
        const reurlValue = reurlMatch[1];
        if (reurlValue.includes('hubcdn') && reurlValue.includes('/dl/?link=')) {
          const dlUrl = new URL(reurlValue);
          const linkParam = dlUrl.searchParams.get('link');
          if (linkParam) {
            return [{ url: new URL(linkParam), format: Format.unknown, meta }];
          }
        }
        const directUrl = new URL(reurlValue);
        return [{ url: directUrl, format: Format.unknown, meta }];
      // eslint-disable-next-line no-empty
      } catch {
      }
    }

    // Pattern 3: any googleusercontent.com URL (fallback)
    const gdriveMatch = html.match(/(https?:\/\/[^\s"'<>]*googleusercontent\.com[^\s"'<>]*)/);
    if (gdriveMatch?.[1]) {
      try {
        return [{ url: new URL(gdriveMatch[1]), format: Format.unknown, meta }];
      // eslint-disable-next-line no-empty
      } catch {
      }
    }

    return [];
  }
}

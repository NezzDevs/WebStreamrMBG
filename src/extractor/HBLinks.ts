import * as cheerio from 'cheerio';
import winston from 'winston';
import { Context, InternalUrlResult, Meta } from '../types';
import { Fetcher, findCountryCodes, findHeight } from '../utils';
import { Extractor } from './Extractor';
import { HubCloud } from './HubCloud';
import { HubDrive } from './HubDrive';

export class HBLinks extends Extractor {
  public readonly id = 'hblinks';

  public readonly label = 'HUBLinks';

  public override readonly ttl: number = 120000; // 2 min

  public override readonly cacheVersion = 1;

  private readonly hubDrive: HubDrive;

  private readonly hubCloud: HubCloud;

  public constructor(fetcher: Fetcher, logger: winston.Logger, hubDrive: HubDrive, hubCloud: HubCloud) {
    super(fetcher, logger);

    this.hubDrive = hubDrive;
    this.hubCloud = hubCloud;
  }

  public supports(_ctx: Context, url: URL): boolean {
    return /hblinks/.test(url.host.toLowerCase());
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const headers = { Referer: meta.referer ?? url.href };

    let html: string;
    try {
      html = await this.fetcher.text(ctx, url, { headers });
    } catch {
      return [];
    }

    const $ = cheerio.load(html);

    const pageTitle = $('title').text().trim();
    const countryCodes = [...new Set([...meta.countryCodes ?? [], ...findCountryCodes(pageTitle)])];
    const height = meta.height ?? findHeight(pageTitle);
    const updatedMeta = { ...meta, countryCodes, height, title: pageTitle || meta.title };

    const results: InternalUrlResult[] = [];

    // HubCDN → direct Google video URLs, never duplicated by HubCloud
    const hubCdnLinks = this.extractLinks($, url, /hubcdn/);
    for (const cdnUrl of hubCdnLinks) {
      try {
        const cdnResults = await this.hubDrive.extract(ctx, cdnUrl, updatedMeta);
        results.push(...cdnResults);
      } catch {
        // skip failed extraction
      }
    }

    // Deduplicate HubCloud URLs: HubDrive always delegates to HubCloud, so same URL via either path is extracted once
    const seenHubCloudUrls = new Set<string>();
    const hubCloudUrls: URL[] = [];

    for (const cloudUrl of this.extractLinks($, url, /hubcloud/)) {
      seenHubCloudUrls.add(cloudUrl.href);
      hubCloudUrls.push(cloudUrl);
    }

    for (const driveUrl of this.extractLinks($, url, /hubdrive/)) {
      try {
        const resolved = await this.hubDrive.resolveHubCloudUrl(ctx, driveUrl, updatedMeta);
        if (resolved && !seenHubCloudUrls.has(resolved.href)) {
          seenHubCloudUrls.add(resolved.href);
          hubCloudUrls.push(resolved);
        }
      } catch {
        // skip failed resolution
      }
    }

    for (const cloudUrl of hubCloudUrls) {
      try {
        results.push(...await this.hubCloud.extract(ctx, cloudUrl, updatedMeta));
      } catch {
        // skip failed extraction
      }
    }

    return results;
  }

  /** Extract links matching a host pattern, deduplicated by URL. */
  private extractLinks($: cheerio.CheerioAPI, pageUrl: URL, hostPattern: RegExp): URL[] {
    const links: URL[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      if (href && hostPattern.test(href)) {
        try {
          const parsedUrl = new URL(href, pageUrl);
          const key = parsedUrl.href;
          if (!seen.has(key)) {
            seen.add(key);
            links.push(parsedUrl);
          }
        } catch {
          // skip invalid URL
        }
      }
    });

    return links;
  }
}

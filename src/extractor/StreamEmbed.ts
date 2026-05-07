import { NotFoundError } from '../error';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { buildMediaFlowProxyHlsUrl, supportsMediaFlowProxy } from '../utils';
import { Extractor } from './Extractor';

export class StreamEmbed extends Extractor {
  public readonly id = 'streamembed';

  public readonly label = 'StreamEmbed';

  public override readonly ttl: number = 21600000; // 6h

  public supports(_ctx: Context, url: URL): boolean {
    return null !== url.host.match(/bullstream|mp4player|watch\.gxplayer/);
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const headers = { Referer: meta.referer ?? url.href };

    const html = await this.fetcher.text(ctx, url, { headers });

    if (/Video is not ready/.test(html)) {
      throw new NotFoundError();
    }

    const videoMatch = html.match(/video ?= ?(.*);/);
    if (!videoMatch) throw new NotFoundError();
    const videoJson = videoMatch[1] as string;
    const video = JSON.parse(videoJson) as { uid: string; md5: string; id: string; status: string; quality: string | undefined; title: string };

    const m3u8Url = new URL(`/m3u8/${video.uid}/${video.md5}/master.txt?s=1&id=${video.id}&cache=${video.status}`, url.origin);

    const streamUrl = supportsMediaFlowProxy(ctx)
      ? buildMediaFlowProxyHlsUrl(ctx, m3u8Url, { Referer: url.origin }, true)
      : m3u8Url;

    return [
      {
        url: streamUrl,
        format: Format.hls,
        meta: {
          ...meta,
          height: (() => {
            try {
              if (!video.quality) return undefined;
              const qualities = JSON.parse(video.quality) as string[];
              const firstQuality = qualities[0] as string;
              const height = parseInt(firstQuality);
              return height || undefined;
            } catch {
              return undefined;
            }
          })(),
          title: decodeURIComponent(video.title),
        },
      },
    ];
  };
}

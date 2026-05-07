import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

interface MovixApiData {
  iframe_src: string;
  player_links?: { decoded_url: string }[];
}

export class Movix extends Source {
  public readonly id = 'movix';

  public readonly label = 'Movix';

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.fr];

  public readonly baseUrl = 'https://api.movix.cash';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();

    this.fetcher = fetcher;
  }

  public async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);

    const apiUrl = tmdbId.season
      ? new URL(`/api/tmdb/tv/${tmdbId.id}?season=${tmdbId.season}&episode=${tmdbId.episode}`, this.baseUrl)
      : new URL(`/api/tmdb/movie/${tmdbId.id}`, this.baseUrl);

    const json = await this.fetcher.json(ctx, apiUrl, {
      headers: {
        Origin: 'https://movix.cash',
        Referer: 'https://movix.cash/',
      },
    });
    const data: MovixApiData | undefined = tmdbId.season ? json['current_episode'] : json;

    if (!data || !data.player_links) {
      return [];
    }

    const urls: URL[] = data['player_links'].map(({ decoded_url }) => new URL(decoded_url));

    const title = tmdbId.season
      ? `${json['tmdb_details']?.['title'] ?? 'Unknown'} ${tmdbId.formatSeasonAndEpisode()}`
      : `${json['tmdb_details']?.['title'] ?? 'Unknown'} (${year})`;

    return urls.map(url => ({ url, meta: { countryCodes: [CountryCode.fr], referer: data.iframe_src, title } }));
  };
}

import rot13Cipher from 'rot13-cipher';
import { Context } from '../types';
import { Fetcher } from '../utils';

export const resolveRedirectUrl = async (ctx: Context, fetcher: Fetcher, redirectUrl: URL): Promise<URL> => {
  const redirectHtml = await fetcher.text(ctx, redirectUrl);

  const regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
  let combinedString = '';
  let match: RegExpExecArray | null;

  while ((match = regex.exec(redirectHtml)) !== null) {
    combinedString += (match[1] ?? match[2]) as string;
  }

  if (!combinedString) {
    throw new Error(`[hd-hub-helper] Could not extract redirect data from: ${redirectUrl.href}`);
  }

  let redirectData: { o?: string; data?: string; blog_url?: string };
  try {
    redirectData = JSON.parse(atob(rot13Cipher(atob(atob(combinedString)))));
  } catch {
    throw new Error(`[hd-hub-helper] Could not parse redirect data from: ${redirectUrl.href}`);
  }

  const encodedUrl = (redirectData['o'] ?? '').trim();
  if (encodedUrl) {
    return new URL(atob(encodedUrl));
  }

  const wphttp1 = (redirectData['blog_url'] ?? '').trim();
  const data = (redirectData['data'] ?? '').trim();
  if (wphttp1 && data) {
    const fallbackHtml = await fetcher.text(ctx, new URL(`${wphttp1}?re=${data}`));
    return new URL(fallbackHtml.trim());
  }

  throw new Error(`[hd-hub-helper] No usable URL found in redirect data from: ${redirectUrl.href}`);
};

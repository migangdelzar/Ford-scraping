import {load} from 'cheerio';
import type {PageLinkCandidate} from '../domain/contracts.js';
import {normalizeUrl} from './url-policy.js';

export function extractPageLinks(
  rawHtml: string,
  sourceUrl: string,
): PageLinkCandidate[] {
  const $ = load(rawHtml);
  const source = new URL(sourceUrl);
  return $('a[href]')
    .map((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href')?.trim();
      if (!href) return undefined;
      let target: URL;
      try {
        target = new URL(href, source);
      } catch {
        return undefined;
      }

      const isHttp =
        target.protocol === 'http:' || target.protocol === 'https:';
      const internal = isHttp && target.hostname === source.hostname;
      const normalizedTargetUrl = isHttp
        ? normalizeUrl(target.toString(), source)
        : undefined;
      const isComparisonRoute =
        /^\/.+\/(?:20\d{2}|\d{2})\/comparativo\/[^/]+\/?$/i.test(
          target.pathname,
        );
      const hasColorSelector = [...target.searchParams.keys()].some(key =>
        ['exterior', 'interior'].includes(key.toLowerCase()),
      );
      const storedHref =
        isHttp && isComparisonRoute && hasColorSelector
          ? normalizedTargetUrl!
          : href;
      const linkType: PageLinkCandidate['linkType'] =
        target.protocol === 'mailto:'
          ? 'email'
          : target.protocol === 'tel:'
            ? 'phone'
            : !isHttp
              ? 'other'
              : internal
                ? 'internal'
                : 'external';
      return {
        href: storedHref,
        targetUrl: normalizedTargetUrl ?? target.toString(),
        anchorText: anchor.text().replace(/\s+/g, ' ').trim(),
        ...(anchor.attr('rel')?.trim()
          ? {rel: anchor.attr('rel')!.trim()}
          : {}),
        internal,
        linkType,
      };
    })
    .get()
    .filter((link): link is PageLinkCandidate => link !== undefined);
}

/**
 * Pagination helpers for the Sage Intacct REST API.
 *
 * Mirrors intacct_sdk/pagination.py — yields every record across
 * paginated responses.
 */

export type PageFetcher<T> = (cursor: string | null) => Promise<{
  items: T[];
  nextCursor: string | null;
}>;

export interface PaginateOptions {
  maxPages?: number;
  maxResults?: number;
}

/**
 * Iterate every record across paginated REST responses.
 *
 * The fetcher takes a cursor (or null for the first page) and returns
 * { items, nextCursor }. Stops when nextCursor is null/empty or when
 * limits are hit.
 */
export async function* paginate<T>(
  fetchPage: PageFetcher<T>,
  opts: PaginateOptions = {},
): AsyncIterableIterator<T> {
  const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
  const maxResults = opts.maxResults ?? Number.POSITIVE_INFINITY;
  let cursor: string | null = null;
  let pageCount = 0;
  let resultCount = 0;

  while (true) {
    const { items, nextCursor } = await fetchPage(cursor);
    for (const item of items) {
      yield item;
      resultCount++;
      if (resultCount >= maxResults) {
        return;
      }
    }
    pageCount++;
    if (!nextCursor || pageCount >= maxPages) {
      return;
    }
    cursor = nextCursor;
  }
}

/** Drain a paginated iterator into an array, capped by maxResults. */
export async function collect<T>(iter: AsyncIterableIterator<T>, maxResults?: number): Promise<T[]> {
  const out: T[] = [];
  const cap = maxResults ?? Number.POSITIVE_INFINITY;
  for await (const item of iter) {
    out.push(item);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

"""Pagination helpers for the Sage Intacct REST API."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any


def paginate(
    fetch_page: Callable[[str | None], dict[str, Any]],
    *,
    items_key: str = "ia::result",
    next_cursor_key: str = "next_cursor",
    max_pages: int | None = None,
) -> Iterator[dict[str, Any]]:
    """Iterate every record across paginated REST responses.

    ``fetch_page`` is a function that takes a cursor (or None for the first
    page) and returns the parsed JSON body. ``items_key`` and
    ``next_cursor_key`` are configurable to match different REST surfaces;
    the defaults track the documented Sage Intacct shape.
    """
    cursor: str | None = None
    page_count = 0
    while True:
        body = fetch_page(cursor)
        items = body.get(items_key) or []
        for item in items:
            yield item
        cursor = body.get(next_cursor_key)
        page_count += 1
        if cursor is None or cursor == "":
            return
        if max_pages is not None and page_count >= max_pages:
            return

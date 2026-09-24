"""Full JustWatch France catalogue search (fork addition, 1.0.9-stremio.2).

The historical card search only filters the titles already loaded in the
current popularity pool. This module queries JustWatch France directly so any
film or series can be found, whatever its current popularity, and then opened
on Stremio (or on a streaming service when it is available there).

Kept outside ``sources.py`` on purpose: the historical engine stays untouched
and protected by the upstream CI guards.
"""
from __future__ import annotations

import logging
from typing import Any

from .const import PROVIDER_NAMES
from .sources import fallback_key, playback_id_from_url, poster_url

_LOGGER = logging.getLogger(__name__)

MAX_RESULTS = 30


async def async_catalog_search(
    client: Any,
    query: str,
    media_type: str | None = None,
    first: int = 24,
) -> list[dict[str, Any]]:
    """Search the whole JustWatch France catalogue by title."""
    query = str(query or "").strip()
    if len(query) < 2:
        return []
    first = max(1, min(int(first or 24), MAX_RESULTS))

    try:
        # Populates client._provider_packages, used to map offers to services.
        await client.async_resolve_provider_packages()
    except Exception:  # noqa: BLE001 - the search still works without it
        _LOGGER.debug("Provider packages unavailable for catalog search", exc_info=True)

    object_types = ["MOVIE", "SHOW"]
    if media_type == "movie":
        object_types = ["MOVIE"]
    elif media_type == "tv":
        object_types = ["SHOW"]

    payload = {
        "operationName": "SearchStreamingTitle",
        "variables": {
            "country": "FR",
            "language": "fr",
            "first": first,
            "filter": {"searchQuery": query, "objectTypes": object_types},
        },
        "query": client.SEARCH_QUERY,
    }
    sem = getattr(client, "_sem", None)
    if sem is not None:
        async with sem:
            data = await client._post(payload)
    else:
        data = await client._post(payload)
    edges = ((data or {}).get("popularTitles") or {}).get("edges") or []

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for edge in edges:
        node = (edge or {}).get("node") or {}
        object_type = node.get("objectType")
        if object_type not in ("MOVIE", "SHOW"):
            continue
        kind = "movie" if object_type == "MOVIE" else "tv"
        content = node.get("content") or {}
        title = str(content.get("title") or "").strip()
        if not title:
            continue
        oid = node.get("objectId")
        key = f"jw:{oid}" if oid is not None else fallback_key(kind, title)
        if key in seen:
            continue
        seen.add(key)

        providers = client._provider_offers(node) or {}
        provider = next(iter(providers), None)
        offer = providers.get(provider) or {}
        watch_url = offer.get("watch_url")
        rating, rating_source = client._rating(content)
        ext = content.get("externalIds") or {}
        jw_poster = poster_url(content.get("fullPosterUrl"))
        full_path = content.get("fullPath")
        out.append(
            {
                "rank": None,
                "global_rank": None,
                "title": title,
                "original_title": None,
                "subtitle": None,
                "provider": provider,
                "provider_name": PROVIDER_NAMES.get(provider, provider) if provider else None,
                "media_type": kind,
                "media_key": key,
                "poster": jw_poster,
                "poster_source": "justwatch" if jw_poster else None,
                "description": content.get("shortDescription"),
                "year": content.get("originalReleaseYear"),
                "rating": rating,
                "rating_source": rating_source,
                "imdb_id": ext.get("imdbId"),
                "_jw_object_id": oid,
                "details_url": (
                    "https://www.justwatch.com" + full_path if full_path else None
                ),
                "watch_url": watch_url,
                "playback_id": playback_id_from_url(provider, watch_url) if provider else None,
                "providers": providers,
                "source": "Recherche catalogue JustWatch France",
            }
        )
    return out

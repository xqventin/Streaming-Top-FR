import logging
from pathlib import Path

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, PLATFORMS, CONF_UPDATE_HOURS, DEFAULT_UPDATE_HOURS
from .storage import StreamingTopStore
from .sources import NetflixOfficialClient, JustWatchClient, LocalMetadataClient, GenreMetadataExtension
from .coordinator import StreamingTopCoordinator
from .playback import SUPPORTED_PLAYBACK_PROVIDERS, async_launch, log_launch_failure
from .catalog_search import async_catalog_search
from .local_library import LocalLibraryScanner
from .settings import async_load_legacy_settings, normalize_settings
from .watch_registry import CanonicalWatchRegistry
from .local_views import annotate_local_items, sync_historical_work
from .local_playback import async_launch_vlc_local, log_local_launch_failure
from .runtime_filter import RuntimeMetadataClient
from .lovelace_resource import (
    async_register_lovelace_resource,
    async_remove_lovelace_resource,
)


_PACKAGE_LOGGER = logging.getLogger(__package__)


def _apply_debug_logging(settings):
    debug_enabled = bool((settings.get("debug") or {}).get("enabled", False))
    _PACKAGE_LOGGER.setLevel(logging.DEBUG if debug_enabled else logging.NOTSET)
    return debug_enabled


async def async_setup(hass, config):
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass, entry):
    hass.data.setdefault(DOMAIN, {})

    # v0.7.1 replaces the legacy text sensor with a Home Assistant-native
    # problem binary sensor. Remove the old registry entry once so users do
    # not keep an unavailable sensor.streaming_top_fr after upgrading.
    registry = er.async_get(hass)
    legacy_status_entity = registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_status"
    )
    if legacy_status_entity:
        registry.async_remove(legacy_status_entity)

    # v0.7 migrates the v0.6.x YAML configuration into native ConfigEntry
    # options once, while leaving the YAML file untouched as a rollback path.
    if "settings" not in entry.options or CONF_UPDATE_HOURS not in entry.options:
        options = dict(entry.options)
        if "settings" not in options:
            options["settings"] = normalize_settings(
                await async_load_legacy_settings(hass)
            )
        options.setdefault(
            CONF_UPDATE_HOURS,
            entry.data.get(CONF_UPDATE_HOURS, DEFAULT_UPDATE_HOURS),
        )
        hass.config_entries.async_update_entry(
            entry,
            options=options,
            minor_version=1,
        )

    store = StreamingTopStore(hass)
    await store.async_load()
    watch_registry = CanonicalWatchRegistry(hass)
    await watch_registry.async_load()
    await watch_registry.async_import_historical(store.watched_items())
    session = async_get_clientsession(hass)
    coordinator = StreamingTopCoordinator(
        hass,
        NetflixOfficialClient(session),
        JustWatchClient(session, store),
        store,
        entry,
    )
    local_metadata = LocalMetadataClient(session, store)
    runtime_metadata = RuntimeMetadataClient(session, store)
    await coordinator.async_config_entry_first_refresh()
    active_settings = (
        coordinator.settings
        or (coordinator.data or {}).get("settings")
        or {}
    )
    _apply_debug_logging(active_settings)
    hass.data[DOMAIN][entry.entry_id] = {
        "coordinator": coordinator,
        "store": store,
        "watch_registry": watch_registry,
        "local_library": LocalLibraryScanner(hass),
        "local_metadata": local_metadata,
        "runtime_metadata": runtime_metadata,
    }
    entry_runtime = hass.data[DOMAIN][entry.entry_id]
    local_settings = (
        coordinator.settings
        or (coordinator.data or {}).get("settings")
        or {}
    ).get("local_library") or {}
    if local_settings.get("enabled", False):
        hass.async_create_task(
            _async_refresh_local_canonical_index(entry_runtime),
            f"{DOMAIN}_local_canonical_index_bootstrap",
        )
    await _register_frontend(hass)
    await async_register_lovelace_resource(hass)
    _register_ws(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass, entry):
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        _PACKAGE_LOGGER.setLevel(logging.NOTSET)
    return ok


async def async_remove_entry(hass, entry):
    """Remove integration-owned persistent resources."""
    await async_remove_lovelace_resource(hass)


async def _register_frontend(hass):
    if hass.data[DOMAIN].get("_static_registered"):
        return
    path = Path(__file__).parent / "www" / "streaming-top-fr-card.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig("/streaming_top_fr/streaming-top-fr-card.js", str(path), False)]
    )
    hass.data[DOMAIN]["_static_registered"] = True


def _entry_data(hass, entry_id=None):
    data = {
        key: value
        for key, value in hass.data.get(DOMAIN, {}).items()
        if not key.startswith("_") and isinstance(value, dict)
    }
    return data.get(entry_id) if entry_id else next(iter(data.values()), None)


LOCAL_INDEX_METADATA_KEY = "local-canonical-index-v1"


def _local_match_token(value):
    return "".join(
        char for char in str(value or "").casefold()
        if char.isalnum()
    )


def _local_public_ref(item):
    """Keep only playback-safe identity fields in the persisted Local index."""
    return {
        "local_id": item.get("local_id"),
        "title": item.get("title") or item.get("parsed_title"),
        "year": item.get("year"),
        "imdb_id": item.get("imdb_id"),
        "canonical_media_key": item.get("canonical_media_key"),
    }


def _build_local_canonical_index(items):
    """Build a persistent identity -> Local file index from enriched Local items."""
    by_imdb = {}
    by_canonical = {}
    by_title_year = {}
    ambiguous_title_year = set()

    for item in items or []:
        if (
            not isinstance(item, dict)
            or str(item.get("media_type") or "").casefold() != "movie"
            or item.get("episodic")
            or not item.get("local_id")
        ):
            continue

        ref = _local_public_ref(item)
        imdb_id = str(item.get("imdb_id") or "").strip().casefold()
        canonical = str(item.get("canonical_media_key") or "").strip()

        if imdb_id:
            by_imdb.setdefault(imdb_id, ref)
        if canonical:
            by_canonical.setdefault(canonical, ref)

        try:
            year = int(item.get("year"))
        except (TypeError, ValueError):
            year = None

        title_tokens = {
            _local_match_token(value)
            for value in (
                item.get("title"),
                item.get("parsed_title"),
                item.get("lookup_title"),
            )
            if _local_match_token(value)
        }
        if year is not None:
            for token in title_tokens:
                key = f"{year}:{token}"
                if key in by_title_year and by_title_year[key].get("local_id") != ref.get("local_id"):
                    ambiguous_title_year.add(key)
                else:
                    by_title_year[key] = ref

    for key in ambiguous_title_year:
        by_title_year.pop(key, None)

    return {
        "schema": 1,
        "by_imdb": by_imdb,
        "by_canonical": by_canonical,
        "by_title_year": by_title_year,
    }


async def _persist_local_canonical_index(store, items):
    index = _build_local_canonical_index(items)
    store.set_metadata(LOCAL_INDEX_METADATA_KEY, index)
    await store.async_save()
    return index


def _find_local_index_match(item, index):
    """Resolve a Streaming movie against the persisted Local canonical index."""
    if str(item.get("media_type") or "").casefold() not in {"movie", "film"}:
        return None
    if not isinstance(index, dict):
        return None

    imdb_id = str(item.get("imdb_id") or "").strip().casefold()
    if imdb_id:
        match = (index.get("by_imdb") or {}).get(imdb_id)
        if isinstance(match, dict):
            return match

    media_key = str(item.get("media_key") or "").strip()
    if media_key:
        match = (index.get("by_canonical") or {}).get(media_key)
        if isinstance(match, dict):
            return match

    try:
        year = int(item.get("year"))
    except (TypeError, ValueError):
        year = None
    if year is None:
        return None

    title_tokens = {
        _local_match_token(value)
        for value in (
            item.get("title"),
            item.get("original_title"),
            item.get("subtitle"),
        )
        if _local_match_token(value)
    }
    matches = []
    for token in title_tokens:
        match = (index.get("by_title_year") or {}).get(f"{year}:{token}")
        if isinstance(match, dict):
            matches.append(match)

    unique = {
        str(match.get("local_id") or ""): match
        for match in matches
        if match.get("local_id")
    }
    return next(iter(unique.values())) if len(unique) == 1 else None


async def _async_refresh_local_canonical_index(data):
    """Refresh the persisted Local index without changing the protected engines."""
    try:
        coordinator = data["coordinator"]
        settings = coordinator.settings or (coordinator.data or {}).get("settings") or {}
        debug_enabled = bool((settings.get("debug") or {}).get("enabled", False))
        local_settings = settings.get("local_library") or {}
        if debug_enabled:
            _PACKAGE_LOGGER.debug(
                "find_local_copy request: media_key=%s imdb_id=%s title=%s year=%s",
                (msg.get("item") or {}).get("media_key"),
                (msg.get("item") or {}).get("imdb_id"),
                (msg.get("item") or {}).get("title"),
                (msg.get("item") or {}).get("year"),
            )
        if not local_settings.get("enabled", False):
            await _persist_local_canonical_index(data["store"], [])
            return

        scanner = data["local_library"]
        result = scanner.last_result
        if not result.items and not result.errors:
            result = await scanner.async_scan(local_settings)
        if result.errors and not result.items:
            return

        await data["local_metadata"].async_enrich_local_items(
            result.items,
            settings.get("classification") or {},
        )
        await _persist_local_canonical_index(data["store"], result.items)
    except Exception:
        # The previous persisted index remains usable if a background refresh
        # temporarily fails (network/API unavailable, NAS not mounted, etc.).
        return


def _local_playback_payload(settings):
    players = settings.get("players") or {}
    playback = settings.get("playback") or {}
    local_settings = settings.get("local_library") or {}
    smb_base = str(local_settings.get("smb_base_uri") or "").strip()
    enabled = bool(
        playback.get("enabled", bool(players))
        and smb_base.lower().startswith("smb://")
    )
    destinations = []
    for player_id, player in players.items():
        if not isinstance(player, dict):
            continue
        if str(player.get("type") or "android_tv").casefold() != "android_tv":
            continue
        if not player.get("remote") or not player.get("adb_player"):
            continue
        destinations.append(
            {
                "id": str(player_id),
                "name": str(player.get("name") or player_id),
            }
        )
    return {
        "enabled": enabled,
        "mode": "vlc_smb",
        "players": destinations,
    }

def _register_ws(hass):
    if hass.data[DOMAIN].get("_ws_registered"):
        return

    @websocket_api.websocket_command(
        {vol.Required("type"): f"{DOMAIN}/get_data", vol.Optional("entry_id"): str}
    )
    @websocket_api.async_response
    async def get_data(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return
        payload = dict(data["coordinator"].data or {})
        public_settings = dict(payload.get("settings") or {})
        public_local = dict(public_settings.get("local_library") or {})
        public_local.pop("smb_username", None)
        public_local.pop("smb_password", None)
        public_settings["local_library"] = public_local
        payload["settings"] = public_settings
        store = data["store"]
        GenreMetadataExtension.attach_tree_from_store(store, payload)
        payload.update(
            {
                "watched_keys": list(store.watched_keys()),
                "watchlist_keys": list(store.watchlist_keys()),
                "not_interested_keys": list(store.not_interested_keys()),
                "watched": store.watched_items(),
                "watchlist": store.watchlist_items(),
                "not_interested": store.not_interested_items(),
                "playback_providers": sorted(SUPPORTED_PLAYBACK_PROVIDERS),
            }
        )
        GenreMetadataExtension.attach_tree_from_store(store, payload)
        connection.send_result(msg["id"], payload)

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/set_status",
            vol.Optional("entry_id"): str,
            vol.Required("key"): str,
            vol.Required("status"): vol.In(["watched", "watchlist", "not_interested"]),
            vol.Required("enabled"): bool,
            vol.Optional("item"): dict,
        }
    )
    @websocket_api.async_response
    async def set_status(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return
        store = data["store"]
        if msg["status"] == "watched":
            await store.async_set_watched(msg["key"], msg["enabled"], msg.get("item"))
            status_item = dict(msg.get("item") or {})
            if not status_item:
                status_item = {"media_key": msg["key"]}
            await data["watch_registry"].async_set_work(
                status_item,
                msg["enabled"],
                source="streaming",
                alias_key=msg["key"],
            )
        elif msg["status"] == "watchlist":
            await store.async_set_watchlist(msg["key"], msg["enabled"], msg.get("item"))
        else:
            await store.async_set_not_interested(msg["key"], msg["enabled"], msg.get("item"))

        # Watched / not-interested titles leave discovery globally. Refresh the
        # backend immediately so every enabled provider restores prefetch_count.
        if msg["status"] in ("watched", "not_interested"):
            await data["coordinator"].async_request_refresh()

        connection.send_result(
            msg["id"],
            {
                "watched_keys": list(store.watched_keys()),
                "watchlist_keys": list(store.watchlist_keys()),
                "not_interested_keys": list(store.not_interested_keys()),
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/enrich_item",
            vol.Optional("entry_id"): str,
            vol.Required("item"): dict,
        }
    )
    @websocket_api.async_response
    async def enrich_item(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return
        item = dict(msg.get("item") or {})
        settings = data["coordinator"].settings or (data["coordinator"].data or {}).get("settings") or {}
        classification = settings.get("classification") or {}
        if classification.get("enabled", True):
            object_id = item.get("jw_object_id")
            if object_id is None:
                key = str(item.get("media_key") or "")
                if key.startswith("jw:"):
                    try:
                        object_id = int(key.split(":", 1)[1])
                    except (TypeError, ValueError):
                        object_id = None
            try:
                age = await data["coordinator"].justwatch._async_age_certification(
                    object_id,
                    item.get("media_type"),
                    item.get("details_url"),
                    item.get("title"),
                    item.get("year"),
                )
                if age:
                    item["age_fr"] = age.get("fr")
                    item["age_us"] = age.get("us")
                    if age.get("imdb_id"):
                        item["imdb_id"] = age.get("imdb_id")
                    value, country = data["coordinator"].justwatch.select_age(age, classification)
                    item["age_certification"] = value
                    item["age_country"] = country
            except Exception:
                # Detail enrichment is optional: never prevent opening a popup.
                pass

        try:
            await data["coordinator"].justwatch.async_enrich_imdb_posters([item])
            key = str(item.get("media_key") or "").strip()
            if key:
                data["store"].merge_existing_item(key, item)
            await data["store"].async_save()
        except Exception:
            # IMDb poster enrichment is also optional; keep the JustWatch
            # fallback and never prevent opening a popup.
            pass

        connection.send_result(msg["id"], item)

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/get_family_catalog",
            vol.Optional("entry_id"): str,
            vol.Required("decade"): vol.Coerce(int),
            vol.Required("category"): vol.In(["movies", "animation", "series"]),
        }
    )
    @websocket_api.async_response
    async def get_family_catalog(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        coordinator = data["coordinator"]
        settings = coordinator.settings or (coordinator.data or {}).get("settings") or {}
        family = settings.get("family") or {}
        if not family.get("enabled", True):
            connection.send_error(msg["id"], "family_disabled", "La branche Famille est désactivée")
            return

        decade = str(msg.get("decade"))
        category = str(msg.get("category"))
        top_catalog = settings.get("top_catalog") or {}
        decade_cfg = (top_catalog.get("decades") or {}).get(decade) or {}
        if not decade_cfg.get("enabled", False):
            connection.send_error(msg["id"], "decade_disabled", f"Décennie {decade} désactivée")
            return
        if not decade_cfg.get(category, False) or not family.get(category, True):
            connection.send_error(
                msg["id"], "family_category_disabled", f"Catégorie Famille {category} désactivée"
            )
            return

        services = settings.get("services") or {}
        enabled = [
            provider for provider, is_enabled in services.items() if is_enabled
        ]
        try:
            result = await coordinator.justwatch.async_top_family_category(
                enabled,
                int(decade),
                category,
                int(decade_cfg.get("top_count") or 1),
                family,
                settings.get("classification") or {},
                top_catalog,
                excluded_keys=coordinator._excluded_keys(),
            )
        except Exception as err:
            connection.send_error(msg["id"], "family_catalog_error", str(err))
            return
        connection.send_result(msg["id"], result)

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/get_local_library",
            vol.Optional("entry_id"): str,
            vol.Optional("refresh", default=False): bool,
        }
    )
    @websocket_api.async_response
    async def get_local_library(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        settings = (
            data["coordinator"].settings
            or (data["coordinator"].data or {}).get("settings")
            or {}
        )
        local_settings = settings.get("local_library") or {}
        scanner = data["local_library"]

        if msg.get("refresh") or (
            local_settings.get("enabled", False)
            and not scanner.last_result.items
            and not scanner.last_result.errors
        ):
            result = await scanner.async_scan(local_settings)
        else:
            result = scanner.last_result

        items = await annotate_local_items(
            result.items,
            data["watch_registry"],
            settings.get("family") or {},
            settings.get("classification") or {},
        )

        GenreMetadataExtension.attach_tree_from_store(data["store"], items)
        enriched_count = sum(
            1 for item in items if item.get("metadata_status")
        )
        if not items or enriched_count:
            await _persist_local_canonical_index(data["store"], result.items)
        connection.send_result(
            msg["id"],
            {
                "enabled": bool(local_settings.get("enabled", False)),
                "root_path": local_settings.get("root_path") or "",
                "smb_base_uri": local_settings.get("smb_base_uri") or "",
                "count": len(items),
                "scan_revision": result.revision,
                "enriched_count": enriched_count,
                "metadata_complete": bool(items) and enriched_count == len(items),
                "family": dict(settings.get("family") or {}),
                "debug": dict(settings.get("debug") or {}),
                "duration_filter": dict(settings.get("duration_filter") or {}),
                "card_layout": dict(settings.get("card_layout") or {}),
                "local_playback": _local_playback_payload(settings),
                "items": items,
                "errors": list(result.errors),
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/enrich_local_library",
            vol.Optional("entry_id"): str,
        }
    )
    @websocket_api.async_response
    async def enrich_local_library(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        coordinator = data["coordinator"]
        settings = coordinator.settings or (coordinator.data or {}).get("settings") or {}
        local_settings = settings.get("local_library") or {}
        scanner = data["local_library"]

        if not local_settings.get("enabled", False):
            connection.send_error(
                msg["id"], "local_disabled", "Streaming Local est désactivé"
            )
            return

        result = scanner.last_result
        if not result.items and not result.errors:
            result = await scanner.async_scan(local_settings)

        if result.errors and not result.items:
            connection.send_result(
                msg["id"],
                {
                    "ok": False,
                    "count": 0,
                    "enriched_count": 0,
                    "metadata_complete": False,
                    "items": [],
                    "errors": list(result.errors),
                },
            )
            return

        source_revision = result.revision
        await data["local_metadata"].async_enrich_local_items(
            result.items,
            settings.get("classification") or {},
        )
        await _persist_local_canonical_index(data["store"], result.items)

        # A refresh may have completed while metadata enrichment was running.
        # Never send the old inventory back to the card in that case.
        current = scanner.last_result
        stale = current.revision != source_revision
        if stale:
            result = current

        items = await annotate_local_items(
            result.items,
            data["watch_registry"],
            settings.get("family") or {},
            settings.get("classification") or {},
        )

        GenreMetadataExtension.attach_tree_from_store(data["store"], items)
        enriched_count = sum(
            1 for item in items if item.get("metadata_status")
        )
        connection.send_result(
            msg["id"],
            {
                "ok": True,
                "enabled": True,
                "stale": stale,
                "count": len(items),
                "scan_revision": result.revision,
                "enriched_count": enriched_count,
                "metadata_complete": bool(items) and enriched_count == len(items),
                "family": dict(settings.get("family") or {}),
                "debug": dict(settings.get("debug") or {}),
                "duration_filter": dict(settings.get("duration_filter") or {}),
                "card_layout": dict(settings.get("card_layout") or {}),
                "local_playback": _local_playback_payload(settings),
                "items": items,
                "errors": list(result.errors),
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/get_runtimes",
            vol.Optional("entry_id"): str,
            vol.Required("items"): [dict],
        }
    )
    @websocket_api.async_response
    async def get_runtimes(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        settings = (
            data["coordinator"].settings
            or (data["coordinator"].data or {}).get("settings")
            or {}
        )
        duration = settings.get("duration_filter") or {}
        if not duration.get("enabled", True):
            connection.send_result(
                msg["id"],
                {
                    "enabled": False,
                    "max_minutes": int(duration.get("max_minutes") or 120),
                    "runtimes": {},
                },
            )
            return

        items = [
            dict(item)
            for item in (msg.get("items") or [])
            if isinstance(item, dict)
        ][:150]
        runtimes = await data["runtime_metadata"].async_resolve_many(items)
        connection.send_result(
            msg["id"],
            {
                "enabled": True,
                "max_minutes": int(duration.get("max_minutes") or 120),
                "runtimes": runtimes,
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/find_local_copy",
            vol.Optional("entry_id"): str,
            vol.Required("item"): dict,
        }
    )
    @websocket_api.async_response
    async def find_local_copy(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        settings = (
            data["coordinator"].settings
            or (data["coordinator"].data or {}).get("settings")
            or {}
        )
        debug_enabled = bool((settings.get("debug") or {}).get("enabled", False))
        local_settings = settings.get("local_library") or {}
        if not local_settings.get("enabled", False):
            connection.send_result(
                msg["id"],
                {
                    "match": None,
                    "local_playback": _local_playback_payload(settings),
                    "diagnostic": (
                        {
                            "local_enabled": False,
                            "streaming": dict(msg.get("item") or {}),
                            "index": {"available": False, "reason": "local_disabled"},
                        }
                        if debug_enabled
                        else None
                    ),
                },
            )
            return

        target_item = dict(msg.get("item") or {})
        index = data["store"].get_metadata(LOCAL_INDEX_METADATA_KEY) or {}
        match = _find_local_index_match(target_item, index)
        public_match = None
        if isinstance(match, dict):
            public_match = {
                "local_id": match.get("local_id"),
                "title": match.get("title") or match.get("parsed_title"),
                "year": match.get("year"),
                "imdb_id": match.get("imdb_id"),
                "canonical_media_key": match.get("canonical_media_key"),
            }

        streaming_imdb = str(target_item.get("imdb_id") or "").strip().casefold()
        streaming_media_key = str(target_item.get("media_key") or "").strip()
        try:
            streaming_year = int(target_item.get("year"))
        except (TypeError, ValueError):
            streaming_year = None
        streaming_tokens = sorted({
            _local_match_token(value)
            for value in (
                target_item.get("title"),
                target_item.get("original_title"),
                target_item.get("subtitle"),
            )
            if _local_match_token(value)
        })

        by_imdb = index.get("by_imdb") or {}
        by_canonical = index.get("by_canonical") or {}
        by_title_year = index.get("by_title_year") or {}
        year_candidates = []
        if streaming_year is not None:
            prefix = f"{streaming_year}:"
            seen_local_ids = set()
            for key, candidate in by_title_year.items():
                if not str(key).startswith(prefix) or not isinstance(candidate, dict):
                    continue
                local_id = str(candidate.get("local_id") or "")
                if not local_id or local_id in seen_local_ids:
                    continue
                seen_local_ids.add(local_id)
                year_candidates.append(
                    {
                        "key": key,
                        "local_id": candidate.get("local_id"),
                        "title": candidate.get("title"),
                        "year": candidate.get("year"),
                        "imdb_id": candidate.get("imdb_id"),
                        "canonical_media_key": candidate.get("canonical_media_key"),
                    }
                )
                if len(year_candidates) >= 12:
                    break

        diagnostic = {
            "local_enabled": True,
            "streaming": {
                "title": target_item.get("title"),
                "original_title": target_item.get("original_title"),
                "subtitle": target_item.get("subtitle"),
                "year": target_item.get("year"),
                "imdb_id": target_item.get("imdb_id"),
                "media_key": target_item.get("media_key"),
                "media_type": target_item.get("media_type"),
                "normalized_titles": streaming_tokens,
            },
            "index": {
                "available": bool(index),
                "schema": index.get("schema"),
                "imdb_count": len(by_imdb),
                "canonical_count": len(by_canonical),
                "title_year_count": len(by_title_year),
                "imdb_lookup": by_imdb.get(streaming_imdb) if streaming_imdb else None,
                "canonical_lookup": by_canonical.get(streaming_media_key) if streaming_media_key else None,
                "title_year_lookups": [
                    {
                        "key": f"{streaming_year}:{token}",
                        "match": by_title_year.get(f"{streaming_year}:{token}"),
                    }
                    for token in streaming_tokens
                    if streaming_year is not None
                ],
                "same_year_candidates": year_candidates,
            },
            "resolved_match": public_match,
        }

        if debug_enabled:
            _PACKAGE_LOGGER.debug(
                "find_local_copy result: media_key=%s match=%s",
                target_item.get("media_key"),
                public_match,
            )

        connection.send_result(
            msg["id"],
            {
                "match": public_match,
                "local_playback": _local_playback_payload(settings),
                "diagnostic": diagnostic if debug_enabled else None,
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/play_local",
            vol.Optional("entry_id"): str,
            vol.Required("local_id"): str,
            vol.Required("player"): str,
        }
    )
    @websocket_api.async_response
    async def play_local(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        settings = (
            data["coordinator"].settings
            or (data["coordinator"].data or {}).get("settings")
            or {}
        )
        players = settings.get("players") or {}
        playback = settings.get("playback") or {}
        if not bool(playback.get("enabled", bool(players))):
            connection.send_error(
                msg["id"],
                "playback_disabled",
                "Lecture directe désactivée dans la configuration.",
            )
            return

        player_id = str(msg.get("player") or "").strip()
        player = players.get(player_id)
        if not isinstance(player, dict):
            connection.send_error(
                msg["id"], "unknown_player", f"Destination inconnue : {player_id}"
            )
            return
        if str(player.get("type") or "android_tv").casefold() != "android_tv":
            connection.send_error(
                msg["id"],
                "unsupported_player_type",
                f"Type de destination non pris en charge : {player.get('type')}",
            )
            return
        if not player.get("remote") or not player.get("adb_player"):
            connection.send_error(
                msg["id"],
                "incomplete_player",
                "La destination doit définir remote et adb_player pour VLC.",
            )
            return

        local_settings = settings.get("local_library") or {}
        if not local_settings.get("enabled", False):
            connection.send_error(
                msg["id"], "local_disabled", "Streaming Local est désactivé"
            )
            return

        local_id = str(msg.get("local_id") or "").strip()
        scanner = data["local_library"]
        result = scanner.last_result
        if not result.items and not result.errors:
            result = await scanner.async_scan(local_settings)

        item = next(
            (
                candidate
                for candidate in result.items
                if str(candidate.get("local_id") or "") == local_id
            ),
            None,
        )
        if not isinstance(item, dict):
            connection.send_error(
                msg["id"], "unknown_local_item", "Fichier Local introuvable."
            )
            return

        smb_uri = str(item.get("smb_uri") or "").strip()
        smb_base = str(local_settings.get("smb_base_uri") or "").strip().rstrip("/")
        if (
            not smb_base.lower().startswith("smb://")
            or not smb_uri.lower().startswith("smb://")
            or not smb_uri.startswith(smb_base + "/")
        ):
            connection.send_error(
                msg["id"],
                "invalid_local_uri",
                "URI SMB du fichier invalide ou hors de la vidéothèque configurée.",
            )
            return

        auth_mode = str(local_settings.get("smb_auth_mode") or "vlc_saved").casefold()
        smb_username = None
        smb_password = None
        if auth_mode == "configured":
            smb_username = str(local_settings.get("smb_username") or "").strip()
            smb_password = str(local_settings.get("smb_password") or "")
            if not smb_username:
                connection.send_error(
                    msg["id"],
                    "missing_smb_credentials",
                    "Utilisateur SMB manquant dans la configuration Streaming Local.",
                )
                return

        task = hass.async_create_task(
            async_launch_vlc_local(
                hass,
                player,
                smb_uri,
                smb_username=smb_username,
                smb_password=smb_password,
            ),
            f"{DOMAIN}_vlc_{player_id}_{local_id[-8:]}",
        )
        task.add_done_callback(log_local_launch_failure)
        connection.send_result(
            msg["id"],
            {
                "ok": True,
                "player": player_id,
                "local_id": local_id,
                "app": "vlc",
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/set_local_watch_status",
            vol.Optional("entry_id"): str,
            vol.Required("items"): [dict],
            vol.Required("enabled"): bool,
        }
    )
    @websocket_api.async_response
    async def set_local_watch_status(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        items = [dict(item) for item in (msg.get("items") or []) if isinstance(item, dict)]
        if not items:
            connection.send_error(msg["id"], "empty_items", "Aucun média à mettre à jour")
            return

        registry = data["watch_registry"]
        episodic = [
            item
            for item in items
            if item.get("season") is not None and item.get("episode") is not None
        ]
        work_items = [item for item in items if item not in episodic]

        if episodic:
            await registry.async_set_episodes(
                episodic,
                msg["enabled"],
                source="local",
            )

        historical_changed = False
        for item in work_items:
            await registry.async_set_work(
                item,
                msg["enabled"],
                source="local",
                alias_key=str(item.get("media_key") or item.get("local_id") or ""),
            )
            historical_changed |= await sync_historical_work(
                data["store"],
                data["coordinator"],
                registry,
                item,
                msg["enabled"],
            )

        if historical_changed:
            await data["coordinator"].async_request_refresh()

        connection.send_result(
            msg["id"],
            {
                "ok": True,
                "enabled": bool(msg["enabled"]),
                "updated": len(items),
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/refresh_local_library",
            vol.Optional("entry_id"): str,
        }
    )
    @websocket_api.async_response
    async def refresh_local_library(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        settings = (
            data["coordinator"].settings
            or (data["coordinator"].data or {}).get("settings")
            or {}
        )
        result = await data["local_library"].async_scan(
            settings.get("local_library") or {}
        )
        connection.send_result(
            msg["id"],
            {
                "ok": not result.errors,
                "count": len(result.items),
                "scan_revision": result.revision,
                "errors": list(result.errors),
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/catalog_search",
            vol.Optional("entry_id"): str,
            vol.Required("query"): str,
            vol.Optional("media_type"): vol.In(["movie", "tv", "all"]),
            vol.Optional("limit"): int,
        }
    )
    @websocket_api.async_response
    async def catalog_search(hass, connection, msg):
        # Fork addition: search the full JustWatch France catalogue.
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return
        media_type = msg.get("media_type")
        try:
            items = await async_catalog_search(
                data["coordinator"].justwatch,
                msg["query"],
                None if media_type == "all" else media_type,
                msg.get("limit") or 24,
            )
        except Exception as err:  # noqa: BLE001
            _PACKAGE_LOGGER.warning("Streaming Top FR catalog search failed: %s", err)
            connection.send_error(msg["id"], "search_failed", f"Recherche impossible : {err}")
            return
        connection.send_result(msg["id"], {"query": msg["query"], "items": items})

    @websocket_api.websocket_command(
        {vol.Required("type"): f"{DOMAIN}/refresh", vol.Optional("entry_id"): str}
    )
    @websocket_api.async_response
    async def refresh(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return
        await data["coordinator"].async_request_refresh()
        connection.send_result(msg["id"], {"ok": True})

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/play",
            vol.Optional("entry_id"): str,
            vol.Required("provider"): str,
            vol.Required("player"): str,
            vol.Optional("content_id"): str,
            vol.Optional("watch_url"): str,
            vol.Optional("title"): str,
            vol.Optional("original_title"): str,
            vol.Optional("year"): vol.Any(str, int),
            vol.Optional("media_type"): str,
        }
    )
    @websocket_api.async_response
    async def play(hass, connection, msg):
        data = _entry_data(hass, msg.get("entry_id"))
        if not data:
            connection.send_error(msg["id"], "not_loaded", "Streaming Top FR not loaded")
            return

        provider = str(msg.get("provider") or "").strip()
        if provider not in SUPPORTED_PLAYBACK_PROVIDERS:
            connection.send_error(
                msg["id"],
                "unsupported_provider",
                f"Lecture automatisée non validée pour {provider}",
            )
            return

        settings = data["coordinator"].settings or (data["coordinator"].data or {}).get("settings") or {}
        players = settings.get("players") or {}
        playback = settings.get("playback") or {}
        playback_enabled = bool(
            playback.get("enabled", bool(players))
        )
        if not playback_enabled:
            connection.send_error(
                msg["id"],
                "playback_disabled",
                "Lecture directe désactivée dans la configuration.",
            )
            return
        player_id = str(msg.get("player") or "").strip()
        player = players.get(player_id)
        if not isinstance(player, dict):
            connection.send_error(
                msg["id"], "unknown_player", f"Destination inconnue : {player_id}"
            )
            return

        if str(player.get("type") or "android_tv").casefold() != "android_tv":
            connection.send_error(
                msg["id"],
                "unsupported_player_type",
                f"Type de destination non pris en charge : {player.get('type')}",
            )
            return
        if not player.get("remote") or (
            provider != "stremio" and not player.get("adb_player")
        ):
            connection.send_error(
                msg["id"],
                "incomplete_player",
                "La destination doit définir remote et adb_player pour les lancements Android TV.",
            )
            return

        content_id = msg.get("content_id")
        watch_url = msg.get("watch_url")

        # Disney+ uses different entity UUIDs for some regional catalogues.
        # Resolve the current French entity at launch time instead of trusting
        # the generic JustWatch deep link. The resolver uses only a short-lived
        # technical cache and revalidates from Disney's French public catalogue.
        if provider == "disney":
            resolved = await data["coordinator"].justwatch.async_resolve_disney_fr(
                msg.get("title"),
                msg.get("original_title"),
                msg.get("year"),
                msg.get("media_type"),
                watch_url,
            )
            if not resolved:
                connection.send_error(
                    msg["id"],
                    "disney_fr_unresolved",
                    "Impossible de résoudre de façon sûre la fiche Disney+ France pour ce titre.",
                )
                return
            content_id = resolved.get("playback_id")
            watch_url = resolved.get("watch_url")

        if provider == "stremio":
            # Fork addition: content_id carries the IMDb id and watch_url the
            # media type, so the historical launch signature stays unchanged.
            watch_url = msg.get("media_type")

        task = hass.async_create_task(
            async_launch(hass, provider, player, content_id, watch_url),
            f"{DOMAIN}_play_{provider}_{player_id}",
        )
        task.add_done_callback(log_launch_failure)
        connection.send_result(
            msg["id"],
            {
                "ok": True,
                "provider": provider,
                "player": player_id,
                "media_player": player.get("media_player"),
            },
        )

    websocket_api.async_register_command(hass, get_data)
    websocket_api.async_register_command(hass, set_status)
    websocket_api.async_register_command(hass, enrich_item)
    websocket_api.async_register_command(hass, get_family_catalog)
    websocket_api.async_register_command(hass, get_local_library)
    websocket_api.async_register_command(hass, enrich_local_library)
    websocket_api.async_register_command(hass, get_runtimes)
    websocket_api.async_register_command(hass, find_local_copy)
    websocket_api.async_register_command(hass, play_local)
    websocket_api.async_register_command(hass, set_local_watch_status)
    websocket_api.async_register_command(hass, refresh_local_library)
    websocket_api.async_register_command(hass, refresh)
    websocket_api.async_register_command(hass, play)
    websocket_api.async_register_command(hass, catalog_search)
    hass.data[DOMAIN]["_ws_registered"] = True

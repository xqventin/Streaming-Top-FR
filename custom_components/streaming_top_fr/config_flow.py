from __future__ import annotations

from copy import deepcopy
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult, OptionsFlowWithReload
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.selector import SelectOptionDict

from .const import (
    CONF_UPDATE_HOURS,
    DEFAULT_UPDATE_HOURS,
    DOMAIN,
    PROVIDER_NAMES,
    SUPPORTED_PROVIDERS,
)
from .settings import (
    DEFAULT_SETTINGS,
    DEFAULT_TOP_CATALOG,
    async_load_legacy_settings,
    normalize_settings,
)

CONF_SETTINGS = "settings"

FIELD_TOP_ENABLED = "top_enabled"
FIELD_MIN_IMDB_VOTES = "min_imdb_votes"
FIELD_EXCLUDE_SHORT = "exclude_short_films"
FIELD_DEFAULT_DECADE = "default_decade"
FIELD_ENABLED_DECADES = "enabled_decades"
FIELD_FAMILY_ENABLED = "family_enabled"
FIELD_TARGET_AGE = "target_age"
FIELD_ALLOW_UNRATED = "allow_unrated"
FIELD_FAMILY_MOVIES = "family_movies"
FIELD_FAMILY_ANIMATION = "family_animation"
FIELD_FAMILY_SERIES = "family_series"
FIELD_CLASSIFICATION_ENABLED = "classification_enabled"
FIELD_CLASSIFICATION_FRANCE = "classification_france"
FIELD_US_FALLBACK = "us_fallback"
FIELD_US_TV = "us_tv"
FIELD_VISIBLE_COUNT = "visible_count"
FIELD_PREFETCH_COUNT = "prefetch_count"
FIELD_MAX_DEPTH = "max_depth"
FIELD_DURATION_FILTER_ENABLED = "duration_filter_enabled"
FIELD_DURATION_FILTER_MAX_MINUTES = "duration_filter_max_minutes"
FIELD_LAYOUT_ROWS_SMALL = "layout_rows_small"
FIELD_LAYOUT_ROWS_MEDIUM = "layout_rows_medium"
FIELD_LAYOUT_ROWS_LARGE = "layout_rows_large"
FIELD_LAYOUT_POSTERS_PER_BATCH = "posters_par_lot"
FIELD_LAYOUT_INFINITE_SCROLL = "scroll_infini"
FIELD_DEBUG_ENABLED = "debug_enabled"
FIELD_PLAYBACK_ENABLED = "playback_enabled"
FIELD_PLAYER_SELECT = "player_select"
FIELD_PLAYER_ID = "player_id"
FIELD_PLAYER_NAME = "player_name"
FIELD_PLAYER_MEDIA = "player_media_player"
FIELD_PLAYER_REMOTE = "player_remote"
FIELD_PLAYER_ADB = "player_adb_player"
FIELD_ADD_ANOTHER = "add_another"
FIELD_DELETE_PLAYER = "delete_player"
FIELD_LOCAL_ENABLED = "local_enabled"
FIELD_LOCAL_SMB = "local_smb_base_uri"
FIELD_LOCAL_AUTH_MODE = "local_smb_auth_mode"
FIELD_LOCAL_USERNAME = "local_smb_username"
FIELD_LOCAL_PASSWORD = "local_smb_password"
FIELD_LOCAL_EXTENSIONS = "local_extensions"
FIELD_LOCAL_SCAN_HIDDEN = "local_scan_hidden"
FIELD_LOCAL_MOVIES_FOLDERS = "local_movies_folders"
FIELD_LOCAL_SERIES_FOLDERS = "local_series_folders"
FIELD_LOCAL_ANIMATION_FOLDERS = "local_animation_folders"
FIELD_LOCAL_DOCUMENTARIES_FOLDERS = "local_documentaries_folders"


def _number(minimum: int, maximum: int, step: int = 1) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=minimum,
            max=maximum,
            step=step,
            mode=selector.NumberSelectorMode.BOX,
        )
    )


def _entity(domain: str) -> selector.EntitySelector:
    return selector.EntitySelector(selector.EntitySelectorConfig(domain=domain))


def _service_schema(settings: dict[str, Any]) -> vol.Schema:
    current = settings.get("services") or {}
    return vol.Schema(
        {
            vol.Optional(
                f"service_{provider}",
                default=bool(current.get(provider, False)),
            ): selector.BooleanSelector()
            for provider in SUPPORTED_PROVIDERS
        }
    )


def _apply_services(settings: dict[str, Any], user_input: dict[str, Any]) -> None:
    settings["services"] = {
        provider: bool(user_input.get(f"service_{provider}", False))
        for provider in SUPPORTED_PROVIDERS
    }


def _discovery_schema(settings: dict[str, Any]) -> vol.Schema:
    discovery = settings.get("discovery") or {}
    return vol.Schema(
        {
            vol.Required(
                FIELD_VISIBLE_COUNT,
                default=int(discovery.get("visible_count", 10)),
            ): _number(1, 100),
            vol.Required(
                FIELD_PREFETCH_COUNT,
                default=int(discovery.get("prefetch_count", 20)),
            ): _number(1, 100),
            vol.Required(
                FIELD_MAX_DEPTH,
                default=int(discovery.get("max_depth", 100)),
            ): _number(1, 100),
        }
    )


def _apply_discovery(settings: dict[str, Any], user_input: dict[str, Any]) -> None:
    visible = int(user_input[FIELD_VISIBLE_COUNT])
    prefetch = max(visible, int(user_input[FIELD_PREFETCH_COUNT]))
    max_depth = max(prefetch, int(user_input[FIELD_MAX_DEPTH]))
    settings["discovery"] = {
        "visible_count": visible,
        "prefetch_count": prefetch,
        "max_depth": max_depth,
    }

def _duration_filter_schema(settings: dict[str, Any]) -> vol.Schema:
    duration = settings.get("duration_filter") or {}
    return vol.Schema(
        {
            vol.Optional(
                FIELD_DURATION_FILTER_ENABLED,
                default=bool(duration.get("enabled", True)),
            ): selector.BooleanSelector(),
            vol.Required(
                FIELD_DURATION_FILTER_MAX_MINUTES,
                default=int(duration.get("max_minutes", 120)),
            ): _number(30, 360, 15),
        }
    )


def _apply_duration_filter(
    settings: dict[str, Any], user_input: dict[str, Any]
) -> None:
    settings["duration_filter"] = {
        "enabled": bool(user_input.get(FIELD_DURATION_FILTER_ENABLED, False)),
        "max_minutes": int(user_input[FIELD_DURATION_FILTER_MAX_MINUTES]),
    }


def _card_layout_schema(settings: dict[str, Any]) -> vol.Schema:
    layout = settings.get("card_layout") or {}
    return vol.Schema(
        {
            vol.Required(
                FIELD_LAYOUT_ROWS_SMALL,
                default=int(layout.get("rows_small", 2)),
            ): _number(1, 6),
            vol.Required(
                FIELD_LAYOUT_ROWS_MEDIUM,
                default=int(layout.get("rows_medium", 2)),
            ): _number(1, 6),
            vol.Required(
                FIELD_LAYOUT_ROWS_LARGE,
                default=int(layout.get("rows_large", 3)),
            ): _number(1, 6),
            vol.Required(
                FIELD_LAYOUT_POSTERS_PER_BATCH,
                default=int(layout.get("posters_par_lot", 8)),
            ): _number(1, 50),
            vol.Optional(
                FIELD_LAYOUT_INFINITE_SCROLL,
                default=bool(layout.get("scroll_infini", False)),
            ): selector.BooleanSelector(),
        }
    )


def _apply_card_layout(
    settings: dict[str, Any], user_input: dict[str, Any]
) -> None:
    settings["card_layout"] = {
        "rows_small": int(user_input[FIELD_LAYOUT_ROWS_SMALL]),
        "rows_medium": int(user_input[FIELD_LAYOUT_ROWS_MEDIUM]),
        "rows_large": int(user_input[FIELD_LAYOUT_ROWS_LARGE]),
        "posters_par_lot": int(user_input[FIELD_LAYOUT_POSTERS_PER_BATCH]),
        "scroll_infini": bool(user_input.get(FIELD_LAYOUT_INFINITE_SCROLL, False)),
    }


def _debug_schema(settings: dict[str, Any]) -> vol.Schema:
    debug = settings.get("debug") or {}
    return vol.Schema(
        {
            vol.Optional(
                FIELD_DEBUG_ENABLED,
                default=bool(debug.get("enabled", False)),
            ): selector.BooleanSelector(),
        }
    )


def _apply_debug(settings: dict[str, Any], user_input: dict[str, Any]) -> None:
    settings["debug"] = {
        "enabled": bool(user_input.get(FIELD_DEBUG_ENABLED, False)),
    }


def _local_library_schema(settings: dict[str, Any]) -> vol.Schema:
    local = settings.get("local_library") or {}
    extensions = local.get("extensions") or [
        "mkv", "avi", "mp4", "m4v", "ts", "m2ts", "mov", "wmv"
    ]
    return vol.Schema(
        {
            vol.Optional(
                FIELD_LOCAL_ENABLED,
                default=bool(local.get("enabled", False)),
            ): selector.BooleanSelector(),
            vol.Required(
                FIELD_LOCAL_SMB,
                default=str(local.get("smb_base_uri") or ""),
            ): selector.TextSelector(),
            vol.Required(
                FIELD_LOCAL_AUTH_MODE,
                default=str(local.get("smb_auth_mode") or "configured"),
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[
                        SelectOptionDict(value="vlc_saved", label="VLC — identifiants mémorisés"),
                        SelectOptionDict(value="configured", label="Streaming Top FR — identifiants configurés"),
                    ],
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Optional(
                FIELD_LOCAL_USERNAME,
                default=str(local.get("smb_username") or ""),
            ): selector.TextSelector(),
            vol.Optional(
                FIELD_LOCAL_PASSWORD,
                default=str(local.get("smb_password") or ""),
            ): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
            ),
            vol.Required(
                FIELD_LOCAL_EXTENSIONS,
                default=", ".join(str(value) for value in extensions),
            ): selector.TextSelector(),
            vol.Required(
                FIELD_LOCAL_MOVIES_FOLDERS,
                default=", ".join((local.get("category_folders") or {}).get("movies") or ["Films"]),
            ): selector.TextSelector(),
            vol.Required(
                FIELD_LOCAL_SERIES_FOLDERS,
                default=", ".join((local.get("category_folders") or {}).get("series") or ["Series", "Séries"]),
            ): selector.TextSelector(),
            vol.Required(
                FIELD_LOCAL_ANIMATION_FOLDERS,
                default=", ".join((local.get("category_folders") or {}).get("animation") or ["Animation", "Animations", "Dessins Animés"]),
            ): selector.TextSelector(),
            vol.Required(
                FIELD_LOCAL_DOCUMENTARIES_FOLDERS,
                default=", ".join((local.get("category_folders") or {}).get("documentaries") or ["Documentaires", "Documentaries"]),
            ): selector.TextSelector(),
            vol.Optional(
                FIELD_LOCAL_SCAN_HIDDEN,
                default=bool(local.get("scan_hidden", False)),
            ): selector.BooleanSelector(),
        }
    )


def _apply_local_library(
    settings: dict[str, Any], user_input: dict[str, Any]
) -> None:
    extensions = [
        value.strip().lstrip(".").lower()
        for value in str(user_input.get(FIELD_LOCAL_EXTENSIONS) or "").split(",")
        if value.strip()
    ]
    def _folders(field: str, fallback: list[str]) -> list[str]:
        values = [
            value.strip()
            for value in str(user_input.get(field) or "").split(",")
            if value.strip()
        ]
        return values or fallback

    existing_local = settings.get("local_library") or {}
    settings["local_library"] = {
        "enabled": bool(user_input.get(FIELD_LOCAL_ENABLED, False)),
        # Internal scanner path: keep the previously configured/migrated value.
        # It is intentionally no longer exposed in the Options Flow.
        "root_path": str(existing_local.get("root_path") or "").strip(),
        "smb_base_uri": str(user_input.get(FIELD_LOCAL_SMB) or "").strip().rstrip("/"),
        "smb_auth_mode": str(user_input.get(FIELD_LOCAL_AUTH_MODE) or "configured"),
        "smb_username": str(user_input.get(FIELD_LOCAL_USERNAME) or "").strip(),
        "smb_password": str(user_input.get(FIELD_LOCAL_PASSWORD) or ""),
        "extensions": extensions
        or ["mkv", "avi", "mp4", "m4v", "ts", "m2ts", "mov", "wmv"],
        "category_folders": {
            "movies": _folders(FIELD_LOCAL_MOVIES_FOLDERS, ["Films"]),
            "series": _folders(FIELD_LOCAL_SERIES_FOLDERS, ["Series", "Séries"]),
            "animation": _folders(
                FIELD_LOCAL_ANIMATION_FOLDERS,
                ["Animation", "Animations", "Dessins Animés"],
            ),
            "documentaries": _folders(
                FIELD_LOCAL_DOCUMENTARIES_FOLDERS,
                ["Documentaires", "Documentaries"],
            ),
        },
        "scan_hidden": bool(user_input.get(FIELD_LOCAL_SCAN_HIDDEN, False)),
    }



def _top_schema(settings: dict[str, Any]) -> vol.Schema:
    top = settings.get("top_catalog") or {}
    return vol.Schema(
        {
            vol.Optional(
                FIELD_TOP_ENABLED,
                default=bool(top.get("enabled", True)),
            ): selector.BooleanSelector(),
            vol.Required(
                FIELD_MIN_IMDB_VOTES,
                default=int(top.get("min_imdb_votes", 20000)),
            ): _number(0, 10_000_000, 1000),
            vol.Optional(
                FIELD_EXCLUDE_SHORT,
                default=bool(top.get("exclude_short_films", True)),
            ): selector.BooleanSelector(),
        }
    )


def _apply_top(settings: dict[str, Any], user_input: dict[str, Any]) -> None:
    top = settings.setdefault("top_catalog", deepcopy(DEFAULT_TOP_CATALOG))
    top["enabled"] = bool(user_input.get(FIELD_TOP_ENABLED, True))
    top["min_imdb_votes"] = int(user_input[FIELD_MIN_IMDB_VOTES])
    top["exclude_short_films"] = bool(user_input.get(FIELD_EXCLUDE_SHORT, True))


def _decades_schema(settings: dict[str, Any]) -> vol.Schema:
    top = settings.get("top_catalog") or {}
    decades = top.get("decades") or {}
    selected = [
        decade
        for decade in DEFAULT_TOP_CATALOG["decades"]
        if (decades.get(decade) or {}).get("enabled", False)
    ]
    options = [
        SelectOptionDict(value=decade, label=f"{decade}s")
        for decade in DEFAULT_TOP_CATALOG["decades"]
    ]
    default_decade = str(
        top.get(FIELD_DEFAULT_DECADE, DEFAULT_TOP_CATALOG["default_decade"])
    )
    if default_decade not in DEFAULT_TOP_CATALOG["decades"]:
        default_decade = DEFAULT_TOP_CATALOG["default_decade"]

    return vol.Schema(
        {
            vol.Required(
                FIELD_DEFAULT_DECADE,
                default=default_decade,
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=options,
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Required(
                FIELD_ENABLED_DECADES,
                default=selected,
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=options,
                    multiple=True,
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            ),
        }
    )


def _apply_enabled_decades(
    settings: dict[str, Any], user_input: dict[str, Any]
) -> None:
    top = settings.setdefault("top_catalog", deepcopy(DEFAULT_TOP_CATALOG))
    default_decade = str(
        user_input.get(FIELD_DEFAULT_DECADE, DEFAULT_TOP_CATALOG["default_decade"])
    )
    if default_decade not in DEFAULT_TOP_CATALOG["decades"]:
        default_decade = DEFAULT_TOP_CATALOG["default_decade"]

    selected = {str(value) for value in user_input.get(FIELD_ENABLED_DECADES, [])}
    # A default decade must always remain available in the Top Streaming card.
    selected.add(default_decade)
    top[FIELD_DEFAULT_DECADE] = default_decade

    decades = top.setdefault("decades", deepcopy(DEFAULT_TOP_CATALOG["decades"]))
    for decade, defaults in DEFAULT_TOP_CATALOG["decades"].items():
        current = decades.setdefault(decade, deepcopy(defaults))
        current["enabled"] = decade in selected


def _family_schema(settings: dict[str, Any]) -> vol.Schema:
    family = settings.get("family") or {}
    return vol.Schema(
        {
            vol.Optional(
                FIELD_FAMILY_ENABLED,
                default=bool(family.get("enabled", True)),
            ): selector.BooleanSelector(),
            vol.Required(
                FIELD_TARGET_AGE,
                default=int(family.get("target_age", 11)),
            ): _number(0, 17),
            vol.Optional(
                FIELD_ALLOW_UNRATED,
                default=bool(family.get("allow_unrated", False)),
            ): selector.BooleanSelector(),
            vol.Optional(
                FIELD_FAMILY_MOVIES,
                default=bool(family.get("movies", True)),
            ): selector.BooleanSelector(),
            vol.Optional(
                FIELD_FAMILY_ANIMATION,
                default=bool(family.get("animation", True)),
            ): selector.BooleanSelector(),
            vol.Optional(
                FIELD_FAMILY_SERIES,
                default=bool(family.get("series", True)),
            ): selector.BooleanSelector(),
        }
    )


def _apply_family(settings: dict[str, Any], user_input: dict[str, Any]) -> None:
    settings["family"] = {
        "enabled": bool(user_input.get(FIELD_FAMILY_ENABLED, True)),
        "target_age": int(user_input[FIELD_TARGET_AGE]),
        "allow_unrated": bool(user_input.get(FIELD_ALLOW_UNRATED, False)),
        "movies": bool(user_input.get(FIELD_FAMILY_MOVIES, True)),
        "animation": bool(user_input.get(FIELD_FAMILY_ANIMATION, True)),
        "series": bool(user_input.get(FIELD_FAMILY_SERIES, True)),
    }


def _classification_schema(settings: dict[str, Any]) -> vol.Schema:
    classification = settings.get("classification") or {}
    return vol.Schema(
        {
            vol.Optional(
                FIELD_CLASSIFICATION_ENABLED,
                default=bool(classification.get("enabled", True)),
            ): selector.BooleanSelector(),
            vol.Optional(
                FIELD_CLASSIFICATION_FRANCE,
                default=bool(classification.get("france", True)),
            ): selector.BooleanSelector(),
            vol.Optional(
                FIELD_US_FALLBACK,
                default=bool(classification.get("us_fallback", True)),
            ): selector.BooleanSelector(),
            vol.Optional(
                FIELD_US_TV,
                default=bool(classification.get("us_tv", True)),
            ): selector.BooleanSelector(),
        }
    )


def _apply_classification(
    settings: dict[str, Any], user_input: dict[str, Any]
) -> None:
    settings["classification"] = {
        "enabled": bool(user_input.get(FIELD_CLASSIFICATION_ENABLED, True)),
        "france": bool(user_input.get(FIELD_CLASSIFICATION_FRANCE, True)),
        "us_fallback": bool(user_input.get(FIELD_US_FALLBACK, True)),
        "us_tv": bool(user_input.get(FIELD_US_TV, True)),
    }


def _decade_edit_schema(settings: dict[str, Any], decade: str) -> vol.Schema:
    cfg = (
        ((settings.get("top_catalog") or {}).get("decades") or {}).get(decade)
        or DEFAULT_TOP_CATALOG["decades"][decade]
    )
    return vol.Schema(
        {
            vol.Optional(
                "enabled", default=bool(cfg.get("enabled", False))
            ): selector.BooleanSelector(),
            vol.Required(
                "top_count", default=int(cfg.get("top_count", 10))
            ): _number(1, 100),
            vol.Optional(
                "movies", default=bool(cfg.get("movies", True))
            ): selector.BooleanSelector(),
            vol.Optional(
                "animation", default=bool(cfg.get("animation", True))
            ): selector.BooleanSelector(),
            vol.Optional(
                "series", default=bool(cfg.get("series", True))
            ): selector.BooleanSelector(),
        }
    )


def _player_schema(
    current: dict[str, Any] | None = None,
    *,
    player_id: str = "",
    include_add_another: bool = False,
    include_delete: bool = False,
) -> vol.Schema:
    current = current or {}
    schema: dict[Any, Any] = {
        vol.Required(FIELD_PLAYER_ID, default=player_id): selector.TextSelector(),
        vol.Required(
            FIELD_PLAYER_NAME,
            default=str(current.get("name") or player_id or "Salon"),
        ): selector.TextSelector(),
    }

    for field, domain, value in (
        (FIELD_PLAYER_MEDIA, "media_player", current.get("media_player")),
        (FIELD_PLAYER_REMOTE, "remote", current.get("remote")),
        (FIELD_PLAYER_ADB, "media_player", current.get("adb_player")),
    ):
        # Fork: ADB is optional (only Netflix / Disney+ / Prime need it;
        # Stremio works with the Android TV Remote entity alone).
        factory = vol.Optional if field == FIELD_PLAYER_ADB else vol.Required
        marker = factory(field, default=value) if value else factory(field)
        schema[marker] = _entity(domain)

    if include_add_another:
        schema[vol.Optional(FIELD_ADD_ANOTHER, default=False)] = selector.BooleanSelector()
    if include_delete:
        schema[vol.Optional(FIELD_DELETE_PLAYER, default=False)] = selector.BooleanSelector()
    return vol.Schema(schema)



def _status(value: Any) -> str:
    return "✅" if bool(value) else "❌"


def _summary_placeholders(
    settings: dict[str, Any], update_hours: int
) -> dict[str, str]:
    services = settings.get("services") or {}
    enabled_services = [
        PROVIDER_NAMES.get(provider, provider)
        for provider in SUPPORTED_PROVIDERS
        if services.get(provider, False)
    ]

    discovery = settings.get("discovery") or {}
    top = settings.get("top_catalog") or {}
    decades = top.get("decades") or {}
    enabled_decades = []
    for decade in DEFAULT_TOP_CATALOG["decades"]:
        cfg = decades.get(decade) or {}
        if cfg.get("enabled", False):
            categories = "".join(
                symbol
                for enabled, symbol in (
                    (cfg.get("movies", True), "🎬"),
                    (cfg.get("animation", True), "✨"),
                    (cfg.get("series", True), "📺"),
                )
                if enabled
            )
            enabled_decades.append(
                f"{decade}s: {int(cfg.get('top_count', 10))} {categories}".strip()
            )

    family = settings.get("family") or {}
    classification = settings.get("classification") or {}
    duration_filter = settings.get("duration_filter") or {}
    card_layout = settings.get("card_layout") or {}
    debug = settings.get("debug") or {}
    local_library = settings.get("local_library") or {}
    local_enabled = bool(local_library.get("enabled", False))
    local_auth_mode = str(local_library.get("smb_auth_mode") or "configured").casefold()
    local_auth_label = "Streaming Top FR" if local_auth_mode == "configured" else "VLC"
    playback = settings.get("playback") or {}
    players = settings.get("players") or {}
    player_names = [
        str(player.get("name") or player_id)
        for player_id, player in players.items()
        if isinstance(player, dict)
    ]

    return {
        "update_hours": str(update_hours),
        "services": ", ".join(enabled_services) if enabled_services else "—",
        "visible_count": str(int(discovery.get("visible_count", 10))),
        "prefetch_count": str(int(discovery.get("prefetch_count", 20))),
        "max_depth": str(int(discovery.get("max_depth", 100))),
        "top_enabled": _status(top.get("enabled", True)),
        "default_decade": str(
            top.get("default_decade", DEFAULT_TOP_CATALOG["default_decade"])
        ),
        "min_imdb_votes": f"{int(top.get('min_imdb_votes', 20000)):,}".replace(",", " "),
        "exclude_short_films": _status(top.get("exclude_short_films", True)),
        "decades": " · ".join(enabled_decades) if enabled_decades else "—",
        "family_enabled": _status(family.get("enabled", True)),
        "target_age": str(int(family.get("target_age", 11))),
        "allow_unrated": _status(family.get("allow_unrated", False)),
        "family_movies": _status(family.get("movies", True)),
        "family_animation": _status(family.get("animation", True)),
        "family_series": _status(family.get("series", True)),
        "classification_enabled": _status(classification.get("enabled", True)),
        "classification_france": _status(classification.get("france", True)),
        "us_fallback": _status(classification.get("us_fallback", True)),
        "us_tv": _status(classification.get("us_tv", True)),
        "duration_filter_enabled": _status(duration_filter.get("enabled", True)),
        "duration_filter_max_minutes": str(int(duration_filter.get("max_minutes", 120))),
        "layout_rows_small": str(int(card_layout.get("rows_small", 2))),
        "layout_rows_medium": str(int(card_layout.get("rows_medium", 2))),
        "layout_rows_large": str(int(card_layout.get("rows_large", 3))),
        "layout_posters_per_batch": str(int(card_layout.get("posters_par_lot", 8))),
        "layout_infinite_scroll": _status(card_layout.get("scroll_infini", False)),
        "debug_enabled": _status(debug.get("enabled", False)),
        "local_enabled": _status(local_enabled),
        "local_auth_mode": local_auth_label if local_enabled else "—",
        "local_smb_base_uri": str(local_library.get("smb_base_uri") or "—") if local_enabled else "—",
        "playback_enabled": _status(
            playback.get("enabled", bool(player_names))
        ),
        "players": ", ".join(player_names) if player_names else "—",
        "player_count": str(len(player_names)),
    }


class StreamingTopFrConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure Streaming Top FR."""

    VERSION = 1
    MINOR_VERSION = 1

    def __init__(self) -> None:
        self._settings: dict[str, Any] | None = None
        self._update_hours = DEFAULT_UPDATE_HOURS
        self._player_counter = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> StreamingTopFrOptionsFlow:
        return StreamingTopFrOptionsFlow()

    async def _ensure_settings(self) -> None:
        if self._settings is None:
            self._settings = await async_load_legacy_settings(self.hass)

    def _finish(self) -> ConfigFlowResult:
        assert self._settings is not None
        return self.async_create_entry(
            title="Streaming Top FR",
            data={},
            options={
                CONF_UPDATE_HOURS: self._update_hours,
                CONF_SETTINGS: normalize_settings(self._settings),
            },
        )

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Initial setup."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        await self._ensure_settings()

        if user_input is not None:
            self._update_hours = int(user_input[CONF_UPDATE_HOURS])
            return await self.async_step_services()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_UPDATE_HOURS,
                        default=self._update_hours,
                    ): _number(2, 168),
                }
            ),
        )

    async def async_step_services(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        assert self._settings is not None
        if user_input is not None:
            _apply_services(self._settings, user_input)
            return await self.async_step_discovery()
        return self.async_show_form(
            step_id="services",
            data_schema=_service_schema(self._settings),
        )

    async def async_step_discovery(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        assert self._settings is not None
        if user_input is not None:
            _apply_discovery(self._settings, user_input)
            return await self.async_step_top_catalog()
        return self.async_show_form(
            step_id="discovery",
            data_schema=_discovery_schema(self._settings),
        )

    async def async_step_top_catalog(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        assert self._settings is not None
        if user_input is not None:
            _apply_top(self._settings, user_input)
            return await self.async_step_decades()
        return self.async_show_form(
            step_id="top_catalog",
            data_schema=_top_schema(self._settings),
        )

    async def async_step_decades(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        assert self._settings is not None
        if user_input is not None:
            _apply_enabled_decades(self._settings, user_input)
            return await self.async_step_family()
        return self.async_show_form(
            step_id="decades",
            data_schema=_decades_schema(self._settings),
        )

    async def async_step_family(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        assert self._settings is not None
        if user_input is not None:
            _apply_family(self._settings, user_input)
            return await self.async_step_classification()
        return self.async_show_form(
            step_id="family",
            data_schema=_family_schema(self._settings),
        )

    async def async_step_classification(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        assert self._settings is not None
        if user_input is not None:
            _apply_classification(self._settings, user_input)
            return await self.async_step_playback()
        return self.async_show_form(
            step_id="classification",
            data_schema=_classification_schema(self._settings),
        )

    async def async_step_playback(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        assert self._settings is not None
        players = self._settings.get("players") or {}
        playback = self._settings.setdefault(
            "playback", {"enabled": bool(players)}
        )

        if user_input is not None:
            enabled = bool(user_input.get(FIELD_PLAYBACK_ENABLED, False))
            playback["enabled"] = enabled
            if not enabled or players:
                return self._finish()
            return await self.async_step_player()

        return self.async_show_form(
            step_id="playback",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        FIELD_PLAYBACK_ENABLED,
                        default=bool(playback.get("enabled", bool(players))),
                    ): selector.BooleanSelector()
                }
            ),
        )

    async def async_step_player(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        assert self._settings is not None
        players = self._settings.setdefault("players", {})
        errors: dict[str, str] = {}

        if user_input is not None:
            player_id = (
                str(user_input[FIELD_PLAYER_ID]).strip().casefold().replace(" ", "_")
            )
            if not player_id:
                errors[FIELD_PLAYER_ID] = "invalid_player_id"
            elif player_id in players:
                errors[FIELD_PLAYER_ID] = "player_already_exists"
            else:
                players[player_id] = {
                    "name": str(user_input[FIELD_PLAYER_NAME]).strip() or player_id,
                    "type": "android_tv",
                    "media_player": user_input[FIELD_PLAYER_MEDIA],
                    "remote": user_input[FIELD_PLAYER_REMOTE],
                    "adb_player": user_input.get(FIELD_PLAYER_ADB) or "",
                }
                if user_input.get(FIELD_ADD_ANOTHER, False):
                    self._player_counter += 1
                    return await self.async_step_player()
                return self._finish()

        return self.async_show_form(
            step_id="player",
            data_schema=_player_schema(
                player_id=f"player_{self._player_counter}",
                include_add_another=True,
            ),
            errors=errors,
        )


class StreamingTopFrOptionsFlow(OptionsFlowWithReload):
    """Manage Streaming Top FR options."""

    def __init__(self) -> None:
        self._settings: dict[str, Any] | None = None
        self._update_hours = DEFAULT_UPDATE_HOURS
        self._selected_decade: str | None = None
        self._selected_player: str | None = None

    def _ensure_loaded(self) -> None:
        if self._settings is not None:
            return
        options = dict(self.config_entry.options)
        raw_settings = options.get(CONF_SETTINGS) or self.config_entry.data.get(
            CONF_SETTINGS
        )
        self._settings = normalize_settings(raw_settings or DEFAULT_SETTINGS)
        self._update_hours = int(
            options.get(
                CONF_UPDATE_HOURS,
                self.config_entry.data.get(
                    CONF_UPDATE_HOURS, DEFAULT_UPDATE_HOURS
                ),
            )
        )

    def _save(self) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        options = dict(self.config_entry.options)
        options.update(
            {
                CONF_UPDATE_HOURS: self._update_hours,
                CONF_SETTINGS: normalize_settings(self._settings),
            }
        )
        return self.async_create_entry(title="", data=options)

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        return self.async_show_menu(
            step_id="init",
            menu_options=[
                "summary",
                "general",
                "services",
                "discovery",
                "card_layout",
                "duration_filter",
                "debug",
                "top_catalog",
                "decades",
                "default_decade",
                "family",
                "classification",
                "local_library",
                "players",
            ],
        )

    async def async_step_summary(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show a read-only summary of the active configuration."""
        self._ensure_loaded()
        assert self._settings is not None

        if user_input is not None:
            return await self.async_step_init()

        return self.async_show_form(
            step_id="summary",
            data_schema=vol.Schema({}),
            description_placeholders=_summary_placeholders(
                self._settings, self._update_hours
            ),
        )

    async def async_step_general(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        if user_input is not None:
            self._update_hours = int(user_input[CONF_UPDATE_HOURS])
            return self._save()
        return self.async_show_form(
            step_id="general",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_UPDATE_HOURS,
                        default=self._update_hours,
                    ): _number(2, 168)
                }
            ),
        )

    async def async_step_local_library(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_local_library(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="local_library",
            data_schema=_local_library_schema(self._settings),
        )

    async def async_step_services(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_services(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="services",
            data_schema=_service_schema(self._settings),
        )

    async def async_step_discovery(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_discovery(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="discovery",
            data_schema=_discovery_schema(self._settings),
        )

    async def async_step_card_layout(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_card_layout(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="card_layout",
            data_schema=_card_layout_schema(self._settings),
        )

    async def async_step_duration_filter(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_duration_filter(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="duration_filter",
            data_schema=_duration_filter_schema(self._settings),
        )

    async def async_step_debug(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_debug(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="debug",
            data_schema=_debug_schema(self._settings),
        )

    async def async_step_top_catalog(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_top(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="top_catalog",
            data_schema=_top_schema(self._settings),
        )

    async def async_step_decades(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose a decade whose detailed settings should be edited."""
        self._ensure_loaded()
        assert self._settings is not None

        if user_input is not None:
            self._selected_decade = str(user_input["decade"])
            return await self.async_step_decade_edit()

        options = [
            SelectOptionDict(value=decade, label=f"{decade}s")
            for decade in DEFAULT_TOP_CATALOG["decades"]
        ]
        return self.async_show_form(
            step_id="decades",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "decade",
                        default=str(
                            (self._settings.get("top_catalog") or {}).get(
                                "default_decade",
                                DEFAULT_TOP_CATALOG["default_decade"],
                            )
                        ),
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=options,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    )
                }
            ),
        )

    async def async_step_default_decade(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Configure the decade selected by default in Top Streaming."""
        self._ensure_loaded()
        assert self._settings is not None
        top = self._settings.setdefault(
            "top_catalog", deepcopy(DEFAULT_TOP_CATALOG)
        )

        if user_input is not None:
            default_decade = str(user_input[FIELD_DEFAULT_DECADE])
            if default_decade not in DEFAULT_TOP_CATALOG["decades"]:
                default_decade = DEFAULT_TOP_CATALOG["default_decade"]
            top[FIELD_DEFAULT_DECADE] = default_decade
            decades = top.setdefault(
                "decades", deepcopy(DEFAULT_TOP_CATALOG["decades"])
            )
            decades.setdefault(
                default_decade,
                deepcopy(DEFAULT_TOP_CATALOG["decades"][default_decade]),
            )["enabled"] = True
            return self._save()

        options = [
            SelectOptionDict(value=decade, label=f"{decade}s")
            for decade in DEFAULT_TOP_CATALOG["decades"]
        ]
        current = str(
            top.get(FIELD_DEFAULT_DECADE, DEFAULT_TOP_CATALOG["default_decade"])
        )
        if current not in DEFAULT_TOP_CATALOG["decades"]:
            current = DEFAULT_TOP_CATALOG["default_decade"]

        return self.async_show_form(
            step_id="default_decade",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        FIELD_DEFAULT_DECADE,
                        default=current,
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=options,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    )
                }
            ),
        )

    async def async_step_decade_edit(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        assert self._selected_decade is not None

        if user_input is not None:
            top = self._settings.setdefault(
                "top_catalog", deepcopy(DEFAULT_TOP_CATALOG)
            )
            decades = top.setdefault(
                "decades", deepcopy(DEFAULT_TOP_CATALOG["decades"])
            )
            decades[self._selected_decade] = {
                "enabled": bool(user_input.get("enabled", False)),
                "top_count": int(user_input["top_count"]),
                "movies": bool(user_input.get("movies", True)),
                "animation": bool(user_input.get("animation", True)),
                "series": bool(user_input.get("series", True)),
            }
            return self._save()

        return self.async_show_form(
            step_id="decade_edit",
            data_schema=_decade_edit_schema(
                self._settings, self._selected_decade
            ),
            description_placeholders={"decade": self._selected_decade},
        )

    async def async_step_family(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_family(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="family",
            data_schema=_family_schema(self._settings),
        )

    async def async_step_classification(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        if user_input is not None:
            _apply_classification(self._settings, user_input)
            return self._save()
        return self.async_show_form(
            step_id="classification",
            data_schema=_classification_schema(self._settings),
        )

    async def async_step_playback(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None

        players = self._settings.get("players") or {}
        playback = self._settings.setdefault(
            "playback", {"enabled": bool(players)}
        )

        if user_input is not None:
            playback["enabled"] = bool(
                user_input.get(FIELD_PLAYBACK_ENABLED, False)
            )
            return self._save()

        return self.async_show_form(
            step_id="playback",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        FIELD_PLAYBACK_ENABLED,
                        default=bool(playback.get("enabled", bool(players))),
                    ): selector.BooleanSelector()
                }
            ),
        )

    async def async_step_players(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        players = self._settings.get("players") or {}
        playback = self._settings.setdefault(
            "playback", {"enabled": bool(players)}
        )

        if user_input is not None:
            playback["enabled"] = bool(
                user_input.get(FIELD_PLAYBACK_ENABLED, False)
            )
            selected = str(
                user_input.get(FIELD_PLAYER_SELECT) or "__none__"
            )
            if selected == "__none__":
                return self._save()
            self._selected_player = selected
            return await self.async_step_player_edit()

        options = [
            SelectOptionDict(
                value="__none__", label="— Ne rien modifier —"
            ),
            SelectOptionDict(
                value="__add__", label="➕ Ajouter une destination"
            ),
        ]
        options.extend(
            SelectOptionDict(
                value=player_id,
                label=str(player.get("name") or player_id),
            )
            for player_id, player in players.items()
        )
        return self.async_show_form(
            step_id="players",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        FIELD_PLAYBACK_ENABLED,
                        default=bool(
                            playback.get("enabled", bool(players))
                        ),
                    ): selector.BooleanSelector(),
                    vol.Required(
                        FIELD_PLAYER_SELECT,
                        default="__none__",
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=options,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    ),
                }
            ),
        )

    async def async_step_player_edit(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._ensure_loaded()
        assert self._settings is not None
        assert self._selected_player is not None

        players = self._settings.setdefault("players", {})
        is_new = self._selected_player == "__add__"
        old_id = "" if is_new else self._selected_player
        current = {} if is_new else dict(players.get(old_id) or {})
        errors: dict[str, str] = {}

        if user_input is not None:
            if not is_new and user_input.get(FIELD_DELETE_PLAYER, False):
                players.pop(old_id, None)
                return self._save()

            new_id = (
                str(user_input[FIELD_PLAYER_ID])
                .strip()
                .casefold()
                .replace(" ", "_")
            )
            if not new_id:
                errors[FIELD_PLAYER_ID] = "invalid_player_id"
            elif new_id != old_id and new_id in players:
                errors[FIELD_PLAYER_ID] = "player_already_exists"
            else:
                if old_id and new_id != old_id:
                    players.pop(old_id, None)
                players[new_id] = {
                    "name": str(user_input[FIELD_PLAYER_NAME]).strip() or new_id,
                    "type": "android_tv",
                    "media_player": user_input[FIELD_PLAYER_MEDIA],
                    "remote": user_input[FIELD_PLAYER_REMOTE],
                    "adb_player": user_input.get(FIELD_PLAYER_ADB) or "",
                }
                return self._save()

        return self.async_show_form(
            step_id="player_edit",
            data_schema=_player_schema(
                current,
                player_id=old_id or "salon",
                include_delete=not is_new,
            ),
            errors=errors,
        )

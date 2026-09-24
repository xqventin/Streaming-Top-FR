from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

SUPPORTED_PLAYBACK_PROVIDERS = {"netflix", "disney", "prime", "stremio"}

# Stremio (fork addition): opens the title's detail page in Stremio from its
# IMDb id. Only the `remote` entity (Android TV Remote integration) is needed;
# ADB is optional and only used as a more direct launcher when configured.
STREMIO_PACKAGE = "com.stremio.one"
_IMDB_RE = re.compile(r"^tt\d{5,10}$")


def stremio_deep_link(imdb_id: str, media_type: str | None) -> str:
    imdb_id = str(imdb_id or "").strip()
    if not _IMDB_RE.match(imdb_id):
        raise ValueError("ID IMDb indisponible pour ce titre")
    kind = "series" if str(media_type or "").casefold() in {"tv", "show", "series"} else "movie"
    return f"stremio:///detail/{kind}/{imdb_id}"


def _require_entity(player: dict[str, Any], key: str) -> str:
    value = str(player.get(key) or "").strip()
    if not value:
        raise ValueError(f"Destination incomplète : `{key}` manquant")
    return value


async def _call(hass: HomeAssistant, domain: str, service: str, data: dict[str, Any]) -> None:
    await hass.services.async_call(domain, service, data, blocking=True)


async def async_launch_android_tv(
    hass: HomeAssistant,
    provider: str,
    player: dict[str, Any],
    content_id: str | None = None,
    watch_url: str | None = None,
) -> None:
    """Launch a validated streaming flow on an Android TV / Freebox Pop target."""
    remote = _require_entity(player, "remote")

    if provider == "stremio":
        link = stremio_deep_link(content_id or "", watch_url)
        adb_player = str(player.get("adb_player") or "").strip()
        await _call(hass, "remote", "turn_on", {"entity_id": remote})
        await asyncio.sleep(2)
        if adb_player:
            await _call(
                hass,
                "androidtv",
                "adb_command",
                {
                    "entity_id": adb_player,
                    "command": (
                        "am start -a android.intent.action.VIEW "
                        f"-d '{link}' {STREMIO_PACKAGE}"
                    ),
                },
            )
        else:
            await _call(
                hass, "remote", "turn_on", {"entity_id": remote, "activity": link}
            )
        return

    adb_player = _require_entity(player, "adb_player")

    # Wake the destination first. The configured media_player is intentionally
    # retained as the logical destination, while remote/ADB provide the precise
    # controls needed by the currently validated launch sequences.
    await _call(hass, "remote", "turn_on", {"entity_id": remote})
    await asyncio.sleep(3)

    if provider == "netflix":
        if not content_id:
            raise ValueError("ID Netflix indisponible pour ce titre")

        await _call(
            hass,
            "androidtv",
            "adb_command",
            {"entity_id": adb_player, "command": "am force-stop com.netflix.ninja"},
        )
        await asyncio.sleep(1)
        await _call(
            hass,
            "remote",
            "turn_on",
            {"entity_id": remote, "activity": "netflix://"},
        )
        await asyncio.sleep(15)
        await _call(
            hass,
            "remote",
            "send_command",
            {"entity_id": remote, "command": "DPAD_CENTER"},
        )
        await asyncio.sleep(5)
        command = (
            "am start "
            f"'intent://www.netflix.com/watch/{content_id}"
            "#Intent;launchFlags=0x00800000;scheme=https;"
            "package=com.netflix.ninja;S.source=30;end'"
        )
        await _call(
            hass,
            "androidtv",
            "adb_command",
            {"entity_id": adb_player, "command": command},
        )
        return

    if provider == "disney":
        if not content_id and not watch_url:
            raise ValueError("URL Disney+ France indisponible pour ce titre")

        await _call(
            hass,
            "androidtv",
            "adb_command",
            {"entity_id": adb_player, "command": "am force-stop com.disney.disneyplus"},
        )
        await asyncio.sleep(1)
        activity = str(watch_url or "").strip()
        if not activity:
            activity = f"https://www.disneyplus.com/fr-fr/browse/entity-{content_id}"
        await _call(
            hass,
            "remote",
            "turn_on",
            {"entity_id": remote, "activity": activity},
        )
        await asyncio.sleep(10)
        await _call(
            hass,
            "remote",
            "send_command",
            {"entity_id": remote, "command": "DPAD_CENTER"},
        )
        await asyncio.sleep(3)
        await _call(
            hass,
            "remote",
            "send_command",
            {"entity_id": remote, "command": "DPAD_CENTER"},
        )
        return

    if provider == "prime":
        await _call(
            hass,
            "androidtv",
            "adb_command",
            {"entity_id": adb_player, "command": "am force-stop com.amazon.amazonvideo.livingroom"},
        )
        await asyncio.sleep(1)
        await _call(
            hass,
            "remote",
            "turn_on",
            {"entity_id": remote, "activity": "https://app.primevideo.com"},
        )
        await asyncio.sleep(10)
        await _call(
            hass,
            "remote",
            "send_command",
            {"entity_id": remote, "command": "DPAD_CENTER"},
        )
        return

    raise ValueError(f"Lecture automatisée non validée pour {provider}")


async def async_launch(
    hass: HomeAssistant,
    provider: str,
    player: dict[str, Any],
    content_id: str | None = None,
    watch_url: str | None = None,
) -> None:
    provider = str(provider or "").strip()
    if provider not in SUPPORTED_PLAYBACK_PROVIDERS:
        raise ValueError(f"Lecture automatisée non validée pour {provider}")

    player_type = str(player.get("type") or "android_tv").strip().casefold()
    if player_type != "android_tv":
        raise ValueError(f"Type de destination non pris en charge : {player_type}")

    await async_launch_android_tv(hass, provider, player, content_id, watch_url)


def log_launch_failure(task: asyncio.Task) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        return
    except Exception:
        _LOGGER.exception("Streaming Top FR playback failed")

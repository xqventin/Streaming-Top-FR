from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
import types


ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "custom_components/streaming_top_fr/local_playback.py"

homeassistant = types.ModuleType("homeassistant")
core = types.ModuleType("homeassistant.core")
core.HomeAssistant = object
sys.modules["homeassistant"] = homeassistant
sys.modules["homeassistant.core"] = core

spec = spec_from_file_location("local_playback_test_module", PATH)
module = module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

build = module.build_vlc_adb_command
add_credentials = module.add_smb_credentials

uri = "smb://192.168.0.200/medias/videos/Films/Mon%20Film%20%282024%29.mkv"
cmd = build(uri)
assert "android.intent.action.VIEW" in cmd
assert "org.videolan.vlc" in cmd
assert "video/*" in cmd
assert uri in cmd
assert "am force-stop" not in cmd

# Configured credentials are inserted only into the launch URI and are
# percent-encoded so reserved characters cannot break the SMB URI.
secure_uri = add_credentials(
    uri,
    "media user",
    "p@ss:word/with?chars",
)
assert secure_uri.startswith("smb://media%20user:p%40ss%3Aword%2Fwith%3Fchars@192.168.0.200/")
secure_cmd = build(uri, "media user", "p@ss:word/with?chars")
assert "media%20user:p%40ss%3Aword%2Fwith%3Fchars@" in secure_cmd

# The scanner-owned URI remains credential-free.
assert "@" not in uri.split("://", 1)[1].split("/", 1)[0]

# Reject anything that is not an SMB URI.
try:
    build("https://example.com/video.mkv")
except ValueError:
    pass
else:
    raise AssertionError("Non-SMB URI must be rejected")

source = PATH.read_text(encoding="utf-8")
assert "am force-stop" not in source
assert "remembered SMB authentication context" in source

print("Local VLC playback command checks passed.")


# Frontend regression guard: a VLC backend without visible Local controls must
# never be released again.
card = (ROOT / "custom_components/streaming_top_fr/www/streaming-top-fr-card.js").read_text(encoding="utf-8")
manifest = (ROOT / "custom_components/streaming_top_fr/manifest.json").read_text(encoding="utf-8")
init_source = (ROOT / "custom_components/streaming_top_fr/__init__.py").read_text(encoding="utf-8")
settings_source = (ROOT / "custom_components/streaming_top_fr/settings.py").read_text(encoding="utf-8")
assert "_vlcControls" in card
assert "data-local-play-player" in card
assert 'type:"streaming_top_fr/play_local"' in card
assert 'streaming_top_fr/find_local_copy' in card
assert 'async_register_command(hass, find_local_copy)' in init_source
assert 'LOCAL_INDEX_METADATA_KEY = "local-canonical-index-v1"' in init_source
assert '_build_local_canonical_index' in init_source
assert '_find_local_index_match' in init_source
assert '_persist_local_canonical_index' in init_source
assert 'async_enrich_local_items' in init_source
assert 'Voir sur VLC' in card
assert 'data-stream-local-id' in card
assert 'stream-local-diagnostic' in card
assert 'await _stfrDetailBeforeLocalCopy.call(this,resolved)' in card
assert 'Détails techniques — correspondance Local' in card
assert 'websocket_error' in card
assert 'e?.code??null' in card
assert 'e?.message??null' in card
assert 'response_received' in card
assert 'frontend_version:STFR_VERSION' in card
assert '"diagnostic": diagnostic' in init_source
assert 'const STFR_VERSION = "1.0.9-stremio.2";' in card
assert '"version": "1.0.9-stremio.2"' in manifest
assert 'public_local.pop("smb_username", None)' in init_source
assert 'public_local.pop("smb_password", None)' in init_source
assert '"smb_username": _clean_string(local_library.get("smb_username")) or ""' in settings_source
assert '"smb_password": str(local_library.get("smb_password") or "")' in settings_source
assert '"smb_auth_mode": "configured"' in settings_source
assert 'smb_username=smb_username' in init_source
assert 'smb_password=smb_password' in init_source

print("Local VLC frontend and credential-isolation checks passed.")

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

settings = (ROOT / "custom_components/streaming_top_fr/settings.py").read_text(encoding="utf-8")
config_flow = (ROOT / "custom_components/streaming_top_fr/config_flow.py").read_text(encoding="utf-8")
init_source = (ROOT / "custom_components/streaming_top_fr/__init__.py").read_text(encoding="utf-8")
runtime_source = (ROOT / "custom_components/streaming_top_fr/runtime_filter.py").read_text(encoding="utf-8")
card = (ROOT / "custom_components/streaming_top_fr/www/streaming-top-fr-card.js").read_text(encoding="utf-8")
manifest = (ROOT / "custom_components/streaming_top_fr/manifest.json").read_text(encoding="utf-8")
fr = (ROOT / "custom_components/streaming_top_fr/translations/fr.json").read_text(encoding="utf-8")

# Configuration: feature is available by default with a 120-minute threshold.
assert '"duration_filter": {' in settings
assert '"enabled": True' in settings
assert '"max_minutes": 120' in settings
assert 'FIELD_DURATION_FILTER_ENABLED = "duration_filter_enabled"' in config_flow
assert 'FIELD_DURATION_FILTER_MAX_MINUTES = "duration_filter_max_minutes"' in config_flow
assert '"duration_filter",' in config_flow
assert '"local_auth_mode": local_auth_label if local_enabled else "—"' in config_flow
assert '"local_smb_base_uri": str(local_library.get("smb_base_uri") or "—") if local_enabled else "—"' in config_flow

assert "Filtrer sur la durée max des films" in fr
assert "{local_auth_mode}" in fr
assert "{local_smb_base_uri}" in fr

# Runtime lookup is isolated behind its own client + WebSocket endpoint.
assert "class RuntimeMetadataClient" in runtime_source
assert "runtime" in runtime_source
assert 'f"{DOMAIN}/get_runtimes"' in init_source
assert "async_register_command(hass, get_runtimes)" in init_source

# UI: all three cards are decorated after their protected class definitions.
assert "StreamingTopFrCard.prototype._durationConfig" in card
assert "StreamingTopFrCatalogCard.prototype._durationCandidates" in card
assert "StreamingLocalCard.prototype._durationConfig" in card
assert "duration-filter-toggle" in card
assert "runtime<threshold" in card
assert 'type:"streaming_top_fr/get_runtimes"' in card

# Version alignment.
assert 'const STFR_VERSION = "1.0.9-stremio.2";' in card
assert '"version": "1.0.9-stremio.2"' in manifest

print("Optional movie duration filter checks passed.")

# Streaming Local: the internal HA scan path must stay hidden from the Options Flow/UI.
assert "FIELD_LOCAL_ROOT" not in config_flow
assert "local_root_path" not in fr

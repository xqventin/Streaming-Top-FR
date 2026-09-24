from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

# 1.0.9 release guard.

settings = (ROOT / "custom_components/streaming_top_fr/settings.py").read_text(encoding="utf-8")
config_flow = (ROOT / "custom_components/streaming_top_fr/config_flow.py").read_text(encoding="utf-8")
init_source = (ROOT / "custom_components/streaming_top_fr/__init__.py").read_text(encoding="utf-8")
card = (ROOT / "custom_components/streaming_top_fr/www/streaming-top-fr-card.js").read_text(encoding="utf-8")
fr = (ROOT / "custom_components/streaming_top_fr/translations/fr.json").read_text(encoding="utf-8")
manifest = (ROOT / "custom_components/streaming_top_fr/manifest.json").read_text(encoding="utf-8")

assert '"debug": {' in settings
assert '"enabled": False' in settings
assert 'FIELD_DEBUG_ENABLED = "debug_enabled"' in config_flow
assert '"debug",' in config_flow
assert 'async def async_step_debug(' in config_flow
assert '"debug_enabled": _status(debug.get("enabled", False))' in config_flow

assert "_apply_debug_logging" in init_source
assert "logging.DEBUG if debug_enabled else logging.NOTSET" in init_source
assert '"diagnostic": diagnostic if debug_enabled else None' in init_source
assert "find_local_copy request:" in init_source
assert "find_local_copy result:" in init_source

assert "const debugEnabled=this._data?.settings?.debug?.enabled===true;" in card
assert "if(modal&&diagnostic&&debugEnabled)" in card

assert "Mode Debug" in fr
assert "Activer les logs Debug" in fr
assert "{debug_enabled}" in fr

assert 'const STFR_VERSION = "1.0.9-stremio.1";' in card
assert '"version": "1.0.9-stremio.1"' in manifest

print("Optional Debug mode checks passed.")

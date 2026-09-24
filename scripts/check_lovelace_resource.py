from __future__ import annotations

import ast
import asyncio
import logging
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "custom_components/streaming_top_fr/lovelace_resource.py"
INIT_PATH = ROOT / "custom_components/streaming_top_fr/__init__.py"
MANIFEST_PATH = ROOT / "custom_components/streaming_top_fr/manifest.json"

source = MODULE_PATH.read_text(encoding="utf-8")
tree = ast.parse(source)

wanted = {
    "_resource_path",
    "_is_streaming_top_resource",
    "_async_upsert_storage_resource",
}
nodes = [
    node
    for node in tree.body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    and node.name in wanted
]
assert {node.name for node in nodes} == wanted
module = ast.Module(body=nodes, type_ignores=[])
ast.fix_missing_locations(module)

runtime = {
    "urlsplit": urlsplit,
    "CARD_RESOURCE_PATH": "/streaming_top_fr/streaming-top-fr-card.js",
    "CARD_RESOURCE_TYPE": "module",
    "_LOGGER": logging.getLogger("lovelace-resource-test"),
}
exec(compile(module, str(MODULE_PATH), "exec"), runtime)

upsert = runtime["_async_upsert_storage_resource"]
is_resource = runtime["_is_streaming_top_resource"]


class FakeResources:
    def __init__(self, items=None):
        self.items = [dict(item) for item in (items or [])]
        self.loaded = False
        self.created = 0
        self.updated = 0
        self.deleted = 0

    async def async_get_info(self):
        self.loaded = True
        return {"resources": len(self.items)}

    def async_items(self):
        assert self.loaded, "resource collection must be loaded before inspection"
        return self.items

    async def async_create_item(self, data):
        self.created += 1
        item = {
            "id": f"new-{self.created}",
            "url": data["url"],
            "type": data["res_type"],
        }
        self.items.append(item)
        return item

    async def async_update_item(self, item_id, updates):
        self.updated += 1
        item = next(item for item in self.items if item["id"] == item_id)
        if "url" in updates:
            item["url"] = updates["url"]
        if "res_type" in updates:
            item["type"] = updates["res_type"]
        return item

    async def async_delete_item(self, item_id):
        self.deleted += 1
        self.items = [item for item in self.items if item["id"] != item_id]


async def main():
    target = "/streaming_top_fr/streaming-top-fr-card.js?v=1.0.9-stremio.2"

    # Migrate a historical manually-added URL and collapse duplicates.
    resources = FakeResources(
        [
            {
                "id": "manual-old",
                "url": "/streaming_top_fr/streaming-top-fr-card.js?v=0.7.0-beta.2",
                "type": "module",
            },
            {
                "id": "duplicate",
                "url": "/streaming_top_fr/streaming-top-fr-card.js",
                "type": "module",
            },
            {
                "id": "other-card",
                "url": "/local/other-card.js",
                "type": "module",
            },
        ]
    )
    changed = await upsert(resources, target)
    assert changed is True
    assert resources.updated == 1
    assert resources.deleted == 1
    assert resources.created == 0

    matches = [item for item in resources.items if is_resource(item)]
    assert len(matches) == 1
    assert matches[0]["url"] == target
    assert matches[0]["type"] == "module"
    assert any(item["id"] == "other-card" for item in resources.items)

    # A second setup/restart is idempotent.
    changed = await upsert(resources, target)
    assert changed is False
    assert resources.updated == 1
    assert resources.deleted == 1
    assert resources.created == 0

    # Fresh installation gets the resource automatically.
    fresh = FakeResources()
    changed = await upsert(fresh, target)
    assert changed is True
    assert fresh.created == 1
    assert fresh.items == [
        {"id": "new-1", "url": target, "type": "module"}
    ]


asyncio.run(main())

init_source = INIT_PATH.read_text(encoding="utf-8")
manifest = MANIFEST_PATH.read_text(encoding="utf-8")

assert "await async_register_lovelace_resource(hass)" in init_source
assert "await async_remove_lovelace_resource(hass)" in init_source
assert '"dependencies": [' in manifest
assert '"http"' in manifest
assert '"lovelace"' in manifest

print("Automatic Lovelace resource registration checks passed.")

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from css_catalog import (
    CATALOG_METADATA_FILE,
    SCOPE_OVERRIDE_FILE,
    cache_catalog_record,
    catalog_metadata_from_record,
    normalize_catalog_targets,
    refresh_installed_catalog_metadata,
    resolve_theme_catalog,
    scope_for_catalog_targets,
)


class CatalogScopeTests(unittest.IsolatedAsyncioTestCase):
    def test_catalog_targets_map_to_steam_ui_modes(self):
        self.assertEqual(scope_for_catalog_targets(["Desktop-Store"]), "desktop")
        self.assertEqual(scope_for_catalog_targets(["Store"]), "gamepad")
        self.assertEqual(scope_for_catalog_targets(["Desktop-Tweak", "Tweak"]), "all")
        self.assertEqual(scope_for_catalog_targets([]), "all")

    def test_target_falls_back_when_targets_is_missing(self):
        self.assertEqual(
            normalize_catalog_targets({"target": "Desktop-Store"}),
            ["Desktop-Store"],
        )

    def test_catalog_record_is_cached_next_to_matching_theme(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary)
            theme_root = themes_root / "Prominent Store Prices"
            theme_root.mkdir()
            manifest = {
                "id": "090c1cd9-0562-4b10-abf3-31f6d0676c4c",
                "name": "Prominent Store Prices",
            }
            (theme_root / "theme.json").write_text(json.dumps(manifest), encoding="utf-8")
            record = {
                **manifest,
                "target": "Desktop-Store",
                "targets": ["Desktop-Store"],
            }

            metadata_path = cache_catalog_record(record, themes_root)

            self.assertEqual(metadata_path, theme_root / CATALOG_METADATA_FILE)
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(metadata["scope"], "desktop")
            self.assertEqual(metadata["targets"], ["Desktop-Store"])
            self.assertEqual(
                resolve_theme_catalog(theme_root, manifest),
                ("desktop", ["Desktop-Store"]),
            )

    def test_manual_override_takes_precedence_over_catalog(self):
        with tempfile.TemporaryDirectory() as temporary:
            theme_root = Path(temporary)
            manifest = {"id": "theme-id"}
            (theme_root / CATALOG_METADATA_FILE).write_text(
                json.dumps({"id": "theme-id", "scope": "desktop", "targets": ["Desktop"]}),
                encoding="utf-8",
            )
            (theme_root / SCOPE_OVERRIDE_FILE).write_text(
                json.dumps({"scope": "gamepad"}),
                encoding="utf-8",
            )

            self.assertEqual(resolve_theme_catalog(theme_root, manifest), ("gamepad", []))

    async def test_existing_theme_metadata_is_backfilled_by_uuid(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary)
            theme_root = themes_root / "Deck Store - Rounded"
            theme_root.mkdir()
            theme_id = "708eefec-a1d5-4550-9c33-35c77ba56db7"
            (theme_root / "theme.json").write_text(
                json.dumps({"id": theme_id, "name": "Deck Store - Rounded"}),
                encoding="utf-8",
            )
            record = {
                "id": theme_id,
                "name": "Deck Store - Rounded",
                "target": "Store",
                "targets": ["Store"],
            }

            with patch("css_catalog._fetch_catalog_records", new=AsyncMock(return_value=[record])):
                cached = await refresh_installed_catalog_metadata(themes_root)

            self.assertEqual(cached, 1)
            metadata = json.loads(
                (theme_root / CATALOG_METADATA_FILE).read_text(encoding="utf-8")
            )
            self.assertEqual(metadata["scope"], "gamepad")

    async def test_fresh_cache_does_not_call_catalog_api(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary)
            theme_root = themes_root / "Cached Theme"
            theme_root.mkdir()
            theme_id = "090c1cd9-0562-4b10-abf3-31f6d0676c4c"
            (theme_root / "theme.json").write_text(
                json.dumps({"id": theme_id, "name": "Cached Theme"}),
                encoding="utf-8",
            )
            metadata = catalog_metadata_from_record(
                {"id": theme_id, "target": "Desktop-Store", "targets": ["Desktop-Store"]}
            )
            metadata["fetchedAt"] = int(time.time())
            (theme_root / CATALOG_METADATA_FILE).write_text(
                json.dumps(metadata),
                encoding="utf-8",
            )

            fetch = AsyncMock(return_value=[])
            with patch("css_catalog._fetch_catalog_records", new=fetch):
                cached = await refresh_installed_catalog_metadata(themes_root)

            self.assertEqual(cached, 0)
            fetch.assert_not_awaited()

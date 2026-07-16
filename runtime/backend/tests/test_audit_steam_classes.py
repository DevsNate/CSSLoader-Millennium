import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS_ROOT = Path(__file__).resolve().parents[3] / "tools" / "audit"
sys.path.insert(0, str(TOOLS_ROOT))

from audit_steam_classes import audit_theme_classes, looks_like_raw_steam_hash


class SteamClassAuditTests(unittest.TestCase):
    def test_hash_detection_ignores_normal_custom_classes(self):
        self.assertTrue(looks_like_raw_steam_hash("_1ml4SNc3LIyBDHIf8ekVSw"))
        self.assertFalse(looks_like_raw_steam_hash("CssLoader_ThemeBrowser_SingleItem_BgImage"))
        self.assertFalse(looks_like_raw_steam_hash("protondb-decky-indicator"))

    def test_audit_does_not_count_custom_translation_copy_as_steam_ui(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            themes = root / "themes"
            steam_ui = root / "steamui"
            (themes / "Example").mkdir(parents=True)
            (steam_ui / "themes_custom").mkdir(parents=True)

            translations = {
                "module_Target": ["legacy_Target_abc12", "_OldHash1234567890AbCd"]
            }
            (themes / "css_translations.json").write_text(
                json.dumps(translations), encoding="utf-8"
            )
            (themes / "Example" / "shared.css").write_text(
                ".legacy_Target_abc12 { color: red; }", encoding="utf-8"
            )
            (steam_ui / "steam.js").write_text(
                'e.exports={Target:"_CurrentHash123456AbCd"}', encoding="utf-8"
            )
            (steam_ui / "themes_custom" / "css_translations.json").write_text(
                json.dumps(translations), encoding="utf-8"
            )

            stale, stats = audit_theme_classes(themes, steam_ui)

            self.assertEqual(stats["candidate_occurrences"], 1)
            self.assertEqual(stats["stale_occurrences"], 1)
            self.assertEqual(stale[0].translated_class, "_OldHash1234567890AbCd")


if __name__ == "__main__":
    unittest.main()

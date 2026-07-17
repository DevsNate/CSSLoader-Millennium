import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from css_millennium import (
    KNOWN_TARGETS,
    PROTOCOL_VERSION,
    REPORT_FILE,
    RUNTIME_MODE,
    STATE_FILE,
    _prepare_live_runtime_path,
    _enabled_injects,
    _sync_active_theme_assets,
    _target_for_tab,
    _targets_for_tab,
    _translate_classes,
    publish_millennium_runtime,
)
from css_inject import ALL_INJECTS, CLASS_MAPPINGS, Inject
from css_loader import Loader
from css_utils import FLAG_PRESET


class FakeTheme:
    def __init__(self, name, *, enabled=False, dependencies=None, flags=None):
        self.name = name
        self.enabled = enabled
        self.dependencies = dependencies or {}
        self.flags = flags or []
        self.removals = 0
        self.injections = 0

    async def remove(self, remove_now=True):
        self.removals += 1
        self.enabled = False
        return SimpleNamespace(success=True)

    async def inject(self, inject_now=True):
        self.injections += 1
        self.enabled = True
        return SimpleNamespace(success=True)


class MillenniumCompilerTests(unittest.TestCase):
    def test_live_runtime_requires_the_installed_companion(self):
        with tempfile.TemporaryDirectory() as temporary:
            steam_root = Path(temporary) / "Steam"
            plugin_root = steam_root / "millennium" / "plugins" / "css-loader-companion"

            with patch("css_millennium.get_steam_path", return_value=str(steam_root)):
                with self.assertRaisesRegex(FileNotFoundError, "Companion is not installed"):
                    _prepare_live_runtime_path()

            self.assertFalse(plugin_root.exists())

    def test_live_runtime_moves_into_plugin_and_removes_legacy_theme_mailbox(self):
        with tempfile.TemporaryDirectory() as temporary:
            steam_root = Path(temporary) / "Steam"
            plugin_root = steam_root / "millennium" / "plugins" / "css-loader-companion"
            plugin_root.mkdir(parents=True)
            (plugin_root / "plugin.json").write_text("{}", encoding="utf-8")
            legacy_root = steam_root / "millennium" / "themes" / "CSS Loader"
            legacy_root.mkdir(parents=True)
            (legacy_root / REPORT_FILE).write_text("{}", encoding="utf-8")
            (legacy_root / STATE_FILE).write_text("{}", encoding="utf-8")
            (legacy_root / "skin.json").write_text("{}", encoding="utf-8")

            previous_injects = list(ALL_INJECTS)
            try:
                ALL_INJECTS.clear()
                with patch("css_millennium.get_steam_path", return_value=str(steam_root)):
                    report = publish_millennium_runtime(
                        SimpleNamespace(themes=[]),
                        themes_root=Path(temporary) / "themes",
                    )
            finally:
                ALL_INJECTS.clear()
                ALL_INJECTS.extend(previous_injects)

            runtime_root = plugin_root / "runtime"
            self.assertEqual(Path(report["output"]), runtime_root)
            self.assertTrue((runtime_root / REPORT_FILE).is_file())
            self.assertTrue((runtime_root / STATE_FILE).is_file())
            self.assertFalse((runtime_root / "skin.json").exists())
            self.assertFalse(legacy_root.exists())

    def test_known_cssloader_targets_map_to_millennium_windows(self):
        self.assertEqual(_target_for_tab("Steam|SteamLibraryWindow"), KNOWN_TARGETS["desktop"])
        self.assertEqual(_target_for_tab("~Valve Steam Gamepad/default~"), KNOWN_TARGETS["bigpicture"])
        self.assertEqual(_target_for_tab("MainMenu.*"), KNOWN_TARGETS["mainmenu"])
        self.assertEqual(_target_for_tab("QuickAccess.*"), KNOWN_TARGETS["quickaccess"])

    def test_side_menus_keep_their_decky_document_targets(self):
        self.assertEqual(
            _targets_for_tab("QuickAccess.*"),
            [KNOWN_TARGETS["quickaccess"]],
        )
        self.assertEqual(
            _targets_for_tab("MainMenu.*"),
            [KNOWN_TARGETS["mainmenu"]],
        )

    def test_cssloader_target_forms_preserve_their_match_semantics(self):
        title_target = _target_for_tab(r"OverlayTab\d+_Find")
        self.assertEqual(title_target.match_type, "title")
        self.assertEqual(title_target.match_value, r"OverlayTab\d+_Find")

        url_target = _target_for_tab("~https://store.steampowered.com~")
        self.assertEqual(url_target.match_type, "url")
        self.assertEqual(url_target.match_value, "https://store.steampowered.com")

        class_target = _target_for_tab("!friendsui-container")
        self.assertEqual(class_target.match_type, "class")
        self.assertEqual(class_target.match_value, "friendsui-container")

    def test_direct_state_serializes_title_url_and_class_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            theme_root = themes_root / "Target Theme"
            output_root = Path(temporary) / "output"
            theme_root.mkdir(parents=True)
            theme = SimpleNamespace(
                enabled=True,
                name="Target Theme",
                themePath=str(theme_root),
                catalog_scope="desktop",
                catalog_targets=["Desktop-Store"],
            )
            inject = Inject(
                "",
                [
                    r"OverlayTab\d+_Find",
                    "~https://store.steampowered.com~",
                    "!friendsui-container",
                ],
                theme,
            )
            inject.css = ":root { --target-test: 1; }"
            inject.activate()

            previous_injects = list(ALL_INJECTS)
            try:
                ALL_INJECTS.clear()
                ALL_INJECTS.append(inject)
                publish_millennium_runtime(
                    SimpleNamespace(themes=[theme]),
                    output_root=output_root,
                    themes_root=themes_root,
                )
            finally:
                ALL_INJECTS.clear()
                ALL_INJECTS.extend(previous_injects)

            state = json.loads((output_root / STATE_FILE).read_text(encoding="utf-8"))
            self.assertEqual(state["protocolVersion"], 1)
            self.assertTrue(all("matchRegex" in item for item in state["injections"]))
            self.assertTrue(all(item["scope"] == "desktop" for item in state["injections"]))
            self.assertTrue(
                all(item["catalogTargets"] == ["Desktop-Store"] for item in state["injections"])
            )
            matches = {
                (item["matchType"], item["matchValue"])
                for item in state["injections"]
            }
            self.assertEqual(
                matches,
                {
                    ("title", r"OverlayTab\d+_Find"),
                    ("url", "https://store.steampowered.com"),
                    ("class", "friendsui-container"),
                },
            )

    def test_class_translation_matches_cssloader_behavior(self):
        CLASS_MAPPINGS.clear()
        CLASS_MAPPINGS["oldClass"] = "newClass"
        css = '.oldClass, [class*="oldClass"] { color: red; }'
        self.assertEqual(
            _translate_classes(css),
            '.newClass, [class*="newClass"] { color: red; }',
        )

    def test_generated_component_css_takes_precedence_over_placeholder_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            theme_root = themes_root / "Obsidian"
            output_root = Path(temporary) / "output"
            theme_root.mkdir(parents=True)

            theme = SimpleNamespace(enabled=True, name="Obsidian", themePath=str(theme_root))
            component = Inject("/", ["bigpicture"], theme)
            component.css = ":root { --obsidian-main-color: #111111; }"
            component.enabled = True

            previous_injects = list(ALL_INJECTS)
            try:
                ALL_INJECTS.clear()
                ALL_INJECTS.append(component)
                report = publish_millennium_runtime(
                    SimpleNamespace(themes=[theme]),
                    output_root=output_root,
                    themes_root=themes_root,
                )
            finally:
                ALL_INJECTS.clear()
                ALL_INJECTS.extend(previous_injects)

            self.assertEqual(report["selectedInjects"], 1)
            self.assertEqual(report["runtimeMode"], RUNTIME_MODE)
            self.assertEqual(report["protocolVersion"], PROTOCOL_VERSION)
            self.assertIn("bigpicture", report["targets"])
            state = json.loads((output_root / STATE_FILE).read_text(encoding="utf-8"))
            self.assertEqual(state["contentHash"], report["contentHash"])
            self.assertEqual(len(state["injections"]), 1)
            self.assertEqual(state["injections"][0]["matchType"], "title")
            self.assertEqual(state["injections"][0]["matchValue"], "Steam Big Picture Mode")
            self.assertIn("--obsidian-main-color: #111111", state["injections"][0]["css"])
            self.assertFalse((output_root / "skin.json").exists())

    def test_inline_svg_data_urls_are_published_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            theme_root = themes_root / "Animated PSP Waves Background"
            output_root = Path(temporary) / "output"
            theme_root.mkdir(parents=True)
            source_css = theme_root / "wave.css"
            svg_css = (
                ":root { --wave: url(\"data:image/svg+xml,%3Csvg%3E"
                "%3Cg filter='url(%23blur1)'/%3E%3C/svg%3E\"); }"
            )
            source_css.write_text(svg_css, encoding="utf-8")
            theme = SimpleNamespace(
                enabled=True,
                name="Animated PSP Waves Background",
                themePath=str(theme_root),
            )
            inject = Inject(str(source_css), ["bigpicture"], theme)
            inject.activate()

            previous_injects = list(ALL_INJECTS)
            try:
                ALL_INJECTS.clear()
                ALL_INJECTS.append(inject)
                publish_millennium_runtime(
                    SimpleNamespace(themes=[theme]),
                    output_root=output_root,
                    themes_root=themes_root,
                )
            finally:
                ALL_INJECTS.clear()
                ALL_INJECTS.extend(previous_injects)

            state = json.loads((output_root / STATE_FILE).read_text(encoding="utf-8"))
            self.assertEqual(state["injections"][0]["css"], svg_css)
            self.assertIn("filter='url(%23blur1)'", state["injections"][0]["css"])
            self.assertNotIn("assets/themes", state["injections"][0]["css"])

    def test_active_theme_assets_are_mirrored_without_css_rewriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            themes_root = root / "themes"
            theme_root = themes_root / "Asset Theme"
            destination = root / "steamui" / "themes_custom"
            (theme_root / "images").mkdir(parents=True)
            (theme_root / "images" / "background.png").write_bytes(b"image")
            css = 'a { background: url("/themes_custom/Asset Theme/images/background.png"); }'
            (theme_root / "theme.css").write_text(css, encoding="utf-8")
            theme = SimpleNamespace(enabled=True, name="Asset Theme", themePath=str(theme_root))

            synced = _sync_active_theme_assets(
                SimpleNamespace(themes=[theme]),
                themes_root,
                destination,
            )

            self.assertEqual(synced, ["Asset Theme"])
            self.assertEqual(
                (destination / "Asset Theme" / "theme.css").read_text(encoding="utf-8"),
                css,
            )
            self.assertEqual(
                (destination / "Asset Theme" / "images" / "background.png").read_bytes(),
                b"image",
            )

    def test_reactivated_payload_moves_to_end_of_decky_cascade(self):
        theme = SimpleNamespace(name="Example")
        first = Inject("", ["bigpicture"], theme)
        second = Inject("", ["bigpicture"], theme)
        previous_injects = list(ALL_INJECTS)
        try:
            ALL_INJECTS.clear()
            ALL_INJECTS.extend([first, second])
            first.activate()
            second.activate()
            self.assertEqual(list(_enabled_injects()), [first, second])

            first.deactivate()
            first.activate()
            self.assertEqual(list(_enabled_injects()), [second, first])
        finally:
            ALL_INJECTS.clear()
            ALL_INJECTS.extend(previous_injects)

    def test_direct_publish_removes_legacy_assets_and_stale_bundles(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            output_root = Path(temporary) / "output"
            old_theme_assets = output_root / "assets" / "themes" / "Old Theme"
            old_theme_assets.mkdir(parents=True)
            (old_theme_assets / "old.png").write_bytes(b"old")
            generated_root = output_root / "generated"
            generated_root.mkdir(parents=True)
            (generated_root / "desktop.css").write_text("old", encoding="utf-8")

            previous_injects = list(ALL_INJECTS)
            try:
                ALL_INJECTS.clear()
                report = publish_millennium_runtime(
                    SimpleNamespace(themes=[]),
                    output_root=output_root,
                    themes_root=themes_root,
                )
            finally:
                ALL_INJECTS.clear()
                ALL_INJECTS.extend(previous_injects)

            self.assertEqual(report["targets"], {})
            self.assertFalse(old_theme_assets.exists())
            self.assertFalse((generated_root / "desktop.css").exists())
            state = json.loads((output_root / STATE_FILE).read_text(encoding="utf-8"))
            self.assertEqual(state["injections"], [])


class MillenniumProfileTests(unittest.IsolatedAsyncioTestCase):
    async def test_profile_manifest_is_read_as_utf8(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            profile_root = themes_root / "Unicode.profile"
            profile_root.mkdir(parents=True)
            manifest = {
                "display_name": "Unicode Ϗ Profile",
                "name": "Unicode.profile",
                "manifest_version": 9,
                "flags": ["PRESET"],
                "dependencies": {},
            }
            (profile_root / "theme.json").write_text(
                json.dumps(manifest, ensure_ascii=False),
                encoding="utf-8",
            )

            loader = Loader()
            failures = await loader._parse_themes(str(themes_root))

            self.assertEqual(failures, [])
            self.assertEqual(len(loader.themes), 1)
            self.assertEqual(loader.themes[0].display_name, "Unicode Ϗ Profile")

    def test_only_configured_active_profiles_restore_assets_during_load(self):
        with tempfile.TemporaryDirectory() as temporary:
            active_config = Path(temporary) / "active.json"
            inactive_config = Path(temporary) / "inactive.json"
            active_config.write_text('{"active": true}', encoding="utf-8")
            inactive_config.write_text('{"active": false}', encoding="utf-8")

            self.assertTrue(
                Loader._profile_is_configured_active(
                    SimpleNamespace(configJsonPath=str(active_config)),
                ),
            )
            self.assertFalse(
                Loader._profile_is_configured_active(
                    SimpleNamespace(configJsonPath=str(inactive_config)),
                ),
            )

    def test_profile_restores_bundled_dependency_image(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            profile_root = themes_root / "Switch Deck 2.profile"
            dependency_root = themes_root / "Static Background"
            profile_root.mkdir(parents=True)
            dependency_root.mkdir(parents=True)
            (profile_root / "7_1.jpg").write_bytes(b"profile background")

            component = SimpleNamespace(name="Home Background", type="image-picker")
            dependency_patch = SimpleNamespace(name="Home", components=[component])
            dependency = FakeTheme("Static Background")
            dependency.patches = [dependency_patch]
            profile = FakeTheme(
                "Switch Deck 2.profile",
                dependencies={
                    "Static Background": {
                        "Home": {
                            "value": "Yes",
                            "components": {
                                "Home Background": "Static Background/7_1.jpg",
                            },
                        },
                    },
                },
                flags=[FLAG_PRESET],
            )
            profile.themePath = str(profile_root)

            loader = Loader()
            loader.themes = [dependency, profile]
            with patch("css_loader.get_theme_path", return_value=str(themes_root)):
                restored = loader._restore_profile_assets(profile)

            self.assertEqual(restored, ["Static Background/7_1.jpg"])
            self.assertEqual(
                (dependency_root / "7_1.jpg").read_bytes(),
                b"profile background",
            )

    def test_profile_asset_restore_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            profile_root = themes_root / "Unsafe.profile"
            profile_root.mkdir(parents=True)
            (profile_root / "outside.jpg").write_bytes(b"unsafe")

            component = SimpleNamespace(name="Background", type="image-picker")
            dependency_patch = SimpleNamespace(name="Home", components=[component])
            dependency = FakeTheme("Static Background")
            dependency.patches = [dependency_patch]
            profile = FakeTheme(
                "Unsafe.profile",
                dependencies={
                    "Static Background": {
                        "Home": {
                            "value": "Yes",
                            "components": {"Background": "../outside.jpg"},
                        },
                    },
                },
                flags=[FLAG_PRESET],
            )
            profile.themePath = str(profile_root)

            loader = Loader()
            loader.themes = [dependency, profile]
            with patch("css_loader.get_theme_path", return_value=str(themes_root)):
                restored = loader._restore_profile_assets(profile)

            self.assertEqual(restored, [])
            self.assertFalse((Path(temporary) / "outside.jpg").exists())

    async def test_profile_change_publishes_only_the_final_state(self):
        loader = Loader()
        loader.millennium_theme_mode = True
        old_theme = FakeTheme("Old Theme", enabled=True)
        dependency = FakeTheme("Obsidian", enabled=True)
        old_profile = FakeTheme("Old.profile", enabled=True, flags=[FLAG_PRESET])
        new_profile = FakeTheme(
            "Playhub.profile",
            dependencies={"Obsidian": {}},
            flags=[FLAG_PRESET],
        )
        loader.themes = [old_theme, dependency, old_profile, new_profile]
        loader.scores = {theme.name: index for index, theme in enumerate(loader.themes)}
        loader.commit_runtime = AsyncMock(return_value={})

        result = await loader.change_preset("Playhub.profile")

        self.assertTrue(result.success)
        loader.commit_runtime.assert_awaited_once()
        self.assertFalse(old_theme.enabled)
        self.assertFalse(old_profile.enabled)
        self.assertTrue(dependency.enabled)
        self.assertTrue(new_profile.enabled)


if __name__ == "__main__":
    unittest.main()

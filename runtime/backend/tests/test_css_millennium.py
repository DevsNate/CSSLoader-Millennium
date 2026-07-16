import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from css_millennium import (
    KNOWN_TARGETS,
    RUNTIME_MODE,
    THEME_DISPLAY_NAME,
    _enabled_injects,
    _rewrite_asset_urls,
    _target_for_tab,
    _targets_for_tab,
    _translate_classes,
    compile_millennium_theme,
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

    def test_class_translation_matches_cssloader_behavior(self):
        CLASS_MAPPINGS.clear()
        CLASS_MAPPINGS["oldClass"] = "newClass"
        css = '.oldClass, [class*="oldClass"] { color: red; }'
        self.assertEqual(
            _translate_classes(css),
            '.newClass, [class*="newClass"] { color: red; }',
        )

    def test_asset_urls_are_rebased_into_generated_theme(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            source_css = themes_root / "Example" / "styles" / "theme.css"
            source_css.parent.mkdir(parents=True)
            css = 'a { background: url("../images/background.png"); }'
            self.assertEqual(
                _rewrite_asset_urls(css, source_css, themes_root),
                'a { background: url("../assets/themes/Example/images/background.png"); }',
            )

    def test_legacy_themes_custom_urls_are_rebased(self):
        with tempfile.TemporaryDirectory() as temporary:
            themes_root = Path(temporary) / "themes"
            source_css = themes_root / "Example" / "theme.css"
            source_css.parent.mkdir(parents=True)
            css = 'a { background: url("/themes_custom/Example/image.png"); }'
            self.assertEqual(
                _rewrite_asset_urls(css, source_css, themes_root),
                'a { background: url("../assets/themes/Example/image.png"); }',
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
                report = compile_millennium_theme(
                    SimpleNamespace(themes=[theme]),
                    output_root=output_root,
                    themes_root=themes_root,
                )
            finally:
                ALL_INJECTS.clear()
                ALL_INJECTS.extend(previous_injects)

            self.assertEqual(report["selectedInjects"], 1)
            self.assertEqual(report["runtimeMode"], RUNTIME_MODE)
            self.assertIn("bigpicture", report["bundles"])
            self.assertIn(
                "--obsidian-main-color: #111111",
                (output_root / "generated" / "bigpicture.css").read_text(encoding="utf-8"),
            )
            skin = json.loads((output_root / "skin.json").read_text(encoding="utf-8"))
            self.assertEqual(skin["name"], THEME_DISPLAY_NAME)
            self.assertIn("overlay mode", skin["description"].lower())

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


class MillenniumProfileTests(unittest.IsolatedAsyncioTestCase):
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

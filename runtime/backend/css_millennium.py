import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from css_inject import ALL_INJECTS, CLASS_MAPPINGS, initialize_class_mappings
from css_loader import Loader
from css_utils import Log, get_steam_path, get_theme_path


THEME_NAME = "CSS Loader"
THEME_DISPLAY_NAME = "CSS Loader Runtime"
RUNTIME_MODE = "direct"
PROTOCOL_VERSION = 1
STATE_FILE = "runtime-state.json"


@dataclass(frozen=True)
class MillenniumTarget:
    key: str
    match_regex: str


KNOWN_TARGETS = {
    "desktop": MillenniumTarget("desktop", r"^(Steam|SteamLibraryWindow)$"),
    "bigpicture": MillenniumTarget("bigpicture", r"^Steam Big Picture Mode$"),
    "mainmenu": MillenniumTarget("mainmenu", r"^MainMenu.*$"),
    "quickaccess": MillenniumTarget("quickaccess", r"^QuickAccess.*$"),
    "notifications": MillenniumTarget("notifications", r"^notificationtoasts.*$"),
}


def default_millennium_theme_path() -> Path:
    configured = os.getenv("CSS_LOADER_MILLENNIUM_THEME_PATH")
    if configured:
        return Path(configured)
    return Path(get_steam_path()) / "millennium" / "themes" / THEME_NAME


def _target_for_tab(tab: str) -> MillenniumTarget:
    if tab in {"Steam|SteamLibraryWindow", "Steam", "SteamLibraryWindow", "desktop"}:
        return KNOWN_TARGETS["desktop"]
    if tab in {
        "bigpicture",
        "SP",
        "Steam Big Picture Mode",
        "~Valve Steam Gamepad/default~",
        "~Valve%20Steam%20Gamepad~",
    }:
        return KNOWN_TARGETS["bigpicture"]
    if tab in {"MainMenu", "MainMenu.*", "MainMenu_.*"}:
        return KNOWN_TARGETS["mainmenu"]
    if tab in {"QuickAccess", "QuickAccess.*", "QuickAccess_.*"}:
        return KNOWN_TARGETS["quickaccess"]
    if tab in {"notificationtoasts.*", "notificationtoasts_.*"}:
        return KNOWN_TARGETS["notifications"]

    if tab.startswith("~") and tab.endswith("~") and len(tab) > 2:
        match_regex = ".*" + re.escape(tab[1:-1]) + ".*"
    elif tab.startswith("!"):
        match_regex = ".*" + re.escape(tab[1:]) + ".*"
    else:
        match_regex = tab

    key = "custom-" + re.sub(r"[^a-z0-9]+", "-", tab.lower()).strip("-")
    return MillenniumTarget(key or "custom", match_regex)


def _targets_for_tab(tab: str) -> list[MillenniumTarget]:
    """Return the same document target used by Decky's CSS Loader."""
    return [_target_for_tab(tab)]


def _translate_classes(css: str) -> str:
    split_css = re.split(r"(\.[_a-zA-Z]+[_a-zA-Z0-9-]*)", css)
    for index, value in enumerate(split_css):
        if value.startswith(".") and value[1:] in CLASS_MAPPINGS:
            split_css[index] = "." + CLASS_MAPPINGS[value[1:]]

    css = "".join(split_css)
    split_css = re.split(r'(\[class[*^|~]="[_a-zA-Z0-9-]*"\])', css)
    for index, value in enumerate(split_css):
        if value.startswith("[class") and value.endswith('"]') and value[9:-2] in CLASS_MAPPINGS:
            split_css[index] = value[:9] + CLASS_MAPPINGS[value[9:-2]] + value[-2:]
    return "".join(split_css)


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8", errors="replace") == content:
        return
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def _enabled_injects() -> Iterable:
    return iter(
        sorted(
            (inject for inject in ALL_INJECTS if inject.enabled),
            key=lambda inject: inject.activation_order,
        )
    )


def _resolved_inject_css(inject, themes_root: Path) -> tuple[str, str]:
    """Return CSS Loader's translated CSS without JavaScript-string escaping.

    File-backed Inject objects may already contain an escaped copy in
    ``inject.css`` after legacy CDP use. Reading the source again prevents those
    escape characters from leaking into the Millennium direct-style protocol.
    Generated variables and patch components have no real source file, so their
    in-memory CSS remains authoritative.
    """
    source_css = Path(inject.cssPath) if inject.cssPath else None
    if source_css is not None and source_css.is_file():
        css = source_css.read_text(encoding="utf-8", errors="replace")
        try:
            origin = source_css.resolve().relative_to(themes_root.resolve()).as_posix()
        except ValueError:
            origin = str(source_css)
        return _translate_classes(css), origin

    return inject.css or "", "generated CSS"


def _remove_legacy_compiler_output(output_root: Path) -> None:
    for directory_name in ("generated", "assets"):
        directory = output_root / directory_name
        if directory.exists():
            shutil.rmtree(directory)


def _sync_active_theme_assets(loader: Loader, themes_root: Path, destination_root: Path) -> list[str]:
    """Keep CSS Loader's /themes_custom asset path current without rewriting CSS."""
    try:
        destination_root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        Log(f"Could not prepare CSS Loader asset path '{destination_root}': {error}")
        return []
    try:
        if destination_root.resolve() == themes_root.resolve():
            return []
    except OSError:
        pass

    synced = []
    for theme in (theme for theme in loader.themes if theme.enabled):
        source = Path(theme.themePath)
        if not source.is_dir():
            continue
        try:
            relative = source.resolve().relative_to(themes_root.resolve())
        except ValueError:
            continue
        try:
            shutil.copytree(source, destination_root / relative, dirs_exist_ok=True)
            synced.append(relative.as_posix())
        except OSError as error:
            Log(f"Could not sync CSS Loader assets for '{theme.name}': {error}")
    return synced


def compile_millennium_theme(
    loader: Loader,
    output_root: Path | str | None = None,
    themes_root: Path | str | None = None,
) -> dict:
    """Publish CSS Loader's resolved injects for the Millennium companion.

    Despite the historical function name, this no longer compiles or rewrites
    CSS bundles. The app publishes exact translated payloads in CSS Loader
    cascade order and the companion applies them as individual style elements.
    """
    publish_to_live_runtime = output_root is None
    output_root = Path(output_root) if output_root is not None else default_millennium_theme_path()
    themes_root = Path(themes_root) if themes_root is not None else Path(get_theme_path())
    output_root.mkdir(parents=True, exist_ok=True)

    synced_theme_assets = []
    if publish_to_live_runtime:
        synced_theme_assets = _sync_active_theme_assets(
            loader,
            themes_root,
            Path(get_steam_path()) / "steamui" / "themes_custom",
        )

    injections = []
    target_report: dict[str, dict] = {}

    for inject in _enabled_injects():
        css, origin = _resolved_inject_css(inject, themes_root)
        seen_targets = set()
        for tab in inject.tabs:
            for target in _targets_for_tab(tab):
                if target.key in seen_targets:
                    continue
                seen_targets.add(target.key)
                injection_id = f"{inject.activation_order}:{target.key}"
                injections.append(
                    {
                        "id": injection_id,
                        "target": target.key,
                        "matchRegex": target.match_regex,
                        "source": origin,
                        "css": css,
                    }
                )
                summary = target_report.setdefault(
                    target.key,
                    {"match": target.match_regex, "injections": 0, "bytes": 0},
                )
                summary["injections"] += 1
                summary["bytes"] += len(css.encode("utf-8"))

    hash_input = json.dumps(injections, ensure_ascii=False, separators=(",", ":"))
    content_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()
    state = {
        "protocolVersion": PROTOCOL_VERSION,
        "contentHash": content_hash,
        "injections": injections,
    }
    report = {
        "theme": THEME_NAME,
        "themeDisplayName": THEME_DISPLAY_NAME,
        "runtimeMode": RUNTIME_MODE,
        "protocolVersion": PROTOCOL_VERSION,
        "stateFile": STATE_FILE,
        "output": str(output_root),
        "enabledThemes": [theme.name for theme in loader.themes if theme.enabled],
        "syncedThemeAssets": synced_theme_assets,
        "selectedInjects": len(list(_enabled_injects())),
        "publishedInjections": len(injections),
        "contentHash": content_hash,
        "targets": target_report,
        # An empty patch list makes older companion versions remove their
        # generated bundle links while the new direct runtime takes over.
        "patches": [],
    }
    skin = {
        "name": THEME_DISPLAY_NAME,
        "author": "CSS Loader contributors",
        "description": "Runtime state host for the CSS Loader Millennium companion.",
        "version": "1.2",
        "Patches": [],
    }

    _remove_legacy_compiler_output(output_root)
    _atomic_write(output_root / "skin.json", json.dumps(skin, indent=2) + "\n")
    # Publish state before its revision. The companion only accepts a state
    # whose hash matches the latest report, avoiding partially-written updates.
    _atomic_write(
        output_root / STATE_FILE,
        json.dumps(state, indent=2, ensure_ascii=False) + "\n",
    )
    _atomic_write(output_root / "build-report.json", json.dumps(report, indent=2) + "\n")
    Log(
        f"Published {len(injections)} direct CSS Loader injections "
        f"across {len(target_report)} Millennium targets"
    )
    return report


async def build_from_disk(output_root: Path | str | None = None) -> dict:
    initialize_class_mappings()
    loader = Loader()
    await loader.load(False)
    return compile_millennium_theme(loader, output_root=output_root)

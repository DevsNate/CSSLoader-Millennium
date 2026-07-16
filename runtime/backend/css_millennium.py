import json
import hashlib
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
    """Return the same document target used by Decky's CSS Loader.

    Steam exposes Main Menu and Quick Access as separate browser-view
    documents.  Millennium's runtime bridge is responsible for reaching those
    documents; folding their bundles into Big Picture changes selector scope
    and cascade order compared with Decky's reference behavior.
    """
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


def _relative_asset_url(source_css: Path, themes_root: Path, raw_url: str) -> str:
    value = raw_url.strip().strip('"\'')
    lower = value.lower()
    if not value or lower.startswith(("data:", "http:", "https:", "blob:", "var(")) or value.startswith("#"):
        return raw_url

    normalized = value.replace("\\", "/")
    if normalized.lower().startswith("/themes_custom/"):
        relative = normalized[len("/themes_custom/") :]
    elif normalized.startswith("/"):
        return raw_url
    else:
        try:
            relative = (source_css.parent / normalized).resolve().relative_to(themes_root.resolve()).as_posix()
        except ValueError:
            return raw_url

    return '"../assets/themes/' + relative.replace('"', '\\"') + '"'


URL_PATTERN = re.compile(r"url\(\s*([^)]*?)\s*\)", re.IGNORECASE)


def _rewrite_asset_urls(css: str, source_css: Path, themes_root: Path) -> str:
    return URL_PATTERN.sub(
        lambda match: "url(" + _relative_asset_url(source_css, themes_root, match.group(1)) + ")",
        css,
    )


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8", errors="replace") == content:
        return
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def _copy_theme_sources(loader: Loader, themes_root: Path, output_root: Path) -> list[str]:
    copied = []
    destination_root = output_root / "assets" / "themes"
    destination_root.mkdir(parents=True, exist_ok=True)

    for theme in sorted((theme for theme in loader.themes if theme.enabled), key=lambda item: item.name.lower()):
        source = Path(theme.themePath)
        try:
            relative = source.resolve().relative_to(themes_root.resolve())
        except ValueError:
            continue
        destination = destination_root / relative
        shutil.copytree(source, destination, dirs_exist_ok=True)
        copied.append(relative.as_posix())
    return copied


def _enabled_injects() -> Iterable:
    return iter(
        sorted(
            (inject for inject in ALL_INJECTS if inject.enabled),
            key=lambda inject: inject.activation_order,
        )
    )


def compile_millennium_theme(
    loader: Loader,
    output_root: Path | str | None = None,
    themes_root: Path | str | None = None,
) -> dict:
    output_root = Path(output_root) if output_root is not None else default_millennium_theme_path()
    themes_root = Path(themes_root) if themes_root is not None else Path(get_theme_path())
    output_root.mkdir(parents=True, exist_ok=True)

    copied_themes = _copy_theme_sources(loader, themes_root, output_root)
    bundles: dict[MillenniumTarget, list[str]] = {}
    selected_injects = 0

    for inject in _enabled_injects():
        selected_injects += 1
        # CSS variables and patch components are generated in memory. Some
        # component injects retain a placeholder path ("/" on CSS Loader
        # Desktop), so prefer their generated CSS before considering cssPath.
        if inject.css is not None:
            css = inject.css.replace("/themes_custom/", "../assets/themes/")
            origin = "generated CSS variable"
        elif inject.cssPath:
            source_css = Path(inject.cssPath)
            css = source_css.read_text(encoding="utf-8", errors="replace")
            css = _translate_classes(css)
            css = _rewrite_asset_urls(css, source_css, themes_root)
            origin = source_css.resolve().relative_to(themes_root.resolve()).as_posix()
        else:
            css = ""
            origin = "generated CSS variable"

        block = f"\n/* CSS Loader source: {origin} */\n{css.rstrip()}\n"
        for tab in inject.tabs:
            for target in _targets_for_tab(tab):
                if block not in bundles.setdefault(target, []):
                    bundles[target].append(block)

    patches = []
    bundle_report = {}
    content_hash = hashlib.sha256()
    generated_root = output_root / "generated"
    generated_root.mkdir(parents=True, exist_ok=True)

    for target in sorted(bundles, key=lambda item: item.key):
        relative_path = f"generated/{target.key}.css"
        content = (
            "/* Generated by CSS Loader. Changes will be overwritten. */\n"
            + "".join(bundles[target])
        )
        _atomic_write(output_root / relative_path, content)
        content_hash.update(target.key.encode("utf-8"))
        content_hash.update(b"\0")
        content_hash.update(content.encode("utf-8"))
        patches.append({"MatchRegexString": target.match_regex, "TargetCss": relative_path})
        bundle_report[target.key] = {
            "match": target.match_regex,
            "blocks": len(bundles[target]),
            "bytes": len(content.encode("utf-8")),
        }

    skin = {
        "name": THEME_NAME,
        "author": "CSS Loader contributors",
        "description": "Generated Millennium runtime for existing CSS Loader themes and configuration.",
        "version": "0.1.0",
        "Patches": patches,
    }
    _atomic_write(output_root / "skin.json", json.dumps(skin, indent=2) + "\n")

    report = {
        "theme": THEME_NAME,
        "output": str(output_root),
        "enabledThemes": [theme.name for theme in loader.themes if theme.enabled],
        "copiedThemeFolders": copied_themes,
        "selectedInjects": selected_injects,
        "contentHash": content_hash.hexdigest(),
        "bundles": bundle_report,
        "patches": patches,
    }
    _atomic_write(output_root / "build-report.json", json.dumps(report, indent=2) + "\n")
    Log(
        f"Generated Millennium theme '{THEME_NAME}' with "
        f"{selected_injects} selected injects across {len(bundles)} target bundles"
    )
    return report


async def build_from_disk(output_root: Path | str | None = None) -> dict:
    initialize_class_mappings()
    loader = Loader()
    await loader.load(False)
    return compile_millennium_theme(loader, output_root=output_root)

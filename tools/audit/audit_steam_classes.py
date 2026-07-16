"""Audit CSS Loader theme selectors against the installed Steam UI bundles.

The translation file is deliberately *not* treated as evidence that a class is
current.  Only Steam's shipped JavaScript and CSS bundles count.  This catches
translation entries whose latest recorded hash is itself obsolete.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path


CLASS_SELECTOR = re.compile(r"\.([_a-zA-Z][-_a-zA-Z0-9]{2,})")
LEGACY_STEAM_CLASS = re.compile(
    r"^[a-z][a-z0-9]*_[A-Za-z][A-Za-z0-9_-]*_[A-Za-z0-9_-]{5}$"
)
RAW_HASH_CLASS = re.compile(r"^[_A-Za-z0-9-]{18,30}$")


@dataclass(frozen=True)
class StaleSelector:
    file: Path
    line: int
    source_class: str
    translated_class: str
    kind: str


def looks_like_raw_steam_hash(value: str) -> bool:
    """Return true for a minified Steam class without flagging normal names."""

    return bool(
        RAW_HASH_CLASS.fullmatch(value)
        and any(character.islower() for character in value)
        and any(character.isupper() for character in value)
        and any(character.isdigit() for character in value)
        and ("_" in value or "-" in value)
    )


def load_class_mappings(translations_path: Path) -> dict[str, str]:
    data = json.loads(translations_path.read_text(encoding="utf-8"))
    mappings: dict[str, str] = {}
    for versions in data.values():
        if len(versions) < 2:
            continue
        latest = versions[-1]
        for alias in versions[:-1]:
            mappings[alias] = latest
    return mappings


def official_bundle_files(steam_ui_root: Path) -> list[Path]:
    files: list[Path] = []
    for pattern in ("*.js", "*.css"):
        for path in steam_ui_root.rglob(pattern):
            lowered_parts = {part.lower() for part in path.parts}
            lowered_name = path.name.lower()
            if "themes_custom" in lowered_parts:
                continue
            if any(marker in lowered_name for marker in (".backup", ".bak")):
                continue
            files.append(path)
    return sorted(set(files))


def load_official_bundle_text(steam_ui_root: Path) -> tuple[str, int]:
    files = official_bundle_files(steam_ui_root)
    text = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore") for path in files
    )
    return text, len(files)


def audit_theme_classes(
    themes_root: Path,
    steam_ui_root: Path,
    translations_path: Path | None = None,
) -> tuple[list[StaleSelector], dict[str, int]]:
    translations_path = translations_path or themes_root / "css_translations.json"
    mappings = load_class_mappings(translations_path)
    bundle_text, bundle_count = load_official_bundle_text(steam_ui_root)

    stale: list[StaleSelector] = []
    candidate_count = 0
    css_files = list(themes_root.rglob("*.css"))

    for path in css_files:
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1
        ):
            for match in CLASS_SELECTOR.finditer(line):
                source_class = match.group(1)
                translated_class = mappings.get(source_class)
                if translated_class is not None:
                    kind = "mapped"
                elif LEGACY_STEAM_CLASS.fullmatch(source_class):
                    translated_class = source_class
                    kind = "legacy"
                elif looks_like_raw_steam_hash(source_class):
                    translated_class = source_class
                    kind = "raw-hash"
                else:
                    continue

                candidate_count += 1
                if translated_class not in bundle_text:
                    stale.append(
                        StaleSelector(
                            file=path.relative_to(themes_root),
                            line=line_number,
                            source_class=source_class,
                            translated_class=translated_class,
                            kind=kind,
                        )
                    )

    stats = {
        "bundle_files": bundle_count,
        "css_files": len(css_files),
        "candidate_occurrences": candidate_count,
        "present_occurrences": candidate_count - len(stale),
        "stale_occurrences": len(stale),
        "unique_stale_targets": len({item.translated_class for item in stale}),
    }
    return stale, stats


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find obsolete Steam class selectors in CSS Loader themes."
    )
    parser.add_argument(
        "--themes-root",
        type=Path,
        default=Path.home() / "homebrew" / "themes",
    )
    parser.add_argument(
        "--steam-ui-root",
        type=Path,
        default=Path(r"C:\Program Files (x86)\Steam\steamui"),
    )
    parser.add_argument("--translations", type=Path)
    args = parser.parse_args()

    stale, stats = audit_theme_classes(
        args.themes_root, args.steam_ui_root, args.translations
    )

    print(
        "Steam class audit: "
        f"{stats['present_occurrences']}/{stats['candidate_occurrences']} current; "
        f"{stats['stale_occurrences']} stale occurrences "
        f"({stats['unique_stale_targets']} unique)"
    )
    print(
        f"Scanned {stats['css_files']} theme CSS files against "
        f"{stats['bundle_files']} official Steam bundle files."
    )

    if stale:
        by_theme = Counter(item.file.parts[0] for item in stale)
        print("Stale occurrences by theme:")
        for theme, count in by_theme.most_common():
            print(f"  {theme}: {count}")
        print("Details:")
        for item in stale:
            print(
                f"  {item.file}:{item.line}: .{item.source_class} -> "
                f".{item.translated_class} [{item.kind}]"
            )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

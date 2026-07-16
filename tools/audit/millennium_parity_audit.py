"""Replay Decky's exhaustive reference matrix through Millennium's compiler logic.

The audit is read-only with respect to installed themes.  Theme.save is
replaced in this process so Loader can exercise its normal dependency and
patch state transitions without changing config_USER.json files on disk.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

RUNTIME_ROOT = Path(__file__).resolve().parents[2] / "runtime" / "backend"
sys.path.insert(0, str(RUNTIME_ROOT))

from css_inject import ALL_INJECTS, initialize_class_mappings
from css_loader import Loader
from css_millennium import _enabled_injects, _target_for_tab, _translate_classes
from css_theme import Theme
from css_utils import Result, get_theme_path


REFERENCE_TARGETS = ("bigpicture", "quickaccess", "mainmenu", "notifications")


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_css(value: str) -> str:
    return value.replace("\r\n", "\n").strip()


def _reference_styles(matrix_root: Path, state: dict[str, Any], target: str) -> list[str]:
    return [
        _normalize_css(
            (matrix_root / "css" / f"{style['sha256']}.css").read_text(
                encoding="utf-8", errors="replace"
            )
        )
        for style in state[target]["orderedStyles"]
    ]


def _compiler_styles(themes_root: Path) -> dict[str, list[str]]:
    """Collect selected CSS before Millennium-only asset URL rebasing.

    Decky's captured style text contains the source URL form.  URL rebasing is
    checked separately by compiler tests and the installed-profile comparison;
    keeping source URLs here makes every branch comparable without weakening
    image-option checks by masking URL values.
    """
    bundles: dict[str, list[tuple[str, str]]] = {key: [] for key in REFERENCE_TARGETS}
    for inject in _enabled_injects():

        if inject.css is not None:
            css = inject.css
            origin = "generated CSS variable"
        elif inject.cssPath:
            source = Path(inject.cssPath)
            css = _translate_classes(source.read_text(encoding="utf-8", errors="replace"))
            try:
                origin = source.resolve().relative_to(themes_root.resolve()).as_posix()
            except ValueError:
                origin = str(source.resolve())
        else:
            css = ""
            origin = "generated CSS variable"

        block = (origin, _normalize_css(css))
        for tab in inject.tabs:
            target = _target_for_tab(tab).key
            if target in bundles and block not in bundles[target]:
                bundles[target].append(block)

    return {key: [css for _, css in blocks] for key, blocks in bundles.items()}


def _compare_state(
    matrix_root: Path,
    label: str,
    expected: dict[str, Any],
    actual: dict[str, list[str]],
) -> list[dict[str, Any]]:
    mismatches: list[dict[str, Any]] = []
    for target in REFERENCE_TARGETS:
        wanted = _reference_styles(matrix_root, expected, target)
        got = actual[target]
        if wanted == got:
            continue

        same_payloads = Counter(wanted) == Counter(got)

        first_difference = None
        for index, (left, right) in enumerate(zip(wanted, got)):
            if left != right:
                first_difference = index
                break
        if first_difference is None and len(wanted) != len(got):
            first_difference = min(len(wanted), len(got))

        mismatches.append(
            {
                "state": label,
                "target": target,
                "kind": "order" if same_payloads else "payload",
                "expectedCount": len(wanted),
                "actualCount": len(got),
                "firstDifference": first_difference,
                "expectedHash": (
                    _sha256(wanted[first_difference])
                    if first_difference is not None and first_difference < len(wanted)
                    else None
                ),
                "actualHash": (
                    _sha256(got[first_difference])
                    if first_difference is not None and first_difference < len(got)
                    else None
                ),
            }
        )
    return mismatches


async def _disable_everything(loader: Loader) -> None:
    for inject in ALL_INJECTS:
        inject.enabled = False
    for theme in loader.themes:
        theme.enabled = False


async def _select_patch(theme: Theme, patch_name: str, value: str) -> None:
    patch = next(item for item in theme.patches if item.name == patch_name)
    if patch.value == value:
        return
    await patch.remove(False)
    if value in patch.options:
        patch.value = value
    if theme.enabled:
        await patch.inject(False)


async def _audit_profiles(profiles_root: Path, themes_root: Path) -> dict[str, Any]:
    profiles = json.loads((profiles_root / "profiles.json").read_text(encoding="utf-8"))
    loader = Loader()
    await loader.load(False)
    themes = {theme.name: theme for theme in loader.themes}
    mismatches: list[dict[str, Any]] = []
    checked_states = 0
    checked_targets = 0

    await _disable_everything(loader)
    mismatches.extend(
        _compare_state(
            profiles_root,
            "profiles/empty",
            profiles["emptyState"],
            _compiler_styles(themes_root),
        )
    )
    checked_states += 1
    checked_targets += len(REFERENCE_TARGETS)

    for profile in profiles["profiles"]:
        await _disable_everything(loader)
        theme = themes[profile["name"]]
        result = await loader._enable_theme(
            theme,
            set_deps=True,
            set_deps_value=True,
            inject_now=False,
        )
        if not result.success:
            raise RuntimeError(f"Unable to enable {theme.name}: {result.message}")
        mismatches.extend(
            _compare_state(
                profiles_root,
                f"profile/{theme.name}",
                profile["state"],
                _compiler_styles(themes_root),
            )
        )
        checked_states += 1
        checked_targets += len(REFERENCE_TARGETS)

    return {
        "profilesRoot": str(profiles_root.resolve()),
        "profiles": len(profiles["profiles"]),
        "checkedStates": checked_states,
        "checkedTargets": checked_targets,
        "mismatchCount": len(mismatches),
        "payloadMismatchCount": sum(item["kind"] == "payload" for item in mismatches),
        "orderMismatchCount": sum(item["kind"] == "order" for item in mismatches),
        "mismatches": mismatches,
        "success": not mismatches,
    }


async def audit(
    matrix_root: Path,
    output: Path | None = None,
    profiles_root: Path | None = None,
) -> dict[str, Any]:
    matrix = json.loads((matrix_root / "matrix.json").read_text(encoding="utf-8"))
    themes_root = Path(get_theme_path())

    async def read_only_save(_theme: Theme) -> Result:
        return Result(True)

    # Loader.load and its normal state transitions call save.  Suppress only
    # persistence; all parsing, dependency, patch, and injection logic remains
    # the production implementation.
    Theme.save = read_only_save  # type: ignore[method-assign]

    initialize_class_mappings()
    loader = Loader()
    await loader.load(False)
    themes = {theme.name: theme for theme in loader.themes}

    checked_states = 0
    checked_targets = 0
    mismatches: list[dict[str, Any]] = []

    await _disable_everything(loader)
    mismatches.extend(
        _compare_state(matrix_root, "empty", matrix["emptyState"], _compiler_styles(themes_root))
    )
    checked_states += 1
    checked_targets += len(REFERENCE_TARGETS)

    for theme_report in matrix["themes"]:
        await _disable_everything(loader)
        theme = themes[theme_report["name"]]
        result = await loader._enable_theme(
            theme,
            set_deps=True,
            set_deps_value=True,
            inject_now=False,
        )
        if not result.success:
            raise RuntimeError(f"Unable to enable {theme.name}: {result.message}")

        label = f"{theme.name}/base"
        mismatches.extend(
            _compare_state(matrix_root, label, theme_report["baseState"], _compiler_styles(themes_root))
        )
        checked_states += 1
        checked_targets += len(REFERENCE_TARGETS)

        patches = {patch.name: patch for patch in theme.patches}
        for patch_report in theme_report["patches"]:
            patch = patches[patch_report["name"]]
            for option in patch_report["options"]:
                await _select_patch(theme, patch.name, option["value"])
                label = f"{theme.name}/{patch.name}={option['value']}"
                mismatches.extend(
                    _compare_state(matrix_root, label, option["targets"], _compiler_styles(themes_root))
                )
                checked_states += 1
                checked_targets += len(REFERENCE_TARGETS)

            components = {component.name: component for component in patch.components}
            for component_report in patch_report["components"]:
                await _select_patch(theme, patch.name, component_report["on"])
                component = components[component_report["name"]]
                component.value = component_report["testValue"]
                result = component.generate()
                if not result.success:
                    raise RuntimeError(
                        f"Unable to generate {theme.name}/{patch.name}/{component.name}: "
                        f"{result.message}"
                    )
                if component.inject.enabled:
                    component.inject.activate()
                label = f"{theme.name}/{patch.name}/{component.name}={component.value}"
                mismatches.extend(
                    _compare_state(
                        matrix_root,
                        label,
                        component_report["targets"],
                        _compiler_styles(themes_root),
                    )
                )
                checked_states += 1
                checked_targets += len(REFERENCE_TARGETS)
                component.value = component_report["originalValue"]
                component.generate().raise_on_failure()
                if component.inject.enabled:
                    component.inject.activate()
                await _select_patch(theme, patch.name, patch_report["originalValue"])

            await _select_patch(theme, patch.name, patch_report["originalValue"])

    report = {
        "matrix": str(matrix_root.resolve()),
        "themesRoot": str(themes_root.resolve()),
        "themes": len(matrix["themes"]),
        "patches": sum(len(theme["patches"]) for theme in matrix["themes"]),
        "optionStates": sum(
            len(patch["options"])
            for theme in matrix["themes"]
            for patch in theme["patches"]
        ),
        "componentStates": sum(
            len(patch["components"])
            for theme in matrix["themes"]
            for patch in theme["patches"]
        ),
        "checkedStates": checked_states,
        "checkedTargets": checked_targets,
        "mismatchCount": len(mismatches),
        "payloadMismatchCount": sum(item["kind"] == "payload" for item in mismatches),
        "orderMismatchCount": sum(item["kind"] == "order" for item in mismatches),
        "mismatches": mismatches,
        "success": not mismatches,
    }
    if profiles_root is not None:
        profile_report = await _audit_profiles(profiles_root, themes_root)
        report["profileParity"] = profile_report
        report["success"] = report["success"] and profile_report["success"]
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("matrix", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--profiles", type=Path)
    args = parser.parse_args()
    report = asyncio.run(audit(args.matrix, args.output, args.profiles))
    summary = {key: value for key, value in report.items() if key != "mismatches"}
    summary["mismatchPreview"] = report["mismatches"][:10]
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

"""Capture Decky CSS Loader as the reference implementation.

The script talks to Decky's legacy plugin RPC through Steam's SharedJSContext
and inspects CSS Loader's live style elements through Steam's CDP endpoint.
It never imports or modifies the installed Decky plugin.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import shutil
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiohttp


DEFAULT_CDP_URL = "http://127.0.0.1:8080"
PLUGIN_NAME = "CSS Loader"
RELEVANT_TITLE = re.compile(
    r"^(Steam Big Picture Mode|Steam|SteamLibraryWindow|QuickAccess.*|MainMenu.*|notificationtoasts.*)$"
)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class DeckyReference:
    def __init__(self, cdp_url: str = DEFAULT_CDP_URL) -> None:
        self.cdp_url = cdp_url.rstrip("/")
        self.session: aiohttp.ClientSession | None = None
        self.browser_websocket: aiohttp.ClientWebSocketResponse | None = None
        self.command_id = 0
        self.target_sessions: dict[str, str] = {}

    async def __aenter__(self) -> "DeckyReference":
        self.session = aiohttp.ClientSession()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"{self.cdp_url}/json/version", timeout=5) as response:
            version = json.load(response)
        self.browser_websocket = await self.session.ws_connect(
            version["webSocketDebuggerUrl"], timeout=5
        )
        return self

    async def __aexit__(self, *_: object) -> None:
        if self.browser_websocket is not None:
            await self.browser_websocket.close()
            self.browser_websocket = None
        if self.session is not None:
            await self.session.close()
            self.session = None

    def targets(self) -> list[dict[str, Any]]:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"{self.cdp_url}/json/list", timeout=5) as response:
            return json.load(response)

    async def command(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        if self.browser_websocket is None:
            raise RuntimeError("DeckyReference must be used as an async context manager")
        self.command_id += 1
        command_id = self.command_id
        payload: dict[str, Any] = {"id": command_id, "method": method, "params": params or {}}
        if session_id is not None:
            payload["sessionId"] = session_id
        await self.browser_websocket.send_json(payload)
        while True:
            message = await self.browser_websocket.receive(timeout=30)
            if message.type != aiohttp.WSMsgType.TEXT:
                raise RuntimeError(f"Unexpected CDP response: {message.type}")
            data = json.loads(message.data)
            if data.get("id") != command_id:
                continue
            if "error" in data:
                raise RuntimeError(f"CDP {method} failed: {data['error']}")
            return data.get("result", {})

    async def target_session(self, target: dict[str, Any]) -> str:
        target_id = target["id"]
        existing = self.target_sessions.get(target_id)
        if existing is not None:
            return existing
        attached = await self.command(
            "Target.attachToTarget", {"targetId": target_id, "flatten": True}
        )
        session_id = attached["sessionId"]
        self.target_sessions[target_id] = session_id
        return session_id

    async def evaluate(self, target: dict[str, Any], expression: str) -> Any:
        session_id = await self.target_session(target)
        response = await self.command(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
            },
            session_id,
        )
        result = response.get("result", {})
        if "exceptionDetails" in response:
            raise RuntimeError(_json(response["exceptionDetails"]))
        if result.get("subtype") == "error":
            raise RuntimeError(result.get("description", "JavaScript evaluation failed"))
        return result.get("value")

    def shared_context(self) -> dict[str, Any]:
        target = next((item for item in self.targets() if item.get("title") == "SharedJSContext"), None)
        if target is None:
            raise RuntimeError("Decky's SharedJSContext target is not available")
        return target

    async def rpc(self, method: str, arguments: dict[str, Any] | None = None) -> Any:
        arguments = arguments or {}
        expression = f"""
        (async () => {{
          return await DeckyBackend.call(
            'loader/call_legacy_plugin_method',
            {_json(PLUGIN_NAME)},
            {_json(method)},
            {_json(arguments)}
          );
        }})()
        """
        response = await self.evaluate(self.shared_context(), expression)
        if not isinstance(response, dict) or not response.get("success"):
            raise RuntimeError(f"Decky RPC {method!r} failed: {response!r}")
        return response.get("result")

    async def capture_targets(self) -> list[dict[str, Any]]:
        captures: list[dict[str, Any]] = []
        expression = """
        (() => {
          const classes = new Map();
          document.querySelectorAll('[class]').forEach((element) => {
            element.classList.forEach((name) => classes.set(name, (classes.get(name) || 0) + 1));
          });
          const ids = [...document.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean);
          return {
            documentTitle: document.title,
            location: location.href,
            htmlClasses: [...document.documentElement.classList],
            bodyClasses: [...document.body.classList],
            classCounts: Object.fromEntries([...classes.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
            ids: [...new Set(ids)].sort(),
            styles: [...document.querySelectorAll('style.css-loader-style')].map((style, index) => ({
              index,
              id: style.id,
              css: style.textContent || ''
            })),
            millenniumLinks: [...document.querySelectorAll('link[rel="stylesheet"]')]
              .map((link) => link.href)
              .filter((href) => href.includes('millennium.host/v1/themes/CSS'))
          };
        })()
        """

        for target in self.targets():
            if target.get("type") != "page" or not RELEVANT_TITLE.match(target.get("title", "")):
                continue
            captured = await self.evaluate(target, expression)
            if not isinstance(captured, dict):
                continue
            captured["targetId"] = target.get("id")
            captured["targetTitle"] = target.get("title")
            captured["targetUrl"] = target.get("url")
            captures.append(captured)
        return captures

    async def capture_style_fingerprints(self, css_root: Path) -> dict[str, Any]:
        expression = """
        (() => ({
          title: document.title,
          styles: [...document.querySelectorAll('style.css-loader-style')].map((style, index) => ({
            index,
            id: style.id,
            css: style.textContent || ''
          })),
          millenniumLinks: [...document.querySelectorAll('link[rel="stylesheet"]')]
            .map((link) => link.href)
            .filter((href) => href.includes('millennium.host/v1/themes/CSS'))
        }))()
        """
        report: dict[str, Any] = {}
        for target in self.targets():
            title = target.get("title", "")
            key = target_key(title)
            if target.get("type") != "page" or key is None:
                continue
            captured = await self.evaluate(target, expression)
            ordered = []
            total_bytes = 0
            for style in captured.get("styles", []):
                css = style.get("css", "")
                digest = _sha256(css)
                path = css_root / f"{digest}.css"
                if not path.exists():
                    path.write_text(css, encoding="utf-8", newline="\n")
                size = len(css.encode("utf-8"))
                total_bytes += size
                ordered.append({"sha256": digest, "bytes": size})
            signature = _sha256("\n".join(item["sha256"] for item in ordered))
            report[key] = {
                "title": captured.get("title", title),
                "count": len(ordered),
                "bytes": total_bytes,
                "signature": signature,
                "orderedStyles": ordered,
                "millenniumLinks": captured.get("millenniumLinks", []),
            }
        return report


def target_key(title: str) -> str | None:
    if title == "Steam Big Picture Mode":
        return "bigpicture"
    if title in {"Steam", "SteamLibraryWindow"}:
        return "desktop"
    if title.startswith("QuickAccess"):
        return "quickaccess"
    if title.startswith("MainMenu"):
        return "mainmenu"
    if title.startswith("notificationtoasts"):
        return "notifications"
    return None


class ThemeConfigBackup:
    def __init__(self, themes_root: Path, backup_root: Path) -> None:
        self.themes_root = themes_root.resolve()
        self.backup_root = backup_root.resolve()
        self.original_paths: set[Path] = set()

    def create(self) -> None:
        if self.backup_root.exists():
            shutil.rmtree(self.backup_root)
        self.backup_root.mkdir(parents=True, exist_ok=True)
        for path in self.themes_root.rglob("config_USER.json"):
            relative = path.resolve().relative_to(self.themes_root)
            self.original_paths.add(relative)
            destination = self.backup_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)

    def restore(self) -> None:
        for path in self.themes_root.rglob("config_USER.json"):
            relative = path.resolve().relative_to(self.themes_root)
            if relative not in self.original_paths:
                path.unlink()
        for relative in self.original_paths:
            source = self.backup_root / relative
            destination = self.themes_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


async def snapshot(output: Path, cdp_url: str) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    css_root = output / "css"
    css_root.mkdir(parents=True, exist_ok=True)

    async with DeckyReference(cdp_url) as reference:
        themes = await reference.rpc("get_themes")
        load_errors = await reference.rpc("get_last_load_errors")
        targets = await reference.capture_targets()

    target_report = []
    unique_css: dict[str, dict[str, Any]] = {}
    millennium_links = []
    for target in targets:
        style_report = []
        for style in target.pop("styles", []):
            css = style.pop("css")
            digest = _sha256(css)
            css_path = css_root / f"{digest}.css"
            if not css_path.exists():
                css_path.write_text(css, encoding="utf-8", newline="\n")
            unique_css.setdefault(digest, {"sha256": digest, "bytes": len(css.encode("utf-8"))})
            style_report.append({**style, "sha256": digest, "bytes": len(css.encode("utf-8"))})
        target["styles"] = style_report
        target["styleCount"] = len(style_report)
        target["styleBytes"] = sum(style["bytes"] for style in style_report)
        millennium_links.extend(target.get("millenniumLinks", []))
        target_report.append(target)

    theme_list = themes if isinstance(themes, list) else []
    summary = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "cdpUrl": cdp_url,
        "themeCount": len(theme_list),
        "enabledThemes": [theme["name"] for theme in theme_list if theme.get("enabled")],
        "presetThemes": [theme["name"] for theme in theme_list if "PRESET" in theme.get("flags", [])],
        "patchCount": sum(len(theme.get("patches", [])) for theme in theme_list),
        "optionCount": sum(
            len(patch.get("options", []))
            for theme in theme_list
            for patch in theme.get("patches", [])
        ),
        "componentCount": sum(
            len(patch.get("components", []))
            for theme in theme_list
            for patch in theme.get("patches", [])
        ),
        "uniqueCssCount": len(unique_css),
        "targetStyleCounts": {
            target["targetTitle"]: target["styleCount"] for target in target_report
        },
        "millenniumLinkCount": len(millennium_links),
        "loadErrors": load_errors,
    }
    _write_json(output / "themes.json", themes)
    _write_json(output / "targets.json", target_report)
    _write_json(output / "css-index.json", sorted(unique_css.values(), key=lambda item: item["sha256"]))
    _write_json(output / "summary.json", summary)
    return summary


def _state_signature(targets: dict[str, Any]) -> str:
    compact = {
        key: value.get("signature")
        for key, value in sorted(targets.items())
    }
    return _sha256(_json(compact))


async def _set_theme(reference: DeckyReference, name: str, state: bool) -> Any:
    result = await reference.rpc(
        "set_theme_state",
        {"name": name, "state": state, "set_deps": True, "set_deps_value": True},
    )
    if isinstance(result, dict) and not result.get("success", True):
        raise RuntimeError(f"set_theme_state({name!r}, {state}) failed: {result}")
    return result


async def _set_patch(reference: DeckyReference, theme: str, patch: str, value: str) -> Any:
    result = await reference.rpc(
        "set_patch_of_theme",
        {"themeName": theme, "patchName": patch, "value": value},
    )
    if isinstance(result, dict) and not result.get("success", True):
        raise RuntimeError(f"set_patch_of_theme({theme!r}, {patch!r}, {value!r}) failed: {result}")
    return result


async def _set_component(
    reference: DeckyReference,
    theme: str,
    patch: str,
    component: str,
    value: str,
) -> Any:
    result = await reference.rpc(
        "set_component_of_theme_patch",
        {
            "themeName": theme,
            "patchName": patch,
            "componentName": component,
            "value": value,
        },
    )
    if isinstance(result, dict) and not result.get("success", True):
        raise RuntimeError(
            f"set_component_of_theme_patch({theme!r}, {patch!r}, {component!r}) failed: {result}"
        )
    return result


async def _disable_everything(reference: DeckyReference) -> list[str]:
    disabled: list[str] = []
    for _ in range(6):
        themes = await reference.rpc("get_themes")
        enabled = [theme for theme in themes if theme.get("enabled")]
        if not enabled:
            return disabled
        enabled.sort(
            key=lambda theme: (
                "PRESET" not in theme.get("flags", []),
                -len(theme.get("dependencies", [])),
                theme.get("name", "").lower(),
            )
        )
        for theme in enabled:
            await _set_theme(reference, theme["name"], False)
            disabled.append(theme["name"])
    remaining = [theme["name"] for theme in await reference.rpc("get_themes") if theme.get("enabled")]
    if remaining:
        raise RuntimeError(f"Unable to disable all themes: {remaining}")
    return disabled


def _write_matrix_progress(output: Path, report: dict[str, Any]) -> None:
    _write_json(output / "matrix.json", report)


async def matrix(
    output: Path,
    cdp_url: str,
    themes_root: Path,
    only: set[str] | None = None,
) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    css_root = output / "css"
    css_root.mkdir(parents=True, exist_ok=True)
    backup = ThemeConfigBackup(themes_root, output / "config-backup")
    backup.create()

    report: dict[str, Any] = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "completedAt": None,
        "restored": False,
        "themes": [],
        "errors": [],
    }

    async with DeckyReference(cdp_url) as reference:
        original_themes = await reference.rpc("get_themes")
        _write_json(output / "original-themes.json", original_themes)
        try:
            await _disable_everything(reference)
            empty_state = await reference.capture_style_fingerprints(css_root)
            report["emptyState"] = empty_state
            report["emptySignature"] = _state_signature(empty_state)

            candidates = [
                theme
                for theme in original_themes
                if "PRESET" not in theme.get("flags", [])
                and (not only or theme.get("name") in only)
            ]
            for theme_index, original_theme in enumerate(candidates, start=1):
                name = original_theme["name"]
                theme_report: dict[str, Any] = {
                    "name": name,
                    "index": theme_index,
                    "total": len(candidates),
                    "dependencies": original_theme.get("dependencies", []),
                    "patches": [],
                    "errors": [],
                }
                report["themes"].append(theme_report)
                try:
                    await _disable_everything(reference)
                    await _set_theme(reference, name, True)
                    enabled = [
                        theme["name"]
                        for theme in await reference.rpc("get_themes")
                        if theme.get("enabled")
                    ]
                    base_state = await reference.capture_style_fingerprints(css_root)
                    theme_report["enabledThemes"] = enabled
                    theme_report["baseState"] = base_state
                    theme_report["baseSignature"] = _state_signature(base_state)

                    for original_patch in original_theme.get("patches", []):
                        patch_name = original_patch["name"]
                        original_value = original_patch.get("value", original_patch.get("default", ""))
                        patch_report: dict[str, Any] = {
                            "name": patch_name,
                            "type": original_patch.get("type"),
                            "originalValue": original_value,
                            "options": [],
                            "components": [],
                            "errors": [],
                        }
                        theme_report["patches"].append(patch_report)
                        option_signatures: dict[str, list[str]] = {}
                        for option in original_patch.get("options", []):
                            option_report: dict[str, Any] = {"value": option}
                            patch_report["options"].append(option_report)
                            try:
                                await _set_patch(reference, name, patch_name, option)
                                state = await reference.capture_style_fingerprints(css_root)
                                signature = _state_signature(state)
                                option_report["signature"] = signature
                                option_report["targets"] = state
                                option_signatures.setdefault(signature, []).append(option)
                            except Exception as error:  # continue the exhaustive run
                                message = str(error)
                                option_report["error"] = message
                                patch_report["errors"].append({"value": option, "error": message})

                        patch_report["duplicateOutputGroups"] = [
                            values for values in option_signatures.values() if len(values) > 1
                        ]

                        for component in original_patch.get("components", []):
                            component_report: dict[str, Any] = {
                                "name": component["name"],
                                "type": component.get("type"),
                                "on": component.get("on"),
                                "originalValue": component.get("value"),
                                "testValue": "#12ab34",
                            }
                            patch_report["components"].append(component_report)
                            try:
                                await _set_patch(reference, name, patch_name, component.get("on", original_value))
                                await _set_component(
                                    reference,
                                    name,
                                    patch_name,
                                    component["name"],
                                    component_report["testValue"],
                                )
                                state = await reference.capture_style_fingerprints(css_root)
                                component_report["signature"] = _state_signature(state)
                                component_report["targets"] = state
                                await _set_component(
                                    reference,
                                    name,
                                    patch_name,
                                    component["name"],
                                    component.get("value", ""),
                                )
                            except Exception as error:
                                message = str(error)
                                component_report["error"] = message
                                patch_report["errors"].append(
                                    {"component": component["name"], "error": message}
                                )
                            finally:
                                try:
                                    await _set_patch(reference, name, patch_name, original_value)
                                except Exception as error:
                                    patch_report["errors"].append(
                                        {"restoreValue": original_value, "error": str(error)}
                                    )

                        try:
                            await _set_patch(reference, name, patch_name, original_value)
                        except Exception as error:
                            patch_report["errors"].append(
                                {"restoreValue": original_value, "error": str(error)}
                            )
                except Exception as error:
                    message = str(error)
                    theme_report["errors"].append(message)
                    report["errors"].append({"theme": name, "error": message})
                finally:
                    try:
                        await _disable_everything(reference)
                    except Exception as error:
                        report["errors"].append({"theme": name, "cleanupError": str(error)})
                    _write_matrix_progress(output, report)
                    print(f"[{theme_index}/{len(candidates)}] {name}", flush=True)
        finally:
            backup.restore()
            try:
                await reference.rpc("reset")
                report["restored"] = True
                report["restoredThemes"] = [
                    theme["name"]
                    for theme in await reference.rpc("get_themes")
                    if theme.get("enabled")
                ]
            except Exception as error:
                report["errors"].append({"restoreError": str(error)})
            report["completedAt"] = datetime.now(timezone.utc).isoformat()
            _write_matrix_progress(output, report)
    return report


async def profiles(output: Path, cdp_url: str, themes_root: Path) -> dict[str, Any]:
    """Capture each preset in isolation using Decky's production RPC path."""
    output.mkdir(parents=True, exist_ok=True)
    css_root = output / "css"
    css_root.mkdir(parents=True, exist_ok=True)
    backup = ThemeConfigBackup(themes_root, output / "config-backup")
    backup.create()
    report: dict[str, Any] = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "completedAt": None,
        "restored": False,
        "profiles": [],
        "errors": [],
    }

    async with DeckyReference(cdp_url) as reference:
        original_themes = await reference.rpc("get_themes")
        _write_json(output / "original-themes.json", original_themes)
        try:
            await _disable_everything(reference)
            report["emptyState"] = await reference.capture_style_fingerprints(css_root)
            presets = [theme for theme in original_themes if "PRESET" in theme.get("flags", [])]
            for index, preset in enumerate(presets, start=1):
                item: dict[str, Any] = {
                    "name": preset["name"],
                    "index": index,
                    "total": len(presets),
                    "dependencies": preset.get("dependencies", []),
                }
                report["profiles"].append(item)
                try:
                    await _disable_everything(reference)
                    await _set_theme(reference, preset["name"], True)
                    current = await reference.rpc("get_themes")
                    item["enabledThemes"] = [theme["name"] for theme in current if theme.get("enabled")]
                    item["state"] = await reference.capture_style_fingerprints(css_root)
                    item["signature"] = _state_signature(item["state"])
                except Exception as error:
                    item["error"] = str(error)
                    report["errors"].append({"profile": preset["name"], "error": str(error)})
                finally:
                    await _disable_everything(reference)
                    _write_json(output / "profiles.json", report)
                    print(f"[{index}/{len(presets)}] {preset['name']}", flush=True)
        finally:
            backup.restore()
            try:
                await reference.rpc("reset")
                report["restored"] = True
                report["restoredThemes"] = [
                    theme["name"]
                    for theme in await reference.rpc("get_themes")
                    if theme.get("enabled")
                ]
            except Exception as error:
                report["errors"].append({"restoreError": str(error)})
            report["completedAt"] = datetime.now(timezone.utc).isoformat()
            _write_json(output / "profiles.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp-url", default=DEFAULT_CDP_URL)
    subparsers = parser.add_subparsers(dest="command", required=True)
    snapshot_parser = subparsers.add_parser("snapshot", help="Capture the current Decky CSS Loader state")
    snapshot_parser.add_argument("output", type=Path)
    matrix_parser = subparsers.add_parser("matrix", help="Exercise every theme option through Decky")
    matrix_parser.add_argument("output", type=Path)
    matrix_parser.add_argument(
        "--themes-root",
        type=Path,
        default=Path.home() / "homebrew" / "themes",
    )
    matrix_parser.add_argument("--only", action="append", default=[])
    profiles_parser = subparsers.add_parser("profiles", help="Exercise every Decky preset/profile")
    profiles_parser.add_argument("output", type=Path)
    profiles_parser.add_argument(
        "--themes-root",
        type=Path,
        default=Path.home() / "homebrew" / "themes",
    )
    args = parser.parse_args()

    if args.command == "snapshot":
        result = asyncio.run(snapshot(args.output.resolve(), args.cdp_url))
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif args.command == "matrix":
        result = asyncio.run(
            matrix(
                args.output.resolve(),
                args.cdp_url,
                args.themes_root.resolve(),
                set(args.only) or None,
            )
        )
        print(
            json.dumps(
                {
                    "themes": len(result.get("themes", [])),
                    "errors": len(result.get("errors", [])),
                    "restored": result.get("restored"),
                    "output": str(args.output.resolve()),
                },
                indent=2,
            )
        )
    else:
        result = asyncio.run(
            profiles(args.output.resolve(), args.cdp_url, args.themes_root.resolve())
        )
        print(
            json.dumps(
                {
                    "profiles": len(result.get("profiles", [])),
                    "errors": len(result.get("errors", [])),
                    "restored": result.get("restored"),
                    "output": str(args.output.resolve()),
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()

import json
import ssl
import time
import uuid
from pathlib import Path

import aiohttp
import certifi

from css_utils import Log, get_theme_path


CATALOG_METADATA_FILE = ".css-loader-catalog.json"
SCOPE_OVERRIDE_FILE = ".css-loader-scope.json"
DEFAULT_API_URL = "https://api.deckthemes.com/"
VALID_SCOPES = {"all", "desktop", "gamepad"}
CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60


def _read_json(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError):
        return None


def _atomic_write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    temporary.replace(path)


def normalize_catalog_targets(record: dict) -> list[str]:
    targets = record.get("targets")
    if not isinstance(targets, list) or not targets:
        target = record.get("target")
        targets = [target] if isinstance(target, str) and target.strip() else []

    normalized = []
    for target in targets:
        if not isinstance(target, str):
            continue
        target = target.strip()
        if target and target not in normalized:
            normalized.append(target)
    return normalized


def scope_for_catalog_targets(targets: list[str]) -> str:
    """Map DeckThemes catalog targets to Steam UI modes.

    The catalog treats targets beginning with ``Desktop`` as desktop themes.
    The remaining CSS categories are the Gamepad/BPM catalog. A theme listed
    in both groups is intentionally available in both modes.
    """
    has_desktop = any(
        target.casefold() == "desktop" or target.casefold().startswith("desktop-")
        for target in targets
    )
    has_gamepad = any(
        not (
            target.casefold() == "desktop"
            or target.casefold().startswith("desktop-")
        )
        for target in targets
    )

    if has_desktop and has_gamepad:
        return "all"
    if has_desktop:
        return "desktop"
    if has_gamepad:
        return "gamepad"
    return "all"


def catalog_metadata_from_record(record: dict) -> dict:
    targets = normalize_catalog_targets(record)
    return {
        "schemaVersion": 1,
        "id": str(record.get("id", "")),
        "target": record.get("target") if isinstance(record.get("target"), str) else None,
        "targets": targets,
        "scope": scope_for_catalog_targets(targets),
        "source": "deckthemes",
        "fetchedAt": int(time.time()),
    }


def _theme_manifests(themes_root: Path) -> dict[str, tuple[Path, dict]]:
    manifests = {}
    if not themes_root.is_dir():
        return manifests

    for directory in themes_root.iterdir():
        if not directory.is_dir():
            continue
        manifest = _read_json(directory / "theme.json")
        if not manifest:
            continue
        theme_id = manifest.get("id")
        if isinstance(theme_id, str) and theme_id.strip():
            manifests[theme_id] = (directory, manifest)
    return manifests


def cache_catalog_record(record: dict, themes_root: Path | str | None = None) -> Path | None:
    themes_root = Path(themes_root) if themes_root is not None else Path(get_theme_path())
    theme_id = record.get("id")
    if not isinstance(theme_id, str) or not theme_id:
        return None

    installed = _theme_manifests(themes_root).get(theme_id)
    if not installed:
        return None

    directory, _manifest = installed
    metadata_path = directory / CATALOG_METADATA_FILE
    _atomic_write_json(metadata_path, catalog_metadata_from_record(record))
    return metadata_path


def resolve_theme_catalog(theme_path: Path | str, manifest: dict) -> tuple[str, list[str]]:
    theme_path = Path(theme_path)

    override = _read_json(theme_path / SCOPE_OVERRIDE_FILE)
    if override and override.get("scope") in VALID_SCOPES:
        return override["scope"], []

    metadata = _read_json(theme_path / CATALOG_METADATA_FILE)
    if not metadata or metadata.get("id") != manifest.get("id"):
        return "all", []

    targets = normalize_catalog_targets(metadata)
    scope = metadata.get("scope")
    if scope not in VALID_SCOPES:
        scope = scope_for_catalog_targets(targets)
    return scope, targets


def _valid_catalog_id(theme_id: str) -> bool:
    try:
        uuid.UUID(theme_id)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _metadata_needs_refresh(directory: Path, theme_id: str, now: float) -> bool:
    metadata = _read_json(directory / CATALOG_METADATA_FILE)
    if not metadata or metadata.get("id") != theme_id:
        return True
    fetched_at = metadata.get("fetchedAt")
    return not isinstance(fetched_at, (int, float)) or now - fetched_at > CACHE_MAX_AGE_SECONDS


async def _fetch_catalog_records(theme_ids: list[str], base_url: str) -> list[dict]:
    if not theme_ids:
        return []
    base_url = base_url.rstrip("/") + "/"
    tls_context = ssl.create_default_context(cafile=certifi.where())
    timeout = aiohttp.ClientTimeout(total=15)
    records = []

    async with aiohttp.ClientSession(
        headers={"User-Agent": "css-loader-for-millennium/catalog-scope"},
        connector=aiohttp.TCPConnector(ssl=tls_context),
        timeout=timeout,
    ) as session:
        for start in range(0, len(theme_ids), 40):
            chunk = theme_ids[start:start + 40]
            url = f"{base_url}themes/ids?ids={'.'.join(chunk)}"
            async with session.get(url) as response:
                if response.status != 200:
                    raise RuntimeError(f"Catalog scope request returned HTTP {response.status}")
                payload = await response.json()
                if isinstance(payload, list):
                    records.extend(record for record in payload if isinstance(record, dict))
    return records


async def refresh_installed_catalog_metadata(
    themes_root: Path | str | None = None,
    base_url: str = DEFAULT_API_URL,
) -> int:
    """Backfill missing/stale catalog scopes without making startup depend on the API."""
    themes_root = Path(themes_root) if themes_root is not None else Path(get_theme_path())
    manifests = _theme_manifests(themes_root)
    now = time.time()
    theme_ids = [
        theme_id
        for theme_id, (directory, _manifest) in manifests.items()
        if _valid_catalog_id(theme_id)
        and _metadata_needs_refresh(directory, theme_id, now)
    ]
    if not theme_ids:
        return 0

    try:
        records = await _fetch_catalog_records(theme_ids, base_url)
    except Exception as error:
        Log(f"Could not refresh DeckThemes catalog scopes: {error}")
        return 0

    cached = 0
    for record in records:
        if cache_catalog_record(record, themes_root) is not None:
            cached += 1
    Log(f"Cached DeckThemes catalog scope for {cached} installed themes")
    return cached

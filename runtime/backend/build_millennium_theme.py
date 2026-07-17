import argparse
import asyncio
import json
from pathlib import Path

from css_millennium import build_from_disk, default_millennium_runtime_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish direct CSS Loader state for the Millennium companion.")
    parser.add_argument(
        "--output",
        type=Path,
        default=default_millennium_runtime_path(),
        help="Destination for the Millennium runtime state files.",
    )
    args = parser.parse_args()
    report = asyncio.run(build_from_disk(args.output))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

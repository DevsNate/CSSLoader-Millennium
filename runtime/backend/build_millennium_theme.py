import argparse
import asyncio
import json
from pathlib import Path

from css_millennium import build_from_disk, default_millennium_theme_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Millennium CSS Loader overlay from existing CSSLoader themes.")
    parser.add_argument(
        "--output",
        type=Path,
        default=default_millennium_theme_path(),
        help="Destination for the generated Millennium CSS and asset host.",
    )
    args = parser.parse_args()
    report = asyncio.run(build_from_disk(args.output))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

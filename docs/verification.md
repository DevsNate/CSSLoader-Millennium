# Compatibility verification

The initial Millennium implementation was compared against a clean Decky CSS
Loader reference captured on July 16, 2026. Decky was treated as the behavioral
source of truth; Millennium and the standalone runtime were stopped during the
reference capture.

## Coverage

| Measurement | Result |
| --- | ---: |
| Installed entries | 45 (42 themes, 3 profiles) |
| Patch controls | 120 |
| Selectable option states | 542 |
| Component and color states | 10 |
| Isolated theme/configuration states | 595 |
| Target snapshots | 2,380 |
| Unique CSS payloads parsed by Chromium | 652 |
| Translated/minified Steam class occurrences | 945 |

Each state was checked across Big Picture, Quick Access, Main Menu, and
notifications. The final compiler produced **zero payload mismatches and zero
insertion-order mismatches** across all 2,380 target snapshots. All three saved
profiles also matched their Decky reference ordering.

## Reference health

- 0 Decky RPC/load errors
- 0 stale or duplicate style payloads in clean captures
- 0 non-default options with no output change
- 0 Chromium CSS parse errors
- 0 missing local image/font assets out of 22 references
- 0 obsolete translated Steam selectors out of 945 occurrences

One reference warning was external to the compiler: `Art Hero` declared
`Game Header Text Stroke` as a dependency, but that companion theme was not
installed. Decky skips missing dependencies, and the Millennium compiler
matches that behavior.

## Reproducing an audit

The scripts in `tools/audit` support class-map checks, Decky reference capture,
and Millennium comparison. Raw matrices are deliberately ignored because they
contain installed third-party theme contents and local paths.

Run captures on a disposable test profile, restore the original profile after
the scan, and publish only sanitized aggregate results. See
`fixtures/parity/README.md` for the repository policy.

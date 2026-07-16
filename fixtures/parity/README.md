# Local parity fixtures

The parity tools can create a local `generated/` directory here. That output is
ignored intentionally because it can contain complete third-party theme CSS,
local configuration, and machine-specific paths.

Only sanitized aggregate results belong in `docs/verification.md`. Never commit
raw installed themes or a user's CSS Loader configuration as a fixture without
the author's permission and a compatible license.

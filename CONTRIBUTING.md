# Contributing

Thanks for helping make CSS Loader compatibility on Millennium more reliable.

## Before opening a pull request

1. Keep changes scoped to one behavior or compatibility issue.
2. Run `npm run verify` from the repository root on Windows.
3. Add or update a runtime test when changing compilation, ordering, class
   translation, target routing, or configuration behavior.
4. Do not commit installed themes, full Decky captures, Steam files, tokens, or
   machine-specific paths.
5. Describe the Steam channel, Millennium version, affected theme, target view,
   and exact option state when reporting a visual mismatch.

Clone with `--recurse-submodules`, or run `git submodule update --init`, before
building. Companion changes belong in
[`CSSLoader-Companion-Millennium`](https://github.com/DevsNate/CSSLoader-Companion-Millennium);
update this repository's pinned submodule commit after the companion change is
published.

## Compatibility reports

The most useful report includes:

- stable or beta Steam client;
- desktop, Big Picture, Quick Access, Main Menu, or notifications;
- theme and profile names;
- the option that differs from Decky CSS Loader;
- `standalone.log`, with personal paths removed;
- screenshots from both runtimes when possible.

Read [the verification guide](docs/verification.md) before recording a new
reference matrix.

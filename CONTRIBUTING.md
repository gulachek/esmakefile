<!-- CONTRIBUTING.md -->

# esmakefile

This document is intended for developers who are _contributing_
to `esmakefile`. It should not be necessary for _users_ (that
is, consumers) of the package to read these docs. User-facing
documentation belongs in `README.md`.

## TypeScript

`esmakefile` is fundamentally a TypeScript project whose target
is creating an npm package.

Use `npx tsc` to build the project.

During development, it's useful to run `npx tsc -w` to have
TypeScript watch for source changes and rebuild files as
necessary.

Files are output in the `dist` and `types` directories.

## Automated Testing

`mocha` is used as a test runner with `chai` as an assertion
library. Mocha is configured by `.mocharc.json`.

Tests are written in `src/spec/*.ts` and are output in
`dist/spec/*`. Mocha is configured to run on `dist/spec/*`.
Hence, it is expected that prior to running tests, you have run
`npx tsc` to build the source specs and associated source that
the specs are testing. This is rarely an issue when running `npx
tsc -w`.

The most notable spec is `src/spec/MakeProgramSpec.ts`, which
operates more as an end-to-end or integration test.

The testing paradigm is that the project should strive to only
test public behavior that the package is committed to
supporting. For example, if there's a helper class as part of
the package, it's preferred to not unit test it, and the public
behavior that it serves in the bigger picture of the package is
what should be tested. This allows maintainers to change things
that are changeable and fix things that should be fixed. This
must be exercised with pragmatism. If a complex algorithm is
implemented in a helper class and it seems unlikely to
frequently change, by all means maintainers should unit test
this functionality.

## Code Coverage

In a previous iteration, `nyc` was used as a code coverage tool.
This broke in a previous iteration when `esmakefile` was
converted to an ES module due to what seems to be
incompatibilities with `nyc`, `ts-node`, and ES modules. There
are relics in the repository and they're currently dead
configuration.

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

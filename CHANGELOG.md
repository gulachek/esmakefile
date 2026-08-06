# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added `MakeProgram` programmatic driver API
- Added `Makefile.include` API for multi-phase builds
- Added guidance to use OpenTelemetry for observability
- Added an OpenTelemetry-style logging API for observability
- Added an S3-style artifact storage API for observability
- Added `--debug` and `--trace` CLI switches for observability
- Documented CHANGELOG.md
- Allow specifying rules with only a target
- Added `rebasePath` API to replace `Path.gen`
- Added `--directory` CLI flag
- Added `RecipeArgs.restat` API
- Added API reference to `docs/typedoc`

### Changed

- Updated invocation to be via `npx esmakefile`
- Require users to export a `MakefileFn` as entry point
- Updated output style from complex TUI to logs
- Converted `Vt100Stream.contents` to bytes instead of string
- Allowed `MakefileFn` to be asynchronous
- Allowed `MakefileFn` to return a boolean result
- Renamed `Makefile.add` to `Makefile.rule`
- Split several `Makefile` APIs into `MakeProgram`
- Made `MakeProgram.hasTarget` async
- Made `MakeProgram.targets` async

### Removed

- Removed the `cli` API
- Removed the `Path` API
- Eliminated the "source path" and "build path" concepts
- Removed `updateTarget` API in favor of `MakeProgram`
- Removed `RecipeArgs.logStream` in favor of `getLogger` logs
- Removed `--development` CLI switch
- Stopped supporting postreqs

[Unreleased]: https://github.com/gulachek/esmakefile/compare/v0.6.3...HEAD

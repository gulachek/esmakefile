<!-- README.md -->

# esmakefile

esmakefile is a JavaScript build system inspired by Make.

The primary goal of esmakefile is to combine the robust concepts
of Make with the rich syntax and tooling available in the
JavaScript ecosystem. Hence, the familiar terminology of rules,
targets, prerequisites, and recipes is used.

It is _not_ the goal of esmakefile to accomodate every high
level use case for every language, framework, etc. With a robust
foundation of lower level tools available with esmakefile,
higher level tooling can be built to accomodate more targeted us
use cases.

## Quick Start

1. Install `esmakefile`:

```sh
npm install -D esmakefile
```

2. Write your build script

```javascript
// make.mjs - (Script can technically be named anything)
import { cli, Path } from 'esmakefile';

cli((mk) => {
	const hello = Path.build('hello');
	const hello_o = Path.build('hello.o');
	const hello_c = Path.src('hello.c');

	// 'all' phony target depends on 'hello'
	mk.add('all', [hello]);

	// Link 'hello' executable from compiled object files
	mk.add(hello, [hello_o], (args) => {
		return args.spawn('cc', ['-o', args.abs(hello), args.abs(hello_o)]);
	});

	// Compile C source into object files
	mk.add(hello_o, [hello_c], (args) => {
		return args.spawn('cc', ['-c', '-o', args.abs(hello_o), args.abs(hello_c)]);
	});
});
```

3. Run your build script

```sh
node make.mjs
```

4. Tailor the build system to your project!

## Concepts

This section broadly discusses the most essential concepts of
esmakefile. The concepts are divided into sub sections to help
the reader organize a conceptual model, but they generally do
not stand alone without the concepts pulled from the other
section.

For detailed API documentation, refer to the source
code's TSDoc comments and implementation. The main entrypoint
for the public API is `src/index.ts`.

### `Makefile` Rules

> [!NOTE]
> esmakefile builds on top of the conceptual model of
> traditional Make build systems. While the reader is encouraged
> to learn Make and its concepts, this documentation will at
> least touch on the minimal points to understand how to use
> esmakefile in a basic sense.

A Make build system, often referred to as a `Makefile`, is
conceptually a set of _rules_ describing how to update
_targets_. In order to update a _target_, there may be
dependencies on other sources called _prerequisites_, which
themselves can also be targets with their own rules. The set of
steps to run in order to update a target is called a _recipe_.

In the "Quick Start" example above, the `mk` object is an
instance of a `Makefile`. Each call to the `add` function adds a
new _rule_ to the `Makefile`. The first argument to `add`
specifies the rule's _target_. The other arguments can be a set
of _prerequisites_ and/or a _recipe_.

For example, the first call to `add` specifies that in order to
update the target `all`, then its prerequisite `hello` needs to
be up to date. The rule to update `hello` specifies that
`hello.o` is a prerequisite, and it specifies a recipe to
update `hello` itself, namely linking `hello.o` into an
executable file.

#### Postreqs

A "postreq" in esmakefile is a conceptual addition to the Make
model, and it's related to the "prereq" (prerequisite) concept
discussed above. For a given rule, both prereqs and postreqs are
required to functionally update the associated target. The
difference lies at _when_ this dependency is expressed in the
build system.

See the following example.

```javascript
const fileList = Path.src('file-list.txt');
const concat = Path.build('concat.txt');

mk.add(concat, [fileList], async (args) => {
	const paths = await parseFileList(fileList);
	const contents = [];

	for (const p of paths) {
		contents.push(readContents(p));
		args.addPostreq(p); // p should be an absolute path
	}

	await writeContents(args.abs(concat), contents);
});
```

The dependency of the `concat.txt` target on the `file-list.txt`
prereq is known _a priori_ to running the build system, whereas
the dependency of `concat.txt` on each individual path whose
contents are included is only known _a posteriori_ with respect
to running the associated recipe.

Postreqs are useful when integrating with other build tools. For
example, C compilers have a mechanism to output "dependency
files", listing all of the headers included when compiling a C
source file. Instead of requiring a user to specify the
dependency on all of these headers, the recipe can parse this
dependency file output and add the headers as postreqs, meaning
that as headers are changed, the compiled output will be kept up
to date automatically.

> [!WARNING]
> Postreqs do not work well when the postreq refers to the
> target of another rule. Doing so causes problems where
> esmakefile cannot update the higher level target when starting
> from a clean slate since it's unaware of the need to update
> the lower level target prior to updating the higher level one,
> often resulting in frustrating build failures.

### `Path` Objects

esmakefile is strict about which paths are allowed to be used
for targets and prereqs. They are always specified as `Path`
object instances which forces them to always be specified
relative to one of two special directories: the "source root"
and the "build root".

The "source root" is a read only directory, typically
representing the root directory of a code repository under
source control.

The "build root" is a read/write directory that is intended for
generated outputs of esmakefile. It should generally be ignored
by version control systems. The build root is usually a
subdirectory of the source root.

A path that exists within the build root is called a "build
path". A path that exists in the source root and is not a build
path is called a "source path".

Source paths may not be given as targets to rules. This is to
enforce that all generated outputs be placed in the build root,
making it easy for users to clean generated artifacts in a
single `rm` command and easy to ignore generated artifacts in
version control systems.

Either a source path or a build path may be given as a prereq.

Postreqs may refer to paths installed on a system that is
external to even the source root. Hence, postreqs are specified
only as raw absolute paths and are not specified by `Path`
objects.

`Path` objects may be instantiated either as relative paths to
the build or source root, or generated from other path objects.

```javascript
import { Path } from 'esmakefile';

// always use '/' as directory separator
const b = Path.build('my/build/path');
const s = Path.src('my/src/path');

const c = Path.src('hello.c');
const o = Path.gen(c, { ext: '.o' }); // same as Path.build('hello.o')
```

### CLI Driver

Most of the time, esmakefile is interacted with by a user
executing a JavaScript file from an interactive shell. As such,
a CLI driver function is supported, simply called `cli`, which
offers users the typical options that are expected to update
targets.

Refer to the "Quick Start" example above for typical usage, and
run with `node make.mjs help` to see which options are
supported.

#### Specifying Goals

A _goal_ in make refers to the top level target that is being
updated as part of the build system. By default, esmakefile
chooses the _first_ target specified by `add` as the goal. Users
can specify another goal simply by adding it to the shell
invocation.

```sh
node make.mjs <goal>
```

The format of `<goal>` is a path relative to the build root. In
other words, if the target desired to be updated is specified as
`Path.build('my/target.txt')`, then a user could update it with
`node make.mjs my/target.txt`.

#### Watch Mode

Watch mode is also supported by the CLI driver. In this mode, it
will watch the source root for changes, ignoring build root
changes to avoid thrashing. When a source file changes, it
updates the goal specified at the command line.

```sh
node make.mjs watch [goal]
```

### `MakeProgram` Programmatic Driver

In cases where esmakefile needs to be run outside the context of
a CLI environment, `MakeProgram` is exposed as a programmatic
way to run an esmakefile build system. First, it must be
"parsed" via `MakeProgram.parse`. Then, the parsed
`MakeProgram` can update a goal target with the `update()`
function. The goal that's updated can optionally be specified.

```js
import { MakeProgram } from 'esmakefile';

const make = await MakeProgram.parse((mk) => {
	mk.add('target', () => {
		// ...
	});
});

const success = await make.update(); // default goal
const success2 = await make.update(goal); // specific goal
```

### Observability

esmakefile builds on top of
[OpenTelemetry](https://opentelemetry.io/). The goal is to
provide rich analysis and diagnostic information for the user's
build system. The goal is _not_ to require users to set up
complex backend databases to store this telemetry like with high
availability cloud services, but rather to build on top of a
rich industry-standard framework. Hence, esmakefile's CLI acts
as an otel collector for local analysis.

#### Logs

Because the `@opentelemetry/api@1.9.1` package does not support
logs, esmakefile currently exposes a basic logging framework.

See the following example for basic usage.

```js
import { cli, getLogger, LogLevel } from 'esmakefile';

cli((mk) => {
	const logger = getLogger({ name: 'my.logger.name' });

    if (logger.enabled({ level: LogLevel.trace })) {
        logger.trace('My trace log');
    }

    if (logger.enabled({ level: LogLevel.debug })) {
        logger.debug('My debug log');
    }

    logger.warn('beware');

	mk.add('info', () => {
		logger.info('info target recipe is being run');
		logger.info({
            eventName: 'my.event.name',
            body: 'A display message',
            attributes: {
                'my.attribute': 'value'
            }
        });
	});

	mk.add('error', () => {
        try {
            throw new Error('hehe');
        } catch (ex) {
            logger.error({
                body: 'This is a test error',
                exception: ex
            });
        }
		return false;
	});

    if (/* really bad condition */) {
        logger.fatal('uhhhh wut?');
        process.exit(1);
    }
});
```

#### Artifact Storage

In addition to OpenTelemetry, esmakefile exposes a simple
S3-inspired API for artifact storage. This is intended for
special cases where telemetry may need to be enhanced with
potentially large payloads, such as associating a log or trace
with the output of a process. In this case, the process output
would be stored as an artifact with metadata like the output's
file format, and then visualization tools would confidently know
how to render the process's output when correlated with the
other telemetry.

See the following example for usage.

```js
import { getArtifactStore, getLogger, ATTR_ARTIFACT_ID } from 'esmakefile';

async function uploadHelloAndLog() {
	const store = getArtifactStore();
	const content = new TextEncoder().encode('hello');
	const artifactId = await store.put({ content, contentType: 'text/plain' });

	const logger = getLogger({ name: 'my.logger' });
	logger.info({
		body: 'Uploaded "hello"',
		attributes: {
			[ATTR_ARTIFACT_ID]: artifactId,
		},
	});
}
```

#### Semantic Conventions

For semantic conventions specific to esmakefile, such as logging
child process output, see
[docs/otel-conventions.md](./docs/otel-conventions.md).

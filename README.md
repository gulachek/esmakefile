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
higher level tooling can be built to accomodate more targeted
use cases.

## Quick Start

1. Install `esmakefile`:

```sh
npm install -D esmakefile
```

2. Write your build script

```javascript
// Makefile.mjs
import { join } from 'node:path';

export default function main(mk) {
	const hello = 'hello';
	const hello_o = 'hello.o';
	const hello_c = 'hello.c';

	// 'all' phony target depends on 'hello'
	mk.rule('all', [hello]);

	// Link 'hello' executable from compiled object files
	mk.rule(hello, [hello_o], (args) => {
		return args.spawn('cc', ['-o', hello, hello_o]);
	});

	// Compile C source into object files
	mk.rule(hello_o, [hello_c], (args) => {
		return args.spawn('cc', ['-c', '-o', hello_o, hello_c]);
	});
});
```

3. Run `npx make`

```sh
npx make
```

4. Tailor the build system to your project!

## Concepts

This section broadly discusses the most essential concepts of
esmakefile. The concepts are divided into sub sections to help
the reader organize a conceptual model, but the concepts
generally do not stand alone without concepts pulled from the
other sections.

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
instance of a `Makefile`. Each call to the `rule` function adds a
new _rule_ to the `Makefile`. The first argument to `rule`
specifies the rule's _target_. The other arguments can be a set
of _prerequisites_ and/or a _recipe_.

For example, the first call to `rule` specifies that in order to
update the target `all`, then its prerequisite `hello` needs to
be up to date. The rule to update `hello` specifies that
`hello.o` is a prerequisite, and it specifies a recipe to
update `hello` itself, namely linking `hello.o` into an
executable file.

### CLI Driver

Most of the time, esmakefile is interacted with by a user
authoring a JavaScript module specifying the build system and
running `npx make` from the shell. Refer to the "Quick Start"
example above for typical usage, and run with `npx make help` to
see which options are supported.

#### Module Naming Conventions

The module that's authored can be named any of the following:

- esmakefile.js
- makefile.js
- Makefile.js

The extension can also be `.mjs` or `.cjs` instead of `.js` for
explicit ES Module or CommonJS module systems.

It's recommended to use the name `Makefile.js` (or an explicit
`.mjs` or `.cjs`) variant, as this mimics the recommendation of
classic Makefile naming conventions, which itself recommends
this name since it sorts closely to the top of a directory
listing.

#### Specifying Goals

A _goal_ in make refers to the top level target that is being
updated as part of the build system. By default, esmakefile
chooses the _first_ target specified by `rule` as the goal. Users
can specify another goal simply by adding it to the shell
invocation.

```sh
npx make <goal>
```

The format of `<goal>` is a path relative to the build root. In
other words, if the target desired to be updated is specified as
`'my/target.txt'`, then a user could update it with `npx make
my/target.txt`.

#### Watch Mode

Watch mode is also supported by the CLI driver. In this mode, it
will watch the root directory for changes and update the goal
specified at the command line.

```sh
npx make watch [goal]
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
	mk.rule('target', () => {
		// ...
	});
});

if (!make) {
	// handle failure
}

const success = await make.update(); // default goal
const success2 = await make.update(goal); // specific goal
```

### Including a Nested `Makefile`

Nested `Makefile` instances can be "parsed" with the
`Makefile.include` function.

```js
// Makefile.mjs
export default function make(mk) {
	const nested = 'nested.mk';

	mk.include(nested, (mk) => {
		mk.rule(/*...*/);
	});

	mk.rule(nested, [/*...prereqs...*/]);
}
```

As seen in the above example, a path must be given to identify
the `Makefile` as a target. This target can be given to other
rules. All `include` files are "parsed" prior to updating a goal
provided to the CLI driver or `MakeProgram.update`. The term
"parsed" in this context means that the function provided to
`include` is invoked and the optionally returned `Promise`
resolves. Prior to "parsing" a given nested `Makefile`, its
target is updated following the standard conventions. Note that
this deviates a bit from standard GNU Make functionality in that
the `Makefile` is not "remade" when an included `Makefile` is
updated. This is not expected to be an issue. Unless the reader
is deeply familiar with GNU Make and understands what this
detail is referring to, it almost certainly doesn't matter.

Each included `Makefile` is updated and processed in order of
inclusion. This can cause some subtle issues to creep up. For
example, the following is broken:

```js
export default function make(mk) {
	mk.rule('a.mk', ['prereq']);

	mk.include('a.mk', () => {
      /* use 'prereq' somehow */
	});

	mk.include('b.mk', (mk) => {
		mk.rule('prereq', () => {
          /* create prereq */
		});
	});
});
```

This is because, while esmakefile is parsing the entire build
system, it attempts to include `a.mk` prior to `b.mk`. Prior to
including `a.mk`, it attempts to update `a.mk`. Because the
recipe to update `prereq` is defined in `b.mk`, and `b.mk`
hasn't yet been included, esmakefile will complain that there's
no rule to update the `prereq` target. In this example, it could
be fixed by either hoisting the rule that defines the recipe to
create `prereq` into the top level `Makefile`, or more simply
`b.mk` could be included before `a.mk` is included.

This order of processing is subject to change, meaning this
documented limitation may eventually be eliminated. Users who
find this limitation especially limiting should submit issues
clearly documenting use cases and why this isn't easy to work
around.

### Dependency Files

A common pattern in Make build systems, especially in C/C++
development, is to have a compiler output a "dependency file".
This dependency file contains Make rules describing which header
files are needed by which `.c` files so that developers only
need to `#include "header.h"` in the C code as opposed to in
explicit Make rules as well. The dependency file is then
included (via `include`) in the `Makefile` to pull those
generated rules into the build system.

This pattern is possible in esmakefile:

```js
mk.rule(['output', 'output.deps'], ['input'], async (args) => {
	// This is generic for demonstration purposes. The assumption
	// is that the compiler informs the user of which files, beyond
	// 'input', were used during compilation, as an array.
	const { content, listOfFilesUsed } = compile('input');

	// Write the normal content
	await writeFile('output', content);

	// Create a custom dependency file
	await writeFile('output.deps', JSON.stringify(listOfFilesUsed));
});

mk.rule('output.deps.mk', ['output.deps']);

mk.include('output.deps.mk', async (mk) => {
	const listOfFilesUsed = JSON.parse(await readFile('output.deps', 'utf8'));
	mk.rule('output', listOfFilesUsed);
});
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

export default function main(mk) {
	const logger = getLogger({ name: 'my.logger.name' });

    if (logger.enabled({ level: LogLevel.trace })) {
        logger.trace('My trace log');
    }

    if (logger.enabled({ level: LogLevel.debug })) {
        logger.debug('My debug log');
    }

    logger.warn('beware');

	mk.rule('info', () => {
		logger.info('info target recipe is being run');
		logger.info({
            eventName: 'my.event.name',
            body: 'A display message',
            attributes: {
                'my.attribute': 'value'
            }
        });
	});

	mk.rule('error', () => {
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

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

cli((make) => {
	const hello = Path.build('hello');
	const hello_o = Path.build('hello.o');
	const hello_c = Path.src('hello.c');

	make.add('all', [hello]);

	make.add(hello, [hello_o], (args) => {
		return args.spawn('cc', ['-o', args.abs(hello), args.abs(hello_o)]);
	});

	make.add(hello_o, [hello_c], (args) => {
		return args.spawn('cc', ['-c', '-o', args.abs(hello_o), args.abs(hello_c)]);
	});
});
```

3. Run your build script

```sh
node make.mjs
```

4. Tailor the build system to your project!

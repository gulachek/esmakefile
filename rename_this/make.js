const { Command } = require('commander');
const { CppBuildCommand } = require('gulpachek/cpp');

const program = new Command();
const cppBuild = new CppBuildCommand({
	program,
	cppVersion: 20
});

cppBuild.build((args) => {
	const { cpp } = args;

	const lib = cpp.compile({
		name: 'com.example.foo',
		version: '0.1.0',
		apiDef: 'FOO_API',
		src: [
			'foo.cpp'
		]
	});

	lib.include('include');

	const test = cpp.compile({
		name: `hello`,
		src: [`hello.cpp`]
	});

	test.link(lib);

	return test.executable();
});

program.parse();

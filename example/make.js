const { Command } = require('commander');
const { CppBuildCommand } = require('gulpachek/cpp');
const { spawn } = require('child_process');

const program = new Command();

const cppBuild = new CppBuildCommand({
	program,
	cppVersion: 20
});

function foo(cpp) {
	const lib = cpp.compile({
		name: 'com.example.foo',
		version: '0.1.0',
		src: ['src/foo.cpp'],
		apiDef: 'FOO_API'
	});

	lib.include('include');

	lib.define({
		FOO_DEFAULT_DEFINE: 'default',
		FOO_DEFINE: {
			implementation: 'implementation',
			interface: 'interface'
		}
	});

	return lib;
}

function build(args) {
	const { cpp } = args;
	
	const hello = cpp.compile({
		name: 'hello',
		src: [ 'hello.cpp' ]
	});

	const foolib = foo(cpp);

	hello.link(foolib);

	return hello.executable();
}

cppBuild.build((args) => {
	return build(args);
});

cppBuild.pack((args) => {
	const { cpp } = args;

	return foo(cpp);
});

const test = program.command('test')
.description('run hello');

cppBuild.configure(test, async (args) => {
	const { sys } = args;
	const exe = build(args);

	await sys.build(exe);
	return spawn(exe.abs(), [], { stdio: 'inherit' });
}
);

program.parse();

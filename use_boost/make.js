const { Command } = require('commander');
const { CppBuildCommand } = require('gulpachek/cpp');

const program = new Command();
const cppBuild = new CppBuildCommand({
	program,
	cppVersion: 20
});

function buildFoo(cpp) {
	const boost = {};
	boost.log = cpp.require('org.boost.log', '1.74.0');

	const foo = cpp.compile({
		name: 'com.example.foo',
		version: '0.1.0',
		apiDef: 'FOO_API',
		src: ['src/foo.cpp']
	});

	foo.include('include');
	foo.link(boost.log);

	return foo;
}

cppBuild.build((args) => {
	const { cpp } = args;

	const foo = buildFoo(cpp);

	const hello = cpp.compile({
		name: 'hello',
		src: ['src/hello.cpp']
	});

	hello.link(foo);

	return hello.executable();
});

program.parse();

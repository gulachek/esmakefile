const { Command } = require('commander');
const { CppBuildCommand } = require('gulpachek/cpp');

const program = new Command();
const cppBuild = new CppBuildCommand({
	program,
	cppVersion: 20
});

function buildFoo(cpp) {
	const dep = cpp.compile({
		name: 'com.example.dep',
		version: '0.1.0',
		apiDef: 'DEP_API',
		src: ['foo/dep.cpp']
	});

	dep.include('foo/include');

	const foo = cpp.compile({
		name: 'com.example.foo',
		version: '0.1.0',
		apiDef: 'FOO_API'
	});

	foo.include('foo/include');
	foo.link(dep);

	return foo;
}

cppBuild.build((args) => {
	const { cpp } = args;

	const foo = buildFoo(cpp);

	const hello = cpp.compile({
		name: 'hello',
		src: ['hello.cpp']
	});

	hello.link(foo);

	return hello.executable();
});

cppBuild.pack((args) => {
	const { cpp } = args;
	return buildFoo(cpp);
});

program.parse();

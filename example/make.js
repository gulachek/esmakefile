const { Command } = require('commander');
const { CppBuildCommand } = require('gulpachek/cpp');
const { foo } = require('./foo');
const { spawn } = require('child_process');

const program = new Command();

const cppBuild = new CppBuildCommand({
	program,
	cppVersion: 20
});

function build(args) {
	const { cpp } = args;
	
	const hello = cpp.compile({
		name: 'hello',
		src: [ 'hello.cpp' ]
	});

	const foolib = foo(cpp.sub('foo'));

	hello.link(foolib);

	return hello.executable();
}

cppBuild.build((args) => {
	return build(args);
});

cppBuild.pack((args) => {
	const { cpp } = args;

	return foo(cpp.sub('foo'));
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
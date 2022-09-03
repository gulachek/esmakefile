const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const [node, script, target] = process.argv;

if (!target) {
	console.log(`Usage: ${script} <target>`);
}

const { foo } = require('./foo');

const sys = new BuildSystem();
const cpp = new CppSystem({sys,
	cppVersion: 20
});

const hello = cpp.compile({
	name: 'hello',
	src: [ 'hello.cpp' ]
});

const foolib = foo(cpp.sub('foo'));

hello.link(foolib.archive());

if (target === 'build') {
	sys.build(hello.executable());
} else if (target === 'pack') {
	sys.build(cpp.packLibrary(foolib.archive()));
}

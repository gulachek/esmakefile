function foo(cpp) {

	const dep = cpp.compile({
		name: 'com.example.dep',
		version: '0.1.0',
		src: ['dep.cpp']
	});

	const lib = cpp.compile({
		name: 'com.example.foo',
		version: '0.1.0'
	});

	lib.include('include');
	lib.link(dep);
	return lib;
}

module.exports = {
	foo: foo
};

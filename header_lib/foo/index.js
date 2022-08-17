function foo(cpp) {

	const dep = cpp.compile({
		name: 'com.example.dep',
		version: '0.1.0',
		src: ['dep.cpp']
	});

	dep.define({
		DEP_API: { implementation: 'EXPORT', interface: 'IMPORT' }
	});

	dep.include('include');

	const lib = cpp.compile({
		name: 'com.example.foo',
		version: '0.1.0'
	});

	lib.include('include');
	lib.link(dep, { type: 'dynamic' });
	return lib;
}

module.exports = {
	foo: foo
};

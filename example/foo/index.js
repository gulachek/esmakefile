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

module.exports = {
	foo
};

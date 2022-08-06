function foo(cpp) {

	const dep = cpp.library('com.example.dep', '0.1.0',
		'dep.cpp'
	);

	const lib = cpp.library('com.example.foo', '0.1.0');
	lib.include('include');
	lib.link(dep);
	return lib;
}

module.exports = {
	foo: foo
};

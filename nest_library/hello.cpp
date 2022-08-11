#include <iostream>
#include "foo.hpp"

#ifdef FOO_PRIVATE
#error "FOO_PRIVATE is found in importing compilation"
#endif

int main() {
	std::cout << "hello world: " << foo() << std::endl;
	std::cout << "FOO_PUBLIC: " << FOO_PUBLIC << std::endl;

	return 0;
}

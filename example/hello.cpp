#include <iostream>
#include "foo.hpp"

int main() {

#ifndef NDEBUG
	std::cout << "hello debug world: " << foo() << std::endl;
#else
	std::cout << "hello release world: " << foo() << std::endl;
#endif

	return 0;
}

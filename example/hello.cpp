#include <iostream>
#include "foo.hpp"

#define QUOTE0(str) #str
#define QUOTE(str) QUOTE0(str)

int main() {

#ifndef NDEBUG
	std::cout << "hello debug world: " << foo() << std::endl;
#else
	std::cout << "hello release world: " << foo() << std::endl;
#endif

	std::cout << "From hello.cpp: " << std::endl;
	std::cout << "FOO_DEFAULT_DEFINE: " << QUOTE(FOO_DEFAULT_DEFINE) << std::endl;
	std::cout << "FOO_DEFINE: " << QUOTE(FOO_DEFINE) << std::endl;

	std::cout << "From bar(): " << std::endl;
	bar();

	return 0;
}

#include "foo.hpp"
#include <iostream>

#define QUOTE0(str) #str
#define QUOTE(str) QUOTE0(str)

int foo() { return 4; }

void bar()
{
	std::cout << "FOO_DEFAULT_DEFINE: " << QUOTE(FOO_DEFAULT_DEFINE) << std::endl;
	std::cout << "FOO_DEFINE: " << QUOTE(FOO_DEFINE) << std::endl;
}

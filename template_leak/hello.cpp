#include "lib.hpp"
#include <iostream>

int main()
{
	std::cout << "foo: " << foo() << std::endl;
	std::cout << "add_bar<3>: " << add_bar<3>() << std::endl;
	return 0;
}

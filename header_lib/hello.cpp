#include <iostream>
#include "foo.hpp"

int main() {
	std::cout << "hello world: " << foo<4>() << std::endl;
	return 0;
}

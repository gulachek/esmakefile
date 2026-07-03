#include "hello.hpp"

#include <cstdlib>
#include <iostream>

int main(int argc, char **argv) {
  hello();
  std::cout << "My own output." << std::endl;
  std::exit(EXIT_SUCCESS);
}

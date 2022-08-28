#ifndef FOO_HPP
#define FOO_HPP

#include "dep.hpp"

template <int Foo>
int foo() { return Foo + dep(); }

#endif

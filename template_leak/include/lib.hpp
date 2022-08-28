#ifndef LIB_HPP
#define LIB_HPP

#include <dep.hpp>

LIB_API int foo();

template <int N>
LIB_API int add_bar()
{
	return N + bar();
}

#endif

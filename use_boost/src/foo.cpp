#include "foo.hpp"

void foo(const char *str)
{
	BOOST_LOG_TRIVIAL(trace) << str;
}

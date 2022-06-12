#include <boost/log/trivial.hpp>

int main()
{
	BOOST_LOG_TRIVIAL(trace) << "trace logging";
	return 0;
}

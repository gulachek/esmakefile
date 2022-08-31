#ifndef FOO_HPP
#define FOO_HPP

class FOO_API bar
{
};

struct FOO_API dummy
{
	virtual ~dummy(){}
	virtual bar next() = 0;

};

class FOO_API foo : public dummy
{
	public:
		bar next() override;

	private:
		int base_;
};

template <int N>
bar fun()
{
	foo f{};
	return bar{};
}

#endif

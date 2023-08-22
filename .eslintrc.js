module.exports = {
	env: {
		node: true,
	},
	extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
	parser: '@typescript-eslint/parser',
	parserOptions: {
		tsconfigRootDir: __dirname,
	},
	plugins: ['mocha', '@typescript-eslint'],
	root: true,
};

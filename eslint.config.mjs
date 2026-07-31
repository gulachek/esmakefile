// @ts-check

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
	globalIgnores([
		'node_modules/',
		'dist/',
		'types/',
		'example/build/',
		'example/node_modules/',
	]),
	{
		files: ['**/*.{js,mjs,cjs}'],
		extends: [js.configs.recommended],
	},
	{
		files: ['**/*.{ts,mts,cts}'],
		extends: [js.configs.recommended, tseslint.configs.recommended],
	},
]);

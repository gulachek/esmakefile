// @ts-check

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** @import {Linter} from 'eslint' */
/** @type {Linter.RuleSeverityAndOptions} */
const noUnusedVars = [
	'warn',
	{
		argsIgnorePattern: '^_',
		varsIgnorePattern: '^_',
	},
];

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
		rules: {
			'no-unused-vars': noUnusedVars,
		},
	},
	{
		files: ['**/*.{ts,mts,cts}'],
		extends: [js.configs.recommended, tseslint.configs.recommended],
		rules: {
			'@typescript-eslint/no-unused-vars': noUnusedVars,
		},
	},
]);

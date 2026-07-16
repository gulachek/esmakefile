/** @import {IRule, Makefile, RecipeArgs} from 'esmakefile' */
/** @import {ClangObjectRecipe} from './ClangObjectRecipe.mjs' */

import { getLogger } from 'esmakefile';
import { addClangObject } from './ClangObjectRecipe.mjs';
import { open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** @implements {IRule} */
export class ClangExecutableRecipe {
	/**
	 * @param {string} exe
	 */
	constructor(exe) {
		/** @type {string} */
		this.exe = exe;
		/** @type {string[]} */
		this.objs = [];
	}

	targets() {
		return this.exe;
	}

	prereqs() {
		return this.objs;
	}

	/**
	 * @param {ClangObjectRecipe} obj
	 * @returns {void}
	 */
	addObj(obj) {
		this.objs.push(obj.obj);
	}

	/**
	 * @param {RecipeArgs} args
	 * @returns {Promise<boolean>}
	 */
	async recipe(args) {
		const exe = this.exe;
		const obs = this.objs;

		const clangArgs = ['-o', exe];
		clangArgs.push(...obs);

		return args.spawn('c++', clangArgs);
	}
}

/**
 * @param {Makefile} mk
 * @param {string} exePath
 * @param {string[]} src
 * @returns {ClangExecutableRecipe}
 */
export function addClangExecutable(mk, exePath, src) {
	const outDir = dirname(exePath);

	const exe = new ClangExecutableRecipe(exePath);

	const compileCommands = new CatRecipe(join(outDir, 'compile_commands.json'));
	compileCommands.addText('[');

	for (const s of src) {
		const obj = addClangObject(
			mk,
			s,
			join(outDir, s).replace(/.c(pp)?$/, '.o'),
		);
		exe.addObj(obj);
		compileCommands.addPath(obj.compileCommands);
	}

	compileCommands.addText(']');

	mk.rule(exe);
	mk.rule(compileCommands);

	return exe;
}

/**
 * @typedef {object} PathElem
 * @prop {'path'} type
 * @prop {number} index
 */

/**
 * @typedef {object} StringElem
 * @prop {'string'} type
 * @prop {string} value
 */

/**
 * @typedef {PathElem | StringElem} Elem
 */

/** @implements {IRule} */
class CatRecipe {
	/**
	 * @param {string} out
	 */
	constructor(out) {
		/** @type {string} */
		this.out = out;
		/** @private @type {string[]} */
		this._src = [];
		/** @private @type {Elem[]} */
		this._elems = [];
	}

	targets() {
		return this.out;
	}

	prereqs() {
		return this._src;
	}

	/**
	 * @param {string} src
	 * @returns {void}
	 */
	addPath(src) {
		const index = this._src.length;
		this._src.push(src);
		this._elems.push({ type: 'path', index });
	}

	/**
	 * @param {string} text
	 * @returns {void}
	 */
	addText(text) {
		this._elems.push({ type: 'string', value: text });
	}

	/**
	 * @returns {Promise<boolean>}
	 */
	async recipe() {
		const l = getLogger({ name: 'esmakefile.example.CatRecipe' });
		l.info(`Generating ${this.out}`);

		const out = this.out;
		const sources = this._src;

		const stream = await open(out, 'w');
		for (const elem of this._elems) {
			if (elem.type === 'string') {
				await stream.appendFile(elem.value);
			} else {
				const contents = await readFile(sources[elem.index], 'utf8');
				await stream.appendFile(contents);
			}
		}

		await stream.close();
		return true;
	}
}

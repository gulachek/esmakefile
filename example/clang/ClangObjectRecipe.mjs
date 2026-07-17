/** @import { IRule, Makefile, RecipeArgs } from 'esmakefile' */

import { readFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';

/** @implements {IRule} */
export class ClangObjectRecipe {
	/**
	 * @param {string} src
	 * @param {string} out
	 */
	constructor(src, out) {
		/** @type {string} */
		this.src = src;
		/** @type {string} */
		this.obj = out;
		/** @type {string} */
		this.depfile = join(dirname(out), basename(out) + '.depfile');
		/** @type {string} */
		this.compileCommands = join(
			dirname(out),
			basename(out) + '.compile_commands.json',
		);
	}

	targets() {
		return [this.obj, this.depfile, this.compileCommands];
	}

	prereqs() {
		return this.src;
	}

	/**
	 * @param {RecipeArgs} args
	 * @returns {Promise<boolean>}
	 */
	async recipe(args) {
		const [obj, depfile, cmds] = this.targets();
		const src = this.src;

		const clangArgs = [src, '-c', '-o', obj];
		clangArgs.push('-fcolor-diagnostics');
		clangArgs.push('-MMD', '-MF', depfile);
		clangArgs.push('-I', join(dirname(src), 'include'));
		clangArgs.push('-MJ', cmds);

		const result = await args.spawn('c++', clangArgs);
		if (!result) return false;

		const depfileContents = await readFile(depfile, 'utf8');
		const depfileLines = depfileContents.split('\n');
		depfileLines.shift(); // get rid of self
		for (const dep of depfileLines) {
			if (!dep) continue;
			if (dep.endsWith(' \\')) args.addPostreq(dep.slice(2, dep.length - 2));
			else args.addPostreq(dep.slice(2));
		}

		return true;
	}
}

/**
 * @param {Makefile} mk
 * @param {string} src
 * @param {string} dest
 * @returns {ClangObjectRecipe}
 */
export function addClangObject(mk, src, dest) {
	const obj = new ClangObjectRecipe(src, dest);
	mk.rule(obj);

	return obj;
}

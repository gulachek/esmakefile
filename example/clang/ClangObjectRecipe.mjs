/** @import { IRule, Makefile, RecipeArgs } from 'esmakefile' */

import { readFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { getLogger } from 'esmakefile';

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
	recipe(args) {
		const [obj, depfile, cmds] = this.targets();
		const src = this.src;

		const clangArgs = [src, '-c', '-o', obj];
		clangArgs.push('-fcolor-diagnostics');
		clangArgs.push('-MMD', '-MF', depfile);
		clangArgs.push('-I', join(dirname(src), 'include'));
		clangArgs.push('-MJ', cmds);

		return args.spawn('c++', clangArgs);
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

	const depfile = obj.depfile;

	const depfileMk = depfile + '.mk';
	mk.rule(depfileMk, [depfile]);
	mk.include(depfileMk, async (mk) => {
		const log = getLogger({ name: 'esmakefile.example.addClangObject' });

		const depfileContents = await readFile(depfile, 'utf8');
		const depfilePieces = depfileContents.split(/\s+/);

		if (depfilePieces.length > 0) {
			const first = depfilePieces.shift(); // get rid of self
			log.trace(`(${depfile}) dropping piece '${first}'`);
		}

		for (const dep of depfilePieces) {
			if (!dep) continue;
			log.trace(`(${depfile}) parsing content: ${dep}`);
			mk.rule(dest, [dep]);
		}
	});

	return obj;
}

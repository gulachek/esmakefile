import { IRule, Makefile, RecipeArgs } from '../../index.js';

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';

export class ClangObjectRecipe implements IRule {
	public src: string;
	public obj: string;
	public depfile: string;
	public compileCommands: string;

	constructor(src: string, out: string) {
		this.src = src;
		this.obj = out;
		this.depfile = join(dirname(out), basename(out) + '.depfile');
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

	async recipe(args: RecipeArgs): Promise<boolean> {
		const [obj, depfile, cmds] = this.targets().map((t) =>
			resolve(args.rootDir, t),
		);
		const src = resolve(args.rootDir, this.src);

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

export function addClangObject(mk: Makefile, src: string, dest: string) {
	const obj = new ClangObjectRecipe(src, dest);
	mk.rule(obj);

	return obj;
}

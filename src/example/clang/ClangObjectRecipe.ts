import {
	IRule,
	PathLike,
	IBuildPath,
	isBuildPathLike,
	BuildPathGenOpts,
	Path,
	Cookbook,
	RecipeArgs,
} from '../../index.js';

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class ClangObjectRecipe implements IRule {
	public src: Path;
	public obj: IBuildPath;
	public depfile: IBuildPath;
	public compileCommands: IBuildPath;

	constructor(src: Path, out: IBuildPath) {
		this.src = src;
		this.obj = out;
		this.depfile = out.dir().join(out.basename + '.depfile');
		this.compileCommands = out
			.dir()
			.join(out.basename + '.compile_commands.json');
	}

	targets() {
		return [this.obj, this.depfile, this.compileCommands];
	}

	prereqs() {
		return this.src;
	}

	async recipe(args: RecipeArgs): Promise<boolean> {
		const [obj, depfile, cmds] = args.abs(...this.targets());
		const src = args.abs(this.src);

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

export function addClangObject(
	book: Cookbook,
	src: PathLike,
	genOpts?: BuildPathGenOpts,
) {
	const srcPath = Path.src(src);
	const destPath = isBuildPathLike(genOpts)
		? Path.build(genOpts)
		: Path.gen(srcPath, { ext: '.o', ...genOpts });

	const obj = new ClangObjectRecipe(srcPath, destPath);
	book.add(obj);

	return obj;
}

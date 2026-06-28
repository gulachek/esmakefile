import { IRule, RecipeArgs, Makefile, getLogger } from '../../index.js';
import { addClangObject, ClangObjectRecipe } from './ClangObjectRecipe.js';
import { open, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export class ClangExecutableRecipe implements IRule {
	exe: string;
	objs: string[];

	constructor(exe: string) {
		this.exe = exe;
		this.objs = [];
	}

	targets() {
		return this.exe;
	}

	prereqs() {
		return this.objs;
	}

	addObj(obj: ClangObjectRecipe): void {
		this.objs.push(obj.obj);
	}

	async recipe(args: RecipeArgs): Promise<boolean> {
		const exe = resolve(args.rootDir, this.exe);
		const obs = this.objs.map((o) => resolve(args.rootDir, o));

		const clangArgs = ['-o', exe];
		clangArgs.push(...obs);

		return args.spawn('c++', clangArgs);
	}
}

export function addClangExecutable(
	mk: Makefile,
	exePath: string,
	src: string[],
): ClangExecutableRecipe {
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

type PathElem = {
	type: 'path';
	index: number;
};

type StringElem = {
	type: 'string';
	value: string;
};

type Elem = PathElem | StringElem;

class CatRecipe implements IRule {
	out: string;
	private _src: string[];
	private _elems: Elem[];

	constructor(out: string) {
		this.out = out;
		this._src = [];
		this._elems = [];
	}

	targets() {
		return this.out;
	}

	prereqs() {
		return this._src;
	}

	addPath(src: string): void {
		const index = this._src.length;
		this._src.push(src);
		this._elems.push({ type: 'path', index });
	}

	addText(text: string): void {
		this._elems.push({ type: 'string', value: text });
	}

	async recipe(args: RecipeArgs): Promise<boolean> {
		const l = getLogger({ name: 'esmakefile.example.CatRecipe' });
		l.info(`Generating ${this.out}`);

		const out = resolve(args.rootDir, this.out);
		const sources = this._src.map((s) => resolve(args.rootDir, s));

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

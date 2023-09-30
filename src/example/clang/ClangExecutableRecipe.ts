import {
	IRule,
	IBuildPath,
	Path,
	RecipeArgs,
	Cookbook,
	PathLike,
	BuildPathLike,
} from '../../index.js';
import { addClangObject, ClangObjectRecipe } from './ClangObjectRecipe.js';
import { open, readFile } from 'node:fs/promises';

export class ClangExecutableRecipe implements IRule {
	exe: IBuildPath;
	objs: Path[];

	constructor(exe: IBuildPath) {
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
		const exe = args.abs(this.exe);
		const sources = args.absAll(...this.objs);

		const clangArgs = ['-o', exe];
		clangArgs.push(...sources);

		return args.spawn('c++', clangArgs);
	}
}

export function addClangExecutable(
	book: Cookbook,
	out: BuildPathLike,
	src: PathLike[],
): ClangExecutableRecipe {
	const exePath = Path.build(out);
	const exe = new ClangExecutableRecipe(exePath);

	const compileCommands = new CatRecipe(Path.build('compile_commands.json'));
	compileCommands.addText('[');

	for (const s of src) {
		const obj = addClangObject(book, s);
		exe.addObj(obj);
		compileCommands.addPath(obj.compileCommands);
	}

	compileCommands.addText(']');

	book.add(exe);
	book.add(compileCommands);

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
	out: IBuildPath;
	private _src: Path[];
	private _elems: Elem[];

	constructor(out: IBuildPath) {
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

	addPath(src: Path): void {
		const index = this._src.length;
		this._src.push(src);
		this._elems.push({ type: 'path', index });
	}

	addText(text: string): void {
		this._elems.push({ type: 'string', value: text });
	}

	async recipe(args: RecipeArgs): Promise<boolean> {
		args.logStream.write(`Generating ${this.out}`, 'utf8');

		const out = args.abs(this.out);
		const sources = args.absAll(...this._src);

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

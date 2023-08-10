import {
	IRecipe,
	BuildPath,
	Path,
	RecipeBuildArgs,
	Cookbook,
	PathLike,
	BuildPathLike,
} from '../..';
import { addClangObject, ClangObjectRecipe } from './ClangObjectRecipe';
import { spawn, ChildProcess } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';

function procClosed(proc: ChildProcess): Promise<number> {
	return new Promise<number>((res) => {
		proc.on('close', (code: number) => res(code));
	});
}

export class ClangExecutableRecipe implements IRecipe {
	exe: BuildPath;
	objs: Path[];

	constructor(exe: BuildPath) {
		this.exe = exe;
		this.objs = [];
	}

	targets() {
		return this.exe;
	}

	sources() {
		return this.objs;
	}

	addObj(obj: ClangObjectRecipe): void {
		this.objs.push(obj.obj);
	}

	async buildAsync(args: RecipeBuildArgs): Promise<boolean> {
		const { sources, targets } = args.paths<ClangExecutableRecipe>();

		const clangArgs = ['-o', targets];
		clangArgs.push(...sources);

		console.log(`Linking executable ${this.exe}`);
		const proc = spawn('c++', clangArgs);
		const exitCode = await procClosed(proc);
		if (exitCode !== 0) return false;

		return true;
	}
}

export function addClangExecutable(
	book: Cookbook,
	out: BuildPathLike,
	src: PathLike[],
): ClangExecutableRecipe {
	const exePath = BuildPath.from(out);
	const exe = new ClangExecutableRecipe(exePath);

	const compileCommands = new CatRecipe(
		BuildPath.from('compile_commands.json'),
	);
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

class CatRecipe implements IRecipe {
	out: BuildPath;
	private _src: Path[];
	private _elems: Elem[];

	constructor(out: BuildPath) {
		this.out = out;
		this._src = [];
		this._elems = [];
	}

	targets() {
		return this.out;
	}

	sources() {
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

	async buildAsync(args: RecipeBuildArgs): Promise<boolean> {
		console.log(`Generating ${this.out}`);

		const { targets, sources } = args.paths<CatRecipe>();
		const stream = await open(targets, 'w');
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

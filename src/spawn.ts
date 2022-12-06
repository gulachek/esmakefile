import { BuildSystem } from './buildSystem';
import { ErrorFirstCallback, Target, TargetLike } from './target';

import { spawn, SpawnOptions, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';

class SpawnTarget extends Target
{
	private file: Target;
	private args: ReadonlyArray<string>;
	private opts: SpawnOptions;
	private evt: EventEmitter;

	constructor(
		sys: BuildSystem,
		file: TargetLike,
		args?: ReadonlyArray<string>,
		opts?: SpawnOptions
	)
	{
		super(sys);
		this.file = sys.src(file);
		this.args = args || [];
		this.opts = opts || {};
		this.evt = new EventEmitter();

		if (!this.opts.stdio)
			this.opts.stdio = 'inherit';
	}

	override deps()
	{
		return [this.file];
	}

	override recipe(cb: ErrorFirstCallback)
	{
		const abs = this.sys.abs(this.file);
		const p = spawn(abs, this.args, this.opts);
		this.evt.emit('spawn', p);
		return p;
	}

	on(evt: string, handler: (...args: any[]) => void)
	{
		this.evt.on(evt, handler);
	}
}

export function spawnTarget(
	sys: BuildSystem,
	file: TargetLike,
	args?: ReadonlyArray<string>,
	opts?: SpawnOptions
)
{
	return new SpawnTarget(sys, file, args, opts);
}

import { IBuild } from './Build.js';
import { render, Text, Box, Newline } from 'ink';
import React, { useState, useEffect, useMemo } from 'react';
import { IBuildPath } from './Path.js';
import { Cookbook } from './Cookbook.js';
import { FSWatcher } from 'node:fs';
import { watch } from 'node:fs';
import EventEmitter from 'node:events';
import { resolve } from 'node:path';

type VoidFunc = () => void;

interface IBuildBookProps {
	book: Cookbook;
	target?: IBuildPath;
}

function BuildBook(props: IBuildBookProps) {
	const { book, target } = props;

	const [result, setResult] = useState<boolean | null>(null);
	const [build, setBuild] = useState<IBuild | null>(null);
	const [continueBuild, setContinueBuild] = useState<VoidFunc | null>(null);

	useEffect(() => {
		book
			.build(target, (build) => {
				setBuild(build);
				return new Promise<void>((res) => {
					setContinueBuild(res);
				});
			})
			.then(setResult);
	}, [book, target]);

	if (build) {
		return (
			<BuildDisplay
				build={build}
				continueBuild={continueBuild}
				result={result}
			/>
		);
	} else {
		return <></>;
	}
}

interface IWatchBookProps extends IBuildBookProps {}

function WatchBook(props: IWatchBookProps) {
	const { book, target } = props;
	const [changeCount, setChangeCount] = useState(0);
	const watcher = useMemo(() => {
		return new SourceWatcher(book.srcRoot, {
			debounceMs: 300,
			excludeDir: book.buildRoot,
		});
	}, [book]);

	useEffect(() => {
		const inc = () => setChangeCount((c) => c + 1);
		const logUnknown = (type: string) =>
			console.log(`Unhandled event type '${type}'`);
		const closeWatcher = () => watcher.close();
		const drainStdin = () => process.stdin.read();

		watcher.on('change', inc);
		watcher.on('unknown', logUnknown);
		process.stdin.on('close', closeWatcher);
		process.stdin.on('data', drainStdin);

		return () => {
			watcher.off('change', inc);
			watcher.off('unknown', logUnknown);
			process.stdin.off('close', closeWatcher);
			process.stdin.off('data', drainStdin);
		};
	}, [book, target]);

	const text = `Watching '${book.srcRoot}'\nClose input stream to stop (usually Ctrl+D)`;

	return (
		<Box minHeight={process.stdout.rows || 24} flexDirection="column">
			<Text>{text}</Text>
			<BuildBook key={changeCount} book={book} target={target} />
		</Box>
	);
}

interface IBuildDisplayProps {
	build: IBuild;
	continueBuild: VoidFunc | null;
	result: boolean | null;
}

function BuildDisplay(props: IBuildDisplayProps) {
	const { build, continueBuild, result } = props;
	const emptySet = new Set<string>();
	const [inProgress, setInProgress] = useState(emptySet);
	const [complete, setComplete] = useState([] as string[]);

	useEffect(() => {
		const startTarget = (target: string) => {
			setInProgress((val) => {
				const newVal = new Set(val);
				newVal.add(target);
				return newVal;
			});
		};
		const endTarget = (target: string) => {
			setInProgress((val) => {
				const newVal = new Set(val);
				newVal.delete(target);
				return newVal;
			});

			setComplete((val) => {
				const newVal = [...val];
				newVal.push(target);
				return newVal;
			});
		};

		build.on('start-target', startTarget);
		build.on('end-target', endTarget);

		continueBuild?.();

		return () => {
			build.off('start-target', startTarget);
			build.off('end-target', endTarget);
		};
	}, [build, continueBuild]);

	useIntervalMs(25, inProgress.size > 0);
	const now = performance.now();

	return (
		<Box flexDirection="column">
			{result !== null && <LogMessages build={build} complete={complete} />}
			<CompletedBuilds build={build} complete={complete} />
			{result === null && (
				<InProgressBuilds build={build} now={now} inProgress={inProgress} />
			)}
		</Box>
	);
}

interface ILogMessagesProps {
	build: IBuild;
	complete: string[];
}

function LogMessages(props: ILogMessagesProps) {
	const { build, complete } = props;
	return (
		<>
			{complete.map((item, i) => (
				<LogMessage key={i} build={build} target={item} />
			))}
		</>
	);
}

interface ILogMessageProps {
	build: IBuild;
	target: string;
}

function LogMessage(props: ILogMessageProps) {
	const { build, target } = props;

	const result = build.resultOf(target);

	const err = build.thrownExceptionOf(target);
	const log = build.contentOfLog(target);

	const lineComponents = useMemo(() => {
		const text = err?.stack || log;
		if (!text) {
			return null;
		}

		const lines = text.replaceAll('\r', '').split('\n');
		let hasContent = false;
		const out = [];
		for (let i = 0; i < lines.length; ++i) {
			const l = lines[i];
			out.push(<Text key={i}>{l}</Text>);
			out.push(<Newline key={`LF:${i}`} />);
			if (!hasContent) {
				hasContent = l.search(/\S/) > -1;
			}
		}

		if (!hasContent) {
			return null;
		}

		out.pop(); // last newline unnecessary
		return out;
	}, [err, log]);

	if (!lineComponents) return null;

	return (
		<Box flexDirection="column" borderStyle="double" marginBottom={1}>
			<Box
				borderStyle="single"
				borderLeft={false}
				borderRight={false}
				borderTop={false}
				borderBottom={true}
				justifyContent="center"
			>
				<Text color={result ? undefined : 'redBright'} wrap="truncate-end">
					{target}
				</Text>
			</Box>
			<Box>
				<Text>{lineComponents}</Text>
			</Box>
		</Box>
	);
}

interface ICompletedBuildsProps {
	build: IBuild;
	complete: string[];
}

function CompletedBuilds(props: ICompletedBuildsProps) {
	const { complete, build } = props;

	const times = [];
	const names = [];
	const results = [];
	for (const target of complete) {
		const elapsedMs = Math.round(build.elapsedMsOf(target));
		const elapsedTime = (
			<Text key={target} color="cyan">
				[{elapsedMs}ms]
			</Text>
		);
		times.push(elapsedTime);
		names.push(
			<Text key={target} wrap="truncate-end">
				{target}
			</Text>,
		);

		const result = build.resultOf(target);
		if (result) {
			results.push(
				<Text key={target} color="greenBright">
					✔
				</Text>,
			);
		} else {
			results.push(
				<Text key={target} color="redBright">
					✘
				</Text>,
			);
		}
	}

	return (
		<Box flexDirection="row" flexWrap="nowrap" gap={1}>
			<Box flexDirection="column" flexBasis="fit-content" flexShrink={0}>
				{times}
			</Box>
			<Box flexDirection="column" flexBasis={1} flexShrink={0}>
				{results}
			</Box>
			<Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={1}>
				{names}
			</Box>
		</Box>
	);
}

interface IInProgressBuildsProps {
	build: IBuild;
	inProgress: Set<string>;
	now: number;
}

function InProgressBuilds(props: IInProgressBuildsProps) {
	const { inProgress, build, now } = props;
	const times = [];
	const names = [];

	for (const target of inProgress) {
		const elapsedMs = Math.round(build.elapsedMsOf(target, now));
		const elapsedTime = (
			<Text key={target} color="cyan">
				[{elapsedMs}ms]
			</Text>
		);
		times.push(elapsedTime);
		names.push(
			<Text key={target} dimColor wrap="truncate-end">
				{target}
			</Text>,
		);
	}

	return (
		<Box flexDirection="row" flexWrap="nowrap" gap={1}>
			<Box flexDirection="column" flexBasis="fit-content" flexShrink={0}>
				{times}
			</Box>
			<Box flexDirection="column" flexBasis={1} flexGrow={1} flexShrink={1}>
				{names}
			</Box>
		</Box>
	);
}

export class Vt100BuildInProgress {
	private _book: Cookbook;
	private _targetPath?: IBuildPath;

	constructor(book: Cookbook, targetPath?: IBuildPath) {
		this._book = book;
		this._targetPath = targetPath;
	}

	build(): void {
		render(<BuildBook book={this._book} target={this._targetPath} />);
	}

	watch(): void {
		render(<WatchBook book={this._book} target={this._targetPath} />);
	}
}

function useIntervalMs(ms: number, keepGoing: boolean): number {
	const [now, setNow] = useState(performance.now());
	useEffect(() => {
		if (keepGoing) setTimeout(() => setNow(performance.now()), ms);
	}, [keepGoing, now]);

	return now;
}

class SourceWatcher extends EventEmitter {
	private _watcher: FSWatcher;
	private _debounceMs: number;
	private _excludeDir: string;
	private _count: number = 0;

	constructor(dir: string, opts: { debounceMs: number; excludeDir: string }) {
		super();
		this._debounceMs = opts.debounceMs;
		this._excludeDir = opts.excludeDir;

		this._watcher = watch(dir, { recursive: true });
		this._watcher.on('change', this._onChange.bind(this));
		this._watcher.on('close', () => this.emit('close'));
	}

	close() {
		this._watcher.close();
	}

	private _onChange(type: string, filename: string): void {
		switch (type) {
			case 'rename':
			case 'change':
				if (!resolve(filename).startsWith(this._excludeDir))
					this._queueChange();
				break;
			default:
				this.emit('unknown', type);
				break;
		}
	}

	private _queueChange() {
		const count = ++this._count;
		setTimeout(() => {
			if (this._count === count) {
				this.emit('change');
			}
		}, this._debounceMs);
	}
}

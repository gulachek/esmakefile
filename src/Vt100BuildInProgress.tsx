import { Build, RuleInfo } from './Build.js';
import { render, Text, Box, Newline } from 'ink';
import React, { useState, useEffect, useMemo, PropsWithChildren } from 'react';
import { IBuildPath } from './Path.js';
import { Makefile, RuleID } from './Makefile.js';
import { FSWatcher } from 'node:fs';
import { watch } from 'node:fs';
import EventEmitter from 'node:events';
import { resolve } from 'node:path';

interface IWatchMkFileProps extends IBuildMkFileProps {}

function WatchMkFile(props: IWatchMkFileProps) {
	const { make, goal } = props;
	const [changeCount, setChangeCount] = useState(0);
	const watcher = useMemo(() => {
		return new SourceWatcher(make.srcRoot, {
			debounceMs: 300,
			excludeDir: make.buildRoot,
		});
	}, [make]);

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
	}, [make, goal]);

	const text = `Watching '${make.srcRoot}'\nClose input stream to stop (usually Ctrl+D)`;

	return (
		<Box minHeight={process.stdout.rows || 24} flexDirection="column">
			<Text>{text}</Text>
			<BuildMkFile key={changeCount} make={make} goal={goal} />
		</Box>
	);
}

interface IBuildMkFileProps {
	make: Makefile;
	goal?: IBuildPath;
}

function BuildMkFile(props: IBuildMkFileProps) {
	const { make, goal } = props;

	const [result, setResult] = useState<boolean | null>(null);

	const emptySet = new Set<string>();
	const [inProgress, setInProgress] = useState(emptySet);
	const [complete, setComplete] = useState([] as string[]);

	const build = useMemo<Build>(() => {
		return new Build(make, goal);
	}, [make, goal]);

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

		build.run().then((res) => setResult(res));

		return () => {
			build.off('start-target', startTarget);
			build.off('end-target', endTarget);
		};
	}, [build]);

	useIntervalMs(25, inProgress.size > 0);
	const now = performance.now();

	return (
		<Box flexDirection="column">
			<CompletedBuilds build={build} complete={complete} />
			{result === null ? (
				<InProgressBuilds build={build} now={now} inProgress={inProgress} />
			) : (
				<LogMessages build={build} complete={complete} />
			)}
		</Box>
	);
}

interface ILogMessagesProps {
	build: Build;
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
	build: Build;
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

interface INameFieldProps {
	inProgress?: boolean;
	name: string;
}

function NameField(props: INameFieldProps) {
	const { inProgress, name } = props;

	return (
		<Text dimColor={inProgress} wrap="truncate-end">
			{name}
		</Text>
	);
}

function TimeField(props: PropsWithChildren<unknown>) {
	return <Text color="cyan"> {props.children} </Text>;
}

interface IElapsedTimeProps {
	ms: number;
}

const oneMinMs = 60 * 1000;

function ElapsedTime(props: IElapsedTimeProps) {
	const { ms } = props;

	if (ms < 1000) {
		return <>{Math.round(ms)}ms</>;
	} else if (ms < oneMinMs) {
		const sec = ms / 1000;
		return <>{sec.toPrecision(3)}s</>;
	} else {
		let sec = Math.floor(ms / 1000);
		let min = Math.floor(sec / 60);
		sec -= 60 * min;

		if (min < 60) {
			return (
				<>
					{min}:{sec.toString().padStart(2, '0')}
				</>
			);
		} else {
			const hr = Math.floor(min / 60);
			min -= 60 * hr;
			return (
				<>
					{hr}:{min.toString().padStart(2, '0')}:
					{sec.toString().padStart(2, '0')}
				</>
			);
		}
	}
}

interface ICompletedBuildsProps {
	build: Build;
	complete: string[];
}

function CompletedBuilds(props: ICompletedBuildsProps) {
	const { complete, build } = props;

	const times = [];
	const names = [];
	const results = [];
	for (const target of complete) {
		const elapsedMs = Math.round(build.elapsedMsOfTarget(target));
		const elapsedTime = (
			<TimeField key={target}>
				[<ElapsedTime ms={elapsedMs} />]
			</TimeField>
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

function* timesNames(
	build: Build,
	id: RuleID,
	ruleInfo: RuleInfo,
	now: number,
): Generator<[JSX.Element, JSX.Element]> {
	const targets = ruleInfo.targets.map((t) => t.rel());
	if (targets.length < 1) {
		throw new Error('No targets found for rule');
	}

	const elapsedMs = build.elapsedMsOf(id, now);

	const t0 = targets[0];

	const elapsedTime = (
		<TimeField key={t0}>
			[<ElapsedTime ms={elapsedMs} />]
		</TimeField>
	);

	const name = (
		<Text key={t0} dimColor wrap="truncate-end">
			{t0}
		</Text>
	);

	yield [elapsedTime, name];

	for (let i = 1; i < targets.length; ++i) {
		const t = targets[i];
		const time = <TimeField key={t}>|</TimeField>;
		const name = <NameField key={t} inProgress name={t} />;
		yield [time, name];
	}
}

interface IInProgressBuildsProps {
	build: Build;
	inProgress: Set<string>;
	now: number;
}

function InProgressBuilds(props: IInProgressBuildsProps) {
	const { build, now } = props;
	const times = [];
	const names = [];

	for (const [id, ruleInfo] of build.recipesInProgress()) {
		for (const [time, name] of timesNames(build, id, ruleInfo, now)) {
			times.push(time);
			names.push(name);
		}
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
	private _make: Makefile;
	private _goalPath?: IBuildPath;

	constructor(make: Makefile, goalPath?: IBuildPath) {
		this._make = make;
		this._goalPath = goalPath;
	}

	build(): void {
		render(<BuildMkFile make={this._make} goal={this._goalPath} />);
	}

	watch(): void {
		render(<WatchMkFile make={this._make} goal={this._goalPath} />);
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

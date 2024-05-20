import { Build, RecipeCompleteInfo, RuleInfo } from './Build.js';
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
	resultState?: { result: boolean };
}

function BuildMkFile(props: IBuildMkFileProps) {
	const { make, goal, resultState } = props;

	const [result, setResult] = useState<boolean | null>(null);

	const build = useMemo<Build>(() => {
		return new Build(make, goal);
	}, [make, goal]);

	useEffect(() => {
		build.run().then((res) => {
			setResult(res);
			if (resultState) resultState.result = res;
		});
	}, [build, resultState]);

	const goalRel = useMemo(() => {
		return build.goal.rel();
	}, [build]);

	return (
		<Box flexDirection="column">
			<Text bold>Goal: {goalRel}</Text>
			<CompletedBuilds build={build} />
			{result === null ? (
				<InProgressBuilds build={build} />
			) : (
				<LogMessages build={build} />
			)}
			<Diagnostics build={build} />
		</Box>
	);
}

interface IDiagnosticsProps {
	build: Build;
}

function Diagnostics(props: IDiagnosticsProps) {
	const { build } = props;

	useUpdate(build);

	const errs = build.errors.map((e) => {
		const { msg } = e;
		return (
			<Box key={msg} flexDirection="row" gap={2} marginY={1}>
				<Text key={msg} color="redBright" bold>
					Error:
				</Text>
				<Text>{msg}</Text>
			</Box>
		);
	});

	return <Box flexDirection="column">{errs}</Box>;
}

interface ILogMessagesProps {
	build: Build;
}

function LogMessages(props: ILogMessagesProps) {
	const { build } = props;

	useUpdate(build);

	const msgs = [];

	for (const [id, ruleInfo, results] of build.completedRecipes()) {
		msgs.push(
			<LogMessage
				key={id}
				build={build}
				ruleId={id}
				ruleInfo={ruleInfo}
				results={results}
			/>,
		);
	}

	return msgs;
}

interface ILogMessageProps {
	build: Build;
	ruleId: RuleID;
	ruleInfo: RuleInfo;
	results: RecipeCompleteInfo;
}

function LogMessage(props: ILogMessageProps) {
	const { build, ruleId, ruleInfo, results } = props;
	const { result, exception } = results;

	const log = build.contentOfLog(ruleId);

	const lineComponents = useMemo(() => {
		const text = exception?.stack || log;
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
	}, [exception, log]);

	const targets = useMemo(() => {
		return ruleInfo.targets.map((t) => t.rel()).join(', ');
	}, [ruleInfo]);

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
					{targets}
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

interface IResultFieldProps {
	result: boolean;
}

function ResultField(props: IResultFieldProps) {
	if (props.result) {
		return (
			<Text wrap="truncate" color="greenBright">
				✔
			</Text>
		);
	} else {
		return (
			<Text wrap="truncate" color="redBright">
				✘
			</Text>
		);
	}
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
}

function CompletedBuilds(props: ICompletedBuildsProps) {
	const { build } = props;

	useUpdate(build);

	const times = [];
	const names = [];
	const results = [];

	for (const [id, ruleInfo, completeInfo] of build.completedRecipes()) {
		const targets = ruleInfo.targets.map((t) => t.rel());
		times.push(
			<TimeField key={id}>
				[<ElapsedTime ms={build.elapsedMsOf(id)} />]
			</TimeField>,
		);
		names.push(<NameField key={id} name={targets.join(', ')} />);

		const { result } = completeInfo;
		results.push(<ResultField key={id} result={result} />);
	}

	return (
		<Box flexDirection="row" flexWrap="nowrap" gap={1}>
			<Box flexDirection="column" flexBasis="fit-content" flexShrink={0}>
				{times}
			</Box>
			<Box flexDirection="column" flexBasis={2} flexShrink={0}>
				{results}
			</Box>
			<Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={1}>
				{names}
			</Box>
		</Box>
	);
}

interface IInProgressBuildsProps {
	build: Build;
}

function InProgressBuilds(props: IInProgressBuildsProps) {
	const { build } = props;
	const times = [];
	const names = [];

	useIntervalMs(25);
	useUpdate(build);

	const now = performance.now();

	for (const [id, ruleInfo] of build.recipesInProgress()) {
		const targets = ruleInfo.targets.map((t) => t.rel());

		times.push(
			<TimeField key={id}>
				[<ElapsedTime ms={build.elapsedMsOf(id, now)} />]
			</TimeField>,
		);

		names.push(<NameField key={id} inProgress name={targets.join(', ')} />);
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

	async build(): Promise<boolean> {
		const resultState = { result: false };
		const { waitUntilExit } = render(
			<BuildMkFile
				make={this._make}
				goal={this._goalPath}
				resultState={resultState}
			/>,
		);
		await waitUntilExit();
		return resultState.result;
	}

	watch(): void {
		render(<WatchMkFile make={this._make} goal={this._goalPath} />);
	}
}

function useIntervalMs(ms: number): void {
	const [_, setN] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => setN((n) => n + 1), ms);
		return () => {
			clearInterval(interval);
		};
	}, []);
}

function useUpdate(build: Build): void {
	const [_, setN] = useState(0);

	useEffect(() => {
		const cb = () => setN((n) => n + 1);
		build.on('update', cb);
		return () => {
			build.off('update', cb);
		};
	}, [build]);
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

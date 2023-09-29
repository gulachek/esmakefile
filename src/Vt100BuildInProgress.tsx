import { IBuild } from './Build.js';
import { render, Text, Box, Static } from 'ink';
import React, { useState, useEffect } from 'react';

interface IBuildDisplayProps {
	build: IBuild;
	continueBuild?: () => void;
	result: boolean | null;
}

function BuildDisplay(props: IBuildDisplayProps) {
	const { build, continueBuild, result } = props;
	const emptySet = new Set<string>();
	const [inProgress, setInProgress] = useState(emptySet);
	const [complete, setComplete] = useState([] as string[]);

	useEffect(() => {
		build.on('start-target', (target: string) => {
			setInProgress((val) => {
				const newVal = new Set(val);
				newVal.add(target);
				return newVal;
			});
		});

		build.on('end-target', (target: string) => {
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
		});

		continueBuild?.();
	}, [build, continueBuild]);

	useIntervalMs(25, inProgress.size > 0);
	const now = performance.now();

	return (
		<Box flexDirection="column">
			{result === false && <ErrorMessages build={build} complete={complete} />}
			<CompletedBuilds build={build} complete={complete} />
			{result === null && (
				<InProgressBuilds build={build} now={now} inProgress={inProgress} />
			)}
		</Box>
	);
}

interface IErrorMessagesProps {
	build: IBuild;
	complete: string[];
}

function ErrorMessages(props: IErrorMessagesProps) {
	const { build, complete } = props;
	return (
		<Static items={complete}>
			{(item) => <ErrorMessage key={item} build={build} target={item} />}
		</Static>
	);
}

interface IErrorMessageProps {
	build: IBuild;
	target: string;
}

function ErrorMessage(props: IErrorMessageProps) {
	const { build, target } = props;

	const result = build.resultOf(target);
	if (result !== false) return null;

	const err = build.thrownExceptionOf(target);
	const log = build.contentOfLog(target);
	if (!(err || log)) return null;

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
				<Text color="redBright" wrap="truncate-end">
					{target}
				</Text>
			</Box>
			<Box>
				<Text> {err?.stack || log} </Text>
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
				[{elapsedMs}ms]{' '}
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
	private _build: IBuild;

	constructor(build: IBuild) {
		this._build = build;
	}

	start(continueBuild: () => void): void {
		render(
			<BuildDisplay
				build={this._build}
				result={null}
				continueBuild={continueBuild}
			/>,
		);
	}

	stop(result: boolean): void {
		render(<BuildDisplay build={this._build} result={result} />);
	}
}

function useIntervalMs(ms: number, keepGoing: boolean): number {
	const [now, setNow] = useState(performance.now());
	useEffect(() => {
		if (keepGoing) setTimeout(() => setNow(performance.now()), ms);
	}, [keepGoing, now]);

	return now;
}

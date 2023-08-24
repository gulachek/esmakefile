import { IBuild, RecipeID } from './Build.js';
import { render, Text, Box, Static } from 'ink';
import React, { useState, useEffect } from 'react';

interface IBuildDisplayProps {
	build: IBuild;
	continueBuild?: () => void;
	result: boolean | null;
}

function BuildDisplay(props: IBuildDisplayProps) {
	const { build, continueBuild, result } = props;
	const emptySet = new Set<RecipeID>();
	const [inProgress, setInProgress] = useState(emptySet);
	const [complete, setComplete] = useState([] as RecipeID[]);

	useEffect(() => {
		build.on('start-recipe', (id: RecipeID) => {
			setInProgress((val) => {
				const newVal = new Set(val);
				newVal.add(id);
				return newVal;
			});
		});

		build.on('end-recipe', (id: RecipeID) => {
			setInProgress((val) => {
				const newVal = new Set(val);
				newVal.delete(id);
				return newVal;
			});

			setComplete((val) => {
				const newVal = [...val];
				newVal.push(id);
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
	complete: RecipeID[];
}

function ErrorMessages(props: IErrorMessagesProps) {
	const { build, complete } = props;
	return (
		<Static items={complete}>
			{(item) => <ErrorMessage key={item} build={build} id={item} />}
		</Static>
	);
}

interface IErrorMessageProps {
	build: IBuild;
	id: RecipeID;
}

function ErrorMessage(props: IErrorMessageProps) {
	const { build, id } = props;

	const result = build.resultOf(id);
	if (result !== false) return null;

	const log = build.contentOfLog(id);
	if (!log) return null;

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
					{build.nameOf(id)}
				</Text>
			</Box>
			<Box>
				<Text> {log} </Text>
			</Box>
		</Box>
	);
}

interface ICompletedBuildsProps {
	build: IBuild;
	complete: RecipeID[];
}

function CompletedBuilds(props: ICompletedBuildsProps) {
	const { complete, build } = props;

	const times = [];
	const names = [];
	const results = [];
	for (const id of complete) {
		const name = build.nameOf(id);
		const elapsedMs = Math.round(build.elapsedMsOf(id));
		const elapsedTime = (
			<Text key={id} color="cyan">
				[{elapsedMs}ms]
			</Text>
		);
		times.push(elapsedTime);
		names.push(
			<Text key={id} wrap="truncate-end">
				{name}
			</Text>,
		);

		const result = build.resultOf(id);
		if (result) {
			results.push(
				<Text key={id} color="greenBright">
					✔
				</Text>,
			);
		} else {
			results.push(
				<Text key={id} color="redBright">
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
	inProgress: Set<RecipeID>;
	now: number;
}

function InProgressBuilds(props: IInProgressBuildsProps) {
	const { inProgress, build, now } = props;
	const times = [];
	const names = [];

	for (const id of inProgress) {
		const name = build.nameOf(id);
		const elapsedMs = Math.round(build.elapsedMsOf(id, now));
		const elapsedTime = (
			<Text key={id} color="cyan">
				[{elapsedMs}ms]{' '}
			</Text>
		);
		times.push(elapsedTime);
		names.push(
			<Text key={id} dimColor wrap="truncate-end">
				{name}
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

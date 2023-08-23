import { IBuild, RecipeID } from './Build.js';
import { render, Text, Box } from 'ink';
import React, { useState, useEffect, useCallback, useMemo } from 'react';

interface IBuildDisplayProps {
	build: IBuild;
	result: boolean | null;
}

function BuildDisplay(props: IBuildDisplayProps) {
	const { build } = props;
	const render = useRender();
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
	}, [build, render]);

	useIntervalMs(25, inProgress.size > 0);
	const now = performance.now();

	return (
		<Box flexDirection="column">
			<CompletedBuilds build={build} complete={complete} />
			<InProgressBuilds build={build} now={now} inProgress={inProgress} />
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
	}

	return (
		<Box flexDirection="row" flexWrap="nowrap" gap={1}>
			<Box flexDirection="column" width={8}>
				{times}
			</Box>
			<Box flexDirection="column">{names}</Box>
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
			<Box flexDirection="column" width={8}>
				{times}
			</Box>
			<Box flexDirection="column">{names}</Box>
		</Box>
	);
}

export class Vt100BuildInProgress {
	private _build: IBuild;

	constructor(build: IBuild) {
		this._build = build;
	}

	start(): void {
		render(<BuildDisplay build={this._build} result={null} />);
	}

	stop(result: boolean): void {
		render(<BuildDisplay build={this._build} result={result} />);
	}
}

type InProgressMap = Map<RecipeID, InProgressInfo>;
type CompleteMap = Map<RecipeID, CompleteInfo>;

type InProgressInfo = {
	name: string;
	startTime: number;
};

type CompleteInfo = {
	name: string;
	elapsedTimeMs: number;
};

function useRender(): () => void {
	const [_, setTick] = useState(1);

	const render = useCallback(() => {
		setTick((tick) => tick + 1);
	}, []);

	return render;
}

function useIntervalMs(ms: number, keepGoing: boolean): number {
	const [now, setNow] = useState(performance.now());
	useEffect(() => {
		if (keepGoing) setTimeout(() => setNow(performance.now()), ms);
	}, [keepGoing, now]);

	return now;
}

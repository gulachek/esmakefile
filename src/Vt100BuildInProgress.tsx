import { IBuild, RecipeID } from './Build.js';
import { render, Text, Box } from 'ink';
import React, { useState, useEffect, useMemo, Fragment } from 'react';

import EventEmitter from 'node:events';

interface IBuildDisplayProps {
	inProgress: InProgressMap;
	complete: CompleteMap;
	events: EventEmitter;
}

function BuildDisplay(props: IBuildDisplayProps) {
	const { inProgress, complete, events } = props;
	const tick = useRenderEvent(events);
	useIntervalMs(25, inProgress.size > 0);
	const now = performance.now();

	return (
		<Box flexDirection="column">
			<CompletedBuilds tick={tick} complete={complete} />
			<InProgressBuilds now={now} inProgress={inProgress} />
		</Box>
	);
}

interface ICompletedBuildsProps {
	complete: CompleteMap;
	tick: number;
}

function CompletedBuilds(props: ICompletedBuildsProps) {
	const { complete } = props;

	const times = [];
	const names = [];
	for (const [id, info] of complete) {
		const { name, elapsedTimeMs } = info;
		const elapsedMs = Math.round(elapsedTimeMs);
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
	inProgress: InProgressMap;
	now: number;
}

function InProgressBuilds(props: IInProgressBuildsProps) {
	const { now, inProgress } = props;
	const times = [];
	const names = [];
	for (const [id, info] of inProgress) {
		const { name, startTime } = info;
		const elapsedMs = Math.round(now - startTime);
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
	private _events = new EventEmitter();
	private _recipesInProgress = new Map<RecipeID, InProgressInfo>();
	private _completeRecipes = new Map<RecipeID, CompleteInfo>();

	constructor(build: IBuild) {
		this._build = build;
	}

	start(): void {
		this._build.on('start-recipe', this.startRecipe.bind(this));
		this._build.on('end-recipe', this.stopRecipe.bind(this));

		render(
			<BuildDisplay
				events={this._events}
				inProgress={this._recipesInProgress}
				complete={this._completeRecipes}
			/>,
		);
	}

	stop(): void {
		this.render();
	}

	private startRecipe(id: RecipeID): void {
		this._recipesInProgress.set(id, {
			startTime: performance.now(),
			name: this._build.nameOf(id),
		});

		this.render();
	}

	private stopRecipe(id: RecipeID): void {
		const info = this._recipesInProgress.get(id);
		this._recipesInProgress.delete(id);

		this._completeRecipes.set(id, {
			name: info.name,
			elapsedTimeMs: performance.now() - info.startTime,
		});
		this.render();
	}

	private render(): void {
		this._events.emit('render');
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

function useRenderEvent(events: EventEmitter): number {
	const [tick, setTick] = useState(1);

	useEffect(() => {
		const doUpdate = () => {
			setTick(tick + 1);
		};

		events.on('render', doUpdate);
		return () => {
			events.off('render', doUpdate);
		};
	}, [events]);

	return tick;
}

function useIntervalMs(ms: number, keepGoing: boolean): number {
	const [now, setNow] = useState(performance.now());
	useEffect(() => {
		if (keepGoing) setTimeout(() => setNow(performance.now()), ms);
	}, [keepGoing, now]);

	return now;
}

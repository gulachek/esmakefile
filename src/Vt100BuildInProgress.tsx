import { IBuild, RecipeID } from './Build.js';
import { render, Text, Box } from 'ink';
import React, { useState, useEffect, useMemo, Fragment } from 'react';

import EventEmitter from 'node:events';

interface IBuildDisplayProps {
	inProgress: InProgressMap;
	events: EventEmitter;
}

function BuildDisplay(props: IBuildDisplayProps) {
	const { inProgress, events } = props;
	const tick = useRenderEvent(events);

	const allComplete = useMemo(() => {
		for (const entry of inProgress) {
			if (!entry[1].endTime) return false;
		}

		return true;
	}, [inProgress.size, tick]);

	const now = useIntervalMs(25, !allComplete);

	const times = [];
	const names = [];
	for (const [id, info] of inProgress) {
		const { name, startTime, endTime } = info;
		const complete = !!endTime;
		const elapsedMs = Math.round((endTime || now) - startTime);
		const elapsedTime = (
			<Text key={id} color="cyan">
				[{elapsedMs}ms]{' '}
			</Text>
		);
		times.push(elapsedTime);
		names.push(
			<Text key={id} dimColor={!complete} wrap="truncate-end">
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
		this._recipesInProgress.get(id).endTime = performance.now();
		this.render();
	}

	private render(): void {
		this._events.emit('render');
	}
}

type InProgressMap = Map<RecipeID, InProgressInfo>;

type InProgressInfo = {
	name: string;
	startTime: number;
	endTime?: number;
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

import { IBuild, RecipeID } from './Build';

export class Vt100BuildInProgress {
	private _build: IBuild;
	private _recipesInProgress = new Map<RecipeID, InProgressInfo>();
	private _running: boolean = false;

	constructor(build: IBuild) {
		this._build = build;
	}

	start(): void {
		this._build.on('start-recipe', this.startRecipe.bind(this));
		this._running = true;
		setTimeout(() => this.tick(), 5);
	}

	stop(): void {
		this._running = false;
	}

	private tick(): void {
		for (const [id] of this._recipesInProgress) {
			console.log(this._build.nameOf(id));
		}

		if (this._running) setTimeout(() => this.tick(), 5);
	}

	private startRecipe(id: RecipeID): void {
		this._recipesInProgress.set(id, {
			startTime: performance.now(),
		});
	}
}

type InProgressInfo = {
	startTime: number;
};

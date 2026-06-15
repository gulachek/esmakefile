import { ReadableStream } from 'node:stream/web';

export type ArtifactID = string;

export interface ArtifactPutRequest {
	id?: ArtifactID;
	body: ReadableStream<Uint8Array>;
	contentType: string;
	contentLength?: number;
}

export interface ArtifactPutResponse {
	id: ArtifactID;
}

export interface ArtifactGetResponse {
	body: ReadableStream<Uint8Array>;
	contentType: string;
	contentLength?: number;
}

export interface IArtifactStoreImpl {
	put(request: ArtifactPutRequest): Promise<ArtifactPutResponse>;
	get(id: ArtifactID): Promise<ArtifactGetResponse | null>;
}

class NoopArtifactStoreImpl implements IArtifactStoreImpl {
	async put(_: ArtifactPutRequest): Promise<ArtifactPutResponse> {
		return { id: '' };
	}

	async get(_: ArtifactID): Promise<ArtifactGetResponse | null> {
		return null;
	}
}

let artifactStoreImpl: IArtifactStoreImpl = new NoopArtifactStoreImpl();

export function setArtifactStoreImpl(impl: IArtifactStoreImpl): void {
	artifactStoreImpl = impl;
}

export type ArtifactPutOpts = {
	id?: ArtifactID;
	content: Uint8Array;
	contentType: string;
};

export type ArtifactPutStreamOpts = {
	id?: ArtifactID;
	content: ReadableStream<Uint8Array>;
	contentType: string;
	contentLength?: number;
};

export type ArtifactContent = {
	content: Uint8Array;
	contentType: string;
};

export type ArtifactContentStream = {
	content: ReadableStream<Uint8Array>;
	contentType: string;
	contentLength: number;
};

export class ArtifactStore {
	private _impl: IArtifactStoreImpl;

	constructor(impl: IArtifactStoreImpl) {
		this._impl = impl;
	}

	async put(opts: ArtifactPutOpts): Promise<ArtifactID> {
		const data = opts.content;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(data);
				controller.close();
			},
		});
		const response = await this._impl.put({
			id: opts.id,
			body,
			contentType: opts.contentType,
			contentLength: data.length,
		});
		return response.id;
	}

	async putStream(opts: ArtifactPutStreamOpts): Promise<ArtifactID> {
		const response = await this._impl.put({
			id: opts.id,
			body: opts.content,
			contentType: opts.contentType,
			contentLength: opts.contentLength,
		});
		return response.id;
	}

	async get(id: ArtifactID): Promise<ArtifactContent | null> {
		const response = await this._impl.get(id);
		if (!response) return null;

		const chunks: Uint8Array[] = [];
		const reader = response.body.getReader();
		try {
			// Perhaps this would be more important to provide a timeout
			// with a network service backend, but this seems ok right now
			// eslint-disable-next-line no-constant-condition
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}

		const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const content = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			content.set(chunk, offset);
			offset += chunk.length;
		}

		return { content, contentType: response.contentType };
	}

	async getStream(id: ArtifactID): Promise<ArtifactContentStream | null> {
		const response = await this._impl.get(id);
		if (!response) return null;
		return {
			content: response.body,
			contentType: response.contentType,
			contentLength: response.contentLength ?? 0,
		};
	}
}

export function getArtifactStore(): ArtifactStore {
	return new ArtifactStore(artifactStoreImpl);
}

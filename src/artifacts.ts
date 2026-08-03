import { ReadableStream } from 'node:stream/web';

/**
 * Opaque type referencing an uploaded artifact
 */
export type ArtifactID = string;

/**
 * Options to configure an upload
 */
export interface ArtifactPutRequest {
	/** Client provided id */
	id?: ArtifactID;
	/** Stream representing the content to be uploaded */
	body: ReadableStream<Uint8Array>;
	/** MIME type representing the upload */
	contentType: string;
	/** Number of bytes in the upload */
	contentLength?: number;
}

/**
 * Results of an upload
 */
export interface ArtifactPutResponse {
	/** The id referencing the uploaded artifact */
	id: ArtifactID;
}

/**
 * Results of a download
 */
export interface ArtifactGetResponse {
	/** Stream representing the content to be downloaded */
	body: ReadableStream<Uint8Array>;
	/** MIME type representing the download */
	contentType: string;
	/** Number of bytes in the download */
	contentLength?: number;
}

/**
 * Interface for an artifact store implementation
 */
export interface IArtifactStoreImpl {
	/**
	 * Upload an artifact
	 * @param request Information describing the content to be uploaded
	 * @returns Response to the upload
	 */
	put(request: ArtifactPutRequest): Promise<ArtifactPutResponse>;

	/**
	 * Download an artifact
	 * @param id The id referencing the desired artifact
	 * @returns The response to the request or null if not found
	 */
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

/**
 * Configure an artifact store implementation for the process
 * @param impl The implementation
 * @remarks This will cause all callers of {@link getArtifactStore} to use the given implementation for artifact storage
 */
export function setArtifactStoreImpl(impl: IArtifactStoreImpl): void {
	artifactStoreImpl = impl;
}

/**
 * Options to upload an artifact
 */
export type ArtifactPutOpts = {
	/** Client provided id */
	id?: ArtifactID;
	/** The content to be uploaded */
	content: Uint8Array;
	/** The MIME type of the content */
	contentType: string;
};

/**
 * Options to stream an upload of an artifact
 */
export type ArtifactPutStreamOpts = {
	/** Client provided id */
	id?: ArtifactID;
	/** The content to be uploaded */
	content: ReadableStream<Uint8Array>;
	/** The MIME type of the content */
	contentType: string;
	/** The number of bytes of the content */
	contentLength?: number;
};

/**
 * Artifact content accessible via an array
 */
export type ArtifactContent = {
	/** The artifact's content */
	content: Uint8Array;
	/** The MIME type of the content */
	contentType: string;
};

/**
 * Artifact content accessible via a stream
 */
export type ArtifactContentStream = {
	/** The artifact's content */
	content: ReadableStream<Uint8Array>;
	/** The MIME type of the content */
	contentType: string;
	/** The number of bytes of the content */
	contentLength: number;
};

/**
 * Frontend to upload and download binary artifacts
 */
export class ArtifactStore {
	private _impl: IArtifactStoreImpl;

	/**
	 * Wrap an implementation
	 * @internal
	 * @param impl The implementation to wrap
	 * @remarks Users should almost certainly use {@link getArtifactStore}
	 */
	constructor(impl: IArtifactStoreImpl) {
		this._impl = impl;
	}

	/**
	 * Upload an artifact
	 * @param opts Options to configure upload
	 * @returns An id referencing the uploaded artifact
	 * @remarks The returned Promise is rejected on failure
	 */
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

	/**
	 * Stream an upload of an artifact
	 * @param opts Options to configure upload
	 * @returns An id referencing the uploaded artifact
	 * @remarks The returned Promise is rejected on failure
	 */
	async putStream(opts: ArtifactPutStreamOpts): Promise<ArtifactID> {
		const response = await this._impl.put({
			id: opts.id,
			body: opts.content,
			contentType: opts.contentType,
			contentLength: opts.contentLength,
		});
		return response.id;
	}

	/**
	 * Download an artifact
	 * @param id An id referencing the desired artifact
	 * @returns The content of the downloaded artifact or null if not found
	 */
	async get(id: ArtifactID): Promise<ArtifactContent | null> {
		const response = await this._impl.get(id);
		if (!response) return null;

		const chunks: Uint8Array[] = [];
		const reader = response.body.getReader();
		try {
			// Perhaps this would be more important to provide a timeout
			// with a network service backend, but this seems ok right now
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

	/**
	 * Stream a download of an artifact
	 * @param id An id referencing the desired artifact
	 * @returns The streamable content of the downloaded artifact or null if not found
	 */
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

/**
 * Get the configured {@link ArtifactStore} for the current process
 * @returns An {@link ArtifactStore}
 */
export function getArtifactStore(): ArtifactStore {
	return new ArtifactStore(artifactStoreImpl);
}

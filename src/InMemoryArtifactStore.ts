import { ReadableStream } from 'node:stream/web';
import {
	ArtifactID,
	ArtifactPutRequest,
	ArtifactPutResponse,
	ArtifactGetResponse,
	IArtifactStoreImpl,
} from './artifacts.js';
import { randomUUID } from 'node:crypto';

interface StoredArtifact {
	content: Uint8Array;
	contentType: string;
}

export class InMemoryArtifactStore implements IArtifactStoreImpl {
	private _store = new Map<ArtifactID, StoredArtifact>();
	private _enabled: boolean = true;

	public setEnabled(enabled: boolean): void {
		this._enabled = enabled;
	}

	private _throwIfDisabled(): void {
		if (!this._enabled) {
			throw new Error(`${InMemoryArtifactStore.name} is disabled`);
		}
	}

	async put(request: ArtifactPutRequest): Promise<ArtifactPutResponse> {
		this._throwIfDisabled();

		const id = request.id ?? randomUUID();
		const chunks: Uint8Array[] = [];

		const reader = request.body.getReader();
		try {
			let totalSize = 0;
			const maxSize = 16 * 1024 * 1024; // 16 MB
			while (totalSize <= maxSize) {
				const { done, value } = await reader.read();
				if (done) break;
				totalSize += value.length;
				chunks.push(value);
			}

			if (totalSize > maxSize)
				throw new Error('Maximum in memory artifact size exceeded');
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

		this._store.set(id, { content, contentType: request.contentType });
		return { id };
	}

	async get(id: ArtifactID): Promise<ArtifactGetResponse | null> {
		this._throwIfDisabled();

		const artifact = this._store.get(id);
		if (!artifact) return null;

		const data = artifact.content;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(data);
				controller.close();
			},
		});

		return {
			body,
			contentType: artifact.contentType,
			contentLength: data.length,
		};
	}
}

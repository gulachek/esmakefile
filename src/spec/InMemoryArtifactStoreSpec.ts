import { expect } from 'chai';
import { InMemoryArtifactStore } from '../InMemoryArtifactStore.js';
import { ReadableStream } from 'node:stream/web';

function makeStream(data: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(data);
			controller.close();
		},
	});
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

describe('InMemoryArtifactStore', () => {
	let store: InMemoryArtifactStore;

	beforeEach(() => {
		store = new InMemoryArtifactStore();
	});

	describe('put', () => {
		it('stores an artifact and returns an id', async () => {
			const data = new TextEncoder().encode('hello');
			const { id } = await store.put({
				body: makeStream(data),
				contentType: 'text/plain',
				contentLength: data.length,
			});
			expect(typeof id).to.equal('string');
			expect(id.length).to.be.greaterThan(0);
		});

		it('uses provided id when given', async () => {
			const data = new TextEncoder().encode('hello');
			const { id } = await store.put({
				id: 'my-custom-id',
				body: makeStream(data),
				contentType: 'text/plain',
				contentLength: data.length,
			});
			expect(id).to.equal('my-custom-id');
		});

		it('throws when disabled', async () => {
			store.setEnabled(false);
			const data = new TextEncoder().encode('hello');
			try {
				await store.put({
					body: makeStream(data),
					contentType: 'text/plain',
					contentLength: data.length,
				});
				expect.fail('should have thrown');
			} catch (e) {
				expect((e as Error).message).to.match(/disabled/i);
			}
		});
	});

	describe('get', () => {
		it('returns null for a nonexistent id', async () => {
			const result = await store.get('no-such-id');
			expect(result).to.be.null;
		});

		it('returns the stored content and contentType', async () => {
			const data = new TextEncoder().encode('world');
			const { id } = await store.put({
				body: makeStream(data),
				contentType: 'text/plain',
				contentLength: data.length,
			});

			const response = await store.get(id);
			expect(response).to.not.be.null;

			const content = await readStream(response!.body);
			expect(response!.contentType).to.equal('text/plain');
			expect(new TextDecoder().decode(content)).to.equal('world');
		});

		it('returns contentLength matching the stored data size', async () => {
			const data = new TextEncoder().encode('abc');
			const { id } = await store.put({
				body: makeStream(data),
				contentType: 'application/octet-stream',
				contentLength: data.length,
			});

			const response = await store.get(id);
			expect(response!.contentLength).to.equal(3);
		});

		it('throws when disabled', async () => {
			const data = new TextEncoder().encode('x');
			const { id } = await store.put({
				body: makeStream(data),
				contentType: 'text/plain',
				contentLength: data.length,
			});

			store.setEnabled(false);
			try {
				await store.get(id);
				expect.fail('should have thrown');
			} catch (e) {
				expect((e as Error).message).to.match(/disabled/i);
			}
		});
	});
});

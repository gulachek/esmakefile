import { expect } from 'chai';
import { ArtifactStore } from '../artifacts.js';
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

describe('ArtifactStore', () => {
	let impl: InMemoryArtifactStore;
	let store: ArtifactStore;

	beforeEach(() => {
		impl = new InMemoryArtifactStore();
		store = new ArtifactStore(impl);
	});

	describe('put', () => {
		it('stores a Uint8Array and returns an id', async () => {
			const data = new TextEncoder().encode('hello');
			const id = await store.put({ content: data, contentType: 'text/plain' });
			expect(typeof id).to.equal('string');
			expect(id.length).to.be.greaterThan(0);
		});

		it('uses provided id when given', async () => {
			const data = new TextEncoder().encode('hello');
			const id = await store.put({
				id: 'fixed-id',
				content: data,
				contentType: 'text/plain',
			});
			expect(id).to.equal('fixed-id');
		});
	});

	describe('putStream', () => {
		it('stores a stream and returns an id', async () => {
			const data = new TextEncoder().encode('streaming');
			const id = await store.putStream({
				content: makeStream(data),
				contentType: 'text/plain',
				contentLength: data.length,
			});
			expect(typeof id).to.equal('string');
		});
	});

	describe('get', () => {
		it('returns null for a non-existent id', async () => {
			const result = await store.get('missing');
			expect(result).to.be.null;
		});

		it('returns buffered content after put', async () => {
			const data = new TextEncoder().encode('buffered');
			const id = await store.put({ content: data, contentType: 'text/plain' });

			const result = await store.get(id);
			expect(result).to.not.be.null;
			expect(result!.contentType).to.equal('text/plain');
			expect(new TextDecoder().decode(result!.content)).to.equal('buffered');
		});

		it('returns buffered content after putStream', async () => {
			const data = new TextEncoder().encode('streamed then buffered');
			const id = await store.putStream({
				content: makeStream(data),
				contentType: 'application/octet-stream',
				contentLength: data.length,
			});

			const result = await store.get(id);
			expect(result).to.not.be.null;
			expect(result!.contentType).to.equal('application/octet-stream');
			expect(new TextDecoder().decode(result!.content)).to.equal(
				'streamed then buffered',
			);
		});
	});

	describe('getStream', () => {
		it('returns null for a non-existent id', async () => {
			const result = await store.getStream('missing');
			expect(result).to.be.null;
		});

		it('returns a stream with correct contentType and contentLength after put', async () => {
			const data = new TextEncoder().encode('as stream');
			const id = await store.put({ content: data, contentType: 'text/plain' });

			const result = await store.getStream(id);
			expect(result).to.not.be.null;
			expect(result!.contentType).to.equal('text/plain');
			expect(result!.contentLength).to.equal(data.length);

			const chunks: Uint8Array[] = [];
			const reader = result!.content.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}
			const flat = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
			let off = 0;
			for (const c of chunks) {
				flat.set(c, off);
				off += c.length;
			}
			expect(new TextDecoder().decode(flat)).to.equal('as stream');
		});
	});
});

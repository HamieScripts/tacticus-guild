/**
 * Snapshot payloads run 650 KB to 2.2 MB raw but gzip to 6-11% of that, which keeps them inside
 * Firestore's 1 MiB document limit. Uses the native streams API, so no dependency.
 */

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

// CompressionStream accepts BufferSource, so the source stream is typed to match.
function toStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new Blob([bytes as BlobPart]).stream();
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(toStream(bytes).pipeThrough(new CompressionStream('gzip')));
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(toStream(bytes).pipeThrough(new DecompressionStream('gzip')));
}

export async function gzipJson(value: unknown): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify(value)));
}

export async function gunzipJson<T>(bytes: Uint8Array): Promise<T> {
  const decoded = new TextDecoder().decode(await gunzip(bytes));
  return JSON.parse(decoded) as T;
}

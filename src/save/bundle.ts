/** Browser export compression; the pure bundle codec is also available to the simulation. */
import { decodeBundle, encodeBundle } from './bundleCodec';
export * from './bundleCodec';

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** gzip when CompressionStream is available (browsers, node >= 18), otherwise returns the input */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return bytes;
  return pipe(bytes, new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed files');
  return pipe(bytes, new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
}

/** encode + gzip */
export async function packFile(value: unknown, compress = true): Promise<Uint8Array> {
  const raw = encodeBundle(value);
  return compress ? gzip(raw) : raw;
}

/** gunzip (if needed) + decode */
export async function unpackFile(bytes: Uint8Array): Promise<unknown> {
  return decodeBundle(await gunzip(bytes));
}

import { Readable } from "node:stream";

export type ZipEntry = {
  name: string;
  sizeBytes?: number;
  date?: Date;
  data: AsyncIterable<Uint8Array>;
};

const encoder = new TextEncoder();
const u16 = (value: number) => { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true); return bytes; };
const u32 = (value: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value >>> 0, true); return bytes; };
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};

function crc32Update(data: Uint8Array, seed: number): number {
  let crc = seed;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}
export function crc32(data: Uint8Array): number {
  return (crc32Update(data, 0xffffffff) ^ 0xffffffff) >>> 0;
}

type Central = { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number };

const dosDateTime = (date: Date) => {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
};

export function streamZip(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const iterator = (async function* () {
    const central: Central[] = [];
    let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const dos = entry.date && !Number.isNaN(entry.date.getTime()) ? dosDateTime(entry.date) : dosDateTime(new Date());
      yield join([u32(0x04034b50), u16(20), u16(0x808), u16(0), u16(dos.time), u16(dos.date), u32(0), u32(0), u32(0), u16(name.length), u16(0), name]);
      const source = entry.data[Symbol.asyncIterator]();
      let size = 0;
      let crc = 0xffffffff;
      for (;;) {
        const next = await source.next();
        if (next.done) break;
        const chunk = next.value;
        size += chunk.length;
        crc = crc32Update(chunk, crc);
        yield chunk;
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      yield join([u32(0x08074b50), u32(crc), u32(size), u32(size)]);
      central.push({ name, crc, size, offset, ...dos });
      offset += 30 + name.length + size + 16;
    }
    const directory = central.map((entry) => join([u32(0x02014b50), u16(0x0314), u16(20), u16(0x808), u16(0), u16(entry.time), u16(entry.date), u32(entry.crc), u32(entry.size), u32(entry.size), u16(entry.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset), entry.name]));
    const centralBytes = join(directory);
    yield centralBytes;
    yield join([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(centralBytes.length), u32(offset), u16(0)]);
  })();
  return Readable.toWeb(Readable.from(iterator)) as ReadableStream<Uint8Array>;
}

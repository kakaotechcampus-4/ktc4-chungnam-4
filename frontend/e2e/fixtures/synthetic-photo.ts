// 사람이 없는 합성 활동 사진(블록 그림)을 PNG로 만듭니다.
// 원아 사진을 커밋하지 않도록(루트 CLAUDE.md §Git) 바이너리 파일 대신 실행할 때 그립니다.
import { deflateSync } from "node:zlib";

const WIDTH = 320;
const HEIGHT = 240;

// 바닥색 위에 색 블록을 쌓은 단순한 장면입니다. 얼굴처럼 보일 만한 무늬는 넣지 않습니다.
const BLOCKS: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[] = [
  { x: 120, y: 170, w: 80, h: 40, rgb: [220, 70, 60] },
  { x: 130, y: 130, w: 60, h: 40, rgb: [60, 130, 220] },
  { x: 140, y: 90, w: 40, h: 40, rgb: [250, 200, 50] },
  { x: 30, y: 180, w: 50, h: 30, rgb: [80, 180, 100] },
];

function pixel(x: number, y: number): [number, number, number] {
  const block = BLOCKS.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  if (block) return block.rgb;
  return y > 210 ? [200, 170, 130] : [235, 240, 245];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // 채널당 8비트
  header[9] = 2; // RGB
  const rows = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const offset = y * (WIDTH * 3 + 1);
    rows[offset] = 0; // 필터 없음
    for (let x = 0; x < WIDTH; x++) {
      rows.set(pixel(x, y), offset + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** `setInputFiles`에 그대로 넘기는 값입니다. 확장자로 사진 종류를 판단하므로 .png로 둡니다. */
export function syntheticActivityPhoto(): { name: string; mimeType: string; buffer: Buffer } {
  return { name: "e2e-blocks.png", mimeType: "image/png", buffer: encodePng() };
}

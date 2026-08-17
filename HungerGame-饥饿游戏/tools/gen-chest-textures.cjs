// 生成 HungerGame 物资箱方块贴图(32×32,宝箱样式)
// 中心箱:红色饰条;野外箱:绿色饰条
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 32;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chestTexture(accent) {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const put = (x, y, r, g, b) => {
    const i = (y * SIZE + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 木纹:8×8 棋盘两色
      const checker = ((x >> 3) + (y >> 3)) % 2 === 0;
      const base = checker ? [112, 68, 30] : [98, 58, 24];
      put(x, y, base[0], base[1], base[2]);
    }
  }
  // 边框(深木)
  for (let x = 0; x < SIZE; x++) {
    for (const y of [0, 1, SIZE - 2, SIZE - 1]) put(x, y, 60, 32, 10);
  }
  for (let y = 0; y < SIZE; y++) {
    for (const x of [0, 1, SIZE - 2, SIZE - 1]) put(x, y, 60, 32, 10);
  }
  // 锁扣横条(金属)
  for (let y = 14; y <= 17; y++) {
    for (let x = 8; x <= 23; x++) {
      const edge = y === 14 || y === 17 || x === 8 || x === 23;
      put(x, y, edge ? 90 : 165, edge ? 90 : 158, edge ? 90 : 148);
    }
  }
  // 顶部饰条(等级色)
  for (let y = 3; y <= 5; y++) {
    for (let x = 3; x <= SIZE - 4; x++) put(x, y, accent[0], accent[1], accent[2]);
  }
  return px;
}

const outDir = path.join(__dirname, "..", "resource-pack", "textures", "blocks");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "hg_center_chest.png"),
  encodePng(chestTexture([192, 57, 43])),
);
fs.writeFileSync(
  path.join(outDir, "hg_wild_chest.png"),
  encodePng(chestTexture([39, 174, 96])),
);
console.log("纹理已生成:", outDir);

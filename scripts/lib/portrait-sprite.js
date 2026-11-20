const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const sharp = require('sharp');

const tileSize = 80;

async function buildPortraitSprite(root, output) {
  const portraitMap = JSON.parse(readFileSync(join(root, 'data/static/portrait-map.json'), 'utf8'));
  const manifest = new Set(JSON.parse(readFileSync(join(root, 'data/static/image-manifest.json'), 'utf8')));
  const sprites = new Map();
  const units = Object.create(null);

  for (const [unitId, file] of Object.entries(portraitMap)) {
    const name = typeof file === 'string' ? file.trim() : '';
    if (!name || name !== basename(name)) continue;
    const source = join(root, manifest.has(name) ? 'img-temp' : 'img', name);
    if (!existsSync(source)) continue;
    if (!sprites.has(source)) sprites.set(source, sprites.size);
    units[unitId] = sprites.get(source);
  }

  if (!sprites.size) throw new Error('No mapped portraits found for sprite');
  const columns = Math.ceil(Math.sqrt(sprites.size));
  const rows = Math.ceil(sprites.size / columns);
  const cell = index => [index % columns, Math.floor(index / columns)];
  const images = await Promise.all([...sprites].map(async ([source, index]) => {
    const [column, row] = cell(index);
    const input = await sharp(source).resize(tileSize, tileSize, { fit: 'cover' }).png().toBuffer();
    return { input, left: column * tileSize, top: row * tileSize };
  }));
  const image = await sharp({
    create: { width: columns * tileSize, height: rows * tileSize, channels: 4, background: 'transparent' },
  }).composite(images).webp({ quality: 80 }).toBuffer();
  const hash = createHash('sha256').update(image).digest('hex').slice(0, 12);
  const imagePath = `img/unit-portraits-${hash}.webp`;
  for (const unitId of Object.keys(units)) units[unitId] = cell(units[unitId]);

  writeFileSync(join(output, imagePath), image);
  writeFileSync(join(output, 'src/portrait-sprite-data.js'),
    `window.unitPortraitSprite = ${JSON.stringify({ imagePath, columns, rows, units })};`);
  console.log(`Portrait sprite: ${sprites.size} tiles, ${image.length} bytes`);
}

module.exports = { buildPortraitSprite };
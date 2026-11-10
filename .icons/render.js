const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = __dirname;
const OUT = path.resolve(__dirname, '..', 'resources');
const SIZE = 128;
const COUNT = 5;

const names = ['ribbon-arrows', 'bridge-code', 'list-swap', 'brackets-swap', 'bridge-ribbon'];

(async () => {
  const tiles = [];
  for (let i = 1; i <= COUNT; i++) {
    const svg = fs.readFileSync(path.join(SRC, `icon-${i}.svg`));
    const png = await sharp(svg, { density: 512 }).resize(SIZE, SIZE).png().toBuffer();
    fs.writeFileSync(path.join(OUT, `icon-${i}-${names[i - 1]}.png`), png);
    tiles.push(png);
  }

  // Contact sheet: 3 columns x 2 rows with numbering.
  const gap = 22;
  const cols = 3;
  const rows = Math.ceil(COUNT / cols);
  const width = SIZE * cols + gap * (cols + 1);
  const height = SIZE * rows + gap * (rows + 1);

  const composites = tiles.map((buffer, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      input: buffer,
      left: gap + col * (SIZE + gap),
      top: gap + row * (SIZE + gap),
    };
  });

  for (let i = 0; i < COUNT; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const badge = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
         <circle cx="14" cy="14" r="13" fill="#ffffff"/>
         <text x="14" y="19" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
               font-size="15" font-weight="700" fill="#0B1622">${i + 1}</text>
       </svg>`
    );
    const badgePng = await sharp(badge, { density: 512 }).resize(28, 28).png().toBuffer();
    composites.push({
      input: badgePng,
      left: gap + col * (SIZE + gap),
      top: gap + row * (SIZE + gap),
    });
  }

  await sharp({
    create: { width, height, channels: 4, background: '#f3f3f3' },
  })
    .composite(composites)
    .png()
    .toFile(path.join(OUT, 'icon-candidates.png'));

  console.log('written:');
  for (let i = 1; i <= COUNT; i++) console.log(`  resources/icon-${i}-${names[i - 1]}.png`);
  console.log('  resources/icon-candidates.png');

  // Same icons at real sidebar sizes (32px and 16px) on a light background.
  const small = [];
  const cell = 64;
  const smallWidth = cell * COUNT;
  for (let i = 0; i < COUNT; i++) {
    const icon32 = await sharp(tiles[i]).resize(32, 32).png().toBuffer();
    const icon16 = await sharp(tiles[i]).resize(16, 16).png().toBuffer();
    small.push({ input: icon32, left: i * cell + 16, top: 14 });
    small.push({ input: icon16, left: i * cell + 24, top: 56 });
  }
  await sharp({ create: { width: smallWidth, height: 88, channels: 4, background: '#ffffff' } })
    .composite(small)
    .png()
    .toFile(path.join(OUT, 'icon-candidates-small.png'));
  console.log('  resources/icon-candidates-small.png (32px / 16px preview)');
})();

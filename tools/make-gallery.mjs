// Builds screenshots/index.html (a numbered progression gallery) and screenshots/progression.mp4 (a timelapse).
//   node tools/make-gallery.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = path.resolve('screenshots');
const files = fs.readdirSync(dir).filter((f) => /^\d{3}-.*\.(png|jpg)$/.test(f)).sort();
const notes = fs.existsSync(path.join(dir, 'notes.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'notes.json'))) : {};
const title = (f) => f.slice(4).replace(/\.(png|jpg)$/, '').replace(/-/g, ' ');
const html = `<!doctype html><meta charset="utf-8"><title>Cal Poly campus model — build progression</title>
<style>
body{margin:0;background:#0d1117;color:#d6dde8;font:14px/1.5 -apple-system,system-ui,sans-serif}
header{padding:24px 32px}h1{margin:0 0 4px;font-size:22px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px;padding:0 32px 40px}
figure{margin:0;background:#161b22;border-radius:10px;overflow:hidden}
img{width:100%;display:block}figcaption{padding:10px 14px}b{color:#ffd54a}small{display:block;opacity:.7}
video{max-width:100%;border-radius:10px}
</style>
<header><h1>Cal Poly SLO campus model — build progression</h1>
<div>${files.length} screenshots, in the order they were captured while building and checking the model.</div>
${fs.existsSync(path.join(dir, 'progression.mp4')) ? '<p><video src="progression.mp4" controls muted loop></video></p>' : ''}</header>
<div class="grid">
${files.map((f) => `<figure><a href="${f}"><img loading="lazy" src="${f}"></a><figcaption><b>${f.slice(0, 3)}</b> ${title(f)}${notes[f] ? `<small>${notes[f]}</small>` : ''}</figcaption></figure>`).join('\n')}
</div>`;
fs.writeFileSync(path.join(dir, 'index.html'), html);

// timelapse: frames normalised to 1280x960 JPEG with Pillow (screenshots mix PNG/JPEG data), then ffmpeg at 1.6 s per frame
try {
  const tmp = path.join(dir, '.frames');
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  const py = `
import sys, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
names = sorted(f for f in os.listdir(src) if f[:3].isdigit() and f.lower().endswith(('.png', '.jpg')))
for i, f in enumerate(names):
    im = Image.open(os.path.join(src, f)).convert('RGB'); im.thumbnail((1280, 960))
    bg = Image.new('RGB', (1280, 960)); bg.paste(im, ((1280 - im.width) // 2, (960 - im.height) // 2))
    bg.save(os.path.join(out, '%04d.jpg' % i), quality=90)
`;
  execFileSync('python3', ['-I', '-c', py, dir, tmp]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '0.625', '-i', path.join(tmp, '%04d.jpg'),
    '-vf', 'format=yuv420p', '-r', '30', '-c:v', 'libx264', '-crf', '20', path.join(dir, 'progression.mp4')]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote progression.mp4');
} catch (e) { console.log('ffmpeg step skipped:', e.message.split('\n')[0]); }
console.log('wrote index.html with', files.length, 'screenshots');

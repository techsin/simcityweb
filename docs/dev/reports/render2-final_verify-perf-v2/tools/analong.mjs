// long frames on warm pages: node analong.mjs <perframe.jsonl> [skip rows] -> per segment x label: frames > 16.7 / 33.3, max
import { readJsonl, median } from './lib.mjs';
const [file, skipS = '0'] = process.argv.slice(2);
const recs = readJsonl(file).filter((r) => r.row >= +skipS);
const segs = [...new Set(recs.map((r) => r.seg))], labels = [...new Set(recs.map((r) => r.label))].sort();
console.log(`${file.split('/').pop()}: rows ${new Set(recs.map((r) => r.row)).size}`);
for (const s of segs) {
  const parts = labels.map((l) => {
    const R = recs.filter((r) => r.seg === s && r.label === l);
    const all = R.flatMap((r) => r.per);
    return `${l} ${all.filter((x) => x > 16.7).length}/${all.filter((x) => x > 33.3).length} max ${Math.max(...all).toFixed(0)} med ${median(all).toFixed(1)}`;
  });
  console.log(`${s.padEnd(11)} ${parts.join(' | ')}`);
}

// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/** stress city fixture (tests/infra/cityGen.ts stressCity, popScale 1.55 -> ~1.03M residents, TEST defs): infra-only
 *  kernel benchmarks. Load with registerTestDefs() first (tests/infra/cityGen.ts), then deserializeCity(await unpackFile(bytes)). */
import { writeFileSync } from 'node:fs';
import { stressCity } from '../../../../tests/infra/cityGen';
import { serializeCity } from '../../../../src/save/serialize';
import { packFile } from '../../../../src/save/bundle';
const c = stressCity(256, 7, { popScale: 1.55, jobsPerWorker: 1.05 });
let pop = 0; for (const b of c.st.buildings.values()) pop += b.pop;
c.st.stats.population = pop;
const bytes = await packFile(serializeCity(c.st, { copy: true }), true);
writeFileSync(process.argv[2], bytes);
console.log(`stress fixture: roads ${c.roadCells} buildings ${c.buildings} pop ${pop} jobs ${c.jobs} -> ${process.argv[2]} ${(bytes.length / 1e6).toFixed(2)} MB`);

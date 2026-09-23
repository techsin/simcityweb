/** Registers every builder module. Import this once at startup (game + gallery). */
import { registerModels } from '../registry';
import { models as residential } from './residential';
import { models as commercial } from './commercial';
import { models as industrial } from './industrial';
import { models as utility } from './utility';
import { models as civic } from './civic';
import { models as park } from './park';
import { models as landmark } from './landmark';
import { models as reward } from './reward';
import { models as transport } from './transport';
import { models as nature } from './nature';
import { models as vehicle } from './vehicle';
import { models as prop } from './prop';

let done = false;
export function registerAllModels(): void {
  if (done) return;
  done = true;
  for (const m of [residential, commercial, industrial, utility, civic, park, landmark, reward, transport, nature, vehicle, prop]) registerModels(m);
}

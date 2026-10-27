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
import { models as lmCentralLibrary } from './lm_central_library';
import { models as lmGrandCentral } from './lm_grand_central';
import { models as lmStockExchange } from './lm_stock_exchange';
import { models as lmBotanicalDome } from './lm_botanical_dome';
import { models as lmWorldTradeCenter } from './lm_world_trade_center';
import { models as lmMillenniumTower } from './lm_millennium_tower';
import { models as lmMetropolisCrown } from './lm_metropolis_crown';
/** late-game landmarks (POLISH_PLAN LG-02) */
const lateLandmarks = [lmCentralLibrary, lmGrandCentral, lmStockExchange, lmBotanicalDome, lmWorldTradeCenter, lmMillenniumTower, lmMetropolisCrown];

let done = false;
export function registerAllModels(): void {
  if (done) return;
  done = true;
  for (const m of [residential, commercial, industrial, utility, civic, park, landmark, reward, transport, nature, vehicle, prop, ...lateLandmarks]) registerModels(m);
}

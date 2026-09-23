/**
 * Advisors & news: contextual advice with per-message cooldowns (no spam: at most ADVICE_PER_MONTH per month,
 * highest priority first, ≥ MIN_COOLDOWN days per message key, doubling while the condition persists), population
 * milestones, and flavor headlines.
 * Advisors: 'finance' | 'utilities' | 'transport' | 'safety' | 'health' | 'environment' | 'planning' (+ 'news').
 * Messages go through sim.notify(text, kind, x, z, advisor).
 */
import type { SimSystem, Simulation } from '../Simulation';
import type { CityState } from '../CityState';
import { DEV_TYPE_LABELS, DevType, Zone } from '../../core/types';
import { type EconRuntime, econData, infraFlags } from './runtime';
import { capHints } from './demand';
import { residentCoverage } from './approval';
import { maxLoanAmount, loanRate } from './loans';
import { hash2 } from '../../core/rng';
import { formatMoney } from './format';

const ADVICE_PER_MONTH = 2;
/** no advice repeats sooner than this (days) */
const MIN_COOLDOWN = 60;
const money = (v: number) => formatMoney(v);
const int = (v: number) => Math.round(v).toLocaleString('en-US');

interface Advice {
  id: string;
  /** days before the same id can repeat */
  cooldown: number;
  priority: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'warning';
  advisor: string;
  x?: number;
  z?: number;
}

const POP_MILESTONES = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000];

const HEADLINES = [
  '{city} bakery wins regional croissant championship.',
  'Local high school robotics team heads to nationals.',
  'Residents of {city} vote the mayor\'s tie "most daring" of {year}.',
  'Stray cat elected honorary deputy of the {city} fire brigade.',
  'Farmers\' market in {city} breaks attendance record.',
  'Study: {city} residents own more houseplants than anyone in the region.',
  'Mayor {mayor} spotted jogging at dawn — citizens impressed.',
  'Pothole named "Gerald" becomes local celebrity before repairs.',
  '{city} sky hosts a spectacular meteor shower tonight.',
  'Jazz festival draws thousands to downtown {city}.',
  'Local inventor unveils a self-folding umbrella.',
  'Historic society restores {city}\'s first town sign.',
  'Pigeons stage sit-in on the tallest rooftop in {city}.',
  'Economists call {city} "a city on the move".',
  'Community garden produces record-breaking pumpkin.',
];

export function advisorsSystem(rt: EconRuntime): SimSystem {
  let nextHeadline = 45;

  const gather = (st: CityState): Advice[] => {
    const out: Advice[] = [];
    const s = st.stats;
    const d = econData(st);
    const inf = infraFlags(st);
    const pop = s.population;
    const inc = st.budget.lastIncome, exp = st.budget.lastExpense;
    let income = 0, expense = 0;
    for (const k in inc) if (!k.startsWith('oneoff:')) income += inc[k];
    for (const k in exp) if (!k.startsWith('oneoff:')) expense += exp[k];
    const net = income - expense;
    // ---------------- finance
    if (net < 0 && st.funds >= 0 && st.funds < -net * 8 && pop > 0) {
      out.push({ id: 'deficit', cooldown: 90, priority: 8, kind: 'warning', advisor: 'finance',
        text: `We ran a deficit of ${money(-net)} last month and only have ${money(st.funds)} left. Trim services or raise taxes a little.` });
    }
    if (st.funds >= 0 && st.funds < 5000 && pop > 200) {
      const max = maxLoanAmount(st);
      if (max > 0) out.push({ id: 'lowFunds', cooldown: 150, priority: 6, kind: 'warning', advisor: 'finance',
        text: `Funds are low (${money(st.funds)}). The bank would lend up to ${money(max)} at ${(loanRate(st) * 100).toFixed(1)}%.` });
    }
    if (net > 0 && income > 0 && net > income * 0.3 && st.funds > 150000 && pop > 5000) {
      out.push({ id: 'surplus', cooldown: 360, priority: 1, kind: 'good', advisor: 'finance',
        text: `A healthy surplus of ${money(net)}/month! Lower taxes to boost growth, or invest in services and parks.` });
    }
    const rTax = (st.budget.taxRates[0] + st.budget.taxRates[1] + st.budget.taxRates[2]) / 3;
    if (rTax >= 12 && pop > 1000) {
      out.push({ id: 'taxHigh', cooldown: 180, priority: 5, kind: 'warning', advisor: 'finance',
        text: `Residential taxes average ${rTax.toFixed(1)}% — people are leaving for cheaper cities.` });
    }
    // ---------------- utilities
    let zoned = 0;
    for (let z = Zone.ResLow; z <= Zone.IndHigh; z++) zoned += rt.emptyZoned[z];
    if (s.powerSupply <= 0 && (zoned > 30 || rt.totals.growables > 0)) {
      out.push({ id: 'noPower', cooldown: 45, priority: 10, kind: 'bad', advisor: 'utilities',
        text: 'Nothing will grow without power! Build a power plant and run power lines to your zones.' });
    } else if (!inf.utilities && s.powerDemand > s.powerSupply * 0.99 && s.powerDemand > 0) {
      out.push({ id: 'powerShortage', cooldown: 60, priority: 9, kind: 'bad', advisor: 'utilities',
        text: `Brownouts! Demand of ${s.powerDemand.toFixed(0)} MW exceeds our ${s.powerSupply.toFixed(0)} MW supply. Build a power plant.` });
    } else if (s.powerDemand > s.powerSupply * 0.85 && s.powerSupply > 0) {
      out.push({ id: 'powerTight', cooldown: 180, priority: 4, kind: 'warning', advisor: 'utilities',
        text: `The power grid is at ${Math.round((100 * s.powerDemand) / s.powerSupply)}% capacity. Plan a new plant soon.` });
    }
    if (pop > 1500 && s.waterSupply <= 0) {
      out.push({ id: 'noWater', cooldown: 90, priority: 8, kind: 'warning', advisor: 'utilities',
        text: 'Medium and high density buildings need water — build water pumps or towers.' });
    } else if (s.waterDemand > s.waterSupply && s.waterSupply > 0) {
      out.push({ id: 'waterShortage', cooldown: 60, priority: 8, kind: 'bad', advisor: 'utilities',
        text: `Water shortage: ${int(s.waterDemand)} kL/day needed, ${int(s.waterSupply)} available.` });
    }
    if (pop > 2000 && s.garbageProduced > s.garbageCapacity * 1.02) {
      out.push({ id: 'garbage', cooldown: 120, priority: 6, kind: 'warning', advisor: 'utilities',
        text: 'Garbage is piling up in the streets! Zone a landfill or build a recycling center.' });
    }
    // ---------------- transport
    if (st.neighborConnections.length === 0 && pop > 800) {
      out.push({ id: 'noConnection', cooldown: 240, priority: 5, kind: 'info', advisor: 'transport',
        text: 'Connect to the region! A highway or road off the map edge boosts demand and brings commuters.' });
    }
    if (inf.traffic) {
      let worst = 0, wi = -1;
      const cg = st.congestion;
      const step = Math.max(1, (st.cells / 4096) | 0);
      for (let i = (hash2(st.day, 3) * step) | 0; i < st.cells; i += step) if (cg[i] > worst) { worst = cg[i]; wi = i; }
      if (worst > 1.25 && wi >= 0) {
        out.push({ id: 'gridlock', cooldown: 90, priority: 6, kind: 'warning', advisor: 'transport', x: wi % st.size, z: (wi / st.size) | 0,
          text: 'Traffic is gridlocked here! Upgrade to avenues, add alternate routes or build transit.' });
      }
    }
    if (s.avgCommute > 45 && pop > 3000) {
      out.push({ id: 'commute', cooldown: 180, priority: 5, kind: 'warning', advisor: 'transport',
        text: `Commutes average ${Math.round(s.avgCommute)} minutes. Build highways, avenues, buses or subways.` });
    }
    // ---------------- safety / health / education / environment
    const cov = residentCoverage(st);
    if (pop > 2500 && d.resCrime > 0.35) {
      out.push({ id: 'crime', cooldown: 150, priority: 6, kind: 'warning', advisor: 'safety', text: 'Crime is rising in residential areas. We need more police stations.' });
    }
    if (pop > 3000 && inf.services && cov.fire < 0.2) {
      out.push({ id: 'noFire', cooldown: 180, priority: 5, kind: 'warning', advisor: 'safety', text: 'Most homes are outside fire station coverage. One spark and we lose whole blocks!' });
    }
    if (pop > 3000 && inf.services && cov.police < 0.2) {
      out.push({ id: 'noPolice', cooldown: 180, priority: 4, kind: 'warning', advisor: 'safety', text: 'Most neighborhoods have no police coverage.' });
    }
    if (pop > 5000 && s.eq < 60) {
      out.push({ id: 'eqLow', cooldown: 240, priority: 3, kind: 'info', advisor: 'health',
        text: `Our education quotient is only ${Math.round(s.eq)}. Schools attract offices and high-tech industry (and clean the air of dirty industry).` });
    }
    if (pop > 5000 && s.hq < 60) {
      out.push({ id: 'hqLow', cooldown: 240, priority: 3, kind: 'info', advisor: 'health', text: `Health is poor (HQ ${Math.round(s.hq)}). Build clinics and hospitals.` });
    }
    if (pop > 2000 && d.resPollution > 0.3) {
      out.push({ id: 'airPollution', cooldown: 180, priority: 5, kind: 'warning', advisor: 'environment',
        text: 'Smog is choking our neighborhoods. Separate industry from homes, plant trees, or pass the Clean Air Act.' });
    }
    // ---------------- planning
    for (const h of capHints(st)) {
      const what = h.family === 'R' ? 'Residential' : h.family === 'C' ? 'Commercial' : 'Industrial';
      const fix = h.family === 'R' ? 'build parks and recreation' : h.family === 'C' ? 'build an airport or landmarks' : 'build a seaport, freight rail or highway connections';
      out.push({ id: 'cap' + h.family, cooldown: 150, priority: 7, kind: 'warning', advisor: 'planning',
        text: `${what} demand is capped (${h.devs.map((x) => DEV_TYPE_LABELS[x]).join(', ')}) — ${fix}!` });
    }
    const famDemand = (a: number, b: number) => { let m = -1; for (let k = a; k <= b; k++) m = Math.max(m, s.demand[k]); return m; };
    const room = (zs: number[]) => zs.reduce((t, z) => t + rt.emptyFront[z], 0);
    if (famDemand(0, 2) > 0.5 && room([Zone.ResLow, Zone.ResMed, Zone.ResHigh]) < 12) {
      out.push({ id: 'zoneR', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning', text: 'Residential demand is strong but there is no room to grow — zone more residential land along roads.' });
    }
    if (famDemand(3, 7) > 0.5 && room([Zone.ComLow, Zone.ComMed, Zone.ComHigh]) < 8) {
      out.push({ id: 'zoneC', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning', text: 'Businesses want to open shops and offices — zone more commercial land.' });
    }
    if (famDemand(8, 11) > 0.5 && room([Zone.IndAg, Zone.IndMed, Zone.IndHigh]) < 8) {
      out.push({ id: 'zoneI', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning', text: 'Industry wants to move in — zone industrial land, ideally near highways or rail.' });
    }
    // sub-type specific: strong demand for a DevType whose zones have no room at all
    const SUBTYPE_HINT: [number, number[], string][] = [
      [DevType.IHT, [Zone.IndHigh], 'High-tech industry wants to move in, but there is no high-density industrial zone. Zone some — clean, educated areas are best.'],
      [DevType.IA, [Zone.IndAg], 'Farmers are looking for land. Zone agricultural land on flat ground away from pollution.'],
      [DevType.CO3, [Zone.ComMed, Zone.ComHigh], 'Corporate offices (CO$$$) want high land value downtown — zone medium or high density commercial.'],
      [DevType.R3, [Zone.ResLow, Zone.ResMed, Zone.ResHigh], 'Wealthy residents are looking for homes. Zone residential land near parks and water.'],
    ];
    for (const [dev, zs, text] of SUBTYPE_HINT) {
      if (s.demand[dev] > 0.6 && room(zs) === 0) out.push({ id: 'zoneDev' + dev, cooldown: 150, priority: 6, kind: 'info', advisor: 'planning', text });
    }
    if (pop > 2000 && s.unemployment > 0.15) {
      out.push({ id: 'unemployment', cooldown: 120, priority: 7, kind: 'warning', advisor: 'planning',
        text: `Unemployment is at ${Math.round(s.unemployment * 100)}%. Zone more commercial and industrial land.` });
    }
    if (pop > 2000 && rt.jobFill < 0.8 && rt.jobFill > 0) {
      out.push({ id: 'workers', cooldown: 120, priority: 5, kind: 'info', advisor: 'planning', text: 'Businesses cannot find enough workers. Zone more residential land.' });
    }
    if (rt.totals.abandoned > 20) {
      out.push({ id: 'abandoned', cooldown: 180, priority: 4, kind: 'warning', advisor: 'planning',
        text: `${rt.totals.abandoned} buildings stand abandoned. Check power, water, road access, crime, pollution and demand.` });
    }
    return out;
  };

  return {
    name: 'economy.advisors',
    init(sim) {
      rt.attach(sim);
      const d = econData(sim.state);
      if (!d.popMilestone) d.popMilestone = POP_MILESTONES.filter((m) => m <= sim.state.stats.population).pop() ?? 0;
    },
    daily(sim) {
      const st = sim.state;
      const d = econData(st);
      // population milestones
      const pop = st.stats.population;
      for (const m of POP_MILESTONES) {
        if (m > d.popMilestone && pop >= m) {
          d.popMilestone = m;
          sim.notify(`${st.config.name} reaches ${m.toLocaleString('en-US')} residents!`, 'good', undefined, undefined, 'news');
        }
      }
      // flavor headlines
      if (st.day >= nextHeadline) {
        nextHeadline = st.day + 40 + sim.rng.int(0, 60);
        if (pop > 300) {
          const h = sim.rng.pick(HEADLINES).replaceAll('{city}', st.config.name).replaceAll('{mayor}', st.config.mayor).replaceAll('{year}', String(st.year));
          sim.notify(h, 'info', undefined, undefined, 'news');
        }
      }
    },
    monthly(sim) {
      const st = sim.state;
      const d = econData(st);
      const list = gather(st).sort((a, b) => b.priority - a.priority);
      // persistent conditions back off: each repeat doubles the cooldown (max ×8); cleared conditions reset
      const streak = (d.streak ??= {});
      const active = new Set(list.map((a) => a.id));
      for (const id of Object.keys(streak)) if (!active.has(id)) delete streak[id];
      let shown = 0;
      for (const a of list) {
        if (shown >= ADVICE_PER_MONTH) break;
        const last = d.cooldowns[a.id];
        const cooldown = Math.max(MIN_COOLDOWN, a.cooldown) * 2 ** Math.min(3, streak[a.id] ?? 0);
        if (last !== undefined && st.day - last < cooldown) continue;
        d.cooldowns[a.id] = st.day;
        streak[a.id] = (streak[a.id] ?? 0) + 1;
        sim.notify(a.text, a.kind === 'info' ? 'advisor' : a.kind, a.x, a.z, a.advisor);
        shown++;
      }
    },
  };
}

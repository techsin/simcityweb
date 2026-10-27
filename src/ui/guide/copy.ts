/** Onboarding copy (§4). Each leaf has a stable id; long plan examples are separate, short tips. */
import { MONTHS_PER_YEAR } from '../../core/constants';
import { Zone } from '../../core/types';
import type { Building, CityStats } from '../../sim/CityState';
import { WIND_SPACING } from '../../sim/actions';
import { getDef } from '../../sim/catalog';
import { DIFFICULTY_FUNDS } from '../../sim/config';
import { CONN_MIN_CELLS, CONN_MIN_DEPTH } from '../../sim/economy/connections';
import type { LoanOffer } from '../../sim/economy/loans';
import { ORDINANCES } from '../../sim/economy/ordinances';
import { REWARDS } from '../../sim/economy/rewards';
import * as tuning from '../../sim/economy/tuning';
import * as params from '../../sim/infra/params';
import { money, moneySigned, num, pct } from '../format';

/** Guide targets belong to the caller's tuning, not to the wording. No defaults duplicate future guide rules. */
export interface WindStart {
  turbines: number;
  /** Teaching estimate including jobs and services, not the simulation's residential-only power rate. */
  residentsPerMW: number;
  residentRounding: number;
}
/** Already scaled by the caller for the city's size and buildable land. */
export interface ZoneTargets { R: number; C: number; I: number }
type PowerStats = Pick<CityStats, 'powerDemand' | 'powerSupply'>;
type LoanTerms = Pick<LoanOffer, 'monthlyPayment' | 'termMonths'>;

const decimal = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
/** "1 point" / "2 points" (the count as `decimal` prints it) */
const points = (n: number) => decimal(n) + (n === 1 ? ' point' : ' points');
const windGap = () => WIND_SPACING - 1; // cell distance -> empty tiles between footprints
const incomeBonus = (multiplier: number) => pct(Math.abs(multiplier - 1));
const loanYears = (offer: LoanTerms) => decimal(offer.termMonths / MONTHS_PER_YEAR);

function building(id: string) {
  const def = getDef(id);
  if (!def) throw new Error(`Missing guide building: ${id}`);
  return def;
}

function windOutput(hills = false): number {
  return building('util_wind_turbine').powerOut! * (params.WIND_TURBINE_BASE + (hills ? params.WIND_TURBINE_GAIN : 0));
}

function windResidents(start: WindStart): number {
  return Math.floor(start.turbines * windOutput() * start.residentsPerMW / start.residentRounding) * start.residentRounding;
}

function rewardPopulation(defId: string): number {
  const reward = REWARDS.find((r) => r.defIds.includes(defId));
  const population = reward?.conds.find((c) => c.label === 'Population');
  if (!population) throw new Error(`Missing guide reward population: ${defId}`);
  return population.need;
}

function cleanupName(): string {
  const ordinance = ORDINANCES.find((o) => o.id === 'rubble_cleanup');
  if (!ordinance) throw new Error('Missing guide cleanup ordinance');
  return ordinance.name;
}

/** Import by phase and id, e.g. guideCopy.phaseB.B3(start). Only presentation; no triggers or state writes. */
export const guideCopy = {
  phaseA: {
    // §4.3 A1 · FH-12: first-run primary button.
    A1: () => 'Start your first city',
    // §4.3 A1 · FH-12: the caller supplies its first-road time estimate.
    A1Subtitle: (minutes: number) => `Guided · your first road in about ${num(minutes)} minutes`,
    // §4.3 A1 · FH-12: secondary title-screen button.
    A1Region: () => 'Create a new region',
    // §4.3 A2 · FH-12: first-city loading tip, with the same estimate as B3Output.
    A2Wind: (start: WindStart) => `Start small: ${num(start.turbines)} ${building('util_wind_turbine').name.toLowerCase()}s power about ${num(windResidents(start))} of your first residents.`,
    // §4.3 A2 · FH-12: road-access loading tip.
    A2Zones: () => 'Your zones only grow next to roads.',
    // §4.3 A2 · FH-12: paused-start loading tip.
    A2Play: () => 'The game waits for you until you press Play.',
    // §4.3 A3 · FH-11: recommended region tile.
    A3Tile: () => 'A good first city for you',
    // §4.3 A3 · FH-11: guided-start toggle.
    A3Guided: () => 'Guide your first steps',
    // §4.3 A3 · FH-11, FH-18: veteran toggle.
    A3Veteran: () => 'Skip to your veteran briefing',
    // §4.3 A3 · FH-11: Easy difficulty; future grace rules must come from FH-04.
    A3Easy: () => `Easy — you start with ${money(DIFFICULTY_FUNDS.easy)} and earn ${incomeBonus(tuning.DIFFICULTY_INCOME.easy)} extra taxes. Recommended for your first city.`,
    // §4.3 A3 · FH-11: Medium difficulty.
    A3Medium: () => `Medium — you start with ${money(DIFFICULTY_FUNDS.medium)} at the intended balance.`,
    // §4.3 A3 · FH-11: Hard difficulty.
    A3Hard: () => `Hard — you start with ${money(DIFFICULTY_FUNDS.hard)} and earn ${incomeBonus(tuning.DIFFICULTY_INCOME.hard)} less tax. Keep your budget tight from the start.`,
    // §4.3 A3 · FH-11: Sandbox difficulty.
    A3Sandbox: () => 'Sandbox — you have unlimited money and everything unlocked.',
    // §4.3 A3 · FH-11: disasters.ts currently has no exported population threshold.
    A3Disasters: (minimumPopulation: number) => `Tornadoes, quakes and meteors can hit your town from ${num(minimumPopulation)} residents. Off is fine for your first city.`,
  },
  phaseB: {
    // §4.4 · FH-01: founding card header.
    BTitle: () => 'Found your town',
    // §4.4 · FH-01: paused-state explanation.
    BPaused: () => 'The game is paused while you build.',
    // §4.4 B1 · FH-01: road step title.
    B1Title: () => 'Connect to the region',
    // §4.4 B1 · FH-01: road step.
    B1: () => 'Build a road from the map edge into your town. New residents and trade arrive along it.',
    // §4.4 B1 · FH-01: both minimum connection requirements, including the short-stub fix.
    B1Hint: () => `Run your road at least ${num(CONN_MIN_DEPTH)} tiles in from the edge, with at least ${num(CONN_MIN_CELLS)} connected road tiles.`,
    // §4.4 B2 · FH-01: zoning step title.
    B2Title: () => 'Zone homes, shops and jobs',
    // §4.4 B2 · FH-01: size-adjusted zoning counts.
    B2: (target: ZoneTargets) => `Along your roads, zone about ${num(target.R)} tiles of homes (R), ${num(target.C)} of shops (C) and ${num(target.I)} of industry (I).`,
    // §4.4 B2 · FH-01: prices of the recommended residential, commercial and industrial zones.
    B2Cost: () => `Your zoning costs ${money(Math.min(tuning.ZONE_COST[Zone.ResLow], tuning.ZONE_COST[Zone.ComLow], tuning.ZONE_COST[Zone.IndMed]))}–${money(Math.max(tuning.ZONE_COST[Zone.ResLow], tuning.ZONE_COST[Zone.ComLow], tuning.ZONE_COST[Zone.IndMed]))} a tile.`,
    // §4.4 B2 · FH-01: roadless-zone hint.
    B2RoadHint: () => "Some of your zones don't touch a road — nothing grows there yet.",
    // §4.4 B2 · FH-01: actual road-accessible housing count, supplied by the guide predicate.
    B2CountHint: (target: ZoneTargets, accessibleHomes: number) => `Zone more homes (R): aim for ${num(target.R)} road-accessible tiles; you have ${num(accessibleHomes)}.`,
    // §4.4 B3 · FH-01: power step title.
    B3Title: () => 'Start your power supply with wind',
    // §4.4 B3 · FH-01: cheap choice, catalog price and placement spacing.
    B3: (start: WindStart) => `Place ${num(start.turbines)} ${building('util_wind_turbine').name.toLowerCase()}s (${money(building('util_wind_turbine').cost!)} each) beside your road, with ${num(windGap())} empty tiles between them.`,
    // §4.4 B3 · FH-01: output and conservative combined population estimate.
    B3Output: (start: WindStart) => `Each makes ${decimal(windOutput())} MW on flat land, up to ${decimal(windOutput(true))} on hills; together, they power about ${num(windResidents(start))} of your residents.`,
    // §4.4 B3 · FH-01, FH-18: also suitable for the welcome tip and utilities advisor.
    B3Roads: () => 'Place your power plant beside a road — roads carry power to your zones.',
    // §4.4 B3 · FH-01: unserved-zone hint.
    B3Hint: () => "Your plant isn't reaching any zone yet — connect it to your zones with roads.",
    // §4.4 B3 · FH-01: selected fuel plant; estimate includes jobs and services, as in WindStart.
    B3FuelHint: (defId: string, residentsPerMW: number) => `Your ${building(defId).name} costs ${money(building(defId).cost!)} for ${num(building(defId).powerOut!)} MW, about ${num(building(defId).powerOut! * residentsPerMW)} residents. Wind is plenty for now.`,
    // §4.4 B4 · FH-01: water step title.
    B4Title: () => 'Add water to your town',
    // §4.4 B4 · FH-01: water choice, capacity and road placement.
    B4: () => `Place a ${building('util_water_tower').name} (${money(building('util_water_tower').cost!)}, ${num(building('util_water_tower').waterOut!)} kL/day) touching a road past your zones.`,
    // §4.4 B4 · FH-01: automatic pipes and the density rule.
    B4Pipes: () => 'Your roads include pipes; medium and high density, including the default industry zone, need water.',
    // §4.4 B4 · FH-01: unserved-zone hint.
    B4Hint: () => 'Your zones have no water yet — connect the tower to a road that runs past them.',
    // §4.4 B5 · FH-01: play step title.
    B5Title: () => 'Press play',
    // §4.4 B5 · FH-01: play step.
    B5: () => 'Unpause and watch your town grow. Space pauses at any time.',
    // §4.4 B5 · FH-01: locked guide button; keyboard play remains available.
    B5Locked: () => 'Finish your steps above first — or press Space to play anyway.',
    // §4.4 · FH-01: actual day-zero spend, from the caller's ledger.
    BSpend: (spent: number, startFunds: number) => `You've spent ${money(spent)} of ${money(startFunds)} before anyone moved in. Running costs come next — keep a reserve.`,
    // §4.4 · FH-01: completion toast.
    BComplete: () => 'Your town is on the map, Mayor! A few goals will guide your first year.',
    // §4.4 · FH-01: only shown when the caller found a fuel plant.
    BCompleteFire: () => `Protect your fuel plant with a ${building('civ_fire_station').name} (${money(building('civ_fire_station').cost!)}) beside its road.`,
  },
  phaseC: {
    // §4.5 · FH-02: goal card header.
    CTitle: () => 'Your first year',
    // §4.5 · FH-02: progress and the current goal title.
    CProgress: (completed: number, total: number, title: string) => `Your progress: ${num(completed)}/${num(total)} · ${title}`,
    // §4.5 G1 · FH-02: population target from guide tuning.
    G1Title: (population: number) => `Grow to ${num(population)} residents`,
    // §4.5 G1 · FH-02: demand bars.
    G1: () => 'The coloured demand bars (RCI) show what your town wants. Zone more of the tallest bar.',
    // §4.5 G1 · FH-02: Query follow-up.
    G1Query: () => "Click one of your lots with Query to see why it isn't growing.",
    // §4.5 G2 · FH-02: garbage goal title.
    G2Title: () => 'Take out the trash',
    // §4.5 G2 · FH-02: landfill dimensions from guide tuning and price from zone tuning.
    G2: (width: number, depth: number) => `Garbage is piling up at your homes. Zone a ${num(width)}×${num(depth)} ${building('util_landfill_tile').name.toLowerCase()} (${money(tuning.ZONE_COST[Zone.Landfill])} a tile) beside a road, away from homes.`,
    // §4.5 G3 · FH-02: police goal title.
    G3Title: () => 'Keep your streets safe',
    // §4.5 G3 · FH-02: affordable police choices.
    G3: () => `Crime costs you approval. A ${building('civ_police_kiosk').name} (${money(building('civ_police_kiosk').cost!)}) covers blocks; a ${building('civ_police_station').name} (${money(building('civ_police_station').cost!)}) covers a district.`,
    // §4.5 G4 · FH-02: fire goal title.
    G4Title: () => 'Cover your town against fire',
    // §4.5 G4 · FH-02: manual dispatch and approximate automatic reach.
    G4: () => `Uncovered fires need you to send help. A ${building('civ_fire_station').name} (${money(building('civ_fire_station').cost!)}) answers automatically within about ${num(building('civ_fire_station').coverage!.radius)} road tiles.`,
    // §4.5 G5 · FH-02: budget goal title.
    G5Title: () => 'Balance your books',
    // §4.5 G5 · FH-02: monthly tax-point projection from FH-05, with shared approval tuning.
    G5: (taxIncomePerPoint: number) => `Each tax point earns you about ${money(taxIncomePerPoint)} monthly; above ${decimal(tuning.TAX_NEUTRAL)}%, each costs ${decimal(Math.abs(tuning.APPROVAL.taxPerPoint))} approval. Check your budget before building more.`,
    // §4.5 G6 · FH-02: education goal title.
    G6Title: () => 'Give your children a school',
    // §4.5 G6 · FH-02: actual unreached pupils and catalog seats.
    G6: (stats: Pick<CityStats, 'needs'>) => `${num(stats.needs.elementary.unreached)} of your children have no school. An ${building('civ_elementary_school').name} (${money(building('civ_elementary_school').cost!)}) seats ${num(building('civ_elementary_school').coverage!.capacity!)} within walking distance.`,
    // §4.5 G7 · FH-02: data-view goal title.
    G7Title: () => 'See your city',
    // §4.5 G7 · FH-02: data views.
    G7: () => 'Data views colour your map by power, water, crime, pollution and more.',
    // §4.5 G8 · FH-02: inspector goal title.
    G8Title: () => 'Ask why',
    // §4.5 G8 · FH-02: Why? is a control label, not a third sentence.
    G8: () => 'Click any of your buildings with Query. The Why? section lists what helps it and what holds it back.',
    // §4.5 G9 · FH-02: reward goal title.
    G9Title: () => 'Claim your first reward',
    // §4.5 G9 · FH-02: reward population, name and price from their definitions.
    G9: () => `At ${num(rewardPopulation('civ_mayor_house'))} residents, you unlock the ${building('civ_mayor_house').name} (${money(building('civ_mayor_house').cost!)}); it raises nearby land value.`,
    // §4.5 G9 · FH-02: NEW-06 supplies a valid placement result, not just the presence of water.
    G9Next: (hasValidShoreSite: boolean) => {
      const id = hasValidShoreSite ? 'lm_lighthouse' : 'lm_clock_tower';
      return `Your next landmark, the ${building(id).name}, unlocks at ${num(rewardPopulation(id))} residents.`;
    },
    // §4.5 G10 · FH-02: upgrade goal title.
    G10Title: () => 'Add more power',
    // §4.5 G10 · FH-02: current supply and demand.
    G10: (stats: PowerStats) => `Your town needs ${decimal(stats.powerDemand)} MW and makes ${decimal(stats.powerSupply)} MW.`,
    // §4.5 G10 · FH-02: small upgrade option.
    G10Wind: () => `Add a ${building('util_wind_turbine').name} (${money(building('util_wind_turbine').cost!)}, about ${decimal(windOutput())} MW on flat land), leaving ${num(windGap())} empty tiles between your turbines.`,
    // §4.5 G10 · FH-02: larger upgrade option, including its cooling requirement.
    G10Gas: () => `Build your ${building('util_gas_plant').name} for ${money(building('util_gas_plant').cost!)}: ${num(building('util_gas_plant').powerOut!)} MW with ${num(building('util_gas_plant').waterUse!)} kL/day of cooling water.`,
    // §4.5 G10 · FH-02: local effects from the selected plant definition.
    G10Siting: () => `Keep your ${building('util_gas_plant').name} away from homes: smoke reaches ${num(building('util_gas_plant').pollution!.radius!)} tiles; neighbour dislike (stigma) reaches ${num(building('util_gas_plant').stigma!.radius)}.`,
    // §4.5 · FH-02: G9 handover; G10 can still appear afterwards.
    CComplete: () => 'Your first year is done, Mayor. The advisors take it from here — your next goal is on the top bar.',
  },
  phaseD: {
    // §4.6 E1a · FH-08: station identity and travel time from EmergencyView.
    E1a: (station: Pick<Building, 'def' | 'id'>, travelMinutes: number) => `No station covers this spot automatically. Send nearest dispatches your ${building(station.def).name} #${num(station.id)} (${decimal(travelMinutes)} min).`,
    // §4.6 E1a · FH-08: legend label, independent of colour.
    E1aLegend: () => 'Your Emergency view marks covered areas as "Auto-dispatch"; help goes there automatically.',
    // §4.6 E1b · FH-08: unreachable incident.
    E1b: () => `No station can reach this in time. Build your ${building('civ_fire_station').name} within about ${num(building('civ_fire_station').coverage!.radius)} road tiles; the Emergency view shows automatic coverage.`,
    // §4.6 E2 · FH-08: plain description before the LIVE code.
    E2: () => 'Your game slowed to follow the truck (LIVE). Your speed returns when help arrives; change this in Settings.',
    // §4.6 E3 · FH-08: actual incident travel time and deadline, in emergency minutes.
    E3: (travelMinutes: number, deadlineMinutes: number) => `Your nearest truck needed ${decimal(travelMinutes)} min; this fire burned out in ${decimal(deadlineMinutes)} min. A station within about ${num(building('civ_fire_station').coverage!.radius)} road tiles answers automatically.`,
    // §4.6 E4 · FH-13: FH-05 supplies the monthly budget and proposed tax delta.
    E4: (monthlyNet: number, taxPoints: number, monthlyGain: number) => `Your town spends ${money(Math.abs(monthlyNet))} more than it earns monthly. Raising taxes by ${points(taxPoints)} brings about ${money(monthlyGain)} a month.`,
    // §4.6 E4 · FH-13: real loanOffer terms; no repeated amortization formula.
    E4Loan: (amount: number, offer: LoanTerms) => `Your ${money(amount)} loan costs ${money(offer.monthlyPayment)} a month for ${loanYears(offer)} years.`,
    // §4.6 E5 · FH-13: recovery card header.
    E5: () => 'Bring your budget back into balance',
    // §4.6 E5 · FH-13: first recovery action and its FH-05 projection.
    E5Taxes: (points: number, monthlyGain: number) => `Raise each of your taxes by ${decimal(points)} point: about ${moneySigned(monthlyGain)} a month.`,
    // §4.6 E5 · FH-13: caller selects the most over-funded service and supplies its projected saving.
    E5Service: (service: string, fundingPercent: number, monthlySaving: number) => `Set your ${service} funding to ${decimal(fundingPercent)}%: save about ${money(monthlySaving)} a month.`,
    // §4.6 E5 · FH-13: caller selects the largest affordable offer; proceeds are not recurring income.
    E5Loan: (amount: number, offer: LoanTerms) => `Borrow ${money(amount)}, your largest affordable loan: receive ${money(amount)} now and pay ${money(offer.monthlyPayment)} monthly for ${loanYears(offer)} years.`,
    // §4.6 E6 · FH-03: stalled housing growth.
    E6Homes: () => 'Your town has no room to grow — zone more homes (R) next to roads.',
    // §4.6 E6 · FH-03: stalled commercial growth.
    E6Shops: () => 'Your town has no room to grow — zone more shops (C) next to roads.',
    // §4.6 E6 · FH-03: stalled industrial growth.
    E6Industry: () => 'Your town has no room to grow — zone more industry (I) next to roads.',
    // §4.6 E7 · FH-02: residential cap fix from capHints, kept short enough for a coach card.
    E7Homes: () => `Raise your homes' demand cap (R) with parks, plazas, a ${building('park_zoo').name} or landmarks.`,
    // §4.6 E7 · FH-02: commercial cap fix from capHints.
    E7Shops: () => `Raise your shops' demand cap (C) with a ${building('tr_airport_small').name}, ${building('civ_convention_center').name} or landmarks.`,
    // §4.6 E7 · FH-02: industrial cap fix from capHints.
    E7Industry: () => `Raise your industry's demand cap (I) with regional highway or rail connections, a ${building('tr_freight_station').name} or ${building('tr_seaport').name}.`,
    // §4.6 E8 · FH-02, FH-06: caller supplies the biggest negative approval term from its watch.
    E8: (approval: number, drag: { label: string; value: number }) => `Your approval is ${decimal(approval)}%; the biggest drag is ${drag.label} (${decimal(drag.value)}).`,
    // §4.6 E8 · FH-02, FH-06: current riot rules, with no claim that low approval blocks growth.
    E8Risk: () => {
      const [approval] = params.RIOT_APPROVAL, [crime] = params.RIOT_CRIME;
      return `With at least ${num(params.RIOT_MIN_POP)} residents, your town risks riots below ${decimal(approval)}% approval and above ${pct(crime)} crime.`;
    },
    // §4.6 E9 · FEEL-06: unlocked reward announcement.
    E9: (defId: string) => `Your citizens have unlocked the ${building(defId).name}! Place it from Rewards.`,
    // §4.6 E10 · FH-02, LG-15: event and district names come from the incident report.
    E10: (disaster: string, district: string, rubbleBuildings: number) => `A ${disaster} hit your district, ${district}: ${num(rubbleBuildings)} buildings are rubble.`,
    // §4.6 E10 · FH-02, LG-15: clearing price and ordinance name from their definitions.
    E10Clear: () => `Clear your lots with Bulldoze (${money(tuning.RUBBLE_FEE_PER_CELL)} a tile) or adopt ${cleanupName()} for automatic clearing, so they can rebuild.`,
    // §4.6 E11 · FH-02, LG-21: first New Year addendum.
    E11: () => 'Each year-end shows how your city did.',
    // §4.6 E12 · FH-02: live power balance in the first brownout.
    E12: (stats: PowerStats) => `Some of your homes have no power: your town needs ${decimal(stats.powerDemand)} MW and your plants make ${decimal(stats.powerSupply)} MW.`,
    // §4.6 E12 · FH-02: PB-OUTAGE consequence and the recommended fixes.
    E12Fix: () => `Your homes without power empty fast — add ${building('util_wind_turbine').name.toLowerCase()}s or a ${building('util_gas_plant').name}.`,
  },
  phaseE: {
    // §4.7 · FH-18: veteran briefing, roads.
    Roads: () => 'Your roads carry power; power lines only bridge gaps.',
    // §4.7 · FH-18: veteran briefing, water and default industry.
    Pipes: () => 'Your roads include pipes; medium and high density, including default industry, need water.',
    // §4.7 · FH-18: veteran briefing, real regional-connection requirements.
    Region: () => `Connect your town to the region with ${num(CONN_MIN_CELLS)} road tiles reaching ${num(CONN_MIN_DEPTH)} tiles in from the map edge.`,
    // §4.7 · FH-18: veteran briefing, uncovered incidents.
    Emergencies: () => 'Uncovered emergencies slow your game to follow dispatch (LIVE); send help.',
    // §4.7 · FH-18: veteran briefing, inspector.
    Inspector: () => 'Inspect your buildings with Why? to understand them.',
    // §4.7 · FH-18: veteran briefing, neutral tax rate and approval effect.
    Taxes: () => `Your neutral tax rate is ${decimal(tuning.TAX_NEUTRAL)}%; each point above costs ${decimal(Math.abs(tuning.APPROVAL.taxPerPoint))} approval.`,
  },
  actions: {
    // §4.4 B1 · FH-01: road tool button.
    Road: () => 'Build a road',
    // §4.4 B2, §4.6 E6 · FH-01, FH-03: zoning button.
    Zones: () => 'Open zones',
    // §4.4 B3 · FH-01: turbine tool button.
    Wind: () => `Place a ${building('util_wind_turbine').name}`,
    // §4.4 B4 · FH-01: tower tool button.
    Water: () => `Place a ${building('util_water_tower').name}`,
    // §4.4 B5 · FH-01: play button.
    Play: () => 'Play',
    // §4.5 G1, G8 · FH-02: query tool button.
    Query: () => 'Inspect a building',
    // §4.5 G2 · FH-02: landfill zone button.
    Landfill: () => `Zone a ${building('util_landfill_tile').name}`,
    // §4.5 G3 · FH-02: police tab and view.
    Police: () => 'Open police cover',
    // §4.5 G4, §4.6 E1b, E3 · FH-02, FH-08: fire tab.
    Fire: () => 'Open fire cover',
    // §4.5 G5, §4.6 E4 · FH-02, FH-13: taxes tab.
    Taxes: () => 'Check your taxes',
    // §4.6 E4 · FH-13: loans tab.
    Loans: () => 'Check your loans',
    // §4.5 G6 · FH-02: education tab and view.
    Education: () => 'Open schools',
    // §4.5 G7 · FH-02: data views.
    Views: () => 'Explore data views',
    // §4.5 G9, §4.6 E7 · FH-02: rewards panel.
    Rewards: () => 'See your rewards',
    // §4.5 G10, §4.6 E12 · FH-02: power tab.
    Power: () => 'Open power supplies',
    // §4.6 E1a · FH-08: dispatch button (label also appears in E1a).
    SendNearest: () => 'Send nearest',
    // §4.6 E1a, E1b · FH-08: emergency view.
    EmergencyView: () => 'Open Emergency view',
    // §4.6 E1a, E2, E4, §4.7 · FH-08, FH-13, FH-18: dismiss button.
    GotIt: () => 'Continue',
    // §4.6 E2 · FH-08: settings button.
    Settings: () => 'Open Settings',
    // §4.6 E7 · FH-02: parks tab.
    Parks: () => 'Open parks',
    // §4.6 E8 · FH-06: term-specific fix label from the approval row.
    FixApproval: (fix: string) => `Open ${fix}`,
    // §4.6 E9 · FEEL-06: reward placement button.
    PlaceReward: (defId: string) => `Place your ${building(defId).name}`,
    // §4.6 E10 · FH-02: jump to the disaster.
    Jump: () => 'Go to the damage',
    // §4.6 E10 · FH-02: bulldoze tool.
    Bulldoze: () => 'Clear rubble',
    // §4.6 E10 · FH-02, LG-15: ordinance panel.
    Ordinances: () => 'Open ordinances',
    // §4.6 E12 · FH-02: power view.
    PowerView: () => 'Open Power view',
    // §4.7 · FH-18: switch back to the founding guide.
    GuidedStart: () => 'Show your guided start anyway',
  },
} as const;

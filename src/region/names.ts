/** Pleasant random names for cities, mayors and regions. Deterministic when given an RNG. */
import { RNG } from '../core/rng';

const CITY_FULL = [
  'Maplewood', 'Riverton', 'Oakhaven', 'Brightwater', 'Silverlake', 'Fairhaven', 'Cedar Falls', 'Willowbrook', 'Harborview',
  'Stonebridge', 'Ashford', 'Clearwater', 'Kingsport', 'Pinecrest', 'Northfield', 'Summerdale', 'Elmstead', 'Bayside',
  'Goldcrest', 'Ravenwood', 'Lakeshore', 'Meadowvale', 'Foxborough', 'Highgarden', 'Seabrook', 'Westmere', 'Evergreen',
  'Juniper Hills', 'Port Aurora', 'Amberly', 'Bellmont', 'Copperton', 'Dunmore', 'Easton Bay', 'Glenwood', 'Hollowmere',
  'Ivybridge', 'Larkspur', 'Millbrook', 'New Avalon', 'Oceanside', 'Primrose', 'Queensbury', 'Rosewood', 'Sunnyvale',
  'Thornbury', 'Upton Falls', 'Valemont', 'Whitby Harbor', 'Yarrow Point', 'Zephyr Bay', 'Crystal Springs', 'Emerald Cove',
  'Starling Heights', 'Lighthouse Point', 'Birchwood', 'Hawthorne', 'Mistral', 'Solace', 'Tidewater', 'Wrenfield',
];
const PREFIX = [
  'Maple', 'River', 'Oak', 'Bright', 'Silver', 'Fair', 'Cedar', 'Willow', 'Harbor', 'Stone', 'Ash', 'Clear', 'King', 'Pine',
  'North', 'South', 'East', 'West', 'Summer', 'Winter', 'Elm', 'Bay', 'Gold', 'Raven', 'Lake', 'Meadow', 'Fox', 'High',
  'Sea', 'Green', 'Red', 'Blue', 'Iron', 'Copper', 'Rose', 'Sun', 'Moon', 'Star', 'Birch', 'Hazel', 'Glen', 'Heather',
  'Lark', 'Mill', 'Spring', 'Crystal', 'Amber', 'Swan', 'Wren', 'Falcon', 'Heron', 'Brook', 'Holly', 'Linden', 'Aspen',
];
const SUFFIX = [
  'ton', 'ville', 'wood', 'field', 'ford', 'haven', 'port', 'dale', 'mont', 'brook', 'bury', 'ridge', 'view', 'side',
  'crest', 'water', 'gate', 'stead', 'wick', 'mouth', 'hollow', 'vale', 'shire', 'minster', 'burgh', 'land', 'moor',
];
const CITY_POST = [' Falls', ' Springs', ' Heights', ' Harbor', ' Park', ' Hills', ' Bay', ' Point', ' Crossing', ' Junction', ' Grove'];

const FIRST = [
  'Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley', 'Avery', 'Quinn', 'Harper', 'Rowan', 'Elena', 'Marcus', 'Sofia',
  'Daniel', 'Grace', 'Oliver', 'Amelia', 'Henry', 'Clara', 'Leo', 'Maya', 'Theo', 'Nora', 'Felix', 'Iris', 'Hugo', 'Ada',
  'Victor', 'Julia', 'Arthur', 'Lucia', 'Samuel', 'Hannah', 'Isaac', 'Mei', 'Kenji', 'Priya', 'Omar', 'Ingrid', 'Mateo',
  'Aisha', 'Lars', 'Chloe', 'Rafael', 'Yara', 'Emil', 'Zoe', 'Diego', 'Freya', 'Nikolai', 'Anika', 'Tomas', 'Selma',
];
const LAST = [
  'Bennett', 'Carter', 'Hayes', 'Morgan', 'Reyes', 'Sullivan', 'Whitfield', 'Holloway', 'Ashby', 'Delgado', 'Fischer',
  'Nakamura', 'Okafor', 'Lindqvist', 'Moreau', 'Rossi', 'Kowalski', 'Andersen', 'Park', 'Chen', 'Patel', 'Novak',
  'Brennan', 'Castillo', 'Duval', 'Everhart', 'Fairbanks', 'Grant', 'Hartley', 'Ingram', 'Jansen', 'Keller', 'Lambert',
  'Mercer', 'Nolan', 'Ortega', 'Prescott', 'Quinlan', 'Radcliffe', 'Sinclair', 'Thorne', 'Vance', 'Winslow', 'Young',
];

const REGION_A = ['Emerald', 'Golden', 'Silver', 'Azure', 'Crimson', 'Misty', 'Sunlit', 'Windy', 'Quiet', 'Northern', 'Southern', 'Hidden', 'Painted', 'Amber', 'Verdant', 'Sapphire'];
const REGION_B = ['Valley', 'Coast', 'Plains', 'Highlands', 'Isles', 'Basin', 'Shores', 'Downs', 'Heights', 'Lowlands', 'Bay', 'Reach', 'Frontier', 'Expanse', 'Delta', 'Hills'];

function rngOf(r?: RNG): RNG {
  return r ?? new RNG((Math.random() * 2 ** 32) >>> 0);
}

export function randomCityName(r?: RNG): string {
  const rng = rngOf(r);
  const roll = rng.next();
  if (roll < 0.4) return rng.pick(CITY_FULL);
  let name = rng.pick(PREFIX) + rng.pick(SUFFIX);
  name = name.replace(/(.)\1\1/g, '$1$1');
  if (roll > 0.82) name += rng.pick(CITY_POST);
  return name;
}

export function randomMayorName(r?: RNG): string {
  const rng = rngOf(r);
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}

export function randomRegionName(r?: RNG): string {
  const rng = rngOf(r);
  return `${rng.pick(REGION_A)} ${rng.pick(REGION_B)}`;
}

/** Population announcements shared by the milestone card and sound cues. */
export const POP_MILESTONES = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000, 1250000, 1500000];

export function populationMilestone(text: string): number | null {
  // Match the announcement's suffix, even when the city name contains "reaches ... residents".
  const match = / reaches ([\d,]+) residents!$/i.exec(text);
  const pop = match ? Number(match[1].replace(/,/g, '')) : 0;
  return POP_MILESTONES.includes(pop) ? pop : null;
}

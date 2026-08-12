import {SimulationGame} from '../../src/sim/game';
import {makeRng, withRng} from '../../src/sim/rng';

const args = process.argv.slice(2);
const getArg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const batch = getArg('--batch', 0);
const pairs = getArg('--pairs', 250);
const seedBase = 930000000 + batch * 100000;

let groupedWins = 0;
let baselineWins = 0;
let draws = 0;
let groupedAsFirstWins = 0;
let groupedAsSecondWins = 0;
let firstPlayerWins = 0;
let totalTurns = 0;
let groupedSweeps = 0;
let splits = 0;
let baselineSweeps = 0;

function run(seed: number, policy: 'baseline' | 'grouped') {
  return withRng(makeRng(seed), () => {
    const game = new SimulationGame(12, 500, 'prep', ['expert', 'expert']);
    game.preparationPolicy = policy;
    return game.run();
  });
}

for (let i = 0; i < pairs; i++) {
  const seed = seedBase + i;

  // Game A: grouped strategy is the second/preparation player.
  const a = run(seed, 'grouped');
  // Game B: baseline strategy is the second/preparation player, so grouped identity is first.
  const b = run(seed, 'baseline');

  totalTurns += a.turns + b.turns;
  if (a.winner === 0) firstPlayerWins++;
  if (b.winner === 0) firstPlayerWins++;

  let pairGroupedWins = 0;
  let pairBaselineWins = 0;

  if (a.winner === 'draw') draws++;
  else if (a.winner === 1) {
    groupedWins++;
    groupedAsSecondWins++;
    pairGroupedWins++;
  } else {
    baselineWins++;
    pairBaselineWins++;
  }

  if (b.winner === 'draw') draws++;
  else if (b.winner === 0) {
    groupedWins++;
    groupedAsFirstWins++;
    pairGroupedWins++;
  } else {
    baselineWins++;
    pairBaselineWins++;
  }

  if (pairGroupedWins === 2) groupedSweeps++;
  else if (pairBaselineWins === 2) baselineSweeps++;
  else splits++;
}

const out = {
  batch,
  pairs,
  games: pairs * 2,
  groupedWins,
  baselineWins,
  draws,
  groupedAsFirstWins,
  groupedAsSecondWins,
  firstPlayerWins,
  totalTurns,
  groupedSweeps,
  splits,
  baselineSweeps,
};
console.log(JSON.stringify(out));
await import('node:fs/promises').then(fs => fs.writeFile(`grouped-ab-${batch}.json`, JSON.stringify(out)));

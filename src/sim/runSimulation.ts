/*
 * 模擬器的命令列進入點。對局邏輯在 ./game。
 */
import {pathToFileURL} from 'node:url';

import {
  type AiDifficulty,
  type OpeningMode,
  SimulationGame,
} from './game';
import {type BanditConfig, DEFAULT_BANDIT_CONFIG, LEGACY_BANDIT_CONFIG} from './bandit';

// 給 --ladder / --b-ladder 用的階梯預設值，方便兩種形狀直接對打
const LADDER_PRESETS: Record<string, BanditConfig> = {
  merged: DEFAULT_BANDIT_CONFIG,
  legacy: LEGACY_BANDIT_CONFIG,
};

function pickLadder(name: string): BanditConfig {
  const preset = LADDER_PRESETS[name];
  if (!preset) throw new Error(`--ladder must be one of: ${Object.keys(LADDER_PRESETS).join(', ')}`);
  return {...preset, playLadder: preset.playLadder.map(x => ({...x}))};
}

type MatchupMode = 'custom' | 'expert-mirror' | 'expert-normal' | 'bandit-expert' | 'bandit-tune';

function isAiDifficulty(v: string): v is AiDifficulty {
  return v === 'normal' || v === 'expert' || v === 'bandit';
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    games: 1000,
    hp: 12,
    maxTurns: 500,
    opening: 'prep' as OpeningMode,
    p0Ai: 'normal' as AiDifficulty,
    p1Ai: 'normal' as AiDifficulty,
    matchup: 'custom' as MatchupMode,
    banditConfig: {...DEFAULT_BANDIT_CONFIG},
    // 對照組設定，給 bandit-tune 用（B 方坐第二席）
    banditConfigB: {...DEFAULT_BANDIT_CONFIG},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--games' && next) {
      opts.games = Number(next);
      i++;
    } else if (arg === '--hp' && next) {
      opts.hp = Number(next);
      i++;
    } else if (arg === '--max-turns' && next) {
      opts.maxTurns = Number(next);
      i++;
    } else if (arg === '--opening' && next) {
      if (next !== 'prep' && next !== 'even' && next !== 'staged') {
        throw new Error('--opening must be "prep", "even", or "staged"');
      }
      opts.opening = next;
      i++;
    } else if (arg === '--ai' && next) {
      if (!isAiDifficulty(next)) throw new Error('--ai must be "normal", "expert" or "bandit"');
      opts.p0Ai = next;
      opts.p1Ai = next;
      i++;
    } else if (arg === '--p0-ai' && next) {
      if (!isAiDifficulty(next)) throw new Error('--p0-ai must be "normal", "expert" or "bandit"');
      opts.p0Ai = next;
      i++;
    } else if (arg === '--p1-ai' && next) {
      if (!isAiDifficulty(next)) throw new Error('--p1-ai must be "normal", "expert" or "bandit"');
      opts.p1Ai = next;
      i++;
    } else if (arg === '--ladder' && next) {
      opts.banditConfig = pickLadder(next);
      i++;
    } else if (arg === '--b-ladder' && next) {
      opts.banditConfigB = pickLadder(next);
      i++;
    } else if (arg === '--effect-budget' && next) {
      opts.banditConfig.effectBudget = Number(next);
      i++;
    } else if (arg === '--b-effect-budget' && next) {
      opts.banditConfigB.effectBudget = Number(next);
      i++;
    } else if (arg === '--matchup' && next) {
      if (next !== 'custom' && next !== 'expert-mirror' && next !== 'expert-normal'
          && next !== 'bandit-expert' && next !== 'bandit-tune') {
        throw new Error('--matchup must be "custom", "expert-mirror", "expert-normal", "bandit-expert" or "bandit-tune"');
      }
      opts.matchup = next;
      i++;
    }
  }

  if (!Number.isInteger(opts.games) || opts.games <= 0) throw new Error('--games must be a positive integer');
  if (!Number.isFinite(opts.hp) || opts.hp <= 0) throw new Error('--hp must be a positive number');
  if (!Number.isInteger(opts.maxTurns) || opts.maxTurns <= 0) throw new Error('--max-turns must be a positive integer');
  if (opts.matchup === 'expert-mirror') {
    opts.p0Ai = 'expert';
    opts.p1Ai = 'expert';
  }

  return opts;
}

function formatPct(n: number, total: number) {
  return `${((n / total) * 100).toFixed(2)}%`;
}

type SeriesStats = {
  p0Ai: AiDifficulty;
  p1Ai: AiDifficulty;
  games: number;
  firstWins: number;
  secondWins: number;
  draws: number;
  totalTurns: number;
  elapsedMs: number;
};

function runSeries(opts: ReturnType<typeof parseArgs>, p0Ai: AiDifficulty, p1Ai: AiDifficulty, swapConfigs = false): SeriesStats {
  const started = performance.now();
  let firstWins = 0;
  let secondWins = 0;
  let draws = 0;
  let totalTurns = 0;

  for (let i = 0; i < opts.games; i++) {
    const game = new SimulationGame(opts.hp, opts.maxTurns, opts.opening, [p0Ai, p1Ai]);
    game.banditConfigs = swapConfigs
      ? [opts.banditConfigB, opts.banditConfig]
      : [opts.banditConfig, opts.banditConfigB];
    const result = game.run();
    totalTurns += result.turns;
    if (result.winner === 0) firstWins++;
    else if (result.winner === 1) secondWins++;
    else draws++;
  }

  return {
    p0Ai,
    p1Ai,
    games: opts.games,
    firstWins,
    secondWins,
    draws,
    totalTurns,
    elapsedMs: performance.now() - started,
  };
}

function printSeries(stats: SeriesStats) {
  console.log(`P0/First AI: ${stats.p0Ai}`);
  console.log(`P1/Second AI: ${stats.p1Ai}`);
  console.log(`Simulations: ${stats.games}`);
  console.log('');
  console.log(`First player wins:  ${stats.firstWins} (${formatPct(stats.firstWins, stats.games)})`);
  console.log(`Second player wins: ${stats.secondWins} (${formatPct(stats.secondWins, stats.games)})`);
  console.log(`Draws/capped:        ${stats.draws} (${formatPct(stats.draws, stats.games)})`);
  console.log('');
  console.log(`Average turns: ${(stats.totalTurns / stats.games).toFixed(2)}`);
  console.log(`Elapsed: ${(stats.elapsedMs / 1000).toFixed(2)}s`);
  console.log(`Throughput: ${(stats.games / (stats.elapsedMs / 1000)).toFixed(0)} games/sec`);
}

/*
 * 兩個 AI 各當一次先手再合併統計。
 * 這個遊戲的先手/後手起手張數不同（3 vs 4），單邊對戰量不出真實強度差。
 */
function runTwoLegMatchup(
  opts: ReturnType<typeof parseArgs>,
  aiA: AiDifficulty,
  aiB: AiDifficulty,
) {
  console.log(`Matchup: ${aiA}-${aiB}`);
  console.log(`Games per seat: ${opts.games}`);
  console.log('');

  console.log(`--- Leg 1: ${aiA} first vs ${aiB} second ---`);
  const legA = runSeries(opts, aiA, aiB);
  printSeries(legA);
  console.log('');

  console.log(`--- Leg 2: ${aiB} first vs ${aiA} second ---`);
  const legB = runSeries(opts, aiB, aiA);
  printSeries(legB);
  console.log('');

  const totalGames = legA.games + legB.games;
  const aWins = legA.firstWins + legB.secondWins;
  const bWins = legA.secondWins + legB.firstWins;
  const draws = legA.draws + legB.draws;
  const totalTurns = legA.totalTurns + legB.totalTurns;
  const elapsedMs = legA.elapsedMs + legB.elapsedMs;

  console.log('--- Aggregate by AI ---');
  console.log(`Total simulations: ${totalGames}`);
  console.log(`${aiA} wins: ${aWins} (${formatPct(aWins, totalGames)})`);
  console.log(`${aiB} wins: ${bWins} (${formatPct(bWins, totalGames)})`);
  console.log(`Draws/capped: ${draws} (${formatPct(draws, totalGames)})`);
  console.log(`Average turns: ${(totalTurns / totalGames).toFixed(2)}`);
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log(`Throughput: ${(totalGames / (elapsedMs / 1000)).toFixed(0)} games/sec`);
}

function main() {
  const opts = parseArgs();

  console.log(`Initial HP: ${opts.hp}`);
  console.log(`Opening mode: ${opts.opening}`);
  console.log(`Max turns per game: ${opts.maxTurns}`);
  console.log('');

  if (opts.matchup === 'expert-normal') {
    runTwoLegMatchup(opts, 'expert', 'normal');
    return;
  }

  if (opts.matchup === 'bandit-expert') {
    runTwoLegMatchup(opts, 'bandit', 'expert');
    return;
  }

  /*
   * 兩組 bandit 設定直接對打。
   * 拿兩邊各自去打 expert 是量不出差距的 —— 都已經七成多，逼近天花板。
   */
  if (opts.matchup === 'bandit-tune') {
    const fmt = (c: BanditConfig) => {
      const cost = c.playLadder.reduce((sum, st, idx) => {
        const alive = idx === 0 ? c.playPool : c.playLadder[idx - 1].keep;
        return sum + alive * st.samples;
      }, 0);
      const champ = c.playLadder.reduce((sum, st) => sum + st.samples, 0);
      const shape = [c.playPool, ...c.playLadder.map(st => st.keep)].join('>');
      return `${shape}｜每階模擬 ${c.playLadder.map(st => st.samples).join(',')}｜成本 ${cost}、冠軍樣本 ${champ}`;
    };
    console.log(`A: ${fmt(opts.banditConfig)}`);
    console.log(`B: ${fmt(opts.banditConfigB)}`);
    console.log('');

    console.log('--- Leg 1: A 先手 ---');
    const leg1 = runSeries(opts, 'bandit', 'bandit', false);
    printSeries(leg1);
    console.log('');
    console.log('--- Leg 2: B 先手 ---');
    const leg2 = runSeries(opts, 'bandit', 'bandit', true);
    printSeries(leg2);
    console.log('');

    const total = leg1.games + leg2.games;
    const aWins = leg1.firstWins + leg2.secondWins;
    const bWins = leg1.secondWins + leg2.firstWins;
    const se = Math.sqrt(0.25 / total) * 100;
    console.log('--- Aggregate ---');
    console.log(`Total: ${total}`);
    console.log(`A wins: ${aWins} (${formatPct(aWins, total)})`);
    console.log(`B wins: ${bWins} (${formatPct(bWins, total)})`);
    console.log(`50% 的抽樣誤差約 ±${se.toFixed(2)}%（1 sigma）`);
    console.log(`Elapsed: ${((leg1.elapsedMs + leg2.elapsedMs) / 1000).toFixed(1)}s`);
    return;
  }

  const stats = runSeries(opts, opts.p0Ai, opts.p1Ai);
  if (opts.matchup === 'expert-mirror') console.log('Matchup: expert-mirror');
  else console.log('Matchup: custom');
  console.log('');
  printSeries(stats);
}

/*
 * 只有直接執行這個檔案（npm run sim）時才跑 CLI。
 * 以前這裡是無條件 main()，任何地方 import 這個模組都會意外跑起一整輪模擬並印一堆
 * 輸出 —— 之後 AI 要重用模擬器的元件時，第一個踩到的就是這個。
 */
const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectRun) main();


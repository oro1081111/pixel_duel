import {SimulationGame, type AiDifficulty} from '../../src/sim/game';
import {makeRng, withRng} from '../../src/sim/rng';

type Matchup = [AiDifficulty, AiDifficulty];

const matchups: Matchup[] = [
    ['normal', 'normal'],
    ['adept', 'normal'],
    ['expert', 'adept'],
    ['expert', 'expert'],
];

const seeds = [
    2026081201,
    2026081202,
    2026081203,
    2026081204,
    2026081205,
    2026081206,
    2026081207,
    2026081208,
];

const rows: Array<{
    matchup: string;
    seed: number;
    winner: 0 | 1 | 'draw';
    turns: number;
}> = [];

for (const [p0, p1] of matchups) {
    for (const seed of seeds) {
        const result = withRng(makeRng(seed), () => {
            const game = new SimulationGame(12, 500, 'prep', [p0, p1]);
            return game.run();
        });
        rows.push({matchup: `${p0}-${p1}`, seed, ...result});
    }
}

process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);

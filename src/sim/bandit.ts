import type {GameCard} from '../engine/state';
import type {SimulationGame} from './runSimulation';
import {makeRng, withRng} from './rng';

/*
 * 單回合 Bandit AI。
 *
 * 想法：不要用手調權重猜「這樣打好不好」，而是把這一手真的打下去、模擬到回合結束、
 * 看結果如何，重複多次取統計值。只模擬自己的回合 —— 對手下一回合怎麼打不去猜，
 * 因為那需要對手的手牌（隱藏資訊），猜錯的成本比不猜還高。
 *
 * 這不是 MCTS：沒有樹、沒有 UCB1 的探索/利用權衡。它是固定預算下的
 * Best-Arm Identification —— 候選是已知的一小組，只需要用有限的模擬次數
 * 找出最好的那個。Successive Halving 對這個問題比 UCB 更省。
 *
 * 分工：
 *   - bandit 只決定「現在這個決策點要選哪個候選」。
 *   - rollout 內部剩下的所有決策一律用現有 expert 啟發式（+15% 隨機）走完。
 *     少了這條，出牌 rollout 途中又跑一次效果 bandit，複雜度會指數爆炸。
 */

// ---------------------------------------------------------------- 評估

/*
 * 對手下一回合的防禦值現在還不知道（他要等到自己的防禦階段才決定），
 * 所以攻擊價值要對「各種可能的防禦值」加權平均。
 * 這個先驗偏低防禦：實測一般玩家一回合累積 0~3 點防禦最常見。
 *
 * 這一步是整個評分的關鍵。防禦是逐次攻擊扣減的，所以面對 2 點防禦時
 * 2+2+2 造成 0 傷害、單一個 6 造成 4 傷害 —— 只比較攻擊總和會完全看不出差別。
 */
const DEFENSE_PRIOR = [0.30, 0.28, 0.20, 0.12, 0.07, 0.03];

// 每個出牌張數在候選池裡的保底名額
const MIN_PLANS_PER_PLAY_COUNT = 2;

export type TurnOutcome = {
    /** 對手在我這回合內就被打死（奪魂之類的直接傷害） */
    won: boolean;
    /** 我在這回合的傷害階段死了 */
    died: boolean;
    myHp: number;
    /** 對各種假設防禦值加權後的期望輸出傷害 */
    offense: number;
    /** 手牌與場上卡片總數，購買階段的成果 */
    economy: number;
};

function damageAgainstDefense(attacks: number[][], piercing: number[][], defense: number) {
    const normal = attacks.flat().reduce((sum, atk) => sum + Math.max(0, atk - defense), 0);
    const pierce = piercing.flat().reduce((sum, atk) => sum + Math.max(0, atk), 0);
    return normal + pierce;
}

export function evaluateTurnOutcome(game: SimulationGame, myIdx: 0 | 1): TurnOutcome {
    const me = game.players[myIdx];
    const opp = game.players[1 - myIdx];

    // 回合結束時 attackQueue 裝的就是下回合會打到對手的東西
    let offense = 0;
    for (let d = 0; d < DEFENSE_PRIOR.length; d++) {
        offense += DEFENSE_PRIOR[d] * damageAgainstDefense(me.attackQueue, me.piercingQueue, d);
    }

    return {
        won: opp.hp <= 0,
        died: me.hp <= 0,
        myHp: me.hp,
        offense,
        // 卡片數是購買成果的粗略代理。卡片「品質」暫時不計 —— 這是最低優先層，
        // 只在前面幾層都打平時才會用到。
        economy: me.hand.length + me.board.flat().length,
    };
}

// ---------------------------------------------------------------- 統計與比較

type ArmStats = {
    n: number;
    wins: number;
    deaths: number;
    hp: number[];
    offense: number[];
    economy: number[];
};

function newStats(): ArmStats {
    return {n: 0, wins: 0, deaths: 0, hp: [], offense: [], economy: []};
}

function record(stats: ArmStats, o: TurnOutcome) {
    stats.n++;
    if (o.won) stats.wins++;
    if (o.died) stats.deaths++;
    stats.hp.push(o.myHp);
    stats.offense.push(o.offense);
    stats.economy.push(o.economy);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stderr(xs: number[]) {
    if (xs.length < 2) return Infinity;
    const m = mean(xs);
    const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(variance / xs.length);
}

function proportionStderr(k: number, n: number) {
    if (n < 2) return Infinity;
    const p = k / n;
    return Math.sqrt((p * (1 - p)) / n);
}

/*
 * 分層比較，但不是嚴格字典序。
 *
 * 純字典序在蒙地卡羅估計上很脆弱：兩個候選的死亡率只差 0.02（完全在抽樣誤差內），
 * 字典序會照這個雜訊武斷分出高下，永遠看不到下一層。
 * 這裡每一層只有在差距超過抽樣誤差時才算分出勝負，否則視為平手往下看。
 *
 * 回傳 > 0 表示 a 比較好。
 */
function compareArms(a: ArmStats, b: ArmStats): number {
    const decide = (
        aVal: number, bVal: number, aErr: number, bErr: number, higherIsBetter: boolean,
    ) => {
        const diff = aVal - bVal;
        const tolerance = Math.min(aErr + bErr, 1e9);
        if (Math.abs(diff) <= tolerance) return 0;
        return (higherIsBetter ? diff : -diff) > 0 ? 1 : -1;
    };

    // 0. 這回合直接打死對手：決定性的，優先於一切
    const winCmp = decide(
        a.wins / Math.max(1, a.n), b.wins / Math.max(1, b.n),
        proportionStderr(a.wins, a.n), proportionStderr(b.wins, b.n), true,
    );
    if (winCmp !== 0) return winCmp;

    // 1. 避免自己死亡
    const deathCmp = decide(
        a.deaths / Math.max(1, a.n), b.deaths / Math.max(1, b.n),
        proportionStderr(a.deaths, a.n), proportionStderr(b.deaths, b.n), false,
    );
    if (deathCmp !== 0) return deathCmp;

    // 2. 少受傷（剩餘生命越高越好）
    const hpCmp = decide(mean(a.hp), mean(b.hp), stderr(a.hp), stderr(b.hp), true);
    if (hpCmp !== 0) return hpCmp;

    // 3. 給對手最多傷害
    const offCmp = decide(mean(a.offense), mean(b.offense), stderr(a.offense), stderr(b.offense), true);
    if (offCmp !== 0) return offCmp;

    // 4. 卡片收益（最低優先，純平手判定）
    return decide(mean(a.economy), mean(b.economy), stderr(a.economy), stderr(b.economy), true);
}

// ---------------------------------------------------------------- Successive Halving

export type BanditConfig = {
    /** 出牌階段每次決策的 rollout 總預算 */
    playBudget: number;
    /** 效果階段每次決策的 rollout 總預算 */
    effectBudget: number;
    /** 出牌候選先用靜態啟發式預篩到幾個，再進 SH */
    playCandidateCap: number;
};

export const DEFAULT_BANDIT_CONFIG: BanditConfig = {
    playBudget: 300,
    effectBudget: 100,
    playCandidateCap: 16,
};

/*
 * 固定預算的 Successive Halving：所有候選先各跑少量，排序後砍掉一半，
 * 存活者分到更多次數，重複到剩一個。
 *
 * 每一輪裡「第 j 次 rollout」對所有候選都用同一個 seed（Common Random Numbers）：
 * 候選之間的差異才會是決策本身的差異，而不是誰運氣好抽到好骰子。
 * 這比單純增加次數有效得多。
 */
function successiveHalving<T>(
    arms: T[],
    rollout: (arm: T, seed: number) => TurnOutcome,
    budget: number,
    seedBase: number,
): T {
    if (arms.length === 1) return arms[0];

    let alive = arms.map(arm => ({arm, stats: newStats()}));
    const rounds = Math.max(1, Math.ceil(Math.log2(arms.length)));
    const perRound = Math.max(1, Math.floor(budget / rounds));
    let seedCursor = seedBase;

    while (alive.length > 1) {
        const samplesPerArm = Math.max(1, Math.floor(perRound / alive.length));
        for (let j = 0; j < samplesPerArm; j++) {
            const seed = seedCursor + j;
            for (const entry of alive) record(entry.stats, rollout(entry.arm, seed));
        }
        seedCursor += samplesPerArm;

        alive.sort((x, y) => compareArms(y.stats, x.stats));
        alive = alive.slice(0, Math.max(1, Math.floor(alive.length / 2)));
    }
    return alive[0].arm;
}

// ---------------------------------------------------------------- 出牌階段

export type PlayStep = {cardId: string; areaIdx: number};

/*
 * 同一區裡只有最上層那張的「效果」有效，但堆疊裡每一張的左右屬性都會計入判定。
 * 所以兩個出牌方案只要「每區有哪些牌」與「每區誰在最上層」相同，結果就完全相同，
 * 中間的順序不影響任何事 —— 這個去重讓候選數少掉一個數量級。
 */
function planKey(steps: PlayStep[]) {
    const areas: string[][] = [[], [], []];
    const top: Array<string | null> = [null, null, null];
    steps.forEach(s => {
        areas[s.areaIdx].push(s.cardId);
        top[s.areaIdx] = s.cardId;
    });
    return areas.map((ids, i) => `${[...ids].sort().join('+')}>${top[i] ?? ''}`).join('|');
}

export function enumeratePlayPlans(hand: GameCard[]): PlayStep[][] {
    const plans: PlayStep[][] = [];
    const seen = new Set<string>();
    const maxK = Math.min(3, hand.length);
    const chosen: PlayStep[] = [];
    const used = new Set<number>();

    const recurse = () => {
        if (chosen.length > 0) {
            const key = planKey(chosen);
            if (!seen.has(key)) {
                seen.add(key);
                plans.push([...chosen]);
            }
        }
        if (chosen.length === maxK) return;
        for (let i = 0; i < hand.length; i++) {
            if (used.has(i)) continue;
            used.add(i);
            for (let a = 0; a < 3; a++) {
                chosen.push({cardId: hand[i].id, areaIdx: a});
                recurse();
                chosen.pop();
            }
            used.delete(i);
        }
    };
    recurse();
    return plans;
}

function applyPlan(game: SimulationGame, plan: PlayStep[]) {
    for (const step of plan) {
        const handIdx = game.players[game.currentPlayerIndex].hand.findIndex(c => c.id === step.cardId);
        if (handIdx === -1) continue;
        game.playCardPublic(handIdx, step.areaIdx);
    }
}

export function banditChoosePlayPlan(
    game: SimulationGame,
    cfg: BanditConfig = DEFAULT_BANDIT_CONFIG,
): PlayStep[] | null {
    const myIdx = game.currentPlayerIndex;
    const hand = game.players[myIdx].hand;
    if (hand.length === 0) return null;

    let plans = enumeratePlayPlans(hand);

    /*
     * 候選數會到好幾百，全部丟進 SH 的話第一輪每個只分得到不到一次 rollout，
     * 淘汰就純粹是雜訊。先用現有 expert 的靜態評分預篩 —— 它當提案分布夠用，
     * bandit 真正要決定的是「打幾張、放哪一區」，那部分完全交給模擬。
     *
     * 代價是天花板被限制在「expert 前 N 名之內」。若之後發現這裡漏掉好棋，
     * 再換成 beam search（先評估單張前綴、保留前幾名再展開）。
     */
    if (plans.length > cfg.playCandidateCap) {
        /*
         * 名額要按「出幾張」分開配。
         * 靜態分數是每張牌相加，出 3 張的總分幾乎必然大於出 1 張，
         * 直接取總分前 N 名的話候選池會被 3 張方案佔滿，
         * 而「少出一張換多一顆骰子」有時才是對的（例如場上有光輝之箭時）。
         * 每個出牌張數各保障一份名額，讓 bandit 真的有機會比較這件事。
         */
        const byCount = new Map<number, Array<{plan: PlayStep[]; score: number}>>();
        for (const plan of plans) {
            const score = plan.reduce((sum, step) => {
                const card = hand.find(c => c.id === step.cardId);
                return sum + (card ? game.scoreCardForBandit(card, step.areaIdx) : 0);
            }, 0);
            const bucket = byCount.get(plan.length) ?? [];
            bucket.push({plan, score});
            byCount.set(plan.length, bucket);
        }
        const buckets = [...byCount.keys()].sort((a, b) => a - b);
        for (const bucket of byCount.values()) bucket.sort((a, b) => b.score - a.score);

        // 每個張數保底 2 個名額，其餘照總分填滿。
        // 均分名額會反過來餓死主流張數的多樣性；保底只是確保「少出一張」這個選項
        // 一定會被實際模擬過，而不是被總分掃出候選池。
        const picked = new Set<PlayStep[]>();
        for (const k of buckets) {
            for (const x of byCount.get(k)!.slice(0, MIN_PLANS_PER_PLAY_COUNT)) picked.add(x.plan);
        }
        const rest = buckets
            .flatMap(k => byCount.get(k)!)
            .filter(x => !picked.has(x.plan))
            .sort((a, b) => b.score - a.score);
        for (const x of rest) {
            if (picked.size >= cfg.playCandidateCap) break;
            picked.add(x.plan);
        }
        plans = [...picked];
    }

    const seedBase = Math.floor(Math.random() * 1e9);
    return successiveHalving(
        plans,
        (plan, seed) => withRng(makeRng(seed), () => {
            const clone = game.cloneForRollout();
            applyPlan(clone, plan);
            clone.currentPhaseIndex = 1;
            clone.finishTurnForRollout();
            return evaluateTurnOutcome(clone, myIdx);
        }),
        cfg.playBudget,
        seedBase,
    );
}

// ---------------------------------------------------------------- 效果階段

/*
 * 效果階段不枚舉「完整發動序列」，而是每次只選下一個原子行動：
 * 發動某個效果、或 STOP。做完之後盤面變了，再重新搜一次。
 *
 * 這樣「要不要發動 / 發動幾次 / 什麼順序」三件事會自然浮現，不需要分別設計。
 * 而且候選數天生就很少（場上最多 3 張效果卡），所以這裡不用 Successive Halving，
 * 直接把預算平均分給每個候選就好 —— 少一套要維護與除錯的邏輯。
 */
export type ActivationChoice = {index: number} | 'STOP';

export function banditChooseActivation(
    game: SimulationGame,
    phase: number,
    cfg: BanditConfig = DEFAULT_BANDIT_CONFIG,
): ActivationChoice {
    const myIdx = game.currentPlayerIndex;
    const options = game.availableActivationsPublic();
    if (options.length === 0) return 'STOP';

    const arms: ActivationChoice[] = ['STOP', ...options.map((_, index) => ({index}))];
    const samplesPerArm = Math.max(2, Math.floor(cfg.effectBudget / arms.length));
    const seedBase = Math.floor(Math.random() * 1e9);

    const entries = arms.map(arm => ({arm, stats: newStats()}));
    for (let j = 0; j < samplesPerArm; j++) {
        const seed = seedBase + j;
        for (const entry of entries) {
            const outcome = withRng(makeRng(seed), () => {
                const clone = game.cloneForRollout();
                if (entry.arm !== 'STOP') {
                    const acts = clone.availableActivationsPublic();
                    // clone 的盤面與本體相同，選項順序也相同
                    acts[entry.arm.index]?.run();
                }
                // STOP 代表「這個階段不再發動」，rollout 也必須跳過本階段剩下的發動，
                // 否則 STOP 會退化成「讓 expert 決定」，跟其他候選比不出差別。
                clone.finishTurnForRollout(entry.arm === 'STOP', phase);
                return evaluateTurnOutcome(clone, myIdx);
            });
            record(entry.stats, outcome);
        }
    }

    entries.sort((x, y) => compareArms(y.stats, x.stats));
    return entries[0].arm;
}

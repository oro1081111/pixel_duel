import type {GameCard} from '../engine/state';
import type {SimulationGame} from './game';
import {shuffled} from '../engine/deck';
import {makeRng, rng, withRng} from './rng';

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

export type TurnOutcome = {
    /** 對手在我這回合內就被打死（奪魂之類的直接傷害） */
    won: boolean;
    /** 我在這回合的傷害階段死了 */
    died: boolean;
    /** 回合結束時對手剩餘生命 */
    oppHp: number;
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
        oppHp: opp.hp,
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
    oppHp: number[];
    hp: number[];
    offense: number[];
    economy: number[];
};

function newStats(): ArmStats {
    return {n: 0, wins: 0, deaths: 0, oppHp: [], hp: [], offense: [], economy: []};
}

function record(stats: ArmStats, o: TurnOutcome) {
    stats.n++;
    if (o.won) stats.wins++;
    if (o.died) stats.deaths++;
    stats.oppHp.push(o.oppHp);
    stats.hp.push(o.myHp);
    stats.offense.push(o.offense);
    stats.economy.push(o.economy);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/*
 * 樣本數 < 2 時回傳 0，不是 Infinity。
 *
 * 單一樣本估不出變異數，直覺上該說「沒有資訊、視為平手」——
 * 但預篩第一輪每個候選就只有一個樣本，全判平手的話淘汰會退化成
 * 照枚舉順序砍，完全不看模擬結果。
 * 而且有 Common Random Numbers，同一輪所有候選看到同一組骰子，
 * 這一個樣本是配對比較，直接比原始數值是有意義的。
 */
function stderr(xs: number[]) {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(variance / xs.length);
}

function proportionStderr(k: number, n: number) {
    if (n < 2) return 0;
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

    // 2. 壓低對手生命（剩餘生命越低越好）
    const oppHpCmp = decide(mean(a.oppHp), mean(b.oppHp), stderr(a.oppHp), stderr(b.oppHp), false);
    if (oppHpCmp !== 0) return oppHpCmp;

    // 3. 少受傷（自己剩餘生命越高越好）
    const hpCmp = decide(mean(a.hp), mean(b.hp), stderr(a.hp), stderr(b.hp), true);
    if (hpCmp !== 0) return hpCmp;

    // 4. 給對手最多傷害
    const offCmp = decide(mean(a.offense), mean(b.offense), stderr(a.offense), stderr(b.offense), true);
    if (offCmp !== 0) return offCmp;

    // 5. 卡片收益（最低優先，純平手判定）
    return decide(mean(a.economy), mean(b.economy), stderr(a.economy), stderr(b.economy), true);
}

// ---------------------------------------------------------------- Successive Halving

export type LadderStep = {
    /** 這一輪每個存活候選各跑幾次模擬 */
    samples: number;
    /** 跑完後把候選砍到剩幾個 */
    keep: number;
};

export type BanditConfig = {
    /**
     * 出牌候選的隨機抽樣上限。
     *
     * 需要上限是因為候選數隨手牌張數暴增（9 張手牌有 4743 種出牌方案），
     * 不設限時 p99 延遲會到 1 秒以上 —— 中位數再漂亮，偶爾凍結一下玩家還是會感覺到。
     * 隨機抽樣會丟掉候選，但不引入任何偏好，而且方案之間高度重複。
     */
    playPool: number;
    /**
     * 出牌決策的淘汰階梯：每一階讓存活者各跑幾次，然後砍到剩幾個。
     *
     * 這裡刻意把錢集中在前段。實測（兩組設定直接對打，各 500 局）顯示
     * 「每個候選模擬更多次」加 4 倍幾乎沒差（+0.8pp），
     * 「考慮更多候選」加 4 倍卻有 +8.4pp —— 搜尋早就收斂了，
     * 真正會漏掉好棋的地方是那手棋根本沒進候選池。
     */
    playLadder: LadderStep[];
    /** 效果階段每次決策的 rollout 總預算 */
    effectBudget: number;
    /**
     * 「選目標」每次決策的 rollout 總預算。
     *
     * 命運、冰霜、幸運、幻象這四張需要在發動後再挑一個目標，選錯就白費。
     * 其餘需要選目標的卡（貫穿、再現、閃光、疾閃）選最大的那次攻擊可以證明最優，
     * 不需要模擬 —— 傷害是 Σ max(0, 攻擊 − 防禦)，這幾個效果的增益對攻擊值單調遞增，
     * 所以選最大的在任何防禦值下都同時最優。
     */
    targetBudget: number;
    /**
     * 命運／冰霜／幸運／幻象的目標要不要用模擬挑（false 則沿用手調啟發式）。
     * 留成開關是為了能在同一個難度下直接對打比較，不然分不出這件事值不值得。
     */
    simulateTargets: boolean;
    /**
     * 命運之石專用的淘汰階梯（null 則和其他三張一樣，平均分掉 targetBudget）。
     *
     * 為什麼只有它要特別處理：它的候選是「骰子索引的所有非空子集合」，
     * 數量隨骰數指數成長，遠多於其他三張（最多 6 個）。
     * 平均分 60 的預算下來每個候選只剩幾次模擬，就算有 CRN 配對也很薄。
     *
     * 實測 330 次發動當下的骰數（基礎擲骰是 5 − 已出牌數，手牌空時 5）：
     *   4 顆 60.0%（15 候選）｜3 顆 33.6%（7）｜2 顆 5.5%（3）｜5 顆 0.9%（31）
     * 平均 11.8 個候選，最多觀察到 5 顆骰。
     *
     * 量過了（250 個真實決策點，以「每候選 40 次模擬」的高預算選擇為基準）：
     *   階梯 159 次   一致率 58.4%
     *   平均分 62 次  一致率 44.4%   ← 比它取代掉的啟發式還差
     *   手調啟發式    一致率 49.6%
     *   亂選          一致率 14.0%
     * 所以平均分那版對命運是負面的，階梯把它修回來並超越啟發式。
     *
     * 但要說清楚：這只是「決策品質」變好，勝率量不出差別
     *（3400 局，50.15%，95% CI [48.5%, 51.8%]）—— 這個決策對勝負不敏感。
     * 代價很小：單次決策中位數 3.7ms → 7.5ms、最長 22.6ms，每局合計多約 4ms。
     */
    fateLadder: LadderStep[] | null;
};

/*
 * 命運之石的階梯：→(1) 16 →(2) 8 →(4) 4 →(8) 2 →(16) 1
 *
 * runLadder 會跳過「keep ≥ 存活數」的階段，所以成本隨候選數自動縮放。
 * 依實測骰數分布：
 *   15 候選（4 骰，60%）成本 504、冠軍樣本 120
 *    7 候選（3 骰，34%）成本 368、冠軍樣本 112
 *    3 候選（2 骰， 5%）成本 224、冠軍樣本  96
 *   31 候選（5 骰， 1%）成本 636、冠軍樣本 124
 *
 * 形狀沿用出牌階梯的邏輯：第一刀砍狠一點（候選多時每個樣本的資訊量本來就低），
 * 進決賽圈後放慢並加大樣本。
 *
 * 每階樣本數是原始版本的 4 倍。原始版本（1,2,4,8,16）已經把命運從
 * 「比啟發式還差」修到「勝過啟發式」，這一版是再往上推 —— 但要有心理準備：
 * 出牌決策那邊加 4 倍深度只換到 +0.8pp，這個遊戲的搜尋深度很早就飽和。
 */
export const FATE_TARGET_LADDER: LadderStep[] = [
    {samples: 4, keep: 16},
    {samples: 8, keep: 8},
    {samples: 16, keep: 4},
    {samples: 32, keep: 2},
    {samples: 64, keep: 1},
];

/*
 * 4 倍之前的階梯，留著當對照組（--fate-ladder lean）。
 * 兩者的強度差異要能直接對打量出來，不然「成本更高」只是感覺。
 */
export const FATE_TARGET_LADDER_LEAN: LadderStep[] = [
    {samples: 1, keep: 16},
    {samples: 2, keep: 8},
    {samples: 4, keep: 4},
    {samples: 8, keep: 2},
    {samples: 16, keep: 1},
];

/*
 * 預設階梯：512 →(1) 128 →(1) 32 →(1) 16 →(2) 8 →(4) 4 →(8) 2 →(16) 1
 * 成本 800 次模擬，冠軍身上累積 33 個樣本。
 *
 * 前兩階砍 1/4、後面砍一半：候選還多的時候資訊量本來就少，砍狠一點划算；
 * 進入決賽圈後每一刀都可能誤殺真正的最佳解，所以放慢並加大樣本。
 */
export const DEFAULT_BANDIT_CONFIG: BanditConfig = {
    playPool: 512,
    playLadder: [
        {samples: 1, keep: 128},
        {samples: 1, keep: 32},
        {samples: 1, keep: 16},
        {samples: 2, keep: 8},
        {samples: 4, keep: 4},
        {samples: 8, keep: 2},
        {samples: 16, keep: 1},
    ],
    effectBudget: 100,
    targetBudget: 60,
    simulateTargets: true,
    fateLadder: FATE_TARGET_LADDER,
};

/*
 * 全程砍一半：512>256>128>64>32>16>8>4>2>1，模擬 1,1,1,1,2,4,8,16,32。
 * 成本 1280、冠軍樣本 66（預設值是 800、33）。
 *
 * 量過了：對預設值 1300 局合併後 50.7% / 49.3%（1.0 sigma），沒有差別。
 * 多花 60% 運算買不到東西，所以沒有採用。
 *
 * 第一次測出 +8pp（3.57 sigma）但重測不成立 —— 那次是假訊號。
 * 破綻是傳遞性：merged > halving > gentle > merged 形成循環，
 * 三個兩兩比較加起來矛盾約 16pp。單看一次結果的 sigma 值會被這種東西騙過去，
 * 尤其在同一輪調參跑了十幾次 A/B 的情況下（多重比較）。
 */
export const GENTLE_BANDIT_CONFIG: BanditConfig = {
    playPool: 512,
    playLadder: [
        {samples: 1, keep: 256},
        {samples: 1, keep: 128},
        {samples: 1, keep: 64},
        {samples: 1, keep: 32},
        {samples: 2, keep: 16},
        {samples: 4, keep: 8},
        {samples: 8, keep: 4},
        {samples: 16, keep: 2},
        {samples: 32, keep: 1},
    ],
    effectBudget: 100,
    targetBudget: 60,
    simulateTargets: true,
    fateLadder: FATE_TARGET_LADDER,
};

/*
 * 全程砍一半，但決賽圈每階只花 32 次（不是 64）。成本 1120、冠軍樣本 35。
 *
 * 和 GENTLE 一樣，量過對預設值沒有可測差異。留著這兩個 preset 是為了記錄
 * 「階梯形狀已經調到不重要了」這個結論，並讓之後想重驗的人可以直接 --ladder 跑。
 *
 * 要注意這類比較的解析度：500 局的 1 sigma 是 ±2.24%，而這些變體之間的真實差距
 * 看起來在 2~3pp 以內 —— 想分辨得出來，每次比較大概需要 3000 局以上。
 */
export const HALVING_BANDIT_CONFIG: BanditConfig = {
    playPool: 512,
    playLadder: [
        {samples: 1, keep: 256},
        {samples: 1, keep: 128},
        {samples: 1, keep: 64},
        {samples: 1, keep: 32},
        {samples: 1, keep: 16},
        {samples: 2, keep: 8},
        {samples: 4, keep: 4},
        {samples: 8, keep: 2},
        {samples: 16, keep: 1},
    ],
    effectBudget: 100,
    targetBudget: 60,
    simulateTargets: true,
    fateLadder: FATE_TARGET_LADDER,
};

/*
 * 舊的做法：預篩與 Successive Halving 是兩套獨立機制，預篩累積的樣本進 SH 時被丟掉。
 * 寫成階梯只是為了能和新版直接對打比較，不是拿來用的。
 */
export const LEGACY_BANDIT_CONFIG: BanditConfig = {
    playPool: 384,
    playLadder: [
        {samples: 1, keep: 192},
        {samples: 1, keep: 96},
        {samples: 1, keep: 48},
        {samples: 1, keep: 32},
        {samples: 1, keep: 16},
        {samples: 3, keep: 8},
        {samples: 7, keep: 4},
        {samples: 15, keep: 2},
        {samples: 30, keep: 1},
    ],
    effectBudget: 100,
    targetBudget: 60,
    simulateTargets: true,
    fateLadder: FATE_TARGET_LADDER,
};

/*
 * 依階梯逐輪淘汰，選出最後存活的那個候選。
 *
 * 這一套取代了原本「預篩 + Successive Halving」兩段式的做法。分成兩段時，
 * 預篩累積的樣本在進入 SH 時會被丟掉重來 —— 合併之後樣本一路累積，
 * 撐得越久的候選判斷越可靠，而且只剩一套機制要維護。
 *
 * 每一階裡「第 j 次模擬」對所有存活候選都用同一個 seed（Common Random Numbers）：
 * 候選之間的差異才會是決策本身的差異，而不是誰運氣好抽到好骰子。
 */
function runLadder<T>(
    arms: T[],
    rollout: (arm: T, seed: number) => TurnOutcome,
    ladder: LadderStep[],
    seedBase: number,
): T {
    let alive = arms.map(arm => ({arm, stats: newStats()}));
    let seedCursor = seedBase;

    for (const step of ladder) {
        if (alive.length <= 1) break;
        // 這一階不會淘汰任何人（候選本來就比 keep 少），跳過，不要白花模擬
        if (step.keep >= alive.length) continue;

        for (let j = 0; j < step.samples; j++) {
            const seed = seedCursor + j;
            for (const entry of alive) record(entry.stats, rollout(entry.arm, seed));
        }
        seedCursor += step.samples;

        alive.sort((x, y) => compareArms(y.stats, x.stats));
        alive = alive.slice(0, step.keep);
    }
    return alive[0].arm;
}

/*
 * 用模擬挑目標。
 *
 * 兩種花錢方式：
 *  - 沒給階梯（冰霜／幸運／幻象）：候選很少（最多 6 個），不做淘汰，
 *    直接把 budget 平均分給每個候選。
 *  - 給了階梯（命運之石）：候選有幾十個，平均分下去每個都只剩兩三次模擬，
 *    改用和出牌同一套逐輪淘汰，把錢集中在活到最後的候選身上。
 *
 * 兩種都用 Common Random Numbers：同一輪對所有候選餵同一個 seed，
 * 比的才是「選這個目標」的差異而不是誰運氣好。
 *
 * apply 由呼叫端提供：它要在複製出來的盤面上做出「選了這個目標」之後的完整結果，
 * 必須和真實套用的那段程式一致（例如命運與幻象改完要重跑判定）。
 * 把它交給呼叫端而不是寫在這裡，是為了讓兩段程式緊鄰、改的時候不容易漏。
 */
export function banditChooseTarget<T>(
    game: SimulationGame,
    candidates: T[],
    apply: (clone: SimulationGame, candidate: T) => void,
    budget: number,
    ladder?: LadderStep[] | null,
): T {
    if (candidates.length <= 1) return candidates[0];

    const myIdx = game.currentPlayerIndex;
    const seedBase = Math.floor(rng() * 1e9);
    const rollout = (candidate: T, seed: number) => withRng(makeRng(seed), () => {
        const clone = game.cloneForRollout();
        apply(clone, candidate);
        clone.finishTurnForRollout();
        return evaluateTurnOutcome(clone, myIdx);
    });

    if (ladder && ladder.length > 0) return runLadder(candidates, rollout, ladder, seedBase);

    const samplesPerArm = Math.max(2, Math.floor(budget / candidates.length));
    const entries = candidates.map(candidate => ({candidate, stats: newStats()}));
    for (let j = 0; j < samplesPerArm; j++) {
        for (const entry of entries) record(entry.stats, rollout(entry.candidate, seedBase + j));
    }

    entries.sort((x, y) => compareArms(y.stats, x.stats));
    return entries[0].candidate;
}

/*
 * 命運之石可以重擲「任意數量」的骰子，所以候選是骰子索引的所有非空子集合。
 *
 * 實測骰數是 2~5（→ 3~31 種），所以上限平常不會生效。
 * 留 63 是給魔運之石的餘裕：它每區可各加 1 顆骰，而且和命運同樣能在階段 2 發動，
 * 所以骰數理論上能超過 5（湊滿三區要 6 魔力，實測 330 次未曾出現）。
 * 真的超過上限才隨機抽樣 —— 和出牌候選一樣，抽樣會丟掉選項但不引入偏好。
 */
export function enumerateDiceSubsets(diceCount: number, maxCandidates = 63): number[][] {
    const all: number[][] = [];
    for (let mask = 1; mask < (1 << diceCount); mask++) {
        const subset: number[] = [];
        for (let i = 0; i < diceCount; i++) if (mask & (1 << i)) subset.push(i);
        all.push(subset);
    }
    return all.length <= maxCandidates ? all : shuffled(all, rng).slice(0, maxCandidates);
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
    if (plans.length === 0) return null;
    if (plans.length > cfg.playPool) plans = shuffled(plans, rng).slice(0, cfg.playPool);

    const seedBase = Math.floor(rng() * 1e9);
    return runLadder(
        plans,
        (plan, seed) => withRng(makeRng(seed), () => {
            const clone = game.cloneForRollout();
            applyPlan(clone, plan);
            clone.currentPhaseIndex = 1;
            clone.finishTurnForRollout();
            return evaluateTurnOutcome(clone, myIdx);
        }),
        cfg.playLadder,
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
export type ActivationChoice = {effectId: string; areaIdx: number} | 'STOP';

export function banditChooseActivation(
    game: SimulationGame,
    phase: number,
    cfg: BanditConfig = DEFAULT_BANDIT_CONFIG,
): ActivationChoice {
    const myIdx = game.currentPlayerIndex;
    const options = game.availableActivationsPublic();
    if (options.length === 0) return 'STOP';

    type Arm = 'STOP' | {index: number; effectId: string; areaIdx: number};
    const arms: Arm[] = [
        'STOP',
        ...options.map((o, index) => ({index, effectId: o.effectId, areaIdx: o.areaIdx})),
    ];
    const samplesPerArm = Math.max(2, Math.floor(cfg.effectBudget / arms.length));
    const seedBase = Math.floor(Math.random() * 1e9);

    const entries = arms.map(arm => ({arm, stats: newStats()}));
    for (let j = 0; j < samplesPerArm; j++) {
        const seed = seedBase + j;
        for (const entry of entries) {
            const outcome = withRng(makeRng(seed), () => {
                const clone = game.cloneForRollout();
                if (entry.arm !== 'STOP') {
                    // clone 的盤面與本體相同，選項順序也相同
                    clone.availableActivationsPublic()[entry.arm.index]?.run();
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
    const best = entries[0].arm;
    if (best === 'STOP') return 'STOP';
    // 只回傳效果身分。呼叫端（UI）的候選清單是自己算的，用索引對映不保險。
    return {effectId: best.effectId, areaIdx: best.areaIdx};
}
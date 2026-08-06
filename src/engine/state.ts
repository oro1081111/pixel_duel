import type {CardAttr} from '../cards';

/*
 * 遊戲規則的共用型別與純計算。
 *
 * 背景：規則目前有兩份實作 —— UI 的 src/main.ts 與模擬器的 src/sim/runSimulation.ts。
 * 兩份手抄的規則會靜默走鐘，而且一旦 AI 改用模擬決策，它就必須模擬「它實際在玩的
 * 那個遊戲」，落差會讓搜尋精準地優化錯誤的規則。這個模組是把規則收斂成單一來源的
 * 第一步：先共用型別與不依賴任何全域狀態的純計算，之後再逐步搬入其餘規則。
 */

export type {CardAttr};

export type GameCard = {
  id: string;
  left: CardAttr;
  right: CardAttr;
  effectId: string;
  effectName: string;
  effectDesc: string;
  name: string;
};

export type PlayerState = {
    name: string;
    hp: number;
    hand: GameCard[];
    board: GameCard[][];
    activeAreaEffects: Array<GameCard | null>;
    attackQueue: number[][];
    piercingQueue: number[][];
    magic: number;
    gold: number;
    defense: number;
    currentAttacks: number[][];
    piercingAttacks: number[][];
    cardsPlayedThisTurn: number;
    chargeUsedIndices: number[];
    amplifyUsedIndices: number[];
    fateUsedIndices: number[];
    evasionUsedIndices: number[];
    reproductionUsedIndices: number[];
    flareUsedIndices: number[];
    thrustUsedIndices: number[];
    barrierUsedIndices: number[];
    forestUsedIndices: number[];
    frostUsedIndices: number[];
    magicLuckUsedIndices: number[];
    illusionUsedIndices: number[];
    illusionCopiedEffectIds: Array<string | null>;
    magicSpentInJudging: number;
    extraFrostAttacks: number[][];
    contractTriggeredAreaIdx: number;
    turnBaseStats: {
        sums: number[];
        defense: number[];
        magic: number[];
        gold: number[];
    };
    breakthroughApplied: boolean;
};

export function createPlayer(name: string, hp = 12): PlayerState {
    return {
        name,
        hp,
        hand: [],
        board: [[], [], []],
        activeAreaEffects: [null, null, null],
        attackQueue: [[], [], []],
        piercingQueue: [[], [], []],
        magic: 0,
        gold: 0,
        defense: 0,
        currentAttacks: [[0], [0], [0]],
        piercingAttacks: [[], [], []],
        cardsPlayedThisTurn: 0,
        chargeUsedIndices: [],
        amplifyUsedIndices: [],
        fateUsedIndices: [],
        evasionUsedIndices: [],
        reproductionUsedIndices: [],
        flareUsedIndices: [],
        thrustUsedIndices: [],
        barrierUsedIndices: [],
        forestUsedIndices: [],
        frostUsedIndices: [],
        magicLuckUsedIndices: [],
        illusionUsedIndices: [],
        illusionCopiedEffectIds: [null, null, null],
        magicSpentInJudging: 0,
        extraFrostAttacks: [[], [], []],
        contractTriggeredAreaIdx: -1,
        turnBaseStats: {
            sums: [0, 0, 0],
            defense: [0, 0, 0],
            magic: [0, 0, 0],
            gold: [0, 0, 0]
        },
        breakthroughApplied: false
    };
}

/*
 * 一整場對局的規則狀態。
 *
 * 這裡只放「規則需要知道的東西」；純畫面狀態（抽屜開合、捲動位置、彈窗）留在 UI 端。
 * 分界的判準很簡單：模擬器複製一份狀態往下跑時會用到的，就屬於這裡。
 *
 * 選取模式（chargeSelectionMode 等）看似是 UI，實際上是規則的一部分：它表示
 * 「某張卡的效果已啟動，正在等待選擇目標」，是回合流程中的一個真實中間狀態，
 * 模擬器要重播玩家決策時同樣得經過它。
 */
export type GameState = {
    deck: GameCard[];
    market: Array<GameCard | null>;   // [price3, price2, price1]
    buyDeckDrawCount: number;         // 購買階段：已從牌庫抽了幾張
    players: [PlayerState, PlayerState];

    currentPlayerIndex: number;
    currentPhaseIndex: number;
    diceResults: number[];
    selectedHandCardIndex: number;
    firstPlayerFirstTurn: boolean;
    winner: string | null;
    gameLog: string[];
    phaseHint: string;
    // 回合開始時手牌為 0：視為跳過出牌階段，擲骰階段固定投 5 顆
    skippedPlayBecauseNoHand: boolean;
    // 一次性準備階段：後手先打出 1 張到自己場地，才進入正式流程
    inPreparationPhase: boolean;

    chargeSelectionMode: boolean;
    chargeSourceAreaIdx: number;
    fateSelectionMode: boolean;
    fateSourceAreaIdx: number;
    fateSelectedDiceIndices: number[];
    evasionSelectionMode: boolean;
    evasionSourceAreaIdx: number;
    reproductionSelectionMode: boolean;
    reproductionSourceAreaIdx: number;
    flareSelectionMode: boolean;
    flareSourceAreaIdx: number;
    luckySelectionMode: boolean;
    luckySourceAreaIdx: number;
    illusionSelectionMode: boolean;
    illusionSourceAreaIdx: number;
    frostSelectionMode: boolean;
    frostSourceAreaIdx: number;
};

export function createGameState(
    playerNames: [string, string] = ['紅色玩家', '藍色玩家'],
): GameState {
    return {
        deck: [],
        market: [null, null, null],
        buyDeckDrawCount: 0,
        players: [createPlayer(playerNames[0]), createPlayer(playerNames[1])],

        currentPlayerIndex: 0,
        currentPhaseIndex: 0,
        diceResults: [],
        selectedHandCardIndex: -1,
        firstPlayerFirstTurn: true,
        winner: null,
        gameLog: ['遊戲開始！'],
        phaseHint: '選牌出牌',
        skippedPlayBecauseNoHand: false,
        inPreparationPhase: true,

        chargeSelectionMode: false,
        chargeSourceAreaIdx: -1,
        fateSelectionMode: false,
        fateSourceAreaIdx: -1,
        fateSelectedDiceIndices: [],
        evasionSelectionMode: false,
        evasionSourceAreaIdx: -1,
        reproductionSelectionMode: false,
        reproductionSourceAreaIdx: -1,
        flareSelectionMode: false,
        flareSourceAreaIdx: -1,
        luckySelectionMode: false,
        luckySourceAreaIdx: -1,
        illusionSelectionMode: false,
        illusionSourceAreaIdx: -1,
        frostSelectionMode: false,
        frostSourceAreaIdx: -1,
    };
}

/*
 * 傷害計算：防禦是「逐次攻擊」扣減，不是扣總量。
 * 這一點決定了整個戰術評估的形狀 —— 同樣 6 點攻擊力，面對 2 點防禦時
 * 2+2+2 造成 0 傷害，而單一個 6 造成 4 傷害。集中打擊遠優於分散。
 */
export function damageThroughDefense(attacks: number[], defense: number) {
    return attacks.reduce((sum, atk) => sum + Math.max(0, atk - defense), 0);
}

// 穿透傷害無視防禦，全額計入。
export function piercingDamage(piercing: number[]) {
    return piercing.reduce((sum, atk) => sum + Math.max(0, atk), 0);
}

// 一方朝對手送出的期望傷害。defense 是「結算當下對手的防禦」——
// 我方出手時對手尚未累積防禦，所以呼叫端要傳估計值。
export function expectedDamageTo(
    attacks: number[][],
    piercing: number[][],
    defense: number,
) {
    return damageThroughDefense(attacks.flat(), defense) + piercingDamage(piercing.flat());
}

/*
 * 多一點防禦能少受多少傷害。
 * 等於「攻擊值仍高於目前防禦的來襲次數」—— 對手小攻擊多時防禦特別值錢。
 * 這是精確可算的量，不需要為防禦拍一個權重。
 */
export function marginalDefenseValue(incomingAttacks: number[], currentDefense: number) {
    return incomingAttacks.filter(atk => atk > currentDefense).length;
}

import {refillMarket} from './deck';
import type {GameCard, PlayerState} from './state';

/*
 * 回合流程的共用規則層。
 *
 * UI 與 SimulationGame 可以有不同的「誰在操作」與顯示方式，但以下規則只能有一份：
 * - 哪些情況不能離開目前階段
 * - 階段如何前進
 * - 攻擊何時進入下回合的攻擊佇列
 * - 回合結束時如何補市場、換玩家與重置下一位玩家的回合狀態
 */

export type TurnFlowState = {
    deck: GameCard[];
    market: Array<GameCard | null>;
    buyDeckDrawCount: number;
    players: [PlayerState, PlayerState];
    currentPlayerIndex: number;
    currentPhaseIndex: number;
    diceResults: number[];
    firstPlayerFirstTurn: boolean;
    skippedPlayBecauseNoHand: boolean;
};

export type TurnAdvanceBlockReason =
    | 'must-play-card'
    | 'must-roll-dice'
    | 'must-take-free-deck-card';

export type TurnTransitionEffect =
    | 'roll-start'
    | 'judging'
    | 'defense-start'
    | 'damage'
    | 'attack-start'
    | 'buy-start'
    | 'turn-start';

export type TurnTransitionResult =
    | {
        advanced: false;
        fromPhase: number;
        blockReason: TurnAdvanceBlockReason;
    }
    | {
        advanced: true;
        fromPhase: number;
        toPhase: number;
        effect: TurnTransitionEffect;
    };

function currentPlayer(state: TurnFlowState) {
    return state.players[state.currentPlayerIndex];
}

export function getTurnAdvanceBlockReason(state: TurnFlowState): TurnAdvanceBlockReason | null {
    const p = currentPlayer(state);

    if (state.currentPhaseIndex === 0 && p.hand.length > 0 && p.cardsPlayedThisTurn === 0) {
        return 'must-play-card';
    }
    if (state.currentPhaseIndex === 1 && state.diceResults.length === 0) {
        return 'must-roll-dice';
    }
    if (state.currentPhaseIndex === 6 && state.deck.length > 0 && state.buyDeckDrawCount < 1) {
        return 'must-take-free-deck-card';
    }
    return null;
}

export function resetPlayerTurnState(p: PlayerState) {
    p.cardsPlayedThisTurn = 0;
    p.chargeUsedIndices = [];
    p.amplifyUsedIndices = [];
    p.fateUsedIndices = [];
    p.evasionUsedIndices = [];
    p.reproductionUsedIndices = [];
    p.flareUsedIndices = [];
    p.magicLuckUsedIndices = [];
    p.illusionUsedIndices = [];
    p.illusionCopiedEffectIds = [null, null, null];
    p.thrustUsedIndices = [];
    p.barrierUsedIndices = [];
    p.forestUsedIndices = [];
    p.frostUsedIndices = [];
    p.magicSpentInJudging = 0;
    p.extraFrostAttacks = [[], [], []];
    p.contractTriggeredAreaIdx = -1;
    p.turnBaseStats = {
        sums: [0, 0, 0],
        defense: [0, 0, 0],
        magic: [0, 0, 0],
        gold: [0, 0, 0],
    };
    p.breakthroughApplied = false;
    p.currentAttacks = [[0], [0], [0]];
    p.piercingAttacks = [[], [], []];
    p.magic = 0;
    p.gold = 0;
    p.defense = 0;
}

export function beginTurnState(state: TurnFlowState) {
    state.currentPhaseIndex = 0;
    state.buyDeckDrawCount = 0;
    state.diceResults = [];
    state.skippedPlayBecauseNoHand = false;
    resetPlayerTurnState(currentPlayer(state));
}

export function queueCurrentAttacks(p: PlayerState) {
    p.attackQueue = p.currentAttacks.map(h => [...h]);
    p.piercingQueue = p.piercingAttacks.map(h => [...h]);
}

export function completeTurnState(state: TurnFlowState) {
    state.market = refillMarket(state.market, state.deck);

    const outgoing = currentPlayer(state);
    outgoing.magic = 0;
    outgoing.gold = 0;
    outgoing.defense = 0;

    state.currentPlayerIndex = 1 - state.currentPlayerIndex;
    if (state.currentPlayerIndex === 0) state.firstPlayerFirstTurn = false;

    beginTurnState(state);
}

export function advanceTurnPhase(state: TurnFlowState): TurnTransitionResult {
    const fromPhase = state.currentPhaseIndex;
    const blockReason = getTurnAdvanceBlockReason(state);
    if (blockReason) return {advanced: false, fromPhase, blockReason};

    const p = currentPlayer(state);

    if (fromPhase === 0) {
        state.skippedPlayBecauseNoHand = p.hand.length === 0 && p.cardsPlayedThisTurn === 0;
        state.currentPhaseIndex = 1;
        return {advanced: true, fromPhase, toPhase: 1, effect: 'roll-start'};
    }
    if (fromPhase === 1) {
        state.currentPhaseIndex = 2;
        return {advanced: true, fromPhase, toPhase: 2, effect: 'judging'};
    }
    if (fromPhase === 2) {
        state.currentPhaseIndex = 3;
        return {advanced: true, fromPhase, toPhase: 3, effect: 'defense-start'};
    }
    if (fromPhase === 3) {
        state.currentPhaseIndex = 4;
        return {advanced: true, fromPhase, toPhase: 4, effect: 'damage'};
    }
    if (fromPhase === 4) {
        state.currentPhaseIndex = 5;
        return {advanced: true, fromPhase, toPhase: 5, effect: 'attack-start'};
    }
    if (fromPhase === 5) {
        queueCurrentAttacks(p);
        state.currentPhaseIndex = 6;
        return {advanced: true, fromPhase, toPhase: 6, effect: 'buy-start'};
    }
    if (fromPhase === 6) {
        completeTurnState(state);
        return {advanced: true, fromPhase, toPhase: 0, effect: 'turn-start'};
    }

    throw new Error(`Unknown phase index: ${fromPhase}`);
}

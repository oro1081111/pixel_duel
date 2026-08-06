import {CARD_DEFS} from '../cards';
import type {GameCard, PlayerState} from './state';

/*
 * 牌庫、市場、骰子與「有效效果 id」。
 *
 * 這些規則原本 UI（src/main.ts）與模擬器（src/sim/runSimulation.ts）各抄一份。
 * 目前兩份剛好一致，但那是巧合不是保證 —— 例如抽牌價格 0/1/2 改了一邊，
 * 另一邊會安靜地繼續用舊價，而模擬器正是 AI 用來判斷「這樣打值不值得」的依據。
 *
 * 參數刻意取最小集合（傳 deck / market / players 而不是整個 GameState），
 * 這樣模擬器那邊還是 class 欄位的時候也能直接呼叫，不必先搬完狀態。
 */

// 一副牌就是卡表各一張。id 只在對局內用來區分同名卡的不同實例。
export function buildDeck(): GameCard[] {
    return CARD_DEFS.map((def, i) => ({
        id: `card_${i}`,
        left: def.left,
        right: def.right,
        effectId: def.effectId,
        effectName: def.name,
        effectDesc: def.desc,
        // 需求：卡面只顯示效果名稱
        name: def.name,
    }));
}

export function shuffled<T>(arr: T[], rand: () => number = Math.random): T[] {
    // Fisher–Yates。原本用 sort(() => Math.random() - 0.5)，那不是均勻洗牌：
    // 比較函式不一致會讓某些排列明顯比其他排列常出現。
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export function drawFromDeck(deck: GameCard[]): GameCard | null {
    return deck.pop() ?? null;
}

/*
 * 市場補牌：先把剩下的牌往下掉（price1 那格永遠先被填滿），再由下往上補新牌。
 * 索引固定是 [price3, price2, price1]，所以「往下」= 往索引 2 移動。
 */
export function refillMarket(
    market: Array<GameCard | null>,
    deck: GameCard[],
): Array<GameCard | null> {
    const remaining = market.filter((c): c is GameCard => Boolean(c));
    const next: Array<GameCard | null> = [null, null, null];
    for (let i = remaining.length - 1; i >= 0; i--) {
        const targetIdx = 2 - ((remaining.length - 1) - i);
        if (targetIdx >= 0) next[targetIdx] = remaining[i];
    }
    for (let i = 2; i >= 0; i--) {
        if (!next[i]) next[i] = drawFromDeck(deck);
    }
    return next;
}

// 購買階段從牌庫抽牌：第 1/2/3 張分別是 0/1/2 金；一回合最多 3 張。
export function getDeckDrawCost(drawIndex: number) {
    if (drawIndex <= 1) return 0;
    if (drawIndex === 2) return 1;
    if (drawIndex === 3) return 2;
    return Infinity;
}

export function getMarketPrice(slotIdx: 0 | 1 | 2) {
    return slotIdx === 0 ? 3 : slotIdx === 1 ? 2 : 1;
}

export function rollDice(count: number, rand: () => number = Math.random): number[] {
    return Array.from({length: count}, () => 1 + Math.floor(rand() * 6));
}

/*
 * 幻象幽影會複製對手的效果，所以「這一區實際在跑哪個效果」不等於卡面的 effectId。
 * 規則判斷一律要走這個函式，直接讀 activeAreaEffects[i].effectId 會漏掉被複製的效果。
 */
export function getEffectiveEffectId(p: PlayerState, areaIdx: number): string | null {
    const card = p.activeAreaEffects[areaIdx];
    if (!card) return null;
    if (card.effectId === 'illusion') return p.illusionCopiedEffectIds[areaIdx] || 'illusion';
    return card.effectId;
}

export function hasActiveEffect(p: PlayerState, effectId: string) {
    return p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === effectId);
}

// 幻境空間是全場效果：任一方場上有，雙方都不得使用消耗魔力的效果。
export function isMirageActive(players: readonly PlayerState[]) {
    return players.some(p => hasActiveEffect(p, 'mirage'));
}

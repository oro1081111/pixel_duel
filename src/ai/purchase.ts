import type {GameCard} from '../engine/state';

/**
 * 專家購牌 V1 的固定卡牌權重。
 *
 * 來源：實驗專家自我對局 5000 場的「勝局出牌率」；
 * 勝局出牌率 = 最後勝利的玩家有有效出這張牌的局數 / 5000。
 *
 * 這裡刻意只保留一個固定權重，不加入血量、幻境、combo 等局面修正。
 */
export const WINNING_PLAY_RATE_WEIGHTS: Readonly<Record<string, number>> = {
    barrier: 0.2028,
    charge: 0.2400,
    amplify: 0.3078,
    magic_bullet: 0.1698,
    ambush: 0.2214,
    fate: 0.2766,
    dodge: 0.2032,
    diversion: 0.2566,
    reproduction: 0.2070,
    gale: 0.2444,
    shadow: 0.2296,
    flare: 0.1268,
    thrust: 0.2826,
    shield: 0.1552,
    backfire: 0.3580,
    flame_shield: 0.1182,
    brilliance: 0.1626,
    forest: 0.1010,
    frost: 0.1236,
    holy_light: 0.1966,
    soul_snatch: 0.2808,
    contract: 0.2020,
    surge: 0.1810,
    breakthrough: 0.3020,
    mirage: 0.3920,
    lucky: 0.2804,
    magic_luck: 0.2272,
    illusion: 0.1406,
};

export type WinningPlayPurchasePlan = {
    deckDraws: number;
    marketSlots: Array<0 | 1 | 2>;
    score: number;
    cards: number;
    cost: number;
};

export function getWinningPlayWeight(card: Pick<GameCard, 'effectId'> | null | undefined) {
    if (!card) return 0;
    return WINNING_PLAY_RATE_WEIGHTS[card.effectId] ?? 0;
}

export function averageWinningPlayWeight(cards: ReadonlyArray<GameCard>) {
    if (cards.length === 0) return 0;
    return cards.reduce((sum, card) => sum + getWinningPlayWeight(card), 0) / cards.length;
}

/**
 * 枚舉目前金幣能完成的所有購買方案，選「勝局出牌率總和」最高者。
 * 同分時優先拿更多牌；仍同分則均勻隨機。
 *
 * deckAverageOverride 給 rollout 使用：rollout 不得因模擬盲抽到哪張牌而改變
 * 後續判斷，所以可以在盲抽前凍結牌庫平均值，整個購買階段都沿用它。
 */
export function chooseWinningPlayPurchasePlan(args: {
    gold: number;
    buyDeckDrawCount: number;
    deck: ReadonlyArray<GameCard>;
    market: ReadonlyArray<GameCard | null>;
    deckDrawCost: (drawIndex: number) => number;
    marketPrice: (slotIdx: 0 | 1 | 2) => number;
    random?: () => number;
    deckAverageOverride?: number;
}): WinningPlayPurchasePlan | null {
    const {
        gold,
        buyDeckDrawCount,
        deck,
        market,
        deckDrawCost,
        marketPrice,
        random = Math.random,
        deckAverageOverride,
    } = args;

    const deckAverage = deckAverageOverride ?? averageWinningPlayWeight(deck);
    const availableSlots = ([0, 1, 2] as const).filter(slot => market[slot] != null);
    const plans: WinningPlayPurchasePlan[] = [];

    // 市場最多 3 張，直接枚舉所有子集合。
    for (let mask = 0; mask < (1 << availableSlots.length); mask++) {
        const marketSlots: Array<0 | 1 | 2> = [];
        let marketCost = 0;
        let marketScore = 0;

        for (let j = 0; j < availableSlots.length; j++) {
  if ((mask & (1 << j)) === 0) continue;
  const slot = availableSlots[j];
  const card = market[slot];
  if (!card) continue;
  marketSlots.push(slot);
  marketCost += marketPrice(slot);
  marketScore += getWinningPlayWeight(card);
        }

        // 再枚舉能追加的盲抽張數；抽牌成本依第幾張依序累加。
        let deckCost = 0;
        for (let deckDraws = 0; deckDraws <= deck.length; deckDraws++) {
  if (deckDraws > 0) {
      const cost = deckDrawCost(buyDeckDrawCount + deckDraws);
      if (!Number.isFinite(cost)) break;
      deckCost += cost;
  }

  const totalCost = marketCost + deckCost;
  const cards = marketSlots.length + deckDraws;
  if (cards === 0 || totalCost > gold) continue;

  plans.push({
      deckDraws,
      marketSlots: [...marketSlots],
      score: marketScore + deckDraws * deckAverage,
      cards,
      cost: totalCost,
  });
        }
    }

    if (plans.length === 0) return null;

    const bestScore = Math.max(...plans.map(plan => plan.score));
    let best = plans.filter(plan => Math.abs(plan.score - bestScore) < 1e-12);

    const mostCards = Math.max(...best.map(plan => plan.cards));
    best = best.filter(plan => plan.cards === mostCards);

    const idx = Math.min(best.length - 1, Math.floor(random() * best.length));
    return best[idx];
}

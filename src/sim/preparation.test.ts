import assert from 'node:assert/strict';

import type {GameCard} from '../engine/state';
import {enumeratePreparationPlans} from './bandit';

function card(id: string): GameCard {
    return {
        id,
        left: {type: 'attack', value: 1},
        right: {type: 'gold', value: 1},
        effectId: 'ambush',
        effectName: id,
        effectDesc: 'test',
        name: id,
    };
}

const hand = ['A', 'B', 'C', 'D'].map(card);
const plans = enumeratePreparationPlans(hand);

// 4 張起始手牌，保留「準備第一步」身分並去除最終盤面等價方案後的精確候選數。
assert.equal(plans.length, 1152);
assert.equal(plans.filter(p => p.future.length === 1).length, 108);
assert.equal(plans.filter(p => p.future.length === 2).length, 432);
assert.equal(plans.filter(p => p.future.length === 3).length, 612);

for (const plan of plans) {
    assert.ok(plan.preparation.areaIdx >= 0 && plan.preparation.areaIdx <= 2);
    assert.ok(plan.future.length >= 1 && plan.future.length <= 3);

    const ids = [plan.preparation.cardId, ...plan.future.map(s => s.cardId)];
    assert.equal(new Set(ids).size, ids.length, '同一張牌不能同時當準備牌與 future，或在 future 重複');
    for (const step of plan.future) assert.ok(step.areaIdx >= 0 && step.areaIdx <= 2);

    const expectedDice = 5 - plan.future.length;
    assert.ok([4, 3, 2].includes(expectedDice));
}

// 每個「現在真正會執行」的準備選項都必須有 future 候選，不可被候選池抽樣漏掉。
const firstSteps = new Set(plans.map(p => `${p.preparation.cardId}@${p.preparation.areaIdx}`));
assert.equal(firstSteps.size, 12);

// 邊界：2 張手牌時只有「準備 1 + future 1」。
const twoCardPlans = enumeratePreparationPlans(hand.slice(0, 2));
assert.equal(twoCardPlans.length, 18);
assert.ok(twoCardPlans.every(p => p.future.length === 1));

console.log('expert preparation plan checks passed');

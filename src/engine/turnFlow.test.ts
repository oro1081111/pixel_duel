import assert from 'node:assert/strict';

import {createGameState, type GameCard} from './state';
import {
    advanceTurnPhase,
    beginTurnState,
    getTurnAdvanceBlockReason,
    queueCurrentAttacks,
    resetPlayerTurnState,
} from './turnFlow';

function card(id: string): GameCard {
    return {
        id,
        left: {type: 'attack', value: 1},
        right: {type: 'gold', value: 1},
        effectId: 'ambush',
        effectName: 'test',
        effectDesc: 'test',
        name: 'test',
    };
}

{
    const s = createGameState();
    s.inPreparationPhase = false;
    s.players[0].hand = [card('a')];
    s.currentPhaseIndex = 0;
    assert.equal(getTurnAdvanceBlockReason(s), 'must-play-card');

    s.players[0].cardsPlayedThisTurn = 1;
    assert.equal(getTurnAdvanceBlockReason(s), null);
    assert.equal(advanceTurnPhase(s).advanced, true);
    assert.equal(s.currentPhaseIndex, 1);
    assert.equal(s.skippedPlayBecauseNoHand, false);

    assert.equal(getTurnAdvanceBlockReason(s), 'must-roll-dice');
    s.diceResults = [4, 2, 1];
    const judging = advanceTurnPhase(s);
    assert.deepEqual(judging, {advanced: true, fromPhase: 1, toPhase: 2, effect: 'judging'});
}

{
    const s = createGameState();
    s.inPreparationPhase = false;
    s.players[0].hand = [];
    s.players[0].cardsPlayedThisTurn = 0;
    const r = advanceTurnPhase(s);
    assert.equal(r.advanced, true);
    assert.equal(s.skippedPlayBecauseNoHand, true);
}

{
    const s = createGameState();
    const p = s.players[0];
    p.currentAttacks = [[3, 1], [0], [6]];
    p.piercingAttacks = [[2], [], [1]];
    queueCurrentAttacks(p);
    assert.deepEqual(p.attackQueue, [[3, 1], [0], [6]]);
    assert.deepEqual(p.piercingQueue, [[2], [], [1]]);
    p.currentAttacks[0][0] = 99;
    assert.equal(p.attackQueue[0][0], 3);
}

{
    const s = createGameState();
    const p = s.players[0];
    p.magic = 5;
    p.gold = 4;
    p.defense = 3;
    p.chargeUsedIndices = [1];
    p.currentAttacks = [[5], [4], [3]];
    resetPlayerTurnState(p);
    assert.equal(p.magic, 0);
    assert.equal(p.gold, 0);
    assert.equal(p.defense, 0);
    assert.deepEqual(p.chargeUsedIndices, []);
    assert.deepEqual(p.currentAttacks, [[0], [0], [0]]);
}

{
    const s = createGameState();
    s.inPreparationPhase = false;
    s.currentPlayerIndex = 1;
    s.currentPhaseIndex = 6;
    s.firstPlayerFirstTurn = true;
    s.deck = [];
    s.market = [null, null, null];
    s.buyDeckDrawCount = 0;
    s.players[1].gold = 2;
    s.players[0].magic = 9;
    s.players[0].currentAttacks = [[4], [0], [0]];

    const r = advanceTurnPhase(s);
    assert.deepEqual(r, {advanced: true, fromPhase: 6, toPhase: 0, effect: 'turn-start'});
    assert.equal(s.currentPlayerIndex, 0);
    assert.equal(s.firstPlayerFirstTurn, false);
    assert.equal(s.currentPhaseIndex, 0);
    assert.equal(s.buyDeckDrawCount, 0);
    assert.equal(s.diceResults.length, 0);
    assert.equal(s.players[1].gold, 0);
    assert.equal(s.players[0].magic, 0);
    assert.deepEqual(s.players[0].currentAttacks, [[0], [0], [0]]);
}

{
    const s = createGameState();
    s.inPreparationPhase = false;
    s.currentPlayerIndex = 0;
    s.players[0].magic = 4;
    s.players[0].gold = 3;
    s.players[0].defense = 2;
    s.players[0].chargeUsedIndices = [0];
    beginTurnState(s);
    assert.equal(s.currentPhaseIndex, 0);
    assert.equal(s.buyDeckDrawCount, 0);
    assert.deepEqual(s.diceResults, []);
    assert.equal(s.players[0].magic, 0);
    assert.deepEqual(s.players[0].chargeUsedIndices, []);
}

console.log('turnFlow regression checks passed');

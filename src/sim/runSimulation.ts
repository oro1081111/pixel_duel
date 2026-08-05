import type {CardAttr} from '../cards';
// 與 UI 共用同一份規則型別與純計算（見 src/engine/state.ts）
import {type GameCard, type PlayerState, createPlayer} from '../engine/state';
import {
  buildDeck,
  drawFromDeck,
  getDeckDrawCost,
  getEffectiveEffectId,
  getMarketPrice,
  hasActiveEffect,
  isMirageActive,
  refillMarket,
  shuffled,
} from '../engine/deck';
import {isMagicSpendActivation, listActivations} from '../engine/activations';
import {getBaseAttrForDie} from '../basebars';





type AttackTarget = {areaIdx: number; hitIdx: number; val: number};
type Winner = 0 | 1 | 'draw';
type OpeningMode = 'prep' | 'even' | 'staged';
type AiDifficulty = 'normal' | 'expert';
type MatchupMode = 'custom' | 'expert-mirror' | 'expert-normal';

const ILLUSION_UNCOPYABLE_EFFECT_IDS = new Set<string>(['lucky', 'fate', 'frost']);

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
      if (next !== 'normal' && next !== 'expert') throw new Error('--ai must be "normal" or "expert"');
      opts.p0Ai = next;
      opts.p1Ai = next;
      i++;
    } else if (arg === '--p0-ai' && next) {
      if (next !== 'normal' && next !== 'expert') throw new Error('--p0-ai must be "normal" or "expert"');
      opts.p0Ai = next;
      i++;
    } else if (arg === '--p1-ai' && next) {
      if (next !== 'normal' && next !== 'expert') throw new Error('--p1-ai must be "normal" or "expert"');
      opts.p1Ai = next;
      i++;
    } else if (arg === '--matchup' && next) {
      if (next !== 'custom' && next !== 'expert-mirror' && next !== 'expert-normal') {
        throw new Error('--matchup must be "custom", "expert-mirror", or "expert-normal"');
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

function randInt(minInclusive: number, maxInclusive: number) {
  return Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

function chooseUniform<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function chooseHighestAttackTarget<T extends {val: number}>(targets: T[]): T {
  const maxVal = Math.max(...targets.map(t => t.val));
  return chooseUniform(targets.filter(t => t.val === maxVal));
}

function chooseAiWeightedAttackTarget<T extends {val: number}>(targets: T[]): T {
  return Math.random() < 0.9 ? chooseHighestAttackTarget(targets) : chooseUniform(targets);
}

const AI_EFFECT_WEIGHTS: Record<string, number> = {
  diversion: 10,
  mirage: 9.5,
  brilliance: 8.8,
  forest: 8.2,
  flare: 8,
  reproduction: 7.8,
  charge: 7.4,
  soul_snatch: 7.2,
  amplify: 7,
  dodge: 6.8,
  magic_bullet: 6.6,
  fate: 6.4,
  shadow: 6.2,
  gale: 6,
  thrust: 5.9,
  barrier: 5.8,
  holy_light: 5.7,
  frost: 5.6,
  lucky: 5.4,
  backfire: 5.3,
  surge: 5.2,
  magic_luck: 5,
  shield: 4.8,
  contract: 4.6,
  breakthrough: 4.4,
  flame_shield: 4.3,
  illusion: 6,
  ambush: 4.2,
};

const AI_ATTR_WEIGHTS: Record<string, number> = {
  attack: 2.15,
  magic: 1.6,
  defense: 1.6,
  gold: 1.15,
};

// Each die lands in one of the three areas with equal probability.
const DIE_AREA_PROBABILITY = 1 / 3;
const SHADOW_PIERCING_DAMAGE = 3;
const BRILLIANCE_ATTACK_BONUS = 7;
const BRILLIANCE_DICE_REQUIRED = 3;
// Shadow damage ignores defense, so it is worth a bit more than plain attack.
const PIERCING_DAMAGE_MULTIPLIER = 1.15;

// P(X >= successes) for X ~ Binomial(trials, probability)
function binomialProbAtLeast(successes: number, trials: number, probability: number) {
  if (successes <= 0) return 1;
  if (successes > trials) return 0;
  let cumulative = 0;
  let term = Math.pow(1 - probability, trials);
  for (let i = 0; i < successes; i++) {
    cumulative += term;
    term = term * ((trials - i) / (i + 1)) * (probability / (1 - probability));
  }
  return Math.max(0, 1 - cumulative);
}

// 哪些效果要花魔力，由 engine/activations.ts 的條件表決定（與 UI 同一份）。
const isMagicSpendEffect = isMagicSpendActivation;

function baseAiAttrValue(attr: CardAttr) {
  return (AI_ATTR_WEIGHTS[attr.type] || 1) * attr.value;
}

function aiEffectWeight(effectId: string | null | undefined) {
  if (!effectId) return 0;
  return AI_EFFECT_WEIGHTS[effectId] ?? 4;
}



class SimulationGame {
  deck: GameCard[] = [];
  market: Array<GameCard | null> = [null, null, null];
  players: [PlayerState, PlayerState];
  currentPlayerIndex: 0 | 1 = 0;
  currentPhaseIndex = 0;
  diceResults: number[] = [];
  firstPlayerFirstTurn = true;
  winner: Winner | null = null;
  buyDeckDrawCount = 0;
  skippedPlayBecauseNoHand = false;
  turnCount = 0;

  constructor(
    private readonly initialHp: number,
    private readonly maxTurns: number,
    private readonly openingMode: OpeningMode,
    private readonly aiDifficulties: [AiDifficulty, AiDifficulty],
  ) {
    this.players = [createPlayer('First', initialHp), createPlayer('Second', initialHp)];
    this.initGame();
  }

  run(): {winner: Winner; turns: number} {
    if (this.openingMode === 'prep') this.preparationPhase();
    if (this.openingMode === 'staged') this.stagedOpeningPhase();
    while (this.winner === null && this.turnCount < this.maxTurns) {
      this.runAiTurn();
    }
    return {winner: this.winner ?? 'draw', turns: this.turnCount};
  }

  private initGame() {
    this.deck = shuffled(buildDeck());

    const p0InitialHandSize = this.openingMode === 'staged' ? 4 : 3;
    const p1InitialHandSize = this.openingMode === 'even' ? 3 : this.openingMode === 'staged' ? 5 : 4;
    this.players[0].hand = this.drawCards(p0InitialHandSize);
    this.players[1].hand = this.drawCards(p1InitialHandSize);

    this.market = [null, null, null];
    this.refillMarket();
  }

  private preparationPhase() {
    this.currentPlayerIndex = 1;
    this.currentPhaseIndex = 0;
    this.playRandomCardsForCurrentPlayer(1);
    this.currentPlayer().cardsPlayedThisTurn = 0;
    this.currentPlayerIndex = 0;
    this.currentPhaseIndex = 0;
  }

  private stagedOpeningPhase() {
    this.currentPhaseIndex = 0;
    this.currentPlayerIndex = 0;
    this.playRandomCardsForCurrentPlayer(1);
    this.currentPlayer().cardsPlayedThisTurn = 0;

    this.currentPlayerIndex = 1;
    this.playRandomCardsForCurrentPlayer(2);
    this.currentPlayer().cardsPlayedThisTurn = 0;

    this.currentPlayerIndex = 0;
    this.currentPhaseIndex = 0;
  }

  private playRandomCardsForCurrentPlayer(count: number) {
    const p = this.currentPlayer();
    for (let i = 0; i < count && p.hand.length > 0; i++) {
      if (this.currentAiDifficulty() === 'expert') {
        const choice = this.chooseExpertPlay();
        if (!choice) break;
        this.playCard(choice.handIdx, choice.areaIdx);
      } else {
        const hIdx = randInt(0, p.hand.length - 1);
        const areaIdx = randInt(0, 2);
        this.playCard(hIdx, areaIdx);
      }
    }
  }

  private runAiTurn() {
    this.turnCount++;
    this.currentPhaseIndex = 0;
    this.buyDeckDrawCount = 0;
    this.diceResults = [];
    this.skippedPlayBecauseNoHand = false;
    this.resetTurnState(this.currentPlayer());

    this.aiPlayPhase();
    if (this.winner !== null) return;

    this.aiRollPhase();
    this.aiActivationLoop(1);
    this.nextPhase();

    this.aiActivationLoop(2);
    this.nextPhase();

    this.aiActivationLoop(3);
    this.nextPhase();

    this.aiActivationLoop(4);
    this.nextPhase();
    if (this.winner !== null) return;

    this.aiActivationLoop(5);
    this.nextPhase();

    this.aiBuyPhase();
    this.endTurn();
  }

  private currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  private opponentIndex(): 0 | 1 {
    return (1 - this.currentPlayerIndex) as 0 | 1;
  }

  private opponent() {
    return this.players[this.opponentIndex()];
  }

  private currentAiDifficulty() {
    return this.aiDifficulties[this.currentPlayerIndex];
  }

  private drawFromDeck() {
    return drawFromDeck(this.deck);
  }

  private drawCards(count: number) {
    const cards: GameCard[] = [];
    for (let i = 0; i < count; i++) {
      const card = this.drawFromDeck();
      if (card) cards.push(card);
    }
    return cards;
  }

  private refillMarket() {
    this.market = refillMarket(this.market, this.deck);
  }

  private deckDrawCost(drawIndex: number) {
    return getDeckDrawCost(drawIndex);
  }

  private marketPrice(slotIdx: 0 | 1 | 2) {
    return getMarketPrice(slotIdx);
  }

  private getEffectiveEffectId(p: PlayerState, areaIdx: number) {
    return getEffectiveEffectId(p, areaIdx);
  }

  private isMirageActive() {
    return isMirageActive(this.players);
  }

  private hasExpertEffect(p: PlayerState, effectId: string) {
    return hasActiveEffect(p, effectId);
  }

  private hasHandEffect(p: PlayerState, effectId: string) {
    return p.hand.some(c => c.effectId === effectId);
  }

  private countHandEffects(p: PlayerState, effectIds: string[]) {
    return p.hand.filter(c => effectIds.includes(c.effectId)).length;
  }

  private countMagicSpendCards(p: PlayerState) {
    const activeCount = p.activeAreaEffects.filter(c => isMagicSpendEffect(c?.effectId)).length;
    const handCount = p.hand.filter(c => isMagicSpendEffect(c.effectId)).length;
    return activeCount + Math.min(3, handCount);
  }

  private countOpponentMagicSpendThreats() {
    return this.opponent().activeAreaEffects.filter(c => isMagicSpendEffect(c?.effectId)).length;
  }

  private getDefensePressureScore(p = this.currentPlayer()) {
    const incomingNormal = this.estimateIncomingNormalDamageAfterDefense(p);
    const incomingPiercing = this.estimateIncomingPiercingDamage();
    const lowHpBonus = p.hp <= 3 ? 3 : p.hp <= 5 ? 2 : p.hp <= 8 ? 1 : 0;
    return incomingNormal + incomingPiercing * 0.75 + lowHpBonus;
  }

  private getMagicNeedScore(p = this.currentPlayer()) {
    if (this.isMirageActive()) return 0;
    const spendCount = this.countMagicSpendCards(p);
    const expensiveActiveCount = p.activeAreaEffects.filter(c => {
      const eff = c?.effectId;
      return eff === 'flare' || eff === 'forest' || eff === 'barrier' || eff === 'soul_snatch' || eff === 'dodge';
    }).length;
    return spendCount + expensiveActiveCount * 1.3;
  }

  private aiAttrValue(attr: CardAttr, p = this.currentPlayer()) {
    let weight = AI_ATTR_WEIGHTS[attr.type] || 1;
    if (attr.type === 'magic') {
      weight += Math.min(1.25, this.getMagicNeedScore(p) * 0.18);
      if (this.isMirageActive()) weight *= 0.35;
    } else if (attr.type === 'defense') {
      weight += Math.min(1.35, this.getDefensePressureScore(p) * 0.18);
      if (p.hp <= 5) weight += 0.35;
    } else if (attr.type === 'gold') {
      if (p.hand.length <= 1) weight += 0.35;
      if (p.board.flat().length >= 6) weight -= 0.15;
    }
    return weight * attr.value;
  }

  private areaAttrPotential(areaIdx: number, type: CardAttr['type'], p = this.currentPlayer()) {
    let total = 0;
    ([areaIdx * 2 + 1, areaIdx * 2 + 2] as const).forEach(dieValue => {
      const base = getBaseAttrForDie(this.currentPlayerIndex, dieValue);
      if (base.type === type) total += base.value;
    });
    p.board[areaIdx].forEach(card => {
      if (card.left.type === type) total += card.left.value;
      if (card.right.type === type) total += card.right.value;
    });
    return total;
  }

  private averageAreaDieValue(areaIdx: number, p = this.currentPlayer()) {
    const values = [areaIdx * 2 + 1, areaIdx * 2 + 2];
    return values.reduce((sum, dieValue) => {
      const isLeft = dieValue % 2 !== 0;
      const base = getBaseAttrForDie(this.currentPlayerIndex, dieValue);
      let score = this.aiAttrValue(base, p);
      p.board[areaIdx].forEach(card => {
        score += this.aiAttrValue(isLeft ? card.left : card.right, p);
      });
      return sum + score;
    }, 0) / values.length;
  }

  private getStrongestIncomingAttack() {
    return Math.max(0, ...this.opponent().attackQueue.flat());
  }

  private getAreaIndexForEffect(p: PlayerState, effectId: string) {
    return p.activeAreaEffects.findIndex((_, i) => this.getEffectiveEffectId(p, i) === effectId);
  }

  private resetTurnState(p: PlayerState) {
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
    p.turnBaseStats = {sums: [0, 0, 0], defense: [0, 0, 0], magic: [0, 0, 0], gold: [0, 0, 0]};
    p.breakthroughApplied = false;
    p.currentAttacks = [[0], [0], [0]];
    p.piercingAttacks = [[], [], []];
    p.magic = 0;
    p.gold = 0;
    p.defense = 0;
  }

  private getAreaDiceCounts() {
    const counts = [0, 0, 0];
    this.diceResults.forEach(v => counts[Math.floor((v - 1) / 2)]++);
    return counts;
  }

  private estimateDieValueForCurrentPlayer(dieValue: number) {
    const p = this.currentPlayer();
    const areaIdx = Math.floor((dieValue - 1) / 2);
    const isLeft = dieValue % 2 !== 0;
    const base = getBaseAttrForDie(this.currentPlayerIndex, dieValue);
    let score = this.aiAttrValue(base, p);
    p.board[areaIdx].forEach(card => {
      score += this.aiAttrValue(isLeft ? card.left : card.right, p);
    });
    const eff = this.getEffectiveEffectId(p, areaIdx);
    if (eff === 'brilliance') score += 1.5;
    if (eff === 'gale') score += 1;
    if (eff === 'surge' && base.type === 'magic') score += 1.5;
    return score;
  }

  private chooseLowestValueDieIndex() {
    const counts = this.getAreaDiceCounts();
    const p = this.currentPlayer();
    const scored = this.diceResults.map((v, idx) => {
      const areaIdx = Math.floor((v - 1) / 2);
      let score = this.estimateDieValueForCurrentPlayer(v);
      if (this.getEffectiveEffectId(p, areaIdx) === 'shadow' && counts[areaIdx] === 1) score -= 5;
      return {idx, score};
    });
    const minScore = Math.min(...scored.map(x => x.score));
    return chooseUniform(scored.filter(x => x.score === minScore)).idx;
  }

  private chooseExpertFateDiceIndices() {
    const p = this.currentPlayer();
    const counts = this.getAreaDiceCounts();
    const scored = this.diceResults.map((v, idx) => ({
      idx,
      areaIdx: Math.floor((v - 1) / 2),
      score: this.estimateDieValueForCurrentPlayer(v),
    }));
    if (scored.length === 0) return [];

    const shadowAreaIdx = this.getAreaIndexForEffect(p, 'shadow');
    if (shadowAreaIdx >= 0 && counts[shadowAreaIdx] > 0 && counts[shadowAreaIdx] <= 2) {
      return scored.filter(x => x.areaIdx === shadowAreaIdx).map(x => x.idx);
    }

    const brillianceAreaIdx = this.getAreaIndexForEffect(p, 'brilliance');
    if (brillianceAreaIdx >= 0 && counts[brillianceAreaIdx] === 2) {
      const outside = scored
        .filter(x => x.areaIdx !== brillianceAreaIdx)
        .sort((a, b) => a.score - b.score);
      if (outside.length > 0) return outside.slice(0, Math.min(2, outside.length)).map(x => x.idx);
    }

    const avg = scored.reduce((sum, x) => sum + x.score, 0) / scored.length;
    const chosen = scored
      .filter(x => x.score < Math.max(2.4, avg * 0.82))
      .map(x => x.idx);
    if (chosen.length > 0) return chosen;
    const minScore = Math.min(...scored.map(x => x.score));
    return [chooseUniform(scored.filter(x => x.score === minScore)).idx];
  }

  private chooseExpertFrostDieIndex() {
    const p = this.currentPlayer();
    const counts = this.getAreaDiceCounts();
    const scored = this.diceResults.map((v, idx) => {
      const areaIdx = Math.floor((v - 1) / 2);
      let score = this.estimateDieValueForCurrentPlayer(v);
      if (this.getEffectiveEffectId(p, areaIdx) === 'shadow' && counts[areaIdx] === 1) score -= 8;
      return {idx, score};
    });
    const minScore = Math.min(...scored.map(x => x.score));
    return chooseUniform(scored.filter(x => x.score === minScore)).idx;
  }

  private chooseExpertIllusionTargetArea() {
    const candidates: Array<{areaIdx: number; score: number}> = [];
    this.opponent().activeAreaEffects.forEach((c, areaIdx) => {
      if (!c || ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId)) return;
      candidates.push({areaIdx, score: aiEffectWeight(c.effectId)});
    });
    if (candidates.length === 0) return -1;
    const maxScore = Math.max(...candidates.map(c => c.score));
    return chooseUniform(candidates.filter(c => c.score === maxScore)).areaIdx;
  }

  private scoreCardForExpert(card: GameCard, areaIdx = -1) {
    const p = this.currentPlayer();
    const defensePressure = this.getDefensePressureScore(p);
    const magicNeed = this.getMagicNeedScore(p);
    const mirageActive = this.isMirageActive();
    const currentEff = areaIdx >= 0 ? this.getEffectiveEffectId(p, areaIdx) : null;
    const coveringOwnMirage = currentEff === 'mirage' && card.effectId !== 'mirage';
    const hasBrilliance = this.hasExpertEffect(p, 'brilliance') || card.effectId === 'brilliance';
    const hasShadow = this.hasExpertEffect(p, 'shadow') || card.effectId === 'shadow';
    const comboEffects = ['charge', 'reproduction', 'flare', 'forest', 'amplify', 'thrust', 'magic_bullet'];
    const attackComboCount = this.countHandEffects(p, comboEffects)
      + p.activeAreaEffects.filter(c => comboEffects.includes(c?.effectId || '')).length;
    const attackAttrValue = card.left.type === 'attack' ? card.left.value : 0;
    const attackAttrRight = card.right.type === 'attack' ? card.right.value : 0;
    let score = aiEffectWeight(card.effectId) + this.aiAttrValue(card.left, p) + this.aiAttrValue(card.right, p);

    if (isMagicSpendEffect(card.effectId)) {
      score += Math.min(3.4, magicNeed * 0.42);
      if (mirageActive && !coveringOwnMirage) score -= 5.5;
      if (coveringOwnMirage) score += 3 + Math.min(3, this.countMagicSpendCards(p) * 0.55);
    }

    if (card.effectId === 'diversion') {
      score += magicNeed >= 2 && !mirageActive ? Math.min(5.2, magicNeed * 0.9) : -2.4;
      if (attackComboCount >= 2) score += 1.1;
    }
    if (card.effectId === 'mirage') {
      score += this.countOpponentMagicSpendThreats() * 1.9;
      score -= this.countMagicSpendCards(p) * 0.85;
      if (magicNeed >= 3) score -= 2.2;
      if (defensePressure >= 4) score += 1.2;
    }
    if (card.effectId === 'brilliance') {
      const diceSupport = (this.hasHandEffect(p, 'fate') ? 1.2 : 0)
        + (this.hasHandEffect(p, 'magic_luck') ? 1.3 : 0)
        + (this.hasHandEffect(p, 'lucky') ? 0.8 : 0)
        + (this.hasExpertEffect(p, 'fate') ? 1.4 : 0)
        + (this.hasExpertEffect(p, 'magic_luck') ? 1.5 : 0)
        + (this.hasExpertEffect(p, 'lucky') ? 0.8 : 0);
      score += diceSupport;
      if (this.hasExpertEffect(p, 'shadow')) score -= 0.7;
    }
    if (card.effectId === 'shadow') {
      score += (this.hasExpertEffect(p, 'frost') || this.hasHandEffect(p, 'frost')) ? 3.2 : 0;
      score += (this.hasExpertEffect(p, 'fate') || this.hasHandEffect(p, 'fate')) ? 1.4 : 0;
      score += (this.hasExpertEffect(p, 'lucky') || this.hasHandEffect(p, 'lucky')) ? 0.8 : 0;
      if (this.hasExpertEffect(p, 'brilliance')) score -= 0.6;
    }
    if (card.effectId === 'frost') score += hasShadow ? 3.4 : hasBrilliance ? 0.8 : 0.5;
    if (card.effectId === 'fate') score += hasBrilliance ? 2.3 : hasShadow ? 1.6 : 0.4;
    if (card.effectId === 'magic_luck') {
      score += hasBrilliance ? 3.1 : 0.4;
      if (this.hasExpertEffect(p, 'shadow') && !hasBrilliance) score -= 1.2;
      if (magicNeed >= 4) score -= 0.8;
    }
    if (card.effectId === 'lucky') score += hasShadow ? 1.1 : hasBrilliance ? 0.9 : 0;

    if (card.effectId === 'holy_light') score += p.hp <= 4 ? 3.4 : p.hp <= 7 ? 1.8 : 0.3;
    if (card.effectId === 'contract') score += p.hp <= 5 ? 3.2 : p.hp <= 8 ? 1.2 : 0;
    if (card.effectId === 'breakthrough') score += p.hp <= 4 ? 3.8 : p.hp <= 6 ? 1.2 : 0;
    if (card.effectId === 'dodge') score += this.getStrongestIncomingAttack() >= 4 ? 3.2 : defensePressure >= 3 ? 1.7 : 0;
    if (card.effectId === 'barrier') score += defensePressure >= 4 ? 2.8 : defensePressure >= 2 ? 1.1 : 0;
    if (card.effectId === 'shield') score += defensePressure >= 3 ? 1.7 : 0.2;
    if (card.effectId === 'backfire') score += defensePressure >= 2 ? 1.5 : 0.4;

    if (card.effectId === 'magic_bullet') score += (this.hasExpertEffect(p, 'thrust') || this.hasHandEffect(p, 'thrust') ? 1.8 : 0)
      + (this.hasExpertEffect(p, 'forest') || this.hasHandEffect(p, 'forest') ? 1.4 : 0)
      + (this.hasExpertEffect(p, 'amplify') || this.hasHandEffect(p, 'amplify') ? 0.9 : 0);
    if (card.effectId === 'thrust') score += (this.hasExpertEffect(p, 'magic_bullet') || this.hasHandEffect(p, 'magic_bullet') ? 2.2 : 0)
      + (attackAttrValue + attackAttrRight >= 1 ? 0.7 : 0);
    if (card.effectId === 'amplify') score += attackComboCount >= 2 ? 1.5 : 0.5;
    if (card.effectId === 'forest') score += attackComboCount >= 2 ? 2.2 : 0.7;
    if (card.effectId === 'charge') score += attackComboCount >= 1 ? 1.1 : 0.2;
    if (card.effectId === 'flare') score += (this.hasExpertEffect(p, 'charge') || this.hasHandEffect(p, 'charge') ? 1.1 : 0)
      + (this.hasExpertEffect(p, 'reproduction') || this.hasHandEffect(p, 'reproduction') ? 1.3 : 0);
    if (card.effectId === 'reproduction') score += (this.hasExpertEffect(p, 'flare') || this.hasHandEffect(p, 'flare') ? 1.6 : 0)
      + (this.hasExpertEffect(p, 'forest') || this.hasHandEffect(p, 'forest') ? 1 : 0);
    if (card.effectId === 'surge') score += magicNeed >= 3 ? 1.5 : 0.3;
    if (card.effectId === 'flame_shield') score += defensePressure >= 3 ? 1.3 : 0.4;
    if (card.effectId === 'gale' || card.effectId === 'ambush') score += this.opponent().hp <= 5 ? 1.1 : 0.4;
    if (card.effectId === 'illusion') {
      const targetArea = this.chooseExpertIllusionTargetArea();
      score += targetArea >= 0 ? aiEffectWeight(this.opponent().activeAreaEffects[targetArea]?.effectId) * 0.5 : -2.5;
    }

    if (areaIdx >= 0) {
      score -= aiEffectWeight(currentEff) * 0.35;
      if (card.effectId === currentEff) score -= 2;
      if (currentEff === 'shadow' && card.effectId !== 'shadow' && !this.hasExpertEffect(p, 'brilliance')) score -= 1.4;
      if (card.effectId === 'brilliance') {
        const areaValue = this.averageAreaDieValue(areaIdx, p);
        score += areaValue >= 4 ? 1.1 : 0.4;
      }
      if (card.effectId === 'shadow') {
        const areaValue = this.averageAreaDieValue(areaIdx, p);
        score += areaValue <= 3.2 ? 1.2 : -0.3;
      }
      if (card.effectId === 'surge') score += this.areaAttrPotential(areaIdx, 'magic', p) * 0.35;
      if (card.effectId === 'flame_shield') score += this.areaAttrPotential(areaIdx, 'defense', p) * 0.35;
    }

    return score;
  }

  private chooseExpertPlay() {
    const p = this.currentPlayer();
    if (p.hand.length === 0) return null;
    let best: {handIdx: number; areaIdx: number; score: number} | null = null;
    p.hand.forEach((card, handIdx) => {
      for (let areaIdx = 0; areaIdx < 3; areaIdx++) {
        const score = this.scoreCardForExpert(card, areaIdx) + Math.random() * 0.15;
        if (!best || score > best.score) best = {handIdx, areaIdx, score};
      }
    });
    return best;
  }

  private chooseExpertPlayCount() {
    const p = this.currentPlayer();
    if (p.hand.length <= 1) return 1;
    const bestHandScore = Math.max(...p.hand.map(c => this.scoreCardForExpert(c)));
    const activeBrilliance = this.hasExpertEffect(p, 'brilliance');
    const activeShadow = this.hasExpertEffect(p, 'shadow');
    if (activeBrilliance && !activeShadow) return 1;
    if (activeShadow && !activeBrilliance && p.hand.length >= 5) return 2;
    if (p.hand.length >= 5 && bestHandScore >= 7.5) return 3;
    if (p.hand.length >= 3 && bestHandScore >= 8.2) return 2;
    if (p.cardsPlayedThisTurn === 0 && p.board.flat().length < 3) return Math.min(2, p.hand.length);
    return 1;
  }

  private averageDieScoreForCurrentPlayer() {
    let total = 0;
    for (let dieValue = 1; dieValue <= 6; dieValue++) {
      total += this.estimateDieValueForCurrentPlayer(dieValue);
    }
    return total / 6;
  }

  private chooseExpertRollCount(rollOptions: number[]) {
    if (rollOptions.length <= 1) return rollOptions[0];

    const p = this.currentPlayer();
    const areaIndices = [0, 1, 2] as const;
    const shadowAreas = areaIndices.filter(i => this.getEffectiveEffectId(p, i) === 'shadow').length;
    const brillianceAreas = areaIndices.filter(i => this.getEffectiveEffectId(p, i) === 'brilliance').length;
    const avgDieScore = this.averageDieScoreForCurrentPlayer();
    const attackWeight = AI_ATTR_WEIGHTS.attack;

    const scored = rollOptions.map(count => {
      // More dice means more attribute income.
      let score = count * avgDieScore;
      // Shadow only triggers on an EMPTY area, so fewer dice make it more likely.
      if (shadowAreas > 0) {
        score += shadowAreas * SHADOW_PIERCING_DAMAGE * attackWeight * PIERCING_DAMAGE_MULTIPLIER
          * Math.pow(1 - DIE_AREA_PROBABILITY, count);
      }
      // Brilliance needs 3+ dice in one area, so more dice make it more likely.
      if (brillianceAreas > 0) {
        score += brillianceAreas * BRILLIANCE_ATTACK_BONUS * attackWeight
          * binomialProbAtLeast(BRILLIANCE_DICE_REQUIRED, count, DIE_AREA_PROBABILITY);
      }
      return {count, score};
    });

    const maxScore = Math.max(...scored.map(s => s.score));
    return chooseUniform(scored.filter(s => s.score === maxScore)).count;
  }

  private estimateIncomingNormalDamageAfterDefense(p = this.currentPlayer()) {
    return this.opponent().attackQueue.flat().reduce((sum, atk) => sum + Math.max(0, atk - p.defense), 0);
  }

  private estimateIncomingPiercingDamage() {
    return this.opponent().piercingQueue.flat().reduce((sum, atk) => sum + atk, 0);
  }

  private getExpertMagicCost(effectId: string) {
    if (effectId === 'magic_bullet' || effectId === 'illusion') return 1;
    if (effectId === 'charge' || effectId === 'reproduction' || effectId === 'shield' || effectId === 'holy_light' || effectId === 'magic_luck') return 2;
    if (effectId === 'flare' || effectId === 'forest' || effectId === 'dodge' || effectId === 'barrier' || effectId === 'soul_snatch') return 3;
    return 0;
  }

  private buildExpertMagicPlan() {
    const p = this.currentPlayer();
    const planned: Record<string, number> = {};
    if (p.magic <= 0 || this.isMirageActive()) return {planned, reserved: 0};

    const candidates: Array<{effectId: string; cost: number; score: number; priority: number}> = [];
    const canPlanPhase = (phase: number) => this.currentPhaseIndex <= phase;
    const add = (effectId: string, score: number, priority = 0, uses = 1, decay = 1.15) => {
      const cost = this.getExpertMagicCost(effectId);
      if (cost <= 0 || score < 2.75) return;
      for (let i = 0; i < uses; i++) {
        candidates.push({effectId, cost, score: Math.max(0, score - i * decay), priority});
      }
    };

    if (canPlanPhase(2)) {
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'magic_luck' && !p.magicLuckUsedIndices.includes(i))) {
        add('magic_luck', this.scoreActivationForExpertRaw('magic_luck'), 5);
      }
      if (p.activeAreaEffects.some((c, i) => c?.effectId === 'illusion' && !p.illusionUsedIndices.includes(i)) && this.chooseExpertIllusionTargetArea() >= 0) {
        add('illusion', this.scoreActivationForExpertRaw('illusion'), 4);
      }
    }

    if (canPlanPhase(3)) {
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'dodge' && !p.evasionUsedIndices.includes(i)) && this.listOpponentDodgeTargets().length > 0) {
        add('dodge', this.scoreActivationForExpertRaw('dodge'), 8);
      }
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'barrier' && !p.barrierUsedIndices.includes(i))) {
        add('barrier', this.scoreActivationForExpertRaw('barrier'), 7);
      }
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'shield')) {
        const incoming = Math.max(0, this.estimateIncomingNormalDamageAfterDefense(p));
        add('shield', this.scoreActivationForExpertRaw('shield'), 6, Math.min(2, Math.ceil(incoming)));
      }
    }

    if (canPlanPhase(5)) {
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'soul_snatch')) {
        const uses = Math.min(3, Math.ceil(Math.max(1, this.opponent().hp) / 2));
        add('soul_snatch', this.scoreActivationForExpertRaw('soul_snatch'), 6, uses);
      }
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'holy_light')) {
        const hpNeed = p.hp <= 7 ? 2 : 1;
        add('holy_light', Math.max(this.scoreActivationForExpertRaw('holy_light'), this.currentPhaseIndex >= 4 ? 3.2 : 1), 2, hpNeed);
      }
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'magic_bullet')) {
        add('magic_bullet', this.scoreActivationForExpertRaw('magic_bullet'), 3, Math.min(4, p.magic), 4.6);
      }
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'forest' && !p.forestUsedIndices.includes(i)) && this.hasAnyAttackTarget(p)) {
        add('forest', this.scoreActivationForExpertRaw('forest'), 5);
      }
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'flare' && !p.flareUsedIndices.includes(i)) && this.hasAnyAttackTarget(p)) {
        add('flare', this.scoreActivationForExpertRaw('flare'), 5);
      }
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'reproduction' && !p.reproductionUsedIndices.includes(i)) && this.hasAnyAttackTarget(p)) {
        add('reproduction', this.scoreActivationForExpertRaw('reproduction'), 4);
      }
      if (p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'charge' && !p.chargeUsedIndices.includes(i)) && this.hasAnyAttackTarget(p)) {
        add('charge', this.scoreActivationForExpertRaw('charge'), 4);
      }
    }

    candidates.sort((a, b) => {
      const ar = a.score / a.cost + a.score * 0.08 + a.priority * 0.12;
      const br = b.score / b.cost + b.score * 0.08 + b.priority * 0.12;
      return br - ar;
    });

    let remaining = p.magic;
    for (const candidate of candidates) {
      if (candidate.cost > remaining) continue;
      planned[candidate.effectId] = (planned[candidate.effectId] || 0) + 1;
      remaining -= candidate.cost;
    }

    return {planned, reserved: p.magic - remaining};
  }

  private scoreActivationForExpert(label: string) {
    const raw = this.scoreActivationForExpertRaw(label);
    const cost = this.getExpertMagicCost(label);
    if (cost <= 0) return raw;

    const plan = this.buildExpertMagicPlan();
    if ((plan.planned[label] || 0) > 0) return raw + 0.35;

    if (this.currentPhaseIndex >= 5 && raw >= 3.2 && this.currentPlayer().magic >= cost) {
      return Math.max(2.85, raw * 0.72);
    }
    return Math.min(raw, 2.35);
  }

  private scoreActivationForExpertRaw(label: string) {
    const p = this.currentPlayer();
    const opp = this.opponent();
    const maxSelfAttack = Math.max(0, ...this.listSelfAttackTargets().map(t => t.val));
    const totalSelfAttack = p.currentAttacks.flat().reduce((a, b) => a + Math.max(0, b), 0);
    const selfAttackCount = this.listSelfAttackTargets().length;
    const thrustTargetCount = p.currentAttacks.flat().filter(v => v > 0 && v <= 2).length;
    const incomingNormal = this.estimateIncomingNormalDamageAfterDefense(p);
    const incomingPiercing = this.estimateIncomingPiercingDamage();
    const hasUnusedThrust = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'thrust' && !p.thrustUsedIndices.includes(i));
    const hasUnusedAmplify = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'amplify' && !p.amplifyUsedIndices.includes(i));
    const hasUnusedForest = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'forest' && !p.forestUsedIndices.includes(i));
    const hasUnusedCharge = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'charge' && !p.chargeUsedIndices.includes(i));
    const hasUnusedReproduction = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'reproduction' && !p.reproductionUsedIndices.includes(i));
    const hasUnusedFlare = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'flare' && !p.flareUsedIndices.includes(i));
    const hasMagicBullet = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'magic_bullet');
    const expensiveAttackFinisherWaiting = maxSelfAttack > 0 && (hasUnusedForest || hasUnusedCharge || hasUnusedReproduction || hasUnusedFlare);
    const reserveMagicForFinisher = expensiveAttackFinisherWaiting ? (hasUnusedFlare || hasUnusedForest ? 3 : 2) : 0;
    const canPreloadMagicBullet = hasMagicBullet && p.magic > reserveMagicForFinisher;

    if (label === 'soul_snatch') {
      if (opp.hp <= 1) return 20;
      return 7 + (opp.hp <= 3 ? 4 : 0) + (p.hp <= 4 ? 2.5 : p.hp <= 7 ? 1 : 0);
    }
    if (label === 'holy_light') return p.hp <= 4 ? 9 : p.hp <= 7 ? 5.2 : p.hp <= 10 && incomingNormal + incomingPiercing > 0 ? 3.2 : 1.2;
    if (label === 'dodge') {
      const strongest = Math.max(0, ...this.listOpponentDodgeTargets().map(t => t.val));
      const prevent = Math.max(0, strongest - p.defense);
      return prevent >= 4 || incomingNormal >= 4 ? 10 + strongest : prevent >= 2 || incomingNormal >= 2 ? 7 + prevent : 1.8;
    }
    if (label === 'barrier') return incomingNormal >= 4 ? 9 + incomingNormal : incomingNormal >= 2 ? 6.5 : 1.2;
    if (label === 'shield') return incomingNormal >= 2 ? 5.5 + incomingNormal : incomingNormal === 1 && p.hp <= 5 ? 3.5 : 1;
    if (label === 'forest') {
      if (canPreloadMagicBullet && p.magic > 3) return 2.6;
      if (hasUnusedThrust && thrustTargetCount > 0) return 2.2;
      if (hasUnusedAmplify && selfAttackCount >= 2) return 2.4;
      return selfAttackCount >= 2 && totalSelfAttack >= 5 ? 9.4 + totalSelfAttack * 0.25 : selfAttackCount >= 2 ? 5.2 : 1.4;
    }
    if (label === 'flare') {
      if (canPreloadMagicBullet && p.magic > 3) return 2.7;
      if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.4;
      if (hasUnusedCharge && p.magic >= 5 && maxSelfAttack <= 5) return 2.5;
      return maxSelfAttack >= 5 ? 10 + maxSelfAttack * 0.35 : maxSelfAttack >= 3 ? 7.8 + maxSelfAttack * 0.2 : 2;
    }
    if (label === 'charge') {
      if (canPreloadMagicBullet && p.magic > 2) return 2.7;
      if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.5;
      return maxSelfAttack >= 4 ? 8.6 + maxSelfAttack * 0.2 : maxSelfAttack >= 1 ? 6.4 : 1.5;
    }
    if (label === 'reproduction') {
      if (canPreloadMagicBullet && p.magic > 2) return 2.7;
      if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.5;
      if (hasUnusedFlare && p.magic >= 5 && maxSelfAttack >= 3) return 2.6;
      return maxSelfAttack >= 5 ? 9.6 + maxSelfAttack * 0.28 : maxSelfAttack >= 2 ? 7.5 + maxSelfAttack * 0.2 : 2.2;
    }
    if (label === 'magic_bullet') {
      const reserveMagic = reserveMagicForFinisher;
      if (p.magic <= reserveMagic && !(hasUnusedThrust && p.magic > 0)) return 1.6;
      return 12
        + (hasUnusedThrust ? 4.6 : 0)
        + (hasUnusedAmplify ? 1.1 : 0)
        + (hasUnusedForest ? 1.1 : 0)
        + (p.magic > reserveMagic + 1 ? 0.7 : 0);
    }
    if (label === 'amplify') {
      if (canPreloadMagicBullet && p.magic > reserveMagicForFinisher) return 2.6;
      if (hasUnusedThrust && thrustTargetCount > 0) return 2.4;
      return selfAttackCount >= 2 ? 9.2 + selfAttackCount : selfAttackCount === 1 ? 6.2 : 1;
    }
    if (label === 'thrust') {
      return thrustTargetCount >= 2 ? 10 + thrustTargetCount : thrustTargetCount === 1 ? 7.2 : 0;
    }
    if (label === 'fate') {
      const rerollCount = this.chooseExpertFateDiceIndices().length;
      const counts = this.getAreaDiceCounts();
      const brillianceAlmost = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'brilliance' && counts[i] === 2);
      const shadowBlocked = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'shadow' && counts[i] > 0 && counts[i] <= 2);
      return brillianceAlmost || shadowBlocked ? 8.2 : rerollCount >= 2 ? 6.5 : 3.4;
    }
    if (label === 'magic_luck') {
      const counts = this.getAreaDiceCounts();
      const brillianceAlmost = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'brilliance' && counts[i] === 2);
      const hasBrilliance = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'brilliance');
      const hasShadow = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'shadow');
      return brillianceAlmost ? 8 : hasBrilliance && !hasShadow ? 5.2 : hasShadow ? 1.5 : 3;
    }
    if (label === 'frost') {
      const hasShadow = p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === 'shadow');
      if (hasShadow) return 8.6;
      const lowest = this.diceResults.length > 0 ? Math.min(...this.diceResults.map(v => this.estimateDieValueForCurrentPlayer(v))) : 99;
      return lowest <= 2.5 ? 4.6 : 2.4;
    }
    if (label === 'illusion') {
      const target = this.chooseExpertIllusionTargetArea();
      return target >= 0 ? 5 + aiEffectWeight(this.opponent().activeAreaEffects[target]?.effectId) : 0;
    }
    return 3;
  }

  private aiPlayPhase() {
    if (this.currentAiDifficulty() === 'expert') {
      return this.expertPlayPhase();
    }

    this.currentPhaseIndex = 0;
    const p = this.currentPlayer();
    if (p.hand.length === 0) {
      this.skippedPlayBecauseNoHand = true;
      this.currentPhaseIndex = 1;
      return;
    }

    const maxPlays = Math.min(3, p.hand.length);
    const playCount = randInt(1, maxPlays);
    for (let i = 0; i < playCount && p.hand.length > 0; i++) {
      const hIdx = randInt(0, p.hand.length - 1);
      const areaIdx = randInt(0, 2);
      this.playCard(hIdx, areaIdx);
    }
    this.currentPhaseIndex = 1;
  }

  private expertPlayPhase() {
    this.currentPhaseIndex = 0;
    const p = this.currentPlayer();
    if (p.hand.length === 0) {
      this.skippedPlayBecauseNoHand = true;
      this.currentPhaseIndex = 1;
      return;
    }

    const maxPlays = Math.min(3, p.hand.length);
    const playCount = Math.min(maxPlays, Math.max(1, this.chooseExpertPlayCount()));
    for (let i = 0; i < playCount && p.hand.length > 0; i++) {
      const choice = this.chooseExpertPlay();
      if (!choice) break;
      this.playCard(choice.handIdx, choice.areaIdx);
    }
    this.currentPhaseIndex = 1;
  }

  private playCard(handIdx: number, areaIdx: number) {
    const p = this.currentPlayer();
    const [card] = p.hand.splice(handIdx, 1);
    if (!card) return;
    p.board[areaIdx].push(card);
    p.activeAreaEffects[areaIdx] = card;
    p.cardsPlayedThisTurn++;
  }

  private aiRollPhase() {
    this.currentPhaseIndex = 1;
    const p = this.currentPlayer();
    const shouldRollFiveBecauseNoHand = p.hand.length === 0 && p.cardsPlayedThisTurn === 0;
    const rollOptions = shouldRollFiveBecauseNoHand
      ? [5]
      : (p.cardsPlayedThisTurn > 0 ? [5 - p.cardsPlayedThisTurn] : [2, 3, 4]);
    const count = this.currentAiDifficulty() === 'expert' ? this.chooseExpertRollCount(rollOptions) : chooseUniform(rollOptions);
    this.rollDice(count);
  }

  private rollDice(count: number) {
    if (this.currentPhaseIndex !== 1) return;
    if (this.diceResults.length > 0) return;

    const p = this.currentPlayer();
    const luckyIdx = p.activeAreaEffects.findIndex(c => c && c.effectId === 'lucky');
    const finalCount = luckyIdx !== -1 ? count + 1 : count;
    this.diceResults = Array.from({length: finalCount}, () => randInt(1, 6));
    if (luckyIdx !== -1 && this.diceResults.length > 0) {
      const idx = this.currentAiDifficulty() === 'expert'
        ? this.chooseLowestValueDieIndex()
        : randInt(0, this.diceResults.length - 1);
      this.diceResults.splice(idx, 1);
    }
  }

  private nextPhase() {
    if (this.winner !== null) return;
    if (this.currentPhaseIndex === 1) {
      this.currentPhaseIndex = 2;
      this.handleJudging();
    } else if (this.currentPhaseIndex === 2) {
      this.currentPhaseIndex = 3;
    } else if (this.currentPhaseIndex === 3) {
      this.currentPhaseIndex = 4;
      this.handleDamagePhase();
    } else if (this.currentPhaseIndex === 4) {
      this.currentPhaseIndex = 5;
    } else if (this.currentPhaseIndex === 5) {
      const p = this.currentPlayer();
      p.attackQueue = p.currentAttacks.map(h => [...h]);
      p.piercingQueue = p.piercingAttacks.map(h => [...h]);
      this.currentPhaseIndex = 6;
    }
  }

  private handleJudging() {
    const p = this.currentPlayer();
    const pIdx = this.currentPlayerIndex;
    p.magic = 0;
    p.gold = 0;
    p.defense = 0;
    p.breakthroughApplied = false;

    const areaSums = [0, 0, 0];
    const areaDefense = [0, 0, 0];
    const areaMagic = [0, 0, 0];
    const areaGold = [0, 0, 0];
    const diceCountsPerArea = [0, 0, 0];

    this.diceResults.forEach(val => {
      const areaIdx = Math.floor((val - 1) / 2);
      diceCountsPerArea[areaIdx]++;
      const isLeft = val % 2 !== 0;
      const base = getBaseAttrForDie(pIdx, val);
      this.addAttr(base, areaSums, areaDefense, areaMagic, areaGold, areaIdx);
      p.board[areaIdx].forEach(card => {
        this.addAttr(isLeft ? card.left : card.right, areaSums, areaDefense, areaMagic, areaGold, areaIdx);
      });
    });

    p.turnBaseStats = {
      sums: [...areaSums],
      defense: [...areaDefense],
      magic: [...areaMagic],
      gold: [...areaGold],
    };

    if (this.hasEffect(p, 'breakthrough') && p.hp <= 3) {
      for (let i = 0; i < 3; i++) {
        areaSums[i] *= 2;
        areaDefense[i] *= 2;
        areaMagic[i] *= 2;
        areaGold[i] *= 2;
      }
      p.breakthroughApplied = true;
    }

    p.gold = areaGold.reduce((a, b) => a + b, 0);

    p.activeAreaEffects.forEach((_, aIdx) => {
      if (this.getEffectiveEffectId(p, aIdx) === 'surge' && areaMagic[aIdx] > 0) {
        areaMagic[aIdx] *= 2;
      }
    });

    p.magic = areaMagic.reduce((a, b) => a + b, 0);

    p.activeAreaEffects.forEach((_, aIdx) => {
      if (this.getEffectiveEffectId(p, aIdx) === 'mirage') {
        areaSums[aIdx] += 2;
        areaDefense[aIdx] += 1;
      }
    });

    if (this.hasEffect(p, 'diversion') && p.magic <= 2) p.magic = 5;
    p.magic = Math.max(0, p.magic - p.magicSpentInJudging);

    p.activeAreaEffects.forEach((_, aIdx) => {
      const effId = this.getEffectiveEffectId(p, aIdx);
      if (effId === 'flame_shield') {
        const def = areaDefense[aIdx];
        if (def > 0) {
          areaSums[aIdx] += def * 2;
          areaDefense[aIdx] = 0;
        }
      }
      if (effId === 'brilliance' && diceCountsPerArea[aIdx] >= 3) {
        areaSums[aIdx] += 7;
      }
    });

    p.defense = areaDefense.reduce((a, b) => a + b, 0);
    p.currentAttacks = areaSums.map((s, idx) => {
      const list = [s];
      if (p.extraFrostAttacks[idx]) list.push(...p.extraFrostAttacks[idx]);
      return list;
    });
    p.piercingAttacks = [[], [], []];

    p.activeAreaEffects.forEach((_, aIdx) => {
      const effId = this.getEffectiveEffectId(p, aIdx);
      if (effId === 'ambush') p.piercingAttacks[aIdx].push(1);
      if (effId === 'gale') {
        const bonus = diceCountsPerArea[aIdx];
        if (bonus > 0) p.piercingAttacks[aIdx].push(bonus);
      }
      if (effId === 'shadow' && diceCountsPerArea[aIdx] === 0) {
        p.piercingAttacks[aIdx].push(3);
      }
    });
  }

  private addAttr(attr: CardAttr, areaSums: number[], areaDefense: number[], areaMagic: number[], areaGold: number[], areaIdx: number) {
    if (attr.type === 'attack') areaSums[areaIdx] += attr.value;
    else if (attr.type === 'defense') areaDefense[areaIdx] += attr.value;
    else if (attr.type === 'magic') areaMagic[areaIdx] += attr.value;
    else if (attr.type === 'gold') areaGold[areaIdx] += attr.value;
  }

  private hasEffect(p: PlayerState, effectId: string) {
    return p.activeAreaEffects.some((_, i) => this.getEffectiveEffectId(p, i) === effectId);
  }

  private handleDamagePhase() {
    const p = this.currentPlayer();
    const opp = this.opponent();

    if (this.currentPlayerIndex === 0 && this.firstPlayerFirstTurn) return;

    const hpBeforeDamage = p.hp;
    p.contractTriggeredAreaIdx = -1;

    const backfireCount = p.activeAreaEffects.filter((_, i) => this.getEffectiveEffectId(p, i) === 'backfire').length;
    if (backfireCount > 0) {
      const normalHits = opp.attackQueue.flat();
      const successfullyDefended = normalHits.length === 0 || normalHits.every(atk => Math.max(0, atk - p.defense) <= 0);
      if (successfullyDefended) {
        p.activeAreaEffects.forEach((c, aIdx) => {
          if (c && this.getEffectiveEffectId(p, aIdx) === 'backfire') p.piercingAttacks[aIdx].push(2);
        });
      }
    }

    let totalDamage = 0;
    opp.attackQueue.forEach(hits => {
      hits.forEach(atk => {
        totalDamage += Math.max(0, atk - p.defense);
      });
    });
    opp.piercingQueue.forEach(hits => {
      hits.forEach(atk => {
        totalDamage += atk;
      });
    });

    p.hp -= totalDamage;

    if (p.hp <= 0 && hpBeforeDamage >= 4) {
      const contractIdx = p.activeAreaEffects.findIndex((_, i) => this.getEffectiveEffectId(p, i) === 'contract');
      if (contractIdx !== -1) {
        p.hp = 1;
        p.contractTriggeredAreaIdx = contractIdx;
      }
    }

    if (p.hp <= 3 && !p.breakthroughApplied && this.hasEffect(p, 'breakthrough')) {
      p.magic += p.turnBaseStats.magic.reduce((a, b) => a + b, 0);
      p.gold += p.turnBaseStats.gold.reduce((a, b) => a + b, 0);
      p.defense += p.turnBaseStats.defense.reduce((a, b) => a + b, 0);
      p.turnBaseStats.sums.forEach((s, i) => {
        if (s > 0) p.currentAttacks[i][0] += s;
      });
      p.breakthroughApplied = true;
    }

    opp.attackQueue = [[], [], []];
    opp.piercingQueue = [[], [], []];
    opp.currentAttacks = [[0], [0], [0]];
    opp.piercingAttacks = [[], [], []];

    if (p.hp <= 0) this.winner = this.opponentIndex();
  }

  private listOpponentDodgeTargets(): AttackTarget[] {
    const opp = this.opponent();
    const targets: AttackTarget[] = [];
    for (let aIdx = 0; aIdx < 3; aIdx++) {
      (opp.attackQueue[aIdx] || []).forEach((v, hitIdx) => {
        if (v > 0) targets.push({areaIdx: aIdx, hitIdx, val: v});
      });
    }
    return targets;
  }

  private listSelfAttackTargets(): AttackTarget[] {
    const p = this.currentPlayer();
    const targets: AttackTarget[] = [];
    for (let aIdx = 0; aIdx < 3; aIdx++) {
      (p.currentAttacks[aIdx] || []).forEach((v, hitIdx) => {
        if (v > 0) targets.push({areaIdx: aIdx, hitIdx, val: v});
      });
    }
    return targets;
  }

  private hasAnyAttackTarget(p: PlayerState) {
    return p.currentAttacks.some(areaAtks => areaAtks.some(v => v > 0));
  }

  private hasAnyThrustTarget(p: PlayerState) {
    return p.currentAttacks.some(areaAtks => areaAtks.some(v => v > 0 && v <= 2));
  }

  private aiActivationLoop(phase: number) {
    this.currentPhaseIndex = phase;
    for (let i = 0; i < 200 && this.winner === null; i++) {
      const acts = this.availableActivations();
      if (acts.length === 0) return;
      if (this.currentAiDifficulty() === 'expert') {
        const scored = acts
          .map(act => ({act, score: this.scoreActivationForExpert(act.label) + Math.random() * 0.1}))
          .filter(x => x.score >= 2.75);
        if (scored.length === 0) return;
        const maxScore = Math.max(...scored.map(x => x.score));
        chooseUniform(scored.filter(x => x.score === maxScore)).act.run();
      } else {
        if (Math.random() > 0.9) return;
        chooseUniform(acts).run();
      }
    }
  }

  /*
   * 可發動效果的條件表與 UI 共用（見 src/engine/activations.ts）。
   * 這裡以前是一份和 UI 幾乎一字不差的 90 行 if 串 —— 兩份手抄的規則沒有任何
   * 機制保證同步，而 AI 正是靠這個模擬器判斷「這樣打值不值得」。
   * label 沿用 effectId，因為模擬器的評分是直接比對 id。
   */
  private availableActivations(): Array<{label: string; run: () => void}> {
    const p = this.currentPlayer();
    const opp = this.opponent();
    const runners: Record<string, (areaIdx: number) => void> = {
      fate: aIdx => this.useFate(aIdx),
      frost: aIdx => this.useFrost(aIdx),
      magic_luck: aIdx => this.useMagicLuck(aIdx),
      illusion: aIdx => this.useIllusion(aIdx),
      dodge: aIdx => this.useEvasion(aIdx),
      shield: aIdx => this.useShield(aIdx),
      barrier: aIdx => this.useBarrier(aIdx),
      amplify: aIdx => this.useAmplify(aIdx),
      magic_bullet: aIdx => this.useMagicBullet(aIdx),
      thrust: aIdx => this.useThrust(aIdx),
      forest: aIdx => this.useForest(aIdx),
      charge: aIdx => this.useCharge(aIdx),
      reproduction: aIdx => this.useReproduction(aIdx),
      flare: aIdx => this.useFlare(aIdx),
      holy_light: aIdx => this.useHolyLight(aIdx),
      soul_snatch: aIdx => this.useSoulSnatch(aIdx),
    };

    return listActivations({
      phaseIndex: this.currentPhaseIndex,
      player: p,
      opponent: opp,
      diceCount: this.diceResults.length,
      opponentDodgeTargetCount: this.listOpponentDodgeTargets().length,
      selfAttackTargetCount: this.listSelfAttackTargets().length,
      hasAnyAttackTarget: this.hasAnyAttackTarget(p),
      hasAnyThrustTarget: this.hasAnyThrustTarget(p),
      hasCopyableOpponentCard: opp.activeAreaEffects.some(
        c => c && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId),
      ),
      // 模擬器沒有「等待玩家選取」這個中間狀態，一律不擋
      blockedBySelection: false,
    }).map(({effectId, areaIdx}) => ({
      label: effectId,
      run: () => runners[effectId]?.(areaIdx),
    }));
  }

  private useFate(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.fateUsedIndices.includes(areaIdx) || this.diceResults.length === 0) return;
    let indices: number[];
    if (this.currentAiDifficulty() === 'expert') {
      indices = this.chooseExpertFateDiceIndices();
    } else {
      const n = this.diceResults.length;
      const k = randInt(1, n);
      indices = Array.from({length: n}, (_, i) => i);
      shuffleInPlace(indices);
      indices = indices.slice(0, k);
    }
    indices.forEach(idx => {
      this.diceResults[idx] = randInt(1, 6);
    });
    p.fateUsedIndices.push(areaIdx);
    if (this.currentPhaseIndex === 2) this.handleJudging();
  }

  private useFrost(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.frostUsedIndices.includes(areaIdx) || this.diceResults.length === 0) return;
    const dieIdx = this.currentAiDifficulty() === 'expert'
      ? this.chooseExpertFrostDieIndex()
      : randInt(0, this.diceResults.length - 1);
    this.diceResults.splice(dieIdx, 1);
    const extraAtk = randInt(1, 3);
    p.extraFrostAttacks[areaIdx].push(extraAtk);
    p.currentAttacks[areaIdx].push(extraAtk);
    p.frostUsedIndices.push(areaIdx);
  }

  private useMagicLuck(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.magicLuckUsedIndices.includes(areaIdx) || p.magic < 2) return;
    p.magic -= 2;
    p.magicSpentInJudging += 2;
    this.diceResults.push(randInt(1, 6));
    p.magicLuckUsedIndices.push(areaIdx);
    this.handleJudging();
  }

  private useIllusion(areaIdx: number) {
    const p = this.currentPlayer();
    const candidates: number[] = [];
    this.opponent().activeAreaEffects.forEach((c, idx) => {
      if (c && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId)) candidates.push(idx);
    });
    if (p.magic < 1 || candidates.length === 0) return;
    const oppAreaIdx = this.currentAiDifficulty() === 'expert'
      ? this.chooseExpertIllusionTargetArea()
      : chooseUniform(candidates);
    const targetCard = this.opponent().activeAreaEffects[oppAreaIdx];
    if (!targetCard) return;
    p.magic -= 1;
    p.magicSpentInJudging += 1;
    p.illusionUsedIndices.push(areaIdx);
    p.illusionCopiedEffectIds[areaIdx] = targetCard.effectId;
    this.handleJudging();
  }

  private useEvasion(areaIdx: number) {
    const p = this.currentPlayer();
    const opp = this.opponent();
    const targets = this.listOpponentDodgeTargets();
    if (p.magic < 3 || targets.length === 0) return;
    const target = this.currentAiDifficulty() === 'expert'
      ? chooseHighestAttackTarget(targets)
      : chooseAiWeightedAttackTarget(targets);
    p.magic -= 3;
    opp.attackQueue[target.areaIdx].splice(target.hitIdx, 1);
    p.evasionUsedIndices.push(areaIdx);
  }

  private useShield(_areaIdx: number) {
    const p = this.currentPlayer();
    if (p.magic < 2) return;
    p.magic -= 2;
    p.defense += 1;
  }

  private useBarrier(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.barrierUsedIndices.includes(areaIdx) || p.magic < 3) return;
    p.magic -= 3;
    p.defense += 3;
    p.barrierUsedIndices.push(areaIdx);
  }

  private useAmplify(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.amplifyUsedIndices.includes(areaIdx) || !this.hasAnyAttackTarget(p)) return;
    p.currentAttacks = p.currentAttacks.map(hits => hits.map(atk => atk > 0 ? atk + 1 : 0));
    p.amplifyUsedIndices.push(areaIdx);
  }

  private useMagicBullet(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.magic < 1) return;
    p.magic -= 1;
    p.currentAttacks[areaIdx].push(2);
  }

  private useThrust(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.thrustUsedIndices.includes(areaIdx)) return;
    let transformedCount = 0;
    p.currentAttacks.forEach((areaAtks, aIdx) => {
      areaAtks.forEach((val, hitIdx) => {
        if (val > 0 && val <= 2) {
          p.currentAttacks[aIdx][hitIdx] = val * 2;
          transformedCount++;
        }
      });
    });
    if (transformedCount > 0) p.thrustUsedIndices.push(areaIdx);
  }

  private useForest(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.forestUsedIndices.includes(areaIdx) || p.magic < 3) return;
    p.magic -= 3;
    const totalSum = p.currentAttacks.flat().reduce((a, b) => a + b, 0);
    p.currentAttacks = [[0], [0], [0]];
    p.currentAttacks[areaIdx] = [totalSum];
    p.forestUsedIndices.push(areaIdx);
  }

  private useCharge(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.chargeUsedIndices.includes(areaIdx) || p.magic < 2) return;
    const targets = this.listSelfAttackTargets();
    if (targets.length === 0) return;
    const target = this.currentAiDifficulty() === 'expert'
      ? chooseHighestAttackTarget(targets)
      : chooseAiWeightedAttackTarget(targets);
    p.magic -= 2;
    p.currentAttacks[target.areaIdx][target.hitIdx] += 3;
    p.chargeUsedIndices.push(areaIdx);
  }

  private useReproduction(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.reproductionUsedIndices.includes(areaIdx) || p.magic < 2) return;
    const targets = this.listSelfAttackTargets();
    if (targets.length === 0) return;
    const target = this.currentAiDifficulty() === 'expert'
      ? chooseHighestAttackTarget(targets)
      : chooseAiWeightedAttackTarget(targets);
    p.magic -= 2;
    p.currentAttacks[target.areaIdx].push(target.val);
    p.reproductionUsedIndices.push(areaIdx);
  }

  private useFlare(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.flareUsedIndices.includes(areaIdx) || p.magic < 3) return;
    const targets = this.listSelfAttackTargets();
    if (targets.length === 0) return;
    const target = this.currentAiDifficulty() === 'expert'
      ? chooseHighestAttackTarget(targets)
      : chooseAiWeightedAttackTarget(targets);
    p.magic -= 3;
    p.currentAttacks[target.areaIdx][target.hitIdx] *= 2;
    p.flareUsedIndices.push(areaIdx);
  }

  private useHolyLight(_areaIdx: number) {
    const p = this.currentPlayer();
    if (p.magic < 2) return;
    p.magic -= 2;
    if (this.currentPhaseIndex === 2) p.magicSpentInJudging += 2;
    p.hp += 1;
  }

  private useSoulSnatch(_areaIdx: number) {
    const p = this.currentPlayer();
    const opp = this.opponent();
    if (p.magic < 3) return;
    p.magic -= 3;
    if (this.currentPhaseIndex === 2) p.magicSpentInJudging += 3;
    opp.hp -= 1;
    p.hp += 1;
    if (opp.hp <= 0) this.winner = this.currentPlayerIndex;
  }

  private aiBuyPhase() {
    this.currentPhaseIndex = 6;
    if (this.deck.length > 0 && this.buyDeckDrawCount < 1) {
      this.buyFromDeck();
    }

    for (let i = 0; i < 20; i++) {
      const p = this.currentPlayer();
      const actions: Array<{score: number; run: () => void}> = [];
      const nextDrawIndex = this.buyDeckDrawCount + 1;
      const nextDrawCost = this.deckDrawCost(nextDrawIndex);
      if (this.deck.length > 0 && Number.isFinite(nextDrawCost) && p.gold >= nextDrawCost) {
        actions.push({
          score: this.currentAiDifficulty() === 'expert' ? 5.8 - nextDrawCost * 1.1 + Math.random() * 0.1 : Math.random(),
          run: () => this.buyFromDeck(),
        });
      }
      ([0, 1, 2] as const).forEach(idx => {
        const c = this.market[idx];
        const price = this.marketPrice(idx);
        if (c && p.gold >= price) {
          actions.push({
            score: this.currentAiDifficulty() === 'expert'
              ? this.scoreCardForExpert(c) - price * 1.35 + Math.random() * 0.1
              : Math.random(),
            run: () => this.buyMarketCard(idx),
          });
        }
      });
      if (actions.length === 0) return;
      if (this.currentAiDifficulty() === 'expert') {
        const maxScore = Math.max(...actions.map(a => a.score));
        chooseUniform(actions.filter(a => a.score === maxScore)).run();
      } else {
        chooseUniform(actions).run();
      }
    }
  }

  private buyFromDeck() {
    const p = this.currentPlayer();
    const nextDrawIndex = this.buyDeckDrawCount + 1;
    const cost = this.deckDrawCost(nextDrawIndex);
    if (!Number.isFinite(cost) || p.gold < cost || this.deck.length === 0) return;
    p.gold -= cost;
    const card = this.drawFromDeck();
    if (!card) return;
    p.hand.push(card);
    this.buyDeckDrawCount = nextDrawIndex;
  }

  private buyMarketCard(slotIdx: 0 | 1 | 2) {
    const p = this.currentPlayer();
    const card = this.market[slotIdx];
    if (!card) return;
    const price = this.marketPrice(slotIdx);
    if (p.gold < price) return;
    p.gold -= price;
    p.hand.push(card);
    this.market[slotIdx] = null;
  }

  private endTurn() {
    this.refillMarket();
    const p = this.currentPlayer();
    p.magic = 0;
    p.gold = 0;
    p.defense = 0;
    this.currentPlayerIndex = this.opponentIndex();
    if (this.currentPlayerIndex === 0) this.firstPlayerFirstTurn = false;
  }
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

function runSeries(opts: ReturnType<typeof parseArgs>, p0Ai: AiDifficulty, p1Ai: AiDifficulty): SeriesStats {
  const started = performance.now();
  let firstWins = 0;
  let secondWins = 0;
  let draws = 0;
  let totalTurns = 0;

  for (let i = 0; i < opts.games; i++) {
    const result = new SimulationGame(opts.hp, opts.maxTurns, opts.opening, [p0Ai, p1Ai]).run();
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

function main() {
  const opts = parseArgs();

  console.log(`Initial HP: ${opts.hp}`);
  console.log(`Opening mode: ${opts.opening}`);
  console.log(`Max turns per game: ${opts.maxTurns}`);
  console.log('');

  if (opts.matchup === 'expert-normal') {
    console.log(`Matchup: expert-normal`);
    console.log(`Games per seat: ${opts.games}`);
    console.log('');

    console.log('--- Leg 1: Expert first vs Normal second ---');
    const expertFirst = runSeries(opts, 'expert', 'normal');
    printSeries(expertFirst);
    console.log('');

    console.log('--- Leg 2: Normal first vs Expert second ---');
    const expertSecond = runSeries(opts, 'normal', 'expert');
    printSeries(expertSecond);
    console.log('');

    const totalGames = expertFirst.games + expertSecond.games;
    const expertWins = expertFirst.firstWins + expertSecond.secondWins;
    const normalWins = expertFirst.secondWins + expertSecond.firstWins;
    const draws = expertFirst.draws + expertSecond.draws;
    const totalTurns = expertFirst.totalTurns + expertSecond.totalTurns;
    const elapsedMs = expertFirst.elapsedMs + expertSecond.elapsedMs;

    console.log('--- Aggregate by AI ---');
    console.log(`Total simulations: ${totalGames}`);
    console.log(`Expert wins: ${expertWins} (${formatPct(expertWins, totalGames)})`);
    console.log(`Normal wins: ${normalWins} (${formatPct(normalWins, totalGames)})`);
    console.log(`Draws/capped: ${draws} (${formatPct(draws, totalGames)})`);
    console.log(`Average turns: ${(totalTurns / totalGames).toFixed(2)}`);
    console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(2)}s`);
    console.log(`Throughput: ${(totalGames / (elapsedMs / 1000)).toFixed(0)} games/sec`);
    return;
  }

  const stats = runSeries(opts, opts.p0Ai, opts.p1Ai);
  if (opts.matchup === 'expert-mirror') console.log('Matchup: expert-mirror');
  else console.log('Matchup: custom');
  console.log('');
  printSeries(stats);
}

main();

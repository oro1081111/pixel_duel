import type {CardAttr} from '../cards';
import {getBaseAttrForDie} from '../basebars';
import {getActivationMagicCost, isMagicSpendActivation} from '../engine/activations';
import {getEffectiveEffectId, hasActiveEffect, isMirageActive} from '../engine/deck';
import type {GameCard, PlayerState} from '../engine/state';

const EFFECT_WEIGHTS: Readonly<Record<string, number>> = {
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

const ATTR_WEIGHTS: Readonly<Record<string, number>> = {
  attack: 2.15,
  magic: 1.6,
  defense: 1.6,
  gold: 1.15,
};

const ILLUSION_UNCOPYABLE_EFFECT_IDS = new Set(['lucky', 'fate', 'frost']);
const DIE_AREA_PROBABILITY = 1 / 3;
const SHADOW_PIERCING_DAMAGE = 3;
const BRILLIANCE_ATTACK_BONUS = 7;
const BRILLIANCE_DICE_REQUIRED = 3;
const PIERCING_DAMAGE_MULTIPLIER = 1.15;

export type HeuristicState = {
  players: [PlayerState, PlayerState];
  currentPlayerIndex: 0 | 1;
  currentPhaseIndex: number;
  diceResults: number[];
};

export type AttackTarget = {areaIdx: number; hitIdx: number; val: number};

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

/**
 * 高手（adept）的唯一 heuristic 實作。
 * UI 與 SimulationGame 都只傳當下狀態進來，不再各維護一份權重與判斷。
 */
export class AdeptHeuristic {
  constructor(
    private readonly state: HeuristicState,
    private readonly random: () => number = Math.random,
  ) {}

  private currentPlayer() {
    return this.state.players[this.state.currentPlayerIndex];
  }

  private opponent() {
    return this.state.players[1 - this.state.currentPlayerIndex];
  }

  private chooseUniform<T>(items: T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }

  private effectWeight(effectId: string | null | undefined) {
    if (!effectId) return 0;
    return EFFECT_WEIGHTS[effectId] ?? 4;
  }

  private hasEffect(p: PlayerState, effectId: string) {
    return hasActiveEffect(p, effectId);
  }

  private hasHandEffect(p: PlayerState, effectId: string) {
    return p.hand.some(c => c.effectId === effectId);
  }

  private countHandEffects(p: PlayerState, effectIds: string[]) {
    return p.hand.filter(c => effectIds.includes(c.effectId)).length;
  }

  private countMagicSpendCards(p: PlayerState) {
    const activeCount = p.activeAreaEffects.filter(c => isMagicSpendActivation(c?.effectId)).length;
    const handCount = p.hand.filter(c => isMagicSpendActivation(c.effectId)).length;
    return activeCount + Math.min(3, handCount);
  }

  private countOpponentMagicSpendThreats() {
    return this.opponent().activeAreaEffects.filter(c => isMagicSpendActivation(c?.effectId)).length;
  }

  private estimateIncomingNormalDamageAfterDefense(p = this.currentPlayer()) {
    return this.opponent().attackQueue.flat().reduce((sum, atk) => sum + Math.max(0, atk - p.defense), 0);
  }

  private estimateIncomingPiercingDamage() {
    return this.opponent().piercingQueue.flat().reduce((sum, atk) => sum + atk, 0);
  }

  private defensePressure(p = this.currentPlayer()) {
    const incomingNormal = this.estimateIncomingNormalDamageAfterDefense(p);
    const incomingPiercing = this.estimateIncomingPiercingDamage();
    const lowHpBonus = p.hp <= 3 ? 3 : p.hp <= 5 ? 2 : p.hp <= 8 ? 1 : 0;
    return incomingNormal + incomingPiercing * 0.75 + lowHpBonus;
  }

  private magicNeed(p = this.currentPlayer()) {
    if (isMirageActive(this.state.players)) return 0;
    const spendCount = this.countMagicSpendCards(p);
    const expensiveActiveCount = p.activeAreaEffects.filter(c => {
      const eff = c?.effectId;
      return eff === 'flare' || eff === 'forest' || eff === 'barrier'
        || eff === 'soul_snatch' || eff === 'dodge';
    }).length;
    return spendCount + expensiveActiveCount * 1.3;
  }

  private attrValue(attr: CardAttr, p = this.currentPlayer()) {
    let weight = ATTR_WEIGHTS[attr.type] || 1;
    if (attr.type === 'magic') {
      weight += Math.min(1.25, this.magicNeed(p) * 0.18);
      if (isMirageActive(this.state.players)) weight *= 0.35;
    } else if (attr.type === 'defense') {
      weight += Math.min(1.35, this.defensePressure(p) * 0.18);
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
      const base = getBaseAttrForDie(this.state.currentPlayerIndex, dieValue);
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
      const base = getBaseAttrForDie(this.state.currentPlayerIndex, dieValue);
      let score = this.attrValue(base, p);
      p.board[areaIdx].forEach(card => {
        score += this.attrValue(isLeft ? card.left : card.right, p);
      });
      return sum + score;
    }, 0) / values.length;
  }

  private getAreaDiceCounts() {
    const counts = [0, 0, 0];
    this.state.diceResults.forEach(v => counts[Math.floor((v - 1) / 2)]++);
    return counts;
  }

  private getAreaIndexForEffect(p: PlayerState, effectId: string) {
    return p.activeAreaEffects.findIndex((_, i) => getEffectiveEffectId(p, i) === effectId);
  }

  private estimateDieValue(dieValue: number) {
    const p = this.currentPlayer();
    const areaIdx = Math.floor((dieValue - 1) / 2);
    const isLeft = dieValue % 2 !== 0;
    const base = getBaseAttrForDie(this.state.currentPlayerIndex, dieValue);
    let score = this.attrValue(base, p);
    p.board[areaIdx].forEach(card => {
      score += this.attrValue(isLeft ? card.left : card.right, p);
    });
    const eff = getEffectiveEffectId(p, areaIdx);
    if (eff === 'brilliance') score += 1.5;
    if (eff === 'gale') score += 1;
    if (eff === 'surge' && base.type === 'magic') score += 1.5;
    return score;
  }

  listOpponentDodgeTargets(): AttackTarget[] {
    const targets: AttackTarget[] = [];
    for (let areaIdx = 0; areaIdx < 3; areaIdx++) {
      this.opponent().attackQueue[areaIdx].forEach((val, hitIdx) => {
        if (val > 0) targets.push({areaIdx, hitIdx, val});
      });
    }
    return targets;
  }

  listSelfAttackTargets(): AttackTarget[] {
    const targets: AttackTarget[] = [];
    for (let areaIdx = 0; areaIdx < 3; areaIdx++) {
      this.currentPlayer().currentAttacks[areaIdx].forEach((val, hitIdx) => {
        if (val > 0) targets.push({areaIdx, hitIdx, val});
      });
    }
    return targets;
  }

  chooseLowestValueDieIndex() {
    const counts = this.getAreaDiceCounts();
    const p = this.currentPlayer();
    const scored = this.state.diceResults.map((v, idx) => {
      const areaIdx = Math.floor((v - 1) / 2);
      let score = this.estimateDieValue(v);
      if (getEffectiveEffectId(p, areaIdx) === 'shadow' && counts[areaIdx] === 1) score -= 5;
      return {idx, score};
    });
    const minScore = Math.min(...scored.map(x => x.score));
    return this.chooseUniform(scored.filter(x => x.score === minScore)).idx;
  }

  chooseFateDiceIndices() {
    const p = this.currentPlayer();
    const counts = this.getAreaDiceCounts();
    const scored = this.state.diceResults.map((v, idx) => ({
      idx,
      areaIdx: Math.floor((v - 1) / 2),
      score: this.estimateDieValue(v),
    }));
    if (scored.length === 0) return [];

    const shadowAreaIdx = this.getAreaIndexForEffect(p, 'shadow');
    if (shadowAreaIdx >= 0 && counts[shadowAreaIdx] > 0 && counts[shadowAreaIdx] <= 2) {
      return scored.filter(x => x.areaIdx === shadowAreaIdx).map(x => x.idx);
    }

    const brillianceAreaIdx = this.getAreaIndexForEffect(p, 'brilliance');
    if (brillianceAreaIdx >= 0 && counts[brillianceAreaIdx] === 2) {
      const outside = scored.filter(x => x.areaIdx !== brillianceAreaIdx).sort((a, b) => a.score - b.score);
      if (outside.length > 0) return outside.slice(0, Math.min(2, outside.length)).map(x => x.idx);
    }

    const avg = scored.reduce((sum, x) => sum + x.score, 0) / scored.length;
    const chosen = scored.filter(x => x.score < Math.max(2.4, avg * 0.82)).map(x => x.idx);
    if (chosen.length > 0) return chosen;
    const minScore = Math.min(...scored.map(x => x.score));
    return [this.chooseUniform(scored.filter(x => x.score === minScore)).idx];
  }

  chooseFrostDieIndex() {
    const p = this.currentPlayer();
    const counts = this.getAreaDiceCounts();
    const scored = this.state.diceResults.map((v, idx) => {
      const areaIdx = Math.floor((v - 1) / 2);
      let score = this.estimateDieValue(v);
      if (getEffectiveEffectId(p, areaIdx) === 'shadow' && counts[areaIdx] === 1) score -= 8;
      return {idx, score};
    });
    const minScore = Math.min(...scored.map(x => x.score));
    return this.chooseUniform(scored.filter(x => x.score === minScore)).idx;
  }

  chooseIllusionTargetArea() {
    const candidates: Array<{areaIdx: number; score: number}> = [];
    this.opponent().activeAreaEffects.forEach((c, areaIdx) => {
      if (!c || ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId)) return;
      candidates.push({areaIdx, score: this.effectWeight(c.effectId)});
    });
    if (candidates.length === 0) return -1;
    const maxScore = Math.max(...candidates.map(c => c.score));
    return this.chooseUniform(candidates.filter(c => c.score === maxScore)).areaIdx;
  }

  scoreCard(card: GameCard, areaIdx = -1) {
    const p = this.currentPlayer();
    const defensePressure = this.defensePressure(p);
    const magicNeed = this.magicNeed(p);
    const mirageActive = isMirageActive(this.state.players);
    const currentEff = areaIdx >= 0 ? getEffectiveEffectId(p, areaIdx) : null;
    const coveringOwnMirage = currentEff === 'mirage' && card.effectId !== 'mirage';
    const hasBrilliance = this.hasEffect(p, 'brilliance') || card.effectId === 'brilliance';
    const hasShadow = this.hasEffect(p, 'shadow') || card.effectId === 'shadow';
    const comboEffects = ['charge', 'reproduction', 'flare', 'forest', 'amplify', 'thrust', 'magic_bullet'];
    const attackComboCount = this.countHandEffects(p, comboEffects)
      + p.activeAreaEffects.filter(c => comboEffects.includes(c?.effectId || '')).length;
    const attackAttrValue = card.left.type === 'attack' ? card.left.value : 0;
    const attackAttrRight = card.right.type === 'attack' ? card.right.value : 0;
    let score = this.effectWeight(card.effectId) + this.attrValue(card.left, p) + this.attrValue(card.right, p);

    if (isMagicSpendActivation(card.effectId)) {
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
        + (this.hasEffect(p, 'fate') ? 1.4 : 0)
        + (this.hasEffect(p, 'magic_luck') ? 1.5 : 0)
        + (this.hasEffect(p, 'lucky') ? 0.8 : 0);
      score += diceSupport;
      if (this.hasEffect(p, 'shadow')) score -= 0.7;
    }
    if (card.effectId === 'shadow') {
      score += (this.hasEffect(p, 'frost') || this.hasHandEffect(p, 'frost')) ? 3.2 : 0;
      score += (this.hasEffect(p, 'fate') || this.hasHandEffect(p, 'fate')) ? 1.4 : 0;
      score += (this.hasEffect(p, 'lucky') || this.hasHandEffect(p, 'lucky')) ? 0.8 : 0;
      if (this.hasEffect(p, 'brilliance')) score -= 0.6;
    }
    if (card.effectId === 'frost') score += hasShadow ? 3.4 : hasBrilliance ? 0.8 : 0.5;
    if (card.effectId === 'fate') score += hasBrilliance ? 2.3 : hasShadow ? 1.6 : 0.4;
    if (card.effectId === 'magic_luck') {
      score += hasBrilliance ? 3.1 : 0.4;
      if (this.hasEffect(p, 'shadow') && !hasBrilliance) score -= 1.2;
      if (magicNeed >= 4) score -= 0.8;
    }
    if (card.effectId === 'lucky') score += hasShadow ? 1.1 : hasBrilliance ? 0.9 : 0;

    if (card.effectId === 'holy_light') score += p.hp <= 4 ? 3.4 : p.hp <= 7 ? 1.8 : 0.3;
    if (card.effectId === 'contract') score += p.hp <= 5 ? 3.2 : p.hp <= 8 ? 1.2 : 0;
    if (card.effectId === 'breakthrough') score += p.hp <= 4 ? 3.8 : p.hp <= 6 ? 1.2 : 0;
    if (card.effectId === 'dodge') {
      const strongest = Math.max(0, ...this.opponent().attackQueue.flat());
      score += strongest >= 4 ? 3.2 : defensePressure >= 3 ? 1.7 : 0;
    }
    if (card.effectId === 'barrier') score += defensePressure >= 4 ? 2.8 : defensePressure >= 2 ? 1.1 : 0;
    if (card.effectId === 'shield') score += defensePressure >= 3 ? 1.7 : 0.2;
    if (card.effectId === 'backfire') score += defensePressure >= 2 ? 1.5 : 0.4;

    if (card.effectId === 'magic_bullet') score += (this.hasEffect(p, 'thrust') || this.hasHandEffect(p, 'thrust') ? 1.8 : 0)
      + (this.hasEffect(p, 'forest') || this.hasHandEffect(p, 'forest') ? 1.4 : 0)
      + (this.hasEffect(p, 'amplify') || this.hasHandEffect(p, 'amplify') ? 0.9 : 0);
    if (card.effectId === 'thrust') score += (this.hasEffect(p, 'magic_bullet') || this.hasHandEffect(p, 'magic_bullet') ? 2.2 : 0)
      + (attackAttrValue + attackAttrRight >= 1 ? 0.7 : 0);
    if (card.effectId === 'amplify') score += attackComboCount >= 2 ? 1.5 : 0.5;
    if (card.effectId === 'forest') score += attackComboCount >= 2 ? 2.2 : 0.7;
    if (card.effectId === 'charge') score += attackComboCount >= 1 ? 1.1 : 0.2;
    if (card.effectId === 'flare') score += (this.hasEffect(p, 'charge') || this.hasHandEffect(p, 'charge') ? 1.1 : 0)
      + (this.hasEffect(p, 'reproduction') || this.hasHandEffect(p, 'reproduction') ? 1.3 : 0);
    if (card.effectId === 'reproduction') score += (this.hasEffect(p, 'flare') || this.hasHandEffect(p, 'flare') ? 1.6 : 0)
      + (this.hasEffect(p, 'forest') || this.hasHandEffect(p, 'forest') ? 1 : 0);
    if (card.effectId === 'surge') score += magicNeed >= 3 ? 1.5 : 0.3;
    if (card.effectId === 'flame_shield') score += defensePressure >= 3 ? 1.3 : 0.4;
    if (card.effectId === 'gale' || card.effectId === 'ambush') score += this.opponent().hp <= 5 ? 1.1 : 0.4;
    if (card.effectId === 'illusion') {
      const targetArea = this.chooseIllusionTargetArea();
      score += targetArea >= 0 ? this.effectWeight(this.opponent().activeAreaEffects[targetArea]?.effectId) * 0.5 : -2.5;
    }

    if (areaIdx >= 0) {
      score -= this.effectWeight(currentEff) * 0.35;
      if (card.effectId === currentEff) score -= 2;
      if (currentEff === 'shadow' && card.effectId !== 'shadow' && !this.hasEffect(p, 'brilliance')) score -= 1.4;
      if (card.effectId === 'brilliance') score += this.averageAreaDieValue(areaIdx, p) >= 4 ? 1.1 : 0.4;
      if (card.effectId === 'shadow') score += this.averageAreaDieValue(areaIdx, p) <= 3.2 ? 1.2 : -0.3;
      if (card.effectId === 'surge') score += this.areaAttrPotential(areaIdx, 'magic', p) * 0.35;
      if (card.effectId === 'flame_shield') score += this.areaAttrPotential(areaIdx, 'defense', p) * 0.35;
    }

    return score;
  }

  choosePlay() {
    const p = this.currentPlayer();
    if (p.hand.length === 0) return null;
    let best: {handIdx: number; areaIdx: number; score: number} | null = null;
    p.hand.forEach((card, handIdx) => {
      for (let areaIdx = 0; areaIdx < 3; areaIdx++) {
        const score = this.scoreCard(card, areaIdx) + this.random() * 0.15;
        if (!best || score > best.score) best = {handIdx, areaIdx, score};
      }
    });
    return best;
  }

  choosePlayCount(inPreparationPhase = false) {
    const p = this.currentPlayer();
    if (inPreparationPhase) return 1;
    if (p.hand.length <= 1) return 1;
    const bestHandScore = Math.max(...p.hand.map(c => this.scoreCard(c)));
    const activeBrilliance = this.hasEffect(p, 'brilliance');
    const activeShadow = this.hasEffect(p, 'shadow');
    if (activeBrilliance && !activeShadow) return 1;
    if (activeShadow && !activeBrilliance && p.hand.length >= 5) return 2;
    if (p.hand.length >= 5 && bestHandScore >= 7.5) return 3;
    if (p.hand.length >= 3 && bestHandScore >= 8.2) return 2;
    if (p.cardsPlayedThisTurn === 0 && p.board.flat().length < 3) return Math.min(2, p.hand.length);
    return 1;
  }

  chooseRollCount(rollOptions: number[]) {
    if (rollOptions.length <= 1) return rollOptions[0];
    const p = this.currentPlayer();
    const areaIndices = [0, 1, 2] as const;
    const shadowAreas = areaIndices.filter(i => getEffectiveEffectId(p, i) === 'shadow').length;
    const brillianceAreas = areaIndices.filter(i => getEffectiveEffectId(p, i) === 'brilliance').length;
    let avgDieScore = 0;
    for (let dieValue = 1; dieValue <= 6; dieValue++) avgDieScore += this.estimateDieValue(dieValue);
    avgDieScore /= 6;

    const scored = rollOptions.map(count => {
      let score = count * avgDieScore;
      if (shadowAreas > 0) {
        score += shadowAreas * SHADOW_PIERCING_DAMAGE * ATTR_WEIGHTS.attack * PIERCING_DAMAGE_MULTIPLIER
          * Math.pow(1 - DIE_AREA_PROBABILITY, count);
      }
      if (brillianceAreas > 0) {
        score += brillianceAreas * BRILLIANCE_ATTACK_BONUS * ATTR_WEIGHTS.attack
          * binomialProbAtLeast(BRILLIANCE_DICE_REQUIRED, count, DIE_AREA_PROBABILITY);
      }
      return {count, score};
    });
    const maxScore = Math.max(...scored.map(s => s.score));
    return this.chooseUniform(scored.filter(s => s.score === maxScore)).count;
  }

  private hasAnyAttackTarget() {
    return this.currentPlayer().currentAttacks.some(area => area.some(v => v > 0));
  }

  private buildMagicPlan() {
    const p = this.currentPlayer();
    const planned: Record<string, number> = {};
    if (p.magic <= 0 || isMirageActive(this.state.players)) return planned;

    const candidates: Array<{effectId: string; cost: number; score: number; priority: number}> = [];
    const canPlanPhase = (phase: number) => this.state.currentPhaseIndex <= phase;
    const add = (effectId: string, score: number, priority = 0, uses = 1, decay = 1.15) => {
      const cost = getActivationMagicCost(effectId);
      if (cost <= 0 || score < 2.75) return;
      for (let i = 0; i < uses; i++) candidates.push({effectId, cost, score: Math.max(0, score - i * decay), priority});
    };

    if (canPlanPhase(2)) {
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'magic_luck' && !p.magicLuckUsedIndices.includes(i))) {
        add('magic_luck', this.scoreActivationRaw('magic_luck'), 5);
      }
      if (p.activeAreaEffects.some((c, i) => c?.effectId === 'illusion' && !p.illusionUsedIndices.includes(i)) && this.chooseIllusionTargetArea() >= 0) {
        add('illusion', this.scoreActivationRaw('illusion'), 4);
      }
    }

    if (canPlanPhase(3)) {
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'dodge' && !p.evasionUsedIndices.includes(i)) && this.listOpponentDodgeTargets().length > 0) {
        add('dodge', this.scoreActivationRaw('dodge'), 8);
      }
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'barrier' && !p.barrierUsedIndices.includes(i))) {
        add('barrier', this.scoreActivationRaw('barrier'), 7);
      }
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'shield')) {
        add('shield', this.scoreActivationRaw('shield'), 6, Math.min(2, Math.ceil(Math.max(0, this.estimateIncomingNormalDamageAfterDefense(p)))));
      }
    }

    if (canPlanPhase(5)) {
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'soul_snatch')) {
        add('soul_snatch', this.scoreActivationRaw('soul_snatch'), 6, Math.min(3, Math.ceil(Math.max(1, this.opponent().hp) / 2)));
      }
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'holy_light')) {
        add('holy_light', Math.max(this.scoreActivationRaw('holy_light'), this.state.currentPhaseIndex >= 4 ? 3.2 : 1), 2, p.hp <= 7 ? 2 : 1);
      }
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'magic_bullet')) {
        add('magic_bullet', this.scoreActivationRaw('magic_bullet'), 3, Math.min(4, p.magic), 4.6);
      }
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'forest' && !p.forestUsedIndices.includes(i)) && this.hasAnyAttackTarget()) add('forest', this.scoreActivationRaw('forest'), 5);
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'flare' && !p.flareUsedIndices.includes(i)) && this.hasAnyAttackTarget()) add('flare', this.scoreActivationRaw('flare'), 5);
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'reproduction' && !p.reproductionUsedIndices.includes(i)) && this.hasAnyAttackTarget()) add('reproduction', this.scoreActivationRaw('reproduction'), 4);
      if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'charge' && !p.chargeUsedIndices.includes(i)) && this.hasAnyAttackTarget()) add('charge', this.scoreActivationRaw('charge'), 4);
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
    return planned;
  }

  scoreActivation(effectId: string) {
    const raw = this.scoreActivationRaw(effectId);
    const cost = getActivationMagicCost(effectId);
    if (cost <= 0) return raw;
    if ((this.buildMagicPlan()[effectId] || 0) > 0) return raw + 0.35;
    if (this.state.currentPhaseIndex >= 5 && raw >= 3.2 && this.currentPlayer().magic >= cost) {
      return Math.max(2.85, raw * 0.72);
    }
    return Math.min(raw, 2.35);
  }

  private scoreActivationRaw(effectId: string) {
    const p = this.currentPlayer();
    const opp = this.opponent();
    const maxSelfAttack = Math.max(0, ...this.listSelfAttackTargets().map(t => t.val));
    const totalSelfAttack = p.currentAttacks.flat().reduce((a, b) => a + Math.max(0, b), 0);
    const selfAttackCount = this.listSelfAttackTargets().length;
    const thrustTargetCount = p.currentAttacks.flat().filter(v => v > 0 && v <= 2).length;
    const incomingNormal = this.estimateIncomingNormalDamageAfterDefense(p);
    const incomingPiercing = this.estimateIncomingPiercingDamage();
    const hasUnusedThrust = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'thrust' && !p.thrustUsedIndices.includes(i));
    const hasUnusedAmplify = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'amplify' && !p.amplifyUsedIndices.includes(i));
    const hasUnusedForest = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'forest' && !p.forestUsedIndices.includes(i));
    const hasUnusedCharge = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'charge' && !p.chargeUsedIndices.includes(i));
    const hasUnusedReproduction = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'reproduction' && !p.reproductionUsedIndices.includes(i));
    const hasUnusedFlare = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'flare' && !p.flareUsedIndices.includes(i));
    const hasMagicBullet = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'magic_bullet');
    const reserveMagicForFinisher = maxSelfAttack > 0 && (hasUnusedForest || hasUnusedCharge || hasUnusedReproduction || hasUnusedFlare)
      ? (hasUnusedFlare || hasUnusedForest ? 3 : 2)
      : 0;
    const canPreloadMagicBullet = hasMagicBullet && p.magic > reserveMagicForFinisher;

    if (effectId === 'soul_snatch') {
      if (opp.hp <= 1) return 20;
      return 7 + (opp.hp <= 3 ? 4 : 0) + (p.hp <= 4 ? 2.5 : p.hp <= 7 ? 1 : 0);
    }
    if (effectId === 'holy_light') return p.hp <= 4 ? 9 : p.hp <= 7 ? 5.2 : p.hp <= 10 && incomingNormal + incomingPiercing > 0 ? 3.2 : 1.2;
    if (effectId === 'dodge') {
      const strongest = Math.max(0, ...this.listOpponentDodgeTargets().map(t => t.val));
      const prevent = Math.max(0, strongest - p.defense);
      return prevent >= 4 || incomingNormal >= 4 ? 10 + strongest : prevent >= 2 || incomingNormal >= 2 ? 7 + prevent : 1.8;
    }
    if (effectId === 'barrier') return incomingNormal >= 4 ? 9 + incomingNormal : incomingNormal >= 2 ? 6.5 : 1.2;
    if (effectId === 'shield') return incomingNormal >= 2 ? 5.5 + incomingNormal : incomingNormal === 1 && p.hp <= 5 ? 3.5 : 1;
    if (effectId === 'forest') {
      if (canPreloadMagicBullet && p.magic > 3) return 2.6;
      if (hasUnusedThrust && thrustTargetCount > 0) return 2.2;
      if (hasUnusedAmplify && selfAttackCount >= 2) return 2.4;
      return selfAttackCount >= 2 && totalSelfAttack >= 5 ? 9.4 + totalSelfAttack * 0.25 : selfAttackCount >= 2 ? 5.2 : 1.4;
    }
    if (effectId === 'flare') {
      if (canPreloadMagicBullet && p.magic > 3) return 2.7;
      if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.4;
      if (hasUnusedCharge && p.magic >= 5 && maxSelfAttack <= 5) return 2.5;
      return maxSelfAttack >= 5 ? 10 + maxSelfAttack * 0.35 : maxSelfAttack >= 3 ? 7.8 + maxSelfAttack * 0.2 : 2;
    }
    if (effectId === 'charge') {
      if (canPreloadMagicBullet && p.magic > 2) return 2.7;
      if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.5;
      return maxSelfAttack >= 4 ? 8.6 + maxSelfAttack * 0.2 : maxSelfAttack >= 1 ? 6.4 : 1.5;
    }
    if (effectId === 'reproduction') {
      if (canPreloadMagicBullet && p.magic > 2) return 2.7;
      if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.5;
      if (hasUnusedFlare && p.magic >= 5 && maxSelfAttack >= 3) return 2.6;
      return maxSelfAttack >= 5 ? 9.6 + maxSelfAttack * 0.28 : maxSelfAttack >= 2 ? 7.5 + maxSelfAttack * 0.2 : 2.2;
    }
    if (effectId === 'magic_bullet') {
      if (p.magic <= reserveMagicForFinisher && !(hasUnusedThrust && p.magic > 0)) return 1.6;
      return 12 + (hasUnusedThrust ? 4.6 : 0) + (hasUnusedAmplify ? 1.1 : 0)
        + (hasUnusedForest ? 1.1 : 0) + (p.magic > reserveMagicForFinisher + 1 ? 0.7 : 0);
    }
    if (effectId === 'amplify') {
      if (canPreloadMagicBullet && p.magic > reserveMagicForFinisher) return 2.6;
      if (hasUnusedThrust && thrustTargetCount > 0) return 2.4;
      return selfAttackCount >= 2 ? 9.2 + selfAttackCount : selfAttackCount === 1 ? 6.2 : 1;
    }
    if (effectId === 'thrust') return thrustTargetCount >= 2 ? 10 + thrustTargetCount : thrustTargetCount === 1 ? 7.2 : 0;
    if (effectId === 'fate') {
      const counts = this.getAreaDiceCounts();
      const brillianceAlmost = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'brilliance' && counts[i] === 2);
      const shadowBlocked = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'shadow' && counts[i] > 0 && counts[i] <= 2);
      return brillianceAlmost || shadowBlocked ? 8.2 : this.chooseFateDiceIndices().length >= 2 ? 6.5 : 3.4;
    }
    if (effectId === 'magic_luck') {
      const counts = this.getAreaDiceCounts();
      const brillianceAlmost = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'brilliance' && counts[i] === 2);
      const hasBrilliance = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'brilliance');
      const hasShadow = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'shadow');
      return brillianceAlmost ? 8 : hasBrilliance && !hasShadow ? 5.2 : hasShadow ? 1.5 : 3;
    }
    if (effectId === 'frost') {
      const hasShadow = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'shadow');
      if (hasShadow) return 8.6;
      const lowest = this.state.diceResults.length > 0 ? Math.min(...this.state.diceResults.map(v => this.estimateDieValue(v))) : 99;
      return lowest <= 2.5 ? 4.6 : 2.4;
    }
    if (effectId === 'illusion') {
      const target = this.chooseIllusionTargetArea();
      return target >= 0 ? 5 + this.effectWeight(this.opponent().activeAreaEffects[target]?.effectId) : 0;
    }
    return 3;
  }
}

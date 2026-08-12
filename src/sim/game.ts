/*
 * 無頭的對局引擎與既有啟發式 AI。
 *
 * 從 runSimulation.ts 拆出來的原因：那個檔案同時是 CLI 進入點，會用到 node:url
 * 與 process.argv。UI 需要用這個引擎當 AI 的「思考沙盤」，但瀏覽器沒有那些東西。
 * 現在 CLI 的部分留在 runSimulation.ts，這裡只有純邏輯。
 */

import {banditChooseActivation, banditChoosePlayPlan, banditChooseTarget, enumerateDiceSubsets, type BanditConfig, DEFAULT_BANDIT_CONFIG} from './bandit';
import {chooseUniform, randInt, rng} from './rng';

// 與 UI 共用同一份規則型別與純計算（見 src/engine/state.ts）
import {type GameCard, type PlayerState, createPlayer} from '../engine/state';
import {
  buildDeck,
  drawFromDeck,
  getDeckDrawCost,
  getEffectiveEffectId,
  getMarketPrice,
  refillMarket,
  shuffled,
} from '../engine/deck';
import {listActivations} from '../engine/activations';
import {resolveDamagePhase, resolveJudging} from '../engine/resolve';
import {
  applyAmplify,
  applyBarrier,
  applyCharge,
  applyEvasion,
  applyFate,
  applyFlare,
  applyForest,
  applyFrost,
  applyHolyLight,
  applyIllusion,
  applyMagicBullet,
  applyMagicLuck,
  applyReproduction,
  applyShield,
  applySoulSnatch,
  applyThrust,
} from '../engine/effects';
import {AdeptHeuristic} from '../ai/heuristic';
import {averageWinningPlayWeight, chooseWinningPlayPurchasePlan, getWinningPlayWeight} from '../ai/purchase';






export type AttackTarget = {areaIdx: number; hitIdx: number; val: number};
export type Winner = 0 | 1 | 'draw';
export type OpeningMode = 'prep' | 'even' | 'staged';
/*
 * bandit：新的單回合模擬 AI（見 sim/bandit.ts）。
 * 它接管「出牌」「效果發動」與「購買」決策；其餘階段沿用 adept 的啟發式，
 * rollout 內部也一律用 adept 走完 —— 所以除了那兩個決策點，行為與 adept 相同。
 */
export type AiDifficulty = 'normal' | 'adept' | 'expert';
const ILLUSION_UNCOPYABLE_EFFECT_IDS = new Set<string>(['lucky', 'fate', 'frost']);
/*
 * 模擬器內所有亂數都走 sim/rng.ts 的可切換來源，不直接用 rng()。
 * Bandit 的 rollout 會把來源換成固定 seed，才能做到可重現與 Common Random Numbers。
 */

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
  return rng() < 0.9 ? chooseHighestAttackTarget(targets) : chooseUniform(targets);
}

// PlayerState 幾乎全是陣列，淺拷貝會讓 rollout 改到真實對局的狀態。
function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    hand: [...p.hand],
    board: p.board.map(a => [...a]),
    activeAreaEffects: [...p.activeAreaEffects],
    attackQueue: p.attackQueue.map(a => [...a]),
    piercingQueue: p.piercingQueue.map(a => [...a]),
    currentAttacks: p.currentAttacks.map(a => [...a]),
    piercingAttacks: p.piercingAttacks.map(a => [...a]),
    chargeUsedIndices: [...p.chargeUsedIndices],
    amplifyUsedIndices: [...p.amplifyUsedIndices],
    fateUsedIndices: [...p.fateUsedIndices],
    evasionUsedIndices: [...p.evasionUsedIndices],
    reproductionUsedIndices: [...p.reproductionUsedIndices],
    flareUsedIndices: [...p.flareUsedIndices],
    thrustUsedIndices: [...p.thrustUsedIndices],
    barrierUsedIndices: [...p.barrierUsedIndices],
    forestUsedIndices: [...p.forestUsedIndices],
    frostUsedIndices: [...p.frostUsedIndices],
    magicLuckUsedIndices: [...p.magicLuckUsedIndices],
    illusionUsedIndices: [...p.illusionUsedIndices],
    illusionCopiedEffectIds: [...p.illusionCopiedEffectIds],
    extraFrostAttacks: p.extraFrostAttacks.map(a => [...a]),
    turnBaseStats: {
      sums: [...p.turnBaseStats.sums],
      defense: [...p.turnBaseStats.defense],
      magic: [...p.turnBaseStats.magic],
      gold: [...p.turnBaseStats.gold],
    },
  };
}

export class SimulationGame {
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

  /*
   * rollout 模式：這一份是 bandit 用來試打的複製品，不是真實對局。
   * 開著時，adept 啟發式會有 ~15% 機率不選最高分、而是從前三名裡挑一個 ——
   * rollout policy 完全貪心的話，同一個候選每次都走出幾乎一樣的路線，
   * 模擬出來的變異數會低估真實情況。
   */
  rolloutNoise = false;

  /*
   * 這一份是不是 bandit 用來試打的複製品。
   * 用來擋住「選目標也用模擬」在 rollout 內部再次觸發 —— 那會遞迴，複雜度指數爆炸。
   * 複製品一律走啟發式，和效果發動的分工一致。
   */
  isRolloutSandbox = false;

  /** 真實對局中的專家：這幾張卡的目標值得用模擬挑 */
  private expertPicksTargets() {
    return this.currentAiDifficulty() === 'expert'
      && !this.isRolloutSandbox
      && this.currentBanditConfig().simulateTargets;
  }

  /*
   * 每個座位各自的 bandit 設定。
   * 兩邊可以不同，才能讓「高預算」與「低預算」直接對打 ——
   * 都拿去打 adept 的話，雙方勝率都逼近天花板，量不出彼此的差距。
   */
  banditConfigs: [BanditConfig, BanditConfig] = [DEFAULT_BANDIT_CONFIG, DEFAULT_BANDIT_CONFIG];

  private currentBanditConfig() {
    return this.banditConfigs[this.currentPlayerIndex];
  }

  constructor(
    private readonly initialHp: number,
    private readonly maxTurns: number,
    private readonly openingMode: OpeningMode,
    private readonly aiDifficulties: [AiDifficulty, AiDifficulty],
    skipInit = false,
  ) {
    this.players = [createPlayer('First', initialHp), createPlayer('Second', initialHp)];
    if (!skipInit) this.initGame();
  }

  /*
   * 從外部（UI）的局面做一份「思考沙盤」。
   *
   * UI 有自己的 GameState 與畫面綁定，不可能拿去跑幾百次 rollout。
   * 這裡把它的局面複製進一個無頭引擎，讓 bandit 在裡面試打；
   * 所有玩家狀態都深拷貝，沙盤怎麼改都不會碰到真實對局。
   */
  static forThinking(init: {
    deck: GameCard[];
    market: Array<GameCard | null>;
    players: [PlayerState, PlayerState];
    currentPlayerIndex: 0 | 1;
    currentPhaseIndex: number;
    diceResults: number[];
    firstPlayerFirstTurn: boolean;
    buyDeckDrawCount: number;
  }): SimulationGame {
    const g = new SimulationGame(12, 500, 'prep', ['expert', 'expert'], true);
    g.deck = [...init.deck];
    g.market = [...init.market];
    g.players = [clonePlayer(init.players[0]), clonePlayer(init.players[1])];
    g.currentPlayerIndex = init.currentPlayerIndex;
    g.currentPhaseIndex = init.currentPhaseIndex;
    g.diceResults = [...init.diceResults];
    g.firstPlayerFirstTurn = init.firstPlayerFirstTurn;
    g.buyDeckDrawCount = init.buyDeckDrawCount;
    return g;
  }

  usesAdeptHeuristics() {
    return this.currentAiDifficulty() !== 'normal';
  }

  /*
   * 從一堆已評分的選項中挑一個。
   * 正式對局：取最高分（同分隨機）。rollout：85% 取最高分，15% 從前三名抽。
   */
  pickScored<T extends {score: number}>(items: T[]): T {
    if (items.length === 0) throw new Error('pickScored: empty');
    const sorted = [...items].sort((a, b) => b.score - a.score);
    if (this.rolloutNoise && sorted.length > 1 && rng() < 0.15) {
      return chooseUniform(sorted.slice(0, Math.min(3, sorted.length)));
    }
    const maxScore = sorted[0].score;
    return chooseUniform(sorted.filter(x => x.score === maxScore));
  }

  /*
   * 複製出一份可以隨便亂試的對局狀態。
   *
   * 牌庫會被重新洗過：剩下有哪些牌是公開資訊（總卡表扣掉看得見的），
   * 但「順序」不是 —— 直接沿用真實順序等於讓 AI 偷看下一張抽到什麼。
   */
  cloneForRollout(): SimulationGame {
    const clone = new SimulationGame(
      this.initialHp, this.maxTurns, this.openingMode, this.aiDifficulties, true,
    );
    clone.deck = shuffled(this.deck, rng);
    clone.market = [...this.market];
    clone.players = [clonePlayer(this.players[0]), clonePlayer(this.players[1])];
    clone.currentPlayerIndex = this.currentPlayerIndex;
    clone.currentPhaseIndex = this.currentPhaseIndex;
    clone.diceResults = [...this.diceResults];
    clone.firstPlayerFirstTurn = this.firstPlayerFirstTurn;
    clone.winner = this.winner;
    clone.buyDeckDrawCount = this.buyDeckDrawCount;
    clone.skippedPlayBecauseNoHand = this.skippedPlayBecauseNoHand;
    clone.turnCount = this.turnCount;
    clone.rolloutNoise = true;
    clone.isRolloutSandbox = true;
    return clone;
  }

  /*
   * 從目前所在的階段一路跑到回合結束（但不呼叫 endTurn —— 那會把魔力金幣清成 0，
   * 而我們正要評估的就是這回合產出了什麼）。
   * 這段必須和 runAiTurn 的階段順序完全一致，否則模擬的就不是真的那個遊戲。
   */
  finishTurnForRollout(skipActivations = false, skipPhase = -1) {
    // skipActivations：bandit 選了 STOP，該階段不應該再由 adept 補發動
    const runPhase = (phase: number) => {
      if (skipActivations && phase === skipPhase) this.currentPhaseIndex = phase;
      else this.aiActivationLoop(phase);
    };

    if (this.currentPhaseIndex <= 1) {
      this.currentPhaseIndex = 1;
      if (this.diceResults.length === 0) this.aiRollPhase();
      runPhase(1);
      this.nextPhase();
    }
    if (this.currentPhaseIndex === 2) { runPhase(2); this.nextPhase(); }
    if (this.currentPhaseIndex === 3) { runPhase(3); this.nextPhase(); }
    if (this.currentPhaseIndex === 4) { runPhase(4); this.nextPhase(); }
    if (this.winner !== null) return;
    if (this.currentPhaseIndex === 5) { runPhase(5); this.nextPhase(); }
    if (this.currentPhaseIndex === 6) this.aiBuyPhase();
  }

  playCardPublic(handIdx: number, areaIdx: number) {
    this.playCard(handIdx, areaIdx);
  }

  handleJudgingPublic() {
    this.handleJudging();
  }

  // 給外部（UI）的 apply callback 用：它要在沙盤上重現真實套用的那幾行
  currentPlayerPublic() {
    return this.currentPlayer();
  }

  opponentPublic() {
    return this.opponent();
  }

  availableActivationsPublic() {
    return this.availableActivations();
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
    this.deck = shuffled(buildDeck(), rng);

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
      if (this.usesAdeptHeuristics()) {
        const choice = this.chooseAdeptPlay();
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

    const isExpert = this.currentAiDifficulty() === 'expert';
    if (isExpert) this.banditPlayPhase();
    else this.aiPlayPhase();
    if (this.winner !== null) return;

    this.aiRollPhase();
    const activations = (phase: number) =>
      isExpert ? this.banditActivationLoop(phase) : this.aiActivationLoop(phase);

    activations(1);
    this.nextPhase();

    activations(2);
    this.nextPhase();

    activations(3);
    this.nextPhase();

    activations(4);
    this.nextPhase();
    if (this.winner !== null) return;

    activations(5);
    this.nextPhase();

    this.aiBuyPhase();
    this.endTurn();
  }

  /*
   * 出牌：把「打幾張、哪幾張、放哪一區」當成一個完整方案來比較。
   * 擲骰數是 5 - 出牌數，由出牌數固定，所以不是額外的決策點。
   */
  private banditPlayPhase() {
    this.currentPhaseIndex = 0;
    const p = this.currentPlayer();
    if (p.hand.length === 0) {
      this.skippedPlayBecauseNoHand = true;
      this.currentPhaseIndex = 1;
      return;
    }
    const plan = banditChoosePlayPlan(this, this.currentBanditConfig());
    if (plan) {
      for (const step of plan) {
        const handIdx = p.hand.findIndex(c => c.id === step.cardId);
        if (handIdx !== -1) this.playCard(handIdx, step.areaIdx);
      }
    }
    this.currentPhaseIndex = 1;
  }

  /*
   * 效果發動：每次只決定「下一個原子行動」，做完重新搜。
   * 上限 200 是防呆 —— 可重複發動的效果（護盾、魔彈）魔力耗盡就會自然停。
   */
  private banditActivationLoop(phase: number) {
    this.currentPhaseIndex = phase;
    for (let i = 0; i < 200 && this.winner === null; i++) {
      const acts = this.availableActivations();
      if (acts.length === 0) return;
      const choice = banditChooseActivation(this, phase, this.currentBanditConfig());
      if (choice === 'STOP') return;
      acts.find(a => a.effectId === choice.effectId && a.areaIdx === choice.areaIdx)?.run();
      this.currentPhaseIndex = phase;
    }
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

  private adeptHeuristic() {
    return new AdeptHeuristic({
      players: this.players,
      currentPlayerIndex: this.currentPlayerIndex,
      currentPhaseIndex: this.currentPhaseIndex,
      diceResults: this.diceResults,
    }, rng);
  }

  private chooseLowestValueDieIndex() {
    return this.adeptHeuristic().chooseLowestValueDieIndex();
  }

  private chooseAdeptFateDiceIndices() {
    return this.adeptHeuristic().chooseFateDiceIndices();
  }

  private chooseAdeptFrostDieIndex() {
    return this.adeptHeuristic().chooseFrostDieIndex();
  }

  private chooseAdeptIllusionTargetArea() {
    return this.adeptHeuristic().chooseIllusionTargetArea();
  }

  private scoreCardForAdept(card: GameCard, areaIdx = -1) {
    return this.adeptHeuristic().scoreCard(card, areaIdx);
  }

  private chooseAdeptPlay() {
    return this.adeptHeuristic().choosePlay();
  }

  private chooseAdeptPlayCount() {
    return this.adeptHeuristic().choosePlayCount();
  }

  private chooseAdeptRollCount(rollOptions: number[]) {
    return this.adeptHeuristic().chooseRollCount(rollOptions);
  }

  private scoreActivationForAdept(effectId: string) {
    return this.adeptHeuristic().scoreActivation(effectId);
  }

  private aiPlayPhase() {
    if (this.usesAdeptHeuristics()) {
      return this.adeptPlayPhase();
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

  private adeptPlayPhase() {
    this.currentPhaseIndex = 0;
    const p = this.currentPlayer();
    if (p.hand.length === 0) {
      this.skippedPlayBecauseNoHand = true;
      this.currentPhaseIndex = 1;
      return;
    }

    const maxPlays = Math.min(3, p.hand.length);
    const playCount = Math.min(maxPlays, Math.max(1, this.chooseAdeptPlayCount()));
    for (let i = 0; i < playCount && p.hand.length > 0; i++) {
      const choice = this.chooseAdeptPlay();
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
    const count = this.usesAdeptHeuristics() ? this.chooseAdeptRollCount(rollOptions) : chooseUniform(rollOptions);
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
      const idx = this.expertPicksTargets()
        ? banditChooseTarget(
            this,
            this.diceResults.map((_, i) => i),
            (clone, i) => clone.diceResults.splice(i, 1),
            this.currentBanditConfig().targetBudget,
          )
        : this.usesAdeptHeuristics()
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

  // 判定的規則本體在 engine/resolve.ts，與 UI 共用同一份
  private handleJudging() {
    resolveJudging(this.currentPlayer(), this.currentPlayerIndex as 0 | 1, this.diceResults);
  }

  // 傷害結算的規則本體在 engine/resolve.ts，與 UI 共用同一份
  private handleDamagePhase() {
    // 先手第一回合不會受到攻擊（對手還沒行動過）
    if (this.currentPlayerIndex === 0 && this.firstPlayerFirstTurn) return;

    const {defeated} = resolveDamagePhase(this.currentPlayer(), this.opponent());
    if (defeated) this.winner = this.opponentIndex();
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
      if (this.usesAdeptHeuristics()) {
        const scored = acts
          .map(act => ({act, score: this.scoreActivationForAdept(act.effectId) + rng() * 0.1}))
          .filter(x => x.score >= 2.75);
        if (scored.length === 0) return;
        this.pickScored(scored).act.run();
      } else {
        if (rng() > 0.9) return;
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
  private availableActivations(): Array<{effectId: string; areaIdx: number; label: string; run: () => void}> {
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
      effectId,
      areaIdx,
      label: effectId,
      run: () => runners[effectId]?.(areaIdx),
    }));
  }

  private useFate(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.fateUsedIndices.includes(areaIdx) || this.diceResults.length === 0) return;
    let indices: number[];
    if (this.expertPicksTargets()) {
      // 重擲哪些骰子交給模擬決定；apply 必須和下面真實套用的兩行一致
      indices = banditChooseTarget(
        this,
        enumerateDiceSubsets(this.diceResults.length),
        (clone, subset) => {
          applyFate(clone.currentPlayer(), areaIdx, clone.diceResults, subset, rng);
          if (clone.currentPhaseIndex === 2) clone.handleJudgingPublic();
        },
        this.currentBanditConfig().targetBudget,
        this.currentBanditConfig().fateLadder,
      );
    } else if (this.usesAdeptHeuristics()) {
      indices = this.chooseAdeptFateDiceIndices();
    } else {
      const n = this.diceResults.length;
      const k = randInt(1, n);
      indices = Array.from({length: n}, (_, i) => i);
      shuffleInPlace(indices);
      indices = indices.slice(0, k);
    }
    applyFate(p, areaIdx, this.diceResults, indices, rng);
    if (this.currentPhaseIndex === 2) this.handleJudging();
  }

  private useFrost(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.frostUsedIndices.includes(areaIdx) || this.diceResults.length === 0) return;
    const dieIdx = this.expertPicksTargets()
      ? banditChooseTarget(
          this,
          this.diceResults.map((_, i) => i),
          (clone, i) => applyFrost(clone.currentPlayer(), areaIdx, clone.diceResults, i, rng),
          this.currentBanditConfig().targetBudget,
        )
      : this.usesAdeptHeuristics()
        ? this.chooseAdeptFrostDieIndex()
        : randInt(0, this.diceResults.length - 1);
    applyFrost(p, areaIdx, this.diceResults, dieIdx, rng);
  }

  private useMagicLuck(areaIdx: number) {
    if (applyMagicLuck(this.currentPlayer(), areaIdx, this.diceResults, rng) === null) return;
    // 多了一顆骰子，判定要整個重算（疾風、暗影、光輝都看骰子數）
    this.handleJudging();
  }

  private useIllusion(areaIdx: number) {
    const p = this.currentPlayer();
    const candidates: number[] = [];
    this.opponent().activeAreaEffects.forEach((c, idx) => {
      if (c && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId)) candidates.push(idx);
    });
    if (p.magic < 1 || candidates.length === 0) return;
    const oppAreaIdx = this.expertPicksTargets()
      ? banditChooseTarget(
          this,
          candidates,
          (clone, idx) => {
            const card = clone.opponent().activeAreaEffects[idx];
            if (card && applyIllusion(clone.currentPlayer(), areaIdx, card)) clone.handleJudgingPublic();
          },
          this.currentBanditConfig().targetBudget,
        )
      : this.usesAdeptHeuristics()
        ? this.chooseAdeptIllusionTargetArea()
        : chooseUniform(candidates);
    const targetCard = this.opponent().activeAreaEffects[oppAreaIdx];
    if (!targetCard) return;
    if (!applyIllusion(p, areaIdx, targetCard)) return;
    this.handleJudging();
  }

  private useEvasion(areaIdx: number) {
    const p = this.currentPlayer();
    const opp = this.opponent();
    const targets = this.listOpponentDodgeTargets();
    if (p.magic < 3 || targets.length === 0) return;
    const target = this.usesAdeptHeuristics()
      ? chooseHighestAttackTarget(targets)
      : chooseAiWeightedAttackTarget(targets);
    applyEvasion(p, opp, areaIdx, target.areaIdx, target.hitIdx);
  }

  private useShield(_areaIdx: number) {
    applyShield(this.currentPlayer());
  }

  private useBarrier(areaIdx: number) {
    applyBarrier(this.currentPlayer(), areaIdx);
  }

  private useAmplify(areaIdx: number) {
    applyAmplify(this.currentPlayer(), areaIdx);
  }

  private useMagicBullet(areaIdx: number) {
    applyMagicBullet(this.currentPlayer(), areaIdx);
  }

  private useThrust(areaIdx: number) {
    applyThrust(this.currentPlayer(), areaIdx);
  }

  private useForest(areaIdx: number) {
    applyForest(this.currentPlayer(), areaIdx);
  }

  private useCharge(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.chargeUsedIndices.includes(areaIdx) || p.magic < 2) return;
    const targets = this.listSelfAttackTargets();
    if (targets.length === 0) return;
    const target = this.usesAdeptHeuristics()
      ? chooseHighestAttackTarget(targets)
      : chooseAiWeightedAttackTarget(targets);
    applyCharge(p, areaIdx, target.areaIdx, target.hitIdx);
  }

  private useReproduction(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.reproductionUsedIndices.includes(areaIdx) || p.magic < 2) return;
    const targets = this.listSelfAttackTargets();
    if (targets.length === 0) return;
    const target = this.usesAdeptHeuristics()
      ? chooseHighestAttackTarget(targets)
      : chooseAiWeightedAttackTarget(targets);
    applyReproduction(p, areaIdx, target.areaIdx, target.hitIdx);
  }

  private useFlare(areaIdx: number) {
    const p = this.currentPlayer();
    if (p.flareUsedIndices.includes(areaIdx) || p.magic < 3) return;
    const targets = this.listSelfAttackTargets();
    if (targets.length === 0) return;
    const target = this.usesAdeptHeuristics()
      ? chooseHighestAttackTarget(targets)
      : chooseAiWeightedAttackTarget(targets);
    applyFlare(p, areaIdx, target.areaIdx, target.hitIdx);
  }

  private useHolyLight(_areaIdx: number) {
    applyHolyLight(this.currentPlayer(), this.currentPhaseIndex === 2);
  }

  private useSoulSnatch(_areaIdx: number) {
    const opp = this.opponent();
    if (!applySoulSnatch(this.currentPlayer(), opp, this.currentPhaseIndex === 2)) return;
    if (opp.hp <= 0) this.winner = this.currentPlayerIndex;
  }

  private aiBuyPhase() {
    // 專家（bandit）使用勝局出牌率的完整購買方案；高手／一般維持原本邏輯。
    if (this.currentAiDifficulty() === 'expert') {
      this.aiBuyPhaseWinningPlay();
      return;
    }

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
score: this.usesAdeptHeuristics() ? 5.8 - nextDrawCost * 1.1 + rng() * 0.1 : rng(),
run: () => this.buyFromDeck(),
        });
      }
      ([0, 1, 2] as const).forEach(idx => {
        const c = this.market[idx];
        const price = this.marketPrice(idx);
        if (c && p.gold >= price) {
actions.push({
  score: this.usesAdeptHeuristics()
    ? this.scoreCardForAdept(c) - price * 1.35 + rng() * 0.1
    : rng(),
  run: () => this.buyMarketCard(idx),
});
        }
      });
      if (actions.length === 0) return;
      if (this.usesAdeptHeuristics()) {
        this.pickScored(actions).run();
      } else {
        chooseUniform(actions).run();
      }
    }
  }

  private aiBuyPhaseWinningPlay() {
    this.currentPhaseIndex = 6;

    // Rollout 不能知道任何盲抽的實際身分（包含免費抽牌）。
    // 因此在抽免費牌之前凍結平均值，整個 rollout 購買階段只使用這個期望值。
    const rolloutDeckAverage = this.isRolloutSandbox
      ? averageWinningPlayWeight(this.deck)
      : undefined;

    // 第 1 張牌庫牌永遠免費且必抽。
    if (this.deck.length > 0 && this.buyDeckDrawCount < 1) {
      this.buyFromDeck();
    }

    const choosePlan = () => chooseWinningPlayPurchasePlan({
      gold: this.currentPlayer().gold,
      buyDeckDrawCount: this.buyDeckDrawCount,
      deck: this.deck,
      market: this.market,
      deckDrawCost: drawIndex => this.deckDrawCost(drawIndex),
      marketPrice: slotIdx => this.marketPrice(slotIdx),
      random: rng,
      deckAverageOverride: rolloutDeckAverage,
    });

    // Rollout：只依盲抽前可知資訊規劃一次，之後整套執行到底。
    // 模擬中真正抽到哪張牌，不得觸發重新評估。
    if (this.isRolloutSandbox) {
      const plan = choosePlan();
      if (!plan) return;
      for (let i = 0; i < plan.deckDraws; i++) this.buyFromDeck();
      for (const slot of plan.marketSlots) {
        if (this.market[slot]) this.buyMarketCard(slot);
      }
      return;
    }

    // 真實專家：每完成一次購買都重新規劃。
    // 尤其盲抽後已經知道抽到什麼，因此剩餘牌庫平均值會隨之更新。
    for (let step = 0; step < 20; step++) {
      const plan = choosePlan();
      if (!plan) return;

      // 若最佳方案包含盲抽，先抽 1 張；看到結果後下一輪重新評估。
      if (plan.deckDraws > 0) {
        this.buyFromDeck();
        continue;
      }

      // 沒有盲抽時，從最佳方案中先買權重最高的公開市場牌，再重新評估。
      const availableSlots = plan.marketSlots.filter(slot => this.market[slot] != null);
      if (availableSlots.length === 0) return;
      const maxWeight = Math.max(...availableSlots.map(slot => getWinningPlayWeight(this.market[slot])));
      const bestSlots = availableSlots.filter(
        slot => Math.abs(getWinningPlayWeight(this.market[slot]) - maxWeight) < 1e-12,
      );
      this.buyMarketCard(chooseUniform(bestSlots));
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

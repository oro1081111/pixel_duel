from pathlib import Path

# Experimental-only patch. This branch is not production code.

bandit = Path('src/sim/bandit.ts')
b = bandit.read_text()
needle = "export function banditChoosePlayPlan(\n"
insert = r'''/* EXPERIMENT: group preparation by the real first step instead of 1152 full hypothetical plans. */
export function banditChooseGroupedPreparationPlay(
    game: SimulationGame,
    cfg: BanditConfig = DEFAULT_BANDIT_CONFIG,
    samplesPerArm = 40,
): PlayStep | null {
    const myIdx = game.currentPlayerIndex;
    const hand = game.players[myIdx].hand;
    if (hand.length === 0) return null;

    const arms: PlayStep[] = [];
    for (const card of hand) {
        for (let areaIdx = 0; areaIdx < 3; areaIdx++) arms.push({cardId: card.id, areaIdx});
    }

    const seedBase = Math.floor(rng() * 1e9);
    const entries = arms.map(arm => ({arm, stats: newStats()}));
    for (let j = 0; j < samplesPerArm; j++) {
        const seed = seedBase + j;
        for (const entry of entries) {
            const outcome = withRng(makeRng(seed), () => {
                const clone = game.cloneForRollout();
                applyPlan(clone, [entry.arm]);
                clone.playAdeptFutureForPreparationPublic();
                clone.finishTurnForRollout();
                return evaluateTurnOutcome(clone, myIdx);
            });
            record(entry.stats, outcome);
        }
    }

    entries.sort((x, y) => compareArms(y.stats, x.stats));
    return entries[0].arm;
}

'''
if needle not in b:
    raise SystemExit('bandit insertion point not found')
b = b.replace(needle, insert + needle, 1)
bandit.write_text(b)

game = Path('src/sim/game.ts')
g = game.read_text()
g = g.replace(
    "import {banditChooseActivation, banditChoosePlayPlan, banditChooseTarget, enumerateDiceSubsets, type BanditConfig, DEFAULT_BANDIT_CONFIG} from './bandit';",
    "import {banditChooseActivation, banditChooseGroupedPreparationPlay, banditChoosePlayPlan, banditChooseTarget, enumerateDiceSubsets, type BanditConfig, DEFAULT_BANDIT_CONFIG} from './bandit';",
    1,
)
prop_needle = "  turnCount = 0;\n"
if prop_needle not in g:
    raise SystemExit('property insertion point not found')
g = g.replace(prop_needle, prop_needle + "  preparationPolicy: 'baseline' | 'grouped' = 'baseline';\n", 1)
old_prep = '''  private preparationPhase() {
    this.currentPlayerIndex = 1;
    this.currentPhaseIndex = 0;
    this.playRandomCardsForCurrentPlayer(1);
    this.currentPlayer().cardsPlayedThisTurn = 0;
    this.currentPlayerIndex = 0;
    this.currentPhaseIndex = 0;
  }
'''
new_prep = '''  private preparationPhase() {
    this.currentPlayerIndex = 1;
    this.currentPhaseIndex = 0;
    if (this.currentAiDifficulty() === 'expert' && this.preparationPolicy === 'grouped') {
      const choice = banditChooseGroupedPreparationPlay(this, this.currentBanditConfig());
      if (choice) {
        const handIdx = this.currentPlayer().hand.findIndex(c => c.id === choice.cardId);
        if (handIdx !== -1) this.playCard(handIdx, choice.areaIdx);
      }
    } else {
      this.playRandomCardsForCurrentPlayer(1);
    }
    this.currentPlayer().cardsPlayedThisTurn = 0;
    this.currentPlayerIndex = 0;
    this.currentPhaseIndex = 0;
  }
'''
if old_prep not in g:
    raise SystemExit('preparationPhase block not found')
g = g.replace(old_prep, new_prep, 1)
method_needle = "  private runAiTurn() {\n"
public_method = '''  /** Experimental helper: keep the preparation card, reset turn counters, then let the existing adept rollout policy plan the hypothetical future play phase. */
  playAdeptFutureForPreparationPublic() {
    beginTurnState(this);
    this.adeptPlayPhase();
  }

'''
if method_needle not in g:
    raise SystemExit('method insertion point not found')
g = g.replace(method_needle, public_method + method_needle, 1)
game.write_text(g)

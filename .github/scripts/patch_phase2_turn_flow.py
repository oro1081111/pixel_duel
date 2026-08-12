from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'{label} not found')
    return text.replace(old, new, 1)


# --- src/main.ts ---
path = Path('src/main.ts')
s = path.read_text()

s = replace_once(
    s,
    "import {getBaseBarImg} from './basebars';",
    "import {advanceTurnPhase, getTurnAdvanceBlockReason, type TurnAdvanceBlockReason} from './engine/turnFlow';\nimport {getBaseBarImg} from './basebars';",
    'main turnFlow import',
)
s = s.replace('// --- Computer AI (uniform random) ---', '// --- Computer AI ---', 1)

pattern = re.compile(
    r"function getActionBlockReason\(\): string \| null \{.*?\n\}\n\nfunction nextPhase\(\) \{.*?\n\}\n\nfunction isMirageActive\(\)",
    re.S,
)
replacement = r'''function getTurnAdvanceBlockText(reason: TurnAdvanceBlockReason | null): string | null {
    if (reason === 'must-play-card') return '至少出 1 張';
    if (reason === 'must-roll-dice') return '必須先擲骰';
    if (reason === 'must-take-free-deck-card') return '先抽免費牌，再買';
    return null;
}

function getActionBlockReason(): string | null {
    // 準備階段的「開始」有自己的啟用條件（後手出滿 1 張），
    // 這裡不要插手，否則會顯示錯的原因。
    if (S.inPreparationPhase) return null;
    if (S.luckySelectionMode) return '幸運之石：移除1骰';
    return getTurnAdvanceBlockText(getTurnAdvanceBlockReason(S));
}

function resetUiTurnSelectionModes() {
    S.fateSelectionMode = false;
    S.fateSelectedDiceIndices = [];
    S.fateSourceAreaIdx = -1;
    S.evasionSelectionMode = false;
    S.evasionSourceAreaIdx = -1;
    S.chargeSelectionMode = false;
    S.chargeSourceAreaIdx = -1;
    S.reproductionSelectionMode = false;
    S.reproductionSourceAreaIdx = -1;
    S.flareSelectionMode = false;
    S.flareSourceAreaIdx = -1;
    S.frostSelectionMode = false;
    S.frostSourceAreaIdx = -1;
}

function nextPhase() {
    const now = Date.now();
    if (now < phaseAdvanceLockUntil) return;
    phaseAdvanceLockUntil = now + 250;

    if (S.winner) return;
    if (S.luckySelectionMode) return;

    const transition = advanceTurnPhase(S);
    if (!transition.advanced) {
        S.phaseHint = getTurnAdvanceBlockText(transition.blockReason) || S.phaseHint;
        render();
        return;
    }

    if (transition.effect === 'roll-start') {
        // 手機版 UX：離開出牌階段就先收起手牌抽屜。
        handDrawerOpen = false;
        S.phaseHint = S.skippedPlayBecauseNoHand
            ? '沒有手牌，直接進行擲骰'
            : '請擲骰';
    } else if (transition.effect === 'judging') {
        S.phaseHint = '數值判定中';
        handleJudging();
    } else if (transition.effect === 'defense-start') {
        S.phaseHint = S.currentPlayerIndex === 0 && S.firstPlayerFirstTurn
            ? '先手首回合跳過'
            : '防禦對手攻擊';
        handleDefensePhaseStart();
    } else if (transition.effect === 'damage') {
        S.phaseHint = S.currentPlayerIndex === 0 && S.firstPlayerFirstTurn
            ? '先手首回合跳過'
            : '結算傷害';
        handleDamagePhase();
    } else if (transition.effect === 'attack-start') {
        S.phaseHint = '攻擊效果發動';
        handleAttackPhaseStart();
    } else if (transition.effect === 'buy-start') {
        // 提示由 handleBuyPhase 依牌庫狀態決定。
        handleBuyPhase();
    } else if (transition.effect === 'turn-start') {
        S.phaseHint = S.players[S.currentPlayerIndex].hand.length === 0
            ? '沒有手牌，直接進行擲骰'
            : '選牌出牌';
        // Mobile：進入出牌階段時手牌抽屜自動彈出，並切回手牌。
        mobileDockTab = 'hand';
        handDrawerOpen = isMobileLayout();
        resetUiTurnSelectionModes();
    }

    render();
}

function isMirageActive()'''
s2, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'main turn flow replacement count={count}')
s = s2
path.write_text(s)


# --- src/sim/game.ts ---
path = Path('src/sim/game.ts')
s = path.read_text()

s = replace_once(
    s,
    "import {AdeptHeuristic} from '../ai/heuristic';",
    "import {AdeptHeuristic} from '../ai/heuristic';\nimport {advanceTurnPhase, beginTurnState} from '../engine/turnFlow';",
    'sim turnFlow import',
)

# Replace rollout-only phase sequence with one shared SimulationGame runner.
pattern = re.compile(
    r"  /\*\n   \* 從目前所在的階段一路跑到回合結束.*?\n  finishTurnForRollout\(skipActivations = false, skipPhase = -1\) \{.*?\n  \}\n\n  playCardPublic",
    re.S,
)
replacement = r'''  /*
   * 正式模擬與 rollout 共用同一段「擲骰後一路跑到購買」流程。
   * 差別只在 activatePhase：正式 expert 用 bandit，rollout 用 adept，避免巢狀 rollout。
   */
  private runPostPlayTurn(
    activatePhase: (phase: number) => void,
    {endTurn = false}: {endTurn?: boolean} = {},
  ) {
    if (this.currentPhaseIndex <= 1) {
      this.currentPhaseIndex = 1;
      if (this.diceResults.length === 0) this.aiRollPhase();
      activatePhase(1);
      this.nextPhase();
    }
    if (this.currentPhaseIndex === 2) { activatePhase(2); this.nextPhase(); }
    if (this.currentPhaseIndex === 3) { activatePhase(3); this.nextPhase(); }
    if (this.winner !== null) return;
    if (this.currentPhaseIndex === 4) { activatePhase(4); this.nextPhase(); }
    if (this.winner !== null) return;
    if (this.currentPhaseIndex === 5) { activatePhase(5); this.nextPhase(); }
    if (this.currentPhaseIndex === 6) {
      this.aiBuyPhase();
      if (endTurn) this.endTurn();
    }
  }

  finishTurnForRollout(skipActivations = false, skipPhase = -1) {
    // bandit 選了 STOP 時，該階段不再由 adept 補發動；其餘後續仍走同一個共用 runner。
    const activatePhase = (phase: number) => {
      if (skipActivations && phase === skipPhase) this.currentPhaseIndex = phase;
      else this.aiActivationLoop(phase);
    };
    this.runPostPlayTurn(activatePhase);
  }

  playCardPublic'''
s2, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'rollout runner replacement count={count}')
s = s2

# Replace runAiTurn with the same shared post-play runner.
pattern = re.compile(r"  private runAiTurn\(\) \{.*?\n  \}\n\n  /\*\n   \* 出牌：", re.S)
replacement = r'''  private runAiTurn() {
    this.turnCount++;
    beginTurnState(this);

    const isExpert = this.currentAiDifficulty() === 'expert';
    if (isExpert) this.banditPlayPhase();
    else this.aiPlayPhase();
    if (this.winner !== null) return;

    const activatePhase = (phase: number) => {
      if (isExpert) this.banditActivationLoop(phase);
      else this.aiActivationLoop(phase);
    };
    this.runPostPlayTurn(activatePhase, {endTurn: true});
  }

  /*
   * 出牌：'''
s2, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'runAiTurn replacement count={count}')
s = s2

# Remove the duplicated turn-state reset method; beginTurnState is now the single source.
pattern = re.compile(r"  private resetTurnState\(p: PlayerState\) \{.*?\n  \}\n\n  private adeptHeuristic", re.S)
s2, count = pattern.subn("  private adeptHeuristic", s, count=1)
if count != 1:
    raise SystemExit(f'resetTurnState removal count={count}')
s = s2

# Replace phase mutation with the shared turn-flow primitive and keep only resolution hooks here.
pattern = re.compile(r"  private nextPhase\(\) \{.*?\n  \}\n\n  // 判定的規則本體", re.S)
replacement = r'''  private nextPhase() {
    if (this.winner !== null) return;
    const transition = advanceTurnPhase(this);
    if (!transition.advanced) return;
    if (transition.effect === 'judging') this.handleJudging();
    else if (transition.effect === 'damage') this.handleDamagePhase();
  }

  // 判定的規則本體'''
s2, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'sim nextPhase replacement count={count}')
s = s2

# End turn also goes through the shared phase-6 guard and lifecycle transition.
pattern = re.compile(r"  private endTurn\(\) \{.*?\n  \}\n\}", re.S)
replacement = r'''  private endTurn() {
    const transition = advanceTurnPhase(this);
    if (!transition.advanced) {
      throw new Error(`endTurn blocked: ${transition.blockReason}`);
    }
    if (transition.effect !== 'turn-start') {
      throw new Error(`endTurn called outside buy phase: ${transition.effect}`);
    }
  }
}'''
s2, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'endTurn replacement count={count}')
s = s2
path.write_text(s)


# --- state.ts comment: phase-two status is no longer "first step" only ---
path = Path('src/engine/state.ts')
s = path.read_text()
s = s.replace(
    "這個模組是把規則收斂成單一來源的\n * 第一步：先共用型別與不依賴任何全域狀態的純計算，之後再逐步搬入其餘規則。",
    "規則已逐步收斂到 engine/：型別與純計算在這裡，回合生命週期與階段轉移在\n * turnFlow.ts；UI 與模擬器不再各自手抄核心流程。",
    1,
)
path.write_text(s)

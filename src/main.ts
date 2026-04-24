/**
 * 像素對決 Pixel Duel MVP
 * Vanilla JavaScript Implementation
 */

import './index.css';

import {CARD_DEFS, EFFECTS, type CardAttr} from './cards';

// --- Constants & Data ---

type GameCard = {
  id: string; // card_0/card_1...
  left: CardAttr;
  right: CardAttr;
  effectId: string;
  effectName: string;
  effectDesc: string;
  name: string; // 顯示用（依需求：只顯示效果名）
};

function getCardFrameStyleVars(size: 'board' | 'hand' | 'market') {
    if (size === 'hand') {
        return '--card-w: 60px; --card-h: 85px; --header-h: 22px; --chip: 15px; --chip-font: 7px; --title-font: 9px;';
    }
    if (size === 'market') {
        // 市場區：目前先跟手牌尺寸相同，之後可獨立微調。
        return '--card-w: 60px; --card-h: 85px; --header-h: 22px; --chip: 15px; --chip-font: 7px; --title-font: 9px;';
    }
    // board
    return '--card-w: 70px; --card-h: 90px; --header-h: 22px; --chip: 15px; --chip-font: 8px; --title-font: 11px;';
}

function renderCardContentHTML(card, typeColors, {showTooltip}: {showTooltip: boolean}) {
    // Tooltip 改為「portal」(掛到 body 的 fixed 浮層) 顯示，避免被任何 overflow 容器裁切。
    // 這裡只渲染卡面本體。
    void showTooltip;
    return `
        <div class="card-frame-header">
            <div class="card-frame-chip ${typeColors[card.left.type]}">${card.left.value}</div>
            <div class="card-frame-chip ${typeColors[card.right.type]}">${card.right.value}</div>
        </div>
        <div class="flex-1 flex items-center justify-center">
            <div class="card-frame-title">${card.effectName}</div>
        </div>
    `;
}

function ensureGlobalTooltipEl() {
    let el = document.getElementById('global-tooltip');
    if (el) return el as HTMLDivElement;

    el = document.createElement('div');
    el.id = 'global-tooltip';
    // 使用 fixed + 超高 z-index，確保永遠在最上層，且不吃滑鼠事件。
    el.className = 'fixed left-0 top-0 z-[5000] pointer-events-none hidden';
    document.body.appendChild(el);
    return el as HTMLDivElement;
}

function hideGlobalTooltip() {
    const el = document.getElementById('global-tooltip');
    if (!el) return;
    el.classList.add('hidden');
}

function attachCardTooltip(
    cardEl: HTMLElement,
    {title, desc}: {title: string; desc: string}
) {
    const tip = ensureGlobalTooltipEl();

    // Mobile/touch：用「長按」顯示 tooltip（避免 mobile 沒有 hover 的問題）
    let longPressTimer: number | null = null;
    let longPressTriggered = false;
    let suppressNextClick = false;
    let startX = 0;
    let startY = 0;

    const clearLongPress = () => {
        if (longPressTimer !== null) {
            window.clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    const renderTip = () => {
        tip.innerHTML = `
            <div class="relative w-48 bg-slate-900/95 text-white p-3 flex flex-col items-center justify-center text-center rounded-lg shadow-2xl">
                <div class="text-[11px] font-black uppercase mb-1 text-indigo-300 tracking-wider">${title}</div>
                <div class="text-[8.5px] font-medium leading-relaxed text-slate-300">${desc}</div>
                <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45"></div>
            </div>
        `;
        tip.classList.remove('hidden');
    };

    const positionTip = () => {
        // 先把內容 render 出來，才能量到實際尺寸
        if (tip.classList.contains('hidden')) return;

        const tipRect = tip.getBoundingClientRect();
        const cardRect = cardEl.getBoundingClientRect();

        const pad = 8;
        const offset = 10; // tooltip 與卡牌的間距

        // 預設：卡牌正上方置中（跟舊版 absolute tooltip 一樣）
        let x = cardRect.left + (cardRect.width - tipRect.width) / 2;
        let y = cardRect.top - tipRect.height - offset;

        // 若上方不夠空間，改放到卡牌正下方置中
        if (y < pad) {
            y = cardRect.bottom + offset;
        }

        // clamp to viewport
        if (x + tipRect.width > window.innerWidth - pad) x = window.innerWidth - tipRect.width - pad;
        if (x < pad) x = pad;
        if (y + tipRect.height > window.innerHeight - pad) y = window.innerHeight - tipRect.height - pad;
        if (y < pad) y = pad;

        (tip as HTMLElement).style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };

    // Desktop hover (mouse)
    cardEl.addEventListener('pointerenter', (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        renderTip();
        // 下一幀再定位，避免剛顯示時 rect 還沒更新
        requestAnimationFrame(positionTip);
    });
    cardEl.addEventListener('pointermove', (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        positionTip();
    });
    cardEl.addEventListener('pointerleave', (e: PointerEvent) => {
        clearLongPress();
        if (e.pointerType === 'mouse') hideGlobalTooltip();
    });

    // Touch long-press
    cardEl.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        clearLongPress();
        longPressTriggered = false;
        startX = e.clientX;
        startY = e.clientY;
        longPressTimer = window.setTimeout(() => {
            longPressTriggered = true;
            renderTip();
            requestAnimationFrame(positionTip);
        }, 450);
    });
    cardEl.addEventListener('pointermove', (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        // 使用者在滑動/捲動時就不要觸發長按 tooltip
        if (longPressTimer !== null) {
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            if (dx > 10 || dy > 10) {
                clearLongPress();
            }
        }
    });
    cardEl.addEventListener('pointerup', (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        clearLongPress();
        if (longPressTriggered) {
            suppressNextClick = true;
            longPressTriggered = false;
            hideGlobalTooltip();
        }
    });
    cardEl.addEventListener('pointercancel', (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        clearLongPress();
        longPressTriggered = false;
        hideGlobalTooltip();
    });

    // 長按後放開通常會觸發 click；這裡避免誤點（例如手牌選取/購買）
    cardEl.addEventListener('click', (e: MouseEvent) => {
        if (!suppressNextClick) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressNextClick = false;
    }, {capture: true});

    // iOS/Android 可能出現長按選單
    cardEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

const PHASE_NAMES = [
  '出牌階段',
  '擲骰階段',
  '判定階段',
  '防禦階段',
  '傷害階段',
  '攻擊階段',
  '購買階段'
];

// --- State ---

let deck: GameCard[] = [];
let market: Array<GameCard | null> = [null, null, null]; // [price3, price2, price1]
let buyDeckDrawCount = 0; // 購買階段：已從牌庫抽了幾張 (1st/2nd/3rd)
let players = [
  {
    name: '玩家 A',
    hp: 12,
    hand: [],
    board: [[], [], []], // 3 Areas
    activeAreaEffects: [null, null, null], // 3 effects
    attackQueue: [[], [], []],
    piercingQueue: [[], [], []],
    magic: 0,
    gold: 0,
    defense: 0,
    currentAttacks: [[0], [0], [0]],
    piercingAttacks: [[], [], []],
    cardsPlayedThisTurn: 0,
    chargeUsedIndices: [],
    amplifyUsedIndices: [],
    fateUsedIndices: [],
    evasionUsedIndices: [],
    reproductionUsedIndices: [],
    flareUsedIndices: [],
    thrustUsedIndices: [],
    barrierUsedIndices: [],
    forestUsedIndices: [],
    frostUsedIndices: [],
    magicLuckUsedIndices: [],
    illusionUsedIndices: [],
    illusionCopiedEffectIds: [null, null, null],
    magicSpentInJudging: 0,
    extraFrostAttacks: [[], [], []],
    contractTriggeredAreaIdx: -1,
    turnBaseStats: {
      sums: [0, 0, 0],
      defense: [0, 0, 0],
      magic: [0, 0, 0],
      gold: [0, 0, 0]
    },
    breakthroughApplied: false
  },
  {
    name: '玩家 B',
    hp: 12,
    hand: [],
    board: [[], [], []],
    activeAreaEffects: [null, null, null],
    attackQueue: [[], [], []],
    piercingQueue: [[], [], []],
    magic: 0,
    gold: 0,
    defense: 0,
    currentAttacks: [[0], [0], [0]],
    piercingAttacks: [[], [], []],
    cardsPlayedThisTurn: 0,
    chargeUsedIndices: [],
    amplifyUsedIndices: [],
    fateUsedIndices: [],
    evasionUsedIndices: [],
    reproductionUsedIndices: [],
    flareUsedIndices: [],
    magicLuckUsedIndices: [],
    thrustUsedIndices: [],
    barrierUsedIndices: [],
    forestUsedIndices: [],
    frostUsedIndices: [],
    illusionUsedIndices: [],
    illusionCopiedEffectIds: [null, null, null],
    magicSpentInJudging: 0,
    extraFrostAttacks: [[], [], []],
    contractTriggeredAreaIdx: -1,
    turnBaseStats: {
      sums: [0, 0, 0],
      defense: [0, 0, 0],
      magic: [0, 0, 0],
      gold: [0, 0, 0]
    },
    breakthroughApplied: false
  }
];

let currentPlayerIndex = 0;
let currentPhaseIndex = 0;
let diceResults = [];
let selectedHandCardIndex = -1;
let firstPlayerFirstTurn = true;
let winner = null;
// Winner modal (可關閉以查看最後場面)
let winModalDismissed = false;
let gameLog = ['遊戲開始！'];
// 當回合開始時手牌為 0，視為「跳過出牌階段」，並在擲骰階段固定投 5 顆骰子
let skippedPlayBecauseNoHand = false;
// 一次性準備階段：後手先從手牌中打出 1 張到自己場地，才開始正式流程
let inPreparationPhase = true;
// Mobile UI: 手牌抽屜收合/展開
let handDrawerOpen = false;
// Mobile UI: 底部 dock 顯示內容（手牌 / 市場）
let mobileDockTab: 'hand' | 'market' = 'hand';
// Mobile UI: 對手場地展開/收合（預設收合，節省空間）
let mobileOpponentBoardOpen = false;
let chargeSelectionMode = false;
let chargeSourceAreaIdx = -1;
let fateSelectionMode = false;
let fateSourceAreaIdx = -1;
let fateSelectedDiceIndices = [];
let evasionSelectionMode = false;
let evasionSourceAreaIdx = -1;
let reproductionSelectionMode = false;
let reproductionSourceAreaIdx = -1;
let flareSelectionMode = false;
let flareSourceAreaIdx = -1;
let luckySelectionMode = false;
let luckySourceAreaIdx = -1;
let illusionSelectionMode = false;
let illusionSourceAreaIdx = -1;
let frostSelectionMode = false;
let frostSourceAreaIdx = -1;
let phaseHint = '選牌出牌';
let showEffectList = false;

// 防止使用者連點「繼續」造成階段被推進兩次（看起來像跳過判定階段）
let phaseAdvanceLockUntil = 0;

function drawFromDeck() {
    if (deck.length === 0) return null;
    return deck.pop();
}

function refillMarket() {
    // 1) 將剩餘市場牌往下掉（填 price1 -> price2 -> price3）
    const remaining = market.filter((c): c is GameCard => Boolean(c));
    const next = [null, null, null];
    // bottom index 2 (price1), then 1, then 0
    for (let i = remaining.length - 1; i >= 0; i--) {
        const targetIdx = 2 - ((remaining.length - 1) - i);
        if (targetIdx >= 0) next[targetIdx] = remaining[i];
    }

    // 2) 補空格：同樣由下往上補
    for (let i = 2; i >= 0; i--) {
        if (!next[i]) next[i] = drawFromDeck();
    }
    market = next;
}

function getDeckDrawCost(drawIndex: number) {
    // 第 1/2/3 張價格分別 0/1/2
    if (drawIndex <= 0) return 0;
    if (drawIndex === 1) return 0;
    if (drawIndex === 2) return 1;
    if (drawIndex === 3) return 2;
    // 只允許最多抽 3 張；超出視為不可抽
    return Infinity;
}

function getMarketPrice(slotIdx: 0 | 1 | 2) {
    return slotIdx === 0 ? 3 : slotIdx === 1 ? 2 : 1;
}

function buyMarketCard(slotIdx: 0 | 1 | 2) {
    if (currentPhaseIndex !== 6) return;
    const p = getCurrentPlayer();
    const card = market[slotIdx];
    if (!card) return;

    const price = getMarketPrice(slotIdx);
    if (p.gold < price) return;

    p.gold -= price;
    p.hand.push(card);
    market[slotIdx] = null;
    addLog(`${p.name} 購買市場牌「${card.effectName}」(-${price} 金)`);
    render();
}

function buyFromDeck() {
    if (currentPhaseIndex !== 6) return;
    const p = getCurrentPlayer();

    const nextDrawIndex = buyDeckDrawCount + 1;
    const cost = getDeckDrawCost(nextDrawIndex);
    if (!Number.isFinite(cost)) return;
    if (p.gold < cost) return;
    if (deck.length === 0) return;

    p.gold -= cost;
    const card = drawFromDeck();
    if (!card) return;
    p.hand.push(card);
    buyDeckDrawCount = nextDrawIndex;

    addLog(`${p.name} 從牌庫抽牌「${card.effectName}」(-${cost} 金, 第 ${nextDrawIndex} 張)`);
    render();
}

function toggleEffectList() {
    showEffectList = !showEffectList;
    render();
}

function addLog(msg) {
    console.log(msg); // Ensure logs appear in AI Studio's log viewer
    gameLog.push(msg);
    if (gameLog.length > 30) gameLog.shift(); // Keep more history
}

// --- Initialization ---

function initGame() {
  console.log('正在初始化像素對決 MVP...');
  
  deck = [];
  let idCounter = 0;

  // Cards are now defined in a fixed, editable table: src/cards.ts
  CARD_DEFS.forEach((def) => {
    deck.push({
      id: `card_${idCounter++}`,
      left: def.left,
      right: def.right,
      effectId: def.effectId,
      effectName: def.name,
      effectDesc: def.desc,
      // per requirement: only show effect name
      name: def.name,
    } satisfies GameCard);
  });

  // Shuffle the final deck
  deck = deck.sort(() => Math.random() - 0.5);

  // Deal initial hands
  // 先手 3 張、後手 4 張
  players[0].hand = [deck.pop(), deck.pop(), deck.pop()];
  players[1].hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop()];

  // Enter one-time Preparation Phase (後手先手動打出 1 張)
  inPreparationPhase = true;
  currentPlayerIndex = 1;
  currentPhaseIndex = 0; // reuse play-to-board UI
  selectedHandCardIndex = -1;
  diceResults = [];
  // Mobile：出牌階段時手牌抽屜自動彈出
  // 並預設切回手牌（避免停留在上一回合的市場 tab）
  mobileDockTab = 'hand';
  handDrawerOpen = isMobileLayout();
  players[0].cardsPlayedThisTurn = 0;
  players[1].cardsPlayedThisTurn = 0;
  phaseHint = '後手先出1張牌';

  // Setup global market
  market = [null, null, null];
  refillMarket();

  render();
}

// --- Logic functions ---

function getOpponentIndex() {
  return 1 - currentPlayerIndex;
}

function getCurrentPlayer() {
  return players[currentPlayerIndex];
}

function getOpponent() {
  return players[getOpponentIndex()];
}

function nextPhase() {
  const now = Date.now();
  if (now < phaseAdvanceLockUntil) return;
  phaseAdvanceLockUntil = now + 250;

  if (winner) return;
  if (luckySelectionMode) return;
  const p = getCurrentPlayer();

  if (currentPhaseIndex === 0) { // Play Phase
      // Rule: Hand >= 1 -> Must play at least 1
      if (p.hand.length > 0 && p.cardsPlayedThisTurn === 0) {
          phaseHint = '至少出 1 張';
          render();
          return;
      }

       // 若完全沒有手牌：顯示跳過出牌階段，並在擲骰階段固定投 5 顆
       if (p.hand.length === 0) {
           skippedPlayBecauseNoHand = true;
           phaseHint = '無手牌：跳過出牌';
       } else {
           skippedPlayBecauseNoHand = false;
       }

      currentPhaseIndex = 1;
      // 手機版 UX：離開出牌階段就先收起手牌抽屜
      handDrawerOpen = false;
      if (!skippedPlayBecauseNoHand) {
          phaseHint = '請擲骰';
      }
  } else if (currentPhaseIndex === 1) { // Roll Phase
      if (diceResults.length === 0) {
          phaseHint = '必須先擲骰';
          render();
          return;
      }
      currentPhaseIndex = 2;
      phaseHint = '判定中';
      handleJudging();
  } else if (currentPhaseIndex === 2) { // Judging
      currentPhaseIndex = 3;
      if (currentPlayerIndex === 0 && firstPlayerFirstTurn) {
          phaseHint = '先手首回合跳過';
      } else {
          phaseHint = '防禦對手攻擊';
      }
      handleDefensePhaseStart();
  } else if (currentPhaseIndex === 3) { // Defense
      currentPhaseIndex = 4;
      if (currentPlayerIndex === 0 && firstPlayerFirstTurn) {
          phaseHint = '先手首回合跳過';
      } else {
          phaseHint = '結算傷害';
      }
      handleDamagePhase();
  } else if (currentPhaseIndex === 4) { // Damage
      currentPhaseIndex = 5;
      phaseHint = '攻擊效果發動';
      handleAttackPhaseStart();
  } else if (currentPhaseIndex === 5) { // Attack
      // Store current attacks into queue
      p.attackQueue = p.currentAttacks.map(h => [...h]);
      p.piercingQueue = p.piercingAttacks.map(h => [...h]);
      currentPhaseIndex = 6;
      phaseHint = '購買階段';
      handleBuyPhase();
  } else if (currentPhaseIndex === 6) { // Buy
      // 必須先從牌庫抽第 1 張 (0 金)
      // 若牌庫已空：取消「必抽 1 張免費卡」限制，避免卡關
      if (deck.length > 0 && buyDeckDrawCount < 1) {
          phaseHint = '先抽免費牌';
          render();
          return;
      }

      // End of buy: 自動處理市場補位
      refillMarket();

      // End turn
      p.magic = 0;
      p.gold = 0;
      p.defense = 0;
      
      currentPlayerIndex = 1 - currentPlayerIndex;
      currentPhaseIndex = 0;
      phaseHint = '選牌打出';
      diceResults = [];
      skippedPlayBecauseNoHand = false;
      // Mobile：進入出牌階段時手牌抽屜自動彈出
      // 並預設切回手牌（避免停留在上一回合的市場 tab）
      mobileDockTab = 'hand';
      handDrawerOpen = isMobileLayout();
      players[currentPlayerIndex].cardsPlayedThisTurn = 0;
      players[currentPlayerIndex].chargeUsedIndices = [];
      players[currentPlayerIndex].amplifyUsedIndices = [];
      players[currentPlayerIndex].fateUsedIndices = [];
      players[currentPlayerIndex].evasionUsedIndices = [];
      players[currentPlayerIndex].reproductionUsedIndices = [];
      players[currentPlayerIndex].flareUsedIndices = [];
      players[currentPlayerIndex].magicLuckUsedIndices = [];
      players[currentPlayerIndex].illusionUsedIndices = [];
      players[currentPlayerIndex].illusionCopiedEffectIds = [null, null, null];
      players[currentPlayerIndex].thrustUsedIndices = [];
      players[currentPlayerIndex].barrierUsedIndices = [];
      players[currentPlayerIndex].forestUsedIndices = [];
      players[currentPlayerIndex].frostUsedIndices = [];
      players[currentPlayerIndex].magicSpentInJudging = 0;
      players[currentPlayerIndex].extraFrostAttacks = [[], [], []];
      players[currentPlayerIndex].contractTriggeredAreaIdx = -1;
      players[currentPlayerIndex].turnBaseStats = { sums: [0, 0, 0], defense: [0, 0, 0], magic: [0, 0, 0], gold: [0, 0, 0] };
      players[currentPlayerIndex].breakthroughApplied = false;
      players[currentPlayerIndex].currentAttacks = [[0], [0], [0]];
      players[currentPlayerIndex].piercingAttacks = [[], [], []];
      players[currentPlayerIndex].magic = 0;
      players[currentPlayerIndex].gold = 0;
      players[currentPlayerIndex].defense = 0;
      
      fateSelectionMode = false;
      fateSelectedDiceIndices = [];
      fateSourceAreaIdx = -1;
      evasionSelectionMode = false;
      evasionSourceAreaIdx = -1;
      chargeSelectionMode = false;
      chargeSourceAreaIdx = -1;
      reproductionSelectionMode = false;
      reproductionSourceAreaIdx = -1;
      flareSelectionMode = false;
      flareSourceAreaIdx = -1;
      frostSelectionMode = false;
      frostSourceAreaIdx = -1;
      
      if (currentPlayerIndex === 0) {
          firstPlayerFirstTurn = false;
      }
  }

  render();
}

function isMirageActive() {
    return players.some(p => p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'mirage'));
}

function getEffectiveEffectId(p, aIdx) {
    const card = p.activeAreaEffects[aIdx];
    if (!card) return null;
    if (card.effectId === 'illusion') {
        return p.illusionCopiedEffectIds[aIdx] || 'illusion';
    }
    return card.effectId;
}

function handleJudging() {
    const p = getCurrentPlayer();
    const pIdx = currentPlayerIndex;
    p.magic = 0;
    p.gold = 0;
    p.defense = 0;
    p.breakthroughApplied = false;
    const areaSums = [0, 0, 0];
    const areaDefense = [0, 0, 0];
    const areaMagic = [0, 0, 0];
    const areaGold = [0, 0, 0];

    // Base attributes setup (1-6)
    const baseAttrs = pIdx === 0 
        ? ['attack', 'defense', 'magic', 'gold', 'gold', 'attack'] 
        : ['gold', 'magic', 'magic', 'attack', 'attack', 'defense'];

    console.log('--- 判定階段 ---');
    const diceCountsPerArea = [0, 0, 0];
    diceResults.forEach(val => {
        const areaIdx = Math.floor((val - 1) / 2);
        diceCountsPerArea[areaIdx]++;
        const isLeft = (val % 2 !== 0); 
        const stack = p.board[areaIdx];
        
        // 1. Add Base Attributte
        const baseAttr = baseAttrs[val - 1];
        if (baseAttr === 'attack') areaSums[areaIdx] += 1;
        else if (baseAttr === 'defense') areaDefense[areaIdx] += 1;
        else if (baseAttr === 'magic') areaMagic[areaIdx] += 1;
        else if (baseAttr === 'gold') areaGold[areaIdx] += 1;

        // 2. Add Card Attributes (type + value)
        stack.forEach(card => {
            const a = isLeft ? card.left : card.right;
            if (a.type === 'attack') areaSums[areaIdx] += a.value;
            else if (a.type === 'defense') areaDefense[areaIdx] += a.value;
            else if (a.type === 'magic') areaMagic[areaIdx] += a.value;
            else if (a.type === 'gold') areaGold[areaIdx] += a.value;
        });
    });

    // Save base stats for potential later Breakthrough trigger
    p.turnBaseStats = {
        sums: [...areaSums],
        defense: [...areaDefense],
        magic: [...areaMagic],
        gold: [...areaGold]
    };

    // Breakthrough Effect: Initial check
    let breakthroughCardIdx = -1;
    for (let i = 0; i < 3; i++) {
        if (getEffectiveEffectId(p, i) === 'breakthrough') {
            breakthroughCardIdx = i;
            break;
        }
    }

    if (breakthroughCardIdx !== -1 && p.hp <= 3) {
        addLog(`[臨界突破]判定成功，所有數值翻倍！`);
        for (let i = 0; i < 3; i++) {
            areaSums[i] *= 2;
            areaDefense[i] *= 2;
            areaMagic[i] *= 2;
            areaGold[i] *= 2;
        }
        p.breakthroughApplied = true;
    }
    p.gold = areaGold.reduce((a, b) => a + b, 0);

    // Apply Surge Effect
    p.activeAreaEffects.forEach((card, aIdx) => {
        if (getEffectiveEffectId(p, aIdx) === 'surge') {
            if (areaMagic[aIdx] > 0) {
                const bonus = areaMagic[aIdx];
                areaMagic[aIdx] *= 2;
                addLog(`[摩能湧動] ${aIdx + 1} 魔力翻倍: ${bonus} -> ${areaMagic[aIdx]}`);
            }
        }
    });

    p.magic = areaMagic.reduce((a, b) => a + b, 0);

    // Apply persistent expenditure correction
    const originalMagicIncome = p.magic;
    p.magic = Math.max(0, p.magic - p.magicSpentInJudging);

    // [Mirage] Bonus Attributes
    p.activeAreaEffects.forEach((card, aIdx) => {
        if (getEffectiveEffectId(p, aIdx) === 'mirage') {
            areaSums[aIdx] += 2;
            areaDefense[aIdx] += 1;
            addLog(`[幻境] 區域 ${aIdx + 1} 基本攻擊額外 +2，防禦力額外 +1`);
        }
    });

    // [Diversion] Effect: Automatic check after base magic is summed
    const hasDiversion = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'diversion');
    if (hasDiversion && p.magic <= 2) {
        const oldMagic = p.magic;
        p.magic = 5;
        addLog(`[導流] 判定魔力(${oldMagic}) <= 2，自動啟動導流提升至 5 點魔力`);
    }

    // Apply persistent expenditure correction (Subtract costs paid this phase)
    p.magic = Math.max(0, p.magic - p.magicSpentInJudging);

    // 3. Apply Flame Shield Effect (Before setting global defense)
    p.activeAreaEffects.forEach((card, aIdx) => {
        const effId = getEffectiveEffectId(p, aIdx);
        if (effId === 'flame_shield') {
            const def = areaDefense[aIdx];
            if (def > 0) {
                areaSums[aIdx] += def * 2;
                addLog(`[炎盾] 區域 ${aIdx + 1} 轉化 ${def} 點防禦為 ${def * 2} 點攻擊`);
                areaDefense[aIdx] = 0; // "強制視為" means it's no longer defense
            }
        }
        if (effId === 'brilliance') {
            const diceCount = diceCountsPerArea[aIdx];
            if (diceCount >= 3) {
                areaSums[aIdx] += 7;
                addLog(`[光輝] 區域 ${aIdx + 1} 檢測到 ${diceCount} 顆骰子(>=3)，攻擊力額外 +7`);
            }
        }
    });

    p.defense = areaDefense.reduce((a, b) => a + b, 0);
    p.currentAttacks = areaSums.map((s, idx) => {
        const list = [s];
        if (p.extraFrostAttacks && p.extraFrostAttacks[idx]) {
            list.push(...p.extraFrostAttacks[idx]);
        }
        return list;
    });
    p.piercingAttacks = [[], [], []];

    // 4. Add Piercing Ambush & Gale & Shadow
    p.activeAreaEffects.forEach((card, aIdx) => {
        const effId = getEffectiveEffectId(p, aIdx);
        if (effId === 'ambush') {
            p.piercingAttacks[aIdx].push(1);
        }
        if (effId === 'gale') {
            const bonus = diceCountsPerArea[aIdx];
            if (bonus > 0) {
                p.piercingAttacks[aIdx].push(bonus);
                addLog(`[疾風] 區域 ${aIdx + 1} 檢測到 ${bonus} 顆骰子，造成 ${bonus} 點無法防禦傷害`);
            }
        }
        if (effId === 'shadow') {
            const diceCount = diceCountsPerArea[aIdx];
            if (diceCount === 0) {
                p.piercingAttacks[aIdx].push(3);
                addLog(`[暗影] 區域 ${aIdx + 1} 無任何骰子，造成 3 點無法防禦傷害`);
            }
        }
    });

    addLog(`合計: 攻[${p.currentAttacks.map(v=>v.reduce((a,b)=>a+b,0))}], 防:${p.defense}, 魔:${p.magic}, 金:${p.gold}`);
}

function handleDefensePhaseStart() {
    const p = getCurrentPlayer();
    const opp = getOpponent();

    if (currentPlayerIndex === 0 && firstPlayerFirstTurn) {
        addLog('先手第一回合跳過防禦與傷害階段');
        return;
    }

    // Check if opponent has any attacks
    const totalOppAtk = opp.attackQueue.flat().reduce((a, b) => a + b, 0);
    if (totalOppAtk === 0) {
        addLog('對手無攻擊，跳過防禦階段');
    }
}

function handleDamagePhase() {
    const p = getCurrentPlayer();
    const opp = getOpponent();

    if (currentPlayerIndex === 0 && firstPlayerFirstTurn) {
        return;
    }

    addLog('--- 傷害階段 ---');
    const hpBeforeDamage = p.hp;
    p.contractTriggeredAreaIdx = -1; // Reset highlight at start of damage phase

    // [Backfire] Effect: Automatic check
    const backfireCount = p.activeAreaEffects.filter((_, i) => getEffectiveEffectId(p, i) === 'backfire').length;
    
    if (backfireCount > 0) {
        addLog(`[檢測] 玩家持有 ${backfireCount} 張「反噬」...`);
        const normalHits = opp.attackQueue.flat();
        
        // Success if: opponent has NO normal attacks, OR all are blocked by defense
        const successfullyDefended = normalHits.length === 0 || normalHits.every(atk => Math.max(0, atk - p.defense) <= 0);
        
        if (successfullyDefended) {
            addLog(`[效果] 反噬觸發！成功擋下所有普通攻擊 (防禦: ${p.defense})`);
            p.activeAreaEffects.forEach((c, aIdx) => {
                if (c && getEffectiveEffectId(p, aIdx) === 'backfire') {
                    p.piercingAttacks[aIdx].push(2);
                    addLog(`[反噬] 區域 ${aIdx + 1} 產生 2 點穿透反擊傷害`);
                }
            });
        } else {
            const blockedAtks = normalHits.filter(atk => atk <= p.defense).length;
            const failedAtks = normalHits.length - blockedAtks;
            addLog(`[反噬] 未觸發: 尚有 ${failedAtks} 個攻擊穿透防禦`);
        }
    }

    let totalDamage = 0;
    
    // Normal Attacks (Blocked by defense)
    opp.attackQueue.forEach((hits, i) => {
        hits.forEach(atk => {
            const dmg = Math.max(0, atk - p.defense);
            totalDamage += dmg;
            if (dmg > 0) addLog(`區域 ${i+1} 攻擊 ${atk}: 造成 ${dmg} 傷害`);
        });
    });

    // Piercing Attacks (Ignore defense)
    if (opp.piercingQueue) {
        opp.piercingQueue.forEach((hits, i) => {
            hits.forEach(atk => {
                totalDamage += atk;
                addLog(`區域 ${i+1} 突擊 ${atk}: 造成 ${atk} 點穿透物理傷害`);
            });
        });
    }

    p.hp -= totalDamage;
    phaseHint = `受傷 ${totalDamage}`;
    if (totalDamage === 0) {
        addLog(`完美防禦！未受到任何傷害`);
    } else {
        addLog(`本輪承受總傷害: ${totalDamage}, 剩餘 HP: ${p.hp}`);
    }

    // [Contract] Effect: Protection against fatal damage
    if (p.hp <= 0 && hpBeforeDamage >= 4) {
        let contractIdx = -1;
        for (let i = 0; i < 3; i++) {
            if (getEffectiveEffectId(p, i) === 'contract') {
                contractIdx = i;
                break;
            }
        }
        if (contractIdx !== -1) {
            p.hp = 1;
            p.contractTriggeredAreaIdx = contractIdx;
            addLog(`[效果] 契約觸發！受到致命傷但生命曾 >= 4，保存生命點數為 1`);
        }
    }

    // Reactive Breakthrough: If HP just dropped to <= 3, apply additional doubling
    if (p.hp <= 3 && !p.breakthroughApplied) {
        let breakthroughCardIdx = -1;
        for (let i = 0; i < 3; i++) {
            if (getEffectiveEffectId(p, i) === 'breakthrough') {
                breakthroughCardIdx = i;
                break;
            }
        }
        if (breakthroughCardIdx !== -1) {
            addLog(`[突破] 受到攻擊生命降至 <= 3，判定獲得的所有數值 (攻/防/魔/金) 獲得額外翻倍！`);
            p.magic += p.turnBaseStats.magic.reduce((a, b) => a + b, 0);
            p.gold += p.turnBaseStats.gold.reduce((a, b) => a + b, 0);
            p.defense += p.turnBaseStats.defense.reduce((a, b) => a + b, 0);
            
            // For attacks, we add the base to each area. 
            // Note: If Flame Shield was applied, we should technically double that too? 
            // User: "掷骰获得的所有数值翻倍". Simple addition covers the base doubling.
            p.turnBaseStats.sums.forEach((s, i) => {
                if (s > 0) p.currentAttacks[i][0] += s;
            });
            p.breakthroughApplied = true;
        }
    }

    // Clear opponent's stored attacks after they are processed
    opp.attackQueue = [[], [], []];
    opp.piercingQueue = [[], [], []];
    opp.currentAttacks = [[0], [0], [0]];
    opp.piercingAttacks = [[], [], []];

    if (p.hp <= 0) {
        winner = opp.name;
        winModalDismissed = false;
    }
}

function handleAttackPhaseStart() {
    const p = getCurrentPlayer();
    p.contractTriggeredAreaIdx = -1; // Reset highlight as we leave damage phase
    addLog('--- 攻擊階段 ---');
    render();
}

function useEvasion(areaIdx) {
    if (currentPhaseIndex !== 3) return; // Defense Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'dodge') {
        if (p.evasionUsedIndices.includes(areaIdx)) {
            alert('這張閃避卡本回合已使用過');
            return;
        }
        if (p.magic >= 3) {
            evasionSelectionMode = !evasionSelectionMode;
            evasionSourceAreaIdx = areaIdx;
            if (evasionSelectionMode) {
                addLog('閃避已啟動，請點擊對手的一個攻擊徽章');
            }
            render();
        } else {
            alert('魔力不足 (需要 3 點)');
        }
    }
}

function targetEvasion(areaIdx, hitIdx) {
    if (!evasionSelectionMode) return;
    const p = getCurrentPlayer();
    const opp = getOpponent();

    // Regular attacks only
    if (opp.attackQueue[areaIdx] && opp.attackQueue[areaIdx][hitIdx] !== undefined) {
        if (p.magic >= 3) {
            p.magic -= 3;
            opp.attackQueue[areaIdx].splice(hitIdx, 1);
            
            if (evasionSourceAreaIdx !== -1) {
                p.evasionUsedIndices.push(evasionSourceAreaIdx);
            }
            
            evasionSelectionMode = false;
            evasionSourceAreaIdx = -1;
            addLog('閃避成功！消耗 3 點魔力已無視該次攻擊');
            render();
        } else {
            alert('魔力不足 (需要 3 點)');
            evasionSelectionMode = false;
            evasionSourceAreaIdx = -1;
            render();
        }
    } else {
        alert('只能閃避標準攻擊，無法閃避穿透傷害');
    }
}

function useShield(areaIdx) {
    if (currentPhaseIndex !== 3) return; // Defense Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'shield') {
        if (p.magic >= 2) {
            p.magic -= 2;
            p.defense += 1;
            addLog(`${p.name} 使用了「護盾」，消耗 2 點魔力增加 1 點防禦`);
            render();
        } else {
            alert('魔力不足 (需要 2 點)');
        }
    }
}

function useMagicLuck(areaIdx) {
    if (currentPhaseIndex !== 2) return; // Judging Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'magic_luck') {
        if (p.magicLuckUsedIndices.includes(areaIdx)) {
            alert('這張魔運卡本回合已使用過');
            return;
        }
        if (p.magic >= 2) {
            p.magic -= 2;
            p.magicSpentInJudging += 2;
            const newVal = Math.floor(Math.random() * 6) + 1;
            diceResults.push(newVal);
            p.magicLuckUsedIndices.push(areaIdx);
            addLog(`${p.name} 使用了「魔運」，消耗 2 點魔力額外投擲一顆骰子：${newVal}`);
            handleJudging(); // Re-calculate Gale, Shadow, Brilliance, etc.
            render();
        } else {
            alert('魔力不足 (需要 2 點)');
        }
    }
}

function useIllusion(areaIdx) {
    if (currentPhaseIndex !== 2) return; // Judging Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];
    if (card && card.effectId === 'illusion') {
        if (p.illusionUsedIndices.includes(areaIdx)) {
            alert('幻象幽影本回合已使用過');
            return;
        }

        const opp = getOpponent();
        const hasCopyableCard = opp.activeAreaEffects.some(c => c && c.effectId !== 'lucky' && c.effectId !== 'fate');
        if (!hasCopyableCard) {
            alert('對手目前沒有可複製的招式卡');
            return;
        }

        if (p.magic >= 1) {
            illusionSelectionMode = true;
            illusionSourceAreaIdx = areaIdx;
            addLog(`${p.name} 啟動「幻象幽影」，請選擇對手的一張招式卡複製`);
            render();
        } else {
            alert('魔力不足 (需要 1 點)');
        }
    }
}

function targetIllusion(oppAreaIdx) {
    if (!illusionSelectionMode) return;
    const p = getCurrentPlayer();
    const opp = getOpponent();
    const targetCard = opp.activeAreaEffects[oppAreaIdx];

    if (!targetCard) {
        alert('該區域沒有招式卡可複製');
        return;
    }

    if (targetCard.effectId === 'lucky' || targetCard.effectId === 'fate') {
        alert('不可複製「幸運」或「命運」');
        return;
    }

    p.magic -= 1;
    p.magicSpentInJudging += 1;
    p.illusionUsedIndices.push(illusionSourceAreaIdx);
    p.illusionCopiedEffectIds[illusionSourceAreaIdx] = targetCard.effectId;
    
    addLog(`${p.name} 使用「幻象幽影」複製了對手的「${targetCard.effectName}」！`);
    
    illusionSelectionMode = false;
    illusionSourceAreaIdx = -1;
    
    handleJudging(); // Recalculate with new effect
    render();
}

function useAmplify(areaIdx) {
    if (currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'amplify') {
        if (p.amplifyUsedIndices.includes(areaIdx)) {
            alert('這張增幅卡本回合已使用過');
            return;
        }
        // Amplify is now free
        p.currentAttacks = p.currentAttacks.map(hits => 
            hits.map(atk => atk > 0 ? atk + 1 : 0)
        );
        p.amplifyUsedIndices.push(areaIdx);
        render();
    }
}

function useReproduction(areaIdx) {
    if (currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'reproduction') {
        if (p.reproductionUsedIndices.includes(areaIdx)) {
            alert('這張再現卡本回合已使用過');
            return;
        }
        if (p.magic >= 2) {
            reproductionSelectionMode = !reproductionSelectionMode;
            reproductionSourceAreaIdx = areaIdx;
            chargeSelectionMode = false;
            evasionSelectionMode = false;
            if (reproductionSelectionMode) {
                addLog('再現已啟動，請點擊自己的一個攻擊徽章');
            }
            render();
        } else {
            alert('魔力不足 (需要 2 點)');
        }
    }
}

function useFlare(areaIdx) {
    if (currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'flare') {
        if (p.flareUsedIndices.includes(areaIdx)) {
            alert('這張閃光卡本回合已使用過');
            return;
        }
        if (p.magic >= 3) {
            flareSelectionMode = !flareSelectionMode;
            flareSourceAreaIdx = areaIdx;
            // Cancel other selections
            chargeSelectionMode = false;
            evasionSelectionMode = false;
            reproductionSelectionMode = false;
            if (flareSelectionMode) {
                addLog('閃光已啟動，請點擊自己的一個攻擊徽章');
            }
            render();
        } else {
            alert('魔力不足 (需要 3 點)');
        }
    }
}

function targetFlare(targetAreaIdx, atkIdx) {
    if (!flareSelectionMode) return;
    const p = getCurrentPlayer();
    
    if (p.magic < 3) {
        alert('魔力不足 (需要 3 點)');
        flareSelectionMode = false;
        flareSourceAreaIdx = -1;
        render();
        return;
    }
    
    // Safety check: index out of bounds or negative
    if (!p.currentAttacks[targetAreaIdx] || atkIdx >= p.currentAttacks[targetAreaIdx].length) {
        flareSelectionMode = false;
        flareSourceAreaIdx = -1;
        render();
        return;
    }

    const atkVal = p.currentAttacks[targetAreaIdx][atkIdx];
    if (atkVal > 0) {
        const newVal = atkVal * 2;
        p.currentAttacks[targetAreaIdx][atkIdx] = newVal;
        p.magic -= 3;
        if (flareSourceAreaIdx !== -1) {
            p.flareUsedIndices.push(flareSourceAreaIdx);
        }
        
        addLog(`${p.name} 使用了「閃光」，使強度從 ${atkVal} 翻倍為 ${newVal}`);
        flareSelectionMode = false;
        flareSourceAreaIdx = -1;
        render();
    } else {
        alert('只能對大於 0 的攻擊點數使用');
    }
}

function useThrust(areaIdx) {
    if (currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'thrust') {
        if (p.thrustUsedIndices.includes(areaIdx)) {
            alert('這張突刺卡本回合已使用過');
            return;
        }

        let transformedCount = 0;
        p.currentAttacks.forEach((areaAtks, aIdx) => {
            areaAtks.forEach((val, hitIdx) => {
                if (val > 0 && val <= 2) {
                    p.currentAttacks[aIdx][hitIdx] = val * 2;
                    transformedCount++;
                }
            });
        });

        if (transformedCount > 0) {
            p.thrustUsedIndices.push(areaIdx);
            addLog(`${p.name} 使用了「突刺」，將 ${transformedCount} 個強度為 1 或 2 的攻擊翻倍`);
            render();
        } else {
            alert('沒有強度為 1 或 2 的普通攻擊可翻倍');
        }
    }
}

function useForest(areaIdx) {
    if (currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'forest') {
        if (p.forestUsedIndices.includes(areaIdx)) {
            alert('這張森林卡本回合已使用過');
            return;
        }
        if (p.magic >= 3) {
            p.magic -= 3;
            // Global Merge: Sum all normal attacks from all areas
            let totalSum = 0;
            p.currentAttacks.forEach(hits => {
                totalSum += hits.reduce((a, b) => a + b, 0);
            });

            // Set all areas to 0 hits, then put total into the target area
            p.currentAttacks = [[0], [0], [0]];
            p.currentAttacks[areaIdx] = [totalSum];

            p.forestUsedIndices.push(areaIdx);
            addLog(`${p.name} 使用了「森林」，消耗 3 點魔力將全場攻擊合併至區域 ${areaIdx + 1}`);
            render();
        } else {
            alert('魔力不足 (需要 3 點)');
        }
    }
}

function useFrost(areaIdx) {
    if (currentPhaseIndex !== 1) return; // Roll Phase
    const p = getCurrentPlayer();
    const card = p.activeAreaEffects[areaIdx];

    if (card && card.effectId === 'frost') {
        if (p.frostUsedIndices.includes(areaIdx)) {
            alert('這張冰霜卡本回合已使用過');
            return;
        }
        if (diceResults.length === 0) {
            alert('請先擲骰後再使用冰霜');
            return;
        }
        
        frostSelectionMode = !frostSelectionMode;
        frostSourceAreaIdx = areaIdx;
        
        // Cancel other modes
        fateSelectionMode = false;
        
        if (frostSelectionMode) {
            addLog('冰霜已啟動，請點擊一個骰子進行捨棄');
        }
        render();
    }
}

function targetFrost(dieIdx) {
    if (!frostSelectionMode) return;
    const p = getCurrentPlayer();
    
    // Remove the die
    const removedVal = diceResults.splice(dieIdx, 1)[0];
    
    // Generate random extra attack 1-3
    const extraAtk = Math.floor(Math.random() * 3) + 1;
    
    if (!p.extraFrostAttacks) p.extraFrostAttacks = [[], [], []];
    p.extraFrostAttacks[frostSourceAreaIdx].push(extraAtk);
    
    // Immediately show in UI (currentPhaseIndex 1)
    p.currentAttacks[frostSourceAreaIdx].push(extraAtk);
    
    p.frostUsedIndices.push(frostSourceAreaIdx);
    
    addLog(`${p.name} 使用了「冰霜」，捨棄了骰子 ${removedVal}，並在區域 ${frostSourceAreaIdx + 1} 獲得了強度為 ${extraAtk} 的額外攻擊`);
    
    frostSelectionMode = false;
    frostSourceAreaIdx = -1;
    render();
}

function useHolyLight(areaIdx) {
    const validPhases = [2, 3, 4, 5];
    if (!validPhases.includes(currentPhaseIndex)) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'holy_light') {
        if (p.magic >= 2) {
            p.magic -= 2;
            if (currentPhaseIndex === 2) p.magicSpentInJudging += 2;
            p.hp += 1;
            addLog(`${p.name} 使用了「聖光」，消耗 2 點魔力回復 1 點生命`);
            render();
        } else {
            alert('魔力不足 (需要 2 點)');
        }
    }
}

function useSoulSnatch(areaIdx) {
    const validPhases = [2, 3, 4, 5];
    if (!validPhases.includes(currentPhaseIndex)) return;
    const p = getCurrentPlayer();
    const opp = getOpponent();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'soul_snatch') {
        if (p.magic >= 3) {
            p.magic -= 3;
            if (currentPhaseIndex === 2) p.magicSpentInJudging += 3;
            opp.hp -= 1;
            p.hp += 1;
            addLog(`${p.name} 使用了「奪魂」，消耗 3 點魔力吸收對手 1 點生命值`);
            
            if (opp.hp <= 0) {
                winner = p.name;
                winModalDismissed = false;
                addLog(`遊戲結束！${winner} 獲得勝利！`);
            }
            render();
        } else {
            alert('魔力不足 (需要 3 點)');
        }
    }
}

function renderWinModalOverlay() {
    if (!winner || winModalDismissed) return null;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm';

    const modal = document.createElement('div');
    // 手機/桌機共用：手機字體更小避免換行太醜
    modal.className = 'w-full max-w-sm rounded-2xl bg-slate-900/95 shadow-2xl border border-slate-700 overflow-hidden';

    modal.innerHTML = `
        <div class="px-5 py-4 bg-slate-950/40 border-b border-slate-800 text-center">
            <div class="text-[10px] font-black text-slate-300 uppercase tracking-[0.35em]">對局結束</div>
            <div class="mt-1 text-[20px] sm:text-3xl font-black text-white tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
                ${winner} 獲勝
            </div>
        </div>
        <div class="px-5 py-4 text-center">
            <div class="text-[11px] font-bold text-slate-300">可查看最後場面</div>
            <div class="mt-4 flex gap-2">
                <button id="restartBtn" class="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-black text-[12px] tracking-widest uppercase shadow-lg shadow-indigo-900/30 active:scale-95">新遊戲</button>
                <button id="closeWinBtn" class="flex-1 bg-transparent text-slate-100 py-2.5 rounded-xl font-black text-[12px] tracking-widest uppercase border border-slate-600 active:scale-95">關閉</button>
            </div>
        </div>
    `;

    (modal.querySelector('#restartBtn') as HTMLButtonElement).onclick = () => location.reload();
    (modal.querySelector('#closeWinBtn') as HTMLButtonElement).onclick = () => {
        winModalDismissed = true;
        render();
    };

    overlay.appendChild(modal);
    return overlay;
}

function targetReproduction(targetAreaIdx, atkIdx) {
    if (!reproductionSelectionMode) return;
    const p = getCurrentPlayer();
    
    if (p.magic < 2) {
        alert('魔力不足 (需要 2 點)');
        reproductionSelectionMode = false;
        reproductionSourceAreaIdx = -1;
        render();
        return;
    }
    
    const atkVal = p.currentAttacks[targetAreaIdx][atkIdx];
    if (atkVal > 0) {
        p.currentAttacks[targetAreaIdx].push(atkVal);
        p.magic -= 2;
        if (reproductionSourceAreaIdx !== -1) {
            p.reproductionUsedIndices.push(reproductionSourceAreaIdx);
        }
        
        addLog(`${p.name} 使用了「再現」，使強度為 ${atkVal} 的攻擊變為兩次`);
        reproductionSelectionMode = false;
        reproductionSourceAreaIdx = -1;
        render();
    }
}

function useFate(areaIdx) {
    // Fate can now be used in Phase 1 (after roll) or Phase 2 (Judging)
    if (currentPhaseIndex !== 1 && currentPhaseIndex !== 2) return;
    if (currentPhaseIndex === 1 && diceResults.length === 0) return; // Must roll first

    const p = getCurrentPlayer();
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'fate') {
        if (p.fateUsedIndices.includes(areaIdx)) {
            alert('這張命運卡本回合已使用過');
            return;
        }
        fateSelectionMode = !fateSelectionMode;
        fateSourceAreaIdx = areaIdx;
        fateSelectedDiceIndices = [];
        render();
    }
}

function toggleDiceIndexSelection(idx) {
    if (!fateSelectionMode) return;
    
    if (fateSelectedDiceIndices.includes(idx)) {
        // Deselect
        fateSelectedDiceIndices = fateSelectedDiceIndices.filter(i => i !== idx);
    } else {
        // No limit per user request
        fateSelectedDiceIndices.push(idx);
    }
    render();
}

function confirmFate() {
    if (!fateSelectionMode) return;
    const p = getCurrentPlayer();
    
    if (fateSelectedDiceIndices.length === 0) {
        // Just cancel selection mode if nothing selected
        fateSelectionMode = false;
        fateSourceAreaIdx = -1;
        render();
        return;
    }

    fateSelectedDiceIndices.forEach(idx => {
        diceResults[idx] = Math.floor(Math.random() * 6) + 1;
    });
    if (fateSourceAreaIdx !== -1) {
        p.fateUsedIndices.push(fateSourceAreaIdx);
    }
    fateSelectionMode = false;
    fateSourceAreaIdx = -1;
    fateSelectedDiceIndices = [];
    addLog('命運扭轉！骰子已重擲');
    handleJudging();
    render();
}

function handleBuyPhase() {
    const p = getCurrentPlayer();
    addLog('--- 購買階段 ---');
    buyDeckDrawCount = 0;
    // Mobile UX：購買階段預設顯示市場（在底部 dock）
    mobileDockTab = 'market';
    handDrawerOpen = true;
    phaseHint = deck.length === 0
        ? '牌庫空：可結束/買市'
        : '先抽免費牌，再買';
    render();
}

function renderGoldDots(cost: number) {
    if (!Number.isFinite(cost)) {
        return '<div class="text-[10px] font-black text-slate-400">—</div>';
    }
    if (cost === 0) {
        return '<div class="text-[10px] font-black text-emerald-700">FREE</div>';
    }
    const dots = Array.from({length: Math.min(cost, 6)}, () => '<span class="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm"></span>').join('');
    return `<div class="flex items-center gap-1">${dots}<span class="ml-1 text-[10px] font-black text-amber-700">${cost}</span></div>`;
}

function renderMarketPanel(typeColors) {
    const p = getCurrentPlayer();
    const panel = document.createElement('div');
    panel.className = 'w-[210px] border-l border-slate-200 bg-white/80 backdrop-blur-sm h-screen shrink-0 flex flex-col';

    const header = document.createElement('div');
    header.className = 'h-16 px-4 border-b border-slate-200 flex items-center justify-between shrink-0';
    header.innerHTML = `
        <div class="flex flex-col">
            <div class="text-[10px] font-black text-slate-400 tracking-[0.3em] uppercase">Market</div>
            <div class="text-sm font-black text-slate-800 tracking-tight">市場區</div>
        </div>
        <div class="text-[11px] font-black text-amber-600">金幣 ${p.gold}</div>
    `;
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'flex-1 overflow-y-auto px-4 py-4 flex flex-col items-center gap-4';

    // Deck slot
    const deckWrap = document.createElement('div');
    deckWrap.className = 'w-full flex flex-col items-center gap-2';

    const nextDrawIndex = buyDeckDrawCount + 1;
    const nextDrawCost = getDeckDrawCost(nextDrawIndex);
    const canDraw = currentPhaseIndex === 6 && deck.length > 0 && Number.isFinite(nextDrawCost) && p.gold >= nextDrawCost;
    const mustDraw = currentPhaseIndex === 6 && buyDeckDrawCount < 1;

    const deckCard = document.createElement('div');
    deckCard.className = `card-frame shadow-sm relative flex items-center justify-center ${canDraw ? 'cursor-pointer' : 'opacity-60'}`;
    deckCard.setAttribute('style', `${getCardFrameStyleVars('market')} background: linear-gradient(135deg, #0f172a, #1e293b); border-color: #334155;`);
    deckCard.innerHTML = `
        <div class="flex flex-col items-center justify-center text-white">
            <div class="text-[10px] font-black tracking-[0.25em]">DECK</div>
            <div class="text-[10px] font-bold opacity-80 mt-1">剩餘 ${deck.length}</div>
        </div>
    `;

    if (canDraw) {
        deckCard.classList.add('ring-2', mustDraw ? 'ring-emerald-400' : 'ring-indigo-300');
        deckCard.onclick = buyFromDeck;
    }

    const deckMeta = document.createElement('div');
    deckMeta.className = 'w-full flex items-center justify-between px-1';
    deckMeta.innerHTML = `
        <div class="text-[10px] font-black text-slate-500">抽第 ${nextDrawIndex} 張</div>
        ${renderGoldDots(nextDrawCost)}
    `;

    deckWrap.appendChild(deckCard);
    deckWrap.appendChild(deckMeta);
    body.appendChild(deckWrap);

    // Market 3 slots (top->bottom : 3/2/1)
    const slots: Array<{idx: 0 | 1 | 2; price: number; label: string}> = [
        {idx: 0, price: 3, label: '價格 3'},
        {idx: 1, price: 2, label: '價格 2'},
        {idx: 2, price: 1, label: '價格 1'},
    ];

    slots.forEach(({idx, price, label}) => {
        const wrap = document.createElement('div');
        wrap.className = 'w-full flex flex-col items-center gap-2';

        const c = market[idx];
        const cardEl = document.createElement('div');
        const canBuy = currentPhaseIndex === 6 && !!c && p.gold >= price;
        cardEl.className = `card-frame shadow-sm group relative ${canBuy ? 'cursor-pointer' : (c ? 'opacity-60' : 'opacity-30')}`;
        cardEl.setAttribute('style', getCardFrameStyleVars('market'));

        if (c) {
            cardEl.innerHTML = renderCardContentHTML(c, typeColors, {showTooltip: true});
            // 市場卡也用 portal tooltip，避免被右側面板的 overflow 裁切
            attachCardTooltip(cardEl, {title: c.effectName, desc: c.effectDesc});
            if (canBuy) {
                cardEl.classList.add('ring-2', 'ring-amber-300');
                cardEl.onclick = () => buyMarketCard(idx);
            }
        } else {
            cardEl.innerHTML = `<div class="flex-1 flex items-center justify-center text-[10px] font-black text-slate-300 tracking-widest">空</div>`;
        }

        const meta = document.createElement('div');
        meta.className = 'w-full flex items-center justify-between px-1';
        meta.innerHTML = `
            <div class="text-[10px] font-black text-slate-500">${label}</div>
            ${renderGoldDots(price)}
        `;

        wrap.appendChild(cardEl);
        wrap.appendChild(meta);
        body.appendChild(wrap);
    });

    panel.appendChild(body);
    return panel;
}

// --- Interaction Handlers ---

function rollDice(count) {
    if (currentPhaseIndex !== 1) return;
    if (diceResults.length > 0) return;

    const p = getCurrentPlayer();
    const luckyIdx = p.activeAreaEffects.findIndex(c => c && c.effectId === 'lucky');
    let finalCount = count;
    
    if (luckyIdx !== -1) {
        finalCount = count + 1;
        luckySelectionMode = true;
        luckySourceAreaIdx = luckyIdx;
        addLog(`[幸運] 啟動！額外投擲一顆骰子 (總計 ${finalCount} 顆)`);
    }

    diceResults = [];
    for (let i = 0; i < finalCount; i++) {
        diceResults.push(Math.floor(Math.random() * 6) + 1);
    }
    console.log(`擲骰結果: ${diceResults}`);
    render();
}

function removeLuckyDie(idx) {
    if (!luckySelectionMode) return;
    
    const removedVal = diceResults[idx];
    diceResults.splice(idx, 1);
    luckySelectionMode = false;
    luckySourceAreaIdx = -1;
    
    addLog(`[幸運] 移除了骰子 ${removedVal}`);
    render();
}

function selectHandCard(idx) {
    if (currentPhaseIndex !== 0) return;
    selectedHandCardIndex = idx;
    render();
}

function playToBoard(areaIdx) {
    if (currentPhaseIndex !== 0) return;
    if (selectedHandCardIndex === -1) return;

    const p = getCurrentPlayer();

    // One-time Preparation Phase rule: 後手只能打出 1 張，且必須先打完才可開始遊戲
    if (inPreparationPhase) {
        if (currentPlayerIndex !== 1) return;
        if (p.cardsPlayedThisTurn >= 1) {
            alert('準備階段只能打出 1 張牌');
            return;
        }
    }

    if (p.cardsPlayedThisTurn >= 3) {
        alert('每回合最多出 3 張牌');
        return;
    }

    const card = p.hand.splice(selectedHandCardIndex, 1)[0];
    p.board[areaIdx].push(card);
    
    // Update active effect for the area
    p.activeAreaEffects[areaIdx] = card;

    p.cardsPlayedThisTurn += 1;
    selectedHandCardIndex = -1;
    
    if (inPreparationPhase) {
        phaseHint = '準備完成：按開始';
    } else {
        phaseHint = `已出 ${p.cardsPlayedThisTurn}/3`;
    }
    console.log(`玩家出牌: ${card.name} 到區域 ${areaIdx + 1}`);

    render();
}

function useBarrier(areaIdx) {
    if (currentPhaseIndex !== 3) return; // Defense Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'barrier') {
        if (p.barrierUsedIndices.includes(areaIdx)) {
            alert('這張屏障卡本回合已使用過');
            return;
        }
        if (p.magic >= 3) {
            p.magic -= 3;
            p.defense += 3;
            p.barrierUsedIndices.push(areaIdx);
            addLog(`${p.name} 使用了「屏障」，消耗 3 點魔力增加 3 點防禦`);
            render();
        } else {
            alert('魔力不足 (需要 3 點)');
        }
    }
}

function useCharge(areaIdx, hitIdx = -1) {
    if (currentPhaseIndex !== 5) return; 
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    
    if (chargeSelectionMode) {
        // Step 2: Selecting specific target hit
        if (hitIdx !== -1 && p.currentAttacks[areaIdx][hitIdx] > 0) {
            if (p.magic >= 2) {
                p.magic -= 2;
                p.currentAttacks[areaIdx][hitIdx] += 3;
                if (chargeSourceAreaIdx !== -1) {
                    p.chargeUsedIndices.push(chargeSourceAreaIdx);
                }
                chargeSelectionMode = false;
                chargeSourceAreaIdx = -1;
                render();
            } else {
                alert('魔力不足 (需要 2 點)');
                chargeSelectionMode = false;
                chargeSourceAreaIdx = -1;
                render();
            }
        } else if (hitIdx === -1) {
             // If they clicked the area but not a specific badge
             render();
        } else {
            alert('無法對該數值進行充能');
        }
    } else {
        // Step 1: Selecting the charge source card
        const card = p.activeAreaEffects[areaIdx];
        if (card && getEffectiveEffectId(p, areaIdx) === 'charge') {
            if (p.chargeUsedIndices.includes(areaIdx)) {
                alert('這張充能卡本回合已使用過');
                return;
            }
            if (p.magic >= 2) {
                chargeSelectionMode = true;
                chargeSourceAreaIdx = areaIdx;
                render();
            } else {
                alert('魔力不足 (需要 2 點)');
            }
        }
    }
}

function useMagicBullet(areaIdx) {
    if (currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        alert('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }

    // Directly use the card in the clicked area to add an attack hit
    const card = p.activeAreaEffects[areaIdx];
    if (card && getEffectiveEffectId(p, areaIdx) === 'magic_bullet') {
        if (p.magic >= 1) {
            p.magic -= 1;
            // PUSH A NEW ATTACK INSTANCE to the same area
            p.currentAttacks[areaIdx].push(2);
            render();
        } else {
            alert('魔力不足 (需要 1 點)');
        }
    }
}

// --- Render ---

function isMobileLayout() {
    // 直向手機優先：用寬度作為主要斷點即可
    return window.innerWidth <= 768;
}

function toggleHandDrawer() {
    handDrawerOpen = !handDrawerOpen;
    render();
}

function toggleMobileOpponentBoard() {
    mobileOpponentBoardOpen = !mobileOpponentBoardOpen;
    hideGlobalTooltip();
    render();
}

function setMobileDockTab(tab: 'hand' | 'market') {
    mobileDockTab = tab;
    handDrawerOpen = true;
    render();
}

function getMobileCardFrameStyleVars(size: 'board' | 'hand' | 'market') {
    if (size === 'board') {
        return '--card-w: 70px; --card-h: 90px; --header-h: 20px; --chip: 14px; --chip-font: 7px; --title-font: 9px;';
    }
    if (size === 'hand') {
        return '--card-w: 56px; --card-h: 74px; --header-h: 20px; --chip: 14px; --chip-font: 7px; --title-font: 9px;';
    }
    // market
    return '--card-w: 56px; --card-h: 74px; --header-h: 20px; --chip: 14px; --chip-font: 7px; --title-font: 9px;';
}

function renderMobileTopBar(typeColors) {
    const wrap = document.createElement('div');
    wrap.className = 'h-12 px-3 border-b border-slate-200 bg-white/90 backdrop-blur flex items-center justify-between shrink-0';

    // Left: info button (effects list)
    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    left.innerHTML = `
        <button id="infoBtn" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 active:scale-95 shadow-sm border border-slate-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        </button>
        <div class="text-[10px] font-black text-slate-700 tracking-wider">${inPreparationPhase ? '準備' : PHASE_NAMES[currentPhaseIndex]}</div>
    `;
    (left.querySelector('#infoBtn') as HTMLElement).onclick = toggleEffectList;

    // Center: phase hint (mobile 版縮小字體，避免擠壓左右按鈕)
    const center = document.createElement('div');
    center.className = 'absolute left-1/2 -translate-x-1/2 max-w-[58%] text-center';

    let displayPhaseHint = phaseHint;
    if (luckySelectionMode) {
        displayPhaseHint = '幸運：移除1骰';
    }
    if (illusionSelectionMode) {
        displayPhaseHint = '幻象：選對手卡';
    }

    // 讓 mobile 的提示字比桌機更小、且單行截斷
    center.innerHTML = `
        <div class="text-[9px] font-black text-slate-500 tracking-wider whitespace-nowrap overflow-hidden text-ellipsis">
            ${displayPhaseHint || ''}
        </div>
    `;

    // Right: actions
    const right = document.createElement('div');
    right.className = 'flex items-center gap-2';

    // Game over: show restart only
    if (winner) {
        const btn = document.createElement('button');
        btn.className = 'bg-indigo-600 text-white px-3 py-2 rounded-lg font-black text-[10px] uppercase tracking-wider active:scale-95';
        btn.innerText = '新遊戲';
        btn.onclick = () => location.reload();
        right.appendChild(btn);
    } else

    if (inPreparationPhase) {
        const btn = document.createElement('button');
        const prepDone = players[1].cardsPlayedThisTurn >= 1;
        btn.className = `px-3 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all ${prepDone ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-300'}`;
        btn.innerText = '開始';
        if (prepDone) {
            btn.onclick = () => {
                inPreparationPhase = false;
                currentPlayerIndex = 0;
                currentPhaseIndex = 0;
                selectedHandCardIndex = -1;
                diceResults = [];
                skippedPlayBecauseNoHand = false;
                // Mobile：出牌階段時手牌抽屜自動彈出
                // 並切到手牌 tab
                mobileDockTab = 'hand';
                handDrawerOpen = isMobileLayout();
                players[0].cardsPlayedThisTurn = 0;
                players[1].cardsPlayedThisTurn = 0;
                phaseHint = '選牌出牌';
                render();
            };
        }
        right.appendChild(btn);
    } else if (currentPhaseIndex === 1 && diceResults.length === 0) {
        const p = getCurrentPlayer();
        const shouldRollFiveBecauseNoHand = p.hand.length === 0 && p.cardsPlayedThisTurn === 0;
        const rollOptions = shouldRollFiveBecauseNoHand
            ? [5]
            : (p.cardsPlayedThisTurn > 0 ? [5 - p.cardsPlayedThisTurn] : [2, 3, 4]);
        rollOptions.forEach(count => {
            const btn = document.createElement('button');
            btn.className = 'bg-slate-900 text-white px-3 py-2 rounded-lg font-black text-[10px] uppercase tracking-wider active:scale-95';
            btn.innerText = `擲骰${count}`;
            btn.onclick = () => rollDice(count);
            right.appendChild(btn);
        });
    } else if (fateSelectionMode) {
        const btn = document.createElement('button');
        btn.className = 'bg-amber-600 text-white px-3 py-2 rounded-lg font-black text-[10px] uppercase tracking-wider active:scale-95';
        btn.innerText = `重擲(${fateSelectedDiceIndices.length})`;
        btn.onclick = confirmFate;
        right.appendChild(btn);
    } else {
        const btn = document.createElement('button');
        const isActionBlocked = (currentPhaseIndex === 1 && diceResults.length === 0) || luckySelectionMode;
        const label = currentPhaseIndex === 6 ? '結束' : currentPhaseIndex === 4 ? '結算' : '繼續';
        btn.className = `px-3 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all ${isActionBlocked ? 'bg-slate-100 text-slate-300' : 'bg-indigo-600 text-white active:scale-95'}`;
        btn.innerText = label;
        if (!isActionBlocked) btn.onclick = nextPhase;
        right.appendChild(btn);
    }

    // 需要 relative 才能讓 center 用 absolute 置中
    wrap.classList.add('relative');
    wrap.appendChild(left);
    wrap.appendChild(center);
    wrap.appendChild(right);
    return wrap;
}

function renderMobileMarketRow(typeColors) {
    const p = getCurrentPlayer();
    const row = document.createElement('div');
    // Dock 內會再包一層 container，所以這裡避免再加 border-y，否則會有「雙層邊框」
    // 且會讓內容看起來像被切割、並浪費空間。
    // 多留一點上下空間：避免 ring(發光) 貼邊時看起來被裁切
    row.className = 'px-3 pt-3 pb-4 bg-transparent shrink-0';

    // 依需求：市場 dock 內不顯示 BUY / 金幣文字（tab 本身即是標題）
    void p;

    const list = document.createElement('div');
    // 讓 ring(發光) 在上下不容易被 scroll 容器裁切
    list.className = 'flex gap-3 overflow-x-auto overflow-y-visible px-1 pt-1 pb-2';
    list.addEventListener('scroll', hideGlobalTooltip);

    // Deck buy card (left)
    const nextDrawIndex = buyDeckDrawCount + 1;
    const nextDrawCost = getDeckDrawCost(nextDrawIndex);
    const canDraw = currentPhaseIndex === 6 && deck.length > 0 && Number.isFinite(nextDrawCost) && p.gold >= nextDrawCost;
    const mustDraw = currentPhaseIndex === 6 && buyDeckDrawCount < 1;

    const deckCard = document.createElement('div');
    deckCard.className = `card-frame shadow-sm relative flex items-center justify-center ${canDraw ? 'cursor-pointer' : 'opacity-60'}`;
    deckCard.setAttribute('style', `${getMobileCardFrameStyleVars('market')} background: linear-gradient(135deg, #0f172a, #1e293b); border-color: #334155;`);
    deckCard.innerHTML = `<div class="flex flex-col items-center justify-center text-white"><div class="text-[10px] font-black tracking-[0.25em]">DECK</div><div class="text-[10px] font-bold opacity-80 mt-1">${deck.length}</div></div>`;
    if (canDraw) {
        // ring 稍微細一點，避免佔用太多空間
        deckCard.classList.add('ring-2', mustDraw ? 'ring-emerald-400' : 'ring-indigo-300');
        deckCard.onclick = buyFromDeck;
    }

    // 顯示「抽牌成本」在牌庫卡下方（動態）
    const deckCostTag = document.createElement('div');
    deckCostTag.className = 'mt-1 text-[10px] font-black text-slate-500 text-center';
    deckCostTag.innerText = (deck.length === 0 || !Number.isFinite(nextDrawCost))
        ? '—'
        : `-${nextDrawCost}金幣`;

    const deckWrap = document.createElement('div');
    deckWrap.className = 'flex flex-col items-center';
    deckWrap.appendChild(deckCard);
    deckWrap.appendChild(deckCostTag);
    list.appendChild(deckWrap);

    // 市場顯示順序：價格3 -> 價格2 -> 價格1（最便宜在最右）
    // 對應 market index: 0=price3, 1=price2, 2=price1
    const slots: Array<{idx: 0 | 1 | 2; price: number}> = [
        {idx: 0, price: 3},
        {idx: 1, price: 2},
        {idx: 2, price: 1},
    ];
    slots.forEach(({idx, price}) => {
        const c = market[idx];
        const cardEl = document.createElement('div');
        const canBuy = currentPhaseIndex === 6 && !!c && p.gold >= price;
        cardEl.className = `card-frame shadow-sm group relative ${canBuy ? 'cursor-pointer' : (c ? 'opacity-60' : 'opacity-30')}`;
        cardEl.setAttribute('style', getMobileCardFrameStyleVars('market'));
        if (c) {
            cardEl.innerHTML = renderCardContentHTML(c, typeColors, {showTooltip: true});
            attachCardTooltip(cardEl, {title: c.effectName, desc: c.effectDesc});
            if (canBuy) {
                // ring 稍微細一點，避免佔用太多空間
                cardEl.classList.add('ring-2', 'ring-amber-300');
                cardEl.onclick = () => buyMarketCard(idx);
            }
        } else {
            cardEl.innerHTML = `<div class="flex-1 flex items-center justify-center text-[10px] font-black text-slate-300 tracking-widest">空</div>`;
        }
        // price tag
        const priceTag = document.createElement('div');
        priceTag.className = 'mt-1 text-[10px] font-black text-slate-500 text-center';
        priceTag.innerText = `-${price}金幣`;
        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col items-center';
        wrap.appendChild(cardEl);
        wrap.appendChild(priceTag);
        list.appendChild(wrap);
    });

    row.appendChild(list);
    return row;
}

function renderMobilePlayerBlock(
    idx,
    typeColors,
    {position, showBoard}: {position: 'top' | 'bottom'; showBoard: boolean}
) {
    const p = players[idx];
    const isCurrent = currentPlayerIndex === idx;

    const wrap = document.createElement('div');
    wrap.className = `px-3 py-2 ${position === 'top' ? 'bg-white' : 'bg-[#fafbfc]'} shrink-0`;

    // compact header
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between';
    header.innerHTML = `
        <div class="flex items-end gap-2">
            <div class="text-2xl font-black ${isCurrent ? 'text-indigo-600' : 'text-slate-400'} tracking-tight">${p.hp}</div>
            <div class="text-[10px] font-black text-slate-500 tracking-widest">${p.name}${isCurrent ? '（回合）' : ''}</div>
        </div>
        ${position === 'bottom' ? `
            <div class="flex items-center gap-2">
                <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-[10px] font-black text-emerald-700">魔 ${p.magic}</div>
                <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 border border-blue-100 text-[10px] font-black text-blue-700">防 ${p.defense}</div>
                <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 border border-amber-100 text-[10px] font-black text-amber-700">金 ${p.gold}</div>
            </div>
        ` : ''}
    `;
    wrap.appendChild(header);

    // Top（對手）：提供「展開/收合」按鈕
    if (position === 'top' && !isCurrent) {
        const btn = document.createElement('button');
        btn.className = 'px-2 py-1 rounded-full border border-slate-200 bg-white text-slate-600 text-[10px] font-black tracking-widest active:scale-95';
        btn.innerText = mobileOpponentBoardOpen ? '場地▼' : '場地▲';
        btn.onclick = (e) => {
            e.stopPropagation();
            toggleMobileOpponentBoard();
        };
        header.appendChild(btn);
    }

    // 對手場地收合時，仍顯示攻擊 UI（供防禦/閃避等使用）
    if (position === 'top' && !isCurrent && !showBoard) {
        const preview = document.createElement('div');
        preview.className = 'mt-2 px-1';

        const row = document.createElement('div');
        // 更扁的預覽列：避免佔用上方空間
        row.className = 'flex items-center justify-center gap-2';

        const cur = getCurrentPlayer();
        const hasAnyAtk = p.attackQueue.some(list => list.some(v => v > 0)) || (p.piercingQueue?.some(list => list.some(v => v > 0)) ?? false);

        [0, 1, 2].forEach((aIdx) => {
            const col = document.createElement('div');
            // 移除「區域1~3」文字，整體更扁
            col.className = 'flex-1 min-w-[90px] rounded-lg border border-slate-100 bg-white/70 px-1.5 py-1';

            const badges = document.createElement('div');
            badges.className = 'flex flex-wrap items-center justify-center gap-1';

            const hits = p.attackQueue[aIdx] || [];
            hits.forEach((atkVal, hitIdx) => {
                if (atkVal === 0) return;
                let displayVal = atkVal;
                let isFullyBlocked = false;
                if (currentPhaseIndex === 3 || currentPhaseIndex === 4) {
                    displayVal = Math.max(0, atkVal - cur.defense);
                    if (displayVal <= 0) isFullyBlocked = true;
                }

                const b = document.createElement('div');
                const bgColor = isFullyBlocked ? 'bg-slate-400' : 'bg-red-500';
                const activeColor = evasionSelectionMode ? 'bg-amber-500 scale-110 ring-2 ring-amber-200 cursor-pointer animate-pulse' : bgColor;
                b.className = `text-white text-[11px] font-black px-2 py-0.5 rounded-md shadow border border-white transition-all ${activeColor}`;
                b.innerText = displayVal.toString();
                if (evasionSelectionMode) {
                    b.onclick = (e) => {
                        e.stopPropagation();
                        targetEvasion(aIdx, hitIdx);
                    };
                }
                badges.appendChild(b);
            });

            const pHits = (p.piercingQueue && p.piercingQueue[aIdx]) ? p.piercingQueue[aIdx] : [];
            pHits.forEach((atkVal) => {
                if (atkVal === 0) return;
                const b = document.createElement('div');
                b.className = 'text-white text-[11px] font-black px-2 py-0.5 rounded-md shadow border border-white bg-purple-600';
                b.innerText = atkVal.toString();
                badges.appendChild(b);
            });

            if (!hasAnyAtk) {
                const empty = document.createElement('div');
                empty.className = 'text-[10px] font-black text-slate-300 tracking-widest text-center';
                empty.innerText = '—';
                col.appendChild(empty);
            } else {
                col.appendChild(badges);
            }

            row.appendChild(col);
        });

        preview.appendChild(row);
        wrap.appendChild(preview);
    }

    if (showBoard) {
        // Mobile：場地顯示方式要跟桌機一致（3 區橫向排列）
        // 直接重用既有 renderPlayerArea() 中的 Board 佈局邏輯會太難抽離，
        // 這裡採用「簡化版複製」：沿用原本每區是直向卡牌堆疊、三區橫向。
        const board = document.createElement('div');
        // 往下留一點空間給骰子浮層（避免蓋到卡牌）
        board.className = 'mt-6 flex items-start justify-center gap-1';

        [0, 1, 2].forEach(aIdx => {
            const zone = document.createElement('div');
            zone.className = `relative flex flex-col items-center gap-1 p-1 rounded-2xl transition-all border border-transparent ${currentPhaseIndex === 2 && diceResults.some(d => Math.floor((d-1)/2) === aIdx) ? 'bg-indigo-50/50 border-indigo-100 shadow-sm' : 'bg-slate-50/30'}`;

            const labelL = aIdx * 2 + 1;
            const labelR = aIdx * 2 + 2;
            const baseAttrs = idx === 0
                ? ['attack', 'defense', 'magic', 'gold', 'gold', 'attack']
                : ['gold', 'magic', 'magic', 'attack', 'attack', 'defense'];
            const baseL = baseAttrs[aIdx * 2];
            const baseR = baseAttrs[aIdx * 2 + 1];

            zone.innerHTML = `
                <div class="flex w-full justify-around items-center mb-0 pt-6">
                    <div class="flex flex-col items-center w-1/2 border-r border-slate-50 opacity-80">
                        <span class="text-[9px] font-black text-slate-400 leading-none mb-0.5">${labelL}</span>
                        <div class="attr-chip-hand ${typeColors[baseL]} shadow-sm">1</div>
                    </div>
                    <div class="flex flex-col items-center w-1/2 opacity-80">
                        <span class="text-[9px] font-black text-slate-400 leading-none mb-0.5">${labelR}</span>
                        <div class="attr-chip-hand ${typeColors[baseR]} shadow-sm">1</div>
                    </div>
                </div>
            `;

            const slot = document.createElement('div');
            slot.className = `minimal-slot w-[150px] h-[120px] border-2 border-dashed border-slate-200 bg-white/50 rounded-2xl relative transition-all ${isCurrent && currentPhaseIndex === 0 && selectedHandCardIndex !== -1 ? 'hover:border-indigo-400 cursor-pointer hover:bg-white' : ''}`;
            if (isCurrent && currentPhaseIndex === 0 && selectedHandCardIndex !== -1) slot.onclick = () => playToBoard(aIdx);

            const atkContainer = document.createElement('div');
            atkContainer.className = 'absolute -bottom-4 left-0 right-0 flex justify-center gap-1.5 z-40';
            const effects = isCurrent ? p.currentAttacks[aIdx] : p.attackQueue[aIdx];
            effects.forEach((atkVal, hitIdx) => {
                if (atkVal === 0) return;
                const atkBadge = document.createElement('div');
                let displayVal = atkVal;
                let isFullyBlocked = false;
                if (!isCurrent && (currentPhaseIndex === 3 || currentPhaseIndex === 4)) {
                    const currentPlayer = getCurrentPlayer();
                    displayVal = Math.max(0, atkVal - currentPlayer.defense);
                    if (displayVal <= 0) isFullyBlocked = true;
                }
                const canBeDodged = !isCurrent && evasionSelectionMode;
                const isChargeTarget = isCurrent && chargeSelectionMode;
                const isReproductionTarget = isCurrent && reproductionSelectionMode;
                const isFlareTarget = isCurrent && flareSelectionMode;
                const bgColor = isFullyBlocked ? 'bg-slate-400' : 'bg-red-500';
                const activeColor = (isChargeTarget || canBeDodged || isReproductionTarget || isFlareTarget) ? 'bg-amber-500 scale-110 ring-2 ring-amber-200 cursor-pointer animate-pulse' : bgColor;
                atkBadge.className = `text-white text-[11px] font-black px-2 py-0.5 rounded-md shadow-lg border-2 border-white transition-all ${activeColor}`;
                atkBadge.innerText = displayVal.toString();
                if (isChargeTarget) atkBadge.onclick = (e) => { e.stopPropagation(); useCharge(aIdx, hitIdx); };
                else if (canBeDodged) atkBadge.onclick = (e) => { e.stopPropagation(); targetEvasion(aIdx, hitIdx); };
                else if (isReproductionTarget) atkBadge.onclick = (e) => { e.stopPropagation(); targetReproduction(aIdx, hitIdx); };
                else if (isFlareTarget) atkBadge.onclick = (e) => { e.stopPropagation(); targetFlare(aIdx, hitIdx); };
                atkContainer.appendChild(atkBadge);
            });
            const pEffects = isCurrent ? p.piercingAttacks[aIdx] : p.piercingQueue[aIdx];
            pEffects.forEach(atkVal => {
                const atkBadge = document.createElement('div');
                atkBadge.className = 'text-white text-[11px] font-black px-2 py-0.5 rounded-md shadow-lg border-2 border-white bg-purple-600';
                atkBadge.innerText = atkVal.toString();
                atkContainer.appendChild(atkBadge);
            });
            slot.appendChild(atkContainer);

            const stack = p.board[aIdx];
            stack.forEach((card, cIdx) => {
                const cardEl = document.createElement('div');
                const isTop = (cIdx === stack.length - 1);
                const isActiveEffect = (p.activeAreaEffects[aIdx] === card);
                const effId = isActiveEffect ? getEffectiveEffectId(p, aIdx) : card.effectId;
                cardEl.className = `card-frame shadow-sm group absolute left-1/2 -translate-x-1/2 transition-all duration-300 overflow-visible ${isTop ? 'z-10' : 'z-0'} hover:z-[100]`;
                cardEl.setAttribute('style', getMobileCardFrameStyleVars('board'));
                cardEl.style.top = `${cIdx * 18}px`;

                if (p.contractTriggeredAreaIdx === aIdx && isActiveEffect) cardEl.classList.add('ring-2', 'ring-red-500', 'z-50');
                if (effId === 'breakthrough' && isActiveEffect && p.hp <= 3) cardEl.classList.add('ring-2', 'ring-cyan-400', 'z-40');
                if (effId === 'mirage' && isActiveEffect) cardEl.classList.add('ring-2', 'ring-violet-500', 'z-40');
                if (card.effectId === 'illusion' && isActiveEffect && illusionSelectionMode && illusionSourceAreaIdx === aIdx) cardEl.classList.add('ring-2', 'ring-teal-400', 'z-40');
                if (effId === 'lucky' && isActiveEffect && isCurrent && currentPhaseIndex === 1 && (diceResults.length === 0 || luckySelectionMode)) cardEl.classList.add('ring-2', 'ring-lime-400', 'z-40');

                const displayEffectName = (card.effectId === 'illusion' && p.illusionCopiedEffectIds[aIdx])
                    ? `幻象幽影[${EFFECTS.find(e => e.id === p.illusionCopiedEffectIds[aIdx])?.name || ''}]`
                    : card.effectName;
                const nameForUI = (isTop && isActiveEffect) ? displayEffectName : card.effectName;
                cardEl.innerHTML = renderCardContentHTML({...card, effectName: nameForUI}, typeColors, {showTooltip: isTop && isActiveEffect});
                if (isTop && isActiveEffect) {
                    let tooltipDesc = card.effectDesc;
                    if (card.effectId === 'illusion' && p.illusionCopiedEffectIds[aIdx]) {
                        tooltipDesc = EFFECTS.find(e => e.id === p.illusionCopiedEffectIds[aIdx])?.desc || tooltipDesc;
                    }
                    attachCardTooltip(cardEl, {title: nameForUI, desc: tooltipDesc});
                }

                // Mobile：主動效果（可點擊）與發光提示
                // 先前只在桌機 renderPlayerArea() 綁定，導致手機版無法觸發。
                if (isCurrent && isTop && isActiveEffect) {
                    const isMirageBlocked = isMirageActive();
                    if (currentPhaseIndex === 5 && effId === 'charge') {
                        if (p.magic >= 2 && !p.chargeUsedIndices.includes(aIdx) && !isMirageBlocked) {
                            const isSource = chargeSelectionMode && chargeSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useCharge(aIdx); };
                        }
                    } else if (currentPhaseIndex === 5 && effId === 'magic_bullet') {
                        if (p.magic >= 1 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-emerald-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useMagicBullet(aIdx); };
                        }
                    } else if (currentPhaseIndex === 5 && effId === 'amplify') {
                        // Amplify is free: Only pulse if THIS specific area's amplify not used
                        if (!p.amplifyUsedIndices.includes(aIdx)) {
                            cardEl.classList.add('ring-2', 'ring-blue-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useAmplify(aIdx); };
                        }
                    } else if ((currentPhaseIndex === 1 || currentPhaseIndex === 2) && effId === 'fate') {
                        // Fate: Re-roll dice (usable in Roll phase after roll, or Judging phase)
                        const diceRolled = diceResults.length > 0;
                        if (!p.fateUsedIndices.includes(aIdx) && diceRolled && !luckySelectionMode) {
                            cardEl.classList.add('ring-2', fateSelectionMode ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useFate(aIdx); };
                        }
                    } else if (currentPhaseIndex === 3 && effId === 'dodge') {
                        // Dodge: Ignore incoming attack in Defense Phase
                        const opp = getOpponent();
                        const hasDodgeableAttacks = opp.attackQueue.flat().length > 0;
                        if (!p.evasionUsedIndices.includes(aIdx) && p.magic >= 3 && hasDodgeableAttacks && !isMirageBlocked) {
                            const isSource = evasionSelectionMode && evasionSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useEvasion(aIdx); };
                        }
                    } else if (currentPhaseIndex === 3 && effId === 'barrier') {
                        // Modified Barrier: Consume 3 magic for 3 defense in Defense Phase
                        if (p.magic >= 3 && !p.barrierUsedIndices.includes(aIdx) && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useBarrier(aIdx); };
                        }
                    } else if (currentPhaseIndex === 3 && effId === 'shield') {
                        // Shield: Consume 2 magic for 1 defense in Defense Phase
                        if (p.magic >= 2 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-blue-300', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useShield(aIdx); };
                        }
                    } else if (currentPhaseIndex === 5 && effId === 'reproduction') {
                        // Reproduction: Consume 2 magic, make one attack twice
                        if (!p.reproductionUsedIndices.includes(aIdx) && p.magic >= 2 && !isMirageBlocked) {
                            const isSource = reproductionSelectionMode && reproductionSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useReproduction(aIdx); };
                        }
                    } else if (currentPhaseIndex === 5 && effId === 'flare') {
                        // Flare: Consume 3 magic, double one attack
                        if (!p.flareUsedIndices.includes(aIdx) && p.magic >= 3 && !isMirageBlocked) {
                            const isSource = flareSelectionMode && flareSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useFlare(aIdx); };
                        }
                    } else if (currentPhaseIndex === 5 && effId === 'thrust') {
                        // Thrust: Double all 1s and 2s
                        if (!p.thrustUsedIndices.includes(aIdx)) {
                            cardEl.classList.add('ring-2', 'ring-rose-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useThrust(aIdx); };
                        }
                    } else if (currentPhaseIndex === 5 && effId === 'forest') {
                        // Forest: Merge all attacks
                        if (!p.forestUsedIndices.includes(aIdx) && p.magic >= 3 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-emerald-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useForest(aIdx); };
                        }
                    } else if (currentPhaseIndex === 1 && effId === 'frost') {
                        // Frost: Discard a die for 1-3 extra attack
                        const diceRolled = diceResults.length > 0;
                        if (!p.frostUsedIndices.includes(aIdx) && diceRolled && !luckySelectionMode) {
                            const isSource = frostSelectionMode && frostSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-blue-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useFrost(aIdx); };
                        }
                    } else if (currentPhaseIndex === 2 && effId === 'magic_luck') {
                        if (p.magic >= 2 && !p.magicLuckUsedIndices.includes(aIdx) && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-purple-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useMagicLuck(aIdx); };
                        }
                    } else if (currentPhaseIndex === 2 && card.effectId === 'illusion') {
                        const opp = getOpponent();
                        const hasCopyableCard = opp.activeAreaEffects.some(c => c && c.effectId !== 'lucky' && c.effectId !== 'fate');
                        if (p.magic >= 1 && !p.illusionUsedIndices.includes(aIdx) && !isMirageBlocked && hasCopyableCard) {
                            cardEl.classList.add('ring-2', 'ring-teal-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useIllusion(aIdx); };
                        }
                    } else if ([2, 3, 4, 5].includes(currentPhaseIndex) && effId === 'holy_light') {
                        // Holy Light: Consume 2 magic for 1 HP
                        if (p.magic >= 2 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-yellow-300', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useHolyLight(aIdx); };
                        }
                    } else if ([2, 3, 4, 5].includes(currentPhaseIndex) && effId === 'soul_snatch') {
                        // Soul Snatch: Consume 3 magic to absorb 1 HP
                        if (p.magic >= 3 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-purple-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useSoulSnatch(aIdx); };
                        }
                    }
                }
                if (!isCurrent && isTop && isActiveEffect && illusionSelectionMode && card.effectId !== 'lucky' && card.effectId !== 'fate') {
                    cardEl.classList.add('ring-2', 'ring-teal-500', 'cursor-pointer', 'shadow-2xl', 'z-50');
                    cardEl.onclick = (e) => { e.stopPropagation(); targetIllusion(aIdx); };
                }
                slot.appendChild(cardEl);
            });

            if (isCurrent && diceResults.length > 0) {
                const dicePool = document.createElement('div');
                // 往上移：讓骰子顯示位置更接近桌機版「浮在場地上方」
                dicePool.className = 'absolute -top-12 inset-x-0 h-8 pointer-events-none z-30';
                let leftCount = 0;
                let rightCount = 0;
                diceResults.forEach((val, originalIdx) => {
                    const diceArea = Math.floor((val - 1) / 2);
                    if (diceArea !== aIdx) return;
                    const isLeftVal = (val % 2 !== 0);
                    const wrapper = document.createElement('div');
                    wrapper.className = 'absolute pointer-events-auto transition-all duration-300';
                    const countOnSide = isLeftVal ? leftCount++ : rightCount++;
                    wrapper.style.left = isLeftVal ? 'calc(25% - 12px)' : 'calc(75% - 12px)';
                    // 多顆骰子：改成「往上」堆疊（避免往下蓋到卡牌）
                    wrapper.style.top = `${-countOnSide * 10}px`;
                    const isSelected = fateSelectedDiceIndices.includes(originalIdx);
                    const isFrostTarget = frostSelectionMode;
                    const isLuckyTarget = luckySelectionMode;
                    const dIcon = document.createElement('div');
                    const diceColorClass = isSelected ? 'bg-amber-500 text-white ring-amber-300 animate-pulse' : (isFrostTarget ? 'bg-blue-400 text-white ring-blue-200 animate-pulse' : (isLuckyTarget ? 'bg-lime-500 text-white ring-lime-200 animate-pulse' : 'bg-slate-900 text-white ring-white'));
                    dIcon.className = `w-6 h-6 rounded shadow-xl flex items-center justify-center font-black text-[10px] ring-2 ${diceColorClass} ${fateSelectionMode || frostSelectionMode || luckySelectionMode ? 'cursor-pointer active:scale-95' : ''}`;
                    dIcon.innerText = val.toString();
                    if (fateSelectionMode) dIcon.onclick = () => toggleDiceIndexSelection(originalIdx);
                    else if (frostSelectionMode) dIcon.onclick = () => targetFrost(originalIdx);
                    else if (luckySelectionMode) dIcon.onclick = () => removeLuckyDie(originalIdx);
                    wrapper.appendChild(dIcon);
                    dicePool.appendChild(wrapper);
                });
                slot.appendChild(dicePool);
            }

            zone.appendChild(slot);
            board.appendChild(zone);
        });

        wrap.appendChild(board);
    }
    return wrap;
}

function renderMobileHandDrawer(typeColors) {
    const p = getCurrentPlayer();
    const drawer = document.createElement('div');
    drawer.className = 'fixed left-0 right-0 bottom-0 z-[1200]';

    // Header：只保留「切換」作為標題（同一行）
    const header = document.createElement('div');
    header.className = 'w-full bg-slate-900 text-white px-3 py-2 flex items-center justify-between border-t border-slate-800';
    // 點 header 空白可收合/展開；按鈕會 stopPropagation
    header.onclick = toggleHandDrawer;

    const tabs = document.createElement('div');
    tabs.className = 'flex items-center gap-2';
    const tabBtn = (id: 'market' | 'hand', label: string) => {
        const b = document.createElement('button');
        const active = mobileDockTab === id;
        b.className = `px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase border ${active ? 'bg-white text-slate-900 border-white' : 'bg-slate-900 text-slate-200 border-slate-700'}`;
        b.innerText = label;
        b.onclick = (e) => {
            e.stopPropagation();
            setMobileDockTab(id);
        };
        return b;
    };
    tabs.appendChild(tabBtn('market', 'MARKET'));
    tabs.appendChild(tabBtn('hand', 'HAND'));

    const arrow = document.createElement('button');
    arrow.className = 'text-[12px] font-black tracking-widest uppercase text-slate-200 px-2';
    arrow.innerText = handDrawerOpen ? '▼' : '▲';
    arrow.onclick = (e) => {
        e.stopPropagation();
        toggleHandDrawer();
    };

    header.appendChild(tabs);
    header.appendChild(arrow);
    drawer.appendChild(header);

    if (handDrawerOpen) {
        const body = document.createElement('div');

        // 若顯示市場：讓 market row 自己控制 padding，避免「外層 + 內層」雙重 padding/border
        // 任意階段皆可瀏覽市場（但只有購買階段能真的買）
        const isMarketDock = mobileDockTab === 'market';
        body.className = isMarketDock
            ? 'bg-white border-t border-slate-200 p-0'
            : 'bg-white border-t border-slate-200 px-3 py-3';

        // Dock: show market / hand by tab
        if (isMarketDock) {
            body.appendChild(renderMobileMarketRow(typeColors));
        } else {
            const list = document.createElement('div');
            // 手牌超過一定數量時：維持卡牌寬度，不縮小，改用左右滑動查看
            list.className = 'flex gap-3 overflow-x-auto pb-1';
            list.addEventListener('scroll', hideGlobalTooltip);
            p.hand.forEach((card, hIdx) => {
                const cardEl = document.createElement('div');
                const isSelected = selectedHandCardIndex === hIdx;
                // shrink-0：避免被 flex 壓縮，確保可左右滑動
                cardEl.className = `card-frame shrink-0 shadow-sm group relative transition-all ${currentPhaseIndex === 0 ? 'cursor-pointer' : 'opacity-60'} ${isSelected ? 'border-indigo-600 ring-2 ring-indigo-50 scale-105' : ''}`;
                cardEl.setAttribute('style', getMobileCardFrameStyleVars('hand'));
                cardEl.innerHTML = renderCardContentHTML(card, typeColors, {showTooltip: true});
                attachCardTooltip(cardEl, {title: card.effectName, desc: card.effectDesc});
                if (currentPhaseIndex === 0) cardEl.onclick = () => selectHandCard(hIdx);
                list.appendChild(cardEl);
            });
            if (p.hand.length === 0) {
                list.innerHTML = `<div class="w-full text-[10px] font-bold text-slate-300 uppercase tracking-widest italic text-center">空</div>`;
            }
            body.appendChild(list);
        }
        drawer.appendChild(body);
    }
    return drawer;
}

function renderMobileLayout(typeColors) {
    const container = document.createElement('div');
    container.className = 'h-screen w-full bg-[#f8fafc] text-[#0f172a] font-sans overflow-hidden flex flex-col';

    container.appendChild(renderMobileTopBar(typeColors));

    const oppIdx = getOpponentIndex();
    const curIdx = currentPlayerIndex;

    // Mobile：平常不顯示對手場地以節省空間；但玩家可手動展開。
    // 另外在需要點選對手目標的模式下（例如幻象/閃避）強制顯示。
    const needsOpponentTargets = illusionSelectionMode || evasionSelectionMode;
    const showOpponentBoard = needsOpponentTargets || mobileOpponentBoardOpen;

    const scroller = document.createElement('div');
    // 留出底部抽屜 handle 高度（約 40px） + 展開時卡列高度，由抽屜本身覆蓋即可
    scroller.className = 'flex-1 overflow-y-auto pb-14';
    scroller.addEventListener('scroll', hideGlobalTooltip);

    // 上方預設只顯示對手資訊；在需要點對手目標的模式下才顯示對手場地
    scroller.appendChild(renderMobilePlayerBlock(oppIdx, typeColors, {position: 'top', showBoard: showOpponentBoard}));

    // 購買階段市場改到下方 dock（與手牌同位置）

    // 下方顯示當回合玩家（顯示場地）
    scroller.appendChild(renderMobilePlayerBlock(curIdx, typeColors, {position: 'bottom', showBoard: true}));

    container.appendChild(scroller);
    container.appendChild(renderMobileHandDrawer(typeColors));
    return container;
}

function render() {
    const root = document.getElementById('root');
    root.innerHTML = '';
    // rerender 時先關閉 tooltip（避免舊 tooltip 懸在畫面上）
    hideGlobalTooltip();

    const typeColors = {
        attack: 'bg-red-500',
        defense: 'bg-blue-500',
        magic: 'bg-emerald-500',
        gold: 'bg-amber-500'
    };

    // Mobile layout (<=768px)
    if (isMobileLayout()) {
        root.appendChild(renderMobileLayout(typeColors));

        // Winner modal (mobile)
        const win = renderWinModalOverlay();
        if (win) root.appendChild(win);

        // 手機版仍然需要效果列表 modal（沿用原本的 showEffectList render）
        if (showEffectList) {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1500] flex items-center justify-center p-4';
            overlay.onclick = () => { showEffectList = false; render(); };
            const modal = document.createElement('div');
            modal.className = 'bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[80vh]';
            modal.onclick = (e) => e.stopPropagation();
            modal.innerHTML = `
                <div class="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 class="font-black text-slate-800 tracking-tight">卡牌一覽</h3>
                    <button id="closeModal" class="text-slate-400 hover:text-slate-600 transition-colors p-1">×</button>
                </div>
                <div class="overflow-y-auto p-3 flex flex-col gap-2 bg-slate-50/30">
                    ${CARD_DEFS.map(def => `
                        <div class="p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                            <div class="flex items-center justify-between gap-2 mb-0.5">
                                <div class="text-indigo-600 font-extrabold text-sm">${def.name}</div>
                                <div class="flex items-center gap-1.5 shrink-0">
                                    <span class="card-frame-chip ${typeColors[def.left.type]}" style="--chip: 16px; --chip-font: 8px;">${def.left.value}</span>
                                    <span class="card-frame-chip ${typeColors[def.right.type]}" style="--chip: 16px; --chip-font: 8px;">${def.right.value}</span>
                                </div>
                            </div>
                            <div class="text-slate-600 text-[11px] font-bold leading-relaxed">${def.desc}</div>
                        </div>
                    `).join('')}
                </div>
            `;
            (modal.querySelector('#closeModal') as HTMLElement).onclick = toggleEffectList;
            overlay.appendChild(modal);
            root.appendChild(overlay);
        }
        return;
    }

    const container = document.createElement('div');
    container.className = 'h-screen w-full bg-[#f8fafc] text-[#0f172a] font-sans overflow-hidden flex';

    // Left: main game
    const left = document.createElement('div');
    left.className = 'flex-1 flex flex-col overflow-hidden';
    
    // Grid structure [Player B (top) / Center Bar / Player A (bottom)]
    const mainGrid = document.createElement('div');
    mainGrid.className = 'flex-1 grid grid-rows-[1fr_auto_1fr] overflow-hidden';
    
    // Row 1: Player B (Top)
    mainGrid.appendChild(renderPlayerArea(1));

    // Row 2: Moving Header to Center (Divider)
    const centralBar = document.createElement('div');
    centralBar.className = 'h-16 px-6 border-y border-slate-200 flex items-center justify-between bg-white shrink-0 shadow-md z-40 relative';
    
    // 1. Logo & Phase Info
    const leftSection = document.createElement('div');
    leftSection.className = 'flex items-center gap-6';
    leftSection.innerHTML = `
        <div class="font-extrabold text-lg tracking-tight hidden md:block italic">PIXEL DUEL</div>
        <div class="h-8 w-[1px] bg-slate-100 hidden md:block"></div>
        <button id="infoBtn" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-indigo-600 transition-all active:scale-95 shadow-sm border border-slate-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        </button>
    `;
    centralBar.appendChild(leftSection);
    (leftSection.querySelector('#infoBtn') as HTMLElement).onclick = toggleEffectList;

    // 2. Center Phase Indicator
    const phaseSection = document.createElement('div');
    phaseSection.className = 'absolute left-[42%] -translate-x-1/2 flex items-center justify-center';
    
    let displayPhaseHint = phaseHint;
    if (luckySelectionMode) {
        displayPhaseHint = '幸運：移除1骰';
    }
    if (illusionSelectionMode) {
        displayPhaseHint = '幻象：選對手卡';
    }

    const phaseName = inPreparationPhase ? '準備階段' : PHASE_NAMES[currentPhaseIndex];

    phaseSection.innerHTML = `
        <div class="relative flex items-center justify-center">
            <div class="flex flex-col items-center justify-center shrink-0">
                <div class="text-[9px] uppercase font-black text-slate-400 tracking-[0.3em] mb-1">PHASE ${currentPhaseIndex + 1}</div>
                <div class="px-6 py-1 bg-indigo-600 text-white rounded-full text-sm font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-100 border-2 border-indigo-400">
                    ${phaseName}
                </div>
            </div>
            
            ${displayPhaseHint ? `
                <div class="hidden lg:flex absolute left-full ml-4 items-center gap-2 bg-slate-50 border border-slate-100 px-4 py-2 rounded-xl animate-in slide-in-from-left-2 fade-in duration-300 whitespace-nowrap shadow-sm">
                    <div class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></div>
                    <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${displayPhaseHint}</div>
                </div>
            ` : ''}
        </div>
    `;
    centralBar.appendChild(phaseSection);

    // 3. Current Player & Actions
    const rightSection = document.createElement('div');
    rightSection.className = 'flex items-center gap-4';
    
    const turnBadge = document.createElement('div');
    turnBadge.className = 'px-3 py-1 bg-indigo-50 text-indigo-600 rounded text-[10px] font-black uppercase tracking-wider hidden sm:block';
    turnBadge.innerText = `${players[currentPlayerIndex].name} 回合`;
    rightSection.appendChild(turnBadge);

    const actionContainer = document.createElement('div');
    actionContainer.className = 'flex items-center gap-2';

    // One-time Preparation Phase action
    if (winner) {
        const btn = document.createElement('button');
        btn.className = 'px-6 py-2 rounded-lg font-black text-xs uppercase tracking-widest transition-all bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-500 active:scale-95';
        btn.innerHTML = '開始新遊戲 &rarr;';
        btn.onclick = () => location.reload();
        actionContainer.appendChild(btn);
    } else if (inPreparationPhase) {
        const btn = document.createElement('button');
        const prepDone = players[1].cardsPlayedThisTurn >= 1;
        btn.className = `px-6 py-2 rounded-lg font-black text-xs uppercase tracking-widest transition-all ${prepDone ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-500 active:scale-95' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`;
        btn.innerHTML = `開始遊戲 &rarr;`;
        if (prepDone) {
            btn.onclick = () => {
                inPreparationPhase = false;
                // 開始正式流程：先手回合、出牌階段
                currentPlayerIndex = 0;
                currentPhaseIndex = 0;
                selectedHandCardIndex = -1;
                diceResults = [];
                skippedPlayBecauseNoHand = false;
                // Mobile：出牌階段時手牌抽屜自動彈出
                // 並切到手牌 tab
                mobileDockTab = 'hand';
                handDrawerOpen = isMobileLayout();
                // 準備階段的出牌數不應計入正式回合限制
                players[0].cardsPlayedThisTurn = 0;
                players[1].cardsPlayedThisTurn = 0;
                phaseHint = '選牌出牌';
                render();
            };
        }
        actionContainer.appendChild(btn);
    } else

    if (currentPhaseIndex === 1 && diceResults.length === 0) {
        const p = getCurrentPlayer();
        // 只有在「出牌階段因為手牌 = 0 而無法出牌」的情況下，擲骰固定 5 顆
        // （也就是：進入擲骰階段時手牌仍為 0，且本回合出牌數為 0）
        const shouldRollFiveBecauseNoHand = p.hand.length === 0 && p.cardsPlayedThisTurn === 0;
        const rollOptions = shouldRollFiveBecauseNoHand
            ? [5]
            : (p.cardsPlayedThisTurn > 0 ? [5 - p.cardsPlayedThisTurn] : [2, 3, 4]);

        rollOptions.forEach(count => {
            const btn = document.createElement('button');
            btn.className = 'bg-slate-900 text-white px-4 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-slate-800 transition-all active:scale-95';
            btn.innerText = `擲骰 ${count} 次`;
            btn.onclick = () => rollDice(count);
            actionContainer.appendChild(btn);
        });
    } else if (fateSelectionMode) {
        const btn = document.createElement('button');
        btn.className = 'bg-amber-600 text-white px-6 py-2 rounded-lg font-black text-xs uppercase tracking-widest transition-all shadow-lg hover:bg-amber-500 active:scale-95';
        btn.innerText = `確定重擲 (${fateSelectedDiceIndices.length} 顆)`;
        btn.onclick = confirmFate;
        actionContainer.appendChild(btn);
    } else {
        const btn = document.createElement('button');
        const isActionBlocked = (currentPhaseIndex === 1 && diceResults.length === 0) || luckySelectionMode;
        const label = currentPhaseIndex === 6 ? '結束回合' : currentPhaseIndex === 4 ? '結算傷害' : '繼續';
        btn.className = `px-6 py-2 rounded-lg font-black text-xs uppercase tracking-widest transition-all ${isActionBlocked ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-500 active:scale-95'}`;
        btn.innerHTML = `${label} &rarr;`;
        if (!isActionBlocked) btn.onclick = nextPhase;
        actionContainer.appendChild(btn);
    }
    rightSection.appendChild(actionContainer);
    centralBar.appendChild(rightSection);

    mainGrid.appendChild(centralBar);

    // Row 3: Player A (Bottom)
    mainGrid.appendChild(renderPlayerArea(0));

    left.appendChild(mainGrid);
    container.appendChild(left);

    // Right: market panel
    container.appendChild(renderMarketPanel(typeColors));

    root.appendChild(container);

    // Winner modal (desktop)
    const win = renderWinModalOverlay();
    if (win) root.appendChild(win);

    if (showEffectList) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4';
        overlay.onclick = () => { showEffectList = false; render(); };
        
        const modal = document.createElement('div');
        modal.className = 'bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in duration-200';
        modal.onclick = (e) => e.stopPropagation();
        
        modal.innerHTML = `
            <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 class="font-black text-slate-800 tracking-tight flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
                    卡牌一覽
                </h3>
                <button id="closeModal" class="text-slate-400 hover:text-slate-600 transition-colors p-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="overflow-y-auto p-4 flex flex-col gap-2 bg-slate-50/30">
                ${CARD_DEFS.map(def => `
                    <div class="p-3 bg-white rounded-xl border border-slate-100 shadow-sm hover:border-indigo-100 transition-colors">
                        <div class="flex items-center justify-between gap-2 mb-0.5">
                            <div class="text-indigo-600 font-extrabold text-sm">${def.name}</div>
                            <div class="flex items-center gap-1.5 shrink-0">
                                <span class="card-frame-chip ${typeColors[def.left.type]}" style="--chip: 16px; --chip-font: 8px;">${def.left.value}</span>
                                <span class="card-frame-chip ${typeColors[def.right.type]}" style="--chip: 16px; --chip-font: 8px;">${def.right.value}</span>
                            </div>
                        </div>
                        <div class="text-slate-600 text-[11px] font-bold leading-relaxed">${def.desc}</div>
                    </div>
                `).join('')}
            </div>
            <div class="p-4 bg-slate-50 border-t border-slate-100 text-center">
                <button id="closeModalBtn" class="w-full bg-slate-900 text-white py-2 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95">關閉列表 Close</button>
            </div>
        `;
        
        (modal.querySelector('#closeModal') as HTMLElement).onclick = toggleEffectList;
        (modal.querySelector('#closeModalBtn') as HTMLElement).onclick = toggleEffectList;
        overlay.appendChild(modal);
        root.appendChild(overlay);
    }
}

function renderPlayerArea(idx: 0 | 1) {
    const p = players[idx];
    const isCurrent = (currentPlayerIndex === idx);
    const area = document.createElement('div');
    // Horizontal structure: [Stats & Queue] [Board] [Hand]
    // 右側手牌欄加寬一點（但不改中間場地三區本來的排版邏輯）
    area.className = `px-8 py-4 grid grid-cols-[200px_1fr_300px] gap-6 ${idx === 1 ? 'bg-white' : 'bg-[#fafbfc]'} relative transition-all duration-300 overflow-hidden`;
    
    // 1. Column: Stats & Next Turn Preview
    const leftCol = document.createElement('div');
    leftCol.className = 'flex flex-col justify-center gap-8 border-r border-slate-100 pr-6';
    
    const stats = document.createElement('div');
    stats.innerHTML = `
        <div class="flex items-center gap-4 mb-2">
            <div class="text-5xl font-black ${isCurrent ? 'text-indigo-600' : 'text-slate-300'} tracking-tighter">${p.hp.toString().padStart(2, '0')}</div>
            <div class="flex flex-col">
                <div class="text-[10px] uppercase font-black text-slate-400 leading-none mb-1 tracking-widest">${p.name}</div>
                <div class="text-[9px] uppercase font-bold text-slate-300 leading-none">生命值 Health Points</div>
            </div>
        </div>
    `;
    leftCol.appendChild(stats);

    const resourceGrid = document.createElement('div');
    resourceGrid.className = 'flex flex-col gap-2 mt-4';
    resourceGrid.innerHTML = `
        <div class="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-50/50 border border-emerald-100/50 transition-all">
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]"></div>
                <span class="text-[10px] font-black uppercase text-emerald-800 tracking-wider">魔力 Magic</span>
            </div>
            <span class="text-lg font-black text-emerald-600 tracking-tight">${p.magic}</span>
        </div>
        <div class="flex items-center justify-between px-3 py-2 rounded-xl bg-blue-50/50 border border-blue-100/50 transition-all">
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]"></div>
                <span class="text-[10px] font-black uppercase text-blue-800 tracking-wider">防禦 Defense</span>
            </div>
            <span class="text-lg font-black text-blue-600 tracking-tight">${p.defense}</span>
        </div>
        <div class="flex items-center justify-between px-3 py-2 rounded-xl bg-amber-50/50 border border-amber-100/50 transition-all">
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]"></div>
                <span class="text-[10px] font-black uppercase text-amber-800 tracking-wider">金幣 Gold</span>
            </div>
            <span class="text-lg font-black text-amber-600 tracking-tight">${p.gold}</span>
        </div>
    `;
    leftCol.appendChild(resourceGrid);

    area.appendChild(leftCol);

    // 2. Column: Board Zones (Large Center)
    // 場地整體靠上，讓卡牌堆疊可以往下長得更多、比較不容易超出畫面。
    const board = document.createElement('div');
    board.className = 'flex items-start justify-center gap-6 self-start mt-0';
    
    const typeColors = {
        attack: 'bg-red-500',
        defense: 'bg-blue-500',
        magic: 'bg-emerald-500',
        gold: 'bg-amber-500'
    };
    const typeNames = {
        attack: '攻',
        defense: '守',
        magic: '魔',
        gold: '金'
    };

    [0, 1, 2].forEach(aIdx => {
        const zone = document.createElement('div');
        zone.className = `relative flex flex-col items-center gap-1 p-3 rounded-2xl transition-all border border-transparent ${currentPhaseIndex === 2 && diceResults.some(d => Math.floor((d-1)/2) === aIdx) ? 'bg-indigo-50/50 border-indigo-100 shadow-sm' : 'bg-slate-50/30'}`;
        
        const labelL = aIdx * 2 + 1; // 1, 3, 5 on left
        const labelR = aIdx * 2 + 2; // 2, 4, 6 on right
        
        const baseAttrs = idx === 0 
            ? ['attack', 'defense', 'magic', 'gold', 'gold', 'attack'] 
            : ['gold', 'magic', 'magic', 'attack', 'attack', 'defense'];
        const baseL = baseAttrs[aIdx * 2];
        const baseR = baseAttrs[aIdx * 2 + 1];

        zone.innerHTML = `
            <div class="flex w-full justify-around items-center mb-0 pt-9">
                <div class="flex flex-col items-center w-1/2 border-r border-slate-50 opacity-80">
                    <span class="text-[9px] font-black text-slate-400 leading-none mb-0.5">${labelL}</span>
                    <div class="attr-chip-hand ${typeColors[baseL]} shadow-sm">1</div>
                </div>
                <div class="flex flex-col items-center w-1/2 opacity-80">
                    <span class="text-[9px] font-black text-slate-400 leading-none mb-0.5">${labelR}</span>
                    <div class="attr-chip-hand ${typeColors[baseR]} shadow-sm">1</div>
                </div>
            </div>
        `;

        const slot = document.createElement('div');
        slot.className = `minimal-slot w-[160px] h-[140px] border-2 border-dashed border-slate-200 bg-white/50 rounded-2xl relative transition-all ${isCurrent && currentPhaseIndex === 0 && selectedHandCardIndex !== -1 ? 'hover:border-indigo-400 cursor-pointer hover:bg-white' : ''}`;
        
        if (isCurrent && currentPhaseIndex === 0 && selectedHandCardIndex !== -1) {
            slot.onclick = () => playToBoard(aIdx);
        }

        const atkContainer = document.createElement('div');
        atkContainer.className = 'absolute -bottom-5 left-0 right-0 flex justify-center gap-1.5 z-40';
        
    // Logic: If it's our turn, show current calculated attacks
    // If it's NOT our turn, show our attackQueue (attacks waiting to hit the opponent)
    const effects = isCurrent ? p.currentAttacks[aIdx] : p.attackQueue[aIdx];
    effects.forEach((atkVal, hitIdx) => {
        if (atkVal === 0) return;
        const atkBadge = document.createElement('div');
        
        let displayVal = atkVal;
        let isFullyBlocked = false;

        // NEW: In Defense (3) or Damage (4) Phase, for opponent's attacks, subtract the current player's defense
        if (!isCurrent && (currentPhaseIndex === 3 || currentPhaseIndex === 4)) {
            const currentPlayer = getCurrentPlayer();
            displayVal = Math.max(0, atkVal - currentPlayer.defense);
            if (displayVal <= 0) isFullyBlocked = true;
        }

        // Evasion Targeting: If current player is in evasion mode AND we are looking at opponent's board
        const canBeDodged = !isCurrent && evasionSelectionMode;
        const isChargeTarget = isCurrent && chargeSelectionMode;
        const isReproductionTarget = isCurrent && reproductionSelectionMode;
        const isFlareTarget = isCurrent && flareSelectionMode;
        
        const bgColor = isFullyBlocked ? 'bg-slate-400' : 'bg-red-500';
        const activeColor = (isChargeTarget || canBeDodged || isReproductionTarget || isFlareTarget) ? 'bg-amber-500 scale-110 ring-2 ring-amber-200 cursor-pointer animate-pulse' : bgColor;

        atkBadge.className = `text-white text-[11px] font-black px-2 py-0.5 rounded-md shadow-lg border-2 border-white animate-bounce transition-all ${activeColor}`;
        atkBadge.innerText = displayVal.toString();
        
        if (isChargeTarget) {
            atkBadge.onclick = (e) => { e.stopPropagation(); useCharge(aIdx, hitIdx); };
        } else if (canBeDodged) {
            atkBadge.onclick = (e) => { e.stopPropagation(); targetEvasion(aIdx, hitIdx); };
        } else if (isReproductionTarget) {
            atkBadge.onclick = (e) => { e.stopPropagation(); targetReproduction(aIdx, hitIdx); };
        } else if (isFlareTarget) {
            atkBadge.onclick = (e) => { e.stopPropagation(); targetFlare(aIdx, hitIdx); };
        }
        atkContainer.appendChild(atkBadge);
    });

    // Piercing attacks logic similarly
    const pEffects = isCurrent ? p.piercingAttacks[aIdx] : p.piercingQueue[aIdx];
    pEffects.forEach(atkVal => {
        const atkBadge = document.createElement('div');
        atkBadge.className = 'text-white text-[11px] font-black px-2 py-0.5 rounded-md shadow-lg border-2 border-white animate-bounce bg-purple-600 transition-all';
        atkBadge.innerText = atkVal.toString();
        atkContainer.appendChild(atkBadge);
    });
    
    slot.appendChild(atkContainer);

    const stack = p.board[aIdx];
    stack.forEach((card, cIdx) => {
        const cardEl = document.createElement('div');
        const isTop = (cIdx === stack.length - 1);
        const isActiveEffect = (p.activeAreaEffects[aIdx] === card);
        const effId = isActiveEffect ? getEffectiveEffectId(p, aIdx) : card.effectId;

        // Wrapper must be absolute to stack correctly in the slot
        // Added hover:z-[100] to bring the entire card context above other UI elements when inspecting
        // 用固定卡牌寬高，讓卡牌置中（避免 left+right 拉伸變形）
        cardEl.className = `card-frame shadow-sm group absolute left-1/2 -translate-x-1/2 transition-all duration-300 overflow-visible ${isTop ? 'z-10' : 'z-0'} hover:z-[100]`;
        cardEl.setAttribute('style', getCardFrameStyleVars('board'));
        // 堆疊間距要 >= header 高度，避免上層卡遮住下層的屬性圓點
        cardEl.style.top = `${cIdx * 22}px`;
        
        // Contract high-light
        if (p.contractTriggeredAreaIdx === aIdx && isActiveEffect) {
            cardEl.classList.add('ring-2', 'ring-red-500', 'z-50');
        }
        
        // Breakthrough high-light
        if (effId === 'breakthrough' && isActiveEffect && p.hp <= 3) {
            cardEl.classList.add('ring-2', 'ring-cyan-400', 'z-40');
        }
 
        // Mirage high-light (Continuously glowing)
        if (effId === 'mirage' && isActiveEffect) {
            cardEl.classList.add('ring-2', 'ring-violet-500', 'z-40');
        }
 
        // Illusion source high-light
        if (card.effectId === 'illusion' && isActiveEffect && illusionSelectionMode && illusionSourceAreaIdx === aIdx) {
            cardEl.classList.add('ring-2', 'ring-teal-400', 'z-40');
        }
 
        // Lucky high-light
        // User: "掷骰阶段时自动触发 ... 直到选择完成前 [幸運]持续发光"
        // Glow if Phase 1 and (no roll yet OR in removal selection) AND it is your own turn
        if (effId === 'lucky' && isActiveEffect && isCurrent && currentPhaseIndex === 1 && (diceResults.length === 0 || luckySelectionMode)) {
            cardEl.classList.add('ring-2', 'ring-lime-400', 'z-40');
        }
        
        const typeColors = {
            attack: 'bg-red-500',
            defense: 'bg-blue-500',
            magic: 'bg-emerald-500',
            gold: 'bg-amber-500'
        };

        // Note: displayEffectName 仍保留給幻象顯示，但目前卡牌名稱顯示只顯示效果名
        const displayEffectName = (card.effectId === 'illusion' && p.illusionCopiedEffectIds[aIdx])
            ? `幻象幽影[${EFFECTS.find(e => e.id === p.illusionCopiedEffectIds[aIdx])?.name || ''}]`
            : card.effectName;

        // 被覆蓋的卡牌：名稱也要保留；tooltip 只給最上層生效卡（避免互相遮擋）
        const nameForUI = (isTop && isActiveEffect) ? displayEffectName : card.effectName;
        cardEl.innerHTML = renderCardContentHTML(
            {...card, effectName: nameForUI},
            typeColors,
            {showTooltip: isTop && isActiveEffect}
        );

        // Tooltip（只給最上層生效卡，避免堆疊互相遮擋）
        if (isTop && isActiveEffect) {
            // 幻象幽影：若已複製效果，tooltip 描述也改成被複製效果的描述
            let tooltipDesc = card.effectDesc;
            if (card.effectId === 'illusion' && p.illusionCopiedEffectIds[aIdx]) {
                tooltipDesc = EFFECTS.find(e => e.id === p.illusionCopiedEffectIds[aIdx])?.desc || tooltipDesc;
            }
            attachCardTooltip(cardEl, {title: nameForUI, desc: tooltipDesc});
        }

        if (isCurrent && isTop && isActiveEffect) {
            const isMirageBlocked = isMirageActive();
            if (currentPhaseIndex === 5 && effId === 'charge') {
                if (p.magic >= 2 && !p.chargeUsedIndices.includes(aIdx) && !isMirageBlocked) {
                    const isSource = chargeSelectionMode && chargeSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useCharge(aIdx); };
                }
            } else if (currentPhaseIndex === 5 && effId === 'magic_bullet') {
                if (p.magic >= 1 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-emerald-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useMagicBullet(aIdx); };
                }
            } else if (currentPhaseIndex === 5 && effId === 'amplify') {
                // Amplify is free: Only pulse if THIS specific area's amplify not used
                if (!p.amplifyUsedIndices.includes(aIdx)) {
                    cardEl.classList.add('ring-2', 'ring-blue-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useAmplify(aIdx); };
                }
            } else if ((currentPhaseIndex === 1 || currentPhaseIndex === 2) && effId === 'fate') {
                // Fate: Re-roll dice (usable in Roll phase after roll, or Judging phase)
                const diceRolled = diceResults.length > 0;
                if (!p.fateUsedIndices.includes(aIdx) && diceRolled && !luckySelectionMode) {
                    cardEl.classList.add('ring-2', fateSelectionMode ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useFate(aIdx); };
                }
            } else if (currentPhaseIndex === 3 && effId === 'dodge') {
                // Dodge: Ignore incoming attack in Defense Phase
                const opp = getOpponent();
                const hasDodgeableAttacks = opp.attackQueue.flat().length > 0;
                if (!p.evasionUsedIndices.includes(aIdx) && p.magic >= 3 && hasDodgeableAttacks && !isMirageBlocked) {
                    const isSource = evasionSelectionMode && evasionSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useEvasion(aIdx); };
                }
            } else if (currentPhaseIndex === 3 && effId === 'barrier') {
                // Modified Barrier: Consume 3 magic for 3 defense in Defense Phase
                if (p.magic >= 3 && !p.barrierUsedIndices.includes(aIdx) && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useBarrier(aIdx); };
                }
            } else if (currentPhaseIndex === 3 && effId === 'shield') {
                // Shield: Consume 2 magic for 1 defense in Defense Phase
                if (p.magic >= 2 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-blue-300', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useShield(aIdx); };
                }
            } else if (currentPhaseIndex === 5 && effId === 'reproduction') {
                // Reproduction: Consume 2 magic, make one attack twice
                if (!p.reproductionUsedIndices.includes(aIdx) && p.magic >= 2 && !isMirageBlocked) {
                    const isSource = reproductionSelectionMode && reproductionSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useReproduction(aIdx); };
                }
            } else if (currentPhaseIndex === 5 && effId === 'flare') {
                // Flare: Consume 3 magic, double one attack
                if (!p.flareUsedIndices.includes(aIdx) && p.magic >= 3 && !isMirageBlocked) {
                    const isSource = flareSelectionMode && flareSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useFlare(aIdx); };
                }
            } else if (currentPhaseIndex === 5 && effId === 'thrust') {
                // Thrust: Double all 1s and 2s
                if (!p.thrustUsedIndices.includes(aIdx)) {
                    cardEl.classList.add('ring-2', 'ring-rose-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useThrust(aIdx); };
                }
            } else if (currentPhaseIndex === 5 && effId === 'forest') {
                // Forest: Merge all attacks
                if (!p.forestUsedIndices.includes(aIdx) && p.magic >= 3 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-emerald-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useForest(aIdx); };
                }
            } else if (currentPhaseIndex === 1 && effId === 'frost') {
                // Frost: Discard a die for 1-3 extra attack
                const diceRolled = diceResults.length > 0;
                if (!p.frostUsedIndices.includes(aIdx) && diceRolled && !luckySelectionMode) {
                    const isSource = frostSelectionMode && frostSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-blue-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useFrost(aIdx); };
                }
            } else if (currentPhaseIndex === 2 && effId === 'magic_luck') {
                if (p.magic >= 2 && !p.magicLuckUsedIndices.includes(aIdx) && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-purple-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useMagicLuck(aIdx); };
                }
            } else if (currentPhaseIndex === 2 && card.effectId === 'illusion') {
                const opp = getOpponent();
                const hasCopyableCard = opp.activeAreaEffects.some(c => c && c.effectId !== 'lucky' && c.effectId !== 'fate');
                if (p.magic >= 1 && !p.illusionUsedIndices.includes(aIdx) && !isMirageBlocked && hasCopyableCard) {
                    cardEl.classList.add('ring-2', 'ring-teal-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useIllusion(aIdx); };
                }
            } else if ([2, 3, 4, 5].includes(currentPhaseIndex) && effId === 'holy_light') {
                // Holy Light: Consume 2 magic for 1 HP
                if (p.magic >= 2 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-yellow-300', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useHolyLight(aIdx); };
                }
            } else if ([2, 3, 4, 5].includes(currentPhaseIndex) && effId === 'soul_snatch') {
                // Soul Snatch: Consume 3 magic to absorb 1 HP
                if (p.magic >= 3 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-purple-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useSoulSnatch(aIdx); };
                }
            }
        }
        // Opponent card targeting for Illusion
        if (!isCurrent && isTop && isActiveEffect && illusionSelectionMode && card.effectId !== 'lucky' && card.effectId !== 'fate') {
            cardEl.classList.add('ring-2', 'ring-teal-500', 'cursor-pointer', 'shadow-2xl', 'z-50');
            cardEl.onclick = (e) => { e.stopPropagation(); targetIllusion(aIdx); };
        }

        slot.appendChild(cardEl);
    });
        
        // Dice Pool: Improved stacking visibility
        if (isCurrent && diceResults.length > 0) {
            const dicePool = document.createElement('div');
            // Adjusted -top-18 to grant room for 8px stack height
            dicePool.className = 'absolute -top-18 inset-x-0 h-8 pointer-events-none z-30';
            
            let leftCount = 0;
            let rightCount = 0;

            diceResults.forEach((val, originalIdx) => {
                const diceArea = Math.floor((val - 1) / 2);
                if (diceArea !== aIdx) return;

                const valStr = val.toString();
                const isLeftVal = (val % 2 !== 0); 
                const wrapper = document.createElement('div');
                wrapper.className = `absolute pointer-events-auto transition-all duration-300`;
                
                // Increased vertical offset (10px) for clearer stacking
                const countOnSide = isLeftVal ? leftCount++ : rightCount++;
                wrapper.style.left = isLeftVal ? 'calc(25% - 12px)' : 'calc(75% - 12px)';
                // 多顆骰子：改成「往上」堆疊（避免往下蓋到卡牌）
                wrapper.style.top = `${-countOnSide * 10}px`; 
                
                const isSelected = fateSelectedDiceIndices.includes(originalIdx);
                const isFrostTarget = frostSelectionMode;
                const isLuckyTarget = luckySelectionMode;

                const dIcon = document.createElement('div');
                // Smaller dice w-6 (24px)
                const diceColorClass = isSelected ? 'bg-amber-500 text-white ring-amber-300 animate-pulse' : (isFrostTarget ? 'bg-blue-400 text-white ring-blue-200 animate-pulse' : (isLuckyTarget ? 'bg-lime-500 text-white ring-lime-200 animate-pulse' : 'bg-slate-900 text-white ring-white'));
                dIcon.className = `w-6 h-6 rounded shadow-xl flex items-center justify-center font-black text-[10px] ring-2 ${diceColorClass} ${fateSelectionMode || frostSelectionMode || luckySelectionMode ? 'cursor-pointer hover:scale-110 active:scale-95' : ''}`;
                dIcon.innerText = valStr;
                if (fateSelectionMode) dIcon.onclick = () => toggleDiceIndexSelection(originalIdx);
                else if (frostSelectionMode) dIcon.onclick = () => targetFrost(originalIdx);
                else if (luckySelectionMode) dIcon.onclick = () => removeLuckyDie(originalIdx);
                wrapper.appendChild(dIcon);
                dicePool.appendChild(wrapper);
            });
            slot.appendChild(dicePool);
        }

        zone.appendChild(slot);
        board.appendChild(zone);
    });
    area.appendChild(board);

    // 3. Column: Hand (RIGHT SIDE)
    const handCol = document.createElement('div');
    handCol.className = 'border-l border-slate-100 pl-6 flex flex-col justify-center items-center gap-4 min-w-[260px]';
    handCol.innerHTML = `<div class="text-[9px] font-black uppercase text-slate-400 tracking-widest">玩家手牌</div>`;
    
    const handWrap = document.createElement('div');
    // 手牌：永遠固定「上下兩排」，並採用 column-major 順序：先上→下填滿一欄，再往右開新欄。
    // 改用 CSS Grid（rows=2 + grid-flow-col），避免 flex-wrap 在出現 scrollbar 後高度不足導致掉成 1 排。
    // 註：h 需要包含 2 張牌高度 + gap + padding + scrollbar 高度 buffer。
    handWrap.className = 'w-full grid grid-rows-2 grid-flow-col auto-cols-max gap-3 h-[220px] overflow-x-auto overflow-y-hidden p-2 content-start justify-center';
    // 捲動時也先關掉 tooltip（避免滑鼠停在卡上時拖曳捲動造成 tooltip 殘留）
    handWrap.addEventListener('scroll', hideGlobalTooltip);
    p.hand.forEach((card, hIdx) => {
        const cardEl = document.createElement('div');
        const isSelected = (isCurrent && selectedHandCardIndex === hIdx);

        cardEl.className = `card-frame shadow-sm group relative transition-all ${isCurrent && currentPhaseIndex === 0 ? 'cursor-pointer' : 'opacity-60'} ${isSelected ? 'border-indigo-600 ring-2 ring-indigo-50 shadow-indigo-100 scale-105' : 'hover:-translate-y-1 hover:border-slate-400'}`;
        cardEl.setAttribute('style', getCardFrameStyleVars('hand'));
        cardEl.innerHTML = renderCardContentHTML(card, typeColors, {showTooltip: true});
        attachCardTooltip(cardEl, {title: card.effectName, desc: card.effectDesc});
        if (isCurrent && currentPhaseIndex === 0) {
            cardEl.onclick = () => selectHandCard(hIdx);
        }
        handWrap.appendChild(cardEl);
    });
    if (p.hand.length === 0) {
        handWrap.innerHTML = `<div class="w-full text-[10px] font-bold text-slate-300 uppercase tracking-widest italic text-center">空</div>`;
    }
    handCol.appendChild(handWrap);
    area.appendChild(handCol);

    return area;
}

// --- Start Game ---
initGame();
render();

// 讓 responsive 模式縮放視窗時可以即時切換 mobile/desktop layout
// 只要跨過 breakpoint (768px) 就 rerender。
let lastIsMobileLayout = isMobileLayout();
window.addEventListener('resize', () => {
    const now = isMobileLayout();
    if (now !== lastIsMobileLayout) {
        lastIsMobileLayout = now;
        // 切到 Mobile 且正在出牌階段：自動彈出手牌抽屜；其他情況預設收合
        if (now && currentPhaseIndex === 0) {
            mobileDockTab = 'hand';
            handDrawerOpen = true;
        } else {
            handDrawerOpen = false;
        }
        render();
    }
});
window.addEventListener('orientationchange', () => {
    const now = isMobileLayout();
    if (now !== lastIsMobileLayout) {
        lastIsMobileLayout = now;
        if (now && currentPhaseIndex === 0) {
            mobileDockTab = 'hand';
            handDrawerOpen = true;
        } else {
            handDrawerOpen = false;
        }
    }
    render();
});

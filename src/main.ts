/**
 * 像素對決 Pixel Duel MVP
 * Vanilla JavaScript Implementation
 */

import './index.css';

import {CARD_DEFS, EFFECTS, type CardAttr} from './cards';
// 規則的共用型別與純計算，UI 與模擬器共用同一份（見 src/engine/state.ts）
import {
    type GameCard,
    type PlayerState,
    createPlayer,
    createGameState,
    damageThroughDefense,
} from './engine/state';
import {resolveDamagePhase, resolveJudging} from './engine/resolve';
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
} from './engine/effects';
import {
    getActivationMagicCost,
    isMagicSpendActivation,
    listActivations,
} from './engine/activations';
import {
    buildDeck,
    drawFromDeck as drawFromDeckList,
    getDeckDrawCost,
    getEffectiveEffectId,
    getMarketPrice,
    isMirageActive as isMirageActiveFor,
    refillMarket as refillMarketList,
    shuffled,
} from './engine/deck';
import {getBaseAttrForDie, getBaseBarImg} from './basebars';

// Basebar image height (UI only)
const BASEBAR_IMG_HEIGHT_PX = 45;

function renderBaseBarImgHTML(playerIdx: 0 | 1, zoneIdx: 0 | 1 | 2) {
    const src = getBaseBarImg(playerIdx, zoneIdx);
    // Use inline style to avoid relying on Tailwind arbitrary value compilation.
    return `<img src="${src}" alt="basebar" style="height:${BASEBAR_IMG_HEIGHT_PX}px; width:auto;" />`;
}

// --- Asset preloading ---

let cardImagesPreloaded = false;

async function preloadCardImages() {
    if (cardImagesPreloaded) return;
    cardImagesPreloaded = true;

    // Preload & decode all card PNGs to avoid flicker when the app re-renders DOM.
    // (This app rebuilds the whole UI tree on each render(), so <img> elements are recreated often.)
    const imgNos = [...new Set(CARD_DEFS.map(d => d.imgNo))].sort((a, b) => a - b);
    const tasks = imgNos.map(async (n) => {
        const img = new Image();
        img.src = getCardPngUrlByImgNo(n);
        // decode() isn't supported in some older browsers; fall back to onload.
        try {
            // If already cached, decode resolves quickly.
            // @ts-ignore
            if (typeof img.decode === 'function') await img.decode();
            else await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error('image load failed'));
            });
        } catch {
            // Ignore failures; worst case is you keep the current behavior.
        }
    });
    await Promise.allSettled(tasks);
}

function getCardPngFileName(imgNo: number) {
    // Use the required naming: pixel_duel-01.png, pixel_duel-02.png, ...
    const n = Math.max(0, Math.floor(imgNo));
    return `pixel_duel-${String(n).padStart(2, '0')}.png`;
}

function getCardPngUrlByImgNo(imgNo: number) {
    // IMPORTANT:
    // - This project uses Vite `base: '/pixel_duel/'` for GitHub Pages.
    // - In dev/prod, using an absolute path like `/cards/...` may bypass the base and 404.
    // - Using a RELATIVE path keeps it working under both `/` and `/pixel_duel/`.
    return `cards/${getCardPngFileName(imgNo)}`;
}

// Relative path for the same reason as getCardPngUrlByImgNo (Vite `base`).
const COVER_IMG_URL = 'cover/pixel_duel_cover.jpg';

// 回合流程圖（實體桌遊的美術原圖，維持原本的背景不去背）
const TURN_FLOW_IMG_URL = 'rules/turn_flow.jpg';

// Physical board game rulebook (PDF hosted on Google Drive).
const PHYSICAL_RULEBOOK_URL = 'https://drive.google.com/file/d/1ep-OoATJueR2ji2Bd_OXz4bokXQs7l-7/view?usp=drivesdk';

function getImgNoForEffectId(effectId: string) {
    const def = CARD_DEFS.find(d => d.effectId === effectId);
    return def?.imgNo ?? 0;
}

function renderCardPngHTML(effectId: string, alt: string) {
    const imgNo = getImgNoForEffectId(effectId);
    const src = getCardPngUrlByImgNo(imgNo);
    return `
        <div class="w-full h-full p-0.1">
            <div class="w-full h-full rounded-md overflow-hidden bg-white">
                <img
                    src="${src}"
                    alt="${alt}"
                    class="w-full h-full object-contain select-none"
                    draggable="false"
                    loading="eager"
                    decoding="async"
                />
            </div>
        </div>
    `;
}

// --- Constants & Data ---



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

// 原生 alert 會凍結整個瀏覽器、跳出系統對話框（手機上還會顯示網域），
// 跟遊戲風格完全脫節，而且每次都要多按一下「確定」。
// 改用畫面內的浮動提示：直接掛在 body，不需要經過 render()，
// 所以不會被重繪吃掉，也不必為它加狀態。
let toastTimer: number | null = null;

function showToast(message: string) {
    let el = document.getElementById('game-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'game-toast';
        el.className = 'fixed left-1/2 -translate-x-1/2 bottom-[22%] z-[4000] pointer-events-none px-4 py-2.5 rounded-xl bg-slate-900/92 text-white text-[13px] font-black tracking-wide shadow-2xl border border-white/10 max-w-[86%] text-center transition-opacity duration-200';
        document.body.appendChild(el);
    }
    el.innerText = message;
    el.style.opacity = '1';
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        const cur = document.getElementById('game-toast');
        if (cur) cur.style.opacity = '0';
        toastTimer = null;
    }, 1800);
}

function hideGlobalTooltip() {
    const el = document.getElementById('global-tooltip');
    if (!el) return;
    el.classList.add('hidden');
}

function scheduleRestoreHandScrollPositions() {
    // Because this app fully re-creates DOM on each render(),
    // setting scrollLeft during element creation may be overridden by layout.
    // Restore it after mount (and once more in the next frame for safety).
    const restoreOnce = () => {
        const mobile = document.getElementById('mobile-hand-list');
        if (mobile) (mobile as HTMLDivElement).scrollLeft = mobileHandScrollLeft;

        const d0 = document.getElementById('desktop-hand-wrap-0');
        if (d0) (d0 as HTMLDivElement).scrollLeft = desktopHandScrollLeft[0];

        const d1 = document.getElementById('desktop-hand-wrap-1');
        if (d1) (d1 as HTMLDivElement).scrollLeft = desktopHandScrollLeft[1];
    };

    requestAnimationFrame(() => {
        restoreOnce();
        requestAnimationFrame(restoreOnce);
    });
}

function attachCardTooltip(
    cardEl: HTMLElement,
    {effectId, alt}: {effectId: string; alt: string}
) {
    const tip = ensureGlobalTooltipEl();

    // On desktop, this app fully re-renders the DOM frequently.
    // When an element is created directly under the mouse cursor, browsers may fire
    // `pointerenter` immediately even if the user didn't intentionally hover.
    // To avoid the "card suddenly becomes huge" illusion, we only show the preview
    // after the mouse actually MOVES within the card.
    let mouseHoverActive = false;

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
        const src = getCardPngUrlByImgNo(getImgNoForEffectId(effectId));
        tip.innerHTML = `
            <div class="relative rounded-2xl bg-slate-900/90 p-2 shadow-2xl border border-white/10">
                <div class="w-[280px] h-[430px] sm:w-[320px] sm:h-[440px] rounded-xl overflow-hidden bg-white">
                    <img
                        src="${src}"
                        alt="${alt}"
                        class="w-full h-full object-contain select-none"
                        draggable="false"
                        loading="eager"
                        decoding="async"
                    />
                </div>
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
        mouseHoverActive = true;
    });
    cardEl.addEventListener('pointermove', (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        if (!mouseHoverActive) return;

        // First actual move inside card => show preview.
        if (tip.classList.contains('hidden')) {
            renderTip();
        }
        positionTip();
    });
    cardEl.addEventListener('pointerleave', (e: PointerEvent) => {
        clearLongPress();
        if (e.pointerType === 'mouse') {
            mouseHoverActive = false;
            hideGlobalTooltip();
        }
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

// 骰子改用骰面點數（白色點點）而不是數字。
// 3x3 格中要點亮的格子索引，對應標準骰面排列。
const DIE_PIP_CELLS: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
};

function renderDiePipsHTML(value: number) {
    const lit = DIE_PIP_CELLS[value] ?? [];
    const cells = Array.from({length: 9}, (_, i) => lit.includes(i)
        ? '<span class="w-[3.5px] h-[3.5px] rounded-full bg-white"></span>'
        : '<span></span>').join('');
    return `<span class="grid grid-cols-3 grid-rows-3 place-items-center w-full h-full p-[3.5px]">${cells}</span>`;
}

// --- 拖曳出牌 -------------------------------------------------------------
// 觸控時手牌列本身要左右滑動捲動，所以只有垂直為主的手勢才算出牌。
const DRAG_START_THRESHOLD_PX = 12;

function findPlayZoneAt(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const zone = el?.closest('[data-play-zone]') as HTMLElement | null;
    if (!zone) return -1;
    const idx = Number(zone.getAttribute('data-play-zone'));
    return Number.isInteger(idx) ? idx : -1;
}

function setPlayZoneHighlight(areaIdx: number) {
    document.querySelectorAll('[data-play-zone]').forEach(z => {
        const on = Number(z.getAttribute('data-play-zone')) === areaIdx;
        z.classList.toggle('drop-active', on);
    });
}

// 每個 pointermove 都做 elementFromPoint + 改 left/top + 掃描所有放置區，會逼瀏覽器
// 反覆重算版面，拖起來就會卡頓。改成：座標只用 transform（交給合成器）、
// 命中測試與高亮改由 rAF 節流、而且只有在區域真的改變時才動 class。
function createDragGhost(cardEl: HTMLElement) {
    const rect = cardEl.getBoundingClientRect();
    const ghost = cardEl.cloneNode(true) as HTMLElement;
    ghost.classList.add('card-drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = '0';
    ghost.style.top = '0';
    ghost.style.willChange = 'transform';
    document.body.appendChild(ghost);
    return ghost;
}

function positionDragGhost(ghost: HTMLElement, x: number, y: number) {
    ghost.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(1.08)`;
}

function attachHandCardDrag(cardEl: HTMLElement, handIdx: number) {
    // 讓瀏覽器只處理左右捲動，垂直方向的手勢留給我們判斷。
    cardEl.style.touchAction = 'pan-x';

    let pointerId = -1;
    let dragging = false;
    let justDragged = false;
    let startX = 0;
    let startY = 0;
    let ghost: HTMLElement | null = null;
    let rafId = 0;
    let lastX = 0;
    let lastY = 0;
    let hoveredZone = -1;

    const flush = () => {
        rafId = 0;
        if (!dragging || !ghost) return;
        positionDragGhost(ghost, lastX, lastY);
        const zone = findPlayZoneAt(lastX, lastY);
        if (zone !== hoveredZone) {
            hoveredZone = zone;
            setPlayZoneHighlight(zone);
        }
    };

    const scheduleFlush = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(flush);
    };

    const cleanup = () => {
        dragging = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        ghost?.remove();
        ghost = null;
        hoveredZone = -1;
        setPlayZoneHighlight(-1);
        cardEl.style.opacity = '';
    };

    cardEl.addEventListener('pointerdown', (e: PointerEvent) => {
        if (S.currentPhaseIndex !== 0) return;
        if (e.button > 0) return;
        // 新一輪互動：先清掉上一輪殘留的旗標。
        // 觸控拖曳取消時瀏覽器不一定會補送 click，旗標留著就會把
        // 下一次的正常點擊吃掉（使用者得點兩下才選得到牌）。
        justDragged = false;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
    });

    cardEl.addEventListener('pointermove', (e: PointerEvent) => {
        if (e.pointerId !== pointerId || S.currentPhaseIndex !== 0) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!dragging) {
            // 觸控：手牌列本身要左右滑動捲動，所以只認「垂直為主」的手勢。
            // 滑鼠：沒有這個衝突，而且桌機手牌在場地側邊，往往是水平移動，
            //       所以任何方向只要超過門檻都算拖曳。
            const far = Math.abs(dx) > DRAG_START_THRESHOLD_PX || Math.abs(dy) > DRAG_START_THRESHOLD_PX;
            if (!far) return;
            if (e.pointerType === 'touch' && (Math.abs(dy) < DRAG_START_THRESHOLD_PX || Math.abs(dx) > Math.abs(dy))) return;
            dragging = true;
            hideGlobalTooltip();
            cardEl.setPointerCapture(e.pointerId);
            ghost = createDragGhost(cardEl);
            positionDragGhost(ghost, e.clientX, e.clientY);
            cardEl.style.opacity = '0.35';
        }

        lastX = e.clientX;
        lastY = e.clientY;
        scheduleFlush();
        e.preventDefault();
    });

    cardEl.addEventListener('pointerup', (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        pointerId = -1;
        if (!dragging) return;
        const areaIdx = findPlayZoneAt(e.clientX, e.clientY);
        cleanup();
        // 放開後瀏覽器仍會補一個 click，別讓它又去選取這張牌
        justDragged = true;
        if (areaIdx >= 0) {
            S.selectedHandCardIndex = handIdx;
            playToBoard(areaIdx);
        }
    });

    cardEl.addEventListener('pointercancel', (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        pointerId = -1;
        if (dragging) justDragged = true;
        cleanup();
    });

    cardEl.addEventListener('click', (e: MouseEvent) => {
        if (!justDragged) return;
        justDragged = false;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, {capture: true});
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

// Illusion (幻象幽影) can copy opponent active effect cards,
// but some effects are explicitly not copyable.
// NOTE: This list is used by UI / AI / runtime guard checks.
const ILLUSION_UNCOPYABLE_EFFECT_IDS = new Set<string>(['lucky', 'fate', 'frost']);

// --- State ---

/*
 * 規則狀態集中在這一個物件裡（見 engine/state.ts）。
 * 之前這些是 30 幾個各自獨立的 module-level let，任何函式都能改、也無法整份複製；
 * 模擬決策需要「複製當下局面往下跑」，所以規則狀態必須是一個可傳遞的值。
 * 下面留在 main.ts 的仍是純畫面狀態。
 */
const S = createGameState();

// Winner modal (可關閉以查看最後場面)
let winModalDismissed = false;
// Mobile UI: 手牌抽屜收合/展開
let handDrawerOpen = false;
// Mobile UI: 底部 dock 顯示內容（手牌 / 市場）
let mobileDockTab: 'hand' | 'market' = 'hand';
// Keep horizontal scroll position for hand lists (avoid jumping back to start on rerender)
let mobileHandScrollLeft = 0;
let desktopHandScrollLeft: [number, number] = [0, 0];
// Mobile UI: 對手場地展開/收合（預設收合，節省空間）
let mobileOpponentBoardOpen = false;
let showEffectList = false;

type AppScreen = 'home' | 'rules' | 'game';
type GameMode = 'pvp' | 'cvp' | 'pvc';
let appScreen: AppScreen = 'home';
let selectedMode: GameMode | null = null;

// Match config
/*
 * PvP 兩邊都叫玩家，用 A / B 區分沒有意義 —— 場上是靠底色分敵我的
 * （先手紅、後手藍，和玩家區塊的底色一致），所以名稱直接用顏色講。
 * 這樣區塊標題、戰報、勝利訊息用的是同一個字，不會各說各話。
 */
let matchPlayerNames: [string, string] = ['紅色玩家', '藍色玩家'];

// 防止使用者連點「繼續」造成階段被推進兩次（看起來像跳過判定階段）
let phaseAdvanceLockUntil = 0;




function resetGameStateForNewMatch() {
    /*
     * 規則狀態整份換新。
     * 這裡原本是 45 行逐欄位歸零 —— 每新增一個規則欄位就得記得回來補一行，
     * 漏掉的那個會把上一局的殘留帶進新局（例如選取模式沒關）。
     * 改成重建整份狀態後，漏掉就不可能發生。
     */
    Object.assign(S, createGameState(matchPlayerNames));

    // 以下是純畫面狀態，不屬於規則，但沒清掉一樣會帶進新的一局。
    winModalDismissed = false;
    handDrawerOpen = false;
    mobileDockTab = 'hand';
    mobileOpponentBoardOpen = false;
    showEffectList = false;
    phaseAdvanceLockUntil = 0;

    // 這些是純畫面狀態，但沒清掉會帶進新的一局：
    // 舊的手牌捲動位置會被還原、舊的浮動提示會殘留幾百毫秒。
    mobileHandScrollLeft = 0;
    desktopHandScrollLeft = [0, 0];
    showGameGuide = false;
    if (toastTimer !== null) {
        window.clearTimeout(toastTimer);
        toastTimer = null;
    }
    const staleToast = document.getElementById('game-toast');
    if (staleToast) staleToast.style.opacity = '0';
}

function getComputerPlayerIndexForMode(mode: GameMode | null): 0 | 1 | null {
    if (mode === 'cvp') return 0;
    if (mode === 'pvc') return 1;
    return null;
}

function isComputerTurnNow() {
    const c = getComputerPlayerIndexForMode(selectedMode);
    return appScreen === 'game' && c !== null && S.currentPlayerIndex === c;
}

function setMatchPlayerNamesForMode(mode: GameMode) {
    if (mode === 'cvp') {
        // Computer first => computer is player 0
        matchPlayerNames = ['電腦', '玩家'];
        return;
    }
    if (mode === 'pvc') {
        // Player first => computer is player 1
        matchPlayerNames = ['玩家', '電腦'];
        return;
    }
    matchPlayerNames = ['紅色玩家', '藍色玩家'];
}

// 「回首頁」和「重新開始」都會丟掉整場進度，所以共用同一套確認流程；
// 已分出勝負就不必問（沒有進度可以失去）。
type PendingExitAction = 'home' | 'restart';
let pendingExitAction: PendingExitAction | null = null;

function requestExit(action: PendingExitAction) {
    if (appScreen === 'game' && !S.winner) {
        pendingExitAction = action;
        hideGlobalTooltip();
        render();
        return;
    }
    if (action === 'restart') restartMatch();
    else goHome();
}

function requestGoHome() {
    requestExit('home');
}

function requestRestart() {
    requestExit('restart');
}

function cancelExit() {
    pendingExitAction = null;
    render();
}

function confirmExit() {
    const action = pendingExitAction;
    pendingExitAction = null;
    if (action === 'restart') restartMatch();
    else goHome();
}

// 遊戲畫面的返回鍵。
// 注意：不要想用 z-index 讓它浮到電腦回合的攔截層之上 —— 頂列有 backdrop-blur，
// 那會建立新的堆疊脈絡，子元素的 z 值只在該脈絡內有效，壓不過 fixed 的攔截層。
// 電腦回合的逃生出口改由攔截層自己提供（見 renderComputerTurnGuard）。
function renderGoHomeButton() {
    const btn = document.createElement('button');
    btn.className = 'w-8 h-8 rounded-none bg-[#0d2032] flex items-center justify-center text-[#e7c980] hover:bg-[#1c3a52] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none shadow-[2px_2px_0_0_#011c31] border-2 border-[#c48e36]';
    btn.setAttribute('aria-label', '返回首頁');
    btn.title = '返回首頁';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path></svg>';
    btn.onclick = (e) => { e.stopPropagation(); requestGoHome(); };
    return btn;
}

let showGameGuide = false;

function toggleGameGuide() {
    showGameGuide = !showGameGuide;
    hideGlobalTooltip();
    render();
}

// 遊戲說明按鈕（頂列右側，與卡牌一覽並排）
function renderGuideButton() {
    const btn = document.createElement('button');
    btn.className = 'w-8 h-8 rounded-none bg-[#0d2032] flex items-center justify-center text-[#e7c980] hover:bg-[#1c3a52] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none shadow-[2px_2px_0_0_#011c31] border-2 border-[#c48e36]';
    btn.setAttribute('aria-label', '遊戲說明');
    btn.title = '遊戲說明';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.2-1.3 2.1v.2"></path><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>';
    btn.onclick = (e) => { e.stopPropagation(); toggleGameGuide(); };
    return btn;
}

// 內容與「規則說明」整頁同一份，深色底才能正確呈現原本的樣式。
function renderGameGuideOverlay() {
    if (!showGameGuide) return null;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[2500] flex items-center justify-center p-4';
    overlay.onclick = () => toggleGameGuide();

    const modal = document.createElement('div');
    modal.className = 'w-full max-w-2xl max-h-[82dvh] px-panel-dark text-white overflow-hidden flex flex-col';
    modal.onclick = (e) => e.stopPropagation();

    const header = document.createElement('div');
    header.className = 'px-5 py-4 border-b-[3px] border-[#c48e36] flex items-center justify-between shrink-0';
    header.innerHTML = `
        <div>
            <div class="text-[9px] font-black tracking-[0.35em] text-[#c48e36] uppercase">Pixel Duel</div>
            <div class="mt-0.5 text-lg font-black text-[#e7c980]">遊戲說明</div>
        </div>
        <button id="closeGuide" aria-label="關閉" class="w-8 h-8 rounded-none bg-[#0d2032] hover:bg-[#1c3a52] flex items-center justify-center text-[#e7c980] border-2 border-[#c48e36] active:translate-x-[2px] active:translate-y-[2px]">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;
    (header.querySelector('#closeGuide') as HTMLElement).onclick = () => toggleGameGuide();

    const body = document.createElement('div');
    body.className = 'flex-1 overflow-y-auto px-5 pb-5';
    body.innerHTML = renderRulesContentHTML();

    const footer = document.createElement('div');
    footer.className = 'p-3 border-t-[3px] border-[#c48e36] shrink-0';
    footer.innerHTML = `<button id="closeGuideBtn" class="w-full bg-[#0d2032] hover:bg-[#1c3a52] border-2 border-[#c48e36] text-[#e7c980] py-2.5 rounded-none font-black text-[12px] tracking-widest active:translate-x-[2px] active:translate-y-[2px]">關閉說明</button>`;
    (footer.querySelector('#closeGuideBtn') as HTMLElement).onclick = () => toggleGameGuide();

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    return overlay;
}

function renderRestartButton() {
    const btn = document.createElement('button');
    btn.className = 'w-8 h-8 rounded-none bg-[#0d2032] flex items-center justify-center text-[#e7c980] hover:bg-[#1c3a52] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none shadow-[2px_2px_0_0_#011c31] border-2 border-[#c48e36]';
    btn.setAttribute('aria-label', '重新開始');
    btn.title = '重新開始';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"></path><path d="M21 3v6h-6"></path></svg>';
    btn.onclick = (e) => { e.stopPropagation(); requestRestart(); };
    return btn;
}

function renderLeaveConfirmOverlay() {
    if (!pendingExitAction) return null;
    const isRestart = pendingExitAction === 'restart';

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[2600] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm';
    overlay.onclick = () => cancelExit();

    const modal = document.createElement('div');
    modal.className = 'w-full max-w-xs px-panel overflow-hidden';
    modal.onclick = (e) => e.stopPropagation();
    modal.innerHTML = `
        <div class="px-5 pt-5 pb-4 text-center">
            <div class="text-[10px] font-black text-[#603b2d]/70 uppercase tracking-[0.3em]">確認</div>
            <div class="mt-2 text-lg font-black text-[#2a2420]">${isRestart ? '要重新開始嗎？' : '要離開這場對局嗎？'}</div>
            <div class="mt-2 text-[12px] font-bold text-[#603b2d] leading-relaxed">對局還沒結束，${isRestart ? '重開' : '離開'}後目前的進度會消失。</div>
        </div>
        <div class="p-3 bg-[#dcdad3] border-t-[3px] border-[#603b2d] grid grid-cols-2 gap-2">
            <button id="leaveCancel" class="py-2.5 rounded-none bg-[#f4f3f0] border-2 border-[#603b2d] text-[#2a2420] font-black text-xs tracking-widest active:translate-x-[2px] active:translate-y-[2px]">繼續遊戲</button>
            <button id="leaveConfirm" class="py-2.5 rounded-none bg-[#16344c] text-[#e7c980] border-2 border-[#c48e36] font-black text-xs tracking-widest active:translate-x-[2px] active:translate-y-[2px]">${isRestart ? '重新開始' : '離開'}</button>
        </div>
    `;
    (modal.querySelector('#leaveCancel') as HTMLElement).onclick = () => cancelExit();
    (modal.querySelector('#leaveConfirm') as HTMLElement).onclick = () => confirmExit();
    overlay.appendChild(modal);
    return overlay;
}

function goHome() {
    appScreen = 'home';
    pendingExitAction = null;
    showGameGuide = false;
    selectedMode = null;
    // keep game state but hide winner overlay etc.
    S.winner = null;
    winModalDismissed = false;
    showEffectList = false;
    hideGlobalTooltip();
    render();
}

function showRules() {
    appScreen = 'rules';
    hideGlobalTooltip();
    render();
}

function startPvpGame() {
    selectedMode = 'pvp';
    appScreen = 'game';
    setMatchPlayerNamesForMode('pvp');
    resetGameStateForNewMatch();
    initGame();
}

function startCvpGame() {
    warmUpAiEngine();
    selectedMode = 'cvp';
    appScreen = 'game';
    setMatchPlayerNamesForMode('cvp');
    resetGameStateForNewMatch();
    initGame();
}

function startPvcGame() {
    warmUpAiEngine();
    selectedMode = 'pvc';
    appScreen = 'game';
    setMatchPlayerNamesForMode('pvc');
    resetGameStateForNewMatch();
    initGame();
}

function restartMatch() {
    // Restart with current selected mode (fallback to PvP).
    selectedMode = selectedMode || 'pvp';
    appScreen = 'game';
    setMatchPlayerNamesForMode(selectedMode);
    resetGameStateForNewMatch();
    initGame();
}

function finishPreparationPhase() {
    S.inPreparationPhase = false;
    // 開始正式流程：先手回合、出牌階段
    S.currentPlayerIndex = 0;
    S.currentPhaseIndex = 0;
    S.selectedHandCardIndex = -1;
    S.diceResults = [];
    S.skippedPlayBecauseNoHand = false;
    // Mobile：出牌階段時手牌抽屜自動彈出
    // 並切到手牌 tab
    mobileDockTab = 'hand';
    handDrawerOpen = isMobileLayout();
    // 準備階段的出牌數不應計入正式回合限制
    S.players[0].cardsPlayedThisTurn = 0;
    S.players[1].cardsPlayedThisTurn = 0;
    S.phaseHint = '選牌出牌';
    render();
}

// 首頁配色直接取自封面圖（用 canvas 取樣得到的實際色值）：
//   深藍底 #16344c / #1c3a52、外框金 #c48e36、標題米金 #e7c980
//   劍紅 #cd6b6a、盾藍 #7da2bc、藥水綠 #a2cd61、金幣黃 #d0c954
// 像素風的關鍵是「硬邊」：直角、粗框、位移的實心陰影，不用圓角與模糊陰影。
function renderHomeMenuButtonHTML(
    id: string,
    title: string,
    subtitle: string,
    accent: string,
    extraClass = ''
) {
    return `
        <button id="${id}" class="group relative block w-full text-left bg-[#16344c] hover:bg-[#1c3a52] border-[3px] border-[#c48e36] rounded-none px-4 py-3 shadow-[4px_4px_0_0_#011c31] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none ${extraClass}">
            <span class="absolute left-0 top-0 bottom-0 w-[7px]" style="background:${accent}"></span>
            <div class="pl-3 flex items-baseline gap-3 whitespace-nowrap">
                <span class="text-[22px] leading-none font-black tracking-[0.06em] text-[#e7c980] shrink-0">${title}</span>
                <span class="text-[13px] font-black leading-none text-white/85 truncate">${subtitle}</span>
            </div>
        </button>
    `;
}

/*
 * 電腦強度切換。做成兩格分段按鈕而不是開關，因為「高手 / 專家」是並列的兩個
 * 選項，開關會讓人以為其中一個是「關掉」的狀態。
 * 只影響 CvP / PvC；PvP 沒有電腦。
 */
function renderAiLevelToggleHTML() {
    const cell = (level: AiLevel, hint: string) => {
        const on = aiLevel === level;
        return `
            <button
                id="aiLevel-${level}"
                aria-pressed="${on}"
                class="flex-1 rounded-none px-2 py-1.5 border-[3px] leading-none whitespace-nowrap ${
                    on
                        ? 'bg-[#c48e36] border-[#c48e36] shadow-[2px_2px_0_0_#011c31]'
                        : 'bg-[#16344c] border-[#3d5e7a] hover:border-[#c48e36]'
                }"
            >
                <span class="text-[14px] font-black ${on ? 'text-[#0d2032]' : 'text-[#e7c980]'}">
                    ${AI_LEVEL_LABEL[level]}
                </span>
                <span class="ml-1.5 text-[10px] font-bold ${on ? 'text-[#0d2032]/70' : 'text-white/50'}">
                    ${hint}
                </span>
            </button>
        `;
    };
    // 單行排版：首頁在 iPhone SE 上原本剛好塞滿，多一個兩行區塊就會把版權文字擠出畫面
    return `
        <div class="mt-3 flex items-center gap-2">
            <span class="text-[10px] font-black tracking-[0.15em] text-white/40 shrink-0">電腦強度</span>
            ${cell('adept', '出手快')}
            ${cell('expert', '較強')}
        </div>
    `;
}

function renderHomeScreen() {
    const wrap = document.createElement('div');
    wrap.className = 'min-h-[100dvh] w-full bg-[#0d2032] text-white font-sans flex items-center justify-center p-4 sm:p-6';

    wrap.innerHTML = `
        <div class="w-full max-w-3xl">
            <div class="flex justify-center">
                <img
                    src="${COVER_IMG_URL}"
                    alt="像素對決 PIXEL DUEL 封面"
                    class="card-thumb w-auto max-w-[340px] max-h-[40dvh] [@media(max-height:700px)]:max-h-[33dvh] sm:max-w-[400px] sm:max-h-none select-none"
                    draggable="false"
                    loading="eager"
                    decoding="async"
                />
            </div>

            <div class="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
                ${renderHomeMenuButtonHTML('modePvp', 'PvP', '玩家 vs 玩家', '#cd6b6a')}
                ${renderHomeMenuButtonHTML('modeCvp', 'CvP', '電腦先手 vs 玩家', '#7da2bc')}
                ${renderHomeMenuButtonHTML('modePvc', 'PvC', '玩家先手 vs 電腦', '#a2cd61')}
            </div>

            <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                ${renderHomeMenuButtonHTML('rulesBtn', '規則', '玩法教學 / 回合流程', '#d0c954', 'sm:col-start-2')}
            </div>

            ${renderAiLevelToggleHTML()}

            <div class="mt-5 sm:mt-8 text-center leading-relaxed">
                <div class="text-[12px] font-black text-[#e7c980]/90">遊戲設計與美術：周允成-奧羅</div>
                <div class="mt-1.5 text-[11px] font-bold text-white/45">奧羅桌遊設計工作室-練習作品</div>
                <div class="mt-0.5 text-[11px] font-bold text-white/30">僅供推廣使用請勿做任何商業行為</div>
            </div>
        </div>
    `;

    (wrap.querySelector('#modePvp') as HTMLButtonElement).onclick = () => startPvpGame();
    (wrap.querySelector('#modeCvp') as HTMLButtonElement).onclick = () => startCvpGame();
    (wrap.querySelector('#modePvc') as HTMLButtonElement).onclick = () => startPvcGame();
    (wrap.querySelector('#rulesBtn') as HTMLButtonElement).onclick = () => showRules();
    (['adept', 'expert'] as const).forEach(level => {
        const btn = wrap.querySelector(`#aiLevel-${level}`) as HTMLButtonElement | null;
        if (btn) btn.onclick = () => {
            aiLevel = level;
            // 選了專家就先把引擎抓下來，跟玩家挑模式的時間重疊
            warmUpAiEngine();
            render();
        };
    });
    return wrap;
}

// 規則內容同時給「規則說明」整頁與遊戲中的「遊戲說明」彈窗使用，
// 只寫一份，避免兩邊各自漂移。
function renderRulesContentHTML() {
    return `
            <a
                id="physicalRulebookBtn"
                href="${PHYSICAL_RULEBOOK_URL}"
                target="_blank"
                rel="noopener noreferrer"
                class="mt-4 flex items-center justify-between gap-3 bg-[#c48e36] hover:bg-[#d0a04a] border-[3px] border-[#603b2d] px-5 py-3.5 shadow-[4px_4px_0_0_#011c31] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
            >
                <div>
                    <div class="text-[9px] font-black tracking-[0.3em] text-[#2a2420]/70 uppercase">PDF</div>
                    <div class="mt-0.5 text-lg font-black text-[#2a2420]">實體桌遊說明書</div>
                    <div class="mt-0.5 text-[11px] font-bold text-[#2a2420]/75">開啟完整規則書（另開新分頁）</div>
                </div>
                <div class="text-2xl text-[#2a2420] shrink-0" aria-hidden="true">↗</div>
            </a>

            <div class="mt-4 space-y-3 text-white/85">
                <div class="px-panel p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#603b2d]">回合流程</div>
                    <div class="mt-3 flex justify-center">
                        <img
                            src="${TURN_FLOW_IMG_URL}"
                            alt="回合流程：出牌 擲骰 判定 防禦 傷害 攻擊 購買"
                            class="px-crisp card-thumb w-auto max-w-[200px] sm:max-w-[240px] select-none"
                            draggable="false"
                            loading="lazy"
                            decoding="async"
                        />
                    </div>
                </div>
                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">勝利條件</div>
                    <div class="mt-3 text-sm font-bold leading-relaxed">
                        讓對手的 <span class="text-white">HP（生命值）</span> 變成 0（或以下）即可獲勝。
                    </div>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">四個屬性</div>
                    <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div class="bg-[#0d2032] border-2 border-[#c48e36]/60 p-3">
                            <div class="text-[11px] font-black text-red-200 tracking-wider">攻擊 Attack</div>
                            <div class="mt-1 text-[13px] font-black text-white">造成傷害</div>
                            <div class="mt-2 text-sm font-bold leading-relaxed text-slate-200/90">
                                會在對手的「傷害階段」結算。一般攻擊會先被對手的防禦抵擋；部分效果可能造成無視防禦的傷害。
                            </div>
                        </div>
                        <div class="bg-[#0d2032] border-2 border-[#c48e36]/60 p-3">
                            <div class="text-[11px] font-black text-blue-200 tracking-wider">防禦 Defense</div>
                            <div class="mt-1 text-[13px] font-black text-white">抵擋攻擊</div>
                            <div class="mt-2 text-sm font-bold leading-relaxed text-slate-200/90">
                                主要用來扣抵對手的「一般攻擊」。例如對手打出 4 點攻擊，你有 2 點防禦，則只會受到 2 點傷害。
                            </div>
                        </div>
                        <div class="bg-[#0d2032] border-2 border-[#c48e36]/60 p-3">
                            <div class="text-[11px] font-black text-emerald-200 tracking-wider">魔力 Magic</div>
                            <div class="mt-1 text-[13px] font-black text-white">施放/啟動效果</div>
                            <div class="mt-2 text-sm font-bold leading-relaxed text-slate-200/90">
                                用於啟動部分卡牌效果（例如強化攻擊、閃避、追加骰子等）。魔力通常在「判定階段」獲得。
                            </div>
                        </div>
                        <div class="bg-[#0d2032] border-2 border-[#c48e36]/60 p-3">
                            <div class="text-[11px] font-black text-amber-200 tracking-wider">金幣 Gold</div>
                            <div class="mt-1 text-[13px] font-black text-white">購買卡牌</div>
                            <div class="mt-2 text-sm font-bold leading-relaxed text-slate-200/90">
                                在「購買階段」使用，用來從市場買牌或從牌庫抽牌（依提示消耗金幣）。
                            </div>
                        </div>
                    </div>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">開局</div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>先手起手 3 張、後手起手 4 張。</li>
                        <li>遊戲開始會先進入一次 <span class="text-white">準備</span>：後手先打出 1 張牌到任一區域，然後按「開始」。</li>
                    </ul>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">出牌階段</div>
                    <div class="mt-3 text-sm font-bold leading-relaxed">
                        從手牌打出牌到 3 個區域。
                    </div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>操作：先點手牌，再點想放置的區域。</li>
                        <li>限制：每回合最多出 3 張；若你有手牌，至少要出 1 張才能繼續。</li>
                        <li>每個區域最上方的那張牌，會成為該區域本回合的「招式效果」。</li>
                    </ul>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">擲骰階段</div>
                    <div class="mt-3 text-sm font-bold leading-relaxed">
                        選擇擲骰數量並擲骰。骰子會落在不同區域，影響後續的屬性結算。
                    </div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>通常：出牌越多，能擲的骰子越少（畫面右上會顯示可選的擲骰按鈕）。</li>
                        <li>部分卡牌會在此階段提供額外骰子或重擲/捨棄等操作。</li>
                    </ul>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">判定階段</div>
                    <div class="mt-3 text-sm font-bold leading-relaxed">
                        依骰子落點與你各區域的卡牌屬性，結算本回合獲得的 <span class="text-white">攻擊 / 防禦 / 魔力 / 金幣</span>。
                    </div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>這裡是你本回合資源的主要來源（魔力與金幣都在這裡累積）。</li>
                        <li>若卡牌效果需要在判定階段啟動，畫面會提示你可點擊的卡牌/目標。</li>
                    </ul>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">防禦階段</div>
                    <div class="mt-3 text-sm font-bold leading-relaxed">
                        面對對手上一回合留下的攻擊，你可以使用防禦值或特定效果來降低傷害。
                    </div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>一般攻擊會被你的防禦抵擋。</li>
                        <li>若需要選目標（例如選擇要閃避的那一下攻擊），徽章會發光提示可以點。</li>
                    </ul>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">傷害階段</div>
                    <div class="mt-3 text-sm font-bold leading-relaxed">
                        結算對手對你造成的傷害，並扣除你的 HP。
                    </div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>一般傷害會先扣防禦後再扣 HP。</li>
                        <li>若 HP 變成 0（或以下），對手立即獲勝。</li>
                    </ul>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">攻擊階段</div>
                    <div class="mt-3 text-sm font-bold leading-relaxed">
                        你在判定後形成的攻擊（以及此階段可啟動的攻擊效果）會準備完成，並留到對手回合結算。
                    </div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>如果你有可在攻擊階段啟動的卡牌，會發光提示可點擊。</li>
                    </ul>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">購買階段</div>
                    <div class="mt-3 text-sm font-bold leading-relaxed">
                        使用金幣購買卡牌，讓你的手牌與牌組變強。
                    </div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>市場有 3 格：價格依序為 <span class="text-white">3 / 2 / 1</span>（最便宜在最右）。</li>
                        <li>也可以從牌庫抽牌：第 1 張免費，之後依提示消耗金幣（最多抽 3 張）。</li>
                        <li>買到的牌會進入你的手牌，下一回合出牌階段可打出。</li>
                    </ul>
                </div>

                <div class="px-panel-dark p-4">
                    <div class="text-[12px] font-black tracking-widest text-[#e7c980]">操作方式</div>
                    <ul class="mt-3 list-disc pl-5 text-sm font-bold leading-relaxed">
                        <li>桌機：滑鼠移到卡牌可看效果說明（tooltip）。</li>
                        <li>手機：長按卡牌可看效果說明。</li>
                        <li>需要你選目標時（例如選骰子、選攻擊徽章），畫面會用發光/閃爍提示可以點的地方，照著提示點即可。</li>
                    </ul>
                </div>
            </div>
    `;
}

function renderRulesScreen() {
    const wrap = document.createElement('div');
    wrap.className = 'min-h-[100dvh] w-full bg-[#0d2032] text-white font-sans p-4 sm:p-6';

    wrap.innerHTML = `
        <div class="mx-auto w-full max-w-3xl">
            <div class="flex items-center justify-between">
                <div>
                    <div class="text-[10px] font-black tracking-[0.4em] text-[#c48e36] uppercase">PIXEL DUEL</div>
                    <div class="mt-1 text-3xl font-black text-[#e7c980]">規則說明</div>
                </div>
                <button id="backHome" class="px-4 py-2 rounded-none bg-[#16344c] hover:bg-[#1c3a52] border-2 border-[#c48e36] text-[#e7c980] text-[12px] font-black tracking-widest shadow-[3px_3px_0_0_#011c31] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none">返回首頁</button>
            </div>
            ${renderRulesContentHTML()}
        </div>
    `;

    (wrap.querySelector('#backHome') as HTMLButtonElement).onclick = () => goHome();
    return wrap;
}

// 牌庫 / 市場 / 價格的規則本體在 engine/deck.ts，UI 與模擬器共用同一份。
function drawFromDeck() {
    return drawFromDeckList(S.deck);
}

function refillMarket() {
    S.market = refillMarketList(S.market, S.deck);
}

function buyMarketCard(slotIdx: 0 | 1 | 2) {
    if (S.currentPhaseIndex !== 6) return;
    const p = getCurrentPlayer();
    const card = S.market[slotIdx];
    if (!card) return;

    const price = getMarketPrice(slotIdx);
    if (p.gold < price) return;

    p.gold -= price;
    p.hand.push(card);
    S.market[slotIdx] = null;
    addLog(`${p.name} 購買市場牌「${card.effectName}」(-${price} 金)`);
    updateBuyPhaseHint();
    render();
}

function buyFromDeck() {
    if (S.currentPhaseIndex !== 6) return;
    const p = getCurrentPlayer();

    const nextDrawIndex = S.buyDeckDrawCount + 1;
    const cost = getDeckDrawCost(nextDrawIndex);
    if (!Number.isFinite(cost)) return;
    if (p.gold < cost) return;
    if (S.deck.length === 0) return;

    p.gold -= cost;
    const card = drawFromDeck();
    if (!card) return;
    p.hand.push(card);
    S.buyDeckDrawCount = nextDrawIndex;

    addLog(`${p.name} 從牌庫抽牌「${card.effectName}」(-${cost} 金, 第 ${nextDrawIndex} 張)`);
    updateBuyPhaseHint();
    render();
}

// 卡牌說明尾端的 [判定階段][被動觸發] 之類註記，抽出來做成標籤，
// 讓敘述本文乾淨、時機一眼可辨。
function splitCardDesc(desc: string) {
    const tags: string[] = [];
    let text = (desc || '').trim();
    while (true) {
        const m = text.match(/\[([^\]]*)\]\s*$/);
        if (!m) break;
        const label = m[1].trim();
        if (label) tags.unshift(label);
        text = text.slice(0, m.index).trim();
    }
    return {text, tags};
}

function renderCardDescHTML(desc: string) {
    const {text, tags} = splitCardDesc(desc);
    const chips = tags.map(t => {
        const passive = t.includes('被動');
        const tone = passive
            ? 'bg-[#d0c954] text-[#2a2420] border-[#603b2d]'
            : 'bg-[#7ca1bb] text-[#0d2032] border-[#603b2d]';
        return `<span class="inline-flex items-center px-1.5 py-0.5 rounded-none border-2 text-[10px] font-black tracking-wider ${tone}">${t}</span>`;
    }).join('');
    return `
        <div class="text-[#2a2420] text-[12px] font-bold leading-relaxed">${text}</div>
        ${chips ? `<div class="mt-1.5 flex flex-wrap gap-1">${chips}</div>` : ''}
    `;
}

// 卡牌一覽的縮圖也要能長按放大。清單是用 innerHTML 一次組出來的，
// 事件得在掛進 DOM 之後才補綁。
function attachCardListPreviews(root: HTMLElement) {
    root.querySelectorAll('img[data-effect-id]').forEach(el => {
        const effectId = el.getAttribute('data-effect-id') || '';
        const def = CARD_DEFS.find(d => d.effectId === effectId);
        attachCardTooltip(el as HTMLElement, {effectId, alt: def?.name || ''});
    });
    // 捲動清單時收掉預覽，免得浮層黏在原地
    root.querySelectorAll('.overflow-y-auto').forEach(sc => {
        sc.addEventListener('scroll', hideGlobalTooltip);
    });
}

function renderCardListEntryHTML(def: (typeof CARD_DEFS)[number], extraClass = '') {
    // 卡牌一覽用實際卡圖取代左右屬性圓點 —— 卡圖上本來就印著屬性，
    // 再標一次是重複資訊，而且圖比數字好認。
    const src = getCardPngUrlByImgNo(def.imgNo);
    return `
        <div class="p-3 bg-[#f4f3f0] rounded-none border-2 border-[#603b2d] shadow-[3px_3px_0_0_rgba(42,28,16,0.25)] flex gap-3 ${extraClass}">
            <img
                src="${src}"
                alt="${def.name}"
                data-effect-id="${def.effectId}"
                class="card-thumb px-crisp w-[64px] h-[92px] shrink-0 rounded-none border-2 border-[#603b2d] bg-white object-contain select-none cursor-zoom-in"
                draggable="false"
                loading="lazy"
                decoding="async"
            />
            <div class="min-w-0 flex-1">
                <div class="text-[#603b2d] font-black text-[15px] tracking-wide">${def.name}</div>
                ${renderCardDescHTML(def.desc)}
            </div>
        </div>
    `;
}

function toggleEffectList() {
    showEffectList = !showEffectList;
    render();
}

function addLog(msg) {
    // 遊戲內已經有紀錄面板，正式版不需要再往 console 灌訊息
    // （電腦回合每個動作都會呼叫這裡）。
    S.gameLog.push(msg);
    if (S.gameLog.length > 30) S.gameLog.shift(); // Keep more history
}

// --- Computer AI (uniform random) ---

let computerBusy = false;

// AI speed control:
// - 1.0 = default speed
// - 2.0 = 2x faster (half the delay)
// - 0.5 = half speed (double the delay)
let aiSpeed = 0.7;

/*
 * 電腦強度。
 *  - 'adept'（高手）：原本的啟發式 AI，靠手調權重評分。
 *  - 'expert'（專家）：模擬決策 AI，把每個候選實際打過幾百次再挑。
 * 兩者共用同一套規則與同一個回合流程，差別只在「出牌」與「效果發動」怎麼決定。
 */
type AiLevel = 'adept' | 'expert';
let aiLevel: AiLevel = 'expert';

const AI_LEVEL_LABEL: Record<AiLevel, string> = {adept: '高手', expert: '專家'};

/*
 * 「專家」的模擬決策引擎是動態載入的（約 40KB）。
 *
 * 只有選了專家並開始人機對戰才用得到 —— PvP、只看規則、選高手的人
 * 都不該為它付首次載入的成本。而且幾乎不會有等待感：CvP / PvC 的準備階段
 * 都是玩家先出牌，等玩家操作那幾秒早就載完了。
 */
type AiEngine = {
    SimulationGame: typeof import('./sim/game').SimulationGame;
    banditChoosePlayPlan: typeof import('./sim/bandit').banditChoosePlayPlan;
    banditChooseActivation: typeof import('./sim/bandit').banditChooseActivation;
    banditChooseTarget: typeof import('./sim/bandit').banditChooseTarget;
    enumerateDiceSubsets: typeof import('./sim/bandit').enumerateDiceSubsets;
    targetBudget: number;
    fateLadder: import('./sim/bandit').LadderStep[] | null;
};

let aiEnginePromise: Promise<AiEngine | null> | null = null;

function loadAiEngine(): Promise<AiEngine | null> {
    if (!aiEnginePromise) {
        aiEnginePromise = Promise.all([import('./sim/game'), import('./sim/bandit')])
            .then(([game, bandit]) => ({
                SimulationGame: game.SimulationGame,
                banditChoosePlayPlan: bandit.banditChoosePlayPlan,
                banditChooseActivation: bandit.banditChooseActivation,
                banditChooseTarget: bandit.banditChooseTarget,
                enumerateDiceSubsets: bandit.enumerateDiceSubsets,
                targetBudget: bandit.DEFAULT_BANDIT_CONFIG.targetBudget,
                fateLadder: bandit.DEFAULT_BANDIT_CONFIG.fateLadder,
            }))
            .catch(() => {
                /*
                 * 載不到（離線、chunk 遺失）就回 null，讓電腦退回高手繼續打 ——
                 * 對局中途卡死比少一點棋力嚴重得多。
                 * 不快取失敗，下一個決策點會再試一次。
                 */
                aiEnginePromise = null;
                return null;
            });
    }
    return aiEnginePromise;
}

/** 提前開始載入，讓下載跟玩家的操作時間重疊。失敗不影響任何事。 */
function warmUpAiEngine() {
    if (aiLevel === 'expert') void loadAiEngine();
}

/*
 * 把當前局面複製進無頭引擎，給「專家」當思考沙盤。
 * 深拷貝，所以它在裡面怎麼試打都不會動到真實對局。
 */
function makeAiSandbox(engine: AiEngine) {
    return engine.SimulationGame.forThinking({
        deck: S.deck,
        market: S.market,
        players: S.players,
        currentPlayerIndex: S.currentPlayerIndex as 0 | 1,
        currentPhaseIndex: S.currentPhaseIndex,
        diceResults: S.diceResults,
        firstPlayerFirstTurn: S.firstPlayerFirstTurn,
        buyDeckDrawCount: S.buyDeckDrawCount,
    });
}

function randInt(minInclusive: number, maxInclusive: number) {
    return Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

function chooseUniform<T>(arr: T[]): T {
    return arr[randInt(0, arr.length - 1)];
}

function sleep(ms: number) {
    const safe = Math.max(0, Math.round(ms));
    const scaled = Math.max(0, Math.round(safe / Math.max(0.1, aiSpeed)));
    return new Promise<void>((resolve) => setTimeout(resolve, scaled));
}

function getAiName() {
    const idx = getComputerPlayerIndexForMode(selectedMode);
    if (idx === null) return 'AI';
    return S.players[idx].name || 'AI';
}

function logAi(msg: string) {
    addLog(`[AI] ${msg}`);
}

function listOpponentDodgeTargets() {
    const opp = getOpponent();
    const targets: Array<{areaIdx: number; hitIdx: number; val: number}> = [];
    for (let aIdx = 0; aIdx < 3; aIdx++) {
        const hits = opp.attackQueue[aIdx] || [];
        hits.forEach((v, hitIdx) => {
            if (v > 0) targets.push({areaIdx: aIdx, hitIdx, val: v});
        });
    }
    return targets;
}

function listSelfAttackHitTargets() {
    const p = getCurrentPlayer();
    const targets: Array<{areaIdx: number; hitIdx: number; val: number}> = [];
    for (let aIdx = 0; aIdx < 3; aIdx++) {
        const hits = p.currentAttacks[aIdx] || [];
        hits.forEach((v, hitIdx) => {
            if (v > 0) targets.push({areaIdx: aIdx, hitIdx, val: v});
        });
    }
    return targets;
}

function chooseHighestAttackTarget<T extends {val: number}>(targets: T[]): T {
    const maxVal = Math.max(...targets.map(t => t.val));
    return chooseUniform(targets.filter(t => t.val === maxVal));
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

// 「哪些效果要花魔力、花多少」由 engine/activations.ts 的發動條件表決定，
// 不再另外維護一份 id 清單 —— 兩份清單遲早會對不上。
const isMagicSpendEffect = isMagicSpendActivation;

function countMagicSpendCards(p: PlayerState) {
    const activeCount = p.activeAreaEffects.filter(c => isMagicSpendEffect(c?.effectId)).length;
    const handCount = p.hand.filter(c => isMagicSpendEffect(c.effectId)).length;
    return activeCount + Math.min(3, handCount);
}

function countOpponentMagicSpendThreats() {
    const opp = getOpponent();
    return opp.activeAreaEffects.filter(c => isMagicSpendEffect(c?.effectId)).length;
}

function hasExpertEffect(p: PlayerState, effectId: string) {
    return p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === effectId);
}

function hasHandEffect(p: PlayerState, effectId: string) {
    return p.hand.some(c => c.effectId === effectId);
}

function countHandEffects(p: PlayerState, effectIds: string[]) {
    return p.hand.filter(c => effectIds.includes(c.effectId)).length;
}

function getDefensePressureScore(p = getCurrentPlayer()) {
    const incomingNormal = estimateIncomingNormalDamageAfterDefense(p);
    const incomingPiercing = estimateIncomingPiercingDamage();
    const lowHpBonus = p.hp <= 3 ? 3 : p.hp <= 5 ? 2 : p.hp <= 8 ? 1 : 0;
    return incomingNormal + incomingPiercing * 0.75 + lowHpBonus;
}

function getMagicNeedScore(p = getCurrentPlayer()) {
    if (isMirageActive()) return 0;
    const spendCount = countMagicSpendCards(p);
    const expensiveActiveCount = p.activeAreaEffects.filter(c => {
        const eff = c?.effectId;
        return eff === 'flare' || eff === 'forest' || eff === 'barrier' || eff === 'soul_snatch' || eff === 'dodge';
    }).length;
    return spendCount + expensiveActiveCount * 1.3;
}

function aiAttrValue(attr: CardAttr, p = getCurrentPlayer()) {
    let weight = AI_ATTR_WEIGHTS[attr.type] || 1;
    if (attr.type === 'magic') {
        weight += Math.min(1.25, getMagicNeedScore(p) * 0.18);
        if (isMirageActive()) weight *= 0.35;
    } else if (attr.type === 'defense') {
        weight += Math.min(1.35, getDefensePressureScore(p) * 0.18);
        if (p.hp <= 5) weight += 0.35;
    } else if (attr.type === 'gold') {
        if (p.hand.length <= 1) weight += 0.35;
        if (p.board.flat().length >= 6) weight -= 0.15;
    }
    return weight * attr.value;
}

function areaAttrPotential(areaIdx: number, type: CardAttr['type'], p = getCurrentPlayer()) {
    let total = 0;
    ([areaIdx * 2 + 1, areaIdx * 2 + 2] as const).forEach(dieValue => {
        const base = getBaseAttrForDie(S.currentPlayerIndex as 0 | 1, dieValue);
        if (base.type === type) total += base.value;
    });
    p.board[areaIdx].forEach(card => {
        if (card.left.type === type) total += card.left.value;
        if (card.right.type === type) total += card.right.value;
    });
    return total;
}

function averageAreaDieValue(areaIdx: number, p = getCurrentPlayer()) {
    const values = [areaIdx * 2 + 1, areaIdx * 2 + 2];
    return values.reduce((sum, dieValue) => {
        const isLeft = dieValue % 2 !== 0;
        const base = getBaseAttrForDie(S.currentPlayerIndex as 0 | 1, dieValue);
        let score = aiAttrValue(base, p);
        p.board[areaIdx].forEach(card => {
            score += aiAttrValue(isLeft ? card.left : card.right, p);
        });
        return sum + score;
    }, 0) / values.length;
}

function getStrongestIncomingAttack() {
    return Math.max(0, ...getOpponent().attackQueue.flat());
}

function getAreaIndexForEffect(p: PlayerState, effectId: string) {
    return p.activeAreaEffects.findIndex((_, i) => getEffectiveEffectId(p, i) === effectId);
}

function aiEffectWeight(effectId: string | null | undefined) {
    if (!effectId) return 0;
    return AI_EFFECT_WEIGHTS[effectId] ?? 4;
}

function getAreaDiceCounts() {
    const counts = [0, 0, 0];
    S.diceResults.forEach(v => counts[Math.floor((v - 1) / 2)]++);
    return counts;
}

function estimateDieValueForCurrentPlayer(dieValue: number) {
    const p = getCurrentPlayer();
    const areaIdx = Math.floor((dieValue - 1) / 2);
    const isLeft = dieValue % 2 !== 0;
    const base = getBaseAttrForDie(S.currentPlayerIndex as 0 | 1, dieValue);
    let score = aiAttrValue(base);
    p.board[areaIdx].forEach(card => {
        score += aiAttrValue(isLeft ? card.left : card.right);
    });
    const eff = getEffectiveEffectId(p, areaIdx);
    if (eff === 'brilliance') score += 1.5;
    if (eff === 'gale') score += 1;
    if (eff === 'surge' && base.type === 'magic') score += 1.5;
    return score;
}

function chooseLowestValueDieIndex() {
    const counts = getAreaDiceCounts();
    const p = getCurrentPlayer();
    const scored = S.diceResults.map((v, idx) => {
        const areaIdx = Math.floor((v - 1) / 2);
        let score = estimateDieValueForCurrentPlayer(v);
        if (getEffectiveEffectId(p, areaIdx) === 'shadow' && counts[areaIdx] === 1) score -= 5;
        return {idx, score};
    });
    const minScore = Math.min(...scored.map(x => x.score));
    return chooseUniform(scored.filter(x => x.score === minScore)).idx;
}

function chooseExpertFateDiceIndices() {
    const p = getCurrentPlayer();
    const counts = getAreaDiceCounts();
    const scored = S.diceResults.map((v, idx) => ({
        idx,
        areaIdx: Math.floor((v - 1) / 2),
        score: estimateDieValueForCurrentPlayer(v),
    }));
    if (scored.length === 0) return [];

    const shadowAreaIdx = getAreaIndexForEffect(p, 'shadow');
    if (shadowAreaIdx >= 0 && counts[shadowAreaIdx] > 0 && counts[shadowAreaIdx] <= 2) {
        return scored.filter(x => x.areaIdx === shadowAreaIdx).map(x => x.idx);
    }

    const brillianceAreaIdx = getAreaIndexForEffect(p, 'brilliance');
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

function chooseExpertFrostDieIndex() {
    const p = getCurrentPlayer();
    const counts = getAreaDiceCounts();
    const scored = S.diceResults.map((v, idx) => {
        const areaIdx = Math.floor((v - 1) / 2);
        let score = estimateDieValueForCurrentPlayer(v);
        if (getEffectiveEffectId(p, areaIdx) === 'shadow' && counts[areaIdx] === 1) score -= 8;
        return {idx, score};
    });
    const minScore = Math.min(...scored.map(x => x.score));
    return chooseUniform(scored.filter(x => x.score === minScore)).idx;
}

function chooseExpertIllusionTargetArea() {
    const opp = getOpponent();
    const candidates: Array<{areaIdx: number; score: number}> = [];
    opp.activeAreaEffects.forEach((c, areaIdx) => {
        if (!c || ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId)) return;
        candidates.push({areaIdx, score: aiEffectWeight(c.effectId)});
    });
    if (candidates.length === 0) return -1;
    const maxScore = Math.max(...candidates.map(c => c.score));
    return chooseUniform(candidates.filter(c => c.score === maxScore)).areaIdx;
}

function chooseExpertSelfAttackTarget(targets: Array<{areaIdx: number; hitIdx: number; val: number}>) {
    return chooseHighestAttackTarget(targets);
}

function estimateIncomingNormalDamageAfterDefense(p = getCurrentPlayer()) {
    const opp = getOpponent();
    return opp.attackQueue.flat().reduce((sum, atk) => sum + Math.max(0, atk - p.defense), 0);
}

function estimateIncomingPiercingDamage() {
    const opp = getOpponent();
    return (opp.piercingQueue || [[], [], []]).flat().reduce((sum, atk) => sum + atk, 0);
}

function scoreCardForExpert(card: GameCard, areaIdx = -1) {
    const p = getCurrentPlayer();
    const defensePressure = getDefensePressureScore(p);
    const magicNeed = getMagicNeedScore(p);
    const mirageActive = isMirageActive();
    const currentEff = areaIdx >= 0 ? getEffectiveEffectId(p, areaIdx) : null;
    const coveringOwnMirage = currentEff === 'mirage' && card.effectId !== 'mirage';
    const hasBrilliance = hasExpertEffect(p, 'brilliance') || card.effectId === 'brilliance';
    const hasShadow = hasExpertEffect(p, 'shadow') || card.effectId === 'shadow';
    const attackComboCount = countHandEffects(p, ['charge', 'reproduction', 'flare', 'forest', 'amplify', 'thrust', 'magic_bullet'])
        + p.activeAreaEffects.filter(c => ['charge', 'reproduction', 'flare', 'forest', 'amplify', 'thrust', 'magic_bullet'].includes(c?.effectId || '')).length;
    const attackAttrValue = card.left.type === 'attack' ? card.left.value : 0;
    const attackAttrRight = card.right.type === 'attack' ? card.right.value : 0;
    let score = aiEffectWeight(card.effectId) + aiAttrValue(card.left, p) + aiAttrValue(card.right, p);

    if (isMagicSpendEffect(card.effectId)) {
        score += Math.min(3.4, magicNeed * 0.42);
        if (mirageActive && !coveringOwnMirage) score -= 5.5;
        if (coveringOwnMirage) score += 3 + Math.min(3, countMagicSpendCards(p) * 0.55);
    }

    if (card.effectId === 'diversion') {
        score += magicNeed >= 2 && !mirageActive ? Math.min(5.2, magicNeed * 0.9) : -2.4;
        if (attackComboCount >= 2) score += 1.1;
    }
    if (card.effectId === 'mirage') {
        score += countOpponentMagicSpendThreats() * 1.9;
        score -= countMagicSpendCards(p) * 0.85;
        if (magicNeed >= 3) score -= 2.2;
        if (defensePressure >= 4) score += 1.2;
    }
    if (card.effectId === 'brilliance') {
        const diceSupport = (hasHandEffect(p, 'fate') ? 1.2 : 0)
            + (hasHandEffect(p, 'magic_luck') ? 1.3 : 0)
            + (hasHandEffect(p, 'lucky') ? 0.8 : 0)
            + (hasExpertEffect(p, 'fate') ? 1.4 : 0)
            + (hasExpertEffect(p, 'magic_luck') ? 1.5 : 0)
            + (hasExpertEffect(p, 'lucky') ? 0.8 : 0);
        score += diceSupport;
        if (hasExpertEffect(p, 'shadow')) score -= 0.7;
    }
    if (card.effectId === 'shadow') {
        score += (hasExpertEffect(p, 'frost') || hasHandEffect(p, 'frost')) ? 3.2 : 0;
        score += (hasExpertEffect(p, 'fate') || hasHandEffect(p, 'fate')) ? 1.4 : 0;
        score += (hasExpertEffect(p, 'lucky') || hasHandEffect(p, 'lucky')) ? 0.8 : 0;
        if (hasExpertEffect(p, 'brilliance')) score -= 0.6;
    }
    if (card.effectId === 'frost') score += hasShadow ? 3.4 : hasBrilliance ? 0.8 : 0.5;
    if (card.effectId === 'fate') score += hasBrilliance ? 2.3 : hasShadow ? 1.6 : 0.4;
    if (card.effectId === 'magic_luck') {
        score += hasBrilliance ? 3.1 : 0.4;
        if (hasExpertEffect(p, 'shadow') && !hasBrilliance) score -= 1.2;
        if (magicNeed >= 4) score -= 0.8;
    }
    if (card.effectId === 'lucky') score += hasShadow ? 1.1 : hasBrilliance ? 0.9 : 0;

    if (card.effectId === 'holy_light') score += p.hp <= 4 ? 3.4 : p.hp <= 7 ? 1.8 : 0.3;
    if (card.effectId === 'contract') score += p.hp <= 5 ? 3.2 : p.hp <= 8 ? 1.2 : 0;
    if (card.effectId === 'breakthrough') score += p.hp <= 4 ? 3.8 : p.hp <= 6 ? 1.2 : 0;
    if (card.effectId === 'dodge') score += getStrongestIncomingAttack() >= 4 ? 3.2 : defensePressure >= 3 ? 1.7 : 0;
    if (card.effectId === 'barrier') score += defensePressure >= 4 ? 2.8 : defensePressure >= 2 ? 1.1 : 0;
    if (card.effectId === 'shield') score += defensePressure >= 3 ? 1.7 : 0.2;
    if (card.effectId === 'backfire') score += defensePressure >= 2 ? 1.5 : 0.4;

    if (card.effectId === 'magic_bullet') score += (hasExpertEffect(p, 'thrust') || hasHandEffect(p, 'thrust') ? 1.8 : 0)
        + (hasExpertEffect(p, 'forest') || hasHandEffect(p, 'forest') ? 1.4 : 0)
        + (hasExpertEffect(p, 'amplify') || hasHandEffect(p, 'amplify') ? 0.9 : 0);
    if (card.effectId === 'thrust') score += (hasExpertEffect(p, 'magic_bullet') || hasHandEffect(p, 'magic_bullet') ? 2.2 : 0)
        + (attackAttrValue + attackAttrRight >= 1 ? 0.7 : 0);
    if (card.effectId === 'amplify') score += attackComboCount >= 2 ? 1.5 : 0.5;
    if (card.effectId === 'forest') score += attackComboCount >= 2 ? 2.2 : 0.7;
    if (card.effectId === 'charge') score += attackComboCount >= 1 ? 1.1 : 0.2;
    if (card.effectId === 'flare') score += (hasExpertEffect(p, 'charge') || hasHandEffect(p, 'charge') ? 1.1 : 0)
        + (hasExpertEffect(p, 'reproduction') || hasHandEffect(p, 'reproduction') ? 1.3 : 0);
    if (card.effectId === 'reproduction') score += (hasExpertEffect(p, 'flare') || hasHandEffect(p, 'flare') ? 1.6 : 0)
        + (hasExpertEffect(p, 'forest') || hasHandEffect(p, 'forest') ? 1 : 0);
    if (card.effectId === 'surge') score += magicNeed >= 3 ? 1.5 : 0.3;
    if (card.effectId === 'flame_shield') score += defensePressure >= 3 ? 1.3 : 0.4;
    if (card.effectId === 'gale' || card.effectId === 'ambush') {
        score += getOpponent().hp <= 5 ? 1.1 : 0.4;
    }
    if (card.effectId === 'illusion') {
        const targetArea = chooseExpertIllusionTargetArea();
        score += targetArea >= 0 ? aiEffectWeight(getOpponent().activeAreaEffects[targetArea]?.effectId) * 0.5 : -2.5;
    }

    if (areaIdx >= 0) {
        score -= aiEffectWeight(currentEff) * 0.35;
        if (card.effectId === currentEff) score -= 2;
        if (currentEff === 'shadow' && card.effectId !== 'shadow' && !hasExpertEffect(p, 'brilliance')) score -= 1.4;
        if (card.effectId === 'brilliance') {
            const areaValue = averageAreaDieValue(areaIdx, p);
            score += areaValue >= 4 ? 1.1 : 0.4;
        }
        if (card.effectId === 'shadow') {
            const areaValue = averageAreaDieValue(areaIdx, p);
            score += areaValue <= 3.2 ? 1.2 : -0.3;
        }
        if (card.effectId === 'surge') score += areaAttrPotential(areaIdx, 'magic', p) * 0.35;
        if (card.effectId === 'flame_shield') score += areaAttrPotential(areaIdx, 'defense', p) * 0.35;
    }

    return score;
}

function chooseExpertPlay() {
    const p = getCurrentPlayer();
    if (p.hand.length === 0) return null;
    let best: {handIdx: number; areaIdx: number; score: number} | null = null;

    p.hand.forEach((card, handIdx) => {
        for (let areaIdx = 0; areaIdx < 3; areaIdx++) {
            const score = scoreCardForExpert(card, areaIdx) + Math.random() * 0.15;
            if (!best || score > best.score) best = {handIdx, areaIdx, score};
        }
    });

    return best;
}

function chooseExpertPlayCount() {
    const p = getCurrentPlayer();
    if (S.inPreparationPhase) return 1;
    if (p.hand.length <= 1) return 1;
    const bestHandScore = Math.max(...p.hand.map(c => scoreCardForExpert(c)));
    const activeBrilliance = hasExpertEffect(p, 'brilliance');
    const activeShadow = hasExpertEffect(p, 'shadow');
    if (activeBrilliance && !activeShadow) return 1;
    if (activeShadow && !activeBrilliance && p.hand.length >= 5) return 2;
    if (p.hand.length >= 5 && bestHandScore >= 7.5) return 3;
    if (p.hand.length >= 3 && bestHandScore >= 8.2) return 2;
    if (p.cardsPlayedThisTurn === 0 && p.board.flat().length < 3) return Math.min(2, p.hand.length);
    return 1;
}

// Each die lands in one of the three areas with equal probability.
const DIE_AREA_PROBABILITY = 1 / 3;
const SHADOW_PIERCING_DAMAGE = 3;
const BRILLIANCE_ATTACK_BONUS = 7;
const BRILLIANCE_DICE_REQUIRED = 3;
// Shadow damage ignores defense, so it is worth a bit more than plain attack.
const PIERCING_DAMAGE_MULTIPLIER = 1.15;

function averageDieScoreForCurrentPlayer() {
    let total = 0;
    for (let dieValue = 1; dieValue <= 6; dieValue++) {
        total += estimateDieValueForCurrentPlayer(dieValue);
    }
    return total / 6;
}

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

function chooseExpertRollCount(rollOptions: number[]) {
    if (rollOptions.length <= 1) return rollOptions[0];

    const p = getCurrentPlayer();
    const areaIndices = [0, 1, 2] as const;
    const shadowAreas = areaIndices.filter(i => getEffectiveEffectId(p, i) === 'shadow').length;
    const brillianceAreas = areaIndices.filter(i => getEffectiveEffectId(p, i) === 'brilliance').length;
    const avgDieScore = averageDieScoreForCurrentPlayer();
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

function getExpertActivationEffectId(label: string) {
    if (label.includes('奪魂')) return 'soul_snatch';
    if (label.includes('聖光')) return 'holy_light';
    if (label.includes('閃避')) return 'dodge';
    if (label.includes('屏障')) return 'barrier';
    if (label.includes('護盾')) return 'shield';
    if (label.includes('森林')) return 'forest';
    if (label.includes('閃光')) return 'flare';
    if (label.includes('充能')) return 'charge';
    if (label.includes('再現')) return 'reproduction';
    if (label.includes('魔彈')) return 'magic_bullet';
    if (label.includes('增幅')) return 'amplify';
    if (label.includes('突刺')) return 'thrust';
    if (label.includes('命運')) return 'fate';
    if (label.includes('魔運')) return 'magic_luck';
    if (label.includes('冰霜')) return 'frost';
    if (label.includes('幻象')) return 'illusion';
    return '';
}

const getExpertMagicCost = getActivationMagicCost;

type ExpertMagicPlan = {
    planned: Record<string, number>;
    reserved: number;
};

function buildExpertMagicPlan(): ExpertMagicPlan {
    const p = getCurrentPlayer();
    const planned: Record<string, number> = {};
    if (p.magic <= 0 || isMirageActive()) return {planned, reserved: 0};

    const candidates: Array<{effectId: string; cost: number; score: number; priority: number}> = [];
    const canPlanPhase = (phase: number) => S.currentPhaseIndex <= phase;
    const add = (effectId: string, score: number, priority = 0, uses = 1, decay = 1.15) => {
        const cost = getExpertMagicCost(effectId);
        if (cost <= 0 || score < 2.75) return;
        for (let i = 0; i < uses; i++) {
            candidates.push({effectId, cost, score: Math.max(0, score - i * decay), priority});
        }
    };

    if (canPlanPhase(2)) {
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'magic_luck' && !p.magicLuckUsedIndices.includes(i))) {
            add('magic_luck', scoreActivationForExpertRaw('魔運'), 5);
        }
        if (p.activeAreaEffects.some((c, i) => c?.effectId === 'illusion' && !p.illusionUsedIndices.includes(i)) && chooseExpertIllusionTargetArea() >= 0) {
            add('illusion', scoreActivationForExpertRaw('幻象'), 4);
        }
    }

    if (canPlanPhase(3)) {
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'dodge' && !p.evasionUsedIndices.includes(i)) && listOpponentDodgeTargets().length > 0) {
            add('dodge', scoreActivationForExpertRaw('閃避'), 8);
        }
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'barrier' && !p.barrierUsedIndices.includes(i))) {
            add('barrier', scoreActivationForExpertRaw('屏障'), 7);
        }
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'shield')) {
            const incoming = Math.max(0, estimateIncomingNormalDamageAfterDefense(p));
            add('shield', scoreActivationForExpertRaw('護盾'), 6, Math.min(2, Math.ceil(incoming)));
        }
    }

    if (canPlanPhase(5)) {
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'soul_snatch')) {
            const uses = Math.min(3, Math.ceil(Math.max(1, getOpponent().hp) / 2));
            add('soul_snatch', scoreActivationForExpertRaw('奪魂'), 6, uses);
        }
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'holy_light')) {
            const hpNeed = p.hp <= 7 ? 2 : 1;
            add('holy_light', Math.max(scoreActivationForExpertRaw('聖光'), S.currentPhaseIndex >= 4 ? 3.2 : 1), 2, hpNeed);
        }
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'magic_bullet')) {
            add('magic_bullet', scoreActivationForExpertRaw('魔彈'), 3, Math.min(4, p.magic), 4.6);
        }
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'forest' && !p.forestUsedIndices.includes(i)) && hasAnyAttackTarget(p)) {
            add('forest', scoreActivationForExpertRaw('森林'), 5);
        }
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'flare' && !p.flareUsedIndices.includes(i)) && hasAnyAttackTarget(p)) {
            add('flare', scoreActivationForExpertRaw('閃光'), 5);
        }
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'reproduction' && !p.reproductionUsedIndices.includes(i)) && hasAnyAttackTarget(p)) {
            add('reproduction', scoreActivationForExpertRaw('再現'), 4);
        }
        if (p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'charge' && !p.chargeUsedIndices.includes(i)) && hasAnyAttackTarget(p)) {
            add('charge', scoreActivationForExpertRaw('充能'), 4);
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

function scoreActivationForExpert(label: string) {
    const raw = scoreActivationForExpertRaw(label);
    const effectId = getExpertActivationEffectId(label);
    const cost = getExpertMagicCost(effectId);
    if (cost <= 0) return raw;

    const plan = buildExpertMagicPlan();
    if ((plan.planned[effectId] || 0) > 0) return raw + 0.35;

    if (S.currentPhaseIndex >= 5 && raw >= 3.2 && getCurrentPlayer().magic >= cost) {
        return Math.max(2.85, raw * 0.72);
    }
    return Math.min(raw, 2.35);
}

function scoreActivationForExpertRaw(label: string) {
    const p = getCurrentPlayer();
    const opp = getOpponent();
    const maxSelfAttack = Math.max(0, ...listSelfAttackHitTargets().map(t => t.val));
    const totalSelfAttack = p.currentAttacks.flat().reduce((a, b) => a + Math.max(0, b), 0);
    const selfAttackCount = listSelfAttackHitTargets().length;
    const thrustTargetCount = p.currentAttacks.flat().filter(v => v > 0 && v <= 2).length;
    const incomingNormal = estimateIncomingNormalDamageAfterDefense(p);
    const incomingPiercing = estimateIncomingPiercingDamage();
    const hasUnusedThrust = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'thrust' && !p.thrustUsedIndices.includes(i));
    const hasUnusedAmplify = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'amplify' && !p.amplifyUsedIndices.includes(i));
    const hasUnusedForest = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'forest' && !p.forestUsedIndices.includes(i));
    const hasUnusedCharge = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'charge' && !p.chargeUsedIndices.includes(i));
    const hasUnusedReproduction = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'reproduction' && !p.reproductionUsedIndices.includes(i));
    const hasUnusedFlare = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'flare' && !p.flareUsedIndices.includes(i));
    const hasMagicBullet = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'magic_bullet');
    const expensiveAttackFinisherWaiting = maxSelfAttack > 0 && (hasUnusedForest || hasUnusedCharge || hasUnusedReproduction || hasUnusedFlare);
    const reserveMagicForFinisher = expensiveAttackFinisherWaiting
        ? (hasUnusedFlare || hasUnusedForest ? 3 : 2)
        : 0;
    const canPreloadMagicBullet = hasMagicBullet && p.magic > reserveMagicForFinisher;

    if (label.includes('奪魂')) {
        if (opp.hp <= 1) return 20;
        return 7 + (opp.hp <= 3 ? 4 : 0) + (p.hp <= 4 ? 2.5 : p.hp <= 7 ? 1 : 0);
    }
    if (label.includes('聖光')) {
        return p.hp <= 4 ? 9 : p.hp <= 7 ? 5.2 : p.hp <= 10 && incomingNormal + incomingPiercing > 0 ? 3.2 : 1.2;
    }
    if (label.includes('閃避')) {
        const strongest = Math.max(0, ...listOpponentDodgeTargets().map(t => t.val));
        const prevent = Math.max(0, strongest - p.defense);
        return prevent >= 4 || incomingNormal >= 4 ? 10 + strongest : prevent >= 2 || incomingNormal >= 2 ? 7 + prevent : 1.8;
    }
    if (label.includes('屏障')) {
        return incomingNormal >= 4 ? 9 + incomingNormal : incomingNormal >= 2 ? 6.5 : 1.2;
    }
    if (label.includes('護盾')) {
        return incomingNormal >= 2 ? 5.5 + incomingNormal : incomingNormal === 1 && p.hp <= 5 ? 3.5 : 1;
    }
    if (label.includes('森林')) {
        if (canPreloadMagicBullet && p.magic > 3) return 2.6;
        if (hasUnusedThrust && thrustTargetCount > 0) return 2.2;
        if (hasUnusedAmplify && selfAttackCount >= 2) return 2.4;
        return selfAttackCount >= 2 && totalSelfAttack >= 5 ? 9.4 + totalSelfAttack * 0.25 : selfAttackCount >= 2 ? 5.2 : 1.4;
    }
    if (label.includes('閃光')) {
        if (canPreloadMagicBullet && p.magic > 3) return 2.7;
        if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.4;
        if (hasUnusedCharge && p.magic >= 5 && maxSelfAttack <= 5) return 2.5;
        return maxSelfAttack >= 5 ? 10 + maxSelfAttack * 0.35 : maxSelfAttack >= 3 ? 7.8 + maxSelfAttack * 0.2 : 2;
    }
    if (label.includes('充能')) {
        if (canPreloadMagicBullet && p.magic > 2) return 2.7;
        if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.5;
        return maxSelfAttack >= 4 ? 8.6 + maxSelfAttack * 0.2 : maxSelfAttack >= 1 ? 6.4 : 1.5;
    }
    if (label.includes('再現')) {
        if (canPreloadMagicBullet && p.magic > 2) return 2.7;
        if (hasUnusedForest && selfAttackCount >= 2 && totalSelfAttack > maxSelfAttack) return 2.5;
        if (hasUnusedFlare && p.magic >= 5 && maxSelfAttack >= 3) return 2.6;
        return maxSelfAttack >= 5 ? 9.6 + maxSelfAttack * 0.28 : maxSelfAttack >= 2 ? 7.5 + maxSelfAttack * 0.2 : 2.2;
    }
    if (label.includes('魔彈')) {
        const reserveMagic = reserveMagicForFinisher;
        if (p.magic <= reserveMagic && !(hasUnusedThrust && p.magic > 0)) return 1.6;
        return 12
            + (hasUnusedThrust ? 4.6 : 0)
            + (hasUnusedAmplify ? 1.1 : 0)
            + (hasUnusedForest ? 1.1 : 0)
            + (p.magic > reserveMagic + 1 ? 0.7 : 0);
    }
    if (label.includes('增幅')) {
        if (canPreloadMagicBullet && p.magic > reserveMagicForFinisher) return 2.6;
        if (hasUnusedThrust && thrustTargetCount > 0) return 2.4;
        return selfAttackCount >= 2 ? 9.2 + selfAttackCount : selfAttackCount === 1 ? 6.2 : 1;
    }
    if (label.includes('突刺')) {
        return thrustTargetCount >= 2 ? 10 + thrustTargetCount : thrustTargetCount === 1 ? 7.2 : 0;
    }
    if (label.includes('命運')) {
        const rerollCount = chooseExpertFateDiceIndices().length;
        const counts = getAreaDiceCounts();
        const brillianceAlmost = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'brilliance' && counts[i] === 2);
        const shadowBlocked = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'shadow' && counts[i] > 0 && counts[i] <= 2);
        return brillianceAlmost || shadowBlocked ? 8.2 : rerollCount >= 2 ? 6.5 : 3.4;
    }
    if (label.includes('魔運')) {
        const counts = getAreaDiceCounts();
        const brillianceAlmost = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'brilliance' && counts[i] === 2);
        const hasBrilliance = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'brilliance');
        const hasShadow = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'shadow');
        return brillianceAlmost ? 8 : hasBrilliance && !hasShadow ? 5.2 : hasShadow ? 1.5 : 3;
    }
    if (label.includes('冰霜')) {
        const hasShadow = p.activeAreaEffects.some((_, i) => getEffectiveEffectId(p, i) === 'shadow');
        if (hasShadow) return 8.6;
        const lowest = S.diceResults.length > 0 ? Math.min(...S.diceResults.map(v => estimateDieValueForCurrentPlayer(v))) : 99;
        return lowest <= 2.5 ? 4.6 : 2.4;
    }
    if (label.includes('幻象')) {
        const target = chooseExpertIllusionTargetArea();
        return target >= 0 ? 5 + aiEffectWeight(getOpponent().activeAreaEffects[target]?.effectId) : 0;
    }
    return 3;
}

/*
 * 每個效果的中文標籤。AI 評分目前是用 label.includes('命運') 這類字串比對挑分數，
 * 所以標籤用字必須和評分那邊一致；這張表就是那個約定的唯一寫處。
 */
const ACTIVATION_LABELS: Record<string, string> = {
    fate: '命運',
    frost: '冰霜',
    magic_luck: '魔運',
    illusion: '幻象幽影',
    dodge: '閃避',
    shield: '護盾',
    barrier: '屏障',
    amplify: '增幅',
    magic_bullet: '魔彈',
    thrust: '突刺',
    forest: '森林',
    charge: '充能',
    reproduction: '再現',
    flare: '閃光',
    holy_light: '聖光',
    soul_snatch: '奪魂',
};

// effectId -> 實際執行的函式。條件判斷在 engine/activations.ts，這裡只負責派工。
const ACTIVATION_RUNNERS: Record<string, (areaIdx: number) => void> = {
    fate: useFate,
    frost: useFrost,
    magic_luck: useMagicLuck,
    illusion: useIllusion,
    dodge: useEvasion,
    shield: useShield,
    barrier: useBarrier,
    amplify: useAmplify,
    magic_bullet: useMagicBullet,
    thrust: useThrust,
    forest: useForest,
    charge: aIdx => useCharge(aIdx),
    reproduction: useReproduction,
    flare: useFlare,
    holy_light: useHolyLight,
    soul_snatch: useSoulSnatch,
};

/*
 * 目前可發動的效果清單。
 * 條件本體（階段、魔力門檻、每區一次、幻境封鎖…）住在 engine/activations.ts，
 * 與模擬器共用同一份 —— 以前這裡和模擬器各有一串 90 行的 if，改一邊就會安靜走鐘。
 */
function getAvailableActivationsForCurrentPlayer() {
    const p = getCurrentPlayer();
    const opp = getOpponent();
    const options = listActivations({
        phaseIndex: S.currentPhaseIndex,
        player: p,
        opponent: opp,
        diceCount: S.diceResults.length,
        opponentDodgeTargetCount: listOpponentDodgeTargets().length,
        selfAttackTargetCount: listSelfAttackHitTargets().length,
        hasAnyAttackTarget: hasAnyAttackTarget(p),
        hasAnyThrustTarget: hasAnyThrustTarget(p),
        hasCopyableOpponentCard: opp.activeAreaEffects.some(
            c => c && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId),
        ),
        // 幸運骰還沒處理完時，UI 會擋住其他發動（幸運只會在擲骰階段出現）
        blockedBySelection: S.luckySelectionMode,
    });

    return options.map(({effectId, areaIdx}) => ({
        effectId,
        areaIdx,
        label: `${ACTIVATION_LABELS[effectId] ?? effectId}(區域${areaIdx + 1})`,
        run: () => ACTIVATION_RUNNERS[effectId]?.(areaIdx),
    }));
}

/*
 * 命運／冰霜／幸運／幻象要在發動後再挑一個目標。
 * 專家用模擬挑：把每個目標各打一遍到回合結束再比。engine 載不到就退回啟發式。
 *
 * apply 必須和真實套用的那段一致 —— 命運與幻象改完盤面要重跑判定，
 * 少一步模擬出來的就不是同一個遊戲。
 */
async function banditPickTarget<T>(
    candidates: T[],
    apply: (clone: import('./sim/game').SimulationGame, candidate: T) => void,
    ladder?: import('./sim/bandit').LadderStep[] | null,
): Promise<T | null> {
    if (aiLevel !== 'expert' || candidates.length <= 1) return null;
    const engine = await loadAiEngine();
    if (!engine) return null;
    return engine.banditChooseTarget(
        makeAiSandbox(engine), candidates, apply, engine.targetBudget, ladder,
    );
}

async function aiResolveSelectionModesStep() {
    if (S.luckySelectionMode && S.diceResults.length > 0) {
        const dice = S.diceResults.map((_, i) => i);
        const idx = (await banditPickTarget(dice, (clone, i) => { clone.diceResults.splice(i, 1); }))
            ?? chooseLowestValueDieIndex();
        logAi(`${getAiName()} 移除低價值骰子 #${idx + 1}(${S.diceResults[idx]})`);
        await sleep(randInt(280, 500));
        removeLuckyDie(idx);
        return true;
    }

    if (S.fateSelectionMode && S.diceResults.length > 0) {
        const src = S.fateSourceAreaIdx;
        const chosen = (await banditPickTarget(
            (await loadAiEngine())?.enumerateDiceSubsets(S.diceResults.length) ?? [],
            (clone, subset) => {
                applyFate(clone.currentPlayerPublic(), src, clone.diceResults, subset);
                clone.handleJudgingPublic();
            },
            // 命運的候選有幾十個，平均分預算會薄到只剩雜訊，改用淘汰階梯
            (await loadAiEngine())?.fateLadder,
        )) ?? chooseExpertFateDiceIndices();
        logAi(`${getAiName()} 重擲 ${chosen.length} 顆低價值骰（#${chosen.map(i => i + 1).join(',')}）`);
        await sleep(randInt(280, 500));
        chosen.forEach(i => toggleDiceIndexSelection(i));
        await sleep(randInt(180, 320));
        confirmFate();
        return true;
    }

    if (S.evasionSelectionMode) {
        const targets = listOpponentDodgeTargets();
        if (targets.length > 0) {
            const t = chooseHighestAttackTarget(targets);
            logAi(`${getAiName()} 閃避：優先無視最高攻擊 ${t.val}`);
            await sleep(randInt(280, 500));
            targetEvasion(t.areaIdx, t.hitIdx);
            return true;
        }
        S.evasionSelectionMode = false;
        return false;
    }

    if (S.illusionSelectionMode) {
        const src = S.illusionSourceAreaIdx;
        const copyable = getOpponent().activeAreaEffects
            .map((c, i) => (c && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId) ? i : -1))
            .filter(i => i >= 0);
        const aIdx = (await banditPickTarget(copyable, (clone, i) => {
            const card = clone.opponentPublic().activeAreaEffects[i];
            if (card && applyIllusion(clone.currentPlayerPublic(), src, card)) clone.handleJudgingPublic();
        })) ?? chooseExpertIllusionTargetArea();
        if (aIdx >= 0) {
            const name = getOpponent().activeAreaEffects[aIdx]?.effectName || '未知';
            logAi(`${getAiName()} 幻象：複製高價值效果「${name}」`);
            await sleep(randInt(280, 500));
            targetIllusion(aIdx);
            return true;
        }
        S.illusionSelectionMode = false;
        return false;
    }

    if (S.frostSelectionMode && S.diceResults.length > 0) {
        const src = S.frostSourceAreaIdx;
        const dice = S.diceResults.map((_, i) => i);
        const idx = (await banditPickTarget(dice, (clone, i) => {
            applyFrost(clone.currentPlayerPublic(), src, clone.diceResults, i);
        })) ?? chooseExpertFrostDieIndex();
        logAi(`${getAiName()} 冰霜：捨棄最適合的骰子 #${idx + 1}(${S.diceResults[idx]})`);
        await sleep(randInt(280, 500));
        targetFrost(idx);
        return true;
    }

    if (S.chargeSelectionMode) {
        const targets = listSelfAttackHitTargets();
        if (targets.length > 0) {
            const t = chooseExpertSelfAttackTarget(targets);
            logAi(`${getAiName()} 充能：強化最高攻擊 ${t.val}`);
            await sleep(randInt(280, 500));
            useCharge(t.areaIdx, t.hitIdx);
            return true;
        }
        S.chargeSelectionMode = false;
        return false;
    }

    if (S.reproductionSelectionMode) {
        const targets = listSelfAttackHitTargets();
        if (targets.length > 0) {
            const t = chooseExpertSelfAttackTarget(targets);
            logAi(`${getAiName()} 再現：複製最高攻擊 ${t.val}`);
            await sleep(randInt(280, 500));
            targetReproduction(t.areaIdx, t.hitIdx);
            return true;
        }
        S.reproductionSelectionMode = false;
        return false;
    }

    if (S.flareSelectionMode) {
        const targets = listSelfAttackHitTargets();
        if (targets.length > 0) {
            const t = chooseExpertSelfAttackTarget(targets);
            logAi(`${getAiName()} 閃光：翻倍最高攻擊 ${t.val}`);
            await sleep(randInt(280, 500));
            targetFlare(t.areaIdx, t.hitIdx);
            return true;
        }
        S.flareSelectionMode = false;
        return false;
    }

    return false;
}

async function aiActivationLoopStep() {
    const acts = getAvailableActivationsForCurrentPlayer();
    if (acts.length === 0) return false;

    /*
     * 專家：把「發動這個效果」與「不發動」各模擬幾十次到回合結束再挑。
     * 每次只決定下一個原子行動，做完重新搜 —— 發動幾次、什麼順序會自然浮現。
     */
    const engine = aiLevel === 'expert' ? await loadAiEngine() : null;
    if (engine) {
        const choice = engine.banditChooseActivation(makeAiSandbox(engine), S.currentPhaseIndex);
        if (choice === 'STOP') {
            await sleep(randInt(140, 260));
            return false;
        }
        // 用效果身分對映，不用索引 —— UI 這份清單是自己算的
        const chosen = acts.find(a => a.effectId === choice.effectId && a.areaIdx === choice.areaIdx);
        if (!chosen) {
            await sleep(randInt(140, 260));
            return false;
        }
        logAi(`${getAiName()} 發動效果：${chosen.label}`);
        await sleep(randInt(280, 520));
        chosen.run();
        return true;
    }

    const scored = acts.map(act => ({
        act,
        score: scoreActivationForExpert(act.label) + Math.random() * 0.1,
    })).filter(x => x.score >= 2.75);

    if (scored.length === 0) {
        await sleep(randInt(140, 260));
        return false;
    }

    const maxScore = Math.max(...scored.map(x => x.score));
    const chosen = chooseUniform(scored.filter(x => x.score === maxScore)).act;
    logAi(`${getAiName()} 發動效果：${chosen.label}`);
    await sleep(randInt(280, 520));
    chosen.run();
    return true;
}

async function aiDoPlayPhase() {
    const p = getCurrentPlayer();
    if (S.currentPhaseIndex !== 0) return;

    if (p.hand.length === 0) {
        logAi(`${getAiName()} 無手牌，進入擲骰`);
        await sleep(randInt(160, 300));
        nextPhase();
        return;
    }

    /*
     * 專家：把「打幾張、哪幾張、放哪一區」當成完整方案來比較，各模擬數十次。
     * 準備階段只能出 1 張，方案取第一步就好。
     */
    const engine = aiLevel === 'expert' ? await loadAiEngine() : null;
    if (engine) {
        const plan = engine.banditChoosePlayPlan(makeAiSandbox(engine)) ?? [];
        const steps = S.inPreparationPhase ? plan.slice(0, 1) : plan;
        logAi(`${getAiName()} 出牌：規劃打出 ${steps.length} 張`);
        await sleep(randInt(250, 450));

        for (const step of steps) {
            const handIdx = p.hand.findIndex(c => c.id === step.cardId);
            if (handIdx === -1) continue;
            const cardName = p.hand[handIdx]?.effectName || '未知';
            S.selectedHandCardIndex = handIdx;
            logAi(`${getAiName()} 出牌：「${cardName}」→ 區域${step.areaIdx + 1}`);
            await sleep(randInt(260, 480));
            playToBoard(step.areaIdx);
            await sleep(randInt(160, 300));
        }
    } else {
        const maxPlays = S.inPreparationPhase ? 1 : Math.min(3, p.hand.length);
        const playCount = Math.min(maxPlays, Math.max(1, chooseExpertPlayCount()));
        logAi(`${getAiName()} 出牌：規劃打出 ${playCount} 張`);
        await sleep(randInt(250, 450));

        for (let i = 0; i < playCount; i++) {
            const choice = chooseExpertPlay();
            if (!choice) break;
            const cardName = p.hand[choice.handIdx]?.effectName || '未知';
            S.selectedHandCardIndex = choice.handIdx;
            logAi(`${getAiName()} 出牌：「${cardName}」→ 區域${choice.areaIdx + 1}`);
            await sleep(randInt(260, 480));
            playToBoard(choice.areaIdx);
            await sleep(randInt(160, 300));
            if (S.inPreparationPhase) break;
        }
    }

    if (S.inPreparationPhase && S.players[1].cardsPlayedThisTurn >= 1) {
        logAi(`${getAiName()} 準備完成：開始遊戲`);
        await sleep(randInt(240, 420));
        finishPreparationPhase();
        return;
    }

    await sleep(randInt(160, 280));
    nextPhase();
}

async function aiDoRollPhase() {
    if (S.currentPhaseIndex !== 1) return;
    if (S.diceResults.length > 0) {
        await sleep(randInt(160, 280));
        nextPhase();
        return;
    }

    const p = getCurrentPlayer();
    const shouldRollFiveBecauseNoHand = p.hand.length === 0 && p.cardsPlayedThisTurn === 0;
    const rollOptions = shouldRollFiveBecauseNoHand
        ? [5]
        : (p.cardsPlayedThisTurn > 0 ? [5 - p.cardsPlayedThisTurn] : [2, 3, 4]);
    const count = chooseExpertRollCount(rollOptions);
    logAi(`${getAiName()} 擲骰：選擇 ${count} 顆`);
    await sleep(randInt(240, 420));
    rollDice(count);
}

async function aiDoBuyPhase() {
    if (S.currentPhaseIndex !== 6) return;
    const p = getCurrentPlayer();

    if (S.deck.length > 0 && S.buyDeckDrawCount < 1) {
        logAi(`${getAiName()} 購買：先抽免費牌`);
        await sleep(randInt(240, 420));
        buyFromDeck();
        return;
    }

    const actions: Array<{label: string; score: number; run: () => void}> = [];
    const nextDrawIndex = S.buyDeckDrawCount + 1;
    const nextDrawCost = getDeckDrawCost(nextDrawIndex);
    if (S.deck.length > 0 && Number.isFinite(nextDrawCost) && p.gold >= nextDrawCost) {
        actions.push({
            label: `抽牌庫(-${nextDrawCost}金)`,
            score: 5.8 - nextDrawCost * 1.1 + Math.random() * 0.1,
            run: () => buyFromDeck(),
        });
    }

    ([0, 1, 2] as const).forEach((idx) => {
        const c = S.market[idx];
        if (!c) return;
        const price = getMarketPrice(idx);
        if (p.gold < price) return;
        actions.push({
            label: `買市場(價格${price})「${c.effectName}」`,
            score: scoreCardForExpert(c) - price * 1.35 + Math.random() * 0.1,
            run: () => buyMarketCard(idx),
        });
    });

    if (actions.length === 0) {
        logAi(`${getAiName()} 購買：沒有可買選項，結束購買`);
        await sleep(randInt(240, 420));
        nextPhase();
        return;
    }

    const maxScore = Math.max(...actions.map(a => a.score));
    const chosen = chooseUniform(actions.filter(a => a.score === maxScore));
    logAi(`${getAiName()} 購買：${chosen.label}`);
    await sleep(randInt(280, 500));
    chosen.run();
}

async function runComputerTurnLoop() {
    if (computerBusy) return;
    if (!isComputerTurnNow()) return;
    if (S.winner) return;

    computerBusy = true;
    try {
        // Keep acting while it's still computer's turn.
        // Hard cap to avoid infinite loops.
        for (let step = 0; step < 200; step++) {
            if (!isComputerTurnNow()) break;
            if (S.winner) break;

            // Resolve any pending selection mode first
            const didResolve = await aiResolveSelectionModesStep();
            if (didResolve) {
                await sleep(randInt(150, 350));
                continue;
            }

            // Try 90% activation once per loop
            const didActivate = await aiActivationLoopStep();
            if (didActivate) {
                await sleep(randInt(150, 350));
                continue;
            }

            // Phase default actions
            if (S.inPreparationPhase) {
                // only player 1 acts in prep phase; if computer is player 0 in CvP, they will just wait.
                if (S.currentPlayerIndex === 1) {
                    await aiDoPlayPhase();
                    continue;
                }
                // If computer is player 0, prep belongs to player 1; do nothing.
                break;
            }

            if (S.currentPhaseIndex === 0) {
                await aiDoPlayPhase();
                continue;
            }
            if (S.currentPhaseIndex === 1) {
                await aiDoRollPhase();
                await sleep(randInt(150, 350));
                // lucky selection will be resolved in next loop
                continue;
            }
            if (S.currentPhaseIndex === 2) {
                logAi(`${getAiName()} 結束判定階段`);
                await sleep(randInt(250, 450));
                nextPhase();
                continue;
            }
            if (S.currentPhaseIndex === 3) {
                logAi(`${getAiName()} 結束防禦階段`);
                await sleep(randInt(250, 450));
                nextPhase();
                continue;
            }
            if (S.currentPhaseIndex === 4) {
                logAi(`${getAiName()} 結束傷害階段`);
                await sleep(randInt(250, 450));
                nextPhase();
                continue;
            }
            if (S.currentPhaseIndex === 5) {
                logAi(`${getAiName()} 結束攻擊階段`);
                await sleep(randInt(250, 450));
                nextPhase();
                continue;
            }
            if (S.currentPhaseIndex === 6) {
                await aiDoBuyPhase();
                await sleep(randInt(150, 350));
                continue;
            }

            // Fallback
            break;
        }
    } finally {
        computerBusy = false;
    }
}

// --- Initialization ---

function initGame() {
  
  // 牌庫組成與洗牌都在 engine/deck.ts；
  // 這裡原本用 sort(() => Math.random() - 0.5)，那不是均勻洗牌
  // （比較函式不一致，某些排列會明顯偏多），已換成 Fisher-Yates。
  S.deck = shuffled(buildDeck());

  // Deal initial hands
  // 先手 3 張、後手 4 張
  S.players[0].hand = [S.deck.pop(), S.deck.pop(), S.deck.pop()];
  S.players[1].hand = [S.deck.pop(), S.deck.pop(), S.deck.pop(), S.deck.pop()];

  // Enter one-time Preparation Phase (後手先手動打出 1 張)
  S.inPreparationPhase = true;
  S.currentPlayerIndex = 1;
  S.currentPhaseIndex = 0; // reuse play-to-board UI
  S.selectedHandCardIndex = -1;
  S.diceResults = [];
  // Mobile：出牌階段時手牌抽屜自動彈出
  // 並預設切回手牌（避免停留在上一回合的市場 tab）
  mobileDockTab = 'hand';
  handDrawerOpen = isMobileLayout();
  S.players[0].cardsPlayedThisTurn = 0;
  S.players[1].cardsPlayedThisTurn = 0;
  S.phaseHint = '後手先出1張牌';

  // Setup global market
  S.market = [null, null, null];
  refillMarket();

  render();
}

// --- Logic functions ---

function getOpponentIndex() {
  return 1 - S.currentPlayerIndex;
}

function getCurrentPlayer() {
  return S.players[S.currentPlayerIndex];
}

function getOpponent() {
  return S.players[getOpponentIndex()];
}

// 主要動作按鈕被擋住的原因；沒被擋就回 null。
// 之前按鈕只在「幸運模式」時變灰，但購買階段沒抽免費牌、出牌階段還沒出牌
// 同樣會讓 nextPhase() 直接返回 —— 按鈕看起來能按卻沒反應。
// 這裡把原因集中起來：按鈕依此變灰，中央提示也直接說明原因，
// 使用者不必先按一下才知道被擋。
/*
 * 中央提示要顯示什麼。手機與桌機共用 —— 這幾句話原本兩邊各寫一份，
 * 改字時只改一邊就會兩處說法不同。
 *
 * 優先序（後面的蓋前面的）：階段提示 < 按鈕被擋的原因 < 選取模式 < 勝負。
 * blockReason 由呼叫端決定要不要帶：桌機目前沒有把它接上去。
 */
function getDisplayPhaseHint(blockReason: string | null): string {
    if (S.winner) return `${S.winner}勝利`;
    if (S.illusionSelectionMode) return '幻象幽影：複製對手效果';
    if (S.luckySelectionMode) return '幸運之石：移除1骰';
    return blockReason || S.phaseHint;
}

function getActionBlockReason(): string | null {
    // 準備階段的「開始」有自己的啟用條件（後手出滿 1 張），
    // 這裡不要插手，否則會顯示錯的原因。
    if (S.inPreparationPhase) return null;
    if (S.luckySelectionMode) return '幸運之石：移除1骰';
    const p = getCurrentPlayer();
    if (S.currentPhaseIndex === 0 && p.hand.length > 0 && p.cardsPlayedThisTurn === 0) return '至少出 1 張';
    // 和購買階段的提示用同一句，否則短的那句會蓋掉長的，變成兩種說法
    if (S.currentPhaseIndex === 6 && S.deck.length > 0 && S.buyDeckDrawCount < 1) return '先抽免費牌，再買';
    return null;
}

function nextPhase() {
  const now = Date.now();
  if (now < phaseAdvanceLockUntil) return;
  phaseAdvanceLockUntil = now + 250;

  if (S.winner) return;
  if (S.luckySelectionMode) return;
  const p = getCurrentPlayer();

  if (S.currentPhaseIndex === 0) { // Play Phase
      // Rule: Hand >= 1 -> Must play at least 1
      if (p.hand.length > 0 && p.cardsPlayedThisTurn === 0) {
          S.phaseHint = '至少出 1 張';
          render();
          return;
      }

       // 只有「回合一開始就沒有手牌」才算跳過出牌階段（擲骰階段固定投 5 顆）。
       // 把手牌打完不算 —— 那是正常出過牌，訊息會誤導。
       if (p.hand.length === 0 && p.cardsPlayedThisTurn === 0) {
           S.skippedPlayBecauseNoHand = true;
           S.phaseHint = '沒有手牌，直接進行擲骰';
       } else {
           S.skippedPlayBecauseNoHand = false;
       }

      S.currentPhaseIndex = 1;
      // 手機版 UX：離開出牌階段就先收起手牌抽屜
      handDrawerOpen = false;
      if (!S.skippedPlayBecauseNoHand) {
          S.phaseHint = '請擲骰';
      }
  } else if (S.currentPhaseIndex === 1) { // Roll Phase
      if (S.diceResults.length === 0) {
          S.phaseHint = '必須先擲骰';
          render();
          return;
      }
      S.currentPhaseIndex = 2;
      S.phaseHint = '數值判定中';
      handleJudging();
  } else if (S.currentPhaseIndex === 2) { // Judging
      S.currentPhaseIndex = 3;
      if (S.currentPlayerIndex === 0 && S.firstPlayerFirstTurn) {
          S.phaseHint = '先手首回合跳過';
      } else {
          S.phaseHint = '防禦對手攻擊';
      }
      handleDefensePhaseStart();
  } else if (S.currentPhaseIndex === 3) { // Defense
      S.currentPhaseIndex = 4;
      if (S.currentPlayerIndex === 0 && S.firstPlayerFirstTurn) {
          S.phaseHint = '先手首回合跳過';
      } else {
          S.phaseHint = '結算傷害';
      }
      handleDamagePhase();
  } else if (S.currentPhaseIndex === 4) { // Damage
      S.currentPhaseIndex = 5;
      S.phaseHint = '攻擊效果發動';
      handleAttackPhaseStart();
  } else if (S.currentPhaseIndex === 5) { // Attack
      // Store current attacks into queue
      p.attackQueue = p.currentAttacks.map(h => [...h]);
      p.piercingQueue = p.piercingAttacks.map(h => [...h]);
      S.currentPhaseIndex = 6;
      // 提示由 handleBuyPhase 依牌庫狀態決定，這裡不要先寫一個馬上被蓋掉的值
      handleBuyPhase();
  } else if (S.currentPhaseIndex === 6) { // Buy
      // 必須先從牌庫抽第 1 張 (0 金)
      // 若牌庫已空：取消「必抽 1 張免費卡」限制，避免卡關
      if (S.deck.length > 0 && S.buyDeckDrawCount < 1) {
          S.phaseHint = '先抽免費牌';
          render();
          return;
      }

      // End of buy: 自動處理市場補位
      refillMarket();

      // End turn
      p.magic = 0;
      p.gold = 0;
      p.defense = 0;
      
      S.currentPlayerIndex = 1 - S.currentPlayerIndex;
      S.currentPhaseIndex = 0;
      S.phaseHint = S.players[S.currentPlayerIndex].hand.length === 0
          ? '沒有手牌，直接進行擲骰'
          : '選牌出牌';
      S.diceResults = [];
      S.skippedPlayBecauseNoHand = false;
      // Mobile：進入出牌階段時手牌抽屜自動彈出
      // 並預設切回手牌（避免停留在上一回合的市場 tab）
      mobileDockTab = 'hand';
      handDrawerOpen = isMobileLayout();
      S.players[S.currentPlayerIndex].cardsPlayedThisTurn = 0;
      S.players[S.currentPlayerIndex].chargeUsedIndices = [];
      S.players[S.currentPlayerIndex].amplifyUsedIndices = [];
      S.players[S.currentPlayerIndex].fateUsedIndices = [];
      S.players[S.currentPlayerIndex].evasionUsedIndices = [];
      S.players[S.currentPlayerIndex].reproductionUsedIndices = [];
      S.players[S.currentPlayerIndex].flareUsedIndices = [];
      S.players[S.currentPlayerIndex].magicLuckUsedIndices = [];
      S.players[S.currentPlayerIndex].illusionUsedIndices = [];
      S.players[S.currentPlayerIndex].illusionCopiedEffectIds = [null, null, null];
      S.players[S.currentPlayerIndex].thrustUsedIndices = [];
      S.players[S.currentPlayerIndex].barrierUsedIndices = [];
      S.players[S.currentPlayerIndex].forestUsedIndices = [];
      S.players[S.currentPlayerIndex].frostUsedIndices = [];
      S.players[S.currentPlayerIndex].magicSpentInJudging = 0;
      S.players[S.currentPlayerIndex].extraFrostAttacks = [[], [], []];
      S.players[S.currentPlayerIndex].contractTriggeredAreaIdx = -1;
      S.players[S.currentPlayerIndex].turnBaseStats = { sums: [0, 0, 0], defense: [0, 0, 0], magic: [0, 0, 0], gold: [0, 0, 0] };
      S.players[S.currentPlayerIndex].breakthroughApplied = false;
      S.players[S.currentPlayerIndex].currentAttacks = [[0], [0], [0]];
      S.players[S.currentPlayerIndex].piercingAttacks = [[], [], []];
      S.players[S.currentPlayerIndex].magic = 0;
      S.players[S.currentPlayerIndex].gold = 0;
      S.players[S.currentPlayerIndex].defense = 0;
      
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
      
      if (S.currentPlayerIndex === 0) {
          S.firstPlayerFirstTurn = false;
      }
  }

  render();
}

function isMirageActive() {
    return isMirageActiveFor(S.players);
}

function handleJudging() {
    // 判定的規則本體在 engine/resolve.ts，與模擬器共用同一份
    resolveJudging(getCurrentPlayer(), S.currentPlayerIndex as 0 | 1, S.diceResults, addLog);
}

function handleDefensePhaseStart() {
    const p = getCurrentPlayer();
    const opp = getOpponent();

    if (S.currentPlayerIndex === 0 && S.firstPlayerFirstTurn) {
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

    // 先手第一回合不會受到攻擊（對手還沒行動過）
    if (S.currentPlayerIndex === 0 && S.firstPlayerFirstTurn) return;

    addLog('--- 傷害階段 ---');
    // 傷害結算的規則本體在 engine/resolve.ts，與模擬器共用同一份
    const {totalDamage, defeated} = resolveDamagePhase(p, opp, addLog);
    S.phaseHint = `受傷 ${totalDamage}`;

    if (defeated) {
        S.winner = opp.name;
        winModalDismissed = false;
        addLog(`遊戲結束！${S.winner}勝利！`);
    }
}

function handleAttackPhaseStart() {
    const p = getCurrentPlayer();
    p.contractTriggeredAreaIdx = -1; // Reset highlight as we leave damage phase
    addLog('--- 攻擊階段 ---');
    render();
}

function useEvasion(areaIdx) {
    if (S.currentPhaseIndex !== 3) return; // Defense Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'dodge') {
        if (p.evasionUsedIndices.includes(areaIdx)) {
            showToast('這張閃避卡本回合已使用過');
            return;
        }
        if (p.magic >= 3) {
            S.evasionSelectionMode = !S.evasionSelectionMode;
            S.evasionSourceAreaIdx = areaIdx;
            if (S.evasionSelectionMode) {
                addLog('閃避已啟動，請點擊對手的一個攻擊徽章');
            }
            render();
        } else {
            showToast('魔力不足 (需要 3 點)');
        }
    }
}

function targetEvasion(areaIdx, hitIdx) {
    if (!S.evasionSelectionMode) return;
    const p = getCurrentPlayer();
    const opp = getOpponent();

    // Regular attacks only
    if (opp.attackQueue[areaIdx] && opp.attackQueue[areaIdx][hitIdx] !== undefined) {
        if (applyEvasion(p, opp, S.evasionSourceAreaIdx, areaIdx, hitIdx)) {
            S.evasionSelectionMode = false;
            S.evasionSourceAreaIdx = -1;
            addLog('閃避成功！消耗 3 點魔力已無視該次攻擊');
            render();
        } else {
            showToast('魔力不足 (需要 3 點)');
            S.evasionSelectionMode = false;
            S.evasionSourceAreaIdx = -1;
            render();
        }
    } else {
        showToast('只能閃避標準攻擊，無法閃避穿透傷害');
    }
}

function useShield(areaIdx) {
    if (S.currentPhaseIndex !== 3) return; // Defense Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'shield') {
        if (applyShield(p)) {
            addLog(`${p.name} 使用了「護盾」，消耗 2 點魔力增加 1 點防禦`);
            render();
        } else {
            showToast('魔力不足 (需要 2 點)');
        }
    }
}

function useMagicLuck(areaIdx) {
    if (S.currentPhaseIndex !== 2) return; // Judging Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'magic_luck') {
        if (p.magicLuckUsedIndices.includes(areaIdx)) {
            showToast('這張魔運卡本回合已使用過');
            return;
        }
        const newVal = applyMagicLuck(p, areaIdx, S.diceResults);
        if (newVal !== null) {
            addLog(`${p.name} 使用了「魔運」，消耗 2 點魔力額外投擲一顆骰子：${newVal}`);
            // 多了一顆骰子，判定要整個重算（疾風、暗影、光輝都看骰子數）
            handleJudging();
            render();
        } else {
            showToast('魔力不足 (需要 2 點)');
        }
    }
}

function useIllusion(areaIdx) {
    if (S.currentPhaseIndex !== 2) return; // Judging Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];
    if (card && card.effectId === 'illusion') {
        if (p.illusionUsedIndices.includes(areaIdx)) {
            showToast('幻象幽影本回合已使用過');
            return;
        }

        const opp = getOpponent();
        const hasCopyableCard = opp.activeAreaEffects.some(c => c && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId));
        if (!hasCopyableCard) {
            showToast('對手目前沒有可複製的招式卡');
            return;
        }

        if (p.magic >= 1) {
            S.illusionSelectionMode = true;
            S.illusionSourceAreaIdx = areaIdx;
            addLog(`${p.name} 啟動「幻象幽影」，請選擇對手的一張招式卡複製`);
            render();
        } else {
            showToast('魔力不足 (需要 1 點)');
        }
    }
}

function targetIllusion(oppAreaIdx) {
    if (!S.illusionSelectionMode) return;
    const p = getCurrentPlayer();
    const opp = getOpponent();
    const targetCard = opp.activeAreaEffects[oppAreaIdx];

    if (!targetCard) {
        showToast('該區域沒有招式卡可複製');
        return;
    }

    if (ILLUSION_UNCOPYABLE_EFFECT_IDS.has(targetCard.effectId)) {
        showToast('不可複製該招式卡');
        return;
    }

    if (!applyIllusion(p, S.illusionSourceAreaIdx, targetCard)) {
        showToast('魔力不足 (需要 1 點)');
        return;
    }

    addLog(`${p.name} 使用「幻象幽影」複製了對手的「${targetCard.effectName}」！`);
    
    S.illusionSelectionMode = false;
    S.illusionSourceAreaIdx = -1;
    
    handleJudging(); // Recalculate with new effect
    render();
}

function useAmplify(areaIdx) {
    if (S.currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'amplify') {
        if (p.amplifyUsedIndices.includes(areaIdx)) {
            showToast('這張增幅卡本回合已使用過');
            return;
        }
        // No attacks => cannot meaningfully trigger.
        if (!hasAnyAttackTarget(p)) {
            // 和其他「不能這樣做」一致用浮動訊息；寫進階段提示會一直留著蓋住當下階段
            showToast('沒有可強化的攻擊');
            return;
        }
        applyAmplify(p, areaIdx);
        render();
    }
}

function useReproduction(areaIdx) {
    if (S.currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'reproduction') {
        if (p.reproductionUsedIndices.includes(areaIdx)) {
            showToast('這張再現卡本回合已使用過');
            return;
        }
        if (p.magic >= 2) {
            S.reproductionSelectionMode = !S.reproductionSelectionMode;
            S.reproductionSourceAreaIdx = areaIdx;
            S.chargeSelectionMode = false;
            S.evasionSelectionMode = false;
            if (S.reproductionSelectionMode) {
                addLog('再現已啟動，請點擊自己的一個攻擊徽章');
            }
            render();
        } else {
            showToast('魔力不足 (需要 2 點)');
        }
    }
}

function useFlare(areaIdx) {
    if (S.currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'flare') {
        if (p.flareUsedIndices.includes(areaIdx)) {
            showToast('這張閃光卡本回合已使用過');
            return;
        }
        // No attacks => there is no selectable target badge, so don't enter selection mode.
        if (!hasAnyAttackTarget(p)) {
            showToast('沒有可翻倍的攻擊');
            return;
        }
        if (p.magic >= 3) {
            S.flareSelectionMode = !S.flareSelectionMode;
            S.flareSourceAreaIdx = areaIdx;
            // Cancel other selections
            S.chargeSelectionMode = false;
            S.evasionSelectionMode = false;
            S.reproductionSelectionMode = false;
            if (S.flareSelectionMode) {
                addLog('閃光已啟動，請點擊自己的一個攻擊徽章');
            }
            render();
        } else {
            showToast('魔力不足 (需要 3 點)');
        }
    }
}

function targetFlare(targetAreaIdx, atkIdx) {
    if (!S.flareSelectionMode) return;
    const p = getCurrentPlayer();
    
    if (p.magic < 3) {
        showToast('魔力不足 (需要 3 點)');
        S.flareSelectionMode = false;
        S.flareSourceAreaIdx = -1;
        render();
        return;
    }
    
    // Safety check: index out of bounds or negative
    if (!p.currentAttacks[targetAreaIdx] || atkIdx >= p.currentAttacks[targetAreaIdx].length) {
        S.flareSelectionMode = false;
        S.flareSourceAreaIdx = -1;
        render();
        return;
    }

    const atkVal = p.currentAttacks[targetAreaIdx][atkIdx];
    const newVal = applyFlare(p, S.flareSourceAreaIdx, targetAreaIdx, atkIdx);
    if (newVal !== null) {
        addLog(`${p.name} 使用了「閃光」，使強度從 ${atkVal} 翻倍為 ${newVal}`);
        S.flareSelectionMode = false;
        S.flareSourceAreaIdx = -1;
        render();
    } else {
        showToast('只能對大於 0 的攻擊點數使用');
    }
}

function useThrust(areaIdx) {
    if (S.currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'thrust') {
        if (p.thrustUsedIndices.includes(areaIdx)) {
            showToast('這張突刺卡本回合已使用過');
            return;
        }

        const transformedCount = applyThrust(p, areaIdx);
        if (transformedCount > 0) {
            addLog(`${p.name} 使用了「突刺」，將 ${transformedCount} 個強度為 1 或 2 的攻擊翻倍`);
            render();
        } else {
            showToast('沒有強度為 1 或 2 的普通攻擊可翻倍');
        }
    }
}

function hasAnyThrustTarget(p: PlayerState) {
    // Thrust only affects normal attacks with value 1~2
    return p.currentAttacks.some(areaAtks => areaAtks.some(v => v > 0 && v <= 2));
}

function hasAnyAttackTarget(p: PlayerState) {
    // Used by effects that require an existing normal attack hit (value > 0)
    return p.currentAttacks.some(areaAtks => areaAtks.some(v => v > 0));
}

function useForest(areaIdx) {
    if (S.currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'forest') {
        if (p.forestUsedIndices.includes(areaIdx)) {
            showToast('這張森林卡本回合已使用過');
            return;
        }
        if (applyForest(p, areaIdx)) {
            addLog(`${p.name} 使用了「森林」，消耗 3 點魔力將全場攻擊合併至區域 ${areaIdx + 1}`);
            render();
        } else {
            showToast('魔力不足 (需要 3 點)');
        }
    }
}

function useFrost(areaIdx) {
    if (S.currentPhaseIndex !== 1) return; // Roll Phase
    const p = getCurrentPlayer();
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'frost') {
        if (p.frostUsedIndices.includes(areaIdx)) {
            showToast('這張冰霜卡本回合已使用過');
            return;
        }
        if (S.diceResults.length === 0) {
            showToast('請先擲骰後再使用冰霜');
            return;
        }
        
        S.frostSelectionMode = !S.frostSelectionMode;
        S.frostSourceAreaIdx = areaIdx;
        
        // Cancel other modes
        S.fateSelectionMode = false;
        
        if (S.frostSelectionMode) {
            addLog('冰霜已啟動，請點擊一個骰子進行捨棄');
        }
        render();
    }
}

function targetFrost(dieIdx) {
    if (!S.frostSelectionMode) return;
    const p = getCurrentPlayer();
    
    const sourceAreaIdx = S.frostSourceAreaIdx;
    const result = applyFrost(p, sourceAreaIdx, S.diceResults, dieIdx);
    if (!result) return;

    addLog(`${p.name} 使用了「冰霜」，捨棄了骰子 ${result.removedVal}，並在區域 ${sourceAreaIdx + 1} 獲得了強度為 ${result.extraAtk} 的額外攻擊`);
    
    S.frostSelectionMode = false;
    S.frostSourceAreaIdx = -1;
    render();
}

function useHolyLight(areaIdx) {
    const validPhases = [2, 3, 4, 5];
    if (!validPhases.includes(S.currentPhaseIndex)) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'holy_light') {
        if (applyHolyLight(p, S.currentPhaseIndex === 2)) {
            addLog(`${p.name} 使用了「聖光」，消耗 2 點魔力回復 1 點生命`);
            render();
        } else {
            showToast('魔力不足 (需要 2 點)');
        }
    }
}

function useSoulSnatch(areaIdx) {
    const validPhases = [2, 3, 4, 5];
    if (!validPhases.includes(S.currentPhaseIndex)) return;
    const p = getCurrentPlayer();
    const opp = getOpponent();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'soul_snatch') {
        if (applySoulSnatch(p, opp, S.currentPhaseIndex === 2)) {
            addLog(`${p.name} 使用了「奪魂」，消耗 3 點魔力吸收對手 1 點生命值`);
            
            if (opp.hp <= 0) {
                S.winner = p.name;
                winModalDismissed = false;
                addLog(`遊戲結束！${S.winner}勝利！`);
            }
            render();
        } else {
            showToast('魔力不足 (需要 3 點)');
        }
    }
}

// 電腦回合時，玩家不應該能操作電腦的介面。AI 是直接呼叫函式（不經過 DOM 事件），
// 所以擋在 UI 層最安全：一層透明的攔截層蓋住整個遊戲畫面，
// 不必去逐一拆掉幾十個 onclick，也不會誤擋到 AI 自己的動作。
function renderComputerTurnGuard() {
    if (appScreen !== 'game') return null;
    if (!isComputerTurnNow()) return null;
    if (S.winner) return null;

    const guard = document.createElement('div');
    guard.className = 'fixed inset-0 z-[2000] cursor-not-allowed';

    // 逃生出口：擋住整個畫面的同時，仍要讓玩家能離開對局
    // （否則 AI 萬一卡住就只能重新整理）。
    const escapeHome = renderGoHomeButton();
    escapeHome.classList.add('absolute', 'top-2', 'left-3', 'cursor-pointer');

    const swallow = (e: Event) => {
        const t = e.target as Node | null;
        if (t && escapeHome.contains(t)) return; // 放行返回鍵
        e.preventDefault();
        e.stopPropagation();
    };
    ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'contextmenu']
        .forEach(type => guard.addEventListener(type, swallow, {capture: true}));
    guard.appendChild(escapeHome);

    const badge = document.createElement('div');
    badge.className = 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full bg-slate-900/75 text-white text-[11px] font-black tracking-widest shadow-lg pointer-events-none';
    badge.innerText = '電腦回合';
    guard.appendChild(badge);
    return guard;
}

function renderWinModalOverlay() {
    if (!S.winner || winModalDismissed) return null;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm';

    const modal = document.createElement('div');
    // 手機/桌機共用：手機字體更小避免換行太醜
    modal.className = 'w-full max-w-sm rounded-2xl bg-slate-900/95 shadow-2xl border border-slate-700 overflow-hidden';

    modal.innerHTML = `
        <div class="px-5 py-4 bg-slate-950/40 border-b border-slate-800 text-center">
            <div class="text-[10px] font-black text-slate-300 uppercase tracking-[0.35em]">對局結束</div>
            <div class="mt-1 text-[20px] sm:text-3xl font-black text-white tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
                ${S.winner}勝利
            </div>
        </div>
        <div class="px-5 py-4 text-center">
            <div class="text-[11px] font-bold text-slate-300">可查看最後場面</div>
            <div class="mt-4 flex gap-2">
                <button id="againBtn" class="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-black text-[12px] tracking-widest uppercase shadow-lg shadow-indigo-900/30 active:scale-95">再來一場</button>
                <button id="homeBtn" class="flex-1 bg-slate-800 text-slate-100 py-2.5 rounded-xl font-black text-[12px] tracking-widest uppercase border border-slate-700 active:scale-95">回到首頁</button>
                <button id="closeWinBtn" class="flex-1 bg-transparent text-slate-100 py-2.5 rounded-xl font-black text-[12px] tracking-widest uppercase border border-slate-600 active:scale-95">關閉</button>
            </div>
        </div>
    `;

    (modal.querySelector('#againBtn') as HTMLButtonElement).onclick = () => restartMatch();
    (modal.querySelector('#homeBtn') as HTMLButtonElement).onclick = () => goHome();
    (modal.querySelector('#closeWinBtn') as HTMLButtonElement).onclick = () => {
        winModalDismissed = true;
        render();
    };

    overlay.appendChild(modal);
    return overlay;
}

function targetReproduction(targetAreaIdx, atkIdx) {
    if (!S.reproductionSelectionMode) return;
    const p = getCurrentPlayer();
    
    if (p.magic < 2) {
        showToast('魔力不足 (需要 2 點)');
        S.reproductionSelectionMode = false;
        S.reproductionSourceAreaIdx = -1;
        render();
        return;
    }
    
    const atkVal = p.currentAttacks[targetAreaIdx][atkIdx];
    if (applyReproduction(p, S.reproductionSourceAreaIdx, targetAreaIdx, atkIdx)) {
        addLog(`${p.name} 使用了「再現」，使強度為 ${atkVal} 的攻擊變為兩次`);
        S.reproductionSelectionMode = false;
        S.reproductionSourceAreaIdx = -1;
        render();
    }
}

function useFate(areaIdx) {
    // Fate can now be used in Phase 1 (after roll) or Phase 2 (Judging)
    if (S.currentPhaseIndex !== 1 && S.currentPhaseIndex !== 2) return;
    if (S.currentPhaseIndex === 1 && S.diceResults.length === 0) return; // Must roll first

    const p = getCurrentPlayer();
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'fate') {
        if (p.fateUsedIndices.includes(areaIdx)) {
            showToast('這張命運卡本回合已使用過');
            return;
        }
        S.fateSelectionMode = !S.fateSelectionMode;
        S.fateSourceAreaIdx = areaIdx;
        S.fateSelectedDiceIndices = [];
        render();
    }
}

function toggleDiceIndexSelection(idx) {
    if (!S.fateSelectionMode) return;
    
    if (S.fateSelectedDiceIndices.includes(idx)) {
        // Deselect
        S.fateSelectedDiceIndices = S.fateSelectedDiceIndices.filter(i => i !== idx);
    } else {
        // No limit per user request
        S.fateSelectedDiceIndices.push(idx);
    }
    render();
}

function confirmFate() {
    if (!S.fateSelectionMode) return;
    const p = getCurrentPlayer();
    
    if (S.fateSelectedDiceIndices.length === 0) {
        // Just cancel selection mode if nothing selected
        S.fateSelectionMode = false;
        S.fateSourceAreaIdx = -1;
        render();
        return;
    }

    applyFate(p, S.fateSourceAreaIdx, S.diceResults, S.fateSelectedDiceIndices);
    S.fateSelectionMode = false;
    S.fateSourceAreaIdx = -1;
    S.fateSelectedDiceIndices = [];
    addLog('命運扭轉！骰子已重擲');
    handleJudging();
    render();
}

/*
 * 購買階段的提示會隨著「有沒有抽掉免費牌」改變，所以每次動作後都要重算，
 * 不能只在進入階段時設一次 —— 抽完免費牌還一直寫著「先抽免費牌」會誤導。
 */
function updateBuyPhaseHint() {
    if (S.deck.length === 0) {
        S.phaseHint = '牌庫已空：跳過購買/購買市場牌';
    } else if (S.buyDeckDrawCount < 1) {
        S.phaseHint = '先抽免費牌，再買';
    } else {
        S.phaseHint = '可繼續購買或結束';
    }
}

function handleBuyPhase() {
    addLog('--- 購買階段 ---');
    S.buyDeckDrawCount = 0;
    // Mobile UX：購買階段預設顯示市場（在底部 dock）
    mobileDockTab = 'market';
    handDrawerOpen = true;
    updateBuyPhaseHint();
    render();
}

/*
 * 牌庫抽牌的成本標示。
 * 「-0金幣」讀起來像扣了 0 塊錢，直接寫「免費」清楚得多；
 * 牌庫抽完時也別留一個看不懂的破折號。
 */
function renderDeckCostLabel(deckCount: number, cost: number) {
    if (deckCount === 0) return '牌庫已空';
    if (!Number.isFinite(cost)) return '—';
    if (cost === 0) return '免費';
    return `-${cost}金幣`;
}

function renderGoldDots(cost: number) {
    if (!Number.isFinite(cost)) {
        return '<div class="text-[10px] font-black text-slate-400">—</div>';
    }
    if (cost === 0) {
        return '<div class="text-[10px] font-black text-emerald-700">免費</div>';
    }
    const dots = Array.from({length: Math.min(cost, 6)}, () => '<span class="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm"></span>').join('');
    return `<div class="flex items-center gap-1">${dots}<span class="ml-1 text-[10px] font-black text-amber-700">${cost}</span></div>`;
}

function renderMarketPanel(typeColors) {
    const p = getCurrentPlayer();
    const panel = document.createElement('div');
    panel.className = 'w-[210px] border-l border-slate-200 bg-white/80 backdrop-blur-sm h-[100dvh] shrink-0 flex flex-col';

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

    const nextDrawIndex = S.buyDeckDrawCount + 1;
    const nextDrawCost = getDeckDrawCost(nextDrawIndex);
    const canDraw = S.currentPhaseIndex === 6 && S.deck.length > 0 && Number.isFinite(nextDrawCost) && p.gold >= nextDrawCost;
    const mustDraw = S.currentPhaseIndex === 6 && S.buyDeckDrawCount < 1;

    const deckCard = document.createElement('div');
    deckCard.className = `card-frame shadow-sm relative flex items-center justify-center ${canDraw ? 'cursor-pointer' : 'opacity-60'}`;
    deckCard.setAttribute('style', `${getCardFrameStyleVars('market')} background: linear-gradient(135deg, #0f172a, #1e293b); border-color: #334155;`);
    deckCard.innerHTML = `
        <div class="flex flex-col items-center justify-center text-white">
            <div class="text-[10px] font-black tracking-[0.25em]">DECK</div>
            <div class="text-[10px] font-bold opacity-80 mt-1">剩餘 ${S.deck.length}</div>
        </div>
    `;

    if (canDraw) {
        // mustDraw = 第 1 張免費抽牌：用綠色提示
        // 其餘可購買抽牌：用與市場卡相同的 amber 色系提示
        deckCard.classList.add('ring-2', mustDraw ? 'ring-emerald-400' : 'ring-amber-300');
        deckCard.onclick = buyFromDeck;
    }

    const deckMeta = document.createElement('div');
    deckMeta.className = 'w-full flex items-center justify-between px-1';
    deckMeta.innerHTML = S.deck.length === 0
        ? '<div class="text-[10px] font-black text-slate-500">牌庫已空</div>'
        : `
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

        const c = S.market[idx];
        const cardEl = document.createElement('div');
        const canBuy = S.currentPhaseIndex === 6 && !!c && p.gold >= price;
        cardEl.className = `card-frame shadow-sm group relative ${canBuy ? 'cursor-pointer' : (c ? 'opacity-60' : 'opacity-30')}`;
        cardEl.setAttribute('style', getCardFrameStyleVars('market'));

        if (c) {
            cardEl.innerHTML = renderCardPngHTML(c.effectId, c.effectName);
            // 市場卡也用 portal tooltip，避免被右側面板的 overflow 裁切
            attachCardTooltip(cardEl, {effectId: c.effectId, alt: c.effectName});
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
    if (S.currentPhaseIndex !== 1) return;
    if (S.diceResults.length > 0) return;

    const p = getCurrentPlayer();
    const luckyIdx = p.activeAreaEffects.findIndex(c => c && c.effectId === 'lucky');
    let finalCount = count;
    
    if (luckyIdx !== -1) {
        finalCount = count + 1;
        S.luckySelectionMode = true;
        S.luckySourceAreaIdx = luckyIdx;
        addLog(`[幸運] 啟動！額外投擲一顆骰子 (總計 ${finalCount} 顆)`);
    }

    S.diceResults = [];
    for (let i = 0; i < finalCount; i++) {
        S.diceResults.push(Math.floor(Math.random() * 6) + 1);
    }
    render();
}

function removeLuckyDie(idx) {
    if (!S.luckySelectionMode) return;
    
    const removedVal = S.diceResults[idx];
    S.diceResults.splice(idx, 1);
    S.luckySelectionMode = false;
    S.luckySourceAreaIdx = -1;
    
    addLog(`[幸運] 移除了骰子 ${removedVal}`);
    render();
}

function selectHandCard(idx) {
    if (S.currentPhaseIndex !== 0) return;
    // Preserve hand scroll positions before rerender
    const mobile = document.getElementById('mobile-hand-list');
    if (mobile) mobileHandScrollLeft = (mobile as HTMLDivElement).scrollLeft;
    const d0 = document.getElementById('desktop-hand-wrap-0');
    if (d0) desktopHandScrollLeft[0] = (d0 as HTMLDivElement).scrollLeft;
    const d1 = document.getElementById('desktop-hand-wrap-1');
    if (d1) desktopHandScrollLeft[1] = (d1 as HTMLDivElement).scrollLeft;
    S.selectedHandCardIndex = idx;
    render();
}

// 這回合還能不能再出牌。用來讓手牌在達到上限時變成不可點選
// （視覺上比照「非購買階段的市場」：淡化 + 不給游標 + 不綁事件）。
// 準備階段：只有後手能出，且只能出 1 張；出牌階段：上限 3 張。
function canPlayMoreCardsThisTurn() {
    if (S.currentPhaseIndex !== 0) return false;
    const p = getCurrentPlayer();
    if (S.inPreparationPhase) return S.currentPlayerIndex === 1 && p.cardsPlayedThisTurn < 1;
    return p.cardsPlayedThisTurn < 3;
}

function playToBoard(areaIdx) {
    if (S.currentPhaseIndex !== 0) return;
    if (S.selectedHandCardIndex === -1) return;

    const p = getCurrentPlayer();

    // One-time Preparation Phase rule: 後手只能打出 1 張，且必須先打完才可開始遊戲
    if (S.inPreparationPhase) {
        if (S.currentPlayerIndex !== 1) return;
        if (p.cardsPlayedThisTurn >= 1) {
            // Don't use modal/alert; show it in the top hint area instead.
            S.phaseHint = '準備階段只能打出 1 張牌';
            render();
            return;
        }
    }

    if (p.cardsPlayedThisTurn >= 3) {
        showToast('每回合最多出 3 張牌');
        return;
    }

    const card = p.hand.splice(S.selectedHandCardIndex, 1)[0];
    p.board[areaIdx].push(card);
    
    // Update active effect for the area
    p.activeAreaEffects[areaIdx] = card;

    p.cardsPlayedThisTurn += 1;
    S.selectedHandCardIndex = -1;
    
    if (S.inPreparationPhase) {
        S.phaseHint = '準備完成：按開始';
    } else {
        // 出滿 3 張、或手牌剛好打完時，就不要再說「繼續出牌」。
        const canPlayMore = p.cardsPlayedThisTurn < 3 && p.hand.length > 0;
        S.phaseHint = canPlayMore
            ? `已出${p.cardsPlayedThisTurn}張，繼續出牌或擲骰`
            : `已出${p.cardsPlayedThisTurn}張，進行擲骰`;
    }

    render();
}

function useBarrier(areaIdx) {
    if (S.currentPhaseIndex !== 3) return; // Defense Phase
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    const card = p.activeAreaEffects[areaIdx];

    if (card && getEffectiveEffectId(p, areaIdx) === 'barrier') {
        if (p.barrierUsedIndices.includes(areaIdx)) {
            showToast('這張屏障卡本回合已使用過');
            return;
        }
        if (applyBarrier(p, areaIdx)) {
            addLog(`${p.name} 使用了「屏障」，消耗 3 點魔力增加 3 點防禦`);
            render();
        } else {
            showToast('魔力不足 (需要 3 點)');
        }
    }
}

function useCharge(areaIdx, hitIdx = -1) {
    if (S.currentPhaseIndex !== 5) return; 
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }
    
    if (S.chargeSelectionMode) {
        // Step 2: Selecting specific target hit
        if (hitIdx !== -1 && p.currentAttacks[areaIdx][hitIdx] > 0) {
            if (applyCharge(p, S.chargeSourceAreaIdx, areaIdx, hitIdx)) {
                S.chargeSelectionMode = false;
                S.chargeSourceAreaIdx = -1;
                render();
            } else {
                showToast('魔力不足 (需要 2 點)');
                S.chargeSelectionMode = false;
                S.chargeSourceAreaIdx = -1;
                render();
            }
        } else if (hitIdx === -1) {
             // If they clicked the area but not a specific badge
             render();
        } else {
            showToast('無法對該數值進行充能');
        }
    } else {
        // Step 1: Selecting the charge source card
        const card = p.activeAreaEffects[areaIdx];
        if (card && getEffectiveEffectId(p, areaIdx) === 'charge') {
            if (p.chargeUsedIndices.includes(areaIdx)) {
                showToast('這張充能卡本回合已使用過');
                return;
            }
            if (p.magic >= 2) {
                S.chargeSelectionMode = true;
                S.chargeSourceAreaIdx = areaIdx;
                render();
            } else {
                showToast('魔力不足 (需要 2 點)');
            }
        }
    }
}

function useMagicBullet(areaIdx) {
    if (S.currentPhaseIndex !== 5) return;
    const p = getCurrentPlayer();
    if (isMirageActive()) {
        showToast('「幻境」生效中，無法消耗魔力發動效果');
        return;
    }

    // Directly use the card in the clicked area to add an attack hit
    const card = p.activeAreaEffects[areaIdx];
    if (card && getEffectiveEffectId(p, areaIdx) === 'magic_bullet') {
        if (applyMagicBullet(p, areaIdx)) {
            render();
        } else {
            showToast('魔力不足 (需要 1 點)');
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
        return '--card-w: 90px; --card-h: 135px; --header-h: 23px; --chip: 16px; --chip-font: 8px; --title-font: 10px;';
    }
    if (size === 'hand') {
        return '--card-w: 72px; --card-h: 105px; --header-h: 20px; --chip: 16px; --chip-font: 8px; --title-font: 10px;';
    }
    // market
    return '--card-w: 72px; --card-h: 105px; --header-h: 20px; --chip: 16px; --chip-font: 8px; --title-font: 10px;';
}

function renderMobileTopBar(typeColors) {
    void typeColors;
    // 頂列：左＝返回首頁、中＝標題、右＝卡牌介紹。
    // 階段與提示都由底部操作列負責，這裡不重複顯示。
    const wrap = document.createElement('div');
    wrap.className = 'h-12 px-3 border-b-[3px] border-[#c48e36] bg-[#16344c] flex items-center justify-between shrink-0 relative';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    left.appendChild(renderGoHomeButton());
    left.appendChild(renderRestartButton());

    const center = document.createElement('div');
    center.className = 'absolute left-1/2 -translate-x-1/2 pointer-events-none';
    center.innerHTML = `<div class="text-[15px] font-black text-[#e7c980] tracking-[0.12em]">像素對決</div>`;

    const right = document.createElement('div');
    right.className = 'flex items-center gap-2';
    right.innerHTML = `
        <button id="infoBtn" aria-label="卡牌介紹" title="卡牌介紹" class="w-8 h-8 rounded-none bg-[#0d2032] flex items-center justify-center text-[#e7c980] active:translate-x-[2px] active:translate-y-[2px] shadow-[2px_2px_0_0_#011c31] border-2 border-[#c48e36]">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        </button>
    `;
    (right.querySelector('#infoBtn') as HTMLElement).onclick = toggleEffectList;
    right.insertBefore(renderGuideButton(), right.firstChild);

    wrap.appendChild(left);
    wrap.appendChild(center);
    wrap.appendChild(right);
    return wrap;
}

// 手機主要操作列：貼在手牌區正上方（拇指區），而不是畫面最頂端。
// 用的是場地下方原本閒置的空間，所以場地不會被壓縮。
function renderMobileActionBar() {
    // 單行三欄：左＝階段 1~7、中＝提示、右＝按鈕。不換行，所以可以壓得很扁。
    const bar = document.createElement('div');
    bar.className = 'shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#eceae5] border-t-[3px] border-[#603b2d]';

    const displayPhaseHint = getDisplayPhaseHint(getActionBlockReason());

    const step = document.createElement('div');
    step.className = 'shrink-0 px-2 py-1 rounded-none bg-[#dcdad3] border-2 border-[#603b2d] text-[11px] font-black text-[#2a2420] tracking-wider whitespace-nowrap';
    step.innerText = S.inPreparationPhase ? '準備階段' : PHASE_NAMES[S.currentPhaseIndex];
    bar.appendChild(step);

    const hint = document.createElement('div');
    hint.className = 'flex-1 min-w-0 text-center text-[12px] font-black text-[#2a2420] whitespace-nowrap overflow-hidden text-ellipsis';
    hint.innerText = displayPhaseHint || '';
    bar.appendChild(hint);

    const controls = buildMobileActionControls();
    controls.classList.add('shrink-0');
    bar.appendChild(controls);
    return bar;
}

function buildMobileActionControls() {
        const right = document.createElement('div');
        right.className = 'flex items-center gap-2';

        // 對局結束且關掉勝利視窗後：要能直接重開，
        // 否則只剩「回首頁再重選一次模式」這條路。
        if (S.winner && winModalDismissed) {
            const again = document.createElement('button');
            again.className = 'bg-[#c48e36] text-[#2a2420] px-3 py-2 rounded-none font-black text-[10px] uppercase tracking-wider border-2 border-[#603b2d] active:translate-x-[2px] active:translate-y-[2px]';
            again.innerText = '再來一場';
            again.onclick = () => restartMatch();
            right.appendChild(again);

            const btn = document.createElement('button');
            btn.className = 'bg-[#16344c] text-[#e7c980] px-3 py-2 rounded-none font-black text-[10px] uppercase tracking-wider border-2 border-[#603b2d] active:translate-x-[2px] active:translate-y-[2px]';
            btn.innerText = '回到首頁';
            btn.onclick = () => goHome();
            right.appendChild(btn);
        } else if (S.winner) {
            // Winner modal 未關閉時：右上不顯示任何操作（避免跟 modal 按鈕重複）
        } else

        if (S.inPreparationPhase) {
            const btn = document.createElement('button');
            const prepDone = S.players[1].cardsPlayedThisTurn >= 1;
            btn.className = `px-3 py-2 rounded-none font-black text-[11px] tracking-widest border-2 ${prepDone ? 'bg-[#c48e36] text-[#2a2420] border-[#603b2d] shadow-[2px_2px_0_0_rgba(42,36,32,0.45)]' : 'bg-[#dcdad3] text-[#2a2420]/35 border-[#603b2d]/35'}`;
            btn.innerText = '開始';
            if (prepDone) {
                btn.onclick = () => {
                    S.inPreparationPhase = false;
                    S.currentPlayerIndex = 0;
                    S.currentPhaseIndex = 0;
                    S.selectedHandCardIndex = -1;
                    S.diceResults = [];
                    S.skippedPlayBecauseNoHand = false;
                    // Mobile：出牌階段時手牌抽屜自動彈出
                    // 並切到手牌 tab
                    mobileDockTab = 'hand';
                    handDrawerOpen = isMobileLayout();
                    S.players[0].cardsPlayedThisTurn = 0;
                    S.players[1].cardsPlayedThisTurn = 0;
                    S.phaseHint = '選牌出牌';
                    render();
                };
            }
            right.appendChild(btn);
        } else if (S.currentPhaseIndex === 1 && S.diceResults.length === 0) {
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
        } else if (S.fateSelectionMode) {
            const btn = document.createElement('button');
            btn.className = 'bg-[#d0c954] text-[#2a2420] px-3 py-2 rounded-none font-black text-[10px] uppercase tracking-wider border-2 border-[#603b2d] active:translate-x-[2px] active:translate-y-[2px]';
            btn.innerText = `重擲(${S.fateSelectedDiceIndices.length})`;
            btn.onclick = confirmFate;
            right.appendChild(btn);
        } else {
            const btn = document.createElement('button');
            const isActionBlocked = getActionBlockReason() !== null;
            const label = S.currentPhaseIndex === 6 ? '結束' : S.currentPhaseIndex === 4 ? '結算' : '繼續';
            btn.className = `px-3 py-2 rounded-none font-black text-[11px] tracking-widest border-2 ${isActionBlocked ? 'bg-[#dcdad3] text-[#2a2420]/35 border-[#603b2d]/35' : 'bg-[#c48e36] text-[#2a2420] border-[#603b2d] shadow-[2px_2px_0_0_rgba(42,36,32,0.45)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'}`;
            btn.innerText = label;
            if (!isActionBlocked) btn.onclick = nextPhase;
            right.appendChild(btn);
        }


    return right;
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
    const nextDrawIndex = S.buyDeckDrawCount + 1;
    const nextDrawCost = getDeckDrawCost(nextDrawIndex);
    const canDraw = S.currentPhaseIndex === 6 && S.deck.length > 0 && Number.isFinite(nextDrawCost) && p.gold >= nextDrawCost;
    const mustDraw = S.currentPhaseIndex === 6 && S.buyDeckDrawCount < 1;

    const deckCard = document.createElement('div');
    deckCard.className = `card-frame shadow-sm relative flex items-center justify-center ${canDraw ? 'cursor-pointer' : 'opacity-60'}`;
    deckCard.setAttribute('style', `${getMobileCardFrameStyleVars('market')} background: linear-gradient(135deg, #0f172a, #1e293b); border-color: #334155;`);
    deckCard.innerHTML = `<div class="flex flex-col items-center justify-center text-white"><div class="text-[10px] font-black tracking-[0.25em]">DECK</div><div class="text-[10px] font-bold opacity-80 mt-1">${S.deck.length}</div></div>`;
    if (canDraw) {
        // ring 稍微細一點，避免佔用太多空間
        // mustDraw = 第 1 張免費抽牌：用綠色提示
        // 其餘可購買抽牌：用與市場卡相同的 amber 色系提示
        deckCard.classList.add('ring-2', mustDraw ? 'ring-emerald-400' : 'ring-amber-300');
        deckCard.onclick = buyFromDeck;
    }

    // 顯示「抽牌成本」在牌庫卡下方（動態）
    const deckCostTag = document.createElement('div');
    deckCostTag.className = 'mt-1 text-[10px] font-black text-slate-500 text-center';
    deckCostTag.innerText = renderDeckCostLabel(S.deck.length, nextDrawCost);

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
        const c = S.market[idx];
        const cardEl = document.createElement('div');
        const canBuy = S.currentPhaseIndex === 6 && !!c && p.gold >= price;
        cardEl.className = `card-frame shadow-sm group relative ${canBuy ? 'cursor-pointer' : (c ? 'opacity-60' : 'opacity-30')}`;
        cardEl.setAttribute('style', getMobileCardFrameStyleVars('market'));
        if (c) {
            cardEl.innerHTML = renderCardPngHTML(c.effectId, c.effectName);
            attachCardTooltip(cardEl, {effectId: c.effectId, alt: c.effectName});
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

// 卡牌在區域內是絕對定位、每張往下偏移 30px，所以一疊卡的實際高度會隨張數增加。
// 卡槽若維持固定高度，超過幾張之後就會撐出區域，蓋到隔壁玩家的底色上。
// 這裡算出「這疊卡至少需要多高」，讓卡槽（進而讓整個玩家區塊）自然長高。
const CARD_STACK_OFFSET_PX = 30;

function getSlotMinHeightPx(stackCount: number, cardHeightPx: number, emptyMinPx: number) {
    if (stackCount <= 0) return emptyMinPx;
    return Math.max(emptyMinPx, (stackCount - 1) * CARD_STACK_OFFSET_PX + cardHeightPx);
}

// height 用下限、max-height 用想要的值、再讓它 flex-grow 長上去。
// 若把 height 直接設成想要的值，祖先算最小內容高度時就會用那個值，
// 導致整個玩家區塊縮不下來、一般狀態也被迫捲動。
function applySlotHeight(slot: HTMLElement, minPx: number, wantedPx: number) {
    const cap = Math.max(minPx, wantedPx);
    slot.style.height = `${minPx}px`;
    slot.style.minHeight = `${minPx}px`;
    slot.style.maxHeight = `${cap}px`;
    slot.style.flexGrow = '1';
}

// 攻擊徽章每列最多 3 個，超過就換行 —— 跟對手收合時的顯示方式一致。
// 原本是單列 flex，攻擊次數一多就一路往橫向長，撐出卡槽外面。
const ATTACK_BADGES_PER_ROW = 3;

/*
 * 攻擊徽章列。
 *
 * 原則：攻擊數字不管在什麼情況下都必須看得見。有兩種被擋住的方式，要分開處理。
 *
 * 一、被卡牌遮住 —— 這是 z-index 的問題。
 *   卡牌平常是 z-10，但契約觸發是 z-50、突破/幻境/幻象/幸運的高亮是 z-40
 *   （和徽章舊的 z-40 同值，同值時後插入的卡牌會贏），hover 還會到 z-100。
 *   徽章用 z-[110]，高於卡牌所有狀態。
 *
 * 二、被容器裁切 —— 這跟 z-index 無關，設多高都沒用。
 *   徽章是往上長的（bottom 定位），換行時會往卡槽內、蓋在卡牌上面。
 *   曾經試過改成往下長進場地預留的空白，結果更糟：手機是固定高度的版面，
 *   玩家區塊撐不開，多出來的列直接被裁掉，反而完全看不見。
 *   留在卡槽內、靠 z 值蓋過卡牌，才是穩的做法。
 */
function createAttackBadgeRow(bottomOffsetPx: number) {
    const wrap = document.createElement('div');
    wrap.className = 'absolute left-0 right-0 flex justify-center z-[110]';
    wrap.style.bottom = `-${bottomOffsetPx}px`;
    const grid = document.createElement('div');
    // 用 auto 寬度的三欄格線，才會「剛好每 3 個換行」而不受徽章寬度影響
    grid.className = 'grid grid-cols-[repeat(3,auto)] gap-1 justify-items-center';
    grid.setAttribute('data-attack-badges', '');
    wrap.appendChild(grid);
    return {wrap, grid};
}

function renderMobilePlayerBlock(
    idx,
    typeColors,
    {position, showBoard, bothBoards}: {position: 'top' | 'bottom'; showBoard: boolean; bothBoards: boolean}
) {
    const p = S.players[idx];
    const isCurrent = S.currentPlayerIndex === idx;

    const wrap = document.createElement('div');
    // Player background: 先手(玩家0)=淡紅、後手(玩家1)=淡藍
    // (不要依 top/bottom 決定，因為 mobile 版 top 可能是對手)
    void position;
    // The current player's block grows to fill the leftover height so the board
    // never leaves a dead gap above the hand dock; the opponent strip stays compact.
    // 有顯示場地的區塊都用 flex-1 共享高度。關鍵在於「展開對手場地」時：
    // 對手區塊若是 shrink-0，就會把空間吃光、把自己的場地壓成 0 高度而消失。
    // 兩邊都可伸縮，空間就會對分，雙方場地同時看得到。
    // 只有一個場地要顯示時（一般情況）：用 flex-1 撐滿剩餘高度，卡槽可收縮，
    // 整個畫面剛好一屏、不需要捲動。
    // 兩個場地都要顯示時（展開對手場地）：兩塊各自取完整內容高度、都不收縮，
    // 否則卡牌會被壓到擠出區塊、蓋到對方的顏色上。兩個完整場地本來就塞不進
    // 一個手機螢幕，這種情況就交給捲動。
    // 不加 min-h-0：flex 項目預設 min-height:auto，意思是「可以長大、但不會被壓到
    // 小於內容高度」。卡疊變高時區塊自然跟著變高，超出畫面的部分交給捲動，
    // 不會再出現底色不足或卡牌蓋到對方區域。
    void bothBoards;
    const growth = showBoard ? 'flex-1 flex flex-col' : 'shrink-0';
    wrap.className = `px-3 py-2 ${idx === 0 ? 'bg-[#f2cdc9]' : 'bg-[#ccdde8]'} ${growth}`;

    // compact header
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between';
    header.innerHTML = `
        <div class="flex items-end gap-2">
            <div class="text-2xl font-black ${isCurrent ? 'text-black' : 'text-black/40'} tracking-tight">${p.hp}</div>
            <div class="text-[10px] font-black text-[#2a2420]/70 tracking-widest">${p.name}${isCurrent ? '（回合）' : ''}</div>
        </div>
        ${position === 'bottom' ? `
            <div class="flex items-center gap-2">
                <div class="flex items-center gap-1 px-2 py-0.5 rounded-none bg-[#a5cd5d] border-2 border-[#603b2d] text-[11px] font-black text-[#2a2420]">魔 ${p.magic}</div>
                <div class="flex items-center gap-1 px-2 py-0.5 rounded-none bg-[#7ca1bb] border-2 border-[#603b2d] text-[11px] font-black text-[#2a2420]">防 ${p.defense}</div>
                <div class="flex items-center gap-1 px-2 py-0.5 rounded-none bg-[#d0c954] border-2 border-[#603b2d] text-[11px] font-black text-[#2a2420]">金 ${p.gold}</div>
            </div>
        ` : ''}
    `;
    wrap.appendChild(header);

    // Top（對手）：提供「展開/收合」按鈕
    if (position === 'top' && !isCurrent) {
        const btn = document.createElement('button');
        btn.className = 'px-2 py-1 rounded-none border-2 border-[#603b2d] bg-[#dcdad3] text-[#2a2420] text-[10px] font-black tracking-widest active:translate-x-[1px] active:translate-y-[1px]';
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
            col.className = 'flex-1 min-w-[90px] rounded-none border-2 border-[#603b2d]/40 bg-white/70 px-1.5 py-1';

            const badges = document.createElement('div');
            badges.className = 'flex flex-wrap items-center justify-center gap-1';

            const hits = p.attackQueue[aIdx] || [];
            hits.forEach((atkVal, hitIdx) => {
                if (atkVal === 0) return;
                let displayVal = atkVal;
                let isFullyBlocked = false;
                if (S.currentPhaseIndex === 3 || S.currentPhaseIndex === 4) {
                    displayVal = Math.max(0, atkVal - cur.defense);
                    if (displayVal <= 0) isFullyBlocked = true;
                }

                const b = document.createElement('div');
                const bgColor = isFullyBlocked ? 'bg-slate-400' : 'bg-red-500';
                const activeColor = S.evasionSelectionMode ? 'bg-amber-500 scale-110 ring-2 ring-amber-200 cursor-pointer animate-pulse' : bgColor;
                b.className = `text-white text-[11px] font-black px-2 py-0.5 rounded-md shadow border border-white transition-all ${activeColor}`;
                b.innerText = displayVal.toString();
                if (S.evasionSelectionMode) {
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
        // The slots keep their natural height (see slotSize) rather than being
        // stretched, because the attack badges hang off the bottom of each slot
        // and stretching pushes them down the screen. `items-stretch` here is
        // only so the zones are bounded by the board height, which lets the
        // slots SHRINK when the hand dock is open on a short screen instead of
        // pushing the badges out of view. `pb-5` reserves the badge overhang.
        board.className = 'mt-4 flex-1 min-h-0 flex items-stretch justify-center gap-1';
        board.style.paddingBottom = '20px';

        [0, 1, 2].forEach(aIdx => {
            const zone = document.createElement('div');
            // No `h-full`: an explicit height would make the cross size non-auto
            // and switch OFF the parent's `items-stretch`.
            zone.className = `relative flex flex-col items-center gap-1 p-1 rounded-none transition-all border-2 border-transparent min-h-0 ${S.currentPhaseIndex === 2 && S.diceResults.some(d => Math.floor((d-1)/2) === aIdx) ? 'bg-[#d0c954]/35 border-[#603b2d]' : 'bg-transparent'}`;

            zone.innerHTML = `
                <div class="w-full flex items-center justify-center pt-2 pb-0">
                    ${renderBaseBarImgHTML(idx as 0 | 1, aIdx as 0 | 1 | 2)}
                </div>
            `;

            const slot = document.createElement('div');
            // Mobile only: lift the card stack a bit closer to basebar (allow slight overlap)
            // The current player's slots flex to the available height (with a floor
            // that still fits a stacked card); the opponent's stay compact.
            // h-[200px] is the height it wants; min-h-[110px] is how far it may
            // shrink when the dock leaves less room (flex-shrink is on by default,
            // and the stacked cards are absolutely positioned so nothing blocks it).
            // 想要的高度是 200px；空間不足時可收縮，但不得低於這疊卡實際需要的高度。
            // 張數多時這個下限會超過 200px，區域就跟著變高。
            const slotSize = 'h-[200px]';
            slot.className = `minimal-slot -mt-2 w-[150px] ${slotSize} border-[3px] border-dashed border-[#603b2d]/45 bg-white/55 rounded-none relative transition-all ${isCurrent && S.currentPhaseIndex === 0 && S.selectedHandCardIndex !== -1 ? 'hover:border-indigo-400 cursor-pointer hover:bg-white' : ''}`;
            // 拖曳出牌的放置目標（不需要先選牌，所以條件比點擊版寬鬆）
            // 高度設成「下限」而不是「想要的值」，再用 flex-grow 往上長到上限。
            // 這點很關鍵：祖先在算最小內容高度時看的是 height，若直接寫 200px，
            // 整個玩家區塊就永遠縮不到 200px 以下，一般狀態也會被迫捲動。
            // 卡疊變高時下限跟著變高，區域就自然變長。
            applySlotHeight(slot, getSlotMinHeightPx(p.board[aIdx].length, 135, 110), 200);
            if (isCurrent && canPlayMoreCardsThisTurn()) slot.setAttribute('data-play-zone', String(aIdx));
            if (isCurrent && S.currentPhaseIndex === 0 && S.selectedHandCardIndex !== -1) slot.onclick = () => playToBoard(aIdx);

            const {wrap: atkWrap, grid: atkContainer} = createAttackBadgeRow(16);
            const effects = isCurrent ? p.currentAttacks[aIdx] : p.attackQueue[aIdx];
            effects.forEach((atkVal, hitIdx) => {
                if (atkVal === 0) return;
                const atkBadge = document.createElement('div');
                let displayVal = atkVal;
                let isFullyBlocked = false;
                if (!isCurrent && (S.currentPhaseIndex === 3 || S.currentPhaseIndex === 4)) {
                    const currentPlayer = getCurrentPlayer();
                    displayVal = Math.max(0, atkVal - currentPlayer.defense);
                    if (displayVal <= 0) isFullyBlocked = true;
                }
                const canBeDodged = !isCurrent && S.evasionSelectionMode;
                const isChargeTarget = isCurrent && S.chargeSelectionMode;
                const isReproductionTarget = isCurrent && S.reproductionSelectionMode;
                const isFlareTarget = isCurrent && S.flareSelectionMode;
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
            slot.appendChild(atkWrap);

            const stack = p.board[aIdx];
            stack.forEach((card, cIdx) => {
                const cardEl = document.createElement('div');
                const isTop = (cIdx === stack.length - 1);
                const isActiveEffect = (p.activeAreaEffects[aIdx] === card);
                const effId = isActiveEffect ? getEffectiveEffectId(p, aIdx) : card.effectId;
                cardEl.className = `card-frame shadow-sm group absolute left-1/2 -translate-x-1/2 transition-all duration-300 overflow-visible ${isTop ? 'z-10' : 'z-0'} hover:z-[100]`;
                cardEl.setAttribute('style', getMobileCardFrameStyleVars('board'));
                cardEl.style.top = `${cIdx * 30}px`;

                if (p.contractTriggeredAreaIdx === aIdx && isActiveEffect) cardEl.classList.add('ring-2', 'ring-red-500', 'z-50');
                if (effId === 'breakthrough' && isActiveEffect && p.hp <= 3) cardEl.classList.add('ring-2', 'ring-cyan-400', 'z-40');
                if (effId === 'mirage' && isActiveEffect) cardEl.classList.add('ring-2', 'ring-violet-500', 'z-40');
                if (card.effectId === 'illusion' && isActiveEffect && S.illusionSelectionMode && S.illusionSourceAreaIdx === aIdx) cardEl.classList.add('ring-2', 'ring-teal-400', 'z-40');
                if (effId === 'lucky' && isActiveEffect && isCurrent && S.currentPhaseIndex === 1 && (S.diceResults.length === 0 || S.luckySelectionMode)) cardEl.classList.add('ring-2', 'ring-lime-400', 'z-40');

                const displayEffectName = (() => {
                    if (card.effectId !== 'illusion') return card.effectName;
                    const copiedId = p.illusionCopiedEffectIds[aIdx];
                    if (!copiedId) return card.effectName;
                    const copiedName = EFFECTS.find(e => e.id === copiedId)?.name || '';
                    // 需求：顯示成兩行
                    // 幻象幽影
                    // [該卡名稱]
                    return copiedName ? `幻象幽影\n${copiedName}` : '幻象幽影';
                })();
                const nameForUI = (isTop && isActiveEffect) ? displayEffectName : card.effectName;
                cardEl.innerHTML = renderCardPngHTML(card.effectId, nameForUI);
                if (isTop && isActiveEffect) {
                    let tooltipDesc = card.effectDesc;
                    if (card.effectId === 'illusion' && p.illusionCopiedEffectIds[aIdx]) {
                        tooltipDesc = EFFECTS.find(e => e.id === p.illusionCopiedEffectIds[aIdx])?.desc || tooltipDesc;
                    }
                    attachCardTooltip(cardEl, {effectId: card.effectId, alt: nameForUI});
                }

                // Mobile：主動效果（可點擊）與發光提示
                // 先前只在桌機 renderPlayerArea() 綁定，導致手機版無法觸發。
                if (isCurrent && isTop && isActiveEffect) {
                    const isMirageBlocked = isMirageActive();
                    if (S.currentPhaseIndex === 5 && effId === 'charge') {
                        if (p.magic >= 2 && !p.chargeUsedIndices.includes(aIdx) && !isMirageBlocked) {
                            const isSource = S.chargeSelectionMode && S.chargeSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useCharge(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 5 && effId === 'magic_bullet') {
                        if (p.magic >= 1 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-emerald-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useMagicBullet(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 5 && effId === 'amplify') {
                        // Amplify is free: Only pulse if THIS specific area's amplify not used
                        if (!p.amplifyUsedIndices.includes(aIdx) && hasAnyAttackTarget(p)) {
                            cardEl.classList.add('ring-2', 'ring-blue-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useAmplify(aIdx); };
                        }
                    } else if ((S.currentPhaseIndex === 1 || S.currentPhaseIndex === 2) && effId === 'fate') {
                        // Fate: Re-roll dice (usable in Roll phase after roll, or Judging phase)
                        const diceRolled = S.diceResults.length > 0;
                        if (!p.fateUsedIndices.includes(aIdx) && diceRolled && !S.luckySelectionMode) {
                            cardEl.classList.add('ring-2', S.fateSelectionMode ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useFate(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 3 && effId === 'dodge') {
                        // Dodge: Ignore incoming attack in Defense Phase
                        const opp = getOpponent();
                        const hasDodgeableAttacks = opp.attackQueue.flat().length > 0;
                        if (!p.evasionUsedIndices.includes(aIdx) && p.magic >= 3 && hasDodgeableAttacks && !isMirageBlocked) {
                            const isSource = S.evasionSelectionMode && S.evasionSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useEvasion(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 3 && effId === 'barrier') {
                        // Modified Barrier: Consume 3 magic for 3 defense in Defense Phase
                        if (p.magic >= 3 && !p.barrierUsedIndices.includes(aIdx) && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useBarrier(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 3 && effId === 'shield') {
                        // Shield: Consume 2 magic for 1 defense in Defense Phase
                        if (p.magic >= 2 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-blue-300', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useShield(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 5 && effId === 'reproduction') {
                        // Reproduction: Consume 2 magic, make one attack twice
                        if (!p.reproductionUsedIndices.includes(aIdx) && p.magic >= 2 && !isMirageBlocked) {
                            const isSource = S.reproductionSelectionMode && S.reproductionSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useReproduction(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 5 && effId === 'flare') {
                        // Flare: Consume 3 magic, double one attack
                        if (!p.flareUsedIndices.includes(aIdx) && p.magic >= 3 && hasAnyAttackTarget(p) && !isMirageBlocked) {
                            const isSource = S.flareSelectionMode && S.flareSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useFlare(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 5 && effId === 'thrust') {
                        // Thrust: Double all 1s and 2s
                        const canThrust = hasAnyThrustTarget(p);
                        if (!p.thrustUsedIndices.includes(aIdx) && canThrust) {
                            cardEl.classList.add('ring-2', 'ring-rose-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useThrust(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 5 && effId === 'forest') {
                        // Forest: Merge all attacks
                        if (!p.forestUsedIndices.includes(aIdx) && p.magic >= 3 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-emerald-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useForest(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 1 && effId === 'frost') {
                        // Frost: Discard a die for 1-3 extra attack
                        const diceRolled = S.diceResults.length > 0;
                        if (!p.frostUsedIndices.includes(aIdx) && diceRolled && !S.luckySelectionMode) {
                            const isSource = S.frostSelectionMode && S.frostSourceAreaIdx === aIdx;
                            cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-blue-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useFrost(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 2 && effId === 'magic_luck') {
                        if (p.magic >= 2 && !p.magicLuckUsedIndices.includes(aIdx) && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-purple-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useMagicLuck(aIdx); };
                        }
                    } else if (S.currentPhaseIndex === 2 && card.effectId === 'illusion') {
                        const opp = getOpponent();
                        const hasCopyableCard = opp.activeAreaEffects.some(c => c && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId));
                        if (p.magic >= 1 && !p.illusionUsedIndices.includes(aIdx) && !isMirageBlocked && hasCopyableCard) {
                            cardEl.classList.add('ring-2', 'ring-teal-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useIllusion(aIdx); };
                        }
                    } else if ([2, 3, 4, 5].includes(S.currentPhaseIndex) && effId === 'holy_light') {
                        // Holy Light: Consume 2 magic for 1 HP
                        if (p.magic >= 2 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-yellow-300', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useHolyLight(aIdx); };
                        }
                    } else if ([2, 3, 4, 5].includes(S.currentPhaseIndex) && effId === 'soul_snatch') {
                        // Soul Snatch: Consume 3 magic to absorb 1 HP
                        if (p.magic >= 3 && !isMirageBlocked) {
                            cardEl.classList.add('ring-2', 'ring-purple-400', 'cursor-pointer');
                            cardEl.onclick = (e) => { e.stopPropagation(); useSoulSnatch(aIdx); };
                        }
                    }
                }
                if (!isCurrent && isTop && isActiveEffect && S.illusionSelectionMode && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(card.effectId)) {
                    cardEl.classList.add('ring-2', 'ring-teal-500', 'cursor-pointer', 'shadow-2xl', 'z-50');
                    cardEl.onclick = (e) => { e.stopPropagation(); targetIllusion(aIdx); };
                }
                slot.appendChild(cardEl);
            });

            if (isCurrent && S.diceResults.length > 0) {
                const dicePool = document.createElement('div');
                // 往上移：讓骰子顯示位置更接近桌機版「浮在場地上方」
                dicePool.className = 'absolute -top-15 inset-x-0 h-8 pointer-events-none z-30';
                let leftCount = 0;
                let rightCount = 0;
                S.diceResults.forEach((val, originalIdx) => {
                    const diceArea = Math.floor((val - 1) / 2);
                    if (diceArea !== aIdx) return;
                    const isLeftVal = (val % 2 !== 0);
                    const wrapper = document.createElement('div');
                    wrapper.className = 'absolute pointer-events-auto transition-all duration-300';
                    const countOnSide = isLeftVal ? leftCount++ : rightCount++;
                    wrapper.style.left = isLeftVal ? 'calc(25% - 12px)' : 'calc(75% - 12px)';
                    // 多顆骰子：改成「往上」堆疊（避免往下蓋到卡牌）
                    wrapper.style.top = `${-countOnSide * 10}px`;
                    const isSelected = S.fateSelectedDiceIndices.includes(originalIdx);
                    const isFrostTarget = S.frostSelectionMode;
                    const isLuckyTarget = S.luckySelectionMode;
                    const dIcon = document.createElement('div');
                    const diceColorClass = isSelected ? 'bg-amber-500 text-white ring-amber-300 animate-pulse' : (isFrostTarget ? 'bg-blue-400 text-white ring-blue-200 animate-pulse' : (isLuckyTarget ? 'bg-lime-500 text-white ring-lime-200 animate-pulse' : 'bg-slate-900 text-white ring-white'));
                    dIcon.className = `w-6 h-6 rounded shadow-xl ring-2 ${diceColorClass} ${S.fateSelectionMode || S.frostSelectionMode || S.luckySelectionMode ? 'cursor-pointer active:scale-95' : ''}`;
                    dIcon.innerHTML = renderDiePipsHTML(val);
                    dIcon.setAttribute('aria-label', `骰子 ${val}`);
                    if (S.fateSelectionMode) dIcon.onclick = () => toggleDiceIndexSelection(originalIdx);
                    else if (S.frostSelectionMode) dIcon.onclick = () => targetFrost(originalIdx);
                    else if (S.luckySelectionMode) dIcon.onclick = () => removeLuckyDie(originalIdx);
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
    // A flex sibling of the scroller rather than a fixed overlay: it no longer
    // covers the board, so the layout needs no compensating bottom padding.
    drawer.className = 'w-full shrink-0 relative z-[1200]';

    // Header：只保留「切換」作為標題（同一行）
    const header = document.createElement('div');
    header.className = 'w-full bg-[#0d2032] text-[#e7c980] px-3 py-2 flex items-center justify-between border-t-[3px] border-[#c48e36]';
    // 點 header 空白可收合/展開；按鈕會 stopPropagation
    header.onclick = toggleHandDrawer;

    const tabs = document.createElement('div');
    tabs.className = 'flex items-center gap-2';
    const tabBtn = (id: 'market' | 'hand', label: string) => {
        const b = document.createElement('button');
        const active = mobileDockTab === id;
        b.className = `px-3 py-1 rounded-none text-[10px] font-black tracking-widest uppercase border-2 ${active ? 'bg-[#c48e36] text-[#0d2032] border-[#e7c980]' : 'bg-[#16344c] text-[#e7c980]/70 border-[#c48e36]/50'}`;
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
    arrow.className = 'text-[12px] font-black tracking-widest uppercase text-[#e7c980] px-2';
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

        // Keep dock content height consistent between HAND and MARKET,
        // and don't shrink when hand is empty.
        // (Header height is handled by the drawer header above.)
        const dockBodyBase = 'h-[150px]';

        // 若顯示市場：讓 market row 自己控制 padding，避免「外層 + 內層」雙重 padding/border
        // 任意階段皆可瀏覽市場（但只有購買階段能真的買）
        const isMarketDock = mobileDockTab === 'market';
        body.className = isMarketDock
            ? `bg-[#eceae5] border-t-[3px] border-[#603b2d] p-0 ${dockBodyBase}`
            // Hand dock uses flex to vertically center the scrolling row.
            : `bg-[#eceae5] border-t-[3px] border-[#603b2d] px-3 ${dockBodyBase} flex items-center`;

        // Dock: show market / hand by tab
        if (isMarketDock) {
            body.appendChild(renderMobileMarketRow(typeColors));
        } else {
            const list = document.createElement('div');
            // 手牌超過一定數量時：維持卡牌寬度，不縮小，改用左右滑動查看
            // Use items-center + overflow-y-visible so rings/glow won't be clipped,
            // and keep the row vertically centered within the fixed dock height.
            // Add horizontal padding so the first/last card's ring/glow won't be clipped
            // by the scroll container edge.
            list.className = 'flex items-center gap-3 overflow-x-auto overflow-y-visible w-full py-3 px-3';
            list.id = 'mobile-hand-list';
            list.scrollLeft = mobileHandScrollLeft;
            list.addEventListener('scroll', () => {
                mobileHandScrollLeft = list.scrollLeft;
                hideGlobalTooltip();
            });
            p.hand.forEach((card, hIdx) => {
                const cardEl = document.createElement('div');
                const isSelected = S.selectedHandCardIndex === hIdx;
                // shrink-0：避免被 flex 壓縮，確保可左右滑動
                const selectable = canPlayMoreCardsThisTurn();
                cardEl.className = `card-frame shrink-0 shadow-sm group relative transition-all ${selectable ? 'cursor-pointer' : 'opacity-60'} ${isSelected ? 'border-blue-500 ring-2 ring-blue-300 shadow-[0_0_0_4px_rgba(59,130,246,0.35)] scale-105' : ''}`;
                cardEl.setAttribute('style', getMobileCardFrameStyleVars('hand'));
                cardEl.innerHTML = renderCardPngHTML(card.effectId, card.effectName);
                attachCardTooltip(cardEl, {effectId: card.effectId, alt: card.effectName});
                if (selectable) {
                    cardEl.onclick = () => selectHandCard(hIdx);
                    attachHandCardDrag(cardEl, hIdx);
                }
                list.appendChild(cardEl);
            });
            if (p.hand.length === 0) {
                // Keep the height stable even when empty.
                list.className = 'w-full h-full flex items-center justify-center';
                list.innerHTML = `<div class="text-[10px] font-bold text-slate-300 uppercase tracking-widest italic text-center">空</div>`;
            }
            body.appendChild(list);
        }
        drawer.appendChild(body);
    }
    return drawer;
}

function renderMobileLayout(typeColors) {
    const container = document.createElement('div');
    // 100dvh (not 100vh): mobile browser toolbars shrink the visible viewport,
    // and 100vh would overflow it and cause a whole-page scroll.
    container.className = 'h-[100dvh] w-full bg-[#eceae5] text-[#2a2420] font-sans overflow-hidden flex flex-col';

    container.appendChild(renderMobileTopBar(typeColors));

    const oppIdx = getOpponentIndex();
    const curIdx = S.currentPlayerIndex;

    // Mobile：平常不顯示對手場地以節省空間；但玩家可手動展開。
    // 另外在需要點選對手目標的模式下（例如幻象/閃避）強制顯示。
    const needsOpponentTargets = S.illusionSelectionMode || S.evasionSelectionMode;
    const showOpponentBoard = needsOpponentTargets || mobileOpponentBoardOpen;

    const scroller = document.createElement('div');
    // The hand dock below is a real flex sibling (not a fixed overlay), so no
    // bottom padding is needed to clear it.
    scroller.className = 'flex-1 min-h-0 overflow-y-auto';
    scroller.addEventListener('scroll', hideGlobalTooltip);

    // `h-full` (not `min-h-full`): an exact height is what lets the current
    // player's block actually SHRINK when the hand dock is open, instead of
    // overflowing and pushing the attack badges out of view. It still fills the
    // height when there is room, so no blank gap either. The opponent block is
    // `shrink-0`, so expanding it still overflows and scrolls as intended.
    const inner = document.createElement('div');
    inner.className = 'h-full flex flex-col';

    // 上方預設只顯示對手資訊；在需要點對手目標的模式下才顯示對手場地
    inner.appendChild(renderMobilePlayerBlock(oppIdx, typeColors, {position: 'top', showBoard: showOpponentBoard, bothBoards: showOpponentBoard}));

    // 購買階段市場改到下方 dock（與手牌同位置）

    // 下方顯示當回合玩家（顯示場地）
    inner.appendChild(renderMobilePlayerBlock(curIdx, typeColors, {position: 'bottom', showBoard: true, bothBoards: showOpponentBoard}));

    scroller.appendChild(inner);
    container.appendChild(scroller);
    container.appendChild(renderMobileActionBar());
    container.appendChild(renderMobileHandDrawer(typeColors));
    return container;
}

function render() {
    const root = document.getElementById('root');
    root.innerHTML = '';
    // rerender 時先關閉 tooltip（避免舊 tooltip 懸在畫面上）
    hideGlobalTooltip();

    // --- App screens: Home / Rules / Game ---
    if (appScreen === 'home') {
        root.appendChild(renderHomeScreen());
        return;
    }
    if (appScreen === 'rules') {
        root.appendChild(renderRulesScreen());
        return;
    }

    const typeColors = {
        attack: 'bg-red-500',
        defense: 'bg-blue-500',
        magic: 'bg-emerald-500',
        gold: 'bg-amber-500'
    };

    // Mobile layout (<=768px)
    if (isMobileLayout()) {
        root.appendChild(renderMobileLayout(typeColors));

        const aiGuard = renderComputerTurnGuard();
        if (aiGuard) root.appendChild(aiGuard);

        const guideModal = renderGameGuideOverlay();
        if (guideModal) root.appendChild(guideModal);

        const leaveModal = renderLeaveConfirmOverlay();
        if (leaveModal) root.appendChild(leaveModal);

        // Winner modal (mobile)
        const win = renderWinModalOverlay();
        if (win) root.appendChild(win);

        // 手機版仍然需要效果列表 modal（沿用原本的 showEffectList render）
        if (showEffectList) {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[2500] flex items-center justify-center p-4';
            overlay.onclick = () => { showEffectList = false; render(); };
            const modal = document.createElement('div');
            modal.className = 'px-panel w-full max-w-sm overflow-hidden flex flex-col max-h-[80dvh]';
            modal.onclick = (e) => e.stopPropagation();
            modal.innerHTML = `
                <div class="px-4 py-3 border-b-[3px] border-[#603b2d] flex justify-between items-center bg-[#dcdad3]">
                    <h3 class="font-black text-slate-800 tracking-tight">卡牌一覽</h3>
                    <button id="closeModal" aria-label="關閉" class="w-8 h-8 flex items-center justify-center bg-[#16344c] text-[#e7c980] border-2 border-[#c48e36] font-black active:translate-x-[2px] active:translate-y-[2px]">×</button>
                </div>
                <div class="overflow-y-auto p-3 flex flex-col gap-2 bg-[#eceae5]">
                    ${[...CARD_DEFS].sort((a, b) => a.imgNo - b.imgNo).map(def => renderCardListEntryHTML(def)).join('')}
                </div>
            `;
            attachCardListPreviews(modal);
            (modal.querySelector('#closeModal') as HTMLElement).onclick = toggleEffectList;
            overlay.appendChild(modal);
            root.appendChild(overlay);
        }

        // Restore hand scroll position after DOM is mounted (avoid jumping back to start on rerender)
        scheduleRestoreHandScrollPositions();

        // Schedule AI after DOM is updated
        if (isComputerTurnNow() && !computerBusy) {
            queueMicrotask(() => void runComputerTurnLoop());
        }
        return;
    }

    const container = document.createElement('div');
    container.className = 'h-[100dvh] w-full bg-[#eceae5] text-[#2a2420] font-sans overflow-hidden flex';

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
        <button id="infoBtn" aria-label="卡牌介紹" title="卡牌介紹" class="w-8 h-8 rounded-none bg-[#0d2032] flex items-center justify-center text-[#e7c980] hover:bg-[#1c3a52] active:translate-x-[2px] active:translate-y-[2px] shadow-[2px_2px_0_0_#011c31] border-2 border-[#c48e36]">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        </button>
    `;
    centralBar.appendChild(leftSection);
    (leftSection.querySelector('#infoBtn') as HTMLElement).onclick = toggleEffectList;
    leftSection.appendChild(renderGuideButton());
    leftSection.appendChild(renderGoHomeButton());
    leftSection.appendChild(renderRestartButton());

    // 2. Center Phase Indicator
    const phaseSection = document.createElement('div');
    phaseSection.className = 'absolute left-[42%] -translate-x-1/2 flex items-center justify-center';
    
    const displayPhaseHint = getDisplayPhaseHint(null);

    const phaseName = S.inPreparationPhase ? '準備階段' : PHASE_NAMES[S.currentPhaseIndex];

    phaseSection.innerHTML = `
        <div class="relative flex items-center justify-center">
            <div class="flex flex-col items-center justify-center shrink-0">
                <div class="text-[9px] uppercase font-black text-slate-400 tracking-[0.3em] mb-1">PHASE ${S.currentPhaseIndex + 1}</div>
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
    turnBadge.innerText = `${S.players[S.currentPlayerIndex].name} 回合`;
    rightSection.appendChild(turnBadge);

    const actionContainer = document.createElement('div');
    actionContainer.className = 'flex items-center gap-2';

    // One-time Preparation Phase action
    if (S.winner && winModalDismissed) {
        const btn = document.createElement('button');
        btn.className = 'px-6 py-2 rounded-lg font-black text-xs uppercase tracking-widest transition-all bg-slate-900 text-white shadow-lg shadow-slate-200 hover:bg-slate-800 active:scale-95';
        btn.innerHTML = '回到首頁 &rarr;';
        btn.onclick = () => goHome();
        actionContainer.appendChild(btn);
    } else if (S.winner) {
        // Winner modal 未關閉時不顯示右側 action（以 modal 為主）
    } else if (S.inPreparationPhase) {
        const btn = document.createElement('button');
        const prepDone = S.players[1].cardsPlayedThisTurn >= 1;
        btn.className = `px-6 py-2 rounded-lg font-black text-xs uppercase tracking-widest transition-all ${prepDone ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-500 active:scale-95' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`;
        btn.innerHTML = `開始遊戲 &rarr;`;
        if (prepDone) {
            btn.onclick = () => {
                S.inPreparationPhase = false;
                // 開始正式流程：先手回合、出牌階段
                S.currentPlayerIndex = 0;
                S.currentPhaseIndex = 0;
                S.selectedHandCardIndex = -1;
                S.diceResults = [];
                S.skippedPlayBecauseNoHand = false;
                // Mobile：出牌階段時手牌抽屜自動彈出
                // 並切到手牌 tab
                mobileDockTab = 'hand';
                handDrawerOpen = isMobileLayout();
                // 準備階段的出牌數不應計入正式回合限制
                S.players[0].cardsPlayedThisTurn = 0;
                S.players[1].cardsPlayedThisTurn = 0;
                S.phaseHint = '選牌出牌';
                render();
            };
        }
        actionContainer.appendChild(btn);
    } else

    if (S.currentPhaseIndex === 1 && S.diceResults.length === 0) {
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
    } else if (S.fateSelectionMode) {
        const btn = document.createElement('button');
        btn.className = 'bg-amber-600 text-white px-6 py-2 rounded-lg font-black text-xs uppercase tracking-widest transition-all shadow-lg hover:bg-amber-500 active:scale-95';
        btn.innerText = `確定重擲 (${S.fateSelectedDiceIndices.length} 顆)`;
        btn.onclick = confirmFate;
        actionContainer.appendChild(btn);
    } else {
        const btn = document.createElement('button');
        const isActionBlocked = getActionBlockReason() !== null;
        const label = S.currentPhaseIndex === 6 ? '結束回合' : S.currentPhaseIndex === 4 ? '結算傷害' : '繼續';
        btn.className = `px-6 py-2 rounded-none font-black text-xs tracking-widest border-2 ${isActionBlocked ? 'bg-[#cbbfa6] text-[#8a7d66] border-[#8a7d66] cursor-not-allowed' : 'bg-[#c48e36] text-[#0d2032] border-[#603b2d] shadow-[3px_3px_0_0_rgba(42,28,16,0.4)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none'}`;
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

    const aiGuardDesktop = renderComputerTurnGuard();
    if (aiGuardDesktop) root.appendChild(aiGuardDesktop);

    const guideModalDesktop = renderGameGuideOverlay();
    if (guideModalDesktop) root.appendChild(guideModalDesktop);

    const leaveModalDesktop = renderLeaveConfirmOverlay();
    if (leaveModalDesktop) root.appendChild(leaveModalDesktop);

    // Winner modal (desktop)
    const win = renderWinModalOverlay();
    if (win) root.appendChild(win);

    if (showEffectList) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[2500] flex items-center justify-center p-4';
        overlay.onclick = () => { showEffectList = false; render(); };
        
        const modal = document.createElement('div');
        modal.className = 'px-panel w-full max-w-sm overflow-hidden flex flex-col max-h-[80dvh]';
        modal.onclick = (e) => e.stopPropagation();
        
        modal.innerHTML = `
            <div class="px-5 py-3 border-b-[3px] border-[#603b2d] flex justify-between items-center bg-[#dcdad3]">
                <h3 class="font-black text-[#2a2420] tracking-tight flex items-center gap-2">
                    <span class="w-2.5 h-2.5 bg-[#c48e36] border-2 border-[#603b2d]"></span>
                    卡牌一覽
                </h3>
                <button id="closeModal" aria-label="關閉" class="w-8 h-8 flex items-center justify-center bg-[#16344c] text-[#e7c980] border-2 border-[#c48e36] active:translate-x-[2px] active:translate-y-[2px]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="overflow-y-auto p-4 flex flex-col gap-2 bg-[#eceae5]">
                ${[...CARD_DEFS].sort((a, b) => a.imgNo - b.imgNo).map(def => renderCardListEntryHTML(def, 'hover:border-indigo-100 transition-colors')).join('')}
            </div>
            <div class="p-3 bg-[#dcdad3] border-t-[3px] border-[#603b2d] text-center">
                <button id="closeModalBtn" class="w-full bg-[#16344c] text-[#e7c980] py-2.5 rounded-none font-black text-xs tracking-widest border-2 border-[#c48e36] active:translate-x-[2px] active:translate-y-[2px]">關閉列表 Close</button>
            </div>
        `;
        
        attachCardListPreviews(modal);
        (modal.querySelector('#closeModal') as HTMLElement).onclick = toggleEffectList;
        (modal.querySelector('#closeModalBtn') as HTMLElement).onclick = toggleEffectList;
        overlay.appendChild(modal);
        root.appendChild(overlay);
    }

    // Restore hand scroll position after DOM is mounted (avoid jumping back to start on rerender)
    scheduleRestoreHandScrollPositions();

    // Schedule AI after DOM is updated
    if (isComputerTurnNow() && !computerBusy) {
        queueMicrotask(() => void runComputerTurnLoop());
    }
}

function renderPlayerArea(idx: 0 | 1) {
    const p = S.players[idx];
    const isCurrent = (S.currentPlayerIndex === idx);
    const area = document.createElement('div');
    // Horizontal structure: [Stats & Queue] [Board] [Hand]
    // 右側手牌欄加寬一點（但不改中間場地三區本來的排版邏輯）
    // Player background: 先手(玩家0)=淡紅、後手(玩家1)=淡藍
    area.className = `px-8 py-4 grid grid-cols-[200px_1fr_300px] gap-6 ${idx === 0 ? 'bg-[#f2cdc9]' : 'bg-[#ccdde8]'} relative transition-all duration-300 overflow-hidden`;
    
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
        zone.className = `relative flex flex-col items-center gap-1 p-3 rounded-none transition-all border-2 border-transparent ${S.currentPhaseIndex === 2 && S.diceResults.some(d => Math.floor((d-1)/2) === aIdx) ? 'bg-[#d0c954]/35 border-[#603b2d]' : 'bg-transparent'}`;
        
        zone.innerHTML = `
            <div class="w-full flex items-center justify-center pt-2 pb-5">
                ${renderBaseBarImgHTML(idx as 0 | 1, aIdx as 0 | 1 | 2)}
            </div>
        `;

        const slot = document.createElement('div');
        slot.className = `minimal-slot w-[160px] h-[140px] border-[3px] border-dashed border-[#603b2d]/45 bg-white/55 rounded-none relative transition-all ${isCurrent && S.currentPhaseIndex === 0 && S.selectedHandCardIndex !== -1 ? 'hover:border-[#603b2d] cursor-pointer hover:bg-white' : ''}`;
        applySlotHeight(slot, getSlotMinHeightPx(p.board[aIdx].length, 90, 140), 140);
        if (isCurrent && canPlayMoreCardsThisTurn()) slot.setAttribute('data-play-zone', String(aIdx));
        
        if (isCurrent && S.currentPhaseIndex === 0 && S.selectedHandCardIndex !== -1) {
            slot.onclick = () => playToBoard(aIdx);
        }

        const {wrap: atkWrap, grid: atkContainer} = createAttackBadgeRow(20);
        
    // Logic: If it's our turn, show current calculated attacks
    // If it's NOT our turn, show our attackQueue (attacks waiting to hit the opponent)
    const effects = isCurrent ? p.currentAttacks[aIdx] : p.attackQueue[aIdx];
    effects.forEach((atkVal, hitIdx) => {
        if (atkVal === 0) return;
        const atkBadge = document.createElement('div');
        
        let displayVal = atkVal;
        let isFullyBlocked = false;

        // NEW: In Defense (3) or Damage (4) Phase, for opponent's attacks, subtract the current player's defense
        if (!isCurrent && (S.currentPhaseIndex === 3 || S.currentPhaseIndex === 4)) {
            const currentPlayer = getCurrentPlayer();
            displayVal = Math.max(0, atkVal - currentPlayer.defense);
            if (displayVal <= 0) isFullyBlocked = true;
        }

        // Evasion Targeting: If current player is in evasion mode AND we are looking at opponent's board
        const canBeDodged = !isCurrent && S.evasionSelectionMode;
        const isChargeTarget = isCurrent && S.chargeSelectionMode;
        const isReproductionTarget = isCurrent && S.reproductionSelectionMode;
        const isFlareTarget = isCurrent && S.flareSelectionMode;
        
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
    
    slot.appendChild(atkWrap);

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
        cardEl.style.top = `${cIdx * 30}px`;
        
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
        if (card.effectId === 'illusion' && isActiveEffect && S.illusionSelectionMode && S.illusionSourceAreaIdx === aIdx) {
            cardEl.classList.add('ring-2', 'ring-teal-400', 'z-40');
        }
 
        // Lucky high-light
        // User: "掷骰阶段时自动触发 ... 直到选择完成前 [幸運]持续发光"
        // Glow if Phase 1 and (no roll yet OR in removal selection) AND it is your own turn
        if (effId === 'lucky' && isActiveEffect && isCurrent && S.currentPhaseIndex === 1 && (S.diceResults.length === 0 || S.luckySelectionMode)) {
            cardEl.classList.add('ring-2', 'ring-lime-400', 'z-40');
        }
        
        const typeColors = {
            attack: 'bg-red-500',
            defense: 'bg-blue-500',
            magic: 'bg-emerald-500',
            gold: 'bg-amber-500'
        };

        // Note: displayEffectName 仍保留給幻象顯示，但目前卡牌名稱顯示只顯示效果名
        const displayEffectName = (() => {
            if (card.effectId !== 'illusion') return card.effectName;
            const copiedId = p.illusionCopiedEffectIds[aIdx];
            if (!copiedId) return card.effectName;
            const copiedName = EFFECTS.find(e => e.id === copiedId)?.name || '';
            // 需求：顯示成兩行
            // 幻象幽影
            // [該卡名稱]
            return copiedName ? `幻象幽影\n${copiedName}` : '幻象幽影';
        })();

        // 被覆蓋的卡牌：名稱也要保留；tooltip 只給最上層生效卡（避免互相遮擋）
        const nameForUI = (isTop && isActiveEffect) ? displayEffectName : card.effectName;
        cardEl.innerHTML = renderCardPngHTML(card.effectId, nameForUI);

        // Tooltip（只給最上層生效卡，避免堆疊互相遮擋）
        if (isTop && isActiveEffect) {
            // 幻象幽影：若已複製效果，tooltip 描述也改成被複製效果的描述
            let tooltipDesc = card.effectDesc;
            if (card.effectId === 'illusion' && p.illusionCopiedEffectIds[aIdx]) {
                tooltipDesc = EFFECTS.find(e => e.id === p.illusionCopiedEffectIds[aIdx])?.desc || tooltipDesc;
            }
                    attachCardTooltip(cardEl, {effectId: card.effectId, alt: nameForUI});
        }

        if (isCurrent && isTop && isActiveEffect) {
            const isMirageBlocked = isMirageActive();
            if (S.currentPhaseIndex === 5 && effId === 'charge') {
                if (p.magic >= 2 && !p.chargeUsedIndices.includes(aIdx) && !isMirageBlocked) {
                    const isSource = S.chargeSelectionMode && S.chargeSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useCharge(aIdx); };
                }
            } else if (S.currentPhaseIndex === 5 && effId === 'magic_bullet') {
                if (p.magic >= 1 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-emerald-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useMagicBullet(aIdx); };
                }
            } else if (S.currentPhaseIndex === 5 && effId === 'amplify') {
                // Amplify is free: Only pulse if THIS specific area's amplify not used
                if (!p.amplifyUsedIndices.includes(aIdx) && hasAnyAttackTarget(p)) {
                    cardEl.classList.add('ring-2', 'ring-blue-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useAmplify(aIdx); };
                }
            } else if ((S.currentPhaseIndex === 1 || S.currentPhaseIndex === 2) && effId === 'fate') {
                // Fate: Re-roll dice (usable in Roll phase after roll, or Judging phase)
                const diceRolled = S.diceResults.length > 0;
                if (!p.fateUsedIndices.includes(aIdx) && diceRolled && !S.luckySelectionMode) {
                    cardEl.classList.add('ring-2', S.fateSelectionMode ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useFate(aIdx); };
                }
            } else if (S.currentPhaseIndex === 3 && effId === 'dodge') {
                // Dodge: Ignore incoming attack in Defense Phase
                const opp = getOpponent();
                const hasDodgeableAttacks = opp.attackQueue.flat().length > 0;
                if (!p.evasionUsedIndices.includes(aIdx) && p.magic >= 3 && hasDodgeableAttacks && !isMirageBlocked) {
                    const isSource = S.evasionSelectionMode && S.evasionSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useEvasion(aIdx); };
                }
            } else if (S.currentPhaseIndex === 3 && effId === 'barrier') {
                // Modified Barrier: Consume 3 magic for 3 defense in Defense Phase
                if (p.magic >= 3 && !p.barrierUsedIndices.includes(aIdx) && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useBarrier(aIdx); };
                }
            } else if (S.currentPhaseIndex === 3 && effId === 'shield') {
                // Shield: Consume 2 magic for 1 defense in Defense Phase
                if (p.magic >= 2 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-blue-300', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useShield(aIdx); };
                }
            } else if (S.currentPhaseIndex === 5 && effId === 'reproduction') {
                // Reproduction: Consume 2 magic, make one attack twice
                if (!p.reproductionUsedIndices.includes(aIdx) && p.magic >= 2 && !isMirageBlocked) {
                    const isSource = S.reproductionSelectionMode && S.reproductionSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useReproduction(aIdx); };
                }
            } else if (S.currentPhaseIndex === 5 && effId === 'flare') {
                // Flare: Consume 3 magic, double one attack
                if (!p.flareUsedIndices.includes(aIdx) && p.magic >= 3 && hasAnyAttackTarget(p) && !isMirageBlocked) {
                    const isSource = S.flareSelectionMode && S.flareSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-indigo-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useFlare(aIdx); };
                }
            } else if (S.currentPhaseIndex === 5 && effId === 'thrust') {
                // Thrust: Double all 1s and 2s
                const canThrust = hasAnyThrustTarget(p);
                if (!p.thrustUsedIndices.includes(aIdx) && canThrust) {
                    cardEl.classList.add('ring-2', 'ring-rose-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useThrust(aIdx); };
                }
            } else if (S.currentPhaseIndex === 5 && effId === 'forest') {
                // Forest: Merge all attacks
                if (!p.forestUsedIndices.includes(aIdx) && p.magic >= 3 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-emerald-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useForest(aIdx); };
                }
            } else if (S.currentPhaseIndex === 1 && effId === 'frost') {
                // Frost: Discard a die for 1-3 extra attack
                const diceRolled = S.diceResults.length > 0;
                if (!p.frostUsedIndices.includes(aIdx) && diceRolled && !S.luckySelectionMode) {
                    const isSource = S.frostSelectionMode && S.frostSourceAreaIdx === aIdx;
                    cardEl.classList.add('ring-2', isSource ? 'ring-amber-500' : 'ring-blue-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useFrost(aIdx); };
                }
            } else if (S.currentPhaseIndex === 2 && effId === 'magic_luck') {
                if (p.magic >= 2 && !p.magicLuckUsedIndices.includes(aIdx) && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-purple-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useMagicLuck(aIdx); };
                }
            } else if (S.currentPhaseIndex === 2 && card.effectId === 'illusion') {
                const opp = getOpponent();
                const hasCopyableCard = opp.activeAreaEffects.some(c => c && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(c.effectId));
                if (p.magic >= 1 && !p.illusionUsedIndices.includes(aIdx) && !isMirageBlocked && hasCopyableCard) {
                    cardEl.classList.add('ring-2', 'ring-teal-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useIllusion(aIdx); };
                }
            } else if ([2, 3, 4, 5].includes(S.currentPhaseIndex) && effId === 'holy_light') {
                // Holy Light: Consume 2 magic for 1 HP
                if (p.magic >= 2 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-yellow-300', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useHolyLight(aIdx); };
                }
            } else if ([2, 3, 4, 5].includes(S.currentPhaseIndex) && effId === 'soul_snatch') {
                // Soul Snatch: Consume 3 magic to absorb 1 HP
                if (p.magic >= 3 && !isMirageBlocked) {
                    cardEl.classList.add('ring-2', 'ring-purple-400', 'cursor-pointer');
                    cardEl.onclick = (e) => { e.stopPropagation(); useSoulSnatch(aIdx); };
                }
            }
        }
        // Opponent card targeting for Illusion
        if (!isCurrent && isTop && isActiveEffect && S.illusionSelectionMode && !ILLUSION_UNCOPYABLE_EFFECT_IDS.has(card.effectId)) {
            cardEl.classList.add('ring-2', 'ring-teal-500', 'cursor-pointer', 'shadow-2xl', 'z-50');
            cardEl.onclick = (e) => { e.stopPropagation(); targetIllusion(aIdx); };
        }

        slot.appendChild(cardEl);
    });
        
        // Dice Pool: Improved stacking visibility
        if (isCurrent && S.diceResults.length > 0) {
            const dicePool = document.createElement('div');
            // Adjusted -top-18 to grant room for 8px stack height
            dicePool.className = 'absolute -top-18 inset-x-0 h-8 pointer-events-none z-30';
            
            let leftCount = 0;
            let rightCount = 0;

            S.diceResults.forEach((val, originalIdx) => {
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
                
                const isSelected = S.fateSelectedDiceIndices.includes(originalIdx);
                const isFrostTarget = S.frostSelectionMode;
                const isLuckyTarget = S.luckySelectionMode;

                const dIcon = document.createElement('div');
                // Smaller dice w-6 (24px)
                const diceColorClass = isSelected ? 'bg-amber-500 text-white ring-amber-300 animate-pulse' : (isFrostTarget ? 'bg-blue-400 text-white ring-blue-200 animate-pulse' : (isLuckyTarget ? 'bg-lime-500 text-white ring-lime-200 animate-pulse' : 'bg-slate-900 text-white ring-white'));
                dIcon.className = `w-6 h-6 rounded shadow-xl ring-2 ${diceColorClass} ${S.fateSelectionMode || S.frostSelectionMode || S.luckySelectionMode ? 'cursor-pointer hover:scale-110 active:scale-95' : ''}`;
                dIcon.innerHTML = renderDiePipsHTML(val);
                dIcon.setAttribute('aria-label', `骰子 ${valStr}`);
                if (S.fateSelectionMode) dIcon.onclick = () => toggleDiceIndexSelection(originalIdx);
                else if (S.frostSelectionMode) dIcon.onclick = () => targetFrost(originalIdx);
                else if (S.luckySelectionMode) dIcon.onclick = () => removeLuckyDie(originalIdx);
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
    // Use extra horizontal padding so the left-most card's ring/glow isn't clipped
    // by the scroll container edge.
    handWrap.className = 'w-full grid grid-rows-2 grid-flow-col auto-cols-max gap-3 h-[220px] overflow-x-auto overflow-y-visible px-4 py-2 content-start justify-center';
    handWrap.id = `desktop-hand-wrap-${idx}`;
    handWrap.scrollLeft = desktopHandScrollLeft[idx];
    // 捲動時也先關掉 tooltip（避免滑鼠停在卡上時拖曳捲動造成 tooltip 殘留）
    handWrap.addEventListener('scroll', () => {
        desktopHandScrollLeft[idx] = handWrap.scrollLeft;
        hideGlobalTooltip();
    });
    p.hand.forEach((card, hIdx) => {
        const cardEl = document.createElement('div');
        const isSelected = (isCurrent && S.selectedHandCardIndex === hIdx);

        const selectable = isCurrent && canPlayMoreCardsThisTurn();
        cardEl.className = `card-frame shadow-sm group relative transition-all ${selectable ? 'cursor-pointer' : 'opacity-60'} ${isSelected ? 'border-blue-500 ring-2 ring-blue-300 shadow-[0_0_0_4px_rgba(59,130,246,0.35)] scale-105' : (selectable ? 'hover:-translate-y-1 hover:border-slate-400' : '')}`;
        cardEl.setAttribute('style', getCardFrameStyleVars('hand'));
        cardEl.innerHTML = renderCardPngHTML(card.effectId, card.effectName);
                attachCardTooltip(cardEl, {effectId: card.effectId, alt: card.effectName});
        if (selectable) {
            cardEl.onclick = () => selectHandCard(hIdx);
            attachHandCardDrag(cardEl, hIdx);
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

// --- App Start ---
// Default: Home screen. Click PvP to start a match (will call initGame()).
// Preload all card images early to reduce flicker during full re-renders.
void preloadCardImages();
render();

// 讓 responsive 模式縮放視窗時可以即時切換 mobile/desktop layout
// 只要跨過 breakpoint (768px) 就 rerender。
let lastIsMobileLayout = isMobileLayout();
window.addEventListener('resize', () => {
    const now = isMobileLayout();
    if (now !== lastIsMobileLayout) {
        lastIsMobileLayout = now;
        // 切到 Mobile 且正在出牌階段：自動彈出手牌抽屜；其他情況預設收合
        if (now && S.currentPhaseIndex === 0) {
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
        if (now && S.currentPhaseIndex === 0) {
            mobileDockTab = 'hand';
            handDrawerOpen = true;
        } else {
            handDrawerOpen = false;
        }
    }
    render();
});

// --- 雙擊縮放防護 ---------------------------------------------------------
// touch-action: manipulation 已經先擋一層，但實機上 iOS Safari 仍可能把 300ms
// 內的兩次點擊判定成「雙擊縮放」，把整個網頁內容放大。
//
// 傳統做法是直接對第二次 touchend 呼叫 preventDefault，但那會連瀏覽器補送的
// click 一起吃掉 —— 在這款需要快速連點（例如連按「繼續」）的遊戲裡等於壞掉。
// 所以這裡攔掉預設行為之後，自己補送一次 click，功能維持不變。
function installDoubleTapZoomGuard() {
    let lastTouchEndAt = -Infinity;
    let syntheticClickAt = -Infinity;
    let syntheticClickTarget: EventTarget | null = null;

    document.addEventListener('touchend', (e: TouchEvent) => {
        const now = performance.now();
        const isSecondTap = now - lastTouchEndAt <= 300;
        lastTouchEndAt = now;

        if (!isSecondTap) return;
        if (e.touches.length > 0) return; // 多指手勢不干預（保留 pinch 縮放）

        e.preventDefault();

        const target = e.target as HTMLElement | null;
        if (!target || typeof target.click !== 'function') return;
        syntheticClickAt = now;
        syntheticClickTarget = target;
        target.click();
    }, {passive: false});

    // preventDefault 之後多數瀏覽器就不會再送 click，但萬一送了，
    // 別讓同一次點擊變成兩下（合成的 click 是 isTrusted === false）。
    document.addEventListener('click', (e: MouseEvent) => {
        if (!e.isTrusted) return;
        if (e.target !== syntheticClickTarget) return;
        if (performance.now() - syntheticClickAt > 400) return;
        syntheticClickTarget = null;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, {capture: true});
}

installDoubleTapZoomGuard();

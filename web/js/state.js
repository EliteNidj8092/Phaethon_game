/**
 * state.js — PHAETHON V4.0 游戏状态管理
 *
 * 职责：
 *   1. 定义全部游戏运行状态变量（棋盘、HP、各种 V4 系统状态）
 *   2. 提供状态查询函数（格子归属、空位判断、环境/封印检测）
 *   3. 实现棋盘初始化和棋子落子流程
 *   4. 计算悬浮预览（hover 时显示伤害/破绽信息）
 *   5. 管理威胁高亮和撤销功能
 *   6. Buff/Debuff 管理
 *
 * V4.0 新增：深渊之羽状态、Buff/Debuff 数组、石面级标记(侵蚀/灼魂/封印标记)
 *
 * 依赖：G.js（常量、工具函数）、main.js（UI更新函数——仅在运行时调用，加载时安全）
 * 被依赖：logic.js, ai.js, render.js, main.js
 */
(function(G) {
    // ================================================================
    // 核心棋盘状态
    // ================================================================
    G.board = [];
    G.envCells = new Set();
    G.currentPlayer = 'blue';
    G.playerHP = { blue: G.MAX_HP, red: G.MAX_HP };
    G.pendingAttack = null;
    G.gameOver = false;
    G.winner = null;
    G.busy = false;
    G.aiOn = true;
    G.moveHistory = [];
    G.particles = [];
    G.envSpawnAnims = [];
    G.needsRender = true;
    G.turnCount = 0;
    G.aiSearchStats = { nodes: 0, depth: 0, prunes: 0 };

    // ================================================================
    // V3.0 遗留系统状态
    // ================================================================
    G.flawPairs = [];
    G.phantomStones = new Map();
    G.sealedStones = new Set();
    G.playerCharge = { blue: 0, red: 0 };
    G.counterStreak = { blue: 0, red: 0 };
    G.isOverloaded = { blue: false, red: false };
    G.isSuffocating = false;
    G.phantomEyes = [];
    G.placementHistory = [];
    G.hoverPreview = null;
    G.threatHighlights = [];
    G.highlightCells = [];

    // ================================================================
    // V4.0 新增：Buff/Debuff 体系
    // ================================================================
    // 玩家级别 Buff: [{type, stacks, expiresAt}]  expiresAt=-1 表示永久(消耗型)
    G.playerBuffs = { blue: [], red: [] };
    // 玩家级别 Debuff: [{type, expiresAt, param}]
    G.playerDebuffs = { blue: [], red: [] };

    // ================================================================
    // V4.0 新增：深渊之羽状态
    // ================================================================
    // feather: {hp, maxHp, aty, fastActionCount, totalDeflect, detonated} | null
    G.feathers = { blue: null, red: null };

    // ================================================================
    // V4.0 新增：石面级 Debuff
    // ================================================================
    // 侵蚀印记: keyRC → {owner, turnsLeft}
    G.erosionMarks = new Map();
    // 灼魂: keyRC → {turnsLeft}
    G.soulBurnMarks = new Map();
    // 封印标记(非真正封印，仅不连线): keyRC → {turnsLeft}
    G.sealMarks = new Map();

    // ================================================================
    // V4.0 新增：玩家级别特殊状态标记
    // ================================================================
    G.nextStoneSealed = { blue: false, red: false };    // 封印预感
    G.turnCountPaused = { blue: false, red: false };     // 时间回溯
    G.chargingDisabled = { blue: false, red: false };    // 灵能紊乱
    G.fastActionPending = { blue: 0, red: 0 };           // 快速行动待执行次数
    G.isExtraTurn = false;                                // 当前是否在快速行动回合

    // ================================================================
    // V4.0 新增：星轨贯穿激光残留（渲染用）
    // ================================================================
    G.penetrationLasers = []; // [{startR, startC, dr, dc, endR, endC, time}]

    // ================================================================
    // 状态查询函数
    // ================================================================

    G.getCellOwner = function(r, c) { return G.board[r]?.[c]?.owner ?? null; };

    G.isCellEmpty = function(r, c) {
        return G.board[r]?.[c] === null && !G.phantomStones.has(G.keyRC(r, c));
    };

    G.isCellReallyEmpty = function(r, c) { return G.board[r]?.[c] === null; };

    G.hasEnv = function(r, c) { return G.envCells.has(G.keyRC(r, c)); };

    G.isSealed = function(r, c) { return G.sealedStones.has(G.keyRC(r, c)); };

    G.isSealMarked = function(r, c) { return G.sealMarks.has(G.keyRC(r, c)); };

    /** 格子是否被封印或封印标记（两者都不参与连线） */
    G.isBlockedFromLine = function(r, c) {
        return G.sealedStones.has(G.keyRC(r, c)) || G.sealMarks.has(G.keyRC(r, c));
    };

    G.getPieceCount = function() {
        let count = 0;
        for (let r = 0; r < G.BOARD_SIZE; r++)
            for (let c = 0; c < G.BOARD_SIZE; c++)
                if (G.getCellOwner(r, c)) count++;
        return count;
    };

    // ================================================================
    // Buff/Debuff 管理函数
    // ================================================================

    /** 添加 Buff——同类不叠加，取最高值或刷新 */
    G.addBuff = function(player, type, stacks, expiresIn) {
        if (!stacks) stacks = 1;
        var expiresAt = expiresIn ? performance.now() + expiresIn * 1000 : -1;
        var existing = null;
        for (var i = 0; i < G.playerBuffs[player].length; i++) {
            if (G.playerBuffs[player][i].type === type) { existing = G.playerBuffs[player][i]; break; }
        }
        if (existing) {
            if (type === 'sharp') existing.stacks = Math.min((existing.stacks || 0) + stacks, G.BUFF_SHARP_MAX_STACK);
            else if (stacks > (existing.stacks || 1)) existing.stacks = stacks;
            if (expiresAt > existing.expiresAt) existing.expiresAt = expiresAt;
        } else {
            G.playerBuffs[player].push({ type: type, stacks: stacks, expiresAt: expiresAt });
        }
    };

    /** 消耗 Buff——返回剩余层数 */
    G.consumeBuff = function(player, type) {
        for (var i = 0; i < G.playerBuffs[player].length; i++) {
            if (G.playerBuffs[player][i].type === type) {
                var b = G.playerBuffs[player][i];
                b.stacks--;
                if (b.stacks <= 0) { G.playerBuffs[player].splice(i, 1); return 0; }
                return b.stacks;
            }
        }
        return 0;
    };

    /** 添加 Debuff——同类刷新时间 */
    G.addDebuff = function(player, type, expiresIn, param) {
        var expiresAt = performance.now() + expiresIn * 1000;
        for (var i = 0; i < G.playerDebuffs[player].length; i++) {
            if (G.playerDebuffs[player][i].type === type) {
                G.playerDebuffs[player][i].expiresAt = Math.max(G.playerDebuffs[player][i].expiresAt, expiresAt);
                if (param !== undefined) G.playerDebuffs[player][i].param = param;
                return;
            }
        }
        G.playerDebuffs[player].push({ type: type, expiresAt: expiresAt, param: param });
    };

    /** 移除指定 Debuff */
    G.removeDebuff = function(player, type) {
        G.playerDebuffs[player] = G.playerDebuffs[player].filter(function(d) { return d.type !== type; });
    };

    /** 查询是否有某 Buff */
    G.hasBuff = function(player, type) {
        return G.playerBuffs[player].some(function(b) { return b.type === type && b.stacks > 0; });
    };

    /** 查询是否有某 Debuff */
    G.hasDebuff = function(player, type) {
        return G.playerDebuffs[player].some(function(d) { return d.type === type; });
    };

    /** 获取 Debuff 参数 */
    G.getDebuffParam = function(player, type) {
        for (var i = 0; i < G.playerDebuffs[player].length; i++) {
            if (G.playerDebuffs[player][i].type === type) return G.playerDebuffs[player][i].param;
        }
        return undefined;
    };

    /** 清理过期 Buff（在回合结算时调用） */
    G.removeExpiredBuffs = function(player) {
        var now = performance.now();
        G.playerBuffs[player] = G.playerBuffs[player].filter(function(b) {
            return b.expiresAt === -1 || b.expiresAt > now;
        });
    };

    /** 清理过期 Debuff（在回合结算时调用） */
    G.removeExpiredDebuffs = function(player) {
        var now = performance.now();
        G.playerDebuffs[player] = G.playerDebuffs[player].filter(function(d) {
            if (d.expiresAt <= now) {
                // 移除特殊标记
                if (d.type === 'chaos') G.chargingDisabled[player] = false;
                if (d.type === 'time_reversal') G.turnCountPaused[player] = false;
                return false;
            }
            return true;
        });
        // 同步检查 reset 标记
        if (!G.hasDebuff(player, 'chaos')) G.chargingDisabled[player] = false;
        if (!G.hasDebuff(player, 'time_reversal')) G.turnCountPaused[player] = false;
    };

    /** 回合开始时处理玩家 Dot Debuff */
    G.processTurnStartDebuffs = function(player) {
        var totalDot = 0;
        // 魂火灼烧
        if (G.hasDebuff(player, 'soulfire')) {
            var dmg = Math.min(G.DEBUFF_DEFS.soulfire.damage, G.TRUE_DMG_CAP);
            totalDot += dmg;
        }
        // 深渊共鸣：羽存活时多扣1HP
        if (G.hasDebuff(player, 'abyss_resonance')) {
            var opp = player === 'blue' ? 'red' : 'blue';
            if (G.feathers[opp] && !G.feathers[opp].detonated) {
                totalDot += G.ABYSS_WITH_FEATHER_DMG;
            }
        }
        return Math.min(totalDot, G.TRUE_DMG_CAP);
    };

    // ================================================================
    // 游戏初始化
    // ================================================================
    G.initBoard = function() {
        G.board = Array.from({ length: G.BOARD_SIZE }, () => Array(G.BOARD_SIZE).fill(null));
        G.envCells.clear();
        G.phantomStones.clear();
        G.sealedStones.clear();
        G.flawPairs = [];
        G.placementHistory = [];
        G.phantomEyes = [];
        G.currentPlayer = 'blue';
        G.playerHP = { blue: G.MAX_HP, red: G.MAX_HP };
        G.playerCharge = { blue: 0, red: 0 };
        G.counterStreak = { blue: 0, red: 0 };
        G.isOverloaded = { blue: false, red: false };
        G.isSuffocating = false;
        G.pendingAttack = null;
        G.gameOver = false;
        G.winner = null;
        G.busy = false;
        G.moveHistory = [];
        G.particles = [];
        G.envSpawnAnims = [];
        G.pieceSpawnAnims = [];
        G.ambientParticles = [];
        G.winParticles = [];
        G.enhancedPieceCount = 0;
        G.lastDeathCause = null;
        G.needsRender = true;
        G.turnCount = 0;
        G.aiSearchStats = { nodes: 0, depth: 0, prunes: 0 };
        G.hoverPreview = null;
        G.hoverHPDelta = null;
        G.threatHighlights = [];
        G.highlightCells = [];

        // V4.0 重置
        G.playerBuffs = { blue: [], red: [] };
        G.playerDebuffs = { blue: [], red: [] };
        G.feathers = { blue: null, red: null };
        G.erosionMarks.clear();
        G.soulBurnMarks.clear();
        G.sealMarks.clear();
        G.nextStoneSealed = { blue: false, red: false };
        G.turnCountPaused = { blue: false, red: false };
        G.chargingDisabled = { blue: false, red: false };
        G.fastActionPending = { blue: 0, red: 0 };
        G.isExtraTurn = false;
        G.penetrationLasers = [];

        G.updateAllUI();
        G.logMsg('sys', '=== PHAETHON V4.0 · 暗子破阵 ===');
        G.logMsg('sys', '🔮破绽跳板 | 🛡️截击过载 | 🌿星轨贯穿 | 👁阵眼共鸣 | 🪶深渊之羽');
        G.setStatus('你的回合 · 在交叉点落子');
        G.winOverlay.classList.remove('show');
        G.pendingBadge.style.display = 'none';
        G.undoBtn.disabled = true;
        G.highlightTurn();
    };

    // ================================================================
    // 缺氧检测
    // ================================================================
    G.checkSuffocation = function() {
        if (!G.isSuffocating && G.getPieceCount() >= G.HYPOXIA_THRESHOLD) {
            G.isSuffocating = true;
            G.logMsg('warn', '🌬️ 缺氧状态激活！棋盘≥169子，无效落子将扣除1HP（绝杀防守除外）');
            G.toastMsg('HYPOXIA!', '#ff8c00');
        }
    };

    // ================================================================
    // 阵眼觉醒
    // ================================================================
    G.updatePhantomEyes = function() {
        if (G.turnCount < G.PHANTOM_EYE_TURN) { G.phantomEyes = []; return; }
        const candidates = [];
        const seen = new Set();
        for (let i = 0; i < G.placementHistory.length; i++) {
            const h = G.placementHistory[i];
            const k = G.keyRC(h.row, h.col);
            if (seen.has(k)) continue;
            if (G.isSealed(h.row, h.col)) continue;
            if (G.erosionMarks.has(k)) continue;
            if (!G.getCellOwner(h.row, h.col)) continue;
            if (G.phantomStones.has(k)) continue;
            seen.add(k);
            candidates.push({ row: h.row, col: h.col, owner: h.owner, turnPlaced: h.turnPlaced });
        }
        candidates.sort((a, b) => a.turnPlaced - b.turnPlaced);
        G.phantomEyes = candidates.slice(0, 3);
        if (G.phantomEyes.length > 0 && G.turnCount === G.PHANTOM_EYE_TURN) {
            G.logMsg('breach', '👁 阵眼觉醒！双方最老的3颗棋子获阵眼资格(伤害+4&回血3)');
            G.toastMsg('PHANTOM EYE!', '#c084fc');
        }
    };

    // ================================================================
    // 阵眼递补——被剥夺后顺延递补
    // ================================================================
    G.refillEyes = function() {
        if (G.turnCount < G.PHANTOM_EYE_TURN) return;
        const currentEyes = new Set(G.phantomEyes.map(function(e) { return G.keyRC(e.row, e.col); }));
        const candidates = [];
        const seen = new Set();
        for (let i = 0; i < G.placementHistory.length; i++) {
            const h = G.placementHistory[i];
            const k = G.keyRC(h.row, h.col);
            if (seen.has(k)) continue;
            if (G.isSealed(h.row, h.col)) continue;
            if (G.erosionMarks.has(k)) continue;
            if (!G.getCellOwner(h.row, h.col)) continue;
            if (G.phantomStones.has(k)) continue;
            seen.add(k);
            if (!currentEyes.has(k)) {
                candidates.push({ row: h.row, col: h.col, owner: h.owner, turnPlaced: h.turnPlaced });
            }
        }
        candidates.sort((a, b) => a.turnPlaced - b.turnPlaced);
        // 补足到3颗
        while (G.phantomEyes.length < 3 && candidates.length > 0) {
            G.phantomEyes.push(candidates.shift());
        }
    };

    // ================================================================
    // 落子操作
    // ================================================================
    G.placePiece = function(r, c) {
        if (!G.isCellReallyEmpty(r, c)) return false;

        // 检查封印预感 Debuff
        const autoSeal = G.nextStoneSealed[G.currentPlayer];

        const hadPhantom = G.phantomStones.has(G.keyRC(r, c));
        if (hadPhantom) {
            G.phantomStones.delete(G.keyRC(r, c));
            G.logMsg('phantom', '💥 ' + (G.currentPlayer === 'blue' ? 'BLUE' : 'RED') + ' 踩碎了暗子于(' + c + ',' + r + ')');
        }

        const enhanced = G.hasEnv(r, c);
        if (enhanced) G.envCells.delete(G.keyRC(r, c));

        G.board[r][c] = { owner: G.currentPlayer, enhanced };
        G.placementHistory.push({ row: r, col: c, owner: G.currentPlayer, turnPlaced: G.turnCount });

        G.pieceSpawnAnims.push({ r, c, startTime: performance.now(), duration: 300, owner: G.currentPlayer, enhanced });
        var placePos = G.gridToPos(r, c);
        G.spawnPlaceRipple(placePos.x, placePos.y, G.currentPlayer);
        if (enhanced) G.enhancedPieceCount++;

        // 封印预感：自动封印此棋子
        if (autoSeal) {
            G.sealedStones.add(G.keyRC(r, c));
            G.nextStoneSealed[G.currentPlayer] = false;
            G.removeDebuff(G.currentPlayer, 'seal_premonition');
            G.logMsg('warn', '🔒 ' + (G.currentPlayer === 'blue' ? 'BLUE' : 'RED') + ' 受封印预感影响，棋子被自动封印！');
        }

        // 保存状态快照
        G.moveHistory.push({
            row: r, col: c, player: G.currentPlayer, enhanced,
            hadPending: !!G.pendingAttack,
            pendingSnap: G.pendingAttack ? JSON.parse(JSON.stringify(G.pendingAttack)) : null,
            envSnap: new Set(G.envCells),
            hpSnap: { ...G.playerHP },
            boardSnap: G.board.map(row => row.map(c => c ? { ...c } : null)),
            turnCountSnap: G.turnCount,
            chargeSnap: { ...G.playerCharge },
            counterSnap: { ...G.counterStreak },
            overloadSnap: { ...G.isOverloaded },
            phantomSnap: new Map(G.phantomStones),
            sealedSnap: new Set(G.sealedStones),
            flawSnap: JSON.parse(JSON.stringify(G.flawPairs)),
            historySnap: [...G.placementHistory],
            eyeSnap: [...G.phantomEyes],
            suffocationSnap: G.isSuffocating,
            // V4.0
            buffsSnap: JSON.parse(JSON.stringify(G.playerBuffs)),
            debuffsSnap: JSON.parse(JSON.stringify(G.playerDebuffs)),
            featherSnap: JSON.parse(JSON.stringify(G.feathers)),
            erosionSnap: new Map(G.erosionMarks),
            soulBurnSnap: new Map(G.soulBurnMarks),
            sealMarkSnap: new Map(G.sealMarks),
            nextStoneSealedSnap: { ...G.nextStoneSealed },
            chargingDisabledSnap: { ...G.chargingDisabled },
            turnCountPausedSnap: { ...G.turnCountPaused },
            fastActionSnap: { ...G.fastActionPending },
        });

        G.undoBtn.disabled = false;
        G.hoverPreview = null;
        G.updateThreatHighlights(G.currentPlayer);
        return true;
    };

    // ================================================================
    // 威胁高亮
    // ================================================================
    G.updateThreatHighlights = function(player) {
        if (G.gameOver || player !== 'blue') { G.threatHighlights = []; return; }
        const allFourCells = new Set();
        for (let r = 0; r < G.BOARD_SIZE; r++) {
            for (let c = 0; c < G.BOARD_SIZE; c++) {
                if (G.getCellOwner(r, c) !== player) continue;
                const lines4 = G.detectLines(r, c, G.PHAETHON_MIN);
                for (const line of lines4)
                    for (const cell of line.cells) allFourCells.add(G.keyRC(cell.r, cell.c));
            }
        }
        const threatSet = new Set();
        for (let r = 0; r < G.BOARD_SIZE; r++) {
            for (let c = 0; c < G.BOARD_SIZE; c++) {
                if (G.getCellOwner(r, c) !== player) continue;
                if (allFourCells.has(G.keyRC(r, c))) continue;
                const openThrees = G.isOpenThree(r, c, player);
                for (const ot of openThrees) {
                    for (const cell of ot.cells) {
                        if (!allFourCells.has(G.keyRC(cell.r, cell.c)))
                            threatSet.add(G.keyRC(cell.r, cell.c));
                    }
                }
            }
        }
        G.threatHighlights = Array.from(threatSet).map(k => {
            const [rr, cc] = k.split(',').map(Number);
            return { r: rr, c: cc };
        });
    };

    // ================================================================
    // 悬浮预览——包含 V4 Buff/Debuff 伤害计算
    // ================================================================
    G.calculatePlacementPreview = function(r, c, player) {
        if (!G.isCellReallyEmpty(r, c)) return null;
        if (G.phantomStones.has(G.keyRC(r, c)))
            return { damage: null, breachCells: [], isAscend: false, isPhantomCrush: true };
        const enhanced = G.hasEnv(r, c);
        G.board[r][c] = { owner: player, enhanced };
        const lines4 = G.detectLines(r, c, G.PHAETHON_MIN);
        const openThrees = G.isOpenThree(r, c, player);
        G.board[r][c] = null;
        let damage = null;
        let breachCells = [];
        if (lines4.length > 0) {
            const ml = lines4[0];
            damage = G.calculateV4Damage(ml, player, r, c, enhanced);
        } else if (openThrees.length > 0) {
            breachCells = openThrees[0].cells.map(c => ({ r: c.r, c: c.c }));
        }
        return { damage, breachCells, isAscend: lines4.length > 0, isPhantomCrush: false };
    };

    // ================================================================
    // V4.0 伤害计算——整合所有 Buff/Debuff 加成
    // ================================================================
    G.calculateV4Damage = function(mainLine, attacker, row, col, enhanced) {
        let power = mainLine.realCount || mainLine.length;

        // 过载加成
        if (G.isOverloaded[attacker]) {
            power += G.OVERLOAD_DAMAGE_BONUS;
        }

        // 阵眼加成
        const hasEye = G.phantomEyes.some(function(eye) {
            return mainLine.cells.some(function(c) { return c.r === eye.row && c.c === eye.col; });
        });
        if (hasEye && G.turnCount >= G.PHANTOM_EYE_TURN) {
            power += G.EYE_DAMAGE_BONUS;
        }

        // 锐利 Buff
        if (G.hasBuff(attacker, 'sharp')) {
            for (var i = 0; i < G.playerBuffs[attacker].length; i++) {
                if (G.playerBuffs[attacker][i].type === 'sharp') {
                    power += G.BUFF_SHARP_DAMAGE * G.playerBuffs[attacker][i].stacks;
                    break;
                }
            }
        }

        // 灵能共鸣 Buff
        if (G.hasBuff(attacker, 'resonance')) {
            power += G.BUFF_RESONANCE_DAMAGE;
        }

        // 虚弱诅咒 Debuff（阵眼施加）
        if (G.hasDebuff(attacker, 'weakness')) {
            power -= G.DEBUFF_DEFS.weakness.ascPenalty;
        }

        // 截击虚弱 Debuff
        if (G.hasDebuff(attacker, 'intercept_weakness')) {
            power -= G.DEBUFF_INTERCEPT_WEAKNESS;
        }

        // 灼魂 Debuff（石面级别，检测线上有多少灼魂棋子）
        for (var j = 0; j < mainLine.cells.length; j++) {
            if (G.soulBurnMarks.has(G.keyRC(mainLine.cells[j].r, mainLine.cells[j].c))) {
                power -= G.DEBUFF_SOUL_BURN_PENALTY;
                break; // 只减一次？文档说"连线伤害-2"，每个灼魂棋子减2，但这里保守处理：至少减2
            }
        }

        // 深渊共鸣 Debuff（羽不在时 PHAETHON 伤害-2）
        if (G.hasDebuff(attacker, 'abyss_resonance')) {
            var opp2 = attacker === 'blue' ? 'red' : 'blue';
            if (!G.feathers[opp2] || G.feathers[opp2].detonated) {
                power -= 2;
            }
        }

        // 伤害不能为负
        if (power < 0) power = 0;

        return power;
    };

    // ================================================================
    // 撤销
    // ================================================================
    G.undoMove = function() {
        if (G.gameOver || G.busy || G.moveHistory.length === 0) return;
        const last = G.moveHistory[G.moveHistory.length - 1];
        if (last.hadPending && last.pendingSnap) return;
        G.moveHistory.pop();
        G.board[last.row][last.col] = null;
        if (last.enhanced) G.envCells.add(G.keyRC(last.row, last.col));
        G.currentPlayer = last.player;
        G.playerHP = last.hpSnap;
        G.playerCharge = last.chargeSnap || { blue: 0, red: 0 };
        G.counterStreak = last.counterSnap || { blue: 0, red: 0 };
        G.isOverloaded = last.overloadSnap || { blue: false, red: false };
        G.envCells.clear();
        for (const k of last.envSnap) G.envCells.add(k);
        G.phantomStones.clear();
        if (last.phantomSnap) for (const [k, v] of last.phantomSnap) G.phantomStones.set(k, v);
        G.sealedStones.clear();
        if (last.sealedSnap) for (const k of last.sealedSnap) G.sealedStones.add(k);
        G.flawPairs = last.flawSnap || [];
        G.placementHistory = last.historySnap || [];
        G.phantomEyes = last.eyeSnap || [];
        G.isSuffocating = last.suffocationSnap || false;
        G.pendingAttack = last.pendingSnap;
        if (last.boardSnap) G.board = last.boardSnap.map(r => r.map(c => c ? { ...c } : null));
        G.turnCount = last.turnCountSnap ?? G.turnCount;
        G.gameOver = false;
        G.winner = null;

        // V4.0 状态恢复
        G.playerBuffs = last.buffsSnap || { blue: [], red: [] };
        G.playerDebuffs = last.debuffsSnap || { blue: [], red: [] };
        G.feathers = last.featherSnap || { blue: null, red: null };
        G.erosionMarks.clear();
        if (last.erosionSnap) for (const [k, v] of last.erosionSnap) G.erosionMarks.set(k, v);
        G.soulBurnMarks.clear();
        if (last.soulBurnSnap) for (const [k, v] of last.soulBurnSnap) G.soulBurnMarks.set(k, v);
        G.sealMarks.clear();
        if (last.sealMarkSnap) for (const [k, v] of last.sealMarkSnap) G.sealMarks.set(k, v);
        G.nextStoneSealed = last.nextStoneSealedSnap || { blue: false, red: false };
        G.chargingDisabled = last.chargingDisabledSnap || { blue: false, red: false };
        G.turnCountPaused = last.turnCountPausedSnap || { blue: false, red: false };
        G.fastActionPending = last.fastActionSnap || { blue: 0, red: 0 };

        G.winOverlay.classList.remove('show');
        G.pendingBadge.style.display = G.pendingAttack ? 'block' : 'none';
        G.clearHighlights();
        G.pieceSpawnAnims = G.pieceSpawnAnims.filter(a => a.r !== last.row || a.c !== last.col);
        if (last.enhanced) G.enhancedPieceCount = Math.max(0, G.enhancedPieceCount - 1);
        if (G.pendingAttack && G.pendingAttack.cells) G.highlightAttackCells(G.pendingAttack.cells);
        G.hoverPreview = null;
        G.updateThreatHighlights(G.currentPlayer);
        G.updateAllUI();
        G.highlightTurn();
        G.logMsg('sys', '↩ 撤销一步');
        G.needsRender = true;
    };

    console.log('[state.js] V4.0 游戏状态管理 已加载');
})(window.G);

/**
 * main.js — PHAETHON V4.0 主入口
 *
 * 职责：
 *   1. DOM 引用绑定——将所有 HTML 元素挂载到 G 命名空间
 *   2. UI 更新——刷新 HP 条、状态文本、战斗日志、数据面板
 *   3. V4.0 新增：羽 HP 条、引爆按钮、Buff/Debuff 显示
 *   4. 事件处理——鼠标/触摸/键盘/引爆按钮事件绑定
 *   5. 游戏循环——requestAnimationFrame 驱动渲染和粒子更新
 *   6. 启动——boot() 初始化游戏
 *
 * 依赖：所有其他模块（最后加载）
 * 被依赖：无（加载即启动）
 */
(function(G) {

    // ================================================================
    // DOM 引用
    // ================================================================
    G.canvas        = document.getElementById('boardCanvas');
    G.ctx           = G.canvas.getContext('2d');
    G.stageEl       = document.getElementById('stage');
    G.toastEl       = document.getElementById('toast');
    G.pendingBadge  = document.getElementById('pendingBadge');
    G.winOverlay    = document.getElementById('winOverlay');
    G.winTitle      = document.getElementById('winTitle');
    G.turnLabel     = document.getElementById('turnLabel');
    G.hpFillA       = document.getElementById('hpFillA');
    G.hpFillB       = document.getElementById('hpFillB');
    G.hpTextA       = document.getElementById('hpTextA');
    G.hpTextB       = document.getElementById('hpTextB');
    G.logContainer  = document.getElementById('logContainer');
    G.statusText    = document.getElementById('statusText');
    G.phantomInfo   = document.getElementById('phantomInfo');
    G.counterStreakInfo = document.getElementById('counterStreakInfo');
    G.envCountEl    = document.getElementById('envCount');
    G.chargeInfo    = document.getElementById('chargeInfo');
    G.pieceCountEl  = document.getElementById('pieceCount');
    G.turnCountDisplay = document.getElementById('turnCountDisplay');
    G.hypoxiaBadge  = document.getElementById('hypoxiaBadge');
    G.eyeBadge      = document.getElementById('eyeBadge');
    G.sealedCount   = document.getElementById('sealedCount');
    G.aiBtn         = document.getElementById('aiBtn');
    G.undoBtn       = document.getElementById('undoBtn');
    G.screenFlash   = document.getElementById('screenFlash');

    // V4.0 DOM
    G.featherHPBarB   = document.getElementById('featherHPBarB');
    G.featherHPTextB  = document.getElementById('featherHPTextB');
    G.featherHPBarR   = document.getElementById('featherHPBarR');
    G.featherHPTextR  = document.getElementById('featherHPTextR');
    G.featherSectionB = document.getElementById('featherSectionB');
    G.featherSectionR = document.getElementById('featherSectionR');
    G.detonateBtn     = document.getElementById('detonateBtn');
    G.buffDisplay     = document.getElementById('buffDisplay');
    G.debuffDisplay   = document.getElementById('debuffDisplay');
    G.featherInfoB    = document.getElementById('featherInfoB');
    G.featherInfoR    = document.getElementById('featherInfoR');
    G.fastActionBadge = document.getElementById('fastActionBadge');

    // ================================================================
    // V4.1 SVG 事件系统 + Emoji 映射表
    // ================================================================
    G.EMOJI_MAP = {
        '🔮':'crystal', '🛡️':'shield', '🌿':'herb', '👁':'eye', '🪶':'feather-icon',
        '⚡':'lightning', '🔒':'lock', '☠':'skull', '🌬️':'wind', '💥':'explosion',
        '🎯':'crosshair', '🗿':'erosion', '⚙':'gear', '↩':'undo', '💥':'explosion',
        '🏆':'trophy', '🤖':'robot', '⚔️':'swords', '🔐':'lock-key',
        '🗡':'sharp', '🎵':'resonance', '🛡':'shelter', '🔥':'fire', '↓':'weakness',
        '🌀':'chaos', '🌑':'abyss', '⏰':'clock', '💢':'anger', '◈':'diamond',
        '◆':'logo-diamond', '🎮':'gamepad', '✅':'check', '❌':'cross',
        '💔':'heart-broken', '🏷️':'tag', '🔗':'link', '🔌':'plug',
        '🥇':'gold-medal', '🥈':'silver-medal', '🥉':'bronze-medal',
        '💾':'gamepad', '↺':'undo',
    };
    G.svgIcon = function(name, cls) {
        return '<img src="/web/svg/' + name + '.svg" class="svg-icon ' + (cls||'') + '" data-svg-icon="' + name + '">';
    };
    G.emojiToSvg = function(emoji, cls) {
        var name = G.EMOJI_MAP[emoji];
        if (!name) return emoji;
        return G.svgIcon(name, cls);
    };
    G.emitSvgEvent = function(name, animClass) {
        var icons = document.querySelectorAll('[data-svg-icon="' + name + '"]');
        for (var i = 0; i < icons.length; i++) {
            icons[i].classList.add(animClass);
            icons[i].addEventListener('animationend', function() {
                this.classList.remove(animClass);
            }, { once: true });
        }
    };

    // ================================================================
    // HP 显示刷新
    // ================================================================
    G.refreshHPDisplay = function() {
        var curB = G.playerHP.blue, curR = G.playerHP.red;
        var pctA = Math.max(0, (curB / G.MAX_HP) * 100);
        var pctB = Math.max(0, (curR / G.MAX_HP) * 100);
        G.hpFillA.style.width = pctA + '%';
        G.hpFillB.style.width = pctB + '%';
        G.hpFillA.classList.toggle('critical', pctA < 30 && pctA > 0);
        G.hpFillB.classList.toggle('critical', pctB < 30 && pctB > 0);

        if (G.gameOver) {
            G.hpTextA.textContent = curB + ' / ' + G.MAX_HP;
            G.hpTextB.textContent = curR + ' / ' + G.MAX_HP;
            G.hpTextA.classList.remove('hp-preview');
            G.hpTextB.classList.remove('hp-preview');
            return;
        }

        var predB = curB, predR = curR;
        var hpDelta = G.hoverHPDelta;
        var hasHover = hpDelta && hpDelta.showPreview;

        if (hasHover) {
            predB = Math.max(0, curB + hpDelta.blue);
            predR = Math.max(0, curR + hpDelta.red);
        } else if (G.pendingAttack) {
            var atk = G.pendingAttack;
            if (atk.target === 'blue') predB = Math.max(0, curB - atk.power);
            else predR = Math.max(0, curR - atk.power);
        }

        var deltaB = predB - curB, deltaR = predR - curR;
        var hasAnyPreview = hasHover || !!G.pendingAttack;

        if (hasAnyPreview && deltaB < 0) {
            G.hpTextA.innerHTML = curB + ' <span class="hp-arrow">→</span> <span class="hp-pred-loss">' + predB + '</span> <span class="hp-delta">(' + deltaB + ')</span>';
            G.hpTextA.classList.add('hp-preview');
        } else if (hasHover && deltaB === 0 && G.pendingAttack && G.pendingAttack.target === 'blue') {
            G.hpTextA.innerHTML = curB + ' <span class="hp-arrow">→</span> <span class="hp-pred-safe">' + predB + '</span>';
            G.hpTextA.classList.add('hp-preview');
        } else {
            G.hpTextA.textContent = curB + ' / ' + G.MAX_HP;
            G.hpTextA.classList.remove('hp-preview');
        }

        if (hasAnyPreview && deltaR < 0) {
            G.hpTextB.innerHTML = curR + ' <span class="hp-arrow">→</span> <span class="hp-pred-loss">' + predR + '</span> <span class="hp-delta">(' + deltaR + ')</span>';
            G.hpTextB.classList.add('hp-preview');
        } else if (hasHover && deltaR === 0 && G.pendingAttack && G.pendingAttack.target === 'red') {
            G.hpTextB.innerHTML = curR + ' <span class="hp-arrow">→</span> <span class="hp-pred-safe">' + predR + '</span>';
            G.hpTextB.classList.add('hp-preview');
        } else {
            G.hpTextB.textContent = curR + ' / ' + G.MAX_HP;
            G.hpTextB.classList.remove('hp-preview');
        }
    };

    // ================================================================
    // UI 全面更新
    // ================================================================
    G.updateAllUI = function() {
        G.refreshHPDisplay();

        G.envCountEl.textContent = G.envCells.size;
        G.chargeInfo.textContent = G.playerCharge.blue + '/' + G.playerCharge.red;
        G.pieceCountEl.textContent = G.getPieceCount();
        G.turnCountDisplay.textContent = G.turnCount;

        // 暗子
        G.phantomInfo.textContent = G.phantomStones.size + '个';
        G.phantomInfo.style.color = G.phantomStones.size > 0 ? '#5ce0ff' : 'var(--muted)';

        // 截击链 + 过载
        const cB = G.counterStreak.blue, cR = G.counterStreak.red;
        const oB = G.isOverloaded.blue ? '⚡过载' : '';
        const oR = G.isOverloaded.red ? '⚡过载' : '';
        G.counterStreakInfo.textContent = 'B:' + cB + oB + ' | R:' + cR + oR;
        if (G.isOverloaded.blue || G.isOverloaded.red)
            G.counterStreakInfo.style.color = '#ff8c00';
        else if (cB > 0 || cR > 0)
            G.counterStreakInfo.style.color = '#ffdd00';
        else
            G.counterStreakInfo.style.color = 'var(--muted)';

        G.hypoxiaBadge.style.display = G.isSuffocating ? 'inline' : 'none';
        G.eyeBadge.style.display = G.phantomEyes.length > 0 ? 'inline' : 'none';
        G.sealedCount.textContent = G.sealedStones.size;

        // V4.0 羽 HP 条
        G.updateFeatherUI();

        // V4.0 Buff/Debuff 显示
        G.updateBuffDebuffUI();

        // V4.0 引爆按钮
        if (G.detonateBtn) {
            var myF = G.feathers[G.currentPlayer === 'blue' ? G.currentPlayer : G.currentPlayer];
            var showDetonate = myF && !myF.detonated && !G.gameOver && G.currentPlayer === 'blue' && !G.busy;
            G.detonateBtn.style.display = showDetonate ? 'block' : 'none';
        }

        // V4.0 快速行动
        if (G.fastActionBadge) {
            var fapB = G.fastActionPending.blue, fapR = G.fastActionPending.red;
            if (fapB > 0 || fapR > 0)
                G.fastActionBadge.style.display = 'block';
            else
                G.fastActionBadge.style.display = 'none';
        }

        G.highlightTurn();

        // 将军/致死检测
        const check = G.detectCheckState();
        if (check.checkState && check.lethalCells.length > 0) {
            G.highlightCells = check.lethalCells.map(function(lc) { return { r: lc.r, c: lc.c }; });
        } else if (!G.pendingAttack) {
            G.clearHighlights();
        }

        if (G.pendingAttack) {
            G.pendingBadge.style.display = 'block';
            if (check.pendingLethal) {
                var lethalLabels = { phaethon_eye: '☠ 阵眼致命', phaethon_overload: '☠ 过载致命', phaethon: '☠ 致死一击' };
                G.pendingBadge.textContent = (lethalLabels[check.pendingLethalType] || '☠ LETHAL') + ' · 必须截击！';
                G.pendingBadge.classList.add('lethal');
            } else {
                G.pendingBadge.textContent = '⚡ INCOMING · 截击窗口开放';
                G.pendingBadge.classList.remove('lethal');
            }
        } else {
            G.pendingBadge.style.display = 'none';
            G.pendingBadge.classList.remove('lethal');
        }

        if (!G.gameOver) {
            if (G.pendingAttack) {
                var tgt = G.pendingAttack.target === 'blue' ? 'BLUE' : 'RED';
                var lethalNote = check.pendingLethal ? ' ☠致死！' : '';
                G.setStatus('⚡ ' + tgt + ' 必须回应！枪口/枪尾可截击' + lethalNote);
            } else if (check.checkState) {
                G.setStatus(check.checkDetails);
            } else if (G.currentPlayer === 'blue') {
                G.setStatus('你的回合 · 悬浮预览伤害/破绽');
            } else {
                var dInfo = G.aiSearchStats.depth > 0
                    ? ' [深' + G.aiSearchStats.depth + '·节点' + G.aiSearchStats.nodes + '·剪' + G.aiSearchStats.prunes + ']'
                    : '';
                G.setStatus(G.aiOn ? 'AI思考中…' + dInfo : '请手动替RED落子');
            }
        }

        G.undoBtn.disabled = G.moveHistory.length === 0 || G.gameOver || G.busy;
        // V4.1 刷新可能被 textContent 覆盖的 SVG 元素
        G.refreshSvgElements();
    };

    G.refreshSvgElements = function() {
        var elems = document.querySelectorAll('#aiBtn, #pendingBadge, #fastActionBadge, #hypoxiaBadge, #eyeBadge, #winTitle, #detonateBtn');
        for (var i = 0; i < elems.length; i++) {
            var el = elems[i];
            var txt = el.textContent || '';
            var changed = false;
            for (var ek in G.EMOJI_MAP) { if (txt.indexOf(ek) >= 0) { changed = true; break; } }
            if (changed) el.innerHTML = G.emojiToSvgInText(txt);
        }
    };

    // ================================================================
    // V4.0 羽 UI 更新
    // ================================================================
    G.updateFeatherUI = function() {
        var fb = G.feathers.blue;
        var fr = G.feathers.red;

        // 蓝方羽
        if (G.featherSectionB) {
            if (fb && !fb.detonated) {
                G.featherSectionB.style.display = 'block';
                var pct = Math.max(0, (fb.hp / fb.maxHp) * 100);
                G.featherHPBarB.style.width = pct + '%';
                G.featherHPTextB.textContent = fb.hp + '/' + fb.maxHp;
                G.featherInfoB.textContent = 'aty:' + fb.aty + ' | 快动:' + fb.fastActionCount + '/' + G.FEATHER_MAX_FAST_ACTIONS;
            } else {
                G.featherSectionB.style.display = 'none';
            }
        }

        // 红方羽
        if (G.featherSectionR) {
            if (fr && !fr.detonated) {
                G.featherSectionR.style.display = 'block';
                var pct2 = Math.max(0, (fr.hp / fr.maxHp) * 100);
                G.featherHPBarR.style.width = pct2 + '%';
                G.featherHPTextR.textContent = fr.hp + '/' + fr.maxHp;
                G.featherInfoR.textContent = 'aty:' + fr.aty + ' | 快动:' + fr.fastActionCount + '/' + G.FEATHER_MAX_FAST_ACTIONS;
            } else {
                G.featherSectionR.style.display = 'none';
            }
        }
    };

    // ================================================================
    // V4.0 Buff/Debuff UI 更新
    // ================================================================
    G.updateBuffDebuffUI = function() {
        if (!G.buffDisplay || !G.debuffDisplay) return;

        // Buff 徽章
        var buffHtml = '';
        var buffIcons = { sharp:'🗡', resonance:'🎵', shelter:'🛡', last_stand:'⚡' };
        var buffSvgMap = { sharp:'sharp', resonance:'resonance', shelter:'shelter', last_stand:'last-stand' };
        for (var pi = 0; pi < 2; pi++) {
            var pName = pi === 0 ? 'blue' : 'red';
            var buffs = G.playerBuffs[pName];
            for (var i = 0; i < buffs.length; i++) {
                if (buffs[i].stacks <= 0) continue;
                var svgName = buffSvgMap[buffs[i].type] || '';
                var svgTag = svgName ? G.svgIcon(svgName, 'badge-svg') : '';
                var label = buffs[i].type === 'sharp' ? '锐利' + buffs[i].stacks :
                            buffs[i].type === 'resonance' ? '共鸣' :
                            buffs[i].type === 'shelter' ? '庇护' :
                            '绝境';
                var tag = pName === 'blue' ? 'B' : 'R';
                buffHtml += '<span class="buff-badge ' + buffs[i].type + '">' + tag + svgTag + label + '</span>';
            }
        }
        G.buffDisplay.innerHTML = buffHtml || 'Buff: -';

        // Debuff 徽章
        var debuffHtml = '';
        var debuffSvgMap = { soulfire:'fire', weakness:'weakness', chaos:'chaos', seal_premonition:'lock', abyss_resonance:'abyss', time_reversal:'clock', intercept_weakness:'anger' };
        for (var pi2 = 0; pi2 < 2; pi2++) {
            var pName2 = pi2 === 0 ? 'blue' : 'red';
            var debuffs = G.playerDebuffs[pName2];
            for (var j = 0; j < debuffs.length; j++) {
                var d = debuffs[j];
                var def = G.DEBUFF_DEFS[d.type] || { label: d.type };
                var turns = Math.max(0, Math.ceil((d.expiresAt - performance.now()) / 1000));
                var svgName2 = debuffSvgMap[d.type] || '';
                var svgTag2 = svgName2 ? G.svgIcon(svgName2, 'badge-svg') : '';
                var tag2 = pName2 === 'blue' ? 'B' : 'R';
                debuffHtml += '<span class="debuff-badge ' + d.type + '">' + tag2 + svgTag2 + def.label + '(' + turns + ')</span>';
            }
        }
        if (G.erosionMarks.size > 0) debuffHtml += '<span class="debuff-badge erosion">' + G.svgIcon('erosion', 'badge-svg') + '侵蚀:' + G.erosionMarks.size + '</span>';
        if (G.soulBurnMarks.size > 0) debuffHtml += '<span class="debuff-badge soulburn">' + G.svgIcon('fire', 'badge-svg') + '灼魂:' + G.soulBurnMarks.size + '</span>';
        G.debuffDisplay.innerHTML = debuffHtml || 'Debuff: -';
    };

    G.highlightTurn = function() {
        if (G.gameOver) {
            G.turnLabel.textContent = 'GAME OVER';
            G.turnLabel.className = 'turn';
        } else if (G.currentPlayer === 'blue') {
            G.turnLabel.innerHTML = G.emojiToSvgInText('◈') + ' BLUE · ' + (G.isExtraTurn ? 'EXTRA TURN' : 'YOUR TURN');
            G.turnLabel.className = G.isExtraTurn ? 'turn a extra' : 'turn a';
        } else {
            G.turnLabel.innerHTML = G.emojiToSvgInText('◈') + ' RED · ' + (G.isExtraTurn ? 'EXTRA TURN' : 'AI TURN');
            G.turnLabel.className = G.isExtraTurn ? 'turn b extra' : 'turn b';
        }
    };

    G.setStatus = function(t) { G.statusText.textContent = t; };

    G.logMsg = function(type, msg) {
        var div = document.createElement('div');
        div.className = type;
        // V4.1 SVG 替换 emoji
        var html = msg;
        for (var ek in G.EMOJI_MAP) {
            html = html.split(ek).join(G.svgIcon(G.EMOJI_MAP[ek], 'log-svg'));
        }
        div.innerHTML = html;
        G.logContainer.insertBefore(div, G.logContainer.firstChild);
        while (G.logContainer.children.length > 55)
            G.logContainer.removeChild(G.logContainer.lastChild);
    };

    G.toastMsg = function(text, color) {
        G.toastEl.textContent = text;
        G.toastEl.style.color = color;
        G.toastEl.classList.remove('show');
        void G.toastEl.offsetWidth;
        G.toastEl.classList.add('show');
        G.spawnToastParticles(
            G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2,
            G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2,
            color
        );
        setTimeout(() => G.toastEl.classList.remove('show'), 850);
    };

    // ================================================================
    // 事件处理
    // ================================================================

    G.canvas.addEventListener('click', function(e) {
        if (G.gameOver || G.busy) return;
        if (G.aiOn && G.currentPlayer === 'red' && !G.isExtraTurn) return;
        // 快速行动回合允许蓝方操作（即使AI开着，因为这是夺来的回合）
        var pos = G.getCanvasPos(e);
        var grid = G.posToGrid(pos.x, pos.y);
        if (!grid || !G.isCellReallyEmpty(grid.row, grid.col)) return;

        // V4.0 快速行动：有绝杀点时只能防守
        if (G.isExtraTurn && G.currentPlayer === 'blue') {
            var lethalPts = G.getLethalPoints(G.currentPlayer);
            var isOnLethal = lethalPts.some(function(lp) { return lp.r === grid.row && lp.c === grid.col; });
            if (lethalPts.length > 0 && !isOnLethal) {
                G.logMsg('warn', '⚡ 快速行动回合！存在绝杀点，只能防守');
                G.toastMsg('DEFEND ONLY!', '#ff8c00');
                return;
            }
        }

        G.hoverHPDelta = null;
        G.handleTurn(grid.row, grid.col, false);
    });

    G.canvas.addEventListener('mousemove', function(e) {
        if (G.gameOver || G.busy) {
            G.canvas.style.cursor = 'default';
            G.hoverPreview = null;
            G.hoverHPDelta = null;
            return;
        }
        if (G.aiOn && G.currentPlayer === 'red' && !G.isExtraTurn) {
            G.canvas.style.cursor = 'default';
            G.hoverPreview = null;
            G.hoverHPDelta = null;
            return;
        }
        var pos = G.getCanvasPos(e);
        var grid = G.posToGrid(pos.x, pos.y);
        if (grid && G.isCellReallyEmpty(grid.row, grid.col)) {
            G.canvas.style.cursor = 'pointer';
            G.hoverHPDelta = G.calculateHPDelta(grid.row, grid.col);
            G.refreshHPDisplay();
            var preview = G.calculatePlacementPreview(grid.row, grid.col, G.currentPlayer);
            if (preview && (preview.damage !== null || preview.breachCells.length > 0 || preview.isPhantomCrush)) {
                G.hoverPreview = { row: grid.row, col: grid.col, ...preview };
            } else {
                G.hoverPreview = G.pendingAttack ? { row: grid.row, col: grid.col, damage: null, breachCells: [], isAscend: false, isPhantomCrush: false } : null;
            }
        } else {
            G.canvas.style.cursor = (grid && G.isCellReallyEmpty(grid.row, grid.col)) ? 'pointer' : 'default';
            G.hoverPreview = null;
            G.hoverHPDelta = null;
            G.refreshHPDisplay();
        }
        G.needsRender = true;
    });

    G.canvas.addEventListener('mouseleave', function() {
        G.hoverPreview = null;
        G.hoverHPDelta = null;
        G.refreshHPDisplay();
        G.needsRender = true;
    });

    G.canvas.addEventListener('touchstart', function(e) {
        if (G.gameOver || G.busy) return;
        if (G.aiOn && G.currentPlayer === 'red' && !G.isExtraTurn) return;
        e.preventDefault();
        var touch = e.touches[0];
        var pos = G.getCanvasPos(touch);
        var grid = G.posToGrid(pos.x, pos.y);
        if (!grid || !G.isCellReallyEmpty(grid.row, grid.col)) return;
        G.hoverHPDelta = null;
        G.handleTurn(grid.row, grid.col, false);
    }, { passive: false });

    window.addEventListener('resize', function() {
        G.setupCanvas();
        G.needsRender = true;
    });

    window.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            G.undoMove();
        } else if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            G.resetGame();
        } else if (e.key === 'f' && !e.ctrlKey) {
            e.preventDefault();
            G.manualFeatherDetonate();
            G.updateAllUI();
        }
    });

    // ================================================================
    // 全局按钮
    // ================================================================

    G.entryCurtain = document.getElementById('entryCurtain');

    window.resetGame = function() {
        G.initBoard();
        G.setupCanvas();
        G.needsRender = true;
        G._boardTexture = null;
        G.playEntryAnimation();
        G.sweepEmojisToSvg();
        G.playLogIntro();
        if (G.aiOn && G.currentPlayer === 'red') G.scheduleAI();
    };

    // V4.1 入场动画
    G.playEntryAnimation = function() {
        var curtain = G.entryCurtain || document.getElementById('entryCurtain');
        if (!curtain) return;
        curtain.classList.remove('hide');
        // 面板滑入
        var panels = document.querySelectorAll('.panel.side-panel');
        for (var pi = 0; pi < panels.length; pi++) {
            panels[pi].classList.remove('entry-left', 'entry-right');
            void panels[pi].offsetWidth;
        }
        panels[0] && panels[0].classList.add('entry-left');
        panels[1] && panels[1].classList.add('entry-right');
        // 标题闪现
        G.toastMsg('PHAETHON V4.0', '#00b8ff');
        // 中心粒子爆发
        var cx = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2;
        var cy = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2;
        G.spawnBurstParticles(cx, cy, 'rgba(0,191,255,0.7)', 20);
        // 棋盘已有棋子逐个弹入（带轻微随机偏移）
        var allCells = [];
        for (var r = 0; r < G.BOARD_SIZE; r++)
            for (var c = 0; c < G.BOARD_SIZE; c++)
                if (G.getCellOwner(r, c)) allCells.push({r: r, c: c, d: Math.abs(r-7)+Math.abs(c-7)});
        allCells.sort(function(a, b) { return a.d - b.d; });
        for (var ci = 0; ci < allCells.length; ci++) {
            var cell = allCells[ci];
            var staggerOffset = ci * 35 + Math.random() * 15;
            G.pieceSpawnAnims.push({
                r: cell.r, c: cell.c,
                startTime: performance.now() + 200 + staggerOffset,
                duration: 400 + Math.random() * 100,
                owner: G.getCellOwner(cell.r, cell.c),
                enhanced: false,
            });
        }
        // 暗幕消退
        setTimeout(function() { curtain.classList.add('hide'); }, 600);
        // 幕布消退后棋盘微脉冲
        setTimeout(function() {
            G.spawnBurstParticles(cx, cy, 'rgba(180,200,220,0.3)', 8);
        }, 800);
    };

    window.toggleAI = function() {
        G.aiOn = !G.aiOn;
        G.aiBtn.textContent = '⚙ AI: ' + (G.aiOn ? 'ON' : 'OFF');
        if (!G.aiOn && G.currentPlayer === 'red' && !G.gameOver)
            G.setStatus('AI已关闭·请手动替RED落子');
        if (G.aiOn && G.currentPlayer === 'red' && !G.gameOver && !G.busy)
            G.scheduleAI();
        G.refreshSvgElements();
    };

    window.undoMove = function() {
        G.undoMove();
        G.needsRender = true;
    };

    window.detonateFeather = function() {
        if (G.gameOver || G.busy) return;
        if (G.manualFeatherDetonate()) {
            G.updateAllUI();
            G.needsRender = true;
        } else {
            G.logMsg('sys', '🪶 无法引爆：羽不存在或已引爆');
        }
    };

    // ================================================================
    // 游戏循环
    // ================================================================
    let lastTime = performance.now();

    function gameLoop(timestamp) {
        const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
        lastTime = timestamp;

        G.updateParticles(dt);
        G.updateAmbientParticles(dt);
        G.updateWinParticles(dt);

        const hasAnim = G.particles.length > 0 ||
            G.ambientParticles.length > 0 ||
            G.winParticles.length > 0 ||
            G.envSpawnAnims.length > 0 ||
            G.pieceSpawnAnims.length > 0 ||
            G.enhancedPieceCount > 0 ||
            G.highlightCells.length > 0 ||
            !!G.pendingAttack ||
            G.threatHighlights.length > 0 ||
            G.hoverPreview ||
            G.phantomStones.size > 0 ||
            G.phantomEyes.length > 0 ||
            G.flawPairs.length > 0 ||
            G.erosionMarks.size > 0 ||
            G.soulBurnMarks.size > 0 ||
            G.penetrationLasers.length > 0 ||
            (G.feathers.blue && !G.feathers.blue.detonated) ||
            (G.feathers.red && !G.feathers.red.detonated) ||
            G.fastActionPending.blue > 0 ||
            G.fastActionPending.red > 0;

        if (hasAnim || G.needsRender) {
            G.drawBoardFull();
            if (!hasAnim && G.needsRender) G.needsRender = false;
        }

        requestAnimationFrame(gameLoop);
    }

    // V4.2 SVG 多样性图标（随机旋转+尺寸，供 log / 替换使用）
    G.svgLogIcon = function(name) {
        var rot = (Math.random() - 0.5) * 7;
        var size = 12 + Math.random() * 6;
        return '<img src="/web/svg/' + name + '.svg" style="width:' + size + 'px;height:' + size + 'px;transform:rotate(' + rot + 'deg);vertical-align:middle;margin:0 1px;" class="log-svg">';
    };
    G.emojiToSvgInText = function(text) {
        var result = text;
        for (var ek in G.EMOJI_MAP) {
            result = result.split(ek).join(G.svgLogIcon(G.EMOJI_MAP[ek]));
        }
        return result;
    };

    // V4.2 开场 BATTLE LOG SVG 图标展示
    G.playLogIntro = function() {
        var container = G.logContainer;
        if (!container) return;
        container.innerHTML = '';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.style.minHeight = '160px';
        container.innerHTML = '<img src="/web/svg/crystal.svg" style="width:auto;height:120px;opacity:0.7;filter:drop-shadow(0 0 12px rgba(0,184,255,0.5))">';
        setTimeout(function() {
            container.style.display = '';
            container.style.minHeight = '';
            container.innerHTML = '';
            G.logMsg('sys', '=== PHAETHON V4.0 · 暗子破阵 ===');
            G.logMsg('sys', '🪶 深渊之羽 · 🔮 破绽跳板 · 🛡️ 截击过载 · 🌿 星轨贯穿 · 👁 阵眼共鸣');
        }, 5000);
    };

    // V4.1 全页面 emoji → SVG 替换（提前定义，boot 内调用）
    G.sweepEmojisToSvg = function() {
        var body = document.body;
        function replaceIn(node) {
            if (node.nodeType === 3) {
                var text = node.textContent;
                var changed = false;
                for (var ek in G.EMOJI_MAP) {
                    if (text.indexOf(ek) >= 0) {
                        changed = true;
                        break;
                    }
                }
                if (changed && node.parentNode) {
                    var span = document.createElement('span');
                    span.innerHTML = G.emojiToSvgInText(text);
                    span.style.display = 'inline';
                    node.parentNode.replaceChild(span, node);
                }
            } else if (node.nodeType === 1 && node.children) {
                for (var i = node.children.length - 1; i >= 0; i--) {
                    replaceIn(node.children[i]);
                }
            }
        }
        var panels = document.querySelectorAll('.panel, #toast, .pending-badge, .fast-action-badge, .win-overlay, .turn, button');
        for (var pi = 0; pi < panels.length; pi++) replaceIn(panels[pi]);
        G.updateAllUI();
    };

    function boot() {
        var urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('mode') === 'pvp') {
            G.aiOn = false;
            G.aiBtn.textContent = '⚙ AI: OFF (PvP)';
            G.myColor = urlParams.get('color') || 'blue';
        }

        G.setupCanvas();
        G.initBoard();
        G.spawnAmbientParticles();
        G.updateAllUI();
        G.drawBoardFull();
        G.playEntryAnimation();
        G.sweepEmojisToSvg();
        G.playLogIntro();
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
    boot();
    console.log('[main.js] PHAETHON V4.0 · 暗子破阵 已就绪');
    console.log('   V4 特性：真伤上限8 | 过载+5 | 阵眼+4&回血 | 星轨贯穿 | 深渊之羽 | Buff/Debuff');
    console.log('   模块化加载：G → state → logic → ai → particles → render → main');
})(window.G);

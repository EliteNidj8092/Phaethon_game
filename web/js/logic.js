/**
 * logic.js — PHAETHON V4.0 核心游戏逻辑
 *
 * 职责：
 *   1. 连线检测——4 方向扫描，区分实子/暗子/侵蚀/封印标记
 *   2. 活三检测——3 连 + 两端开放检测 + 破绽端点计算
 *   3. 枪口/枪尾计算——攻击线延长端的截击位置
 *   4. 核心回合处理——12 步结算时序，统一入口
 *   5. V4.0 重写：过载(+5伤害+额外封印)、阵眼(+4伤害+回血+Debuff)
 *   6. 星轨贯穿——射线至边缘、封印上限4、剥夺阵眼
 *   7. 深渊之羽整套系统——召唤/分摊/衰减/快速行动/引爆
 *   8. Buff/Debuff 施加与处理
 *   9. 伤害分摊(羽)、真伤上限(8)
 *  10. 胜负判定
 *
 * 依赖：G.js, state.js, particles.js, main.js（UI函数在运行时调用）
 * 被依赖：ai.js, main.js
 */
(function(G) {

    // V4.1 SVG 事件辅助
    function fireSvg(name, anim) {
        if (G.emitSvgEvent) G.emitSvgEvent(name, anim);
    }

    // ================================================================
    // 连线检测——V4.0 更新：跳过侵蚀印记/封印标记棋子
    // 绝地反击 Buff：可无视 1 个封印棋子
    // ================================================================
    G.detectLines = function(r, c, minLen) {
        const owner = G.getCellOwner(r, c);
        if (!owner) return [];
        const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
        const allLines = [];
        const lastStandActive = G.hasBuff(owner, 'last_stand');
        for (const [dr, dc] of dirs) {
            const cells = [[r, c]];
            let sealedSkipped = 0;
            for (let i = 1; i < G.BOARD_SIZE; i++) {
                const nr = r + dr * i, nc = c + dc * i;
                if (nr < 0 || nr >= G.BOARD_SIZE || nc < 0 || nc >= G.BOARD_SIZE) break;
                if (G.sealMarks.has(G.keyRC(nr, nc))) break;
                if (G.erosionMarks.has(G.keyRC(nr, nc))) break;
                const cellOwner = G.getCellOwner(nr, nc);
                const phantomOwner = G.phantomStones.get(G.keyRC(nr, nc))?.owner;
                // 处理封印棋子：绝地反击可跳过1个
                if (G.sealedStones.has(G.keyRC(nr, nc))) {
                    // 封印棋子的 owner 是否匹配
                    if (cellOwner === owner) {
                        if (lastStandActive && sealedSkipped < G.BUFF_LAST_STAND_SEAL_SKIP) {
                            sealedSkipped++;
                            cells.push([nr, nc]);
                            continue;
                        }
                    }
                    break;
                }
                if (cellOwner === owner || phantomOwner === owner)
                    cells.push([nr, nc]);
                else break;
            }
            for (let i = 1; i < G.BOARD_SIZE; i++) {
                const nr = r - dr * i, nc = c - dc * i;
                if (nr < 0 || nr >= G.BOARD_SIZE || nc < 0 || nc >= G.BOARD_SIZE) break;
                if (G.sealMarks.has(G.keyRC(nr, nc))) break;
                if (G.erosionMarks.has(G.keyRC(nr, nc))) break;
                const cellOwner = G.getCellOwner(nr, nc);
                const phantomOwner = G.phantomStones.get(G.keyRC(nr, nc))?.owner;
                if (G.sealedStones.has(G.keyRC(nr, nc))) {
                    if (cellOwner === owner) {
                        if (lastStandActive && sealedSkipped < G.BUFF_LAST_STAND_SEAL_SKIP) {
                            sealedSkipped++;
                            cells.unshift([nr, nc]);
                            continue;
                        }
                    }
                    break;
                }
                if (cellOwner === owner || phantomOwner === owner)
                    cells.unshift([nr, nc]);
                else break;
            }
            if (cells.length >= minLen) {
                const lineCells = cells.map(([rr, cc]) => ({ r: rr, c: cc }));
                const realCount = lineCells.filter(c => G.getCellOwner(c.r, c.c) === owner && !G.isSealed(c.r, c.c)).length;
                const phantomCount = lineCells.filter(c =>
                    G.phantomStones.has(G.keyRC(c.r, c.c)) &&
                    G.phantomStones.get(G.keyRC(c.r, c.c)).owner === owner
                ).length;
                allLines.push({
                    cells: lineCells, direction: { dr, dc },
                    length: cells.length, realCount, phantomCount
                });
            }
        }
        if (allLines.length <= 1) return allLines;
        return G.mergeLinesRaw(allLines);
    };

    G.mergeLinesRaw = function(lines) {
        const allKeys = new Set();
        const mergedCells = [];
        const allDirs = [];
        let totalReal = 0, totalPhantom = 0;
        for (const line of lines) {
            allDirs.push(line.direction);
            for (const cell of line.cells) {
                const k = G.keyRC(cell.r, cell.c);
                if (!allKeys.has(k)) { allKeys.add(k); mergedCells.push(cell); }
            }
            totalReal += line.realCount || 0;
            totalPhantom += line.phantomCount || 0;
        }
        return [{
            cells: mergedCells, directions: allDirs,
            length: mergedCells.length, realCount: totalReal, phantomCount: totalPhantom
        }];
    };

    // ================================================================
    // 活三检测——V4.0 更新：跳过侵蚀/封印标记/封印棋子
    // ================================================================
    G.isOpenThree = function(r, c, owner) {
        const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
        const results = [];
        for (const [dr, dc] of dirs) {
            const cells = [[r, c]];
            for (let i = 1; i < G.BOARD_SIZE; i++) {
                const nr = r + dr * i, nc = c + dc * i;
                if (nr >= 0 && nr < G.BOARD_SIZE && nc >= 0 && nc < G.BOARD_SIZE &&
                    G.getCellOwner(nr, nc) === owner &&
                    !G.sealedStones.has(G.keyRC(nr, nc)) &&
                    !G.sealMarks.has(G.keyRC(nr, nc)) &&
                    !G.erosionMarks.has(G.keyRC(nr, nc)))
                    cells.push([nr, nc]);
                else break;
            }
            for (let i = 1; i < G.BOARD_SIZE; i++) {
                const nr = r - dr * i, nc = c - dc * i;
                if (nr >= 0 && nr < G.BOARD_SIZE && nc >= 0 && nc < G.BOARD_SIZE &&
                    G.getCellOwner(nr, nc) === owner &&
                    !G.sealedStones.has(G.keyRC(nr, nc)) &&
                    !G.sealMarks.has(G.keyRC(nr, nc)) &&
                    !G.erosionMarks.has(G.keyRC(nr, nc)))
                    cells.unshift([nr, nc]);
                else break;
            }
            if (cells.length === 3) {
                const first = cells[0], last = cells[2];
                const end1r = first[0] - dr, end1c = first[1] - dc;
                const end2r = last[0] + dr, end2c = last[1] + dc;
                const end1Valid = end1r >= 0 && end1r < G.BOARD_SIZE && end1c >= 0 && end1c < G.BOARD_SIZE &&
                    G.isCellReallyEmpty(end1r, end1c) && !G.sealedStones.has(G.keyRC(end1r, end1c));
                const end2Valid = end2r >= 0 && end2r < G.BOARD_SIZE && end2c >= 0 && end2c < G.BOARD_SIZE &&
                    G.isCellReallyEmpty(end2r, end2c) && !G.sealedStones.has(G.keyRC(end2r, end2c));
                if (end1Valid && end2Valid) {
                    results.push({
                        cells: cells.map(([rr, cc]) => ({ r: rr, c: cc })),
                        end1: { r: end1r, c: end1c },
                        end2: { r: end2r, c: end2c },
                        direction: { dr, dc },
                    });
                }
            }
        }
        return results;
    };

    G.detectLinesMinN_static = function(r, c, owner, minN) {
        const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
        const result = [];
        for (const [dr, dc] of dirs) {
            const cells = [[r, c]];
            for (let i = 1; i < G.BOARD_SIZE; i++) {
                const nr = r + dr * i, nc = c + dc * i;
                if (nr >= 0 && nr < G.BOARD_SIZE && nc >= 0 && nc < G.BOARD_SIZE &&
                    G.getCellOwner(nr, nc) === owner &&
                    !G.sealedStones.has(G.keyRC(nr, nc)) &&
                    !G.sealMarks.has(G.keyRC(nr, nc)) &&
                    !G.erosionMarks.has(G.keyRC(nr, nc)))
                    cells.push([nr, nc]);
                else break;
            }
            for (let i = 1; i < G.BOARD_SIZE; i++) {
                const nr = r - dr * i, nc = c - dc * i;
                if (nr >= 0 && nr < G.BOARD_SIZE && nc >= 0 && nc < G.BOARD_SIZE &&
                    G.getCellOwner(nr, nc) === owner &&
                    !G.sealedStones.has(G.keyRC(nr, nc)) &&
                    !G.sealMarks.has(G.keyRC(nr, nc)) &&
                    !G.erosionMarks.has(G.keyRC(nr, nc)))
                    cells.unshift([nr, nc]);
                else break;
            }
            if (cells.length >= minN)
                result.push({ cells, length: cells.length, direction: { dr, dc } });
        }
        return result;
    };

    // ================================================================
    // 枪口/枪尾系统
    // ================================================================
    G.getExtensionCells = function(pendingAtk) {
        if (!pendingAtk || !pendingAtk.cells) return [];
        const cellSet = new Set(pendingAtk.cells.map(c => G.keyRC(c.r, c.c)));
        const extensions = [];
        const dirs = pendingAtk.directions || [];
        for (const dir of dirs) {
            if (!dir) continue;
            const { dr, dc } = dir;
            for (const cell of pendingAtk.cells) {
                const r1 = cell.r + dr, c1 = cell.c + dc;
                if (r1 >= 0 && r1 < G.BOARD_SIZE && c1 >= 0 && c1 < G.BOARD_SIZE &&
                    !cellSet.has(G.keyRC(r1, c1))) extensions.push({ r: r1, c: c1 });
                const r2 = cell.r - dr, c2 = cell.c - dc;
                if (r2 >= 0 && r2 < G.BOARD_SIZE && c2 >= 0 && c2 < G.BOARD_SIZE &&
                    !cellSet.has(G.keyRC(r2, c2))) extensions.push({ r: r2, c: c2 });
            }
        }
        const unique = [], seen = new Set();
        for (const ext of extensions) {
            const k = G.keyRC(ext.r, ext.c);
            if (!seen.has(k)) { seen.add(k); unique.push(ext); }
        }
        return unique;
    };

    G.getGunPoints = function(pendingAtk) {
        if (!pendingAtk || !pendingAtk.cells || pendingAtk.cells.length < G.PHAETHON_MIN) return [];
        const dirs = pendingAtk.directions || [];
        const gunPoints = [];
        const cellSet = new Set(pendingAtk.cells.map(c => G.keyRC(c.r, c.c)));
        for (const dir of dirs) {
            if (!dir) continue;
            const { dr, dc } = dir;
            let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
            for (const cell of pendingAtk.cells) {
                const proj = cell.r * dr + cell.c * dc;
                if (minR === Infinity || proj < minR * dr + minC * dc) { minR = cell.r; minC = cell.c; }
                if (maxR === -Infinity || proj > maxR * dr + maxC * dc) { maxR = cell.r; maxC = cell.c; }
            }
            const gunTailR = minR - dr, gunTailC = minC - dc;
            const gunMuzzleR = maxR + dr, gunMuzzleC = maxC + dc;
            if (gunTailR >= 0 && gunTailR < G.BOARD_SIZE && gunTailC >= 0 && gunTailC < G.BOARD_SIZE &&
                G.isCellReallyEmpty(gunTailR, gunTailC) && !cellSet.has(G.keyRC(gunTailR, gunTailC)))
                gunPoints.push({ r: gunTailR, c: gunTailC, label: '枪尾' });
            if (gunMuzzleR >= 0 && gunMuzzleR < G.BOARD_SIZE && gunMuzzleC >= 0 && gunMuzzleC < G.BOARD_SIZE &&
                G.isCellReallyEmpty(gunMuzzleR, gunMuzzleC) && !cellSet.has(G.keyRC(gunMuzzleR, gunMuzzleC)))
                gunPoints.push({ r: gunMuzzleR, c: gunMuzzleC, label: '枪口' });
        }
        const unique = [], seen = new Set();
        for (const gp of gunPoints) {
            const k = G.keyRC(gp.r, gp.c);
            if (!seen.has(k)) { seen.add(k); unique.push(gp); }
        }
        return unique;
    };

    G.isOnGunPoint = function(r, c, pendingAtk) {
        const gps = G.getGunPoints(pendingAtk);
        return gps.some(g => g.r === r && g.c === c);
    };

    // ================================================================
    // V4.0 核心回合处理——12 步结算时序
    // ================================================================
    G.handleTurn = function(r, c, skipAICheck) {
        if (G.gameOver || G.busy) return;
        G.hoverHPDelta = null;
        if (skipAICheck === undefined) skipAICheck = false;
        if (!skipAICheck && G.aiOn && G.currentPlayer === 'red') return;

        // === Step 1: 落子与基础状态更新 ===
        const hadEnv = G.hasEnv(r, c);
        if (!G.placePiece(r, c)) return;

        if (hadEnv) {
            if (!G.chargingDisabled[G.currentPlayer]) {
                G.playerCharge[G.currentPlayer] = Math.min(G.CHARGE_MAX, G.playerCharge[G.currentPlayer] + 1);
                G.logMsg('sys', '🌿 ' + (G.currentPlayer === 'blue' ? 'BLUE' : 'RED') + ' 灵能充能 (' + G.playerCharge[G.currentPlayer] + '/' + G.CHARGE_MAX + ') 于(' + c + ',' + r + ')');
            } else {
                G.logMsg('sys', '🌀 ' + (G.currentPlayer === 'blue' ? 'BLUE' : 'RED') + ' 灵能紊乱，无法充能');
            }
            if (G.board[r][c] && !G.board[r][c].enhanced) G.board[r][c].enhanced = true;
        }

        G.checkSuffocation();
        G.updatePhantomEyes();

        // 粒子特效
        const canvasPos = G.gridToPos(r, c);
        const pColor = G.currentPlayer === 'blue' ? 'rgb(0,191,255)' : 'rgb(220,53,69)';
        G.spawnRippleParticles(canvasPos.x, canvasPos.y, pColor);
        G.spawnBurstParticles(canvasPos.x, canvasPos.y, pColor, 8);
        G.needsRender = true;

        // === Step 4: 充能 / 星轨贯穿检查 ===
        if (G.playerCharge[G.currentPlayer] >= G.CHARGE_MAX && !G.pendingAttack) {
            G.triggerStarOrbitPenetration(r, c);
            G.playerCharge[G.currentPlayer] = 0;
        }

        // === Step 2+3: 暗子生成/破绽处理 ===
        const lines = G.detectLines(r, c, G.PHAETHON_MIN);
        const hasLine = lines.length > 0;
        const opp = G.currentPlayer === 'blue' ? 'red' : 'blue';

        // 破绽跳板
        if (!hasLine && !G.pendingAttack) {
            const openThrees = G.isOpenThree(r, c, G.currentPlayer);
            if (openThrees.length > 0) {
                for (const ot of openThrees) {
                    const existingFlaw = G.flawPairs.find(fp =>
                        (G.keyRC(fp.end1.r, fp.end1.c) === G.keyRC(ot.end1.r, ot.end1.c) &&
                         G.keyRC(fp.end2.r, fp.end2.c) === G.keyRC(ot.end2.r, ot.end2.c)) ||
                        (G.keyRC(fp.end1.r, fp.end1.c) === G.keyRC(ot.end2.r, ot.end2.c) &&
                         G.keyRC(fp.end2.r, fp.end2.c) === G.keyRC(ot.end1.r, ot.end1.c))
                    );
                    if (!existingFlaw) {
                        G.flawPairs.push({
                            end1: ot.end1, end2: ot.end2, owner: G.currentPlayer, cells: ot.cells,
                        });
                        G.logMsg('breach', '🔮 ' + (G.currentPlayer === 'blue' ? 'BLUE' : 'RED') + ' 活三形成破绽领域于(' + ot.end1.c + ',' + ot.end1.r + ')和(' + ot.end2.c + ',' + ot.end2.r + ')');
                    }
                }
            }
        }

        // 暗子固化 + 羽召唤检查
        if (!hasLine && !G.pendingAttack) {
            const affectedFlaws = G.flawPairs.filter(fp =>
                fp.owner === opp &&
                (G.keyRC(fp.end1.r, fp.end1.c) === G.keyRC(r, c) ||
                 G.keyRC(fp.end2.r, fp.end2.c) === G.keyRC(r, c)));
            for (const af of affectedFlaws) {
                const otherEnd = G.keyRC(af.end1.r, af.end1.c) === G.keyRC(r, c) ? af.end2 : af.end1;
                if (G.isCellReallyEmpty(otherEnd.r, otherEnd.c) &&
                    !G.phantomStones.has(G.keyRC(otherEnd.r, otherEnd.c))) {
                    G.phantomStones.set(G.keyRC(otherEnd.r, otherEnd.c), { owner: af.owner });
                    G.logMsg('phantom', '🔮 破绽固化！暗子生成于(' + otherEnd.c + ',' + otherEnd.r + ')，归属' + (af.owner === 'blue' ? 'BLUE' : 'RED'));
                    G.checkFeatherSummon(af.owner);
                }
                G.flawPairs = G.flawPairs.filter(fp => fp !== af);
            }
        }

        // === Step 5-6: PHAETHON检测与结算 ===
        G.busy = true;

        // V4.0 伤害计算使用新的 calculateV4Damage
        if (hasLine && G.pendingAttack && G.pendingAttack.attacker !== G.currentPlayer) {
            G.resolveClashV4(lines, r, c);
        } else if (hasLine && !G.pendingAttack) {
            G.initiateAttackV4(lines, r, c);
        } else if (!hasLine && G.pendingAttack && G.pendingAttack.attacker !== G.currentPlayer) {
            const isIntercept = G.isOnGunPoint(r, c, G.pendingAttack);
            if (isIntercept) G.resolveInterceptV4(r, c);
            else G.resolveIncomingV4(r, c);
        } else if (hasLine && G.pendingAttack && G.pendingAttack.attacker === G.currentPlayer) {
            G.resolveNormalV4(r, c);
        } else {
            G.resolveNormalV4(r, c);
        }
    };

    // ================================================================
    // V4.0 发起 PHAETHON 攻击
    // ================================================================
    G.initiateAttackV4 = function(lines, r, c) {
        const mainLine = lines[0];
        const target = G.currentPlayer === 'blue' ? 'red' : 'blue';
        const attacker = G.currentPlayer;

        // V4.0 伤害计算
        let power = mainLine.realCount || mainLine.length;
        if (G.isOverloaded[attacker]) {
            power += G.OVERLOAD_DAMAGE_BONUS;
            G.logMsg('warn', '⚡ ' + (attacker === 'blue' ? 'BLUE' : 'RED') + ' 过载！PHAETHON伤害+5');
        }

        const hasEye = G.phantomEyes.some(eye =>
            mainLine.cells.some(c => c.r === eye.row && c.c === eye.col));
        let eyeCount = 0;
        if (hasEye && G.turnCount >= G.PHANTOM_EYE_TURN) {
            eyeCount = G.phantomEyes.filter(eye =>
                mainLine.cells.some(c => c.r === eye.row && c.c === eye.col)
            ).length;
            power += G.EYE_DAMAGE_BONUS;
            G.playerHP[attacker] = Math.min(G.MAX_HP, G.playerHP[attacker] + G.EYE_HP_HEAL);
            G.logMsg('breach', '👁 阵眼共鸣！伤害+4，回复' + G.EYE_HP_HEAL + 'HP');
        }

        // 锐利 Buff
        if (G.hasBuff(attacker, 'sharp')) {
            for (var i = 0; i < G.playerBuffs[attacker].length; i++) {
                if (G.playerBuffs[attacker][i].type === 'sharp') {
                    var sharpBonus = G.BUFF_SHARP_DAMAGE * G.playerBuffs[attacker][i].stacks;
                    power += sharpBonus;
                    G.logMsg('sys', '🗡️ 锐利Buff生效！伤害+' + sharpBonus);
                    break;
                }
            }
        }

        // 灵能共鸣
        if (G.hasBuff(attacker, 'resonance')) {
            power += G.BUFF_RESONANCE_DAMAGE;
            G.logMsg('sys', '🎵 灵能共鸣！伤害+' + G.BUFF_RESONANCE_DAMAGE);
        }

        // Debuff 修正
        if (G.hasDebuff(attacker, 'weakness')) power -= G.DEBUFF_DEFS.weakness.ascPenalty;
        if (G.hasDebuff(attacker, 'intercept_weakness')) power -= G.DEBUFF_INTERCEPT_WEAKNESS;
        // 深渊共鸣（羽不在时）
        if (G.hasDebuff(attacker, 'abyss_resonance')) {
            var oppFeather = G.feathers[attacker === 'blue' ? 'red' : 'blue'];
            if (!oppFeather || oppFeather.detonated) power -= 2;
        }
        if (power < 0) power = 0;

        // 构建 pending
        G.pendingAttack = {
            attacker: attacker, target,
            cells: mainLine.cells.map(c => ({ r: c.r, c: c.c })), power,
            directions: mainLine.directions || [mainLine.direction],
            realCount: mainLine.realCount || mainLine.length,
            phantomCount: mainLine.phantomCount || 0, hasEye, eyeCount,
            overloaded: G.isOverloaded[attacker],
            mainLineRef: mainLine,
        };

        const who = attacker === 'blue' ? 'BLUE' : 'RED';
        G.logMsg('sys', '⚡ ' + who + ' PHAETHON! 攻击力 ' + power + ' (实子' + G.pendingAttack.realCount + ' 暗子' + G.pendingAttack.phantomCount + ')');
        G.logMsg('sys', '⚠ 对手可在枪口/枪尾截击！');
        G.highlightAttackCells(mainLine.cells);
        G.pendingBadge.style.display = 'block';
        G.spawnAttackParticles(mainLine.cells, attacker);
        G.needsRender = true;

        // 消耗锐利 Buff
        if (G.hasBuff(attacker, 'sharp')) G.consumeBuff(attacker, 'sharp');
        // 消耗灵能共鸣
        if (G.hasBuff(attacker, 'resonance')) G.consumeBuff(attacker, 'resonance');
        // 消耗虚弱
        G.removeDebuff(attacker, 'weakness');
        // 消耗截击虚弱
        G.removeDebuff(attacker, 'intercept_weakness');

        // 消耗过载
        if (G.isOverloaded[attacker]) {
            G.isOverloaded[attacker] = false;
            G.counterStreak[attacker] = 0;
        }

        setTimeout(() => {
            G.clearHighlights();
            G.switchTurn();
            G.busy = false;
            G.updateAllUI();
            if (G.aiOn && G.currentPlayer === 'red') G.scheduleAI();
        }, 600);
    };

    // ================================================================
    // 过载额外封印
    // ================================================================
    G.applyOverloadExtraSeal = function(mainLine, attacker, target) {
        const nonEye = [], isEye = [];
        for (const cell of mainLine.cells) {
            const owner = G.getCellOwner(cell.r, cell.c);
            if (owner !== target) continue;
            if (G.phantomStones.has(G.keyRC(cell.r, cell.c))) continue;
            if (G.sealedStones.has(G.keyRC(cell.r, cell.c))) continue;
            var isPhEye = G.phantomEyes.some(function(e) { return e.row === cell.r && e.col === cell.c; });
            if (isPhEye) isEye.push(cell);
            else nonEye.push(cell);
        }
        const pool = nonEye.length > 0 ? nonEye : isEye;
        if (pool.length > 0) {
            const targetCell = pool[Math.floor(Math.random() * pool.length)];
            G.sealedStones.add(G.keyRC(targetCell.r, targetCell.c));
            G.logMsg('warn', '⚡ 过载副效果：额外封印敌子(' + targetCell.c + ',' + targetCell.r + ')');
            G.shockwaveEffectAt(G.gridToPos(targetCell.r, targetCell.c).x, G.gridToPos(targetCell.r, targetCell.c).y);
        }
    };

    /** 从 pendingAttack 执行过载额外封印 */
    G.applyOverloadExtraSealFromPending = function() {
        if (!G.pendingAttack || !G.pendingAttack.cells) return;
        var attacker = G.pendingAttack.attacker;
        var target = G.pendingAttack.target;
        var cells = G.pendingAttack.cells;
        var nonEye = [], isEye = [];
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            var owner = G.getCellOwner(cell.r, cell.c);
            if (owner !== target) continue;
            if (G.phantomStones.has(G.keyRC(cell.r, cell.c))) continue;
            if (G.sealedStones.has(G.keyRC(cell.r, cell.c))) continue;
            var isPhEye = G.phantomEyes.some(function(e) { return e.row === cell.r && e.col === cell.c; });
            if (isPhEye) isEye.push(cell);
            else nonEye.push(cell);
        }
        var pool = nonEye.length > 0 ? nonEye : isEye;
        if (pool.length > 0) {
            var targetCell = pool[Math.floor(Math.random() * pool.length)];
            G.sealedStones.add(G.keyRC(targetCell.r, targetCell.c));
            G.logMsg('warn', '⚡ 过载副效果：额外封印敌子(' + targetCell.c + ',' + targetCell.r + ')');
            G.shockwaveEffectAt(G.gridToPos(targetCell.r, targetCell.c).x, G.gridToPos(targetCell.r, targetCell.c).y);
        }
    };

    // ================================================================
    // V4.0 截击结算——新增虚弱 Debuff
    // ================================================================
    G.resolveInterceptV4 = function(r, c) {
        const defender = G.currentPlayer;
        const attacker = G.pendingAttack.attacker;
        const defName = defender === 'blue' ? 'BLUE' : 'RED';
        G.counterStreak[defender]++;

        const gunPoints = G.getGunPoints(G.pendingAttack);
        const hitCount = gunPoints.filter(g => g.r === r && g.c === c).length;
        if (hitCount >= 2) {
            G.logMsg('sys', '🎯 一子双截！' + defName + ' 同时截击两条PHAETHON线！');
            fireSvg('crosshair', 'target');
            G.counterStreak[defender]++;
        }

        // 封印攻击线上的敌方实子
        if (G.pendingAttack.cells) {
            var sealedCount = 0;
            for (const cell of G.pendingAttack.cells) {
                if (G.getCellOwner(cell.r, cell.c) === attacker &&
                    !G.phantomStones.has(G.keyRC(cell.r, cell.c))) {
                    G.sealedStones.add(G.keyRC(cell.r, cell.c));
                    sealedCount++;
                }
            }
            G.logMsg('sys', '🛡️ ' + defName + ' 截击成功！伤害归零，封印' + sealedCount + '颗敌子');
            G.toastMsg('INTERCEPT!', '#9cff7a');
        }

        // V4.0 新增：截击成功后对攻击方施加虚弱 Debuff
        G.addDebuff(attacker, 'intercept_weakness', 999, null);
        G.logMsg('warn', '⚠ ' + (attacker === 'blue' ? 'BLUE' : 'RED') + ' 被截击虚弱！下次PHAETHON伤害-3');

        // 过载检查
        if (G.counterStreak[defender] >= G.OVERLOAD_THRESHOLD && !G.isOverloaded[defender]) {
            G.isOverloaded[defender] = true;
            G.addBuff(defender, 'sharp', 1, -1);
            G.logMsg('warn', '⚡ ' + defName + ' 进入过载！获锐利Buff(+' + G.BUFF_SHARP_DAMAGE + '伤害)');
        }

        G.pendingAttack = null;
        G.pendingBadge.style.display = 'none';
        G.clearHighlights();
        G.spawnEnvElements(G.ENV_SPAWN_COUNT);
        G.needsRender = true;
        if (G.checkWin()) { G.busy = false; return; }
        setTimeout(() => {
            G.switchTurn();
            G.busy = false;
            G.updateAllUI();
            if (G.aiOn && G.currentPlayer === 'red') G.scheduleAI();
        }, 500);
    };

    // ================================================================
    // V4.0 对冲结算——含羽伤害分摊
    // ================================================================
    G.resolveClashV4 = function(lines, r, c) {
        const mainLine = lines[0];
        const myPower = G.calculateV4Damage(mainLine, G.currentPlayer, r, c, false);
        const theirPower = G.pendingAttack.power;
        const myName = G.currentPlayer === 'blue' ? 'BLUE' : 'RED';
        const theirName = G.currentPlayer === 'blue' ? 'RED' : 'BLUE';

        // 枪口优先
        const isIntercept = G.isOnGunPoint(r, c, G.pendingAttack);
        if (isIntercept) {
            G.resolveInterceptV4(r, c);
            const myCells = mainLine.cells.map(c => ({ r: c.r, c: c.c }));
            G.removePieces(myCells);
            return;
        }

        const victimBlue = { amount: 0, player: null };
        const victimRed = { amount: 0, player: null };

        if (myPower > theirPower) {
            const diff = myPower - theirPower;
            victimRed.amount = diff;
            victimRed.player = G.pendingAttack.attacker;
            G.logMsg('sys', '💥 对冲！' + myName + '更强，' + theirName + '受到' + diff + '伤害');
        } else if (theirPower > myPower) {
            const diff = theirPower - myPower;
            if (G.currentPlayer === 'blue') victimBlue.amount = diff;
            else victimRed.amount = diff;
            G.logMsg('sys', '💥 对冲！' + theirName + '更强，' + myName + '受到' + diff + '伤害');
        } else {
            G.logMsg('sys', '💥 完美对冲！双方攻击抵消');
        }

        // 伤害分摊（羽）
        if (victimBlue.amount > 0) {
            var finalDmgB = G.applyFeatherDamageShare('blue', victimBlue.amount);
            G.playerHP.blue = Math.max(0, G.playerHP.blue - finalDmgB);
            G.lastDeathCause = { victim: 'blue', cause: 'clash', damage: finalDmgB, attacker: G.pendingAttack.attacker };
            G.spawnDamagePopup('blue', finalDmgB);
            G.triggerScreenFlash('blue');
        }
        if (victimRed.amount > 0) {
            var finalDmgR = G.applyFeatherDamageShare('red', victimRed.amount);
            G.playerHP.red = Math.max(0, G.playerHP.red - finalDmgR);
            G.lastDeathCause = { victim: 'red', cause: 'clash', damage: finalDmgR, attacker: G.pendingAttack.attacker };
            G.spawnDamagePopup('red', finalDmgR);
            G.triggerScreenFlash('red');
        }

        // 过载额外封印（攻击已生效）
        if (G.pendingAttack.overloaded) {
            G.applyOverloadExtraSealFromPending();
        }

        const theirCells = G.pendingAttack.cells.map(c => ({ r: c.r, c: c.c }));
        const myCells = mainLine.cells.map(c => ({ r: c.r, c: c.c }));
        G.removePieces(theirCells);
        G.removePieces(myCells);
        G.pendingAttack = null;
        G.pendingBadge.style.display = 'none';
        G.clearHighlights();
        G.spawnEnvElements(G.ENV_SPAWN_COUNT);
        G.shockwaveEffect();
        G.needsRender = true;
        if (G.checkWin()) { G.busy = false; return; }
        setTimeout(() => {
            G.switchTurn();
            G.busy = false;
            G.updateAllUI();
            if (G.aiOn && G.currentPlayer === 'red') G.scheduleAI();
        }, 500);
    };

    // ================================================================
    // V4.0 硬吃伤害——含羽伤害分摊
    // ================================================================
    G.resolveIncomingV4 = function(r, c) {
        const power = G.pendingAttack.power;
        const defender = G.currentPlayer;
        const who = defender === 'blue' ? 'BLUE' : 'RED';

        // 羽伤害分摊
        const finalDamage = G.applyFeatherDamageShare(defender, power);
        G.playerHP[defender] = Math.max(0, G.playerHP[defender] - finalDamage);

        const cause = power === G.TRUE_DMG_CAP ? 'phaethon_eye'
            : G.pendingAttack.overloaded ? 'phaethon_overload' : 'phaethon';
        G.lastDeathCause = { victim: defender, cause, damage: finalDamage, attacker: G.pendingAttack.attacker };
        G.logMsg('sys', '💔 ' + who + '未能回应！承受' + finalDamage + '伤害');

        G.counterStreak[defender] = 0;
        G.isOverloaded[defender] = false;

        // 缺氧惩罚（绝杀防守豁免）
        var lethalDefenders = G.getLethalPoints(defender);
        var isDefendingLethal = lethalDefenders.some(function(lp) { return lp.r === r && lp.c === c; });

        if (G.isSuffocating && !isDefendingLethal) {
            const lines3 = G.detectLines(r, c, G.THREE_LINE_MIN);
            const lines4 = G.detectLines(r, c, G.PHAETHON_MIN);
            if (lines3.length === 0 && lines4.length === 0) {
                var hypoxiaDmg = Math.min(1, G.TRUE_DMG_CAP);
                G.playerHP[defender] = Math.max(0, G.playerHP[defender] - hypoxiaDmg);
                G.lastDeathCause = { victim: defender, cause: 'hypoxia', damage: 1, note: 'stacked_on_hit' };
                G.logMsg('warn', '❌ ' + who + '无效落子，缺氧惩罚：-1HP');
            }
        }

        G.toastMsg('HIT!', '#ff3b5c');

        // 过载额外封印（攻击已生效）
        if (G.pendingAttack.overloaded) {
            G.applyOverloadExtraSealFromPending();
        }

        const theirCells = G.pendingAttack.cells.map(c => ({ r: c.r, c: c.c }));
        G.removePieces(theirCells);

        // V4.0 阵眼：施加 Debuff
        if (G.pendingAttack.eyeCount >= 1) {
            G.applyEyeDebuffs(defender, G.pendingAttack.attacker, G.pendingAttack.eyeCount);
        }

        G.spawnDamagePopup(defender, finalDamage);
        G.triggerScreenFlash(defender);
        G.pendingAttack = null;
        G.pendingBadge.style.display = 'none';
        G.clearHighlights();
        G.spawnEnvElements(G.ENV_SPAWN_COUNT);
        G.shockwaveEffect();
        G.needsRender = true;

        // Step 8: Buff/Debuff 过期检查
        G.removeExpiredBuffs(defender);
        G.removeExpiredDebuffs(defender);

        // Step 10: 阵眼递补
        G.refillEyes();

        if (G.checkWin()) { G.busy = false; return; }
        setTimeout(() => {
            G.switchTurn();
            G.busy = false;
            G.updateAllUI();
            if (G.aiOn && G.currentPlayer === 'red') G.scheduleAI();
        }, 500);
    };

    // ================================================================
    // V4.0 普通落子——缺氧豁免
    // ================================================================
    G.resolveNormalV4 = function(r, c) {
        const who = G.currentPlayer === 'blue' ? 'BLUE' : 'RED';
        const defender = G.currentPlayer;

        var lethalDefenders = G.getLethalPoints(defender);
        var isDefendingLethal = lethalDefenders.some(function(lp) { return lp.r === r && lp.c === c; });

        if (G.isSuffocating && !G.pendingAttack && !isDefendingLethal) {
            const lines3 = G.detectLines(r, c, G.THREE_LINE_MIN);
            const lines4 = G.detectLines(r, c, G.PHAETHON_MIN);
            if (lines3.length === 0 && lines4.length === 0) {
                var hypoxiaDmg = Math.min(1, G.TRUE_DMG_CAP);
                G.playerHP[G.currentPlayer] = Math.max(0, G.playerHP[G.currentPlayer] - hypoxiaDmg);
                G.lastDeathCause = { victim: G.currentPlayer, cause: 'hypoxia', damage: 1, note: 'standalone' };
                G.logMsg('warn', '❌ ' + who + '无效落子，缺氧惩罚：-1HP');
                G.spawnDamagePopup(G.currentPlayer, 1);
                G.triggerScreenFlash(G.currentPlayer);
            }
        }

        G.pendingAttack = null;
        G.pendingBadge.style.display = 'none';
        G.clearHighlights();
        G.needsRender = true;

        // Step 8: Buff/Debuff 过期检查
        G.removeExpiredBuffs(G.currentPlayer);
        G.removeExpiredDebuffs(G.currentPlayer);

        // Step 10: 阵眼递补
        G.refillEyes();

        if (G.checkWin()) { G.busy = false; return; }
        setTimeout(() => {
            G.switchTurn();
            G.busy = false;
            G.updateAllUI();
            if (G.aiOn && G.currentPlayer === 'red') G.scheduleAI();
        }, 300);
    };

    // ================================================================
    // V4.0 星轨贯穿——射线至边缘、上限4、剥夺阵眼
    // ================================================================
    G.triggerStarOrbitPenetration = function(r, c) {
        const who = G.currentPlayer === 'blue' ? 'BLUE' : 'RED';
        const opp = G.currentPlayer === 'blue' ? 'red' : 'blue';
        G.logMsg('sys', '🌿 ' + who + '触发星轨贯穿！消耗3层充能');
        G.toastMsg('CROSS SEAL!', '#9cff7a');

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // 上 下 左 右
        let allEnemyStones = [];
        let eyesToDeprive = [];
        let totalEnemyCount = 0;

        for (const [dr, dc] of dirs) {
            for (let i = 1; ; i++) {
                const nr = r + dr * i, nc = c + dc * i;
                if (nr < 0 || nr >= G.BOARD_SIZE || nc < 0 || nc >= G.BOARD_SIZE) break;
                const k = G.keyRC(nr, nc);
                if (G.phantomStones.has(k)) continue; // 暗子穿透
                const owner = G.getCellOwner(nr, nc);
                if (owner && owner !== G.currentPlayer && !G.sealedStones.has(k)) {
                    const dist = i;
                    allEnemyStones.push({ r: nr, c: nc, dist: dist, owner: owner });
                    totalEnemyCount++;
                    // 检查阵眼
                    var isPhEye = G.phantomEyes.some(function(e) { return e.row === nr && e.col === nc; });
                    if (isPhEye) eyesToDeprive.push({ r: nr, c: nc, dist: dist });
                }
            }
        }

        // 按距离排序
        allEnemyStones.sort(function(a, b) { return a.dist - b.dist; });

        // 封印前4颗
        let sealedCountLocal = 0;
        for (let i = 0; i < allEnemyStones.length; i++) {
            const stone = allEnemyStones[i];
            if (sealedCountLocal < G.CROSS_SEAL_CAP) {
                G.sealedStones.add(G.keyRC(stone.r, stone.c));
                sealedCountLocal++;
            } else {
                // 超出上限，施加封印标记
                G.sealMarks.set(G.keyRC(stone.r, stone.c), { turnsLeft: G.DEBUFF_SEAL_MARK_TURNS });
                G.logMsg('warn', '🏷️ 封印标记施加于(' + stone.c + ',' + stone.r + ')——下回合无法连线');
            }
        }

        // 剥夺阵眼
        for (const eye of eyesToDeprive) {
            G.phantomEyes = G.phantomEyes.filter(function(e) { return !(e.row === eye.r && e.col === eye.c); });
            G.logMsg('breach', '⚡ 星轨贯穿剥夺敌方阵眼于(' + eye.c + ',' + eye.r + ')');
        }
        G.refillEyes();

        if (sealedCountLocal > 0) G.logMsg('sys', '🔒 星轨贯穿封印了' + sealedCountLocal + '个敌方棋子');
        else if (allEnemyStones.length === 0) G.logMsg('sys', '🌿 星轨贯穿未命中任何敌方棋子（充能已消耗）');

        // 灵能共鸣 Buff
        if (totalEnemyCount >= 3) {
            G.addBuff(G.currentPlayer, 'resonance', 1, -1);
            G.logMsg('sys', '🎵 灵能共鸣！星轨贯穿命中' + totalEnemyCount + '敌，下次连线伤害+2');
        }

        // 激光残留
        G.penetrationLasers.push({
            r: r, c: c,
            startTime: performance.now(),
            duration: 800,
        });
        // 穿透激光粒子
        var penDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (var pi = 0; pi < penDirs.length; pi++) {
            G.spawnPenetrationBoltParticles(r, c, penDirs[pi][0], penDirs[pi][1]);
        }

        G.shockwaveEffectAt(G.gridToPos(r, c).x, G.gridToPos(r, c).y);
        G.needsRender = true;
    };

    // ================================================================
    // V4.0 阵眼 Debuff 施加
    // ================================================================
    G.applyEyeDebuffs = function(victim, attacker, eyeCount) {
        // 随机1个Debuff施加给 victim
        var debuffType = G.DEBUFF_POOL[Math.floor(Math.random() * G.DEBUFF_POOL.length)];
        var debuffDef = G.DEBUFF_DEFS[debuffType];
        G.addDebuff(victim, debuffType, debuffDef.turns, null);
        G.logMsg('breach', '👁 阵眼施加「' + debuffDef.label + '」给' + (victim === 'blue' ? 'BLUE' : 'RED') + '！' + debuffDef.desc);

        // 特殊处理
        if (debuffType === 'chaos') G.chargingDisabled[victim] = true;
        if (debuffType === 'time_reversal') G.turnCountPaused[victim] = true;

        // ≥2颗阵眼：额外施加侵蚀印记
        if (eyeCount >= 2) {
            // 随机选受害者1颗非暗子/非封印的实子
            var candidates = [];
            for (var r = 0; r < G.BOARD_SIZE; r++) {
                for (var c2 = 0; c2 < G.BOARD_SIZE; c2++) {
                    if (G.getCellOwner(r, c2) === victim &&
                        !G.phantomStones.has(G.keyRC(r, c2)) &&
                        !G.sealedStones.has(G.keyRC(r, c2)) &&
                        !G.erosionMarks.has(G.keyRC(r, c2))) {
                        candidates.push({ r: r, c: c2 });
                    }
                }
            }
            if (candidates.length > 0) {
                var target = candidates[Math.floor(Math.random() * candidates.length)];
                G.erosionMarks.set(G.keyRC(target.r, target.c), { owner: victim, turnsLeft: G.DEBUFF_EROSION_TURNS });
                G.logMsg('warn', '🗿 侵蚀印记施加于(' + target.c + ',' + target.r + ')！该棋子3回合无法连线且每回合-1HP');
                fireSvg('erosion', 'crack');
            }
        }
    };

    // ================================================================
    // 深渊之羽——召唤检查
    // ================================================================
    G.checkFeatherSummon = function(player) {
        if (G.turnCount < G.PHANTOM_EYE_TURN) return; // 40回合后解锁
        // 计算我方暗子数量
        var myPhantomCount = 0;
        var myPhantoms = [];
        G.phantomStones.forEach(function(value, key) {
            if (value.owner === player) { myPhantomCount++; myPhantoms.push(key); }
        });
        if (myPhantomCount < G.FEATHER_SUMMON_MIN_PHANTOMS) return;

        // 满足条件：消耗所有我方暗子
        for (var k of myPhantoms) G.phantomStones.delete(k);

        // 计算 aty
        var aty = 0;
        for (var phantomKey of myPhantoms) {
            var parts = phantomKey.split(',').map(Number);
            var pr = parts[0], pc = parts[1];
            var adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (var i = 0; i < adj.length; i++) {
                var ar = pr + adj[i][0], ac = pc + adj[i][1];
                if (ar >= 0 && ar < G.BOARD_SIZE && ac >= 0 && ac < G.BOARD_SIZE) {
                    var aOwner = G.getCellOwner(ar, ac);
                    if (aOwner && aOwner !== player && !G.phantomStones.has(G.keyRC(ar, ac)) && !G.sealedStones.has(G.keyRC(ar, ac))) {
                        aty += G.FEATHER_ATY_PER_ENEMY;
                    }
                }
            }
        }

        // 召唤位置：(7,7)或最近空位
        var summonR = 7, summonC = 7;
        if (!G.isCellReallyEmpty(7, 7)) {
            var minDist = Infinity;
            for (var rs = 6; rs <= 8; rs++) {
                for (var cs = 6; cs <= 8; cs++) {
                    if (G.isCellReallyEmpty(rs, cs)) {
                        var d = Math.abs(rs - 7) + Math.abs(cs - 7);
                        if (d < minDist) { minDist = d; summonR = rs; summonC = cs; }
                    }
                }
            }
        }

        var bonusHP = Math.floor(aty * G.FEATHER_ATY_HP_RATIO);
        var totalHP = G.FEATHER_BASE_HP + bonusHP;

        G.feathers[player] = {
            hp: totalHP,
            maxHp: totalHP,
            aty: aty,
            fastActionCount: 0,
            totalDeflect: 0,
            detonated: false,
            row: summonR,
            col: summonC,
        };

        var playerName = player === 'blue' ? 'BLUE' : 'RED';
        G.logMsg('breach', '🪶 ' + playerName + ' 召唤深渊之羽！(HP:' + totalHP + ' aty:' + aty + ') 于(' + summonC + ',' + summonR + ')');
        G.toastMsg('FEATHER!', player === 'blue' ? '#5ce0ff' : '#ff6050');
        fireSvg('feather-icon', 'float');
        G.spawnFeatherSummonParticles(G.gridToPos(summonR, summonC).x, G.gridToPos(summonR, summonC).y, player);
    };

    // ================================================================
    // 深渊之羽——伤害分摊
    // ================================================================
    G.applyFeatherDamageShare = function(defender, rawDamage) {
        var feather = G.feathers[defender];
        if (!feather || feather.detonated) return rawDamage;

        var featherShare = rawDamage * G.FEATHER_DAMAGE_SHARE_FEATHER;
        var featherAbsorb = Math.min(featherShare, feather.hp);
        var deficit = featherShare - featherAbsorb;
        var playerTakes = rawDamage * G.FEATHER_DAMAGE_SHARE_SELF + deficit;

        // 深渊庇护 Buff
        if (G.hasBuff(defender, 'shelter')) {
            playerTakes = Math.max(0, playerTakes - G.BUFF_SHELTER_REDUCTION);
        }

        feather.hp -= featherAbsorb;
        feather.totalDeflect += featherAbsorb;

        // 检查快速行动
        while (feather.totalDeflect >= G.FEATHER_FAST_ACTION_THRESHOLD && feather.fastActionCount < G.FEATHER_MAX_FAST_ACTIONS) {
            feather.totalDeflect -= G.FEATHER_FAST_ACTION_THRESHOLD;
            feather.fastActionCount++;
            G.fastActionPending[defender]++;
            G.logMsg('sys', '⚡ 深渊之羽积累抵消达10点！获得快速行动(' + feather.fastActionCount + '/' + G.FEATHER_MAX_FAST_ACTIONS + ')');
            G.toastMsg('FAST ACTION!', '#ffcc00');
        }

        if (feather.hp <= 0) {
            G.featherDetonate(defender, true);
        }

        return playerTakes;
    };

    // ================================================================
    // 深渊之羽——衰减检查（回合开始时调用）
    // ================================================================
    G.featherDecayCheck = function(player) {
        var feather = G.feathers[player];
        if (!feather || feather.detonated) return;

        // 添加深渊庇护 Buff
        G.addBuff(player, 'shelter', 1, -1);

        feather.hp -= G.FEATHER_HP_DECAY;
        G.logMsg('phantom', '🪶 羽衰减-5HP (' + feather.hp + '/' + feather.maxHp + ')');

        if (feather.hp <= 0) {
            G.featherDetonate(player, true);
        }
    };

    // ================================================================
    // 深渊之羽——引爆（主动或被动）
    // ================================================================
    G.featherDetonate = function(player, isPassive) {
        var feather = G.feathers[player];
        if (!feather || feather.detonated) return;
        feather.detonated = true;

        var playerName = player === 'blue' ? 'BLUE' : 'RED';
        var modeText = isPassive ? '被动衰减' : '主动';
        G.logMsg('breach', '🪶💥 深渊之羽引爆！(' + modeText + ') ' + playerName);
        fireSvg('feather-icon', 'shatter');
        fireSvg('explosion', 'detonate');

        // 收集全场敌方实子
        var opp = player === 'blue' ? 'red' : 'blue';
        var enemyStones = [];
        for (var r = 0; r < G.BOARD_SIZE; r++) {
            for (var c = 0; c < G.BOARD_SIZE; c++) {
                if (G.getCellOwner(r, c) === opp &&
                    !G.phantomStones.has(G.keyRC(r, c)) &&
                    !G.sealedStones.has(G.keyRC(r, c))) {
                    enemyStones.push({ r: r, c: c });
                }
            }
        }

        var count = Math.min(enemyStones.length, G.FEATHER_DETONATE_MIN + Math.floor(Math.random() * (G.FEATHER_DETONATE_MAX - G.FEATHER_DETONATE_MIN + 1)));
        G.shuffleArr(enemyStones);
        var targets = enemyStones.slice(0, count);

        var converted = 0, petrified = 0;
        var affectedCells = [];
        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            var k = G.keyRC(t.r, t.c);
            if (Math.random() < G.FEATHER_DETONATE_CONVERT_CHANCE) {
                // 转化：变为我方棋子
                var wasEnhanced = G.board[t.r][t.c] && G.board[t.r][t.c].enhanced;
                G.board[t.r][t.c] = { owner: player, enhanced: wasEnhanced || false };

                // 如果是阵眼，剥夺
                G.phantomEyes = G.phantomEyes.filter(function(e) { return !(e.row === t.r && e.col === t.c); });
                G.refillEyes();

                converted++;
                affectedCells.push(t);
            } else {
                // 石化封印
                G.sealedStones.add(k);
                petrified++;
                affectedCells.push(t);
            }
        }

        G.logMsg('breach', '🪶💥 引爆结果：转化' + converted + '颗 | 石化封印' + petrified + '颗');

        // 对受影响棋子相邻敌方棋子施加灼魂 Debuff
        var soulBurned = new Set();
        for (var j = 0; j < affectedCells.length; j++) {
            var ac = affectedCells[j];
            var adjs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (var ai = 0; ai < adjs.length; ai++) {
                var sr = ac.r + adjs[ai][0], sc = ac.c + adjs[ai][1];
                if (sr >= 0 && sr < G.BOARD_SIZE && sc >= 0 && sc < G.BOARD_SIZE) {
                    var sk = G.keyRC(sr, sc);
                    if (G.getCellOwner(sr, sc) === opp && !soulBurned.has(sk) &&
                        !G.phantomStones.has(sk) && !G.sealedStones.has(sk) && !G.erosionMarks.has(sk)) {
                        G.soulBurnMarks.set(sk, { turnsLeft: G.DEBUFF_SOUL_BURN_TURNS });
                        soulBurned.add(sk);
                    }
                }
            }
        }
        if (soulBurned.size > 0) G.logMsg('warn', '🔥 灼魂Debuff施加给' + soulBurned.size + '颗相邻敌子（连线伤害-2）');

        // 引爆特效
        var fPos = G.gridToPos(feather.row, feather.col);
        G.spawnFeatherDetonationParticles(fPos.x, fPos.y, player);

        // 移除深渊庇护，但不移除 feather 对象（标记 detonated）
        for (var bi = 0; bi < G.playerBuffs[player].length; bi++) {
            if (G.playerBuffs[player][bi].type === 'shelter') {
                G.playerBuffs[player].splice(bi, 1);
                break;
            }
        }

        G.needsRender = true;
    };

    // ================================================================
    // 主动引爆接口
    // ================================================================
    G.manualFeatherDetonate = function() {
        var player = G.currentPlayer;
        var f = G.feathers[player];
        if (!f || f.detonated || G.gameOver || G.busy) return false;
        G.featherDetonate(player, false);
        G.updateAllUI();
        return true;
    };

    // ================================================================
    // 获取绝杀点列表
    // ================================================================
    G.getLethalPoints = function(defender) {
        var attacker = defender === 'blue' ? 'red' : 'blue';
        var defHP = G.playerHP[defender];
        var points = [];
        for (var r = 0; r < G.BOARD_SIZE; r++) {
            for (var c = 0; c < G.BOARD_SIZE; c++) {
                if (!G.isCellReallyEmpty(r, c)) continue;
                if (G.phantomStones.has(G.keyRC(r, c))) continue;
                G.board[r][c] = { owner: attacker, enhanced: G.hasEnv(r, c) };
                var lines4 = G.detectLines(r, c, G.PHAETHON_MIN);
                G.board[r][c] = null;
                if (lines4.length === 0) continue;
                var power = G.calculateV4Damage(lines4[0], attacker, r, c, false);
                if (power >= defHP && !G.isSealed(r, c)) {
                    points.push({ r: r, c: c, power: power });
                }
            }
        }
        return points;
    };

    // ================================================================
    // 辅助函数
    // ================================================================
    G.removePieces = function(cells) {
        for (const cell of cells) {
            if (cell.r >= 0 && cell.r < G.BOARD_SIZE && cell.c >= 0 && cell.c < G.BOARD_SIZE) {
                if (!G.phantomStones.has(G.keyRC(cell.r, cell.c))) {
                    G.board[cell.r][cell.c] = null;
                }
            }
        }
    };

    G.spawnEnvElements = function(count) {
        const emptyCells = [];
        for (let r = 0; r < G.BOARD_SIZE; r++)
            for (let c = 0; c < G.BOARD_SIZE; c++)
                if (G.isCellReallyEmpty(r, c) && !G.hasEnv(r, c) &&
                    !G.phantomStones.has(G.keyRC(r, c)))
                    emptyCells.push({ r, c });
        G.shuffleArr(emptyCells);
        let spawned = 0;
        const spawnedList = [];
        for (const cell of emptyCells) {
            if (spawned >= count) break;
            if (G.envCells.size >= G.ENV_MAX) break;
            G.envCells.add(G.keyRC(cell.r, cell.c));
            spawnedList.push(cell);
            spawned++;
        }
        if (spawned > 0) {
            for (const cell of spawnedList)
                G.logMsg('sys', '🌿 环境元素生长于(' + cell.c + ',' + cell.r + ')');
            G.addEnvSpawnAnim(spawnedList);
        }
    };

    // ================================================================
    // 回合切换——V4.0 含快速行动/时间回溯处理
    // ================================================================
    G.switchTurn = function() {
        var currentPlayer = G.currentPlayer;

        // Step 8 补充：清理回合Debuff
        G.removeExpiredBuffs(currentPlayer);
        G.removeExpiredDebuffs(currentPlayer);

        // 快速行动检查
        if (G.fastActionPending[currentPlayer] > 0) {
            G.fastActionPending[currentPlayer]--;
            G.isExtraTurn = true;
            G.logMsg('sys', '⚡ 快速行动！' + (currentPlayer === 'blue' ? 'BLUE' : 'RED') + ' 获得额外回合');
            G.toastMsg('EXTRA TURN!', '#ffcc00');
        } else {
            G.isExtraTurn = false;
            G.currentPlayer = currentPlayer === 'blue' ? 'red' : 'blue';
            // 时间回溯：turnCount 不增长
            if (G.currentPlayer === 'blue' && !G.turnCountPaused[currentPlayer]) {
                G.turnCount++;
            }
        }

        // 新回合开始时的 Dot Debuff 处理
        var nextPlayer = G.currentPlayer;
        var dotDamage = G.processTurnStartDebuffs(nextPlayer);
        if (dotDamage > 0) {
            G.playerHP[nextPlayer] = Math.max(0, G.playerHP[nextPlayer] - dotDamage);
            G.logMsg('warn', '🔥 回合开始Debuff伤害！' + (nextPlayer === 'blue' ? 'BLUE' : 'RED') + ' -' + dotDamage + 'HP');
            G.spawnDamagePopup(nextPlayer, dotDamage);
            G.triggerScreenFlash(nextPlayer);
            G.lastDeathCause = { victim: nextPlayer, cause: 'dot', damage: dotDamage };
            if (G.checkWin()) return;
        }

        // V4.0 回合开始时：新玩家的羽衰减+获得庇护Buff
        G.featherDecayCheck(nextPlayer);

        // 侵蚀印记回合结束处理（属于拥有者的回合结束时扣血）
        if (!G.isExtraTurn) {
            for (const [k, mark] of G.erosionMarks) {
                mark.turnsLeft--;
                if (mark.turnsLeft <= 0) {
                    G.erosionMarks.delete(k);
                }
            }
            // 封印标记过期
            for (const [k, mark] of G.sealMarks) {
                mark.turnsLeft--;
                if (mark.turnsLeft <= 0) G.sealMarks.delete(k);
            }
            // 灼魂过期
            for (const [k, mark] of G.soulBurnMarks) {
                mark.turnsLeft--;
                if (mark.turnsLeft <= 0) G.soulBurnMarks.delete(k);
            }
        }

        G.hoverPreview = null;
        G.updateThreatHighlights(G.currentPlayer);
        G.updatePhantomEyes();
    };

    // ================================================================
    // 胜负判定
    // ================================================================
    G.checkWin = function() {
        if (G.playerHP.blue <= 0) { G.endGame('red'); return true; }
        if (G.playerHP.red <= 0) { G.endGame('blue'); return true; }
        let full = true;
        for (let r = 0; r < G.BOARD_SIZE; r++) {
            for (let c = 0; c < G.BOARD_SIZE; c++)
                if (G.isCellReallyEmpty(r, c)) { full = false; break; }
            if (!full) break;
        }
        if (full) {
            if (G.playerHP.blue > G.playerHP.red) G.endGame('blue');
            else if (G.playerHP.red > G.playerHP.blue) G.endGame('red');
            else G.endGame('draw');
            return true;
        }
        return false;
    };

    G.endGame = function(w) {
        G.gameOver = true;
        G.winner = w;
        G.busy = false;
        G.pendingAttack = null;
        G.pendingBadge.style.display = 'none';
        G.clearHighlights();
        G.hoverPreview = null;
        G.winOverlay.classList.add('show');
        G.spawnWinConfetti(w);
        if (w === 'blue') { G.winTitle.textContent = 'BLUE WINS'; G.winTitle.className = 'win-title a'; }
        else if (w === 'red') { G.winTitle.textContent = 'RED WINS'; G.winTitle.className = 'win-title b'; }
        else { G.winTitle.textContent = 'DRAW'; G.winTitle.className = 'win-title draw'; }
        G.logMsg('sys', '=== GAME OVER: ' + (w === 'blue' ? 'BLUE' : w === 'red' ? 'RED' : 'DRAW') + ' ===');
        const wasHPZero = G.playerHP.blue <= 0 || G.playerHP.red <= 0;
        if (G.lastDeathCause && wasHPZero && w !== 'draw') {
            const dc = G.lastDeathCause;
            const victimName = dc.victim === 'blue' ? 'BLUE' : 'RED';
            const causeLabels = {
                phaethon: '☠ PHAETHON伤害',
                phaethon_overload: '☠ 过载增伤',
                phaethon_eye: '☠ 阵眼共鸣伤害',
                clash: '☠ 对冲伤害',
                hypoxia: '☠ 缺氧窒息',
                dot: '☠ Debuff持续性伤害',
            };
            const label = causeLabels[dc.cause] || '☠ 未知';
            const fromWho = dc.attacker ? ' ← ' + (dc.attacker === 'blue' ? 'BLUE' : 'RED') : '';
            G.logMsg('warn', label + fromWho + ' | ' + victimName + ' -' + dc.damage + 'HP → 致死一击');
        }
        G.updateAllUI();
        G.undoBtn.disabled = true;
    };

    // ================================================================
    // 绝杀预警——含高频闪烁点列表
    // ================================================================
    G.detectCheckState = function() {
        const result = {
            pendingLethal: false,
            pendingLethalType: null,
            checkState: false,
            lethalCells: [],
            checkDetails: '',
            defenderHP: 0,
            isDoubleCheck: false,
        };
        if (G.gameOver) return result;

        const defender = G.currentPlayer;
        const defHP = G.playerHP[defender];
        result.defenderHP = defHP;

        if (G.pendingAttack) {
            const power = G.pendingAttack.power;
            var finalCheck = G.applyFeatherDamageShare(defender, power);
            // revert — we don't actually apply, just check
            if (power >= defHP || finalCheck >= defHP) {
                result.pendingLethal = true;
                if (G.pendingAttack.overloaded) result.pendingLethalType = 'phaethon_overload';
                else if (G.pendingAttack.hasEye) result.pendingLethalType = 'phaethon_eye';
                else result.pendingLethalType = 'phaethon';
                result.checkDetails = '☠ 致死一击！' + power + '伤害 ≥ HP' + defHP;
            }
            return result;
        }

        if (defHP <= 0) return result;

        var lethalPoints = G.getLethalPoints(defender);
        if (lethalPoints.length > 0) {
            result.lethalCells = lethalPoints;
            result.checkState = true;
            var maxPower = Math.max.apply(null, lethalPoints.map(function(lp) { return lp.power; }));
            result.checkDetails = '⚠ 将军！对手可一步致死(' + maxPower + '伤害≥HP' + defHP + ')，请防守或抢占关键点';

            // 双杀检测：是否存在≥2个无法同时防守的绝杀点
            if (lethalPoints.length >= 2) {
                result.isDoubleCheck = true;
                result.checkDetails = '⚡ 绝杀无解！存在' + lethalPoints.length + '个绝杀点无法同时防守';
            }
        }
        return result;
    };

    // ================================================================
    // HP 变化预览——V4.0 版（含羽分摊）
    // ================================================================
    G.calculateHPDelta = function(r, c) {
        var result = { blue: 0, red: 0, showPreview: false };
        if (G.gameOver || G.busy || !G.isCellReallyEmpty(r, c)) return result;

        var player = G.currentPlayer;
        var opponent = player === 'blue' ? 'red' : 'blue';

        G.board[r][c] = { owner: player, enhanced: G.hasEnv(r, c) };
        var lines4 = G.detectLines(r, c, G.PHAETHON_MIN);
        var lines3 = G.detectLines(r, c, G.THREE_LINE_MIN);
        G.board[r][c] = null;

        var myPower = 0;
        if (lines4.length > 0) {
            myPower = G.calculateV4Damage(lines4[0], player, r, c, false);
        }

        if (G.pendingAttack) {
            var theirPower = G.pendingAttack.power;
            var onGun = G.getGunPoints(G.pendingAttack).some(function(gp) { return gp.r === r && gp.c === c; });
            if (onGun) {
                // 截击免伤
            } else if (myPower > 0) {
                if (myPower > theirPower) result[opponent] = -(myPower - theirPower);
                else if (theirPower > myPower) result[player] = -(theirPower - myPower);
            } else {
                result[player] = -theirPower;
                if (G.isSuffocating && lines3.length === 0) {
                    var lethalDefenders2 = G.getLethalPoints(player);
                    var isDefending = lethalDefenders2.some(function(lp) { return lp.r === r && lp.c === c; });
                    if (!isDefending) result[player] -= 1;
                }
            }
            result.showPreview = true;
        } else if (myPower > 0) {
            result[opponent] = -myPower;
            result.showPreview = true;
        } else if (G.isSuffocating && lines3.length === 0) {
            var lethalDefenders3 = G.getLethalPoints(player);
            var isDefending2 = lethalDefenders3.some(function(lp) { return lp.r === r && lp.c === c; });
            if (!isDefending2) {
                result[player] = -1;
                result.showPreview = true;
            }
        }
        return result;
    };

    console.log('[logic.js] V4.0 核心游戏逻辑 已加载');
})(window.G);

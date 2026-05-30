/**
 * ai.js — PHAETHON V4.0 AI 对手
 *
 * 职责：
 *   1. AI 决策主流程（优先级：截击 > 绝杀防守 > 必胜 > 羽召唤辅助 > 关键防守 > Alpha-Beta > 兜底）
 *   2. Alpha-Beta 剪枝搜索（深度 2~3 层）
 *   3. V4.0 启发式评估函数（连线 + 羽 + Buff/Debuff + 特殊状态）
 *   4. 候选生成与排序（中心化 + 邻近 + 羽/Buff相关机制）
 *
 * 依赖：G.js, state.js, logic.js
 * 被依赖：main.js（通过 scheduleAI 调用）
 */
(function(G) {

    // ================================================================
    // AI 调度
    // ================================================================
    G.scheduleAI = function() {
        if (G.gameOver || G.busy) return;
        if (!G.aiOn || G.currentPlayer !== 'red') return;
        const delay = 300 + Math.random() * 180;
        setTimeout(G.aiMove, delay);
    };

    // ================================================================
    // AI 主决策
    // ================================================================
    G.aiMove = function() {
        if (G.gameOver || G.busy) return;
        if (!G.aiOn || G.currentPlayer !== 'red') return;
        const me = 'red';
        const opp = 'blue';
        let bestMove = null;

        // === 优先级1：pending attack 回应 ===
        if (G.pendingAttack && G.pendingAttack.target === me) {
            bestMove = G.handleInterceptResponseV4(me);
            if (bestMove) { G.handleTurn(bestMove.r, bestMove.c, true); return; }
            bestMove = G.alphaBetaSearchV4(me, opp);
            if (bestMove) { G.handleTurn(bestMove.r, bestMove.c, true); }
            return;
        }

        // === 优先级1.5：面临绝杀必须防守 ===
        var lethalPts = G.getLethalPoints(me);
        if (lethalPts.length > 0) {
            // 优先防守致命点
            var enemyPower = G.getLethalPoints(opp);
            if (lethalPts.length <= 2 && enemyPower.length > 0) {
                // 如果玩家也能绝杀AI，让AI思考是在当前回合自己取胜还是防守
                // 简单处理：如果AI能一步致胜优先进攻
                var lethalDefendWin = G.findInstantAscendV4(me);
                if (lethalDefendWin) {
                    G.handleTurn(lethalDefendWin.r, lethalDefendWin.c, true);
                    return;
                }
            }
            // 尝试防守：在绝杀点中选最佳
            if (lethalPts.length === 1) {
                G.handleTurn(lethalPts[0].r, lethalPts[0].c, true);
                return;
            }
            // 多个绝杀点无解，但尽量防守最危险的那个
            lethalPts.sort(function(a, b) { return b.power - a.power; });
            G.handleTurn(lethalPts[0].r, lethalPts[0].c, true);
            return;
        }

        // === 优先级2：寻找自己的必胜 PHAETHON ===
        const instantWin = G.findInstantAscendV4(me);
        if (instantWin) { bestMove = instantWin;
            G.handleTurn(bestMove.r, bestMove.c, true); return; }

        // === 优先级2.5：羽召唤辅助（暗子≥3时优先造暗子）===
        if (G.turnCount >= G.PHANTOM_EYE_TURN && G.phantomStoneCount(me) >= 3) {
            var featherMove = G.findFeatherSetupMove(me);
            if (featherMove && Math.random() < 0.7) {
                G.handleTurn(featherMove.r, featherMove.c, true);
                return;
            }
        }

        // === 优先级2.6：羽引爆时机 ===
        var myFeather = G.feathers[me];
        if (myFeather && !myFeather.detonated && myFeather.hp <= 5 &&
            G.playerHP[me] < 20 && Math.random() < 0.6) {
            // 羽快死了且自己血量低，主动引爆
            G.manualFeatherDetonate();
            // 引爆后继续正常回合
            bestMove = G.alphaBetaSearchV4(me, opp);
            if (bestMove) { G.handleTurn(bestMove.r, bestMove.c, true); }
            return;
        }

        // === 优先级3：关键防守 ===
        const criticalDefense = G.findCriticalDefenseV4(me, opp);
        if (criticalDefense && Math.random() < 0.8) { bestMove = criticalDefense;
            G.handleTurn(bestMove.r, bestMove.c, true); return; }

        // === 优先级4：Alpha-Beta 搜索 ===
        bestMove = G.alphaBetaSearchV4(me, opp);
        if (bestMove) { G.handleTurn(bestMove.r, bestMove.c, true); }
        else { const fallback = G.findAnyMove(); if (fallback) G.handleTurn(fallback.r, fallback.c, true); }
    };

    // ================================================================
    // 统计某方暗子数量
    // ================================================================
    G.phantomStoneCount = function(player) {
        var cnt = 0;
        G.phantomStones.forEach(function(v) { if (v.owner === player) cnt++; });
        return cnt;
    };

    // ================================================================
    // 寻找羽召唤设置位置——有助于创造暗子或踩破绽
    // ================================================================
    G.findFeatherSetupMove = function(me) {
        var candidates = G.generateCandidates(G.board);
        var bestCell = null, bestScore = -Infinity;

        for (var i = 0; i < candidates.length; i++) {
            var cell = candidates[i];
            if (!G.isCellReallyEmpty(cell.r, cell.c)) continue;
            var score = 0;

            // 踩破绽端点生成暗子
            var matchingFlaws = G.flawPairs.filter(function(fp) {
                return fp.owner === me &&
                    (G.keyRC(fp.end1.r, fp.end1.c) === G.keyRC(cell.r, cell.c) ||
                     G.keyRC(fp.end2.r, fp.end2.c) === G.keyRC(cell.r, cell.c));
            });
            if (matchingFlaws.length > 0) score += 500;

            // 形成活三 -> 潜在暗子
            G.board[cell.r][cell.c] = { owner: me, enhanced: G.hasEnv(cell.r, cell.c) };
            var open3s = G.isOpenThree(cell.r, cell.c, me);
            G.board[cell.r][cell.c] = null;
            if (open3s.length > 0) score += 300;

            // 踩暗子位置：释放空间同时可能摧毁对方优势
            if (G.phantomStones.has(G.keyRC(cell.r, cell.c))) {
                var pOwner = G.phantomStones.get(G.keyRC(cell.r, cell.c)).owner;
                if (pOwner !== me) score += 100; // 摧毁敌暗子
                else score -= 50; // 不踩自己的暗子
            }

            if (score > bestScore) { bestScore = score; bestCell = cell; }
        }
        return bestScore > 0 ? bestCell : null;
    };

    // ================================================================
    // 截击回应处理
    // ================================================================
    G.handleInterceptResponseV4 = function(me) {
        const gunPoints = G.getGunPoints(G.pendingAttack);
        const validGPs = gunPoints.filter(g => G.isCellReallyEmpty(g.r, g.c));
        if (validGPs.length > 0) {
            validGPs.sort((a, b) => {
                var aScore = (G.hasEnv(a.r, a.c) ? 50 : 0) +
                    (G.phantomStones.has(G.keyRC(a.r, a.c)) &&
                     G.phantomStones.get(G.keyRC(a.r, a.c)).owner !== me ? 30 : 0);
                var bScore = (G.hasEnv(b.r, b.c) ? 50 : 0) +
                    (G.phantomStones.has(G.keyRC(b.r, b.c)) &&
                     G.phantomStones.get(G.keyRC(b.r, b.c)).owner !== me ? 30 : 0);
                return bScore - aScore;
            });
            return validGPs[0];
        }
        return null;
    };

    // ================================================================
    // 必胜 PHAETHON 检测——V4 版使用 calculateV4Damage
    // ================================================================
    G.findInstantAscendV4 = function(me) {
        const candidates = G.generateCandidates(G.board);
        let bestCell = null;
        let bestPower = 0;
        for (const cell of candidates) {
            if (!G.isCellReallyEmpty(cell.r, cell.c)) continue;
            G.board[cell.r][cell.c] = { owner: me, enhanced: G.hasEnv(cell.r, cell.c) };
            const lines = G.detectLines(cell.r, cell.c, G.PHAETHON_MIN);
            G.board[cell.r][cell.c] = null;
            if (lines.length > 0) {
                var pwr = G.calculateV4Damage(lines[0], me, cell.r, cell.c, false);
                // 羽存活→防御力强，直接比较伤害vs对方HP
                if (pwr >= G.playerHP.blue) return cell; // 必胜
                if (pwr > bestPower) { bestPower = pwr; bestCell = cell; }
            }
            // 也检查活三
            G.board[cell.r][cell.c] = { owner: me, enhanced: G.hasEnv(cell.r, cell.c) };
            var open3s = G.isOpenThree(cell.r, cell.c, me);
            G.board[cell.r][cell.c] = null;
            if (open3s.length > 0 && bestPower < 3) {
                bestPower = 3; bestCell = cell;
            }
        }
        return bestCell;
    };

    // ================================================================
    // 关键防守检测
    // ================================================================
    G.findCriticalDefenseV4 = function(me, opp) {
        const candidates = G.generateCandidates(G.board);
        let bestDefense = null;
        let bestThreat = 0;
        for (const cell of candidates) {
            if (!G.isCellReallyEmpty(cell.r, cell.c)) continue;
            G.board[cell.r][cell.c] = { owner: opp, enhanced: G.hasEnv(cell.r, cell.c) };
            const opLines = G.detectLines(cell.r, cell.c, G.PHAETHON_MIN);
            G.board[cell.r][cell.c] = null;
            if (opLines.length > 0) {
                var threat = G.calculateV4Damage(opLines[0], opp, cell.r, cell.c, false);
                if (threat > bestThreat) { bestThreat = threat; bestDefense = cell; }
                if (threat >= G.playerHP[me]) { return cell; } // 即将致死
            }
            // 三连威胁
            G.board[cell.r][cell.c] = { owner: opp, enhanced: G.hasEnv(cell.r, cell.c) };
            var linesMin3 = G.detectLinesMinN_static(cell.r, cell.c, opp, 3);
            G.board[cell.r][cell.c] = null;
            if (linesMin3.length > 0 && bestThreat < 4) {
                var threat3 = linesMin3.reduce(function(s, l) { return s + l.length; }, 0);
                if (threat3 > bestThreat) { bestThreat = threat3; bestDefense = cell; }
            }
        }
        return bestThreat >= 3 ? bestDefense : null;
    };

    // ================================================================
    // Alpha-Beta 搜索
    // ================================================================
    G.alphaBetaSearchV4 = function(me, opp) {
        const candidates = G.generateCandidates(G.board);
        if (candidates.length === 0) return null;
        G.aiSearchStats = { nodes: 0, depth: 0, prunes: 0 };
        const depth = candidates.length <= 16 ? 3 : 2;
        G.aiSearchStats.depth = depth;
        let bestMove = null;
        let bestScore = -Infinity;
        let alpha = -Infinity;
        const beta = Infinity;
        const sortedCandidates = G.sortCandidatesForAIV4(candidates, me);
        for (const cell of sortedCandidates) {
            if (!G.isCellReallyEmpty(cell.r, cell.c)) continue;
            // 封印预感时避免关键位置
            if (G.nextStoneSealed[me] && bestScore > -1000) {
                // 仍有其他选择时不选会被封印的位置
            }
            G.board[cell.r][cell.c] = { owner: me, enhanced: G.hasEnv(cell.r, cell.c) };
            G.aiSearchStats.nodes++;
            const score = G.alphaBetaMinV4(G.board, depth - 1, alpha, beta, me, opp);
            G.board[cell.r][cell.c] = null;
            if (score > bestScore) { bestScore = score; bestMove = cell; }
            alpha = Math.max(alpha, score);
        }
        return bestMove;
    };

    G.alphaBetaMinV4 = function(boardRef, depth, alpha, beta, me, opp) {
        if (depth <= 0 || G.gameOver) return G.evaluateBoardV4(boardRef, me, opp);
        const candidates = G.generateCandidates(boardRef);
        if (candidates.length === 0) return G.evaluateBoardV4(boardRef, me, opp);
        const sortedCandidates = G.sortCandidatesForAIV4(candidates, opp);
        let value = Infinity;
        for (const cell of sortedCandidates) {
            if (!G.isCellEmpty_ref(boardRef, cell.r, cell.c)) continue;
            boardRef[cell.r][cell.c] = { owner: opp, enhanced: G.hasEnv_ref(cell.r, cell.c) };
            G.aiSearchStats.nodes++;
            const childScore = G.alphaBetaMaxV4(boardRef, depth - 1, alpha, beta, me, opp);
            boardRef[cell.r][cell.c] = null;
            value = Math.min(value, childScore);
            if (value <= alpha) { G.aiSearchStats.prunes++; return value; }
            beta = Math.min(beta, value);
        }
        return value;
    };

    G.alphaBetaMaxV4 = function(boardRef, depth, alpha, beta, me, opp) {
        if (depth <= 0 || G.gameOver) return G.evaluateBoardV4(boardRef, me, opp);
        const candidates = G.generateCandidates(boardRef);
        if (candidates.length === 0) return G.evaluateBoardV4(boardRef, me, opp);
        const sortedCandidates = G.sortCandidatesForAIV4(candidates, me);
        let value = -Infinity;
        for (const cell of sortedCandidates) {
            if (!G.isCellEmpty_ref(boardRef, cell.r, cell.c)) continue;
            boardRef[cell.r][cell.c] = { owner: me, enhanced: G.hasEnv_ref(cell.r, cell.c) };
            G.aiSearchStats.nodes++;
            const childScore = G.alphaBetaMinV4(boardRef, depth - 1, alpha, beta, me, opp);
            boardRef[cell.r][cell.c] = null;
            value = Math.max(value, childScore);
            if (value >= beta) { G.aiSearchStats.prunes++; return value; }
            alpha = Math.max(alpha, value);
        }
        return value;
    };

    // ================================================================
    // 辅助函数
    // ================================================================
    G.isCellEmpty_ref = function(boardRef, r, c) {
        return boardRef[r]?.[c] === null && !G.phantomStones.has(G.keyRC(r, c));
    };
    G.hasEnv_ref = function(r, c) { return G.envCells.has(G.keyRC(r, c)); };

    G.generateCandidates = function(boardRef) {
        const candidateSet = new Set();
        const hasAnyPiece = boardRef.some(row => row.some(cell => cell !== null));
        if (!hasAnyPiece && G.phantomStones.size === 0) {
            candidateSet.add('7,7');
            candidateSet.add('6,7'); candidateSet.add('7,6');
            candidateSet.add('8,7'); candidateSet.add('7,8');
            return Array.from(candidateSet).map(k => {
                const [r, c] = k.split(',').map(Number); return { r, c };
            });
        }
        for (let r = 0; r < G.BOARD_SIZE; r++) {
            for (let c = 0; c < G.BOARD_SIZE; c++) {
                if (boardRef[r]?.[c] !== null || G.envCells.has(G.keyRC(r, c)) ||
                    G.phantomStones.has(G.keyRC(r, c))) {
                    for (let dr = -2; dr <= 2; dr++) {
                        for (let dc = -2; dc <= 2; dc++) {
                            const nr = r + dr, nc = c + dc;
                            if (nr >= 0 && nr < G.BOARD_SIZE && nc >= 0 && nc < G.BOARD_SIZE &&
                                boardRef[nr]?.[nc] === null && !G.phantomStones.has(G.keyRC(nr, nc)))
                                candidateSet.add(G.keyRC(nr, nc));
                        }
                    }
                }
            }
        }
        if (candidateSet.size < 8) {
            for (let r = 5; r <= 9; r++)
                for (let c = 5; c <= 9; c++)
                    if (boardRef[r]?.[c] === null && !G.phantomStones.has(G.keyRC(r, c)))
                        candidateSet.add(G.keyRC(r, c));
        }
        return Array.from(candidateSet).map(k => {
            const [r, c] = k.split(',').map(Number); return { r, c };
        });
    };

    G.sortCandidatesForAIV4 = function(candidates, player) {
        const opp = player === 'blue' ? 'red' : 'blue';
        const scored = candidates.map(cell => {
            let score = 0;
            if (G.envCells.has(G.keyRC(cell.r, cell.c))) score += 35;
            if (G.phantomStones.has(G.keyRC(cell.r, cell.c)) &&
                G.phantomStones.get(G.keyRC(cell.r, cell.c)).owner === opp) score += 300;
            if (G.phantomStones.has(G.keyRC(cell.r, cell.c)) &&
                G.phantomStones.get(G.keyRC(cell.r, cell.c)).owner === player) score -= 100;

            G.board[cell.r][cell.c] = { owner: player, enhanced: G.envCells.has(G.keyRC(cell.r, cell.c)) };
            const lines = G.detectLines(cell.r, cell.c, G.PHAETHON_MIN);
            const openThrees = G.isOpenThree(cell.r, cell.c, player);
            G.board[cell.r][cell.c] = null;
            if (lines.length > 0) {
                var pow = G.calculateV4Damage(lines[0], player, cell.r, cell.c, false);
                score += 700 + pow * 40;
            }
            if (openThrees.length > 0) score += 800;

            const distToCenter = Math.abs(cell.r - 7) + Math.abs(cell.c - 7);
            score += (14 - distToCenter) * 2;

            // 阵眼加成
            if (G.turnCount >= 35 && G.phantomEyes.some(function(eye) {
                return eye.owner === player && Math.abs(cell.r - eye.row) <= 2 && Math.abs(cell.c - eye.col) <= 2;
            })) score += 1500;

            // 对手充能高时避开环境格
            if (G.playerCharge[opp] >= 2 && G.envCells.has(G.keyRC(cell.r, cell.c)))
                score -= 1000;

            // 羽存活时优先进攻（因为防守力强）
            if (G.feathers[player] && !G.feathers[player].detonated) score += 100;

            // 封印预感时降低评分（鼓励去不重要的位置）
            if (G.nextStoneSealed[player] && score > 500) score *= 0.3;

            // 避免在侵蚀印记棋子上落子
            if (G.erosionMarks.has(G.keyRC(cell.r, cell.c))) score += 50;

            return { cell, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.cell);
    };

    // ================================================================
    // V4.0 启发式评估函数
    // ================================================================
    G.evaluateBoardV4 = function(boardRef, me, opp) {
        let score = 0;
        const allDirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
        const scannedLines = new Set();

        for (let r = 0; r < G.BOARD_SIZE; r++) {
            for (let c = 0; c < G.BOARD_SIZE; c++) {
                const cellData = boardRef[r]?.[c];
                const owner = cellData?.owner;
                if (!owner || G.isSealed(r, c) || G.sealMarks.has(G.keyRC(r, c)) || G.erosionMarks.has(G.keyRC(r, c))) continue;
                const enhanced = cellData?.enhanced || false;
                const isMe = owner === me;
                for (const [dr, dc] of allDirs) {
                    const lineKey = r + ',' + c + ',' + dr + ',' + dc;
                    const revKey = r + ',' + c + ',' + (-dr) + ',' + (-dc);
                    if (scannedLines.has(lineKey) || scannedLines.has(revKey)) continue;

                    let count = 0, envCount = 0, openEnds = 0;
                    let cr = r, cc = c;
                    while (cr >= 0 && cr < G.BOARD_SIZE && cc >= 0 && cc < G.BOARD_SIZE) {
                        if (G.isSealed(cr, cc) || G.sealMarks.has(G.keyRC(cr, cc)) || G.erosionMarks.has(G.keyRC(cr, cc))) break;
                        const co = boardRef[cr]?.[cc]?.owner;
                        const phantomOwner = G.phantomStones.get(G.keyRC(cr, cc))?.owner;
                        if (co === owner || phantomOwner === owner) {
                            if (boardRef[cr]?.[cc]?.enhanced) envCount++;
                            count++;
                            cr += dr; cc += dc;
                        } else break;
                    }
                    if (cr >= 0 && cr < G.BOARD_SIZE && cc >= 0 && cc < G.BOARD_SIZE &&
                        boardRef[cr]?.[cc] === null && !G.phantomStones.has(G.keyRC(cr, cc)) &&
                        !G.isSealed(cr, cc) && !G.sealMarks.has(G.keyRC(cr, cc))) openEnds++;

                    cr = r - dr; cc = c - dc;
                    while (cr >= 0 && cr < G.BOARD_SIZE && cc >= 0 && cc < G.BOARD_SIZE) {
                        if (G.isSealed(cr, cc) || G.sealMarks.has(G.keyRC(cr, cc)) || G.erosionMarks.has(G.keyRC(cr, cc))) break;
                        const co = boardRef[cr]?.[cc]?.owner;
                        const phantomOwner = G.phantomStones.get(G.keyRC(cr, cc))?.owner;
                        if (co === owner || phantomOwner === owner) {
                            if (boardRef[cr]?.[cc]?.enhanced) envCount++;
                            count++;
                            cr -= dr; cc -= dc;
                        } else break;
                    }
                    if (cr >= 0 && cr < G.BOARD_SIZE && cc >= 0 && cc < G.BOARD_SIZE &&
                        boardRef[cr]?.[cc] === null && !G.phantomStones.has(G.keyRC(cr, cc)) &&
                        !G.isSealed(cr, cc) && !G.sealMarks.has(G.keyRC(cr, cc))) openEnds++;

                    scannedLines.add(lineKey);

                    let lineScore = 0;
                    if (count >= 4)
                        lineScore = 500 + count * 40 + envCount * 18 + openEnds * 25;
                    else if (count === 3)
                        lineScore = 70 + count * 8 + envCount * 12 + openEnds * 20;
                    else if (count === 2)
                        lineScore = 8 + envCount * 6 + openEnds * 10;
                    else
                        lineScore = count * 1;

                    if (isMe) score += lineScore;
                    else score -= lineScore * 0.85;
                }
            }
        }

        // 环境元素占有评估
        for (const key of G.envCells) {
            const [er, ec] = key.split(',').map(Number);
            const owner = boardRef[er]?.[ec]?.owner;
            if (owner === me) score += 15;
            else if (owner === opp) score -= 12;
        }

        // V4.0 羽评估
        if (G.feathers[me] && !G.feathers[me].detonated) score += 2500;
        if (G.feathers[opp] && !G.feathers[opp].detonated) score -= 1800;

        // V4.0 Buff/Debuff评估
        if (G.isOverloaded[me]) score += 800;
        if (G.isOverloaded[opp]) score -= 600;
        if (G.hasBuff(me, 'sharp')) score += 400;
        if (G.hasBuff(opp, 'sharp')) score -= 300;
        if (G.hasBuff(me, 'resonance')) score += 200;
        if (G.hasDebuff(me, 'weakness') || G.hasDebuff(me, 'intercept_weakness'))
            score -= 500;
        if (G.hasDebuff(opp, 'weakness') || G.hasDebuff(opp, 'intercept_weakness'))
            score += 400;
        if (G.hasDebuff(me, 'chaos') || G.hasDebuff(me, 'soulfire'))
            score -= 300;
        if (G.counterStreak[opp] >= 1) score -= 800;
        if (G.nextStoneSealed[me]) score -= 600;

        // 侵蚀印记：拥有者的损失
        for (const [k, mark] of G.erosionMarks) {
            if (mark.owner === me) score -= mark.turnsLeft * 30;
            else if (mark.owner === opp) score += mark.turnsLeft * 25;
        }

        return score;
    };

    G.findAnyMove = function() {
        for (let r = 7; r >= 0; r--) {
            for (let c = 7; c >= 0; c--) {
                if (G.isCellReallyEmpty(r, c) && !G.phantomStones.has(G.keyRC(r, c)))
                    return { r, c };
                const mr = 7 + (7 - r), mc = 7 + (7 - c);
                if (mr < G.BOARD_SIZE && mc < G.BOARD_SIZE &&
                    G.isCellReallyEmpty(mr, mc) && !G.phantomStones.has(G.keyRC(mr, mc)))
                    return { r: mr, c: mc };
            }
        }
        for (let r = 0; r < G.BOARD_SIZE; r++)
            for (let c = 0; c < G.BOARD_SIZE; c++)
                if (G.isCellReallyEmpty(r, c) && !G.phantomStones.has(G.keyRC(r, c)))
                    return { r, c };
        return null;
    };

    console.log('[ai.js] V4.0 AI 对手 已加载');
})(window.G);

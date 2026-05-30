/**
 * render.js — PHAETHON V4.0 Canvas 渲染引擎
 *
 * 职责：
 *   1. Canvas 初始化与响应式缩放（DPR 适配）
 *   2. 完整棋盘绘制（按渲染层级顺序：背景→网格→星位→特效→棋子）
 *   3. 棋子绘制（蓝/红双色渐变 + 增强光环 + 星纹）
 *   4. V4.0 新增：羽飘浮实体、侵蚀裂纹、封印标记虚影、灼魂光环、绝杀闪烁、贯穿激光
 *   5. 特效元素绘制（暗子/封印/阵眼/破绽/高亮/威胁/环境）
 *   6. 悬浮预览（伤害数字/破绽提示/暗子踩碎）
 *
 * 依赖：G.js（常量、状态）, particles.js（粒子绘制）
 * 被依赖：main.js（游戏循环调用 drawBoardFull）
 */
(function(G) {

    G.setupCanvas = function() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const containerW = G.stageEl.clientWidth - 16;
        const containerH = G.stageEl.clientHeight - 16;
        const displaySize = Math.min(G.CANVAS_LOGICAL, containerW, containerH);
        const scale = displaySize / G.CANVAS_LOGICAL;
        G.canvas.style.width = displaySize + 'px';
        G.canvas.style.height = displaySize + 'px';
        G.canvas.width = G.CANVAS_LOGICAL * dpr;
        G.canvas.height = G.CANVAS_LOGICAL * dpr;
        G.ctx.setTransform(1, 0, 0, 1, 0, 0);
        G.ctx.scale(dpr, dpr);
        G.ctx._displayScale = scale;
    };

    G.highlightAttackCells = function(cells) {
        G.highlightCells = cells.map(c => ({ r: c.r, c: c.c }));
    };
    G.clearHighlights = function() { G.highlightCells = []; };

    // ================================================================
    // 主渲染函数
    // ================================================================
    G.drawBoardFull = function() {
        const ctx = G.ctx;
        const w = G.CANVAS_LOGICAL, h = G.CANVAS_LOGICAL;

        // ---- 背景 ----
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#ededea';
        ctx.fillRect(0, 0, w, h);
        // V4.1 微织物纹理
        if (!G._boardTexture) {
            var tc = document.createElement('canvas');
            tc.width = 64; tc.height = 64;
            var tctx = tc.getContext('2d');
            tctx.fillStyle = '#f8f7f5';
            tctx.fillRect(0, 0, 64, 64);
            for (var ti = 0; ti < 60; ti++) {
                tctx.fillStyle = 'rgba(180,175,165,' + (0.01 + Math.random() * 0.03) + ')';
                tctx.fillRect(Math.floor(Math.random() * 64), Math.floor(Math.random() * 64), 1, 1);
            }
            G._boardTexture = ctx.createPattern(tc, 'repeat');
        }
        ctx.fillStyle = G._boardTexture;
        ctx.fillRect(0, 0, w, h);

        // ---- 棋盘网格线 ----
        const gl = G.PAD, gt = G.PAD;
        const gr = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE;
        const gb = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE;
        ctx.fillStyle = '#f4f3f1';
        ctx.fillRect(gl - 7, gt - 7, gr - gl + 14, gb - gt + 14);
        // V4.1 双色雕刻网格线
        for (let i = 0; i < G.BOARD_SIZE; i++) {
            const pos = G.PAD + i * G.CELL_SIZE;
            // 阴影线（底部1px偏移）
            ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.5;
            G.drawSketchLine(ctx, gl, pos + 1, gr, pos + 1, i);
            G.drawSketchLine(ctx, pos + 1, gt, pos + 1, gb, i + G.BOARD_SIZE);
            // 主线
            ctx.strokeStyle = '#b5b0aa'; ctx.lineWidth = 0.7;
            G.drawSketchLine(ctx, gl, pos, gr, pos, i);
            G.drawSketchLine(ctx, pos, gt, pos, gb, i + G.BOARD_SIZE);
        }

        // ---- 星位标记点 ----
        const starPts = [[3,3],[3,7],[3,11],[7,3],[7,7],[7,11],[11,3],[11,7],[11,11]];
        var starPulse = 0.85 + Math.sin(performance.now() / 2000) * 0.15;
        for (const [r, c] of starPts) {
            if (r < G.BOARD_SIZE && c < G.BOARD_SIZE) {
                const pos = G.gridToPos(r, c);
                // 脉动光晕
                const starGrad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 5.5 * starPulse);
                starGrad.addColorStop(0, 'rgba(130,125,118,' + (0.85 * starPulse) + ')');
                starGrad.addColorStop(0.4, 'rgba(130,125,118,' + (0.45 * starPulse) + ')');
                starGrad.addColorStop(0.7, 'rgba(130,125,118,' + (0.1 * starPulse) + ')');
                starGrad.addColorStop(1, 'rgba(130,125,118,0)');
                ctx.fillStyle = starGrad;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 5.5 * starPulse, 0, Math.PI * 2);
                ctx.fill();
                // 珍珠白色中心
                ctx.fillStyle = 'rgba(255,250,245,' + (0.5 * starPulse) + ')';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 1.0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ---- 棋盘微弱呼吸光泽 ----
        var breathAlpha = 0.015 + Math.sin(performance.now() / 3000) * 0.01;
        var breathGrad = ctx.createRadialGradient(
            w / 2 + Math.sin(performance.now() / 4000) * 30,
            h / 2 + Math.cos(performance.now() / 3500) * 20,
            20,
            w / 2, h / 2, w * 0.7
        );
        breathGrad.addColorStop(0, 'rgba(180,200,220,' + breathAlpha + ')');
        breathGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = breathGrad;
        ctx.fillRect(0, 0, w, h);

        // ---- 棋盘边框装饰 ----
        const frameMargin = 10;
        const fl = gl - frameMargin, ft = gt - frameMargin;
        const fr2 = gr + frameMargin, fb2 = gb + frameMargin;
        const bracketSize = 18;
        G.drawCornerBracket(ctx, fl, ft, bracketSize, 0);
        G.drawCornerBracket(ctx, fr2, ft, bracketSize, Math.PI / 2);
        G.drawCornerBracket(ctx, fr2, fb2, bracketSize, Math.PI);
        G.drawCornerBracket(ctx, fl, fb2, bracketSize, -Math.PI / 2);
        ctx.strokeStyle = 'rgba(140,140,155,0.3)';
        ctx.lineWidth = 0.8;
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 6;
        ctx.strokeRect(gl - 2, gt - 2, gr - gl + 4, gb - gt + 4);
        ctx.shadowBlur = 0;

        // V4.1 暗角 Vignette
        var vigGrad = ctx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.82);
        vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vigGrad.addColorStop(0.7, 'rgba(0,0,0,0)');
        vigGrad.addColorStop(1, 'rgba(0,0,0,0.07)');
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, w, h);

        // ---- 环境元素 ----
        for (const key of G.envCells) {
            const [r, c] = key.split(',').map(Number);
            G.drawEnvElement(ctx, G.gridToPos(r, c).x, G.gridToPos(r, c).y);
        }

        // ---- 环境生成动画 ----
        const now = performance.now();
        const stillAnim = [];
        for (const anim of G.envSpawnAnims) {
            const elapsed = now - anim.startTime;
            if (elapsed < anim.duration) {
                const pos = G.gridToPos(anim.r, anim.c);
                const progress = elapsed / anim.duration;
                const alpha = Math.sin(progress * Math.PI);
                const scale = 0.3 + 0.7 * (1 - Math.exp(-progress * 4));
                G.drawEnvElement(ctx, pos.x, pos.y, alpha * 0.8, scale);
                stillAnim.push(anim);
            }
        }
        G.envSpawnAnims = stillAnim;

        // ---- V4.0 贯穿激光残留 ----
        G.drawPenetrationLasers(ctx);

        // ---- 攻击能量光束 ----
        G.drawAttackBeams(ctx);

        // ---- V4.1 Pending 攻击双环脉动 ----
        if (G.pendingAttack && G.pendingAttack.cells) {
            var nowMs3 = performance.now();
            for (var pi = 0; pi < G.pendingAttack.cells.length; pi++) {
                var cell = G.pendingAttack.cells[pi];
                var pos = G.gridToPos(cell.r, cell.c);
                var glowColor = G.pendingAttack.attacker === 'blue'
                    ? 'rgba(0,191,255,' : 'rgba(220,53,69,';
                // 内填充
                ctx.fillStyle = glowColor + '0.28)';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.36, 0, Math.PI * 2);
                ctx.fill();
                // 外虚线环脉动
                var ringPulse = 0.5 + Math.sin(nowMs3 / 400 + pi) * 0.5;
                ctx.strokeStyle = glowColor + (0.35 + ringPulse * 0.3) + ')';
                ctx.lineWidth = 1.8 + ringPulse * 0.8;
                ctx.setLineDash([4, 3]);
                ctx.lineDashOffset = -nowMs3 / 150;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.44, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                // 中间亮环
                ctx.strokeStyle = glowColor + (0.5 * ringPulse) + ')';
                ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.39, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // ---- V4.0 绝杀点平滑闪烁 ----
        if (G.currentPlayer === 'blue' && !G.gameOver) {
            var check = G.detectCheckState();
            if (check.checkState && check.lethalCells.length > 0) {
                var nowMs2 = performance.now();
                var flashAlpha = 0.3 + Math.abs(Math.sin(nowMs2 / 200)) * 0.6;
                for (var li = 0; li < check.lethalCells.length; li++) {
                    var lp = G.gridToPos(check.lethalCells[li].r, check.lethalCells[li].c);
                    var lethalAlpha = flashAlpha * (check.isDoubleCheck ? 1.3 : 1);
                    // 外脉冲环
                    ctx.strokeStyle = 'rgba(255,0,60,' + lethalAlpha + ')';
                    ctx.lineWidth = 3.5 + Math.abs(Math.sin(nowMs2 / 300)) * 2;
                    ctx.shadowColor = 'rgba(255,0,60,0.8)';
                    ctx.shadowBlur = 14 * lethalAlpha;
                    ctx.beginPath();
                    ctx.arc(lp.x, lp.y, G.CELL_SIZE * 0.46, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                    // 中心致死标记
                    if (lethalAlpha > 0.5) {
                        ctx.fillStyle = 'rgba(255,0,60,' + (lethalAlpha * 0.6) + ')';
                        ctx.font = 'bold 12px "Inter","PingFang SC",sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('☠', lp.x, lp.y + 4);
                        ctx.textAlign = 'start';
                    }
                }
            }
        }

        // ---- 封印棋子 ----
        for (const key of G.sealedStones) {
            const [r, c] = key.split(',').map(Number);
            const pos = G.gridToPos(r, c);
            G.drawSealedStone(ctx, pos.x, pos.y);
        }

        // ---- V4.0 封印标记六角形禁制 ----
        for (const [key, mark] of G.sealMarks) {
            const [r, c] = key.split(',').map(Number);
            const pos = G.gridToPos(r, c);
            ctx.strokeStyle = 'rgba(160,160,180,0.5)';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([3, 3]);
            ctx.lineDashOffset = -performance.now() / 180;
            // 六角形
            var hexR = G.CELL_SIZE * 0.38;
            ctx.beginPath();
            for (var hi = 0; hi < 6; hi++) {
                var ha = (hi / 6) * Math.PI * 2 - Math.PI / 2;
                var hx = pos.x + Math.cos(ha) * hexR;
                var hy = pos.y + Math.sin(ha) * hexR;
                if (hi === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
            // 中心小菱形禁制符文
            var dm = hexR * 0.2;
            ctx.fillStyle = 'rgba(160,180,200,0.35)';
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y - dm);
            ctx.lineTo(pos.x + dm * 0.7, pos.y);
            ctx.lineTo(pos.x, pos.y + dm);
            ctx.lineTo(pos.x - dm * 0.7, pos.y);
            ctx.closePath();
            ctx.fill();
        }

        // ---- 暗子 ----
        for (const [key, phantom] of G.phantomStones) {
            const [r, c] = key.split(',').map(Number);
            const pos = G.gridToPos(r, c);
            const glowGrad = ctx.createRadialGradient(
                pos.x, pos.y, G.CELL_SIZE * 0.18, pos.x, pos.y, G.CELL_SIZE * 0.5);
            glowGrad.addColorStop(0, phantom.owner === 'blue'
                ? 'rgba(0,200,255,0.55)' : 'rgba(255,60,80,0.55)');
            glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = phantom.owner === 'blue'
                ? 'rgba(0,200,255,0.8)' : 'rgba(255,60,80,0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.lineDashOffset = performance.now() / 300;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.35, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = phantom.owner === 'blue'
                ? 'rgba(0,200,255,0.9)' : 'rgba(255,60,80,0.9)';
            ctx.font = 'bold 10px "Inter","PingFang SC",sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('暗', pos.x, pos.y + 4);
            ctx.textAlign = 'start';
        }

        // ---- V4.0 侵蚀印记紫色裂纹 ----
        for (const [key, mark] of G.erosionMarks) {
            const [r, c] = key.split(',').map(Number);
            const pos = G.gridToPos(r, c);
            G.drawErosionMark(ctx, pos.x, pos.y);
        }

        // ---- 威胁高亮 ----
        if (G.currentPlayer === 'blue' && G.threatHighlights.length > 0) {
            for (const cell of G.threatHighlights) {
                const pos = G.gridToPos(cell.r, cell.c);
                const grad = ctx.createRadialGradient(
                    pos.x, pos.y, G.CELL_SIZE * 0.22,
                    pos.x, pos.y, G.CELL_SIZE * 0.5);
                grad.addColorStop(0, 'rgba(192,132,252,0.4)');
                grad.addColorStop(1, 'rgba(192,132,252,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ---- 阵眼标记 ----
        for (const eye of G.phantomEyes) {
            const pos = G.gridToPos(eye.row, eye.col);
            ctx.strokeStyle = 'rgba(192,132,252,0.8)'; ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.46, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(192,132,252,0.7)';
            ctx.font = 'bold 9px "Inter","PingFang SC",sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('眼', pos.x, pos.y - G.CELL_SIZE * 0.55);
            ctx.textAlign = 'start';
        }

        // ---- 破绽领域端点 ----
        for (const fp of G.flawPairs) {
            for (const end of [fp.end1, fp.end2]) {
                const pos = G.gridToPos(end.r, end.c);
                ctx.strokeStyle = 'rgba(192,132,252,0.5)'; ctx.lineWidth = 2;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.34, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // ---- 交互高亮 ----
        var hlPulse = 0.6 + Math.sin(performance.now() / 350) * 0.4;
        for (const cell of G.highlightCells) {
            const pos = G.gridToPos(cell.r, cell.c);
            // 内层柔光填充
            var hlGrad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, G.CELL_SIZE * 0.42);
            hlGrad.addColorStop(0, 'rgba(255,204,0,' + (0.1 * hlPulse) + ')');
            hlGrad.addColorStop(1, 'rgba(255,204,0,0)');
            ctx.fillStyle = hlGrad;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.42, 0, Math.PI * 2);
            ctx.fill();
            // 外层脉动虚线环
            ctx.strokeStyle = '#ffcc00';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = 'rgba(255,204,0,' + (0.6 * hlPulse) + ')';
            ctx.shadowBlur = 6 + hlPulse * 4;
            ctx.setLineDash([4, 3]);
            ctx.lineDashOffset = -performance.now() / 200;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, G.CELL_SIZE * 0.44, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
        }

        // ---- 棋子 ----
        function elasticOut(t) {
            if (t <= 0 || t >= 1) return t >= 1 ? 1 : 0;
            return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
        }
        const now2 = performance.now();
        G.pieceSpawnAnims = G.pieceSpawnAnims.filter(function(a) {
            return now2 - a.startTime < a.duration;
        });

        for (let r = 0; r < G.BOARD_SIZE; r++) {
            for (let c = 0; c < G.BOARD_SIZE; c++) {
                const cell = G.board[r][c];
                if (!cell) continue;
                const pos = G.gridToPos(r, c);
                const sealed = G.isSealed(r, c);

                let animScale = 1;
                for (let ai = 0; ai < G.pieceSpawnAnims.length; ai++) {
                    const anim = G.pieceSpawnAnims[ai];
                    if (anim.r === r && anim.c === c) {
                        const elapsed = now2 - anim.startTime;
                        const t = Math.min(elapsed / anim.duration, 1);
                        animScale = elasticOut(t);
                        break;
                    }
                }

                if (!sealed) {
                    if (animScale < 1) {
                        ctx.save();
                        ctx.translate(pos.x, pos.y);
                        ctx.scale(animScale, animScale);
                        ctx.translate(-pos.x, -pos.y);
                        G.drawPiece(ctx, pos.x, pos.y, cell.owner, cell.enhanced);
                        ctx.restore();
                    } else {
                        G.drawPiece(ctx, pos.x, pos.y, cell.owner, cell.enhanced);
                    }
                } else {
                    G.drawSealedStone(ctx, pos.x, pos.y);
                }

                // V4.0 灼魂光环
                if (G.soulBurnMarks.has(G.keyRC(r, c))) {
                    G.drawSoulBurnMark(ctx, pos.x, pos.y, r, c);
                }
            }
        }

        // ---- V4.0 深渊之羽飘浮实体 ----
        for (var fplayer = 0; fplayer < 2; fplayer++) {
            var fpName = fplayer === 0 ? 'blue' : 'red';
            var f = G.feathers[fpName];
            if (!f || f.detonated) continue;
            var fpos = G.gridToPos(f.row, f.col);
            var floatOffset = Math.sin(performance.now() / 1500 + f.row) * 5;
            var fx = fpos.x;
            var fy = fpos.y - 22 + floatOffset;
            G.drawFeather(ctx, fx, fy, fpName, f.hp, f.maxHp);
        }

        // ---- 悬浮预览 ----
        if (G.hoverPreview && G.currentPlayer === 'blue' && !G.gameOver && !G.busy) {
            var hp = G.hoverPreview;
            var pos = G.gridToPos(hp.row, hp.col);
            G.drawGhostPiece(ctx, pos.x, pos.y, G.currentPlayer);
            if (!G.pendingAttack) {
                if (hp.isPhantomCrush) {
                    ctx.fillStyle = '#ffcc00';
                    ctx.font = 'bold 14px "Inter","PingFang SC",sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('踩碎暗子', pos.x, pos.y - G.CELL_SIZE * 0.45);
                    ctx.textAlign = 'start';
                } else if (hp.isAscend && hp.damage !== null) {
                    var targetHP = G.currentPlayer === 'blue' ? G.playerHP.red : G.playerHP.blue;
                    var isLethal = hp.damage >= targetHP;
                    var py = pos.y - G.CELL_SIZE * 0.45;
                    var bgR = isLethal ? 16 : 14;
                    ctx.fillStyle = 'rgba(0,0,0,0.55)';
                    ctx.beginPath();
                    ctx.arc(pos.x, py + 2, bgR, 0, Math.PI * 2);
                    ctx.fill();
                    var dmgColor = isLethal ? '#ff3b3b' : '#00ffff';
                    var dmgGlow = isLethal ? '#ff0000' : '#00ffff';
                    ctx.fillStyle = dmgColor;
                    ctx.font = 'bold 18px "Inter","PingFang SC",sans-serif';
                    ctx.textAlign = 'center';
                    ctx.shadowColor = dmgGlow; ctx.shadowBlur = isLethal ? 12 : 8;
                    ctx.fillText('' + hp.damage, pos.x, py);
                    if (isLethal) {
                        ctx.font = 'bold 10px "Inter","PingFang SC",sans-serif';
                        ctx.fillText('☠ 将军', pos.x, py - G.CELL_SIZE * 0.35);
                    }
                    ctx.shadowBlur = 0; ctx.textAlign = 'start';
                } else if (hp.breachCells && hp.breachCells.length > 0) {
                    for (var bi = 0; bi < hp.breachCells.length; bi++) {
                        var bp = G.gridToPos(hp.breachCells[bi].r, hp.breachCells[bi].c);
                        ctx.fillStyle = 'rgba(192,132,252,0.35)';
                        ctx.beginPath();
                        ctx.arc(bp.x, bp.y, G.CELL_SIZE * 0.28, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.fillStyle = '#c084fc';
                    ctx.font = 'bold 13px "Inter","PingFang SC",sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('破绽+1', pos.x, pos.y - G.CELL_SIZE * 0.4);
                    ctx.textAlign = 'start';
                }
            }
        }

        // ---- 粒子特效 ----
        G.drawParticles(ctx);
        if (G.winParticles.length > 0) G.drawWinParticles(ctx);

        // ---- 游戏结束遮罩 ----
        if (G.gameOver) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, 0, w, h);
            ctx.textAlign = 'center';
            const titleText = G.winner === 'blue' ? 'BLUE WINS' : G.winner === 'red' ? 'RED WINS' : 'DRAW';
            const titleColor = G.winner === 'blue' ? '#00BFFF' : G.winner === 'red' ? '#DC143C' : '#ffcc00';
            ctx.font = 'bold 32px "Inter","PingFang SC","Microsoft YaHei",sans-serif';
            ctx.fillStyle = titleColor;
            ctx.shadowColor = titleColor;
            ctx.shadowBlur = 20;
            ctx.fillText(titleText, w / 2, h / 2 - 6);
            ctx.font = '13px "Inter","PingFang SC","Microsoft YaHei",sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(255,255,255,0.5)';
            ctx.shadowBlur = 8;
            ctx.fillText('GAME OVER', w / 2, h / 2 + 22);
            ctx.shadowBlur = 0;
            ctx.textAlign = 'start';
        }
    };

    // ================================================================
    // 绘制工具函数
    // ================================================================

    G.drawCornerBracket = function(ctx, x, y, size, angle) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.strokeStyle = 'rgba(80,80,90,0.45)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(80,80,90,0.15)';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(size * 0.15, 0);
        ctx.lineTo(size, 0);
        ctx.moveTo(0, size * 0.15);
        ctx.lineTo(0, size);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
    };

    G.drawSketchLine = function(ctx, x1, y1, x2, y2, lineIndex) {
        const rand = G.seededRandom((lineIndex || 0) * 7919 + 104729);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        const segs = Math.max(1, Math.floor(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / 7));
        for (let i = 1; i <= segs; i++) {
            const t = i / segs;
            ctx.lineTo(
                x1 + (x2 - x1) * t + (rand() - 0.5) * G.SKETCH_JITTER,
                y1 + (y2 - y1) * t + (rand() - 0.5) * G.SKETCH_JITTER
            );
        }
        ctx.stroke();
    };

    G.drawPiece = function(ctx, x, y, owner, enhanced) {
        const radius = G.CELL_SIZE * 0.38;
        var r = radius;
        // ── 三层阴影系统 ──
        // 外层环境光遮蔽（带颜色倾向）
        var shadowColor = owner === 'blue' ? '8,20,40' : '40,8,12';
        var aoGrad = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.7);
        aoGrad.addColorStop(0, 'rgba(' + shadowColor + ',0.18)');
        aoGrad.addColorStop(0.5, 'rgba(' + shadowColor + ',0.06)');
        aoGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = aoGrad;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.7, 0, Math.PI * 2);
        ctx.fill();
        // 中层柔和接触阴影
        var contactGrad = ctx.createRadialGradient(x + 1.5, y + 2, r * 0.5, x + 1.5, y + 2, r * 1.15);
        contactGrad.addColorStop(0, 'rgba(0,0,0,0.28)');
        contactGrad.addColorStop(0.7, 'rgba(0,0,0,0.08)');
        contactGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = contactGrad;
        ctx.beginPath();
        ctx.arc(x + 1.5, y + 2, r * 1.15, 0, Math.PI * 2);
        ctx.fill();
        // 内层底部微反光（提升立体感）
        var rimGrad = ctx.createRadialGradient(x, y + r * 0.6, r * 0.05, x, y + r * 0.6, r * 0.5);
        rimGrad.addColorStop(0, 'rgba(255,255,255,0.06)');
        rimGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rimGrad;
        ctx.beginPath();
        ctx.arc(x, y + r * 0.6, r * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // ── 主体渐变 ──
        var grad = ctx.createRadialGradient(
            x - r * 0.3, y - r * 0.35, r * 0.07, x, y, r);
        if (owner === 'blue') {
            grad.addColorStop(0, '#f0fcff');
            grad.addColorStop(0.25, '#b8eeff');
            grad.addColorStop(0.5, '#48c0ec');
            grad.addColorStop(0.75, '#0e82be');
            grad.addColorStop(1, '#05466c');
        } else {
            grad.addColorStop(0, '#fff2f2');
            grad.addColorStop(0.25, '#ffb8b8');
            grad.addColorStop(0.5, '#ec4848');
            grad.addColorStop(0.75, '#a81428');
            grad.addColorStop(1, '#560a14');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // ── 边缘微反射环 ──
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
        ctx.stroke();

        // ── 双高光 ──
        // 主高光（左上）
        var hlGrad = ctx.createRadialGradient(
            x - r * 0.25, y - r * 0.3, r * 0.02, x, y, r);
        hlGrad.addColorStop(0, 'rgba(255,255,255,0.70)');
        hlGrad.addColorStop(0.2, 'rgba(255,255,255,0.35)');
        hlGrad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
        hlGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = hlGrad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // 次级散射光（右下微反）
        var rlGrad = ctx.createRadialGradient(
            x + r * 0.25, y + r * 0.3, r * 0.02, x, y, r);
        rlGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
        rlGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rlGrad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // ── 增强棋子：双层光环 + 6角星 + 微粒 ──
        if (enhanced) {
            var pulse = 0.65 + Math.sin(performance.now() / 900 + x * 0.01 + y * 0.01) * 0.35;
            // 内亮层
            var envGrad1 = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.05);
            envGrad1.addColorStop(0, 'rgba(100,255,150,0)');
            envGrad1.addColorStop(0.6, 'rgba(100,255,150,' + (0.5 * pulse) + ')');
            envGrad1.addColorStop(1, 'rgba(100,255,180,0)');
            ctx.fillStyle = envGrad1;
            ctx.beginPath(); ctx.arc(x, y, r * 1.05, 0, Math.PI * 2); ctx.fill();
            // 外扩散层
            var envGrad2 = ctx.createRadialGradient(x, y, r * 1.0, x, y, r * 1.3);
            envGrad2.addColorStop(0, 'rgba(100,255,150,0)');
            envGrad2.addColorStop(0.5, 'rgba(100,255,150,' + (0.2 * pulse) + ')');
            envGrad2.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = envGrad2;
            ctx.beginPath(); ctx.arc(x, y, r * 1.3, 0, Math.PI * 2); ctx.fill();
            // 6角星
            G.drawStar(ctx, x, y, r * 0.28, 6, 'rgba(170,255,200,' + (0.5 + pulse * 0.3) + ')');
            // 旋转微粒（3颗）
            for (var ei = 0; ei < 3; ei++) {
                var eAngle = (ei / 3) * Math.PI * 2 + performance.now() / 2500;
                var eDist = r * 1.2;
                ctx.fillStyle = 'rgba(180,255,220,' + (0.5 * pulse) + ')';
                ctx.beginPath();
                ctx.arc(x + Math.cos(eAngle) * eDist, y + Math.sin(eAngle) * eDist, 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    };

    /** V4.0 灼魂光环——红色脉动火环 + 微粒旋转 */
    G.drawSoulBurnMark = function(ctx, x, y, r, c) {
        var pulse = 0.6 + Math.sin(performance.now() / 350 + r + c) * 0.4;
        var rad = G.CELL_SIZE * 0.44;
        ctx.strokeStyle = 'rgba(255,100,40,' + (0.55 * pulse) + ')';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(255,80,20,0.5)';
        ctx.shadowBlur = 8 * pulse;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,180,80,' + (0.35 * pulse) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, rad - 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        var nowMs = performance.now();
        for (var fi = 0; fi < 6; fi++) {
            var fAngle = (fi / 6) * Math.PI * 2 + nowMs / 1800;
            var fx = x + Math.cos(fAngle) * rad * 1.05;
            var fy = y + Math.sin(fAngle) * rad * 1.05;
            ctx.fillStyle = 'rgba(255,160,40,' + (0.5 + Math.sin(nowMs / 280 + fi) * 0.5) + ')';
            ctx.beginPath();
            ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    G.drawSealedStone = function(ctx, x, y) {
        const r = G.CELL_SIZE * 0.38;
        const seed = Math.floor(x * 31 + y * 73);
        const rand = G.seededRandom(seed);
        const baseGrad = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.05, x, y, r);
        baseGrad.addColorStop(0, '#4a4a55');
        baseGrad.addColorStop(0.45, '#282832');
        baseGrad.addColorStop(1, '#121218');
        ctx.fillStyle = baseGrad;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const offset = r * (0.85 + rand() * 0.3);
            const px = x + Math.cos(angle) * offset;
            const py = y + Math.sin(angle) * offset;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,100,220,0.5)';
        ctx.lineWidth = 1;
        ctx.shadowColor = 'rgba(160,100,220,0.35)';
        ctx.shadowBlur = 3;
        for (let c2 = 0; c2 < 2; c2++) {
            const baseAngle = rand() * Math.PI * 2;
            ctx.beginPath();
            for (let seg = 0; seg < 4; seg++) {
                const t = (seg / 3) * 2 - 1;
                const dist = t * r * 0.72;
                const jitter = (rand() - 0.5) * r * 0.25;
                const px = x + Math.cos(baseAngle) * dist + Math.cos(baseAngle + Math.PI / 2) * jitter;
                const py = y + Math.sin(baseAngle) * dist + Math.sin(baseAngle + Math.PI / 2) * jitter;
                if (seg === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(200,180,220,0.3)';
        ctx.lineWidth = 0.8;
        const dm = r * 0.15;
        ctx.beginPath();
        ctx.moveTo(x, y - dm);
        ctx.lineTo(x + dm * 0.7, y);
        ctx.lineTo(x, y + dm);
        ctx.lineTo(x - dm * 0.7, y);
        ctx.closePath();
        ctx.stroke();
    };

    G.drawGhostPiece = function(ctx, x, y, owner) {
        var radius = G.CELL_SIZE * 0.38;
        var pulseAlpha = 0.4 + Math.sin(performance.now() / 600) * 0.1;
        ctx.save();
        ctx.globalAlpha = pulseAlpha;
        // 柔光投影
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath();
        ctx.arc(x + 1.5, y + 2, radius * 1.05, 0, Math.PI * 2);
        ctx.fill();
        // 主体渐变
        var grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.07, x, y, radius);
        if (owner === 'blue') {
            grad.addColorStop(0, '#e8faff');
            grad.addColorStop(0.3, '#a0e5ff');
            grad.addColorStop(0.55, '#38b8e8');
            grad.addColorStop(0.75, '#0c7eb8');
            grad.addColorStop(1, '#064a6e');
        } else {
            grad.addColorStop(0, '#ffe8e8');
            grad.addColorStop(0.3, '#ffa5a5');
            grad.addColorStop(0.55, '#e84040');
            grad.addColorStop(0.75, '#a01020');
            grad.addColorStop(1, '#5a0812');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // 脉动光环
        var glowColor = owner === 'blue' ? 'rgba(0,200,255,' : 'rgba(255,80,100,';
        var ringPulse = 0.5 + Math.sin(performance.now() / 500) * 0.3;
        ctx.strokeStyle = glowColor + (0.5 * ringPulse) + ')';
        ctx.lineWidth = 1.5 + ringPulse * 0.8;
        ctx.shadowColor = glowColor + (0.4 * ringPulse) + ')';
        ctx.shadowBlur = 6 * ringPulse;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -performance.now() / 200;
        ctx.beginPath();
        ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
    };

    G.drawStar = function(ctx, cx, cy, r, points, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const angle = (i * Math.PI) / points - Math.PI / 2;
            const radius = i % 2 === 0 ? r : r * 0.4;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
    };

    G.drawEnvElement = function(ctx, x, y, alpha, scale) {
        alpha = alpha ?? 0.8;
        scale = scale ?? 1;
        const pulse = 1 + Math.sin(performance.now() / 1100) * 0.14;
        const r = G.CELL_SIZE * 0.18 * scale * pulse;
        const glowGrad = ctx.createRadialGradient(x, y, r * 0.25, x, y, r * 2.2);
        glowGrad.addColorStop(0, 'rgba(140,255,180,' + (0.45 * alpha) + ')');
        glowGrad.addColorStop(0.5, 'rgba(100,220,150,' + (0.2 * alpha) + ')');
        glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(180,255,210,' + (0.7 * alpha) + ')';
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.65, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.65, y);
        ctx.closePath();
        ctx.fill();
    };

    // ================================================================
    // V4.0 新增绘制函数
    // ================================================================

    /** V4.0 深渊之羽——双翼展开形态 */
    G.drawFeather = function(ctx, x, y, owner, hp, maxHp) {
        var rad = G.CELL_SIZE * 0.55;
        var alpha = 0.75 + Math.sin(performance.now() / 1200) * 0.15;
        var baseRgb = owner === 'blue' ? '92,224,255' : '255,96,80';
        var nowMs = performance.now();
        var wingSway = Math.sin(nowMs / 1500 + x * 0.02) * 3;

        // 双翼——两个对称椭圆
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(wingSway * Math.PI / 180);

        // 左翼
        var lGrad = ctx.createLinearGradient(0, -rad * 0.3, -rad * 1.1, -rad * 0.8);
        lGrad.addColorStop(0, 'rgba(' + baseRgb + ',' + (0.55 * alpha) + ')');
        lGrad.addColorStop(0.6, 'rgba(' + baseRgb + ',' + (0.2 * alpha) + ')');
        lGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lGrad;
        ctx.beginPath();
        ctx.ellipse(-rad * 0.5, -rad * 0.2, rad * 0.8, rad * 0.28, -0.4, 0, Math.PI * 2);
        ctx.fill();
        // 左翅脉
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.2 * alpha) + ')';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(-2, -rad * 0.3);
        ctx.lineTo(-rad * 0.9, -rad * 0.5);
        ctx.moveTo(-2, -rad * 0.15);
        ctx.lineTo(-rad * 0.7, -rad * 0.1);
        ctx.stroke();

        // 右翼
        var rGrad = ctx.createLinearGradient(0, -rad * 0.3, rad * 1.1, -rad * 0.8);
        rGrad.addColorStop(0, 'rgba(' + baseRgb + ',' + (0.55 * alpha) + ')');
        rGrad.addColorStop(0.6, 'rgba(' + baseRgb + ',' + (0.2 * alpha) + ')');
        rGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rGrad;
        ctx.beginPath();
        ctx.ellipse(rad * 0.5, -rad * 0.2, rad * 0.8, rad * 0.28, 0.4, 0, Math.PI * 2);
        ctx.fill();
        // 右翅脉
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.2 * alpha) + ')';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(2, -rad * 0.3);
        ctx.lineTo(rad * 0.9, -rad * 0.5);
        ctx.moveTo(2, -rad * 0.15);
        ctx.lineTo(rad * 0.7, -rad * 0.1);
        ctx.stroke();

        // 本体光球（核心）
        var bodyGrad = ctx.createRadialGradient(0, -2, rad * 0.08, 0, 0, rad * 0.7);
        bodyGrad.addColorStop(0, 'rgba(255,255,255,' + (0.9 * alpha) + ')');
        bodyGrad.addColorStop(0.35, 'rgba(' + baseRgb + ',' + (0.7 * alpha) + ')');
        bodyGrad.addColorStop(0.7, 'rgba(' + baseRgb + ',' + (0.25 * alpha) + ')');
        bodyGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(0, 0, rad * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // "羽"字
        ctx.fillStyle = 'rgba(255,255,255,' + (0.85 * alpha) + ')';
        ctx.font = 'bold 11px "Inter","PingFang SC",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('羽', x, y + 4);
        ctx.textAlign = 'start';

        // HP 条——加宽加框
        var barWidth = 40;
        var barHeight = 5;
        var barX = x - barWidth / 2;
        var barY = y + rad + 8;
        // 背景
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
        // HP条
        var hpRatio = Math.max(0, hp / maxHp);
        var hpGrad = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        hpGrad.addColorStop(0, owner === 'blue' ? 'rgba(0,200,255,0.9)' : 'rgba(255,80,80,0.9)');
        hpGrad.addColorStop(1, owner === 'blue' ? 'rgba(0,140,200,0.7)' : 'rgba(180,40,50,0.7)');
        ctx.fillStyle = hpGrad;
        ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
        // 外框
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(barX, barY, barWidth, barHeight);

        // 锚点光圈（连接羽与棋盘）
        ctx.fillStyle = 'rgba(' + baseRgb + ',0.15)';
        ctx.beginPath();
        ctx.arc(x, y + rad + 14, rad * 0.25, 0, Math.PI * 2);
        ctx.fill();
    };

    /** 侵蚀印记——紫色裂纹 overlay + 暗色腐蚀面 */
    G.drawErosionMark = function(ctx, x, y) {
        var r = G.CELL_SIZE * 0.42;
        var seedVal = Math.floor(x * 31 + y * 73);
        var rand = G.seededRandom(seedVal);
        var pulse = 0.5 + Math.sin(performance.now() / 700 + seedVal * 0.01) * 0.3;

        // 暗紫色半透明腐蚀面overlay
        var overlayGrad = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 0.9);
        overlayGrad.addColorStop(0, 'rgba(80,20,120,' + (0.35 * pulse) + ')');
        overlayGrad.addColorStop(0.6, 'rgba(50,10,80,' + (0.25 * pulse) + ')');
        overlayGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = overlayGrad;
        ctx.beginPath();
        // 不规则多边形腐蚀面
        for (var vi = 0; vi < 7; vi++) {
            var vAngle = (vi / 7) * Math.PI * 2;
            var vR = r * (0.55 + rand() * 0.45);
            var vx = x + Math.cos(vAngle) * vR;
            var vy = y + Math.sin(vAngle) * vR;
            if (vi === 0) ctx.moveTo(vx, vy);
            else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.fill();

        // 发光裂纹
        ctx.strokeStyle = 'rgba(160,60,200,' + (0.6 * pulse) + ')';
        ctx.lineWidth = 1.8;
        ctx.shadowColor = 'rgba(140,40,180,0.5)';
        ctx.shadowBlur = 5 * pulse;

        var baseAngles = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2];
        for (var ci = 0; ci < 3; ci++) {
            var angle = baseAngles[ci];
            ctx.beginPath();
            ctx.moveTo(x, y);
            // 主裂纹
            var d1 = r * (0.3 + rand() * 0.4);
            var px1 = x + Math.cos(angle) * d1;
            var py1 = y + Math.sin(angle) * d1;
            ctx.lineTo(px1, py1);
            // 分枝裂纹
            var d2 = r * (0.5 + rand() * 0.3);
            var branchAngle = angle + (rand() - 0.5) * 0.8;
            var px2 = px1 + Math.cos(branchAngle) * (d2 - d1) * (0.4 + rand() * 0.3);
            var py2 = py1 + Math.sin(branchAngle) * (d2 - d1) * (0.4 + rand() * 0.3);
            ctx.moveTo(px1, py1);
            ctx.lineTo(px2, py2);
            ctx.stroke();

            // 裂纹节点闪烁
            if (pulse > 0.6) {
                ctx.fillStyle = 'rgba(200,100,255,' + (0.7 * pulse) + ')';
                ctx.shadowColor = 'rgba(200,100,255,0.8)';
                ctx.shadowBlur = 3 * pulse;
                ctx.beginPath();
                ctx.arc(px1, py1, 1.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
        ctx.shadowBlur = 0;
    };

    /** V4.0 贯穿激光残留——核心亮线+外层辉光+末端散射 */
    G.drawPenetrationLasers = function(ctx) {
        var now = performance.now();
        var alive = [];
        var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (var i = 0; i < G.penetrationLasers.length; i++) {
            var laser = G.penetrationLasers[i];
            var elapsed = now - laser.startTime;
            if (elapsed >= laser.duration) continue;
            alive.push(laser);
            var alpha = 1 - elapsed / laser.duration;
            var pos = G.gridToPos(laser.r, laser.c);

            for (var d = 0; d < dirs.length; d++) {
                var dr = dirs[d][0], dc = dirs[d][1];
                // 计算射线到棋盘边缘的终点
                var steps = 0;
                var endR = laser.r, endC = laser.c;
                while (true) {
                    var nr = laser.r + dr * (steps + 1), nc = laser.c + dc * (steps + 1);
                    if (nr < 0 || nr >= G.BOARD_SIZE || nc < 0 || nc >= G.BOARD_SIZE) break;
                    endR = nr; endC = nc; steps++;
                }
                if (steps === 0) continue;
                var ep = G.gridToPos(endR, endC);

                // 外层辉光
                ctx.strokeStyle = 'rgba(140,255,180,' + (0.3 * alpha) + ')';
                ctx.lineWidth = 5 * alpha;
                ctx.shadowColor = 'rgba(140,255,180,' + (0.4 * alpha) + ')';
                ctx.shadowBlur = 10 * alpha;
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(ep.x, ep.y);
                ctx.stroke();
                ctx.shadowBlur = 0;

                // 核心亮线
                ctx.strokeStyle = 'rgba(220,255,230,' + (0.7 * alpha) + ')';
                ctx.lineWidth = 1.5 * alpha;
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(ep.x, ep.y);
                ctx.stroke();

                // 能量节点脉冲（沿射线每2格一个脉冲点）
                for (var step = 2; step <= steps; step += 2) {
                    var nr2 = laser.r + dr * step, nc2 = laser.c + dc * step;
                    if (nr2 < 0 || nr2 >= G.BOARD_SIZE || nc2 < 0 || nc2 >= G.BOARD_SIZE) break;
                    var np = G.gridToPos(nr2, nc2);
                    var nodeAlpha = alpha * (0.5 + Math.sin(now / 200 + step) * 0.5);
                    var nodeGrad = ctx.createRadialGradient(np.x, np.y, 0, np.x, np.y, 4);
                    nodeGrad.addColorStop(0, 'rgba(200,255,220,' + nodeAlpha + ')');
                    nodeGrad.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = nodeGrad;
                    ctx.beginPath();
                    ctx.arc(np.x, np.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                }

                // 末端散射光点
                var endAlpha = alpha * (0.4 + Math.sin(now / 150 + d * laser.r) * 0.3);
                var endGrad = ctx.createRadialGradient(ep.x, ep.y, 0, ep.x, ep.y, 8);
                endGrad.addColorStop(0, 'rgba(180,255,200,' + endAlpha + ')');
                endGrad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = endGrad;
                ctx.beginPath();
                ctx.arc(ep.x, ep.y, 8 * alpha, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        G.penetrationLasers = alive;
    };

    G.drawAttackBeams = function(ctx) {
        if (!G.pendingAttack || !G.pendingAttack.cells || G.pendingAttack.cells.length < 2) return;
        const cells = G.pendingAttack.cells;
        const isBlue = G.pendingAttack.attacker === 'blue';
        const beamColor = isBlue ? 'rgba(0,200,255,' : 'rgba(255,60,80,';
        const dir = G.pendingAttack.directions?.[0];
        const sorted = dir
            ? [...cells].sort((a, b) => (a.r * dir.dr + a.c * dir.dc) - (b.r * dir.dr + b.c * dir.dc))
            : cells;
        if (sorted.length < 2) return;
        ctx.strokeStyle = beamColor + '0.25)';
        ctx.lineWidth = 5;
        ctx.shadowColor = isBlue ? 'rgba(0,180,255,0.45)' : 'rgba(220,50,70,0.45)';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        const first = G.gridToPos(sorted[0].r, sorted[0].c);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < sorted.length; i++) {
            const p = G.gridToPos(sorted[i].r, sorted[i].c);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = beamColor + '0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < sorted.length; i++) {
            const p = G.gridToPos(sorted[i].r, sorted[i].c);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        const now2 = performance.now();
        for (const cell of sorted) {
            const p = G.gridToPos(cell.r, cell.c);
            const pulse = 0.6 + Math.sin(now2 / 300 + cell.r + cell.c) * 0.4;
            const nodeGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, G.CELL_SIZE * 0.32);
            nodeGrad.addColorStop(0, (isBlue ? 'rgba(100,230,255,' : 'rgba(255,120,140,') + (0.5 * pulse) + ')');
            nodeGrad.addColorStop(1, (isBlue ? 'rgba(100,230,255,0)' : 'rgba(255,120,140,0)'));
            ctx.fillStyle = nodeGrad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, G.CELL_SIZE * 0.32, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    G.addEnvSpawnAnim = function(cells) {
        const now = performance.now();
        for (const cell of cells)
            G.envSpawnAnims.push({ r: cell.r, c: cell.c, startTime: now, duration: 550 });
    };

    console.log('[render.js] V4.0 Canvas 渲染引擎 已加载');
})(window.G);

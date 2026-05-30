/**
 * particles.js — PHAETHON V4.0 粒子特效系统
 *
 * 职责：
 *   1. 粒子生成——8 种粒子类型（含 V4 新增羽相关）
 *   2. 粒子更新——每帧计算位置/生命/动画状态
 *   3. 粒子绘制——Canvas 渲染不同类型粒子
 *
 * V4.0 新增：羽召唤/引爆/贯穿激光/Debuff施加粒子
 *
 * 依赖：G.js（常量、G.particles 数组、G.stageEl）
 * 被依赖：logic.js（攻击特效）, render.js（绘制）, main.js（游戏循环）
 */
(function(G) {

    // ================================================================
    // 爆发粒子
    // ================================================================
    G.spawnBurstParticles = function(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 35 + Math.random() * 100;
            G.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.45 + Math.random() * 0.6,
                maxLife: 0.45 + Math.random() * 0.6,
                color, size: 2 + Math.random() * 3.5,
                type: 'burst',
            });
        }
    };

    // ================================================================
    // 涟漪粒子
    // ================================================================
    G.spawnRippleParticles = function(x, y, color) {
        const count = 12;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const speed = 22 + Math.random() * 20;
            G.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.4 + Math.random() * 0.3,
                maxLife: 0.4 + Math.random() * 0.3,
                color, size: 1.4 + Math.random() * 2,
                type: 'ripple_ring',
                radius: 0,
                maxRadius: 14 + Math.random() * 12,
            });
        }
    };

    // ================================================================
    // 攻击粒子
    // ================================================================
    G.spawnAttackParticles = function(cells, player) {
        const color = player === 'blue' ? 'rgb(0,200,255)' : 'rgb(255,60,80)';
        for (const cell of cells) {
            const pos = G.gridToPos(cell.r, cell.c);
            const tx = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2;
            const ty = player === 'blue'
                ? G.PAD - 25
                : G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE + 25;
            for (let i = 0; i < 5; i++) {
                const t = Math.random();
                const mx = pos.x + (tx - pos.x) * t + (Math.random() - 0.5) * 25;
                const my = pos.y + (ty - pos.y) * t + (Math.random() - 0.5) * 25;
                G.particles.push({
                    x: pos.x, y: pos.y,
                    vx: (mx - pos.x) / 0.22,
                    vy: (my - pos.y) / 0.22,
                    life: 0.35 + Math.random() * 0.45,
                    maxLife: 0.35 + Math.random() * 0.45,
                    color, size: 2 + Math.random() * 4,
                    type: 'attack_bolt',
                    targetX: tx, targetY: ty,
                    phase: 'fly',
                });
                for (let j = 0; j < 2; j++) {
                    G.particles.push({
                        x: pos.x + (Math.random() - 0.5) * 8,
                        y: pos.y + (Math.random() - 0.5) * 8,
                        vx: (mx - pos.x) / 0.35 + (Math.random() - 0.5) * 40,
                        vy: (my - pos.y) / 0.35 + (Math.random() - 0.5) * 40,
                        life: 0.15 + Math.random() * 0.25,
                        maxLife: 0.15 + Math.random() * 0.25,
                        color, size: 1 + Math.random() * 2.5,
                        type: 'attack_bolt',
                        targetX: tx, targetY: ty,
                        phase: 'fly',
                    });
                }
            }
        }
    };

    // ================================================================
    // 伤害数字弹出
    // ================================================================
    G.spawnDamagePopup = function(targetPlayer, dmg) {
        var pos = targetPlayer === 'blue'
            ? { x: G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2, y: G.PAD - 8 }
            : { x: G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2, y: G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE + 8 };
        var color = targetPlayer === 'blue' ? '#00ffff' : '#ff3b5c';
        G.particles.push({
            x: pos.x, y: pos.y,
            vx: 0,
            vy: targetPlayer === 'blue' ? -30 : 30,
            life: 1.0, maxLife: 1.0,
            color: color, size: 18,
            type: 'dmg_text',
            text: '-' + dmg,
        });
        // V4.1 命中微粒子
        for (var i = 0; i < 5; i++) {
            var a = Math.random() * Math.PI * 2;
            G.particles.push({
                x: pos.x, y: pos.y,
                vx: Math.cos(a) * (30 + Math.random() * 40),
                vy: Math.sin(a) * (30 + Math.random() * 40),
                life: 0.25 + Math.random() * 0.3,
                maxLife: 0.25 + Math.random() * 0.3,
                color: color, size: 1.5 + Math.random() * 2,
                type: 'burst',
            });
        }
        G.stageEl.classList.add('shake');
        setTimeout(function() { G.stageEl.classList.remove('shake'); }, 400);
    };

    // ================================================================
    // 棋子放置涟漪
    // ================================================================
    G.spawnPlaceRipple = function(x, y, owner) {
        var color = owner === 'blue' ? 'rgba(0,200,255,' : 'rgba(255,80,100,';
        // 扩张环
        G.particles.push({
            x: x, y: y, vx: 0, vy: 0,
            life: 0.4, maxLife: 0.4,
            color: color + '0.5)',
            size: 2,
            type: 'shockwave',
            radius: 2, maxRadius: G.CELL_SIZE * 0.8,
        });
        // 微光粒子
        for (var i = 0; i < 4; i++) {
            var a = Math.random() * Math.PI * 2;
            var spd = 15 + Math.random() * 25;
            G.particles.push({
                x: x, y: y,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd,
                life: 0.2 + Math.random() * 0.2,
                maxLife: 0.2 + Math.random() * 0.2,
                color: color + (0.4 + Math.random() * 0.3) + ')',
                size: 1 + Math.random() * 1.5,
                type: 'burst',
            });
        }
    };

    // ================================================================
    // 冲击波
    // ================================================================
    G.shockwaveEffect = function() {
        const cx = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2;
        const cy = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2;
        G.particles.push({
            x: cx, y: cy, vx: 0, vy: 0,
            life: 0.6, maxLife: 0.6,
            color: 'rgba(255,255,255,0.7)', size: 6,
            type: 'shockwave',
            radius: 6,
            maxRadius: 340,
        });
        G.stageEl.classList.add('shake');
        setTimeout(() => G.stageEl.classList.remove('shake'), 400);
    };

    G.shockwaveEffectAt = function(x, y) {
        G.particles.push({
            x, y, vx: 0, vy: 0,
            life: 0.5, maxLife: 0.5,
            color: 'rgba(156,255,122,0.6)', size: 3,
            type: 'shockwave',
            radius: 3, maxRadius: 140,
        });
    };

    // ================================================================
    // V4.0 羽召唤粒子——羽毛碎片飘入聚合
    // ================================================================
    G.spawnFeatherSummonParticles = function(x, y, owner) {
        var baseRgb = owner === 'blue' ? '92,224,255' : '255,96,80';
        for (var i = 0; i < 36; i++) {
            var angle = Math.random() * Math.PI * 2;
            var dist = 50 + Math.random() * 90;
            G.particles.push({
                x: x + Math.cos(angle) * dist,
                y: y + Math.sin(angle) * dist - 20,
                vx: (x - (x + Math.cos(angle) * dist)) / 0.8 * (0.8 + Math.random() * 0.4),
                vy: (y - (y + Math.sin(angle) * dist - 20)) / 0.8 * (0.8 + Math.random() * 0.4),
                life: 0.7 + Math.random() * 0.5,
                maxLife: 0.7 + Math.random() * 0.5,
                color: 'rgb(' + baseRgb + ')',
                size: 2 + Math.random() * 4,
                type: 'feather_fragment',
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 8,
                targetX: x, targetY: y,
                w: 3 + Math.random() * 2, h: 1.2 + Math.random() * 1,
            });
        }
        // 融合闪光
        G.particles.push({
            x: x, y: y, vx: 0, vy: 0,
            life: 0.25, maxLife: 0.25,
            color: 'rgba(255,255,255,0.9)', size: 3,
            type: 'shockwave',
            radius: 3, maxRadius: 50,
        });
    };

    // ================================================================
    // V4.0 羽引爆粒子——螺旋碎片 + 核心白闪 + 余烬
    // ================================================================
    G.spawnFeatherDetonationParticles = function(x, y, owner) {
        var baseRgb = owner === 'blue' ? '92,224,255' : '255,96,80';
        // 大型冲击波
        G.particles.push({
            x: x, y: y, vx: 0, vy: 0,
            life: 0.8, maxLife: 0.8,
            color: 'rgba(255,255,255,0.9)', size: 6,
            type: 'shockwave',
            radius: 8, maxRadius: 420,
        });
        // 核心白闪
        G.particles.push({
            x: x, y: y, vx: 0, vy: 0,
            life: 0.15, maxLife: 0.15,
            color: 'rgba(255,255,255,0.95)', size: 15,
            type: 'feather_flash',
        });
        // 螺旋碎片
        for (var i = 0; i < 40; i++) {
            var angle = (i / 40) * Math.PI * 2 * 2.5; // 2.5圈螺旋
            var speed = 40 + (i / 40) * 200; // 外圈更快
            G.particles.push({
                x: x, y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 20,
                life: 0.4 + Math.random() * 0.9,
                maxLife: 0.4 + Math.random() * 0.9,
                color: 'rgb(' + baseRgb + ')',
                size: 2.5 + Math.random() * 5,
                type: 'feather_detonation',
                rotation: angle,
                rotSpeed: (Math.random() - 0.5) * 12,
            });
        }
        // 余烬（慢速下坠小点）
        for (var j = 0; j < 18; j++) {
            G.particles.push({
                x: x + (Math.random() - 0.5) * 30,
                y: y + (Math.random() - 0.5) * 20,
                vx: (Math.random() - 0.5) * 30,
                vy: -20 + Math.random() * -40,
                life: 1.5 + Math.random() * 1.0,
                maxLife: 1.5 + Math.random() * 1.0,
                color: 'rgba(255,180,60,0.7)',
                size: 1 + Math.random() * 2,
                type: 'feather_ember',
            });
        }
        G.stageEl.classList.add('shake');
        setTimeout(function() { G.stageEl.classList.remove('shake'); }, 500);
    };

    // ================================================================
    // V4.0 Debuff 施加粒子——真螺旋收缩
    // ================================================================
    G.spawnDebuffApplyParticles = function(x, y, debuffType) {
        var color = 'rgb(192,132,252)';
        if (debuffType === 'seal_premonition') color = 'rgb(255,120,40)';
        if (debuffType === 'erosion') color = 'rgb(160,60,200)';
        for (var i = 0; i < 12; i++) {
            var startAngle = (i / 12) * Math.PI * 2;
            var startR = 18 + Math.random() * 8;
            G.particles.push({
                x: x + Math.cos(startAngle) * startR,
                y: y + Math.sin(startAngle) * startR,
                vx: 0, vy: 0,
                life: 0.55 + Math.random() * 0.3,
                maxLife: 0.55 + Math.random() * 0.3,
                color: color,
                size: 2 + Math.random() * 3,
                type: 'debuff_spiral',
                centerX: x, centerY: y,
                startAngle: startAngle,
                startR: startR,
                angularSpeed: 4 + Math.random() * 3,
            });
        }
        // 小闪光
        G.particles.push({
            x: x, y: y, vx: 0, vy: 0,
            life: 0.2, maxLife: 0.2,
            color: 'rgba(255,255,255,0.6)', size: 2,
            type: 'shockwave',
            radius: 2, maxRadius: 18,
        });
    };

    // ================================================================
    // V4.0 贯穿激光粒子——沿射线快速飞行的光点
    // ================================================================
    G.spawnPenetrationBoltParticles = function(r, c, dr, dc) {
        var pos = G.gridToPos(r, c);
        // 计算方向上的终点
        var steps = 0;
        while (true) {
            var nr = r + dr * (steps + 1), nc = c + dc * (steps + 1);
            if (nr < 0 || nr >= G.BOARD_SIZE || nc < 0 || nc >= G.BOARD_SIZE) break;
            steps++;
        }
        var endR = r + dr * steps, endC = c + dc * steps;
        var endPos = G.gridToPos(endR, endC);
        var totalDist = Math.sqrt((endPos.x - pos.x) ** 2 + (endPos.y - pos.y) ** 2);

        for (var i = 0; i < 4; i++) {
            var t = Math.random();
            G.particles.push({
                x: pos.x + (endPos.x - pos.x) * t,
                y: pos.y + (endPos.y - pos.y) * t,
                vx: (endPos.x - pos.x) / 0.25,
                vy: (endPos.y - pos.y) / 0.25,
                life: 0.18 + Math.random() * 0.12,
                maxLife: 0.18 + Math.random() * 0.12,
                color: 'rgb(140,255,180)',
                size: 1.5 + Math.random() * 2,
                type: 'penetration_bolt',
            });
        }
    };

    // ================================================================
    // 粒子更新
    // ================================================================
    G.updateParticles = function(dt) {
        const alive = [];
        for (const p of G.particles) {
            p.life -= dt;
            if (p.life <= 0) continue;

            if (p.type === 'ripple_ring') {
                p.radius += (p.maxRadius / p.maxLife) * dt;
                p.x += p.vx * dt * 0.25;
                p.y += p.vy * dt * 0.25;
            } else if (p.type === 'attack_bolt') {
                if (p.phase === 'fly') {
                    const dx = p.targetX - p.x, dy = p.targetY - p.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 10) {
                        p.phase = 'impact';
                        p.life = Math.min(p.life, 0.18);
                        p.vx = (Math.random() - 0.5) * 40;
                        p.vy = (Math.random() - 0.5) * 40;
                    } else {
                        const speed = 260;
                        p.vx = (dx / dist) * speed + (Math.random() - 0.5) * 20;
                        p.vy = (dy / dist) * speed + (Math.random() - 0.5) * 20;
                    }
                }
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            } else if (p.type === 'shockwave') {
                p.radius += (p.maxRadius / p.maxLife) * dt;
            } else if (p.type === 'dmg_text') {
                p.y += p.vy * dt;
            } else if (p.type === 'feather_summon') {
                var dxF = p.targetX - p.x, dyF = p.targetY - p.y;
                p.vx += dxF * dt * 2;
                p.vy += dyF * dt * 2;
                p.vx *= 0.95;
                p.vy *= 0.95;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            } else if (p.type === 'feather_fragment') {
                var t = 1 - (p.life / p.maxLife);
                p.x += p.vx * (1 - t * 0.6) * dt;
                p.y += p.vy * (1 - t * 0.6) * dt;
                p.vy += 15 * dt;
                p.rotation += p.rotSpeed * dt;
            } else if (p.type === 'feather_ember') {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vy += 50 * dt; // 慢下坠
                p.vx *= 0.99;
            } else if (p.type === 'feather_flash') {
                // 白闪仅靠life衰减，不移动
            } else if (p.type === 'feather_detonation') {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vy += 70 * dt;
                p.rotation += p.rotSpeed * dt;
            } else if (p.type === 'penetration_bolt') {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            } else if (p.type === 'debuff_spiral') {
                // 真螺旋运动：绕中心点旋转+径向收缩
                var dx = p.x - p.centerX, dy = p.y - p.centerY;
                var currentR = Math.sqrt(dx * dx + dy * dy);
                var currentAngle = Math.atan2(dy, dx);
                var newAngle = currentAngle + p.angularSpeed * dt;
                var newR = currentR * (1 - dt * 3.5); // 收缩
                if (newR < 1) newR = 1;
                p.x = p.centerX + Math.cos(newAngle) * newR;
                p.y = p.centerY + Math.sin(newAngle) * newR;
            } else {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vy += 60 * dt;
            }
            alive.push(p);
        }
        G.particles = alive;
    };

    // ================================================================
    // 粒子绘制——含 V4 新增类型
    // ================================================================
    G.drawParticles = function(ctx) {
        for (const p of G.particles) {
            const alpha = Math.max(0, p.life / p.maxLife);
            if (p.type === 'ripple_ring') {
                var rr = p.radius > 0 ? p.radius : 0;
                ctx.strokeStyle = p.color.replace('rgb', 'rgba').replace(')', ',' + alpha + ')');
                ctx.lineWidth = 1.0 * alpha;
                ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, rr), 0, Math.PI * 2); ctx.stroke();
            } else if (p.type === 'shockwave') {
                var sr = p.radius > 0 ? p.radius : 1;
                var swColor = p.color || 'rgba(255,255,255,' + alpha + ')';
                ctx.strokeStyle = swColor.replace(/[\d.]+\)$/, alpha + ')');
                ctx.lineWidth = 3.5 * alpha;
                ctx.shadowColor = swColor.replace(/[\d.]+\)$/, (0.3 * alpha) + ')');
                ctx.shadowBlur = 6 * alpha;
                ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, sr), 0, Math.PI * 2); ctx.stroke();
                ctx.shadowBlur = 0;
            } else if (p.type === 'dmg_text') {
                ctx.font = 'bold 22px "Inter","PingFang SC",sans-serif';
                ctx.textAlign = 'center';
                // V4.1 描边文字
                ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                ctx.lineWidth = 3;
                ctx.strokeText(p.text, p.x, p.y);
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color; ctx.shadowBlur = 8 * alpha;
                ctx.fillText(p.text, p.x, p.y);
                ctx.shadowBlur = 0; ctx.textAlign = 'start';
            } else if (p.type === 'feather_detonation' || p.type === 'feather_fragment') {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                ctx.globalAlpha = alpha;
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 6 * alpha;
                var fw = p.w || p.size;
                var fh = p.h || (p.size / 3);
                ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
                ctx.shadowBlur = 0;
                ctx.restore();
            } else if (p.type === 'feather_ember') {
                ctx.fillStyle = p.color.replace('0.7', '' + (alpha * 0.7));
                ctx.shadowColor = 'rgba(255,130,30,' + (0.3 * alpha) + ')';
                ctx.shadowBlur = 3 * alpha;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            } else if (p.type === 'feather_flash') {
                var flashGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
                flashGrad.addColorStop(0, 'rgba(255,255,255,' + (alpha * 0.9) + ')');
                flashGrad.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = flashGrad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * alpha * 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.type === 'penetration_bolt') {
                ctx.fillStyle = p.color.replace('rgb', 'rgba').replace(')', ',' + alpha + ')');
                ctx.shadowColor = 'rgba(140,255,180,' + (0.6 * alpha) + ')';
                ctx.shadowBlur = 4 * alpha;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            } else if (p.type === 'feather_summon' || p.type === 'debuff_spiral') {
                var rgba = p.color.replace('rgb', 'rgba').replace(')', ',' + alpha + ')');
                ctx.fillStyle = rgba;
                ctx.shadowColor = rgba;
                ctx.shadowBlur = 5 * alpha;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            } else {
                var rgba2 = p.color.replace('rgb', 'rgba').replace(')', ',' + alpha + ')');
                ctx.fillStyle = rgba2;
                ctx.shadowColor = rgba2; ctx.shadowBlur = 4 * alpha;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * alpha), 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    };

    // ================================================================
    // 屏幕闪屏
    // ================================================================
    G.triggerScreenFlash = function(targetPlayer) {
        if (!G.screenFlash) return;
        const flash = G.screenFlash;
        flash.className = 'screen-flash ' + (targetPlayer === 'blue' ? 'blue' : 'red');
        flash.style.opacity = '1';
        flash.style.transition = 'none';
        requestAnimationFrame(function() {
            flash.style.transition = 'opacity 0.4s ease-out';
            flash.style.opacity = '0';
        });
    };

    // ================================================================
    // 环境氛围粒子
    // ================================================================
    G.spawnAmbientParticles = function() {
        for (let i = 0; i < 80; i++) {
            var tier = i < 20 ? 'slow' : i < 50 ? 'mid' : 'fast';
            var speed = tier === 'slow' ? (Math.random() - 0.5) * 1.5 :
                        tier === 'mid' ? (Math.random() - 0.5) * 3 :
                        (Math.random() - 0.5) * 5;
            G.ambientParticles.push({
                x: Math.random() * G.CANVAS_LOGICAL,
                y: Math.random() * G.CANVAS_LOGICAL,
                vx: speed,
                vy: speed * (0.5 + Math.random()),
                life: Infinity,
                maxLife: 1,
                size: 0.3 + Math.random() * 1.0,
                alphaBase: 0.05 + Math.random() * 0.12,
                hue: 25 + Math.random() * 40,
                sparkle: Math.random() < 0.15, // 15% 闪烁微粒
                sparklePhase: Math.random() * Math.PI * 2,
                sparkleSpeed: 0.3 + Math.random() * 1.5,
            });
        }
    };

    G.updateAmbientParticles = function(dt) {
        for (const p of G.ambientParticles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.x < -10) p.x = G.CANVAS_LOGICAL + 10;
            if (p.x > G.CANVAS_LOGICAL + 10) p.x = -10;
            if (p.y < -10) p.y = G.CANVAS_LOGICAL + 10;
            if (p.y > G.CANVAS_LOGICAL + 10) p.y = -10;
        }
    };

    G.drawAmbientParticles = function(ctx) {
        for (const p of G.ambientParticles) {
            var pulse = 1 + Math.sin(performance.now() / 2000 + p.x * 0.01) * 0.3;
            var alpha = p.alphaBase * pulse;
            if (p.sparkle) {
                alpha = p.alphaBase + Math.abs(Math.sin(performance.now() / 1500 * p.sparkleSpeed + p.sparklePhase)) * 0.25;
            }
            ctx.fillStyle = 'hsla(' + p.hue + ', 40%, 55%, ' + alpha + ')';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    // ================================================================
    // 胜利纸屑
    // ================================================================
    G.spawnWinConfetti = function(winner) {
        const cx = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2;
        const cy = G.PAD + (G.BOARD_SIZE - 1) * G.CELL_SIZE / 2;
        const colors = winner === 'blue'
            ? ['#00BFFF', '#00ffff', '#0088cc', '#5ce0ff', '#00d4ff']
            : winner === 'red'
            ? ['#DC143C', '#ff3b5c', '#ff6b80', '#e84040', '#ff2040']
            : ['#ffcc00', '#ffdd44', '#ffaa00', '#ffe866', '#ff9900'];
        const count = 70;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 80 + Math.random() * 300;
            G.winParticles.push({
                x: cx + (Math.random() - 0.5) * 40,
                y: cy + (Math.random() - 0.5) * 40,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                life: 1.2 + Math.random() * 2.5,
                maxLife: 1.2 + Math.random() * 2.5,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: 3 + Math.random() * 6,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 12,
                type: 'confetti',
            });
        }
    };

    G.updateWinParticles = function(dt) {
        const alive = [];
        for (const p of G.winParticles) {
            p.life -= dt;
            if (p.life <= 0) continue;
            p.vy += 120 * dt;
            p.vx *= 0.995;
            p.vy *= 0.995;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rotation += p.rotSpeed * dt;
            alive.push(p);
        }
        G.winParticles = alive;
    };

    G.drawWinParticles = function(ctx) {
        for (const p of G.winParticles) {
            const alpha = Math.max(0, p.life / p.maxLife);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 6 * alpha;
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            ctx.shadowBlur = 0;
            ctx.restore();
        }
    };

    G.spawnToastParticles = function(x, y, color) {
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const speed = 30 + Math.random() * 60;
            G.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.3 + Math.random() * 0.4,
                maxLife: 0.3 + Math.random() * 0.4,
                color: color.replace(')', ',') || color,
                size: 1.5 + Math.random() * 2.5,
                type: 'ripple_ring',
                radius: 0,
                maxRadius: 10 + Math.random() * 16,
            });
        }
    };

    console.log('[particles.js] V4.0 粒子特效系统 已加载');
})(window.G);

/**
 * G.js — PHAETHON V4.0 全局命名空间 + 游戏常量 + 坐标工具函数
 *
 * 职责：
 *   1. 创建 window.G 命名空间，所有模块通过 G 共享状态和方法
 *   2. 定义全部游戏常量（棋盘尺寸、HP、各种阈值）
 *   3. 提供坐标系统工具（像素 ↔ 逻辑坐标 ↔ 格子行列转换）
 *
 * V4.0 变化：真伤上限8、过载/阵眼改为伤害加成、新增深渊之羽与Buff/Debuff体系
 *
 * 依赖：无（最先加载）
 * 被依赖：所有其他模块
 */
window.G = window.G || {};

(function(G) {
    // ================================================================
    // 棋盘常量
    // ================================================================
    G.BOARD_SIZE = 15;
    G.CELL_SIZE = 35;
    G.PAD = 32;
    G.CANVAS_LOGICAL = G.PAD * 2 + G.CELL_SIZE * (G.BOARD_SIZE - 1);

    // ================================================================
    // 渲染常量
    // ================================================================
    G.SKETCH_JITTER = 0.4;

    // ================================================================
    // HP 与攻击常量
    // ================================================================
    G.MAX_HP = 50;
    G.PHAETHON_MIN = 4;
    G.THREE_LINE_MIN = 3;

    // ================================================================
    // V4.0 数值约束
    // ================================================================
    G.TRUE_DMG_CAP = 8;               // 所有真伤效果单次上限
    G.OVERLOAD_DAMAGE_BONUS = 5;      // 过载 PHAETHON 伤害+5（非真伤）
    G.OVERLOAD_EXTRA_SEAL = 1;        // 过载 PHAETHON 额外封印攻击线上1颗随机敌子
    G.EYE_DAMAGE_BONUS = 4;           // 阵眼 PHAETHON 伤害+4（非真伤）
    G.EYE_HP_HEAL = 3;                // 阵眼 PHAETHON 自身回复

    // ================================================================
    // 环境 / 充能 / 星轨贯穿常量
    // ================================================================
    G.ENV_SPAWN_COUNT = 2;
    G.ENV_MAX = 8;
    G.CHARGE_MAX = 3;
    G.CROSS_SEAL_CAP = 4;             // 星轨贯穿单次封印上限

    // ================================================================
    // 截击 / 过载常量
    // ================================================================
    G.OVERLOAD_THRESHOLD = 2;

    // ================================================================
    // 终局常量
    // ================================================================
    G.PHANTOM_EYE_TURN = 40;
    G.HYPOXIA_THRESHOLD = 169;

    // ================================================================
    // 深渊之羽常量
    // ================================================================
    G.FEATHER_BASE_HP = 20;           // 羽基础 HP
    G.FEATHER_ATY_HP_RATIO = 0.5;     // aty → 额外 HP 比率
    G.FEATHER_HP_DECAY = 5;           // 每回合衰减
    G.FEATHER_DAMAGE_SHARE_SELF = 0.4; // 玩家承受比率
    G.FEATHER_DAMAGE_SHARE_FEATHER = 0.3; // 羽承受比率
    G.FEATHER_MAX_FAST_ACTIONS = 2;   // 每羽快速行动上限
    G.FEATHER_DETONATE_MIN = 3;       // 引爆最少影响棋子数
    G.FEATHER_DETONATE_MAX = 5;       // 引爆最多影响棋子数
    G.FEATHER_SUMMON_MIN_PHANTOMS = 4; // 召唤所需暗子下限
    G.FEATHER_ATY_PER_ENEMY = 3;      // 每颗暗子相邻每敌的 aty 值

    // ================================================================
    // Buff 常量
    // ================================================================
    G.BUFF_SHARP_DAMAGE = 3;          // 锐利：每次 PHAETHON +3 伤害
    G.BUFF_SHARP_MAX_STACK = 2;       // 锐利最大层数
    G.BUFF_RESONANCE_DAMAGE = 2;      // 灵能共鸣：本回合连线 +2 伤害
    G.BUFF_SHELTER_REDUCTION = 2;     // 深渊庇护：受伤害额外 -2
    G.BUFF_LAST_STAND_SEAL_SKIP = 1;  // 绝地反击：可无视1封印棋子

    // ================================================================
    // Debuff 池——阵眼 PHAETHON 随机选取
    // ================================================================
    G.DEBUFF_POOL = ['soulfire', 'weakness', 'chaos', 'seal_premonition', 'abyss_resonance', 'time_reversal'];
    G.DEBUFF_DEFS = {
        soulfire:        { label:'魂火灼烧', desc:'回合开始扣2HP', type:'dot', damage:2, turns:3 },
        weakness:        { label:'虚弱诅咒', desc:'下次PHAETHON伤害-4', type:'once', ascPenalty:4 },
        chaos:           { label:'灵能紊乱', desc:'无法充能', type:'state', turns:2 },
        seal_premonition:{ label:'封印预感', desc:'下一颗落子被封印', type:'once', autoSeal:true },
        abyss_resonance: { label:'深渊共鸣', desc:'羽存活时回合开始多扣1HP', type:'dot', turns:2 },
        time_reversal:   { label:'时间回溯', desc:'turnCount暂停增长', type:'state', turns:1 },
    };

    // ================================================================
    // 自定义 Debuff 常量
    // ================================================================
    G.DEBUFF_INTERCEPT_WEAKNESS = 3;  // 截击后虚弱：下次PHAETHON-3
    G.DEBUFF_SEAL_MARK_TURNS = 1;     // 封印标记持续回合
    G.DEBUFF_SOUL_BURN_TURNS = 2;     // 灼魂持续回合
    G.DEBUFF_SOUL_BURN_PENALTY = 2;   // 灼魂：连线伤害-2
    G.DEBUFF_EROSION_TURNS = 3;       // 侵蚀印记持续回合
    G.DEBUFF_EROSION_DMG = 1;         // 侵蚀印记每回合伤害
    G.ABYSS_WITH_FEATHER_DMG = 1;     // 深渊共鸣：羽存活时多扣1HP

    // ================================================================
    // 羽引爆常量
    // ================================================================
    G.FEATHER_DETONATE_CONVERT_CHANCE = 0.5; // 转化概率
    G.FEATHER_FAST_ACTION_THRESHOLD = 10;    // 累计抵消每10点触发1次快速行动

    // ================================================================
    // 动画状态数组
    // ================================================================
    G.pieceSpawnAnims = [];
    G.ambientParticles = [];
    G.winParticles = [];
    G.enhancedPieceCount = 0;
    G.lastDeathCause = null;

    // ================================================================
    // 坐标工具函数
    // ================================================================

    G.keyRC = function(r, c) { return `${r},${c}`; };

    G.posToGrid = function(cx, cy) {
        const col = Math.round((cx - G.PAD) / G.CELL_SIZE);
        const row = Math.round((cy - G.PAD) / G.CELL_SIZE);
        if (col < 0 || col >= G.BOARD_SIZE || row < 0 || row >= G.BOARD_SIZE) return null;
        const dx = cx - (G.PAD + col * G.CELL_SIZE);
        const dy = cy - (G.PAD + row * G.CELL_SIZE);
        if (Math.sqrt(dx * dx + dy * dy) > G.CELL_SIZE * 0.44) return null;
        return { row, col };
    };

    G.gridToPos = function(row, col) {
        return { x: G.PAD + col * G.CELL_SIZE, y: G.PAD + row * G.CELL_SIZE };
    };

    G.getCanvasPos = function(e) {
        const rect = G.canvas.getBoundingClientRect();
        const scaleX = G.CANVAS_LOGICAL / rect.width;
        const scaleY = G.CANVAS_LOGICAL / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    };

    G.shuffleArr = function(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    };

    G.seededRandom = function(seed) {
        let s = seed | 0;
        return function() {
            s = (s * 1664525 + 1013904223) | 0;
            return ((s >>> 0) & 0x7FFFFFFF) / 0x7FFFFFFF;
        };
    };

    console.log('[G.js] V4.0 全局命名空间 + 常量 + 工具函数 已加载');
})(window.G);

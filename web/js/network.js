/**
 * network.js — PHAETHON V4.0 PvP 网络同步模块
 *
 * 职责：
 *   1. 通过 URL 参数检测 PvP 模式 (?mode=pvp)
 *   2. 连接 WebSocket，发送 join_session 加入已有对局
 *   3. 拦截玩家落子→发送 move 消息，接收对手落子→执行
 *   4. 处理对局结束、断线
 *
 * 依赖：G.js, state.js, logic.js, main.js
 * 加载顺序：在所有游戏模块之后
 */
(function(G) {
    var urlParams = new URLSearchParams(window.location.search);
    var mode = urlParams.get('mode');
    var isPvP = mode === 'pvp';

    G.isNetworkGame = isPvP;

    if (!isPvP) {
        console.log('[network.js] PvP未启用');
        return;
    }

    var token = urlParams.get('token') || localStorage.getItem('phaethon_token');
    var myColor = urlParams.get('color') || 'blue';
    var sessionId = urlParams.get('sid') || '';
    var opponentName = urlParams.get('opponent') || '对手';

    if (!token || !sessionId) {
        alert('缺少会话信息，请返回首页');
        window.location.href = '/';
        return;
    }

    G.opponentName = opponentName;
    G.myColor = myColor;
    G.ws = null;

    var wsUrl = 'ws://' + window.location.hostname + ':8000/ws/play?token=' + token;
    G.ws = new WebSocket(wsUrl);

    G.ws.onopen = function() {
        console.log('[network.js] WebSocket 已连接 · 颜色: ' + myColor);
        G.logMsg('sys', '🔗 已连接到对局服务器 · 对手: ' + opponentName);
        // 加入已创建的会话
        G.ws.send(JSON.stringify({ type: 'join_session', session_id: sessionId, color: myColor }));
        if (myColor === 'blue') {
            G.setStatus('你执蓝先手 · 对手: ' + opponentName);
        } else {
            G.setStatus('你执红后手 · 对手: ' + opponentName + ' · 等待对方落子');
        }
    };

    G.ws.onmessage = function(e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }

        switch (msg.type) {
            case 'ready':
                G.logMsg('sys', '✅ ' + msg.message);
                break;

            case 'opponent_move':
                var r = msg.row, c = msg.col;
                G.logMsg('sys', '↘ 对手落子于(' + c + ',' + r + ')');
                G.handleTurn(r, c, true); // skipAICheck=true 强制执行
                G.setStatus('你的回合 · 对手: ' + opponentName);
                G.needsRender = true;
                break;

            case 'game_over':
                var winner = msg.winner;
                var reason = msg.reason || 'normal';
                G.logMsg('sys', '=== 对局结束 === 胜者: ' + winner + ' (' + reason + ')');
                G.toastMsg(winner + ' WINS!', winner === G.myColor ? '#9cff7a' : '#ff3b5c');
                break;

            case 'error':
                G.logMsg('warn', '⚠ ' + msg.msg);
                break;
        }
    };

    G.ws.onerror = function() {
        G.logMsg('warn', '⚠ 连接错误');
    };

    G.ws.onclose = function() {
        G.logMsg('warn', '🔌 连接断开');
        G.setStatus('连接断开');
    };

    // ── 拦截玩家落子，发送到服务端 ──
    var originalHandleTurn = G.handleTurn;
    G.handleTurn = function(r, c, skipAICheck) {
        if (G.isNetworkGame && G.ws && G.ws.readyState === WebSocket.OPEN) {
            var isMyMove = !skipAICheck && G.currentPlayer === myColor;
            if (isMyMove) {
                G.ws.send(JSON.stringify({ type: 'move', row: r, col: c }));
            }
        }
        originalHandleTurn.call(G, r, c, skipAICheck);
    };

    console.log('[network.js] PvP 已就绪 · 会话:' + sessionId + ' · 颜色:' + myColor);
})(window.G);

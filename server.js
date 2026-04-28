const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 11466;
const DICE_BASE_ANIMATION_MS = 800;
const DICE_STEP_ANIMATION_MS = 320;
const SDG_TILE_COUNT = 8;
const LANDING_EFFECT_DELAY_MS = 900;
const GAME_DURATION_SECONDS = 30 * 60;

app.use(express.static(path.join(__dirname, 'public')));

// --- 游戏常量与数据 ---
const BOARD_SIZE = 64;
const VIRTUES = ["Prudence", "Justice", "Fortitude", "Temperance"];
const SDG_VIRTUE_MAP = {
    "Prudence": [4, 7, 8, 9, 17],
    "Justice": [1, 2, 5, 10, 16],
    "Fortitude": [3, 11, 13, 16, 17],
    "Temperance": [6, 12, 14, 15, 17]
};

const SDG_NAMES = {
    1: "No Poverty", 2: "Zero Hunger", 3: "Good Health & Well-being", 4: "Quality Education",
    5: "Gender Equality", 6: "Clean Water & Sanitation", 7: "Affordable & Clean Energy",
    8: "Decent Work & Economic Growth", 9: "Industry, Innovation & Infrastructure", 10: "Reduced Inequalities",
    11: "Sustainable Cities & Communities", 12: "Responsible Consumption & Production", 13: "Climate Action",
    14: "Life Below Water", 15: "Life on Land", 16: "Peace, Justice & Strong Institutions",
    17: "Partnerships for the Goals"
};
const SDG_DESCRIPTIONS = {
    1: "End poverty in all forms everywhere.",
    2: "End hunger and improve nutrition through sustainable agriculture.",
    3: "Ensure healthy lives and well-being for all at all ages.",
    4: "Ensure inclusive and quality education for all.",
    5: "Achieve gender equality and empower all women and girls.",
    6: "Ensure access to clean water and sanitation for all.",
    7: "Ensure affordable and clean energy for everyone.",
    8: "Promote decent work and sustainable economic growth.",
    9: "Build resilient infrastructure and foster innovation.",
    10: "Reduce inequality within and among countries.",
    11: "Make cities inclusive, safe, resilient and sustainable.",
    12: "Ensure sustainable consumption and production patterns.",
    13: "Take urgent action to combat climate change and its impacts.",
    14: "Conserve oceans and marine resources for sustainable development.",
    15: "Protect terrestrial ecosystems and biodiversity.",
    16: "Promote peace, justice, and strong institutions.",
    17: "Strengthen global partnerships for sustainable development."
};
const SDG_SHORT_LABELS = {
    1: "No Poverty / 消除贫困",
    2: "Zero Hunger / 零饥饿",
    3: "Health / 健康福祉",
    4: "Education / 优质教育",
    5: "Gender Equality / 性别平等",
    6: "Clean Water / 清洁饮水",
    7: "Clean Energy / 清洁能源",
    8: "Decent Work / 体面工作",
    9: "Innovation / 产业创新",
    10: "Reduced Inequality / 减少不平等",
    11: "Sustainable Cities / 可持续城市",
    12: "Responsible Consumption / 责任消费",
    13: "Climate Action / 气候行动",
    14: "Life Below Water / 水下生物",
    15: "Life on Land / 陆地生物",
    16: "Peace & Justice / 和平正义",
    17: "Partnerships / 目标伙伴关系"
};

// SDG Challenge 格子分组：5 组组合，每组在棋盘上出现 2 格（共 10 格）
const SDG_GROUP_TEMPLATES = [
    [4, 1, 3, 17],
    [7, 2, 17, 12],
    [8, 16, 13, 14],
    [9, 10, 16, 15],
    [17, 5, 11, 6]
];

const SDG_GROUPS = [
    ...SDG_GROUP_TEMPLATES,
    ...SDG_GROUP_TEMPLATES
];

function findNearestShockPos(pos, board) {
    const shockPositions = board
        .map((t, idx) => t.type === 'SHOCK' ? idx : -1)
        .filter(idx => idx !== -1);
    if (shockPositions.length === 0) return 0;
    let nearest = shockPositions[0];
    let minDist = Infinity;
    for (const target of shockPositions) {
        const clockwise = (target - pos + BOARD_SIZE) % BOARD_SIZE;
        const anti = (pos - target + BOARD_SIZE) % BOARD_SIZE;
        const dist = Math.min(clockwise, anti);
        if (dist < minDist) {
            minDist = dist;
            nearest = target;
        }
    }
    return nearest;
}

// 全局冲击卡牌
const SHOCK_CARDS = [
    {
        name: "Pandemic",
        desc: "Influenza A(H3N2) subclade K spreads rapidly in winter, causing surges in hospitalizations. All players lose 1 Heart, move to Tile #12.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.heart = Math.max(0, p.heart - 1);
                p.pos = 12;
            });
        }
    },
    {
        name: "Mass Displacement",
        desc: "Civil war displaces over 9.6 million people, the worst refugee crisis on the continent. All players move to nearest surrender tile and surrender 1 resource card.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.pos = findNearestShockPos(p.pos, state.board);
            });
            state.discardQueue = state.players.map(p => p.id);
            state.pendingDiscardCard = "Mass Displacement";
        }
    },
    {
        name: "Cyber Outage",
        desc: "30 renewable energy plants hit by cyberattacks; wind & solar systems paralyzed. All players surrender 1 Intellect card.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => p.intellect = Math.max(0, p.intellect - 1));
        }
    },
    {
        name: "Disaster",
        desc: "Extreme wildfires force thousands to evacuate. All players return to Start Tile.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => p.pos = 0);
        }
    },
    {
        name: "Food Crisis",
        desc: "The number of people facing acute food insecurity worldwide reaches 266 million. All players lose 1 Will, move to nearest surrender tile.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.will = Math.max(0, p.will - 1);
                p.pos = findNearestShockPos(p.pos, state.board);
            });
        }
    },
    {
        name: "Climate Emergency",
        desc: "Temperatures near 50°C. All players lose 1 Heart; cannot claim SDG next round.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.heart = Math.max(0, p.heart - 1);
                p.cannotClaimNextTurn = true;
            });
        }
    },
    {
        name: "Supply Chain Collapse",
        desc: "Red Sea crisis continues; global energy and shipping chains break. All players return to Start.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => p.pos = 0);
        }
    },
    {
        name: "Misinformation Wave",
        desc: "AI deepfakes spread across countries, disrupting public discourse. Current player loses 1 claimed SDG; cannot act next round.",
        apply: (state, currentPlayer) => {
            if (currentPlayer && currentPlayer.sdgsClaimed.length > 0) {
                removeClaimedSDG(currentPlayer, state);
            }
            if (currentPlayer) currentPlayer.skipNextTurn = true;
        }
    },
    {
        name: "Energy Shortage",
        desc: "Global natural gas and power shortage; many countries enforce rationing. All players move to Tile #18, lose 1 Will.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.pos = 18;
                p.will = Math.max(0, p.will - 1);
            });
        }
    },
    {
        name: "Debt Crisis",
        desc: "Many countries default on sovereign debt; aid budgets sharply cut. Current player loses 1 claimed SDG.",
        apply: (state, currentPlayer) => {
            if (currentPlayer && currentPlayer.sdgsClaimed.length > 0) {
                removeClaimedSDG(currentPlayer, state);
            }
        }
    },
    {
        name: "Healthcare Collapse",
        desc: "Staff shortages and resource overload collapse healthcare systems. All players move to nearest surrender tile and surrender 1 Will.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.pos = findNearestShockPos(p.pos, state.board);
                p.will = Math.max(0, p.will - 1);
            });
        }
    },
    {
        name: "Water Scarcity",
        desc: "Mega wildfires burn millions of hectares of forest & farmland. All players return to Start and surrender 1 resource card.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.pos = 0;
            });
            state.discardQueue = state.players.map(p => p.id);
            state.pendingDiscardCard = "Water Scarcity";
        }
    },
    {
        name: "Pollution Crisis",
        desc: "Plastic & toxic waste leaks damage marine ecosystems. All players lose 1 Will, move to Tile #32.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.will = Math.max(0, p.will - 1);
                p.pos = 32;
            });
        }
    },
    {
        name: "Biodiversity Loss",
        desc: "Deforestation and fires intensify, species extinction rate extremely high. All players lose 1 Heart; cannot claim SDG next round.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.heart = Math.max(0, p.heart - 1);
                p.cannotClaimNextTurn = true;
            });
        }
    },
    {
        name: "Trade War Escalation",
        desc: "Global tariff barriers escalate; international trade shrinks sharply. All players lose 1 Intellect; cannot claim SDG next round.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => {
                p.intellect = Math.max(0, p.intellect - 1);
                p.cannotClaimNextTurn = true;
            });
        }
    }
];

// 全球福祉卡牌
const WELFARE_CARDS = [
    { name: "Green Energy Expansion", desc: "Solar and wind projects receive global funding, making clean energy accessible to all.", stat: 'intellect' },
    { name: "Global Vaccine Sharing", desc: "Wealthy nations donate vaccines to poorer ones, establishing global immunity.", stat: 'heart' },
    { name: "Ocean Plastic Recycling Initiative", desc: "Multiple countries unite to clean ocean plastic and promote biodegradable materials.", stat: 'will' },
    { name: "Transnational Remote Education Platform", desc: "Free educational content reaches remote areas, narrowing the digital divide.", stat: 'intellect' },
    { name: "International Ranger Program", desc: "Tropical rainforest protection receives international funding, reducing deforestation.", stat: 'heart' },
    { name: "Fair Trade Certification Upgrade", desc: "More brands join fair trade, helping small farmers earn fair profits.", stat: 'will' },
    { name: "Global Mental Health Day", desc: "The UN establishes Mental Health Day to reduce stigma and offer free counseling.", stat: 'heart' },
    { name: "Open-source Agricultural Technology Library", desc: "Drought-resistant crop technologies are freely available to all countries.", stat: 'intellect' },
    { name: "Cross-border Rapid Disaster Relief Agreement", desc: "Countries sign an agreement to deploy relief within 24 hours of a disaster.", stat: 'will' },
    { name: "Urban Bike-sharing Network", desc: "A connected bike-sharing system in 100 global cities reduces carbon emissions.", stat: 'heart' },
    { name: "Women in Science Fund", desc: "Supports female researchers in developing countries with full scholarships.", stat: 'intellect' },
    { name: "Global Tree-Planting Marathon", desc: "One billion trees are planted worldwide in 24 hours, setting a new record.", stat: 'will' },
    { name: "Open-source Freshwater Purification Technology", desc: "Blueprints for low-cost water purifiers are released for free.", stat: 'heart' },
    { name: "International Child Labor Elimination Program", desc: "Joint law enforcement rescues child laborers and provides educational alternatives.", stat: 'intellect' },
    { name: "Global Renewable Energy Subsidies", desc: "Fossil fuel subsidies are redirected to wind and solar, lowering electricity prices.", stat: 'will' }
];

// Vice Cards
const VICE_CARDS = [
    {
        name: "Blame Shifting",
        desc: "Choose another player: they lose 1 Intellect, you lose 1 Will.",
        apply: (state, currentPlayer) => {
            if (!currentPlayer) return;
            currentPlayer.will = Math.max(0, currentPlayer.will - 1);
            const others = state.players.filter(p => p.id !== currentPlayer.id);
            if (others.length > 0) {
                const target = others[Math.floor(Math.random() * others.length)];
                target.intellect = Math.max(0, target.intellect - 1);
                io.emit('log', `👉 ${currentPlayer.name} shifted blame to ${target.name}! ${target.name} lost 1 Intellect.`);
            }
            io.emit('log', `😈 ${currentPlayer.name} lost 1 Will from Blame Shifting.`);
        }
    },
    {
        name: "Exclusion",
        desc: "Skip your next turn.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) currentPlayer.skipNextTurn = true;
            io.emit('log', `😈 ${currentPlayer.name} will skip their next turn.`);
        }
    },
    {
        name: "Polarization",
        desc: "All players move to Start tile.",
        apply: (state, currentPlayer) => {
            state.players.forEach(p => p.pos = 0);
            io.emit('log', `😈 Polarization! All players return to Start.`);
        }
    },
    {
        name: "Conflict",
        desc: "Return to Start.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) currentPlayer.pos = 0;
            io.emit('log', `😈 ${currentPlayer.name} returned to Start.`);
        }
    },
    {
        name: "Corruption",
        desc: "Move back 1 tile.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) {
                currentPlayer.pos = (currentPlayer.pos - 1 + BOARD_SIZE) % BOARD_SIZE;
                io.emit('log', `😈 ${currentPlayer.name} moved back 1 tile.`);
            }
        }
    },
    {
        name: "Impatience",
        desc: "Next turn, roll twice and use the lower number.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) currentPlayer.rollTwiceLower = true;
            io.emit('log', `😈 ${currentPlayer.name} will roll twice and take the lower result next turn.`);
        }
    },
    {
        name: "Greed",
        desc: "Surrender 1 Heart card.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) {
                currentPlayer.heart = Math.max(0, currentPlayer.heart - 1);
                io.emit('log', `😈 ${currentPlayer.name} lost 1 Heart from Greed.`);
            }
        }
    },
    {
        name: "Apathy",
        desc: "Cannot claim any SDG next round.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) {
                currentPlayer.cannotClaimNextTurn = true;
                io.emit('log', `😈 ${currentPlayer.name} cannot claim SDG next turn.`);
            }
        }
    },
    {
        name: "Deception",
        desc: "Lose 1 resource card (random).",
        apply: (state, currentPlayer) => {
            if (!currentPlayer) return;
            const available = [];
            if (currentPlayer.heart > 0) available.push('heart');
            if (currentPlayer.intellect > 0) available.push('intellect');
            if (currentPlayer.will > 0) available.push('will');
            if (available.length > 0) {
                const stat = available[Math.floor(Math.random() * available.length)];
                currentPlayer[stat]--;
                const names = { heart: 'Heart', intellect: 'Intellect', will: 'Will' };
                io.emit('log', `😈 ${currentPlayer.name} lost 1 ${names[stat]} from Deception.`);
            }
        }
    },
    {
        name: "Recklessness",
        desc: "Lose 1 claimed SDG.",
        apply: (state, currentPlayer) => {
            if (currentPlayer && currentPlayer.sdgsClaimed.length > 0) {
                removeClaimedSDG(currentPlayer, state);
                io.emit('log', `😈 ${currentPlayer.name} lost a claimed SDG from Recklessness.`);
            } else {
                io.emit('log', `😈 ${currentPlayer?.name || 'Player'} has no SDGs to lose.`);
            }
        }
    },
    {
        name: "Arrogance",
        desc: "Move back 3 tiles.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) {
                currentPlayer.pos = (currentPlayer.pos - 3 + BOARD_SIZE) % BOARD_SIZE;
                io.emit('log', `😈 ${currentPlayer.name} moved back 3 tiles.`);
            }
        }
    },
    {
        name: "Laziness",
        desc: "Skip your next turn.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) currentPlayer.skipNextTurn = true;
            io.emit('log', `😈 ${currentPlayer.name} will skip their next turn.`);
        }
    },
    {
        name: "Jealousy",
        desc: "Lose 1 Will card.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) {
                currentPlayer.will = Math.max(0, currentPlayer.will - 1);
                io.emit('log', `😈 ${currentPlayer.name} lost 1 Will from Jealousy.`);
            }
        }
    },
    {
        name: "Selfishness",
        desc: "Surrender 1 random resource card.",
        apply: (state, currentPlayer) => {
            if (!currentPlayer) return;
            const available = [];
            if (currentPlayer.heart > 0) available.push('heart');
            if (currentPlayer.intellect > 0) available.push('intellect');
            if (currentPlayer.will > 0) available.push('will');
            if (available.length > 0) {
                const stat = available[Math.floor(Math.random() * available.length)];
                currentPlayer[stat]--;
                const names = { heart: 'Heart', intellect: 'Intellect', will: 'Will' };
                io.emit('log', `😈 ${currentPlayer.name} lost 1 ${names[stat]} from Selfishness.`);
            }
        }
    },
    {
        name: "Short-sightedness",
        desc: "Cannot draw any cards next turn.",
        apply: (state, currentPlayer) => {
            if (currentPlayer) currentPlayer.cannotDrawNextTurn = true;
            io.emit('log', `😈 ${currentPlayer.name} cannot draw resources next turn.`);
        }
    }
];

let gameState = {
    players: [],
    spectators: [],
    currentPlayerIdx: 0,
    claimedSDGs: [],
    claimedBy: {},
    board: [],
    phase: 'WAITING',
    timer: 0,
    currentAction: null,
    votes: { approve: 0, reject: 0, votedPlayers: [] },
    discardQueue: [],
    pendingDiscardCard: null
};
let pendingEffect = null;
let pendingVirtue = null;
let gameClockStarted = false;
let gameClockRemaining = GAME_DURATION_SECONDS;
let gameClockInterval = null;

let timerInterval = null;

function removeClaimedSDG(player, state) {
    if (player.sdgsClaimed.length === 0) return;
    const randIdx = Math.floor(Math.random() * player.sdgsClaimed.length);
    const sdgToRemove = player.sdgsClaimed[randIdx];
    state.claimedSDGs = state.claimedSDGs.filter(id => id !== sdgToRemove);
    delete state.claimedBy[sdgToRemove];
    player.sdgsClaimed.splice(randIdx, 1);
    player.score = Math.max(0, player.score - 1);
    io.emit('log', `💔 ${player.name} lost SDG ${sdgToRemove}, score -1.`);
}

function initBoard() {
    let pool = [];
    for (let i = 0; i < SDG_TILE_COUNT; i++) {
        const sdgNums = SDG_GROUPS[i].join(', ');
        const sdgHint = SDG_GROUPS[i].map(id => `${id}:${SDG_SHORT_LABELS[id] || SDG_NAMES[id]}`).join(' | ');
        pool.push({
            type: 'SDG',
            sdgs: SDG_GROUPS[i],
            label: '🎯 SDG Challenge',
            detail: sdgNums,
            detailDesc: sdgHint
        });
    }
    for (let i = 0; i < 3; i++) pool.push({ type: 'BONUS', label: '🎁 I+W+H' });
    for (let i = 0; i < 6; i++) pool.push({ type: 'SHOCK', label: '⚠️ Global Shock / 全球冲击' });
    for (let i = 0; i < 6; i++) pool.push({ type: 'WELFARE', label: '🌟 Global Welfare / 全球福祉' });   // 9 → 6
    for (let i = 0; i < 7; i++) pool.push({ type: 'VICE', label: '😈 Vice / 恶习' });                  // more vice tiles
    for (let i = 0; i < 11; i++) pool.push({ type: 'RESOURCE_H', label: '❤ Heart +1' });       // 12 → 11
    for (let i = 0; i < 11; i++) pool.push({ type: 'RESOURCE_I', label: '🧠 Intellect +1' });  // 12 → 11
    for (let i = 0; i < 11; i++) pool.push({ type: 'RESOURCE_W', label: '⚡ Will +1' });

    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function scoreBoard(arr) {
        // Lower score is better. Penalize consecutive same-type tiles.
        let score = 0;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i].type === arr[i - 1].type) score += 3;
        }
        // Strongly penalize 3+ streaks.
        for (let i = 2; i < arr.length; i++) {
            if (arr[i].type === arr[i - 1].type && arr[i - 1].type === arr[i - 2].type) score += 12;
        }
        // Also check wrap-around near start/end of the loop.
        if (arr[0].type === arr[arr.length - 1].type) score += 3;
        if (arr[0].type === arr[arr.length - 1].type && arr[0].type === arr[arr.length - 2].type) score += 12;
        if (arr[0].type === arr[1].type && arr[0].type === arr[arr.length - 1].type) score += 12;
        return score;
    }

    let best = shuffleArray(pool);
    let bestScore = scoreBoard(best);
    for (let t = 0; t < 250; t++) {
        const candidate = shuffleArray(pool);
        const s = scoreBoard(candidate);
        if (s < bestScore) {
            best = candidate;
            bestScore = s;
            if (bestScore === 0) break;
        }
    }
    gameState.board = [{ type: 'START', label: '🚩 Start' }, ...best];
}
initBoard();

function startTimer(seconds, onTimeout) {
    clearInterval(timerInterval);
    gameState.timer = seconds;
    io.emit('timerUpdate', gameState.timer);

    timerInterval = setInterval(() => {
        gameState.timer--;
        io.emit('timerUpdate', gameState.timer);
        if (gameState.timer <= 0) {
            clearInterval(timerInterval);
            onTimeout();
        }
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    gameState.timer = 0;
    io.emit('timerUpdate', gameState.timer);
}

function emitGameClock() {
    io.emit('gameClockUpdate', gameClockRemaining);
}

function stopGameClock() {
    clearInterval(gameClockInterval);
    gameClockInterval = null;
}

function buildLearningSummary() {
    const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const claimed = gameState.claimedSDGs.length;
    if (!top) {
        return "Great discussion! You practiced linking virtues with SDG thinking and learned to justify civic choices.";
    }
    return `${top.name} led with ${top.score} point(s). As a group, you claimed ${claimed}/17 SDGs — showing how evidence, values, and dialogue shape global citizenship decisions.`;
}

function endGame(reason) {
    stopTimer();
    stopGameClock();
    gameState.phase = 'GAME_OVER';
    gameState.currentAction = null;
    io.emit('stateUpdate', gameState);
    io.emit('log', reason);
    io.emit('gameOverSummary', buildLearningSummary());
}

function startGameClockIfNeeded() {
    if (gameClockStarted) return;
    gameClockStarted = true;
    gameClockRemaining = GAME_DURATION_SECONDS;
    emitGameClock();
    gameClockInterval = setInterval(() => {
        gameClockRemaining--;
        emitGameClock();
        if (gameClockRemaining <= 0) {
            gameClockRemaining = 0;
            emitGameClock();
            endGame('⏰ 30 minutes reached. Game over and showing leaderboard.');
        }
    }, 1000);
}

function requestEffectConfirm(playerId, title, desc, applyEffect, onAfterConfirm, options = null) {
    stopTimer();
    pendingEffect = { playerId, applyEffect, onAfterConfirm };
    gameState.phase = 'WAIT_CONFIRM';
    gameState.currentAction = { type: 'EFFECT_CONFIRM', playerId, title, desc };
    io.emit('effectPrompt', { playerId, title, desc, options });
    io.emit('stateUpdate', gameState);
}

function requestEffectConfirmDelayed(delayMs, playerId, title, desc, applyEffect, onAfterConfirm, options = null) {
    setTimeout(() => {
        requestEffectConfirm(playerId, title, desc, applyEffect, onAfterConfirm, options);
    }, delayMs);
}

function processDiscardQueue() {
    stopTimer();

    if (gameState.discardQueue.length === 0) {
        gameState.phase = 'ROLLING';
        gameState.pendingDiscardCard = null;
        gameState.currentAction = null;
        io.emit('stateUpdate', gameState);
        nextTurn();
        return;
    }

    const nextPlayerId = gameState.discardQueue.shift();
    const player = gameState.players.find(p => p.id === nextPlayerId);

    if (!player) {
        processDiscardQueue();
        return;
    }

    if (player.heart <= 0 && player.intellect <= 0 && player.will <= 0) {
        io.emit('log', `⚠️ ${player.name} has no resources to surrender / 无可交出资源, skipping.`);
        processDiscardQueue();
        return;
    }

    gameState.phase = 'DISCARDING';
    gameState.currentAction = {
        type: 'DISCARD',
        playerId: player.id,
        cardName: gameState.pendingDiscardCard || 'event'
    };
    io.emit('log', `🗑️ ${player.name} please choose a resource card to surrender / 请选择要交出的资源 (${gameState.pendingDiscardCard || 'event effect'})`);
    io.emit('stateUpdate', gameState);

    startTimer(20, () => {
        const availableStats = [];
        if (player.heart > 0) availableStats.push('heart');
        if (player.intellect > 0) availableStats.push('intellect');
        if (player.will > 0) availableStats.push('will');

        if (availableStats.length > 0) {
            const randomStat = availableStats[Math.floor(Math.random() * availableStats.length)];
            const statNames = { heart: '❤ Heart', intellect: '🧠 Intellect', will: '⚡ Will' };
            player[randomStat] = Math.max(0, player[randomStat] - 1);
            io.emit('log', `⏰ ${player.name} did not choose in time, randomly deducted ${statNames[randomStat]}.`);
        }
        processDiscardQueue();
    });
}

function nextTurn() {
    stopTimer();

    if (gameState.claimedSDGs.length >= 17) {
        endGame(`🎉 All 17 SDGs have been claimed! Game over!`);
        return;
    }

    gameState.currentPlayerIdx = (gameState.currentPlayerIdx + 1) % gameState.players.length;
    const player = gameState.players[gameState.currentPlayerIdx];

    if (player.skipNextTurn) {
        player.skipNextTurn = false;
        io.emit('log', `⏭️ ${player.name}'s turn is skipped (event effect), moving to next player.`);
        io.emit('stateUpdate', gameState);
        if (gameState.players.some(p => !p.skipNextTurn)) {
            nextTurn();
        }
        return;
    }

    gameState.phase = 'ROLLING';
    gameState.currentAction = null;
    io.emit('stateUpdate', gameState);
}

function chooseTextArgue(player) {
    gameState.phase = 'ARGUING';
    io.emit('log', `✍️ ${player.name} auto chose text argument (90s)`);
    io.emit('stateUpdate', gameState);
    startTimer(90, () => failClaim(player, "Argument timeout"));
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        if (gameState.players.length >= 4) {
            const spectator = {
                id: socket.id,
                name: name || `Spectator ${gameState.spectators.length + 1}`
            };
            gameState.spectators.push(spectator);
            io.emit('log', `👀 ${spectator.name} joined as spectator.`);
            socket.emit('roleAssigned', { role: 'spectator' });
            io.emit('stateUpdate', gameState);
            return;
        }

        const player = {
            id: socket.id,
            name: name || `Player ${gameState.players.length + 1}`,
            pos: 0, heart: 1, intellect: 1, will: 1, score: 0,
            color: `hsl(${gameState.players.length * 90}, 70%, 50%)`,
            sdgsClaimed: [],
            skipNextTurn: false,
            cannotClaimNextTurn: false,
            cannotDrawNextTurn: false,
            rollTwiceLower: false,
            isReady: false,
            micEnabled: false
        };
        gameState.players.push(player);
        socket.emit('roleAssigned', { role: 'player' });
        io.emit('log', `👋 ${player.name} joined as player.`);
        io.emit('stateUpdate', gameState);
    });

    socket.on('setReady', ({ micEnabled } = {}) => {
        if (gameState.phase !== 'WAITING') return;
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;
        player.isReady = true;
        player.micEnabled = !!micEnabled;
        io.emit('log', `✅ ${player.name} is ready (${player.micEnabled ? 'mic on' : 'mic off'}).`);

        if (gameState.players.length === 4 && gameState.players.every(p => p.isReady)) {
            gameState.phase = 'ROLLING';
            gameState.currentPlayerIdx = gameState.players.length - 1;
            startGameClockIfNeeded();
            io.emit('log', '🚀 All 4 players are ready. Game starts now!');
        }
        io.emit('stateUpdate', gameState);
    });

    socket.on('chatMessage', (msg) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player && msg.trim()) {
            io.emit('log', `💬 [${player.name}]: ${msg.substring(0, 50)}`);
        }
    });

    socket.on('rollDice', () => {
        const player = gameState.players[gameState.currentPlayerIdx];
        if (!player) return;
        if (socket.id !== player.id || gameState.phase !== 'ROLLING') return;

        let dice;
        if (player.rollTwiceLower) {
            player.rollTwiceLower = false;
            const roll1 = Math.floor(Math.random() * 6) + 1;
            const roll2 = Math.floor(Math.random() * 6) + 1;
            dice = Math.min(roll1, roll2);
            io.emit('log', `🎲 ${player.name} rolled ${roll1} and ${roll2} (Impatience), using lower: ${dice}`);
        } else {
            dice = Math.floor(Math.random() * 6) + 1;
        }

        const oldPos = player.pos;
        const newPos = (player.pos + dice) % BOARD_SIZE;
        const animationMs = DICE_BASE_ANIMATION_MS + (dice * DICE_STEP_ANIMATION_MS);
        gameState.phase = 'ANIMATING_MOVE';
        io.emit('stateUpdate', gameState);
        io.emit('diceResult', {
            name: player.name,
            val: dice,
            playerId: player.id,
            from: oldPos,
            to: newPos,
            animationMs
        });

        setTimeout(() => {
            player.pos = newPos;

            if (oldPos + dice >= BOARD_SIZE) {
                player.heart++; player.intellect++; player.will++;
                io.emit('log', `✨ ${player.name} completed a full lap, all resources +1`);
            }

            io.emit('log', `🎲 ${player.name} rolled ${dice}, moved to ${gameState.board[player.pos].label.replace(/\n/g, ' ')}`);
            handleLanding(player);
        }, animationMs);
    });

    socket.on('confirmEffect', () => {
        if (gameState.phase !== 'WAIT_CONFIRM') return;
        if (!pendingEffect) return;
        if (socket.id !== pendingEffect.playerId) return;

        pendingEffect.applyEffect();
        io.emit('effectResolved');
        const after = pendingEffect.onAfterConfirm;
        pendingEffect = null;
        gameState.currentAction = null;

        if (after) after();
    });

    function handleLanding(player) {
        const tile = gameState.board[player.pos];

        if (tile.type === 'SDG') {
            if (tile.sdgs.every(sdg => gameState.claimedSDGs.includes(sdg))) {
                io.emit('log', `🔒 All SDGs in this group are already claimed. Turn ends.`);
                nextTurn();
            } else if (player.cannotClaimNextTurn) {
                player.cannotClaimNextTurn = false;
                io.emit('log', `🚫 ${player.name} cannot claim SDG this turn due to event effects.`);
                nextTurn();
            } else {
                startSDGProcess(player, tile.sdgs);
            }
        } else if (tile.type === 'RESOURCE_H') {
            requestEffectConfirmDelayed(
                LANDING_EFFECT_DELAY_MS,
                player.id,
                '❤ Heart Resource',
                player.cannotDrawNextTurn
                    ? `${player.name} is blocked from drawing resources this turn.`
                    : `${player.name} will gain +1 Heart.`,
                () => {
                    if (player.cannotDrawNextTurn) {
                        player.cannotDrawNextTurn = false;
                        io.emit('log', `🚫 ${player.name} cannot draw resources this turn.`);
                    } else {
                        player.heart++;
                        io.emit('log', `❤ ${player.name} landed on Heart resource tile, Heart +1`);
                    }
                },
                () => nextTurn()
            );
        } else if (tile.type === 'RESOURCE_I') {
            requestEffectConfirmDelayed(
                LANDING_EFFECT_DELAY_MS,
                player.id,
                '🧠 Intellect Resource',
                player.cannotDrawNextTurn
                    ? `${player.name} is blocked from drawing resources this turn.`
                    : `${player.name} will gain +1 Intellect.`,
                () => {
                    if (player.cannotDrawNextTurn) {
                        player.cannotDrawNextTurn = false;
                        io.emit('log', `🚫 ${player.name} cannot draw resources this turn.`);
                    } else {
                        player.intellect++;
                        io.emit('log', `🧠 ${player.name} landed on Intellect resource tile, Intellect +1`);
                    }
                },
                () => nextTurn()
            );
        } else if (tile.type === 'RESOURCE_W') {
            requestEffectConfirmDelayed(
                LANDING_EFFECT_DELAY_MS,
                player.id,
                '⚡ Will Resource',
                player.cannotDrawNextTurn
                    ? `${player.name} is blocked from drawing resources this turn.`
                    : `${player.name} will gain +1 Will.`,
                () => {
                    if (player.cannotDrawNextTurn) {
                        player.cannotDrawNextTurn = false;
                        io.emit('log', `🚫 ${player.name} cannot draw resources this turn.`);
                    } else {
                        player.will++;
                        io.emit('log', `⚡ ${player.name} landed on Will resource tile, Will +1`);
                    }
                },
                () => nextTurn()
            );
        } else if (tile.type === 'BONUS') {
            requestEffectConfirmDelayed(
                LANDING_EFFECT_DELAY_MS,
                player.id,
                '🎁 I+W+H Bonus',
                player.cannotDrawNextTurn
                    ? `${player.name} is blocked from drawing resources this turn.`
                    : `${player.name} will gain +1 to all resources.`,
                () => {
                    if (player.cannotDrawNextTurn) {
                        player.cannotDrawNextTurn = false;
                        io.emit('log', `🚫 ${player.name} cannot draw resources this turn.`);
                    } else {
                        player.heart++; player.intellect++; player.will++;
                        io.emit('log', `🎁 ${player.name} landed on I+W+H Bonus, all resources +1`);
                    }
                },
                () => nextTurn()
            );
        } else if (tile.type === 'SHOCK') {
            const card = SHOCK_CARDS[Math.floor(Math.random() * SHOCK_CARDS.length)];
            requestEffectConfirmDelayed(
                LANDING_EFFECT_DELAY_MS,
                player.id,
                `⚠️ Global Shock / 全球冲击: ${card.name}`,
                card.desc,
                () => {
                    io.emit('log', `⚠️ Global Shock triggered:【${card.name}】${card.desc}`);
                    card.apply(gameState, player);
                    io.emit('stateUpdate', gameState);
                },
                () => {
                    if (gameState.discardQueue.length > 0) processDiscardQueue();
                    else nextTurn();
                }
            );
        } else if (tile.type === 'VICE') {
            const card = VICE_CARDS[Math.floor(Math.random() * VICE_CARDS.length)];
            requestEffectConfirmDelayed(
                LANDING_EFFECT_DELAY_MS,
                player.id,
                `😈 Vice / 恶习: ${card.name}`,
                card.desc,
                () => {
                    io.emit('log', `😈 Vice triggered:【${card.name}】${card.desc}`);
                    card.apply(gameState, player);
                    io.emit('stateUpdate', gameState);
                },
                () => nextTurn(),
                card.name === 'Arrogance'
                    ? ['😌 Gladly accept / 欣然接受', '🙃 Don’t want to, but have to / 不想接受也得接受']
                    : null
            );
        } else if (tile.type === 'WELFARE') {
            const card = WELFARE_CARDS[Math.floor(Math.random() * WELFARE_CARDS.length)];
            requestEffectConfirmDelayed(
                LANDING_EFFECT_DELAY_MS,
                player.id,
                `🌟 Global Welfare / 全球福祉: ${card.name}`,
                card.desc,
                () => {
                    io.emit('log', `🌟 Global Welfare triggered:【${card.name}】${card.desc}`);
                    gameState.players.forEach(p => p[card.stat]++);
                    io.emit('stateUpdate', gameState);
                },
                () => nextTurn()
            );
        } else {
            nextTurn();
        }
        io.emit('stateUpdate', gameState);
    }

    socket.on('chooseDiscard', (statType) => {
        if (gameState.phase !== 'DISCARDING') return;
        if (!gameState.currentAction || gameState.currentAction.type !== 'DISCARD') return;

        const playerId = gameState.currentAction.playerId;
        const player = gameState.players.find(p => p.id === playerId);

        if (socket.id !== playerId) return;
        if (!['heart', 'intellect', 'will'].includes(statType)) return;
        if (player[statType] <= 0) {
            socket.emit('error', 'That resource is already at 0, cannot surrender / 该资源为0，无法交出');
            return;
        }

        const statNames = { heart: '❤ Heart', intellect: '🧠 Intellect', will: '⚡ Will' };
        player[statType] = Math.max(0, player[statType] - 1);
        io.emit('log', `🗑️ ${player.name} chose to surrender ${statNames[statType]} / 已交出.`);
        processDiscardQueue();
    });

    function startSDGProcess(player, availableSDGs) {
        pendingVirtue = {
            playerId: player.id,
            virtue: null,
            targetSDG: null,
            availableSDGs,
            canClaim: false,
            failReason: null
        };
        gameState.phase = 'WAIT_VIRTUE_ROLL';
        gameState.currentAction = { type: 'VIRTUE_ROLL', playerId: player.id };
        io.emit('virtuePrompt', { playerId: player.id });
        io.emit('log', `🎯 ${player.name} landed on SDG Challenge. Waiting for them to spin the virtue wheel.`);
        io.emit('stateUpdate', gameState);
    }

    function beginThinkingPhase(player, targetSDG, virtue) {
        gameState.currentAction = { sdg: targetSDG, virtue: virtue };
        gameState.phase = 'THINKING';
        io.emit('log', `🎲 ${player.name} rolled the Virtue Die: ${virtue}`);
        io.emit('log', `🤔 ${player.name} is thinking about how to justify SDG ${targetSDG} (Virtue: ${virtue})`);
        io.emit('centerCard', {
            title: `SDG ${targetSDG}: ${SDG_NAMES[targetSDG]}`,
            desc: SDG_DESCRIPTIONS[targetSDG] || SDG_NAMES[targetSDG],
            type: 'sdg',
            virtue: virtue
        });
        io.emit('stateUpdate', gameState);

        startTimer(15, () => {
            gameState.phase = 'ARGUE_CHOICE';
            gameState.currentAction = {
                ...(gameState.currentAction || {}),
                type: 'ARGUE_CHOICE',
                playerId: player.id
            };
            io.emit('log', `⏱️ Thinking time over, please choose argument method (timeout = fail)`);
            io.emit('stateUpdate', gameState);

            startTimer(10, () => {
                failClaim(player, "Did not choose argument method");
            });
        });
    }

    socket.on('startVirtueSpin', () => {
        const player = gameState.players[gameState.currentPlayerIdx];
        if (!player || gameState.phase !== 'WAIT_VIRTUE_ROLL') return;
        if (!pendingVirtue || pendingVirtue.playerId !== player.id) return;
        if (socket.id !== player.id) return;

        const virtue = VIRTUES[Math.floor(Math.random() * 4)];
        const candidateSDGs = pendingVirtue.availableSDGs
            .filter(id => SDG_VIRTUE_MAP[virtue].includes(id))
            .filter(id => !gameState.claimedSDGs.includes(id));
        const targetSDG = candidateSDGs.length > 0 ? candidateSDGs[Math.floor(Math.random() * candidateSDGs.length)] : null;
        const canClaim = !!targetSDG && player.heart >= 1 && player.intellect >= 1 && player.will >= 1;
        const failReason = !targetSDG
            ? `No available SDG under ${virtue}.`
            : `Insufficient resources (need ❤1 🧠1 ⚡1).`;

        pendingVirtue.virtue = virtue;
        pendingVirtue.targetSDG = targetSDG;
        pendingVirtue.canClaim = canClaim;
        pendingVirtue.failReason = canClaim ? null : failReason;

        gameState.phase = 'WAIT_VIRTUE_CONFIRM';
        gameState.currentAction = { type: 'VIRTUE_CONFIRM', playerId: player.id, virtue, sdg: targetSDG };
        io.emit('virtueSpin', { virtue });
        io.emit('stateUpdate', gameState);

        // 等待 Wheel 动画结束后，再显示结果与确认按钮
        setTimeout(() => {
            io.emit('virtueOutcome', {
                playerId: player.id,
                virtue,
                targetSDG,
                targetName: targetSDG ? SDG_NAMES[targetSDG] : null,
                canClaim,
                reason: canClaim ? null : failReason
            });
        }, 3200);
    });

    socket.on('confirmVirtueResult', () => {
        const player = gameState.players[gameState.currentPlayerIdx];
        if (!player || gameState.phase !== 'WAIT_VIRTUE_CONFIRM') return;
        if (!pendingVirtue || pendingVirtue.playerId !== player.id) return;
        if (socket.id !== player.id) return;

        const { virtue, targetSDG, canClaim, failReason } = pendingVirtue;
        pendingVirtue = null;
        io.emit('virtueResolved');

        if (!canClaim || !targetSDG) {
            player.will = Math.max(0, player.will - 1);
            io.emit('log', `❌ Claim failed (${failReason}), Will -1`);
            nextTurn();
            return;
        }
        gameState.phase = 'WAIT_TOPIC_CONFIRM';
        gameState.currentAction = { type: 'TOPIC_CONFIRM', playerId: player.id, sdg: targetSDG, virtue };
        io.emit('sdgTopicPrompt', {
            playerId: player.id,
            sdg: targetSDG,
            topic: SDG_NAMES[targetSDG],
            description: SDG_DESCRIPTIONS[targetSDG] || '',
            virtue,
            prompt: `Please take 15s to think about how you can give advice to "${SDG_NAMES[targetSDG]}" from the perspective of ${virtue}.`
        });
        io.emit('stateUpdate', gameState);
    });

    socket.on('confirmTopicReady', () => {
        const player = gameState.players[gameState.currentPlayerIdx];
        if (!player || gameState.phase !== 'WAIT_TOPIC_CONFIRM') return;
        if (!gameState.currentAction || gameState.currentAction.type !== 'TOPIC_CONFIRM') return;
        if (socket.id !== gameState.currentAction.playerId) return;

        const { sdg, virtue } = gameState.currentAction;
        io.emit('topicPromptResolved');
        beginThinkingPhase(player, sdg, virtue);
    });

    function startArguePhase(player, role, method) {
        gameState.currentAction = { ...(gameState.currentAction || {}), type: 'ARGUE', role, method, playerId: player.id };
        gameState.phase = role === 'CLAIMER' ? 'ARGUING' : 'COUNTER_ARGUING';
        io.emit('log', `🗣️ ${player.name} starts ${role === 'CLAIMER' ? 'claim' : 'counter'} argument (${method}, 30s).`);
        io.emit('stateUpdate', gameState);
        startTimer(30, () => {
            finishArgument(player, method === 'voice' ? "Voice argument completed (time up)" : "[Time up]");
        });
    }

    socket.on('chooseArgueMethod', (method) => {
        if (!['text', 'voice'].includes(method)) return;
        const currentPlayer = gameState.players[gameState.currentPlayerIdx];
        if (!currentPlayer) return;
        if (!gameState.currentAction) return;

        if (gameState.phase === 'ARGUE_CHOICE') {
            if (socket.id !== currentPlayer.id) return;
            startArguePhase(currentPlayer, 'CLAIMER', method);
            return;
        }
        if (gameState.phase === 'COUNTER_ARGUE_CHOICE') {
            const rebutter = gameState.players.find(p => p.id === gameState.currentAction.rebutterId);
            if (!rebutter || socket.id !== rebutter.id) return;
            startArguePhase(rebutter, 'REBUTTER', method);
        }
    });

    socket.on('submitArgument', (text) => {
        const currentPlayer = gameState.players[gameState.currentPlayerIdx];
        if (!currentPlayer || !gameState.currentAction) return;
        if (gameState.phase === 'ARGUING') {
            if (socket.id !== currentPlayer.id) return;
            finishArgument(currentPlayer, text);
            return;
        }
        if (gameState.phase === 'COUNTER_ARGUING') {
            const rebutter = gameState.players.find(p => p.id === gameState.currentAction.rebutterId);
            if (!rebutter || socket.id !== rebutter.id) return;
            finishArgument(rebutter, text);
        }
    });

    socket.on('skipPhase', () => {
        const player = gameState.players[gameState.currentPlayerIdx];
        const rebutter = gameState.players.find(p => p.id === gameState.currentAction?.rebutterId);
        const isCurrentPlayer = player && socket.id === player.id;
        const isRebutter = rebutter && socket.id === rebutter.id;
        if (!isCurrentPlayer && !isRebutter) return;

        if (gameState.phase === 'THINKING') {
            stopTimer();
            gameState.phase = 'ARGUE_CHOICE';
            gameState.currentAction = {
                ...(gameState.currentAction || {}),
                type: 'ARGUE_CHOICE',
                playerId: player.id
            };
            io.emit('log', `⏭️ ${player.name} skipped thinking, now choosing argument method.`);
            io.emit('stateUpdate', gameState);
        } else if (gameState.phase === 'WAIT_TOPIC_CONFIRM') {
            if (socket.id !== gameState.currentAction?.playerId) return;
            const { sdg, virtue } = gameState.currentAction || {};
            io.emit('topicPromptResolved');
            if (sdg && virtue) beginThinkingPhase(player, sdg, virtue);
        } else if (gameState.phase === 'ARGUE_CHOICE') {
            stopTimer();
            io.emit('log', `⏭️ ${player.name} skipped choosing method, defaulting to text argument.`);
            startArguePhase(player, 'CLAIMER', 'text');
        } else if (gameState.phase === 'ARGUING') {
            stopTimer();
            io.emit('log', `⏭️ ${player.name} skipped argument presentation.`);
            finishArgument(player, "[Skipped argument]");
        } else if (gameState.phase === 'COUNTER_ARGUE_CHOICE') {
            if (!rebutter || socket.id !== rebutter.id) return;
            stopTimer();
            io.emit('log', `⏭️ ${rebutter.name} skipped choosing method, defaulting to text counter-argument.`);
            startArguePhase(rebutter, 'REBUTTER', 'text');
        } else if (gameState.phase === 'COUNTER_ARGUING') {
            if (!rebutter || socket.id !== rebutter.id) return;
            stopTimer();
            io.emit('log', `⏭️ ${rebutter.name} skipped counter-argument.`);
            finishArgument(rebutter, "[Skipped counter-argument]");
        }
    });

    socket.on('skipVote', () => {
        if (gameState.phase !== 'VOTING') return;
        const eligible = gameState.votes.eligibleVoters || [];
        if (!eligible.includes(socket.id)) return;
        if (gameState.votes.votedPlayers.includes(socket.id)) return;
        gameState.votes.votedPlayers.push(socket.id);
        if (gameState.votes.votedPlayers.length >= eligible.length) {
            resolveVote(gameState.players[gameState.currentPlayerIdx]);
        }
    });

    function finishArgument(player, text) {
        stopTimer();
        const role = gameState.currentAction?.role || 'CLAIMER';
        io.emit('log', `🗣️ ${player.name}'s ${role === 'CLAIMER' ? 'argument' : 'counter-argument'}: ${text}`);

        if (role === 'CLAIMER') {
            gameState.phase = 'REBUTTAL_DECIDE';
            gameState.currentAction = { ...(gameState.currentAction || {}), type: 'REBUTTAL_DECIDE', claimerId: player.id };
            io.emit('log', `⏳ Other players have 15 seconds to click Argue.`);
            io.emit('stateUpdate', gameState);
            startTimer(15, () => successClaim(player));
            return;
        }

        const claimer = gameState.players[gameState.currentPlayerIdx];
        gameState.phase = 'VOTING';
        const claimerId = claimer?.id;
        const eligibleVoters = gameState.players
            .map(p => p.id)
            .filter(id => id !== claimerId && id !== gameState.currentAction?.rebutterId);
        gameState.votes = { approve: 0, reject: 0, votedPlayers: [], eligibleVoters };
        io.emit('log', `🗳️ Voting starts (10s). Only players other than claimer and arguer can vote.`);
        io.emit('stateUpdate', gameState);
        startTimer(10, () => resolveVote(claimer));
    }

    socket.on('rebut', () => {
        const currentPlayer = gameState.players[gameState.currentPlayerIdx];
        if (socket.id === currentPlayer.id || gameState.phase !== 'REBUTTAL_DECIDE') return;

        const rebutter = gameState.players.find(p => p.id === socket.id);
        if (!rebutter) return;
        stopTimer();
        io.emit('log', `✋ ${rebutter.name} clicked Argue. Choose argument type.`);
        gameState.phase = 'COUNTER_ARGUE_CHOICE';
        gameState.currentAction = { ...(gameState.currentAction || {}), type: 'COUNTER_ARGUE_CHOICE', rebutterId: rebutter.id, playerId: rebutter.id };
        io.emit('stateUpdate', gameState);
    });

    socket.on('castVote', (isApprove) => {
        if (gameState.phase !== 'VOTING') return;
        const eligible = gameState.votes.eligibleVoters || [];
        if (!eligible.includes(socket.id) || gameState.votes.votedPlayers.includes(socket.id)) return;

        gameState.votes.votedPlayers.push(socket.id);
        if (isApprove) gameState.votes.approve++;
        else gameState.votes.reject++;

        if (gameState.votes.votedPlayers.length >= eligible.length) {
            resolveVote(gameState.players[gameState.currentPlayerIdx]);
        }
    });

    function resolveVote(player) {
        stopTimer();
        const voterCount = (gameState.votes.eligibleVoters || []).length;
        const requiredVotes = Math.ceil(voterCount / 2);

        io.emit('log', `🗳️ Vote ended: Approve ${gameState.votes.approve}, Reject ${gameState.votes.reject}`);

        if (voterCount > 0 && gameState.votes.approve >= requiredVotes) {
            successClaim(player);
        } else {
            failClaim(player, "Vote failed");
        }
    }

    function successClaim(player) {
        player.heart--; player.intellect--; player.will--;
        player.score++;
        const sdg = gameState.currentAction.sdg;
        gameState.claimedSDGs.push(sdg);
        gameState.claimedBy[sdg] = player.id;
        player.sdgsClaimed.push(sdg);
        io.emit('log', `✅ Claim successful! ${player.name} spent 1 of each resource, gained 1 point. SDG ${sdg} is now locked.`);
        io.emit('claimSuccess', { playerName: player.name, sdg, topic: SDG_NAMES[sdg] || '' });
        nextTurn();
    }

    function failClaim(player, reason) {
        player.will = Math.max(0, player.will - 1);
        io.emit('log', `❌ Claim failed (${reason}), Will -1`);
        nextTurn();
    }

    socket.on('resetGame', () => {
        stopGameClock();
        gameState = {
            players: [],
            spectators: [],
            currentPlayerIdx: 0,
            claimedSDGs: [],
            claimedBy: {},
            board: [],
            phase: 'WAITING',
            timer: 0,
            currentAction: null,
            votes: { approve: 0, reject: 0, votedPlayers: [] },
            discardQueue: [],
            pendingDiscardCard: null
        };
        pendingEffect = null;
        pendingVirtue = null;
        gameClockStarted = false;
        gameClockRemaining = GAME_DURATION_SECONDS;
        emitGameClock();
        initBoard();
        io.emit('gameReset');
        io.emit('log', `🔄 Game has been reset. All players please rejoin.`);
    });

    socket.on('endGameNow', () => {
        if (gameState.phase === 'GAME_OVER') return;
        endGame('🛑 Game ended manually. Showing final leaderboard now.');
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        gameState.spectators = gameState.spectators.filter(s => s.id !== socket.id);
        io.emit('log', `A player disconnected`);
        io.emit('stateUpdate', gameState);
    });
});

server.listen(PORT, () => {
    console.log(`Game server started: http://localhost:${PORT}`);
});
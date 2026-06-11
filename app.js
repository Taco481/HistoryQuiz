const sb = sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const errorLog = [];

function logError(description, error) {
    const entry = { timestamp: new Date().toLocaleTimeString(), description, message: error?.message || String(error), details: error };
    errorLog.push(entry);
    console.error(description, error);
    renderErrorLog();
}

function renderErrorLog() {
    const list = document.getElementById('error-log-list');
    if (!list) return;
    list.innerHTML = errorLog.map(e =>
        `<div class="error-log-entry"><span class="timestamp">${e.timestamp}</span> ${e.description}: ${e.message}</div>`
    ).join('');
}

function toggleErrorLog() {
    const modal = document.getElementById('error-log-modal');
    modal.classList.toggle('hidden');
    renderErrorLog();
}

function clearErrorLog() {
    errorLog.length = 0;
    renderErrorLog();
}

const QUESTIONS = [
    {
        question: 'In welk jaar begon de Tweede Wereldoorlog?',
        options: ['1937', '1938', '1939', '1940'],
        answer: 2
    },
    {
        question: 'Wie was de eerste president van de Verenigde Staten?',
        options: ['Thomas Jefferson', 'George Washington', 'Abraham Lincoln', 'John Adams'],
        answer: 1
    },
    {
        question: 'Welke oude beschaving bouwde de piramides van Gizeh?',
        options: ['Romeinen', 'Grieken', 'Egyptenaren', 'Babyloniërs'],
        answer: 2
    },
    {
        question: 'In welk jaar viel de Berlijnse Muur?',
        options: ['1987', '1988', '1989', '1990'],
        answer: 2
    },
    {
        question: 'Wie ontdekte Amerika in 1492?',
        options: ['Vasco da Gama', 'Ferdinand Magellaan', 'Christopher Columbus', 'Amerigo Vespucci'],
        answer: 2
    },
    {
        question: 'Welke Franse keizer werd verslagen bij Waterloo?',
        options: ['Lodewijk XIV', 'Napoleon Bonaparte', 'Karel de Grote', 'Maximiliaan Robespierre'],
        answer: 1
    },
    {
        question: 'Wat was de naam van het schip waarmee de Pilgrim Fathers naar Amerika voeren?',
        options: ['Santa Maria', 'Mayflower', 'Victoria', 'Endeavour'],
        answer: 1
    },
    {
        question: 'In welk jaar werd de Verenigde Naties opgericht?',
        options: ['1942', '1945', '1948', '1950'],
        answer: 1
    },
    {
        question: 'Wie was de laatste farao van Egypte?',
        options: ['Cleopatra VII', 'Nefertiti', 'Hatsjepsoet', 'Ramses II'],
        answer: 0
    },
    {
        question: 'Welke Romeinse keizer bouwde het Colosseum?',
        options: ['Julius Caesar', 'Augustus', 'Vespasianus', 'Nero'],
        answer: 2
    },
    {
        question: 'In welk jaar landden de eerste mensen op de maan?',
        options: ['1967', '1968', '1969', '1970'],
        answer: 2
    },
    {
        question: 'Wat was de hoofdstad van het Byzantijnse Rijk?',
        options: ['Rome', 'Athene', 'Constantinopel', 'Alexandrië'],
        answer: 2
    }
];

let gameId = null;
let playerId = null;
let gameCode = null;
let playerName = null;
let hostName = null;
let currentQuestionIndex = 0;
let playerAnswered = false;

let supabaseChannel = null;

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
}

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function createGame() {
    hostName = document.getElementById('host-name').value.trim();
    if (!hostName) { alert('Voer je naam in als host.'); return; }

    const code = generateCode();

    try {
        const { data: game, error } = await supabase
            .from('games')
            .insert({ code, status: 'waiting' })
            .select()
            .single();

        if (error) { logError('Aanmaken quiz mislukt', error); alert('Fout bij aanmaken quiz: ' + error.message); return; }

        gameId = game.id;
        gameCode = code;

        const { data: player, error: pErr } = await supabase
            .from('players')
            .insert({ game_id: gameId, name: hostName + ' (host)', score: 0 })
            .select()
            .single();

        if (pErr) { logError('Aanmaken host mislukt', pErr); alert('Fout bij aanmaken host: ' + pErr.message); return; }

        playerId = player.id;

        subscribeToGame();

        document.getElementById('game-code-display').textContent = code;
        document.getElementById('host-setup').classList.add('hidden');
        document.getElementById('host-lobby').classList.remove('hidden');
    } catch (err) {
        logError('Onverwachte fout bij createGame', err);
        alert('Er is een fout opgetreden. Zie error log voor details.');
    }
}

async function joinGame() {
    playerName = document.getElementById('join-name').value.trim();
    const code = document.getElementById('join-code').value.trim().toUpperCase();

    if (!playerName) { alert('Voer je naam in.'); return; }
    if (!code || code.length !== 6) { alert('Voer een geldige 6-teken quiz code in.'); return; }

    try {
        const { data: game, error } = await supabase
            .from('games')
            .select('*')
            .eq('code', code)
            .single();

        if (error || !game) { logError('Quiz zoeken mislukt', error || new Error('Geen quiz gevonden')); alert('Quiz niet gevonden. Controleer de code.'); return; }

        if (game.status === 'finished') { alert('Deze quiz is al afgelopen.'); return; }

        gameId = game.id;
        gameCode = code;

        const { data: player, error: pErr } = await supabase
            .from('players')
            .insert({ game_id: gameId, name: playerName, score: 0 })
            .select()
            .single();

        if (pErr) { logError('Joinen mislukt', pErr); alert('Fout bij joinen: ' + pErr.message); return; }

        playerId = player.id;

        subscribeToGame();

        showView('play');
        document.getElementById('play-lobby').classList.remove('hidden');
        document.getElementById('play-question').classList.add('hidden');
        document.getElementById('play-result').classList.add('hidden');
        document.getElementById('play-waiting-msg').textContent = 'Wachten tot de host de quiz start...';

        if (game.status === 'active') {
            currentQuestionIndex = game.current_question;
            showPlayerQuestion(currentQuestionIndex);
        }
    } catch (err) {
        logError('Onverwachte fout bij joinGame', err);
        alert('Er is een fout opgetreden. Zie error log voor details.');
    }
}

function subscribeToGame() {
    if (supabaseChannel) supabaseChannel.unsubscribe();

    const channelName = 'game-' + gameId + '-' + Date.now();

    supabaseChannel = supabase
        .channel(channelName)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'games', filter: 'id=eq.' + gameId },
            handleGameChange
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'players', filter: 'game_id=eq.' + gameId },
            handlePlayerChange
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'answers', filter: 'game_id=eq.' + gameId },
            handleAnswerChange
        )
        .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                logError('Realtime verbinding mislukt (' + status + ')', err);
            }
        });
}

function handleGameChange(payload) {
    const game = payload.new;

    if (!game) return;

    // Host view
    const hostLobby = document.getElementById('host-lobby');
    const hostGame = document.getElementById('host-game');
    const hostResult = document.getElementById('host-result');

    if (game.status === 'active' && !hostGame.classList.contains('hidden')) {
        currentQuestionIndex = game.current_question || 0;
        showHostQuestion(currentQuestionIndex);
    }

    if (game.status === 'finished') {
        hostLobby.classList.add('hidden');
        hostGame.classList.add('hidden');
        hostResult.classList.remove('hidden');
        showFinalStandings();
    }

    // Player view
    if (game.status === 'active') {
        document.getElementById('play-lobby').classList.add('hidden');
        document.getElementById('play-question').classList.remove('hidden');
        document.getElementById('play-result').classList.add('hidden');
        currentQuestionIndex = game.current_question || 0;
        showPlayerQuestion(currentQuestionIndex);
    }

    if (game.status === 'finished') {
        document.getElementById('play-question').classList.add('hidden');
        document.getElementById('play-result').classList.remove('hidden');
        showPlayerStandings();
    }
}

async function handlePlayerChange() {
    await updatePlayerList();
    await updateHostScoreboard();
    await updateAnswerStatus();
}

async function handleAnswerChange() {
    await updateAnswerStatus();
    await updateHostScoreboard();
}

async function updatePlayerList() {
    const { data: players } = await supabase
        .from('players')
        .select('*')
        .eq('game_id', gameId);

    if (!players) return;

    const list = document.getElementById('player-list');
    list.innerHTML = players.map(p =>
        `<span class="player-chip">${p.name.replace(' (host)', '')}</span>`
    ).join('');
}

async function updateHostScoreboard() {
    const { data: players } = await supabase
        .from('players')
        .select('*')
        .eq('game_id', gameId)
        .order('score', { ascending: false });

    if (!players) return;

    const board = document.getElementById('host-scoreboard');
    board.innerHTML = players.map((p, i) =>
        `<span class="score-chip">#${i + 1} ${p.name.replace(' (host)', '')}: ${p.score}</span>`
    ).join('');
}

async function updateAnswerStatus() {
    const el = document.getElementById('host-answers-status');
    if (!el) return;

    const { data: players } = await supabase
        .from('players')
        .select('*')
        .eq('game_id', gameId);

    const { data: answers } = await supabase
        .from('answers')
        .select('*')
        .eq('game_id', gameId)
        .eq('question_index', currentQuestionIndex);

    if (!players || !answers) return;

    el.innerHTML = players.map(p => {
        const answered = answers.some(a => a.player_id === p.id);
        return `<span class="player-answer-chip ${answered ? 'answered' : 'waiting'}">${p.name.replace(' (host)', '')} ${answered ? '✓' : '...'}</span>`;
    }).join('');
}

async function startGame() {
    currentQuestionIndex = 0;
    const { error } = await supabase
        .from('games')
        .update({ status: 'active', current_question: 0 })
        .eq('id', gameId);

    if (error) { logError('Starten quiz mislukt', error); return; }

    document.getElementById('host-lobby').classList.add('hidden');
    document.getElementById('host-game').classList.remove('hidden');
    showHostQuestion(0);
}

function showHostQuestion(index) {
    const q = QUESTIONS[index];
    if (!q) { endGame(); return; }

    document.getElementById('host-question-number').textContent = `Vraag ${index + 1} van ${QUESTIONS.length}`;
    document.getElementById('host-question-text').textContent = q.question;
    document.getElementById('host-answers-status').innerHTML = '';

    const labels = ['A', 'B', 'C', 'D'];
    const optionsEl = document.getElementById('host-options');
    optionsEl.innerHTML = q.options.map((opt, i) =>
        `<button class="option-btn" disabled>${labels[i]}. ${opt}</button>`
    ).join('');

    document.getElementById('btn-next-question').textContent =
        index < QUESTIONS.length - 1 ? 'Volgende Vraag' : 'Bekijk Resultaten';
}

async function showPlayerQuestion(index) {
    const q = QUESTIONS[index];
    if (!q) return;

    playerAnswered = false;

    document.getElementById('play-question-number').textContent = `Vraag ${index + 1} van ${QUESTIONS.length}`;
    document.getElementById('play-question-text').textContent = q.question;
    document.getElementById('play-feedback').classList.add('hidden');
    document.getElementById('play-feedback').textContent = '';

    const labels = ['A', 'B', 'C', 'D'];
    const optionsEl = document.getElementById('play-options');
    optionsEl.innerHTML = q.options.map((opt, i) =>
        `<button class="option-btn" data-index="${i}" onclick="submitAnswer(${i})">${labels[i]}. ${opt}</button>`
    ).join('');

    const { data: existing } = await supabase
        .from('answers')
        .select('*')
        .eq('game_id', gameId)
        .eq('player_id', playerId)
        .eq('question_index', index)
        .maybeSingle();

    if (existing) {
        playerAnswered = true;
        const buttons = optionsEl.querySelectorAll('.option-btn');
        buttons.forEach((btn, i) => {
            btn.disabled = true;
            if (i === existing.answer) btn.classList.add(existing.correct ? 'correct' : 'wrong');
            if (i === q.answer) btn.classList.add('correct');
        });
        document.getElementById('play-feedback').textContent = existing.correct ? '✔ Goed!' : '✘ Helaas, dat is niet correct.';
        document.getElementById('play-feedback').className = existing.correct ? 'correct' : 'wrong';
    }

    await updatePlayerScore();
}

async function submitAnswer(index) {
    if (playerAnswered) return;
    playerAnswered = true;

    const q = QUESTIONS[currentQuestionIndex];
    const correct = index === q.answer;
    const points = correct ? 10 : 0;

    const { error } = await supabase
        .from('answers')
        .insert({
            game_id: gameId,
            player_id: playerId,
            question_index: currentQuestionIndex,
            answer: index,
            correct
        });

    if (error) { console.error(error); return; }

    if (correct) {
        const { data: current, error: fetchErr } = await supabase
            .from('players')
            .select('score')
            .eq('id', playerId)
            .single();
        if (fetchErr) { logError('Score ophalen mislukt', fetchErr); }
        if (current) {
            const { error: updateErr } = await supabase
                .from('players')
                .update({ score: current.score + points })
                .eq('id', playerId);
            if (updateErr) { logError('Score updaten mislukt', updateErr); }
        }
    }

    const buttons = document.getElementById('play-options').querySelectorAll('.option-btn');
    buttons.forEach((btn, i) => {
        btn.disabled = true;
        if (i === index) btn.classList.add(correct ? 'correct' : 'wrong');
        if (i === q.answer) btn.classList.add('correct');
    });

    const feedback = document.getElementById('play-feedback');
    feedback.textContent = correct ? '✔ Goed! +10 punten' : `✘ Het juiste antwoord was: ${q.options[q.answer]}`;
    feedback.className = correct ? 'correct' : 'wrong';
    feedback.classList.remove('hidden');

    await updatePlayerScore();
}

async function updatePlayerScore() {
    const { data: player } = await supabase
        .from('players')
        .select('score')
        .eq('id', playerId)
        .single();

    if (player) {
        document.getElementById('play-score-display').textContent = 'Score: ' + player.score;
    }
}

async function nextQuestion() {
    const nextIndex = currentQuestionIndex + 1;

    if (nextIndex >= QUESTIONS.length) {
        await endGame();
        return;
    }

    currentQuestionIndex = nextIndex;

    const { error } = await supabase
        .from('games')
        .update({ current_question: nextIndex })
        .eq('id', gameId);

    if (!error) {
        showHostQuestion(nextIndex);
    }
}

async function endGame() {
    const { error } = await supabase
        .from('games')
        .update({ status: 'finished' })
        .eq('id', gameId);

    if (error) console.error(error);
}

async function showFinalStandings() {
    const { data: players } = await supabase
        .from('players')
        .select('*')
        .eq('game_id', gameId)
        .order('score', { ascending: false });

    if (!players) return;

    const el = document.getElementById('final-standings');
    el.innerHTML = players.map((p, i) =>
        `<div class="standing-row">
            <span class="rank">#${i + 1}</span>
            <span class="name">${p.name.replace(' (host)', '')}</span>
            <span class="score">${p.score} pts</span>
        </div>`
    ).join('');
}

async function showPlayerStandings() {
    const { data: players } = await supabase
        .from('players')
        .select('*')
        .eq('game_id', gameId)
        .order('score', { ascending: false });

    if (!players) return;

    const myScore = players.find(p => p.id === playerId);
    document.getElementById('play-final-score').textContent =
        myScore ? `Jouw score: ${myScore.score} punten` : 'Quiz afgelopen!';

    const el = document.getElementById('play-standings');
    el.innerHTML = players.map((p, i) =>
        `<div class="standing-row">
            <span class="rank">#${i + 1}</span>
            <span class="name">${p.name.replace(' (host)', '')}</span>
            <span class="score">${p.score} pts</span>
        </div>`
    ).join('');
}

async function cancelGame() {
    if (gameId) {
        await sb.from('games').delete().eq('id', gameId);
    }
    resetQuiz();
}

function resetQuiz() {
    if (supabaseChannel) supabaseChannel.unsubscribe();
    gameId = null;
    playerId = null;
    gameCode = null;
    currentQuestionIndex = 0;
    playerAnswered = false;

    document.getElementById('host-setup').classList.remove('hidden');
    document.getElementById('host-lobby').classList.add('hidden');
    document.getElementById('host-game').classList.add('hidden');
    document.getElementById('host-result').classList.add('hidden');
    showView('home');
}

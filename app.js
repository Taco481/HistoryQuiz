const errorLog = [];

function logError(description, error) {
    const entry = { timestamp: new Date().toLocaleTimeString(), description, message: error?.message || String(error), details: error };
    errorLog.push(entry);
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

let sb = null;
let supabaseAvailable = false;

try {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
        sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        supabaseAvailable = true;
    }
} catch (e) {
    logError('Supabase init', e);
}

let gameId = null;
let playerId = null;
let gameCode = null;
let playerName = null;
let hostName = null;
let currentQuestionIndex = 0;
let playerAnswered = false;
let supabaseChannel = null;
let questions = [];
let editingQuestionId = null;
let hostParticipates = true;

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-' + viewId);
    if (el) el.classList.add('active');
}

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function onQuestionTypeChange() {
    const type = document.getElementById('q-type').value;
    document.getElementById('q-options-group').classList.toggle('hidden', type !== 'multiple');
    document.getElementById('q-truefalse-group').classList.toggle('hidden', type !== 'truefalse');
    document.getElementById('q-open-group').classList.toggle('hidden', type !== 'open');
}

async function createGame() {
    if (!supabaseAvailable) { alert('Supabase is niet beschikbaar.'); return; }

    hostName = document.getElementById('host-name').value.trim();
    if (!hostName) { alert('Voer je naam in als host.'); return; }

    hostParticipates = document.getElementById('host-participate').checked;
    const code = generateCode();

    try {
        const { data: game, error } = await sb.from('games').insert({ code, status: 'waiting' }).select().single();
        if (error) { logError('Aanmaken quiz mislukt', error); alert('Fout: ' + error.message); return; }

        gameId = game.id;
        gameCode = code;

        if (hostParticipates) {
            const { data: player, error: pErr } = await sb.from('players').insert({ game_id: gameId, name: hostName, score: 0 }).select().single();
            if (pErr) { logError('Aanmaken host-speler mislukt', pErr); }
            else { playerId = player.id; }
        }

        subscribeToGame();
        await loadQuestions();

        document.getElementById('game-code-display').textContent = code;
        document.getElementById('host-setup').classList.add('hidden');
        document.getElementById('host-lobby').classList.remove('hidden');
    } catch (err) {
        logError('Onverwachte fout', err);
    }
}

async function loadQuestions() {
    if (!sb) return;
    const { data: dbQuestions, error } = await sb.from('questions').select('*').eq('game_id', gameId).order('question_index', { ascending: true });

    if (error) { logError('Laden vragen mislukt', error); return; }
    questions = dbQuestions || [];
    renderQuestionList();
}

function renderQuestionList() {
    const list = document.getElementById('question-list');
    if (!list) return;

    if (questions.length === 0) {
        list.innerHTML = '<p style="color:#666;font-size:0.9rem;text-align:center;padding:12px;">Nog geen vragen. Voeg er een toe!</p>';
        return;
    }

    const labels = { multiple: ['A','B','C','D'], truefalse: ['Waar','Niet waar'], open: [] };
    list.innerHTML = questions.map(function(q, i) {
        const preview = q.question.length > 35 ? q.question.substring(0, 35) + '...' : q.question;
        let typeLabel = 'Meerkeuze';
        if (q.type === 'truefalse') typeLabel = 'W/NW';
        else if (q.type === 'open') typeLabel = 'Open';

        let answerHint = '';
        if (q.type === 'multiple') answerHint = ' (' + labels.multiple[q.answer] + ')';
        else if (q.type === 'truefalse') answerHint = q.answer === 'true' ? ' (Waar)' : ' (Niet waar)';
        else if (q.type === 'open') answerHint = q.answer ? '' : ' (zelf nakijken)';

        return '<div class="question-card">' +
            '<span class="q-preview"><strong>' + (i + 1) + '.</strong> [' + typeLabel + '] ' + preview + answerHint + '</span>' +
            '<span class="q-actions">' +
                '<button onclick="editQuestion(\'' + q.id + '\')" title="Bewerk">✏️</button>' +
                '<button onclick="deleteQuestion(\'' + q.id + '\')" title="Verwijder">🗑️</button>' +
            '</span></div>';
    }).join('');
}

function addQuestion() {
    editingQuestionId = null;
    document.getElementById('q-type').value = 'multiple';
    document.getElementById('q-text').value = '';
    document.getElementById('q-opt0').value = '';
    document.getElementById('q-opt1').value = '';
    document.getElementById('q-opt2').value = '';
    document.getElementById('q-opt3').value = '';
    document.getElementById('q-answer').value = '0';
    document.getElementById('q-tf-answer').value = 'true';
    document.getElementById('q-open-answer').value = '';
    onQuestionTypeChange();
    document.getElementById('question-form').classList.remove('hidden');
}

function editQuestion(id) {
    const q = questions.find(function(x) { return x.id === id; });
    if (!q) return;

    editingQuestionId = id;
    document.getElementById('q-type').value = q.type || 'multiple';
    document.getElementById('q-text').value = q.question;

    if (q.type === 'multiple') {
        document.getElementById('q-opt0').value = q.options[0] || '';
        document.getElementById('q-opt1').value = q.options[1] || '';
        document.getElementById('q-opt2').value = q.options[2] || '';
        document.getElementById('q-opt3').value = q.options[3] || '';
        document.getElementById('q-answer').value = q.answer;
    } else if (q.type === 'truefalse') {
        document.getElementById('q-tf-answer').value = q.answer;
    } else if (q.type === 'open') {
        document.getElementById('q-open-answer').value = q.answer || '';
    }

    onQuestionTypeChange();
    document.getElementById('question-form').classList.remove('hidden');
}

function cancelQuestionEdit() {
    document.getElementById('question-form').classList.add('hidden');
    editingQuestionId = null;
}

async function saveQuestion() {
    const type = document.getElementById('q-type').value;
    const question = document.getElementById('q-text').value.trim();
    if (!question) { alert('Voer een vraag in.'); return; }

    let options = null;
    let answer = '0';

    if (type === 'multiple') {
        const opts = [
            document.getElementById('q-opt0').value.trim(),
            document.getElementById('q-opt1').value.trim(),
            document.getElementById('q-opt2').value.trim(),
            document.getElementById('q-opt3').value.trim()
        ];
        if (!opts[0] || !opts[1] || !opts[2] || !opts[3]) { alert('Vul alle 4 opties in.'); return; }
        options = opts;
        answer = document.getElementById('q-answer').value;
    } else if (type === 'truefalse') {
        options = ['Waar', 'Niet waar'];
        answer = document.getElementById('q-tf-answer').value;
    } else if (type === 'open') {
        answer = document.getElementById('q-open-answer').value.trim() || '';
    }

    const payload = { type, question, options, answer };

    if (editingQuestionId) {
        const { error } = await sb.from('questions').update(payload).eq('id', editingQuestionId);
        if (error) { logError('Opslaan mislukt', error); alert('Fout bij opslaan.'); return; }
    } else {
        const nextIndex = questions.length;
        const { error } = await sb.from('questions').insert({ game_id: gameId, question_index: nextIndex, ...payload });
        if (error) { logError('Toevoegen mislukt', error); alert('Fout bij toevoegen.'); return; }
    }

    document.getElementById('question-form').classList.add('hidden');
    editingQuestionId = null;
    await loadQuestions();
}

async function deleteQuestion(id) {
    if (!confirm('Verwijder deze vraag?')) return;
    const { error } = await sb.from('questions').delete().eq('id', id);
    if (error) { logError('Verwijderen mislukt', error); return; }
    await loadQuestions();
    await reindexQuestions();
}

async function reindexQuestions() {
    const { data: remaining } = await sb.from('questions').select('id,question_index').eq('game_id', gameId).order('created_at', { ascending: true });
    if (!remaining) return;
    for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].question_index !== i) {
            await sb.from('questions').update({ question_index: i }).eq('id', remaining[i].id);
        }
    }
}

async function joinGame() {
    if (!supabaseAvailable) { alert('Supabase is niet beschikbaar.'); return; }

    playerName = document.getElementById('join-name').value.trim();
    const code = document.getElementById('join-code').value.trim().toUpperCase();

    if (!playerName) { alert('Voer je naam in.'); return; }
    if (!code || code.length !== 6) { alert('Voer een geldige 6-teken quiz code in.'); return; }

    try {
        const { data: game, error } = await sb.from('games').select('*').eq('code', code).single();
        if (error || !game) { alert('Quiz niet gevonden. Controleer de code.'); return; }
        if (game.status === 'finished') { alert('Deze quiz is al afgelopen.'); return; }

        gameId = game.id;
        gameCode = code;

        const { data: player, error: pErr } = await sb.from('players').insert({ game_id: gameId, name: playerName, score: 0 }).select().single();
        if (pErr) { alert('Fout bij joinen: ' + pErr.message); return; }

        playerId = player.id;
        subscribeToGame();
        await loadQuestions();

        showView('play');
        document.getElementById('play-lobby').classList.remove('hidden');
        document.getElementById('play-question').classList.add('hidden');
        document.getElementById('play-result').classList.add('hidden');
        document.getElementById('play-waiting-msg').textContent = 'Wachten tot de host de quiz start...';

        if (game.status === 'active') {
            currentQuestionIndex = game.current_question || 0;
            showPlayerQuestion(currentQuestionIndex);
        }
    } catch (err) {
        logError('Onverwachte fout bij joinGame', err);
    }
}

function subscribeToGame() {
    if (!sb) return;
    if (supabaseChannel) supabaseChannel.unsubscribe();

    supabaseChannel = sb.channel('game-' + gameId + '-' + Date.now())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: 'id=eq.' + gameId }, handleGameChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'game_id=eq.' + gameId }, handlePlayerChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: 'game_id=eq.' + gameId }, handleAnswerChange)
        .subscribe(function(status, err) {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') logError('Realtime verbinding mislukt', err);
        });
}

function handleGameChange(payload) {
    const game = payload.new;
    if (!game) return;

    if (game.status === 'active') {
        currentQuestionIndex = game.current_question || 0;
        document.getElementById('host-lobby').classList.add('hidden');
        document.getElementById('play-lobby').classList.add('hidden');
        document.getElementById('play-question').classList.remove('hidden');
        document.getElementById('play-result').classList.add('hidden');

        const hostGame = document.getElementById('host-game');
        if (!hostGame.classList.contains('hidden')) showHostQuestion(currentQuestionIndex);
        showPlayerQuestion(currentQuestionIndex);
    }

    if (game.status === 'finished') {
        document.getElementById('host-lobby').classList.add('hidden');
        document.getElementById('host-game').classList.add('hidden');
        document.getElementById('host-result').classList.remove('hidden');
        document.getElementById('play-question').classList.add('hidden');
        document.getElementById('play-result').classList.remove('hidden');
        showFinalStandings();
        showPlayerStandings();
    }
}

async function handlePlayerChange() {
    await updatePlayerList();
    await updateLeaderboard();
    await updateAnswerStatus();
}

async function handleAnswerChange() {
    await updateAnswerStatus();
    await updateLeaderboard();
    await loadOpenAnswers();
}

async function updatePlayerList() {
    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId);
    if (!players) return;
    const list = document.getElementById('player-list');
    list.innerHTML = players.map(function(p) { return '<span class="player-chip">' + p.name + '</span>'; }).join('');
}

async function updateLeaderboard() {
    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId).order('score', { ascending: false });
    if (!players) return;

    const board = document.getElementById('host-scoreboard');
    if (!board) return;

    const hostGame = document.getElementById('host-game');
    const isActive = !hostGame.classList.contains('hidden');

    if (isActive) {
        board.innerHTML = players.map(function(p, i) {
            return '<div class="leaderboard-row">' +
                '<span class="lb-rank">#' + (i + 1) + '</span>' +
                '<span class="lb-name">' + p.name + '</span>' +
                '<span class="lb-score">' + p.score + ' pts</span></div>';
        }).join('');
    } else {
        board.innerHTML = players.map(function(p) {
            return '<span class="score-chip">' + p.name + ': ' + p.score + '</span>';
        }).join('');
    }
}

async function updateAnswerStatus() {
    const el = document.getElementById('host-answers-status');
    if (!el) return;

    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId);
    const { data: answers } = await sb.from('answers').select('*').eq('game_id', gameId).eq('question_index', currentQuestionIndex);
    if (!players || !answers) return;

    el.innerHTML = players.map(function(p) {
        const answered = answers.some(function(a) { return a.player_id === p.id; });
        return '<span class="player-answer-chip ' + (answered ? 'answered' : 'waiting') + '">' + p.name + ' ' + (answered ? '✓' : '...') + '</span>';
    }).join('');
}

async function loadOpenAnswers() {
    const container = document.getElementById('host-open-answers');
    if (!container || container.classList.contains('hidden')) return;

    const q = questions[currentQuestionIndex];
    if (!q || q.type !== 'open') return;

    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId);
    const { data: answers } = await sb.from('answers').select('*').eq('game_id', gameId).eq('question_index', currentQuestionIndex);

    if (!players || !answers) return;

    container.innerHTML = answers.map(function(a) {
        const player = players.find(function(p) { return p.id === a.player_id; });
        const name = player ? player.name : 'Onbekend';
        const awarded = a.correct;
        return '<div class="open-answer-card">' +
            '<span class="oa-player">' + name + '</span>' +
            '<span class="oa-text">' + a.answer + '</span>' +
            '<button class="oa-correct-btn ' + (awarded ? 'awarded' : '') + '" onclick="awardOpenPoints(\'' + a.id + '\', ' + awarded + ')">' + (awarded ? '✓ ' : '') + 'Goedkeuren</button></div>';
    }).join('') || '<p style="color:#666;font-size:0.9rem;">Nog geen antwoorden...</p>';
}

async function awardOpenPoints(answerId, currentlyAwarded) {
    const points = currentlyAwarded ? -10 : 10;

    const { data: answer, error: aErr } = await sb.from('answers').select('*').eq('id', answerId).single();
    if (aErr || !answer) return;

    await sb.from('answers').update({ correct: !currentlyAwarded }).eq('id', answerId);

    const { data: player } = await sb.from('players').select('score').eq('id', answer.player_id).single();
    if (player) {
        await sb.from('players').update({ score: Math.max(0, player.score + points) }).eq('id', answer.player_id);
    }

    await loadOpenAnswers();
    await updateLeaderboard();
}

async function startGame() {
    await loadQuestions();
    if (questions.length === 0) { alert('Voeg minstens 1 vraag toe.'); return; }

    currentQuestionIndex = 0;
    const { error } = await sb.from('games').update({ status: 'active', current_question: 0 }).eq('id', gameId);
    if (error) { logError('Starten quiz mislukt', error); return; }

    document.getElementById('host-lobby').classList.add('hidden');
    document.getElementById('host-game').classList.remove('hidden');
    showHostQuestion(0);
}

function showHostQuestion(index) {
    if (index >= questions.length) { endGame(); return; }
    const q = questions[index];

    document.getElementById('host-question-number').textContent = 'Vraag ' + (index + 1) + ' van ' + questions.length;
    document.getElementById('host-question-text').textContent = q.question;
    document.getElementById('host-answers-status').innerHTML = '';

    const hostOptions = document.getElementById('host-options');
    const hostOpen = document.getElementById('host-open-answers');

    if (q.type === 'open') {
        hostOptions.classList.add('hidden');
        hostOptions.innerHTML = '';
        hostOpen.classList.remove('hidden');
        loadOpenAnswers();
    } else {
        hostOpen.classList.add('hidden');
        hostOpen.innerHTML = '';
        hostOptions.classList.remove('hidden');

        const labels = q.type === 'truefalse' ? ['Waar', 'Niet waar'] : ['A', 'B', 'C', 'D'];
        hostOptions.innerHTML = (q.options || []).map(function(opt, i) {
            return '<button class="option-btn" disabled>' + labels[i] + '. ' + opt + '</button>';
        }).join('');
    }

    document.getElementById('btn-next-question').textContent = index < questions.length - 1 ? 'Volgende Vraag' : 'Bekijk Resultaten';
}

async function showPlayerQuestion(index) {
    if (index >= questions.length) return;
    const q = questions[index];

    playerAnswered = false;
    document.getElementById('play-question-number').textContent = 'Vraag ' + (index + 1) + ' van ' + questions.length;
    document.getElementById('play-question-text').textContent = q.question;
    document.getElementById('play-feedback').classList.add('hidden');
    document.getElementById('play-feedback').textContent = '';

    const playOptions = document.getElementById('play-options');
    const playOpenInput = document.getElementById('play-open-input');

    if (q.type === 'open') {
        playOptions.classList.add('hidden');
        playOptions.innerHTML = '';
        playOpenInput.classList.remove('hidden');
        document.getElementById('play-open-answer').value = '';
    } else {
        playOpenInput.classList.add('hidden');
        playOptions.classList.remove('hidden');

        const labels = q.type === 'truefalse' ? ['Waar', 'Niet waar'] : ['A', 'B', 'C', 'D'];
        const opts = q.options || [];
        playOptions.innerHTML = opts.map(function(opt, i) {
            return '<button class="option-btn" data-index="' + i + '" onclick="submitAnswer(' + i + ')">' + labels[i] + '. ' + opt + '</button>';
        }).join('');
    }

    if (sb) {
        const { data: existing } = await sb.from('answers').select('*').eq('game_id', gameId).eq('player_id', playerId).eq('question_index', index).maybeSingle();
        if (existing) {
            playerAnswered = true;
            if (q.type === 'open') {
                playOpenInput.classList.add('hidden');
                const feedback = document.getElementById('play-feedback');
                feedback.textContent = 'Je antwoord: "' + existing.answer + '"';
                feedback.className = 'correct';
                feedback.classList.remove('hidden');
            } else {
                const buttons = playOptions.querySelectorAll('.option-btn');
                buttons.forEach(function(btn, i) {
                    btn.disabled = true;
                    if (i === parseInt(existing.answer)) btn.classList.add(existing.correct ? 'correct' : 'wrong');
                    if (i === parseInt(q.answer)) btn.classList.add('correct');
                });
                document.getElementById('play-feedback').textContent = existing.correct ? 'Goed!' : 'Helaas, dat is niet correct.';
                document.getElementById('play-feedback').className = existing.correct ? 'correct' : 'wrong';
            }
        }
    }

    await updatePlayerScore();
}

async function submitAnswer(index) {
    if (playerAnswered || !sb || currentQuestionIndex >= questions.length) return;
    playerAnswered = true;

    const q = questions[currentQuestionIndex];
    const correct = index === parseInt(q.answer);
    const points = correct ? 10 : 0;

    const { error } = await sb.from('answers').insert({
        game_id: gameId, player_id: playerId, question_index: currentQuestionIndex,
        answer: String(index), correct
    });

    if (error) { logError('Antwoord opslaan mislukt', error); return; }

    if (correct) {
        const { data: current } = await sb.from('players').select('score').eq('id', playerId).single();
        if (current) await sb.from('players').update({ score: current.score + points }).eq('id', playerId);
    }

    const buttons = document.getElementById('play-options').querySelectorAll('.option-btn');
    buttons.forEach(function(btn, i) {
        btn.disabled = true;
        if (i === index) btn.classList.add(correct ? 'correct' : 'wrong');
        if (i === parseInt(q.answer)) btn.classList.add('correct');
    });

    const feedback = document.getElementById('play-feedback');
    feedback.textContent = correct ? 'Goed! +10 punten' : 'Het juiste antwoord was: ' + (q.options[parseInt(q.answer)] || q.answer);
    feedback.className = correct ? 'correct' : 'wrong';
    feedback.classList.remove('hidden');

    await updatePlayerScore();
}

async function submitOpenAnswer() {
    if (playerAnswered || !sb) return;
    const input = document.getElementById('play-open-answer');
    const answer = input.value.trim();
    if (!answer) { alert('Typ een antwoord.'); return; }

    playerAnswered = true;
    const q = questions[currentQuestionIndex];

    await sb.from('answers').insert({
        game_id: gameId, player_id: playerId, question_index: currentQuestionIndex,
        answer: answer, correct: false
    });

    document.getElementById('play-open-input').classList.add('hidden');
    const feedback = document.getElementById('play-feedback');
    feedback.textContent = 'Antwoord verzonden: "' + answer + '". De host beoordeelt het.';
    feedback.className = 'correct';
    feedback.classList.remove('hidden');
}

async function updatePlayerScore() {
    if (!sb) return;
    const { data: player } = await sb.from('players').select('score').eq('id', playerId).single();
    if (player) document.getElementById('play-score-display').textContent = 'Score: ' + player.score;
}

async function nextQuestion() {
    const nextIndex = currentQuestionIndex + 1;
    if (nextIndex >= questions.length) { await endGame(); return; }

    currentQuestionIndex = nextIndex;
    const { error } = await sb.from('games').update({ current_question: nextIndex }).eq('id', gameId);
    if (!error) showHostQuestion(nextIndex);
}

async function endGame() {
    await sb.from('games').update({ status: 'finished' }).eq('id', gameId);
}

async function showFinalStandings() {
    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId).order('score', { ascending: false });
    if (!players) return;

    document.getElementById('final-standings').innerHTML = players.map(function(p, i) {
        return '<div class="standing-row">' +
            '<span class="rank">#' + (i + 1) + '</span>' +
            '<span class="name">' + p.name + '</span>' +
            '<span class="score">' + p.score + ' pts</span></div>';
    }).join('');
}

async function showPlayerStandings() {
    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId).order('score', { ascending: false });
    if (!players) return;

    const myScore = players.find(function(p) { return p.id === playerId; });
    document.getElementById('play-final-score').textContent = myScore ? 'Jouw score: ' + myScore.score + ' punten' : 'Quiz afgelopen!';

    document.getElementById('play-standings').innerHTML = players.map(function(p, i) {
        return '<div class="standing-row">' +
            '<span class="rank">#' + (i + 1) + '</span>' +
            '<span class="name">' + p.name + '</span>' +
            '<span class="score">' + p.score + ' pts</span></div>';
    }).join('');
}

async function cancelGame() {
    if (gameId && sb) await sb.from('games').delete().eq('id', gameId);
    resetQuiz();
}

function resetQuiz() {
    if (supabaseChannel) supabaseChannel.unsubscribe();
    gameId = null; playerId = null; gameCode = null; currentQuestionIndex = 0;
    playerAnswered = false; questions = []; editingQuestionId = null;

    document.getElementById('host-setup').classList.remove('hidden');
    document.getElementById('host-lobby').classList.add('hidden');
    document.getElementById('host-game').classList.add('hidden');
    document.getElementById('host-result').classList.add('hidden');
    showView('home');
}

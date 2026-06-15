const errorLog = [];
function logError(d, e) { errorLog.push({timestamp:new Date().toLocaleTimeString(),d,m:e?.message||String(e)}); renderErrorLog(); }
function renderErrorLog() {
    const list = document.getElementById('error-log-list');
    if (!list) return;
    list.innerHTML = errorLog.map(e => `<div class="error-log-entry"><span class="timestamp">${e.timestamp}</span> ${e.d}: ${e.m}</div>`).join('');
}
function toggleErrorLog() { document.getElementById('error-log-modal').classList.toggle('hidden'); renderErrorLog(); }
function clearErrorLog() { errorLog.length = 0; renderErrorLog(); }

let sb = null;
let supabaseAvailable = false;
try {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
        sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        supabaseAvailable = true;
    }
} catch (e) { logError('Supabase init', e); }

let gameId = null, playerId = null, gameCode = null, playerName = null, hostName = null;
let currentQuestionIndex = 0, playerAnswered = false, supabaseChannel = null;
let questions = [], editingQuestionId = null, hostParticipates = true;
let currentUser = null;
let gameMode = 'standard', modeState = {};
let timerInterval = null;

function goHome() {
    if (currentUser) {
        document.getElementById('user-bar').classList.remove('hidden');
        document.getElementById('login-btn-home').classList.add('hidden');
    } else {
        document.getElementById('login-btn-home').classList.remove('hidden');
    }
    showView('home');
}

function generateCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let r = '';
    for (let i = 0; i < 6; i++) r += c[Math.floor(Math.random()*c.length)];
    return r;
}

function onQuestionTypeChange() {
    const t = document.getElementById('q-type').value;
    document.getElementById('q-options-group').classList.toggle('hidden', t !== 'multiple');
    document.getElementById('q-truefalse-group').classList.toggle('hidden', t !== 'truefalse');
    document.getElementById('q-open-group').classList.toggle('hidden', t !== 'open');
}

function onModeChange() {
    const mode = document.getElementById('modeSelect').value;
    const desc = document.getElementById('modeDescription');
    const descriptions = {
        standard: 'Standaard: klassiek vragen beantwoorden, meeste punten wint',
        crypto: '🔐 Crypto Heist: kies een geheim wachtwoord na start. Bij goed antwoord kies je een beloningskaart (2x,3x,hack,+50,+20,+10,nothing). Bij hack raad je andermans wachtwoord!',
        tijdbom: '⏱️ Tijdbom: globale tijdslimiet, 1 punt per goed antwoord, bij fout 3s lockout, minste goede antwoorden verliest',
        snelle: '⚡ Snelle Vingers: snelste goede antwoord krijgt meeste punten',
        eliminatie: '💀 Eliminatie: laagste score wordt geëlimineerd na elke vraag',
        rush: '🚀 Rush: alle vragen tegelijk zichtbaar, beantwoord in willekeurige volgorde. Eindstand: wie alles goed heeft en het snelst klaar is wint!'
    };
    desc.textContent = descriptions[mode] || '';
}

// ==================== AUTH ====================

async function login() {
    const nickname = document.getElementById('auth-nickname').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!nickname || !password) { showAuthError('Vul gebruikersnaam en wachtwoord in.'); return; }
    try {
        const { data, error } = await sb.rpc('login_user', { payload: { username: nickname, password } });
        if (error) { showAuthError(error.message); return; }
        const user = data;
        if (user.error) { showAuthError(user.error); return; }
        localStorage.setItem('hq_user', JSON.stringify(user));
        await onAuth(user);
    } catch (e) { showAuthError('Fout bij inloggen.'); }
}

async function register() {
    const nickname = document.getElementById('auth-nickname').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!nickname || !password) { showAuthError('Vul gebruikersnaam en wachtwoord in.'); return; }
    try {
        const { data, error } = await sb.rpc('register_user', { payload: { username: nickname, password } });
        if (error) { showAuthError(error.message); return; }
        if (data?.error) { showAuthError(data.error); return; }
        showAuthError('Account gemaakt! Je kunt nu inloggen.', false);
    } catch (e) { showAuthError('Fout bij registreren.'); }
}

function showAuthError(msg, isError = true) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.color = isError ? '#e74c3c' : '#2ecc71';
}

async function onAuth(user) {
    if (!user) return;
    currentUser = user;
    document.getElementById('user-bar').classList.remove('hidden');
    document.getElementById('login-btn-home').classList.add('hidden');
    document.getElementById('user-email').textContent = 'Ingelogd als ' + user.username;
    showView('home');
    await loadProfile();
    await applySkin();
    await loadSavedQuizzesSelect();
}

async function loadProfile() {
    if (!currentUser) return;
    const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
    if (data) {
        currentUser.coins = data.coins;
        currentUser.selected_skin = data.selected_skin;
        document.getElementById('user-coins').textContent = '🪙 ' + data.coins;
        document.getElementById('shop-coins').textContent = 'Jouw coins: 🪙 ' + data.coins;
    }
}

async function logout() {
    currentUser = null;
    localStorage.removeItem('hq_user');
    document.getElementById('user-bar').classList.add('hidden');
    document.getElementById('login-btn-home').classList.remove('hidden');
    showView('home');
}

// Check saved session on load
(async function() {
    const saved = localStorage.getItem('hq_user');
    if (saved) await onAuth(JSON.parse(saved));
})();

// ==================== SHOP ====================

async function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-'+id);
    if (el) el.classList.add('active');
    if (id === 'shop') await renderShop();
}

async function renderShop() {
    if (!currentUser) { alert('Log eerst in.'); return; }
    await loadProfile();

    const { data: allSkins } = await sb.from('skins').select('*').order('price', { ascending: true });
    const { data: owned } = await sb.from('user_skins').select('skin_id').eq('user_id', currentUser.id);

    const ownedIds = owned ? owned.map(s => s.skin_id) : [];
    const grid = document.getElementById('skin-grid');
    grid.innerHTML = (allSkins || []).map(s => {
        const isOwned = ownedIds.includes(s.id);
        const isEquipped = currentUser?.selected_skin === s.name;
        return `<div class="skin-card ${isEquipped ? 'equipped' : isOwned ? 'owned' : ''}">
            <div class="skin-preview" style="background:linear-gradient(135deg,${s.bg_start},${s.bg_end});border:2px solid ${s.primary_color};"></div>
            <div class="skin-name">${s.display_name}</div>
            <div class="skin-desc">${s.description}</div>
            <div class="skin-price">🪙 ${s.price}</div>
            ${isEquipped ? '<span style="color:#2ecc71;font-size:0.85rem;">✓ Uitgerust</span>'
            : isOwned ? `<button class="btn primary small" onclick="equipSkin('${s.name}')">Uitrusten</button>`
            : `<button class="btn secondary small" onclick="buySkin('${s.id}','${s.name}',${s.price})">Kopen</button>`}
        </div>`;
    }).join('');
}

async function buySkin(skinId, skinName, price) {
    if (currentUser.coins < price) { alert('Niet genoeg coins!'); return; }
    const { error } = await sb.from('user_skins').insert({ user_id: currentUser.id, skin_id: skinId });
    if (error) { logError('Kopen mislukt', error); alert('Fout bij kopen.'); return; }
    await sb.from('profiles').update({ coins: currentUser.coins - price }).eq('id', currentUser.id);
    currentUser.coins -= price;
    await renderShop();
}

async function equipSkin(skinName) {
    await sb.from('profiles').update({ selected_skin: skinName }).eq('id', currentUser.id);
    currentUser.selected_skin = skinName;
    await applySkin();
    await renderShop();
}

async function applySkin() {
    const skinName = currentUser?.selected_skin || 'default';
    const { data: skins } = await sb.from('skins').select('*').eq('name', skinName).limit(1);
    if (!skins || !skins[0]) return;
    const s = skins[0];
    document.documentElement.style.setProperty('--primary', s.primary_color);
    document.documentElement.style.setProperty('--bg-start', s.bg_start);
    document.documentElement.style.setProperty('--bg-end', s.bg_end);
    document.body.style.background = `linear-gradient(135deg, ${s.bg_start}, ${s.bg_end})`;
}

// ==================== SAVED QUIZZES ====================

async function loadSavedQuizzesSelect() {
    if (!currentUser) { document.getElementById('saved-quiz-select').classList.add('hidden'); return; }
    const { data } = await sb.from('saved_quizzes').select('*').eq('user_id', currentUser.id).order('updated_at', { ascending: false });
    const select = document.getElementById('load-quiz-select');
    if (!data || data.length === 0) { document.getElementById('saved-quiz-select').classList.add('hidden'); return; }
    document.getElementById('saved-quiz-select').classList.remove('hidden');
    select.innerHTML = '<option value="">-- Kies een quiz --</option>' +
        data.map(q => `<option value="${q.id}">${q.title}</option>`).join('');
}

async function onLoadQuizSelect() {
    const id = document.getElementById('load-quiz-select').value;
    document.getElementById('load-quiz-select').dataset.selectedId = id;
}

async function loadSavedQuiz() {
    const id = document.getElementById('load-quiz-select').value;
    if (!id) { alert('Selecteer een quiz.'); return; }

    const { data: sq } = await sb.from('saved_questions').select('*').eq('quiz_id', id).order('question_index', { ascending: true });
    if (!sq || sq.length === 0) { alert('Deze quiz heeft geen vragen.'); return; }

    for (const q of sq) {
        const { error } = await sb.from('questions').insert({
            game_id: gameId, question_index: q.question_index,
            type: q.type, question: q.question, options: q.options, answer: q.answer
        });
        if (error) { logError('Laden vraag mislukt', error); }
    }
    await loadQuestions();
    alert(sq.length + ' vragen geladen!');
}

async function saveQuizTemplate() {
    if (!currentUser) { alert('Log in om een quiz op te slaan.'); return; }
    if (questions.length === 0) { alert('Voeg eerst vragen toe.'); return; }

    const title = prompt('Geef een naam voor deze quiz:');
    if (!title) return;

    const { data: quiz, error } = await sb.from('saved_quizzes').insert({
        user_id: currentUser.id, title
    }).select().single();

    if (error) { logError('Opslaan quiz mislukt', error); alert('Fout bij opslaan.'); return; }

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await sb.from('saved_questions').insert({
            quiz_id: quiz.id, question_index: i,
            type: q.type, question: q.question, options: q.options, answer: q.answer
        });
    }
    alert('Quiz opgeslagen!');
    await loadSavedQuizzesSelect();
}

// ==================== GAME ====================

async function createGame() {
    if (!supabaseAvailable) { alert('Supabase niet beschikbaar.'); return; }
    hostName = document.getElementById('host-name').value.trim();
    if (!hostName) { alert('Voer je naam in.'); return; }
    hostParticipates = document.getElementById('host-participate').checked;
    gameMode = document.getElementById('modeSelect').value;
    applyModeTheme(gameMode);
    const code = generateCode();

    let mode_state = {};
    if (gameMode === 'tijdbom') {
        const secs = parseInt(prompt('Totale tijdslimiet in seconden (30-300):') || '120');
        mode_state.timer_total = Math.max(30, Math.min(300, secs || 120));
    }

    try {
        const { data: game, error } = await sb.from('games').insert({ code, status: 'waiting', host_id: currentUser?.id, mode: gameMode, mode_state }).select().single();
        if (error) { logError('Aanmaken mislukt', error); alert('Fout: '+error.message); return; }
        gameId = game.id; gameCode = code;

        if (hostParticipates) {
            const { data: p } = await sb.from('players').insert({ game_id: gameId, name: hostName, score: 0 }).select().single();
            if (p) playerId = p.id;
        }
        subscribeToGame();
        await loadQuestions();
        document.getElementById('game-code-display').textContent = code;
        document.getElementById('host-setup').classList.add('hidden');
        document.getElementById('host-lobby').classList.remove('hidden');
        await loadSavedQuizzesSelect();
    } catch (err) { logError('Fout', err); }
}

async function loadQuestions() {
    if (!sb) return;
    const { data } = await sb.from('questions').select('*').eq('game_id', gameId).order('question_index', { ascending: true });
    if (data) questions = data;
    renderQuestionList();
}

function renderQuestionList() {
    const list = document.getElementById('question-list');
    if (!list) return;
    if (questions.length === 0) { list.innerHTML = '<p style="color:#666;font-size:0.9rem;text-align:center;padding:12px;">Nog geen vragen.</p>'; return; }
    const map = { multiple:'M', truefalse:'W/NW', open:'Open' };
    const labels = { multiple:['A','B','C','D'], truefalse:['Waar','Niet waar'], open:[] };
    list.innerHTML = questions.map((q,i) => {
        const p = q.question.length > 30 ? q.question.substring(0,30)+'...' : q.question;
        let hint = '';
        if (q.type === 'multiple') hint = ' ('+labels.multiple[parseInt(q.answer)]+')';
        else if (q.type === 'truefalse') hint = q.answer === 'true' ? ' (Waar)' : ' (Niet waar)';
        return '<div class="question-card"><span class="q-preview"><strong>'+(i+1)+'.</strong> ['+map[q.type]+'] '+p+hint+'</span>'+
            '<span class="q-actions"><button onclick="editQuestion(\''+q.id+'\')">✏️</button>'+
            '<button onclick="deleteQuestion(\''+q.id+'\')">🗑️</button></span></div>';
    }).join('');
}

function addQuestion() {
    editingQuestionId = null;
    document.getElementById('q-type').value = 'multiple';
    document.getElementById('q-text').value = '';
    ['q-opt0','q-opt1','q-opt2','q-opt3'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('q-answer').value = '0';
    document.getElementById('q-tf-answer').value = 'true';
    document.getElementById('q-open-answer').value = '';
    onQuestionTypeChange();
    document.getElementById('question-form').classList.remove('hidden');
}

function editQuestion(id) {
    const q = questions.find(x => x.id === id);
    if (!q) return;
    editingQuestionId = id;
    document.getElementById('q-type').value = q.type || 'multiple';
    document.getElementById('q-text').value = q.question;
    if (q.type === 'multiple') {
        ['q-opt0','q-opt1','q-opt2','q-opt3'].forEach((id,i) => document.getElementById(id).value = q.options?.[i] || '');
        document.getElementById('q-answer').value = q.answer;
    } else if (q.type === 'truefalse') document.getElementById('q-tf-answer').value = q.answer;
    else if (q.type === 'open') document.getElementById('q-open-answer').value = q.answer || '';
    onQuestionTypeChange();
    document.getElementById('question-form').classList.remove('hidden');
}

function cancelQuestionEdit() { document.getElementById('question-form').classList.add('hidden'); editingQuestionId = null; }

async function saveQuestion() {
    const type = document.getElementById('q-type').value;
    const question = document.getElementById('q-text').value.trim();
    if (!question) { alert('Voer een vraag in.'); return; }
    let options = null, answer = '0';
    if (type === 'multiple') {
        const opts = [0,1,2,3].map(i => document.getElementById('q-opt'+i).value.trim());
        if (opts.some(o => !o)) { alert('Vul alle opties in.'); return; }
        options = opts; answer = document.getElementById('q-answer').value;
    } else if (type === 'truefalse') { options = ['Waar','Niet waar']; answer = document.getElementById('q-tf-answer').value; }
    else { answer = document.getElementById('q-open-answer').value.trim() || ''; }

    const payload = { type, question, options, answer };
    if (editingQuestionId) {
        await sb.from('questions').update(payload).eq('id', editingQuestionId);
    } else {
        await sb.from('questions').insert({ game_id: gameId, question_index: questions.length, ...payload });
    }
    document.getElementById('question-form').classList.add('hidden');
    editingQuestionId = null;
    await loadQuestions();
}

async function deleteQuestion(id) {
    if (!confirm('Verwijder deze vraag?')) return;
    await sb.from('questions').delete().eq('id', id);
    await loadQuestions();
    const { data: r } = await sb.from('questions').select('id').eq('game_id', gameId).order('created_at');
    if (r) for (let i=0;i<r.length;i++) await sb.from('questions').update({question_index:i}).eq('id',r[i].id);
}

async function joinGame() {
    if (!supabaseAvailable) { alert('Supabase niet beschikbaar.'); return; }
    playerName = document.getElementById('join-name').value.trim();
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!playerName) { alert('Voer je naam in.'); return; }
    if (!code || code.length !== 6) { alert('Voer een geldige code in.'); return; }

    const { data: game } = await sb.from('games').select('*').eq('code', code).single();
    if (!game) { alert('Quiz niet gevonden.'); return; }
    if (game.status === 'finished') { alert('Deze quiz is al afgelopen.'); return; }
    gameId = game.id; gameCode = code; gameMode = game.mode || 'standard';
    modeState = game.mode_state || {};
    applyModeTheme(gameMode);

    const state = gameMode === 'eliminatie' ? { eliminated: false } : {};
    const { data: player } = await sb.from('players').insert({ game_id: gameId, name: playerName, score: 0, state }).select().single();
    if (!player) { alert('Fout bij joinen.'); return; }
    playerId = player.id;
    subscribeToGame();
    await loadQuestions();
    showView('play');
    document.getElementById('play-lobby').classList.remove('hidden');
    document.getElementById('play-question').classList.add('hidden');
    document.getElementById('play-result').classList.add('hidden');
    document.getElementById('play-waiting-msg').textContent = 'Wachten tot de host de quiz start...';
    if (game.status === 'active') { currentQuestionIndex = game.current_question || 0; showPlayerQuestion(currentQuestionIndex); }
}

function subscribeToGame() {
    if (!sb) return;
    if (supabaseChannel) supabaseChannel.unsubscribe();
    supabaseChannel = sb.channel('g-'+gameId+'-'+Date.now())
        .on('postgres_changes',{event:'*',schema:'public',table:'games',filter:'id=eq.'+gameId},handleGameChange)
        .on('postgres_changes',{event:'*',schema:'public',table:'players',filter:'game_id=eq.'+gameId},handlePlayerChange)
        .on('postgres_changes',{event:'*',schema:'public',table:'answers',filter:'game_id=eq.'+gameId},handleAnswerChange)
        .subscribe((s,e) => { if (s==='CHANNEL_ERROR'||s==='TIMED_OUT') logError('Realtime mislukt',e); });
}

function handleGameChange(payload) {
    const game = payload.new;
    if (!game) return;
    gameMode = game.mode || 'standard';
    modeState = game.mode_state || {};
    applyModeTheme(gameMode);
    if (game.status === 'active') {
        currentQuestionIndex = game.current_question || 0;
        document.getElementById('host-lobby').classList.add('hidden');
        document.getElementById('play-lobby').classList.add('hidden');
        document.getElementById('play-question').classList.remove('hidden');
        document.getElementById('play-result').classList.add('hidden');
        if (!document.getElementById('host-game').classList.contains('hidden')) showHostQuestion(currentQuestionIndex);
        showPlayerQuestion(currentQuestionIndex);
    }
    if (game.status === 'finished') {
        document.getElementById('host-lobby').classList.add('hidden');
        document.getElementById('host-game').classList.add('hidden');
        document.getElementById('host-result').classList.remove('hidden');
        document.getElementById('play-question').classList.add('hidden');
        document.getElementById('play-result').classList.remove('hidden');
        showFinalStandings(); showPlayerStandings();
        if (game.host_id === currentUser?.id) awardHostCoins();
    }
}

async function awardHostCoins() {
    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId);
    const count = players ? players.length : 0;
    if (count < 1) return;
    const coins = count * 5;
    const { data: prof } = await sb.from('profiles').select('coins').eq('id', currentUser.id).single();
    if (prof) {
        await sb.from('profiles').update({ coins: prof.coins + coins }).eq('id', currentUser.id);
        const el = document.getElementById('earnings-msg');
        el.textContent = '🎉 +' + coins + ' coins verdiend (' + count + ' spelers x 5)!';
        el.classList.remove('hidden');
        currentUser.coins = prof.coins + coins;
    }
}

async function handlePlayerChange() { await updatePlayerList(); await updateLeaderboard(); await updateAnswerStatus(); }
async function handleAnswerChange() {
    await updateAnswerStatus(); await updateLeaderboard(); await loadOpenAnswers();
    if (gameMode === 'rush') {
        if (!document.getElementById('play-lobby').classList.contains('hidden')) return;
        renderRushPlayerNav();
    }
}

async function updatePlayerList() {
    const { data: p } = await sb.from('players').select('*').eq('game_id', gameId);
    if (!p) return;
    document.getElementById('player-list').innerHTML = p.map(x => '<span class="player-chip">'+x.name+'</span>').join('');
}

async function updateLeaderboard() {
    const { data: p } = await sb.from('players').select('*').eq('game_id', gameId).order('score',{ascending:false});
    if (!p) return;
    const board = document.getElementById('host-scoreboard');
    if (!board) return;
    const isActive = !document.getElementById('host-game').classList.contains('hidden');
    if (gameMode === 'eliminatie') {
        const elimPlayers = p.filter(x => x.state?.eliminated).map(x => x.name);
        board.innerHTML = (isActive ? p.map((x,i) => {
            const isElim = x.state?.eliminated;
            return '<div class="leaderboard-row '+(isElim?'eliminated':'')+'"><span class="lb-rank">#'+(i+1)+'</span><span class="lb-name">'+x.name+(isElim?' 💀':'')+'</span><span class="lb-score">'+x.score+' pts</span></div>';
        }).join('') : p.map(x => '<span class="score-chip">'+x.name+': '+x.score+(x.state?.eliminated?' 💀':'')+'</span>').join(''));
    } else {
        board.innerHTML = isActive
            ? p.map((x,i) => '<div class="leaderboard-row"><span class="lb-rank">#'+(i+1)+'</span><span class="lb-name">'+x.name+'</span><span class="lb-score">'+x.score+' pts</span></div>').join('')
            : p.map(x => '<span class="score-chip">'+x.name+': '+x.score+'</span>').join('');
    }
}

async function updateAnswerStatus() {
    const el = document.getElementById('host-answers-status');
    if (!el) return;
    const { data: pl } = await sb.from('players').select('*').eq('game_id', gameId);
    const { data: an } = await sb.from('answers').select('*').eq('game_id', gameId).eq('question_index', currentQuestionIndex);
    if (!pl || !an) return;
    el.innerHTML = pl.map(p => '<span class="player-answer-chip '+(an.some(a=>a.player_id===p.id)?'answered':'waiting')+'">'+p.name+' '+(an.some(a=>a.player_id===p.id)?'✓':'...')+'</span>').join('');
}

async function loadOpenAnswers() {
    const c = document.getElementById('host-open-answers');
    if (!c || c.classList.contains('hidden')) return;
    const q = questions[currentQuestionIndex];
    if (!q || q.type !== 'open') return;
    const { data: pl } = await sb.from('players').select('*').eq('game_id', gameId);
    const { data: an } = await sb.from('answers').select('*').eq('game_id', gameId).eq('question_index', currentQuestionIndex);
    if (!pl || !an) return;
    c.innerHTML = an.map(a => {
        const p = pl.find(x => x.id === a.player_id);
        return '<div class="open-answer-card"><span class="oa-player">'+(p?.name||'?')+'</span><span class="oa-text">'+a.answer+'</span>'+
            '<button class="oa-correct-btn '+(a.correct?'awarded':'')+'" onclick="awardOpenPoints(\''+a.id+'\','+a.correct+')">'+(a.correct?'✓ ':'')+'Goedkeuren</button></div>';
    }).join('') || '<p style="color:#666;">Nog geen antwoorden...</p>';
}

async function awardOpenPoints(answerId, current) {
    const pts = current ? -10 : 10;
    const { data: an } = await sb.from('answers').select('*').eq('id', answerId).single();
    if (!an) return;
    await sb.from('answers').update({ correct: !current }).eq('id', answerId);
    const { data: pl } = await sb.from('players').select('score').eq('id', an.player_id).single();
    if (pl) await sb.from('players').update({ score: Math.max(0, pl.score + pts) }).eq('id', an.player_id);
    await loadOpenAnswers(); await updateLeaderboard();
}

async function startGame() {
    await loadQuestions();
    if (questions.length === 0) { alert('Voeg minstens 1 vraag toe.'); return; }
    applyModeTheme(gameMode);
    currentQuestionIndex = 0;
    const update = { status:'active', current_question:0 };
    if (gameMode === 'rush') {
        update.mode_state = { rush_unlocked: questions.map(() => true) };
    }
    if (gameMode === 'tijdbom') {
        const totalSecs = modeState.timer_total || 120;
        const timerEnd = new Date(Date.now() + totalSecs * 1000).toISOString();
        update.mode_state = { timer_total: totalSecs, timer_end: timerEnd };
        modeState = update.mode_state;
        startGlobalTimer('host');
    }
    await sb.from('games').update(update).eq('id', gameId);
    document.getElementById('host-lobby').classList.add('hidden');
    document.getElementById('host-game').classList.remove('hidden');
    showHostQuestion(0);
}

function showHostQuestion(index) {
    if (index >= questions.length) { endGame(); return; }
    const q = questions[index];
    document.getElementById('host-question-number').textContent = 'Vraag '+(index+1)+' van '+questions.length;
    document.getElementById('host-question-text').textContent = q.question;
    document.getElementById('host-answers-status').innerHTML = '';

    const ho = document.getElementById('host-options');
    const ha = document.getElementById('host-open-answers');
    const timerEl = document.getElementById('host-timer');
    const navEl = document.getElementById('rush-host-nav');

    if (gameMode === 'rush') {
        renderRushHostNav();
        document.getElementById('btn-next-question').textContent = 'Quiz Beëindigen';
        document.getElementById('btn-next-question').onclick = endGame;
    } else {
        const btnLabel = index < questions.length - 1 ? 'Volgende Vraag' : 'Bekijk Resultaten';
        document.getElementById('btn-next-question').textContent = btnLabel;
        document.getElementById('btn-next-question').onclick = nextQuestion;
    }

    if (gameMode === 'tijdbom') {
        timerEl.classList.remove('hidden');
        if (!window._globalTimerRunning) startGlobalTimer('host');
    } else if (gameMode !== 'rush') {
        timerEl.classList.add('hidden');
        clearInterval(timerInterval);
    } else {
        timerEl.classList.add('hidden');
    }

    if (q.type === 'open') {
        ho.classList.add('hidden'); ho.innerHTML = '';
        ha.classList.remove('hidden'); loadOpenAnswers();
    } else {
        ha.classList.add('hidden'); ha.innerHTML = '';
        ho.classList.remove('hidden');
        const lbl = q.type === 'truefalse' ? ['Waar','Niet waar'] : ['A','B','C','D'];
        ho.innerHTML = (q.options||[]).map((o,i) => '<button class="option-btn" disabled>'+lbl[i]+'. '+o+'</button>').join('');
    }
}

async function showPlayerQuestion(index) {
    if (index >= questions.length) return;

    // Crypto: check if player has set password yet
    if (gameMode === 'crypto') {
        const { data: me } = await sb.from('players').select('state').eq('id', playerId).single();
        if (!me?.state?.crypto_password) {
            document.getElementById('play-question').classList.add('hidden');
            document.getElementById('play-crypto-setup').classList.remove('hidden');
            document.getElementById('play-crypto-cards').classList.add('hidden');
            document.getElementById('crypto-hack-modal').classList.add('hidden');
            return;
        }
        document.getElementById('play-crypto-setup').classList.add('hidden');
        document.getElementById('play-question').classList.remove('hidden');
    }

    const q = questions[index];
    playerAnswered = false;
    document.getElementById('play-question-number').textContent = 'Vraag '+(index+1)+' van '+questions.length;
    document.getElementById('play-question-text').textContent = q.question;
    document.getElementById('play-feedback').classList.add('hidden');
    document.getElementById('play-feedback').textContent = '';

    const timerEl = document.getElementById('play-timer');
    const rushNav = document.getElementById('rush-question-nav');

    if (gameMode === 'rush') {
        rushNav.classList.remove('hidden');
        rushNav.style.display = 'flex';
        renderRushPlayerNav();
    } else {
        rushNav.classList.add('hidden');
        rushNav.innerHTML = '';
    }

    if (gameMode === 'tijdbom') {
        timerEl.classList.remove('hidden');
        if (!window._globalTimerRunning) startGlobalTimer('player');
    } else {
        timerEl.classList.add('hidden');
        clearInterval(timerInterval);
    }

    // Check if player is eliminated (Eliminatie mode)
    if (gameMode === 'eliminatie') {
        const { data: p } = await sb.from('players').select('state').eq('id', playerId).single();
        if (p?.state?.eliminated) {
            document.getElementById('play-question-text').textContent = 'Je bent geëlimineerd!';
            document.getElementById('play-options').classList.add('hidden');
            document.getElementById('play-options').innerHTML = '';
            document.getElementById('play-open-input').classList.add('hidden');
            return;
        }
    }

    const po = document.getElementById('play-options');
    const pi = document.getElementById('play-open-input');

    if (q.type === 'open') {
        po.classList.add('hidden'); po.innerHTML = '';
        pi.classList.remove('hidden'); document.getElementById('play-open-answer').value = '';
    } else {
        pi.classList.add('hidden'); po.classList.remove('hidden');
        const lbl = q.type === 'truefalse' ? ['Waar','Niet waar'] : ['A','B','C','D'];
        po.innerHTML = (q.options||[]).map((o,i) => '<button class="option-btn" data-index="'+i+'" onclick="submitAnswer('+i+')">'+lbl[i]+'. '+o+'</button>').join('');
    }

    if (sb) {
        const { data: ex } = await sb.from('answers').select('*').eq('game_id',gameId).eq('player_id',playerId).eq('question_index',index).maybeSingle();
        if (ex) {
            playerAnswered = true;
            if (q.type === 'open') {
                pi.classList.add('hidden');
                document.getElementById('play-feedback').textContent = 'Je antwoord: "'+ex.answer+'"';
                document.getElementById('play-feedback').className = 'correct'; document.getElementById('play-feedback').classList.remove('hidden');
            } else {
                document.querySelectorAll('#play-options .option-btn').forEach((b,i) => {
                    b.disabled = true;
                    if (i === parseInt(ex.answer)) b.classList.add(ex.correct ? 'correct':'wrong');
                    if (i === parseInt(q.answer)) b.classList.add('correct');
                });
                document.getElementById('play-feedback').textContent = ex.correct ? 'Goed!' : 'Helaas.';
                document.getElementById('play-feedback').className = ex.correct ? 'correct' : 'wrong';
            }
        }
    }
    await updatePlayerScore();
}

async function submitAnswer(index) {
    if (!sb || currentQuestionIndex >= questions.length) return;
    // In Rush mode, check per-question; otherwise use global flag
    if (gameMode !== 'rush') {
        if (playerAnswered) return;
        playerAnswered = true;
    } else {
        // Rush: check if already answered this question
        const { data: ex } = await sb.from('answers').select('id').eq('game_id',gameId).eq('player_id',playerId).eq('question_index',currentQuestionIndex).maybeSingle();
        if (ex) return;
    }
    // Check elimination
    if (gameMode === 'eliminatie') {
        const { data: p } = await sb.from('players').select('state').eq('id', playerId).single();
        if (p?.state?.eliminated) return;
    }
    // Tijdbom: check lockout
    if (gameMode === 'tijdbom') {
        const { data: p } = await sb.from('players').select('state').eq('id', playerId).single();
        if (p?.state?.lockout_until && new Date(p.state.lockout_until) > new Date()) {
            const remaining = Math.ceil((new Date(p.state.lockout_until) - new Date()) / 1000);
            document.getElementById('play-feedback').textContent = '⏳ Wacht nog ' + remaining + 's (lockout)';
            document.getElementById('play-feedback').className = 'wrong';
            document.getElementById('play-feedback').classList.remove('hidden');
            return;
        }
    }
    const q = questions[currentQuestionIndex];
    const correct = index === parseInt(q.answer);

    let pts = correct ? 10 : 0;
    // Tijdbom: 1 point per correct answer, wrong = 3s lockout
    if (gameMode === 'tijdbom') {
        pts = correct ? 1 : 0;
        await sb.from('answers').insert({ game_id:gameId, player_id:playerId, question_index:currentQuestionIndex, answer:String(index), correct });
        if (correct) {
            const { data: c } = await sb.from('players').select('score').eq('id',playerId).single();
            if (c) await sb.from('players').update({ score: c.score + 1 }).eq('id',playerId);
            document.querySelectorAll('#play-options .option-btn').forEach((b,i) => {
                b.disabled = true;
                if (i === index) b.classList.add('correct');
                if (i === parseInt(q.answer)) b.classList.add('correct');
            });
            document.getElementById('play-feedback').textContent = 'Goed! +1 punt';
            document.getElementById('play-feedback').className = 'correct';
            document.getElementById('play-feedback').classList.remove('hidden');
        } else {
            const lockoutUntil = new Date(Date.now() + 3000).toISOString();
            await sb.from('players').update({ state: { lockout_until: lockoutUntil } }).eq('id', playerId);
            document.querySelectorAll('#play-options .option-btn').forEach(b => b.disabled = true);
            document.getElementById('play-feedback').textContent = '❌ Fout! 3 seconden lockout...';
            document.getElementById('play-feedback').className = 'wrong';
            document.getElementById('play-feedback').classList.remove('hidden');
            setTimeout(() => {
                document.querySelectorAll('#play-options .option-btn').forEach(b => b.disabled = false);
                document.getElementById('play-feedback').classList.add('hidden');
            }, 3000);
        }
        await updatePlayerScore();
        return;
    }
    // Crypto Heist: correct answer gives card draw
    if (correct && gameMode === 'crypto') {
        await sb.from('answers').insert({ game_id:gameId, player_id:playerId, question_index:currentQuestionIndex, answer:String(index), correct });
        playerAnswered = false; // allow card interaction
        showCryptoCards();
        return;
    }
    // Snelle Vingers: points based on answer position
    if (correct && gameMode === 'snelle') {
        const { data: an } = await sb.from('answers').select('id').eq('game_id', gameId).eq('question_index', currentQuestionIndex).eq('correct', true);
        const pos = an ? an.length : 0;
        pts = pos === 0 ? 15 : pos === 1 ? 12 : pos === 2 ? 10 : 8;
    }

    await sb.from('answers').insert({ game_id:gameId, player_id:playerId, question_index:currentQuestionIndex, answer:String(index), correct });
    if (correct && pts > 0) {
        const { data: c } = await sb.from('players').select('score').eq('id',playerId).single();
        if (c) await sb.from('players').update({ score: c.score + pts }).eq('id',playerId);
    }
    document.querySelectorAll('#play-options .option-btn').forEach((b,i) => {
        b.disabled = true;
        if (i === index) b.classList.add(correct?'correct':'wrong');
        if (i === parseInt(q.answer)) b.classList.add('correct');
    });
    const ptsMsg = gameMode === 'snelle' && correct ? ' +'+pts : correct ? ' +10' : '';
    document.getElementById('play-feedback').textContent = correct ? 'Goed!'+ptsMsg+' punten' : 'Het antwoord was: '+(q.options?.[parseInt(q.answer)]||q.answer);
    document.getElementById('play-feedback').className = correct ? 'correct' : 'wrong';
    document.getElementById('play-feedback').classList.remove('hidden');
    await updatePlayerScore();
}

async function submitOpenAnswer() {
    if (!sb) return;
    if (gameMode !== 'rush') {
        if (playerAnswered) return;
        playerAnswered = true;
    } else {
        const { data: ex } = await sb.from('answers').select('id').eq('game_id',gameId).eq('player_id',playerId).eq('question_index',currentQuestionIndex).maybeSingle();
        if (ex) return;
    }
    // Check elimination
    if (gameMode === 'eliminatie') {
        const { data: p } = await sb.from('players').select('state').eq('id', playerId).single();
        if (p?.state?.eliminated) return;
    }
    const inp = document.getElementById('play-open-answer');
    const a = inp.value.trim();
    if (!a) { alert('Typ een antwoord.'); return; }
    if (gameMode !== 'rush') playerAnswered = true;
    await sb.from('answers').insert({ game_id:gameId, player_id:playerId, question_index:currentQuestionIndex, answer:a, correct:false });
    document.getElementById('play-open-input').classList.add('hidden');
    document.getElementById('play-feedback').textContent = 'Antwoord verzonden! De host beoordeelt het.';
    document.getElementById('play-feedback').className = 'correct';
    document.getElementById('play-feedback').classList.remove('hidden');
}

async function updatePlayerScore() {
    if (!sb) return;
    const { data: p } = await sb.from('players').select('score').eq('id',playerId).single();
    if (p) document.getElementById('play-score-display').textContent = 'Score: '+p.score;
}

async function nextQuestion() {
    // Eliminatie: eliminate lowest-scoring player(s) every 3 questions
    if (gameMode === 'eliminatie') {
        const n = currentQuestionIndex + 1;
        if (n % 3 === 0 && n > 0) {
            await doElimination();
            const { data: active } = await sb.from('players').select('*').eq('game_id', gameId).filter('state->>eliminated', 'eq', 'false');
            if (active && active.length <= 1) { await endGame(); return; }
        }
    }
    const n = currentQuestionIndex + 1;
    if (n >= questions.length) { await endGame(); return; }
    currentQuestionIndex = n;
    await sb.from('games').update({ current_question: n }).eq('id', gameId);
    showHostQuestion(n);
}

async function doElimination() {
    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId).filter('state->>eliminated', 'eq', 'false');
    if (!players || players.length <= 1) return;
    const minScore = Math.min(...players.map(p => p.score));
    for (const p of players) {
        if (p.score === minScore) {
            await sb.from('players').update({ state: { eliminated: true } }).eq('id', p.id);
        }
    }
}

// ==================== CRYPTO HEIST ====================

async function setCryptoPassword() {
    const pw = document.getElementById('crypto-setup-password').value.trim();
    if (!pw || pw.length < 2) { document.getElementById('crypto-setup-error').textContent = 'Kies een wachtwoord van min. 2 tekens.'; document.getElementById('crypto-setup-error').classList.remove('hidden'); return; }
    document.getElementById('crypto-setup-error').classList.add('hidden');
    await sb.from('players').update({ state: { crypto_password: pw } }).eq('id', playerId);
    document.getElementById('play-crypto-setup').classList.add('hidden');
    showPlayerQuestion(currentQuestionIndex);
}

function showCryptoCards() {
    document.getElementById('play-question').classList.add('hidden');
    document.getElementById('play-crypto-setup').classList.add('hidden');
    document.getElementById('play-crypto-cards').classList.remove('hidden');
    document.getElementById('crypto-card-result').classList.add('hidden');

    const rewards = ['2x', '3x', 'hack', '+50', '+20', '+10', 'nothing'];
    const shuffled = rewards.sort(() => Math.random() - 0.5).slice(0, 3);
    const grid = document.getElementById('crypto-card-grid');
    grid.innerHTML = shuffled.map((r, i) =>
        `<div class="crypto-card" data-reward="${r}" onclick="pickCryptoCard(${i},this)" style="width:100px;height:140px;background:linear-gradient(135deg,#e94560,#c0392b);border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:2rem;color:#fff;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:transform 0.3s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">❓</div>`
    ).join('');
    window._cryptoRewards = shuffled;
}

async function pickCryptoCard(idx, el) {
    const rewards = window._cryptoRewards;
    if (!rewards) return;
    // Disable all cards
    document.querySelectorAll('.crypto-card').forEach(c => c.style.cursor = 'default');
    document.querySelectorAll('.crypto-card').forEach(c => c.onclick = null);

    const reward = rewards[idx];
    el.textContent = reward;
    el.style.background = 'linear-gradient(135deg,#2ecc71,#27ae60)';

    let pts = 0;
    if (reward === '2x') {
        pts = 20; // 10 * 2 = 20 (but we skip base pts, so 20)
    } else if (reward === '3x') {
        pts = 30;
    } else if (reward === '+50') {
        pts = 50;
    } else if (reward === '+20') {
        pts = 20;
    } else if (reward === '+10') {
        pts = 10;
    } else if (reward === 'nothing') {
        pts = 0;
    } else if (reward === 'hack') {
        showHackModal();
        return;
    }

    if (pts > 0) {
        const { data: c } = await sb.from('players').select('score').eq('id', playerId).single();
        if (c) await sb.from('players').update({ score: c.score + pts }).eq('id', playerId);
    }

    document.getElementById('crypto-card-result').textContent = reward === 'nothing' ? '😅 Helaas, niets!' : (reward === 'hack' ? '🎭 Hack!' : `🎉 +${pts} punten!`);
    document.getElementById('crypto-card-result').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('play-crypto-cards').classList.add('hidden');
        document.getElementById('play-question').classList.remove('hidden');
        showPlayerQuestion(currentQuestionIndex);
        updatePlayerScore();
    }, 2000);
}

async function showHackModal() {
    const players = await sb.from('players').select('*').eq('game_id', gameId);
    if (!players.data || players.data.length < 2) {
        document.getElementById('crypto-card-result').textContent = 'Niemand om te hacken!';
        document.getElementById('crypto-card-result').classList.remove('hidden');
        setTimeout(() => {
            document.getElementById('play-crypto-cards').classList.add('hidden');
            document.getElementById('play-question').classList.remove('hidden');
            showPlayerQuestion(currentQuestionIndex);
        }, 1500);
        return;
    }

    // Pick random target who has a password set
    const targets = players.data.filter(p => p.id !== playerId && p.state?.crypto_password);
    if (targets.length === 0) {
        document.getElementById('crypto-card-result').textContent = 'Niemand om te hacken!';
        document.getElementById('crypto-card-result').classList.remove('hidden');
        setTimeout(() => {
            document.getElementById('play-crypto-cards').classList.add('hidden');
            document.getElementById('play-question').classList.remove('hidden');
            showPlayerQuestion(currentQuestionIndex);
        }, 1500);
        return;
    }

    const target = targets[Math.floor(Math.random() * targets.length)];
    document.getElementById('hack-target-name').textContent = target.name;

    // Generate 3 options: real password + 2 fakes
    const fakeWords = ['goudvis', 'sterren', 'raket', 'geheim', 'codex', 'kluis', 'nacht', 'donder', 'vallei', 'tempel', 'akker', 'burcht', 'zweep', 'kroon', 'fakkel'];
    const fakes = [];
    while (fakes.length < 2) {
        const w = fakeWords[Math.floor(Math.random() * fakeWords.length)];
        if (w !== target.state.crypto_password && !fakes.includes(w)) fakes.push(w);
    }
    const options = [target.state.crypto_password, ...fakes].sort(() => Math.random() - 0.5);

    document.getElementById('hack-password-options').innerHTML = options.map((opt, i) =>
        `<button class="btn secondary" onclick="guessHackPassword(${i}, '${target.state.crypto_password.replace(/'/g, "\\'")}', '${target.id}')" style="display:block;width:100%;">${opt}</button>`
    ).join('');

    document.getElementById('hack-result').classList.add('hidden');
    document.getElementById('crypto-hack-modal').classList.remove('hidden');
    window._hackTarget = target;
}

async function guessHackPassword(idx, realPassword, targetId) {
    const chosen = document.querySelectorAll('#hack-password-options .btn')[idx];
    const guessed = chosen.textContent;
    const correct = guessed === realPassword;

    document.querySelectorAll('#hack-password-options .btn').forEach(b => b.disabled = true);

    if (correct) {
        const stealAmount = 15;
        document.getElementById('hack-result').textContent = '✅ Geraden! +15 punten gestolen!';
        document.getElementById('hack-result').className = 'correct';
        const { data: hackTarget } = await sb.from('players').select('score').eq('id', targetId).single();
        const { data: me } = await sb.from('players').select('score').eq('id', playerId).single();
        if (hackTarget && me) {
            await sb.from('players').update({ score: Math.max(0, hackTarget.score - stealAmount) }).eq('id', targetId);
            await sb.from('players').update({ score: me.score + stealAmount }).eq('id', playerId);
        }
    } else {
        document.getElementById('hack-result').textContent = '❌ Fout geraden! Het was: ' + realPassword;
        document.getElementById('hack-result').className = 'wrong';
    }
    document.getElementById('hack-result').classList.remove('hidden');

    setTimeout(() => {
        document.getElementById('crypto-hack-modal').classList.add('hidden');
        document.getElementById('play-crypto-cards').classList.add('hidden');
        document.getElementById('play-question').classList.remove('hidden');
        updatePlayerScore();
        showPlayerQuestion(currentQuestionIndex);
    }, 3000);
}

// ==================== GLOBAL TIMER (Tijdbom) ====================

let globalTimerInterval = null;

function startGlobalTimer(context) {
    clearInterval(globalTimerInterval);
    window._globalTimerRunning = true;
    const elId = context === 'host' ? 'host-timer' : 'play-timer';
    const el = document.getElementById(elId);
    if (!el) return;

    const endTime = modeState.timer_end ? new Date(modeState.timer_end).getTime() : Date.now() + (modeState.timer_total || 120) * 1000;

    globalTimerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        if (el) el.textContent = '⏱️ ' + mins + ':' + (secs < 10 ? '0' : '') + secs;

        if (remaining <= 0) {
            clearInterval(globalTimerInterval);
            clearInterval(timerInterval);
            window._globalTimerRunning = false;
            if (el) el.textContent = '⏱️ 0:00';
            if (context === 'host') endGame();
        }
    }, 200);
}

// ==================== MODE THEMES ====================

function applyModeTheme(mode) {
    const themes = {
        crypto:  { primary: '#00ff41', bg_start: '#0a0a0a', bg_end: '#003300' },
        tijdbom: { primary: '#ff6b35', bg_start: '#1a0000', bg_end: '#4a0000' },
        snelle:  { primary: '#ffd700', bg_start: '#1a1a00', bg_end: '#3a3000' },
        eliminatie: { primary: '#8e44ad', bg_start: '#0a000a', bg_end: '#2a002a' },
        rush:    { primary: '#00d4ff', bg_start: '#000a1a', bg_end: '#002a4a' },
    };
    const t = themes[mode];
    if (t) {
        document.body.setAttribute('data-mode', mode);
        document.documentElement.style.setProperty('--primary', t.primary);
        document.documentElement.style.setProperty('--bg-start', t.bg_start);
        document.documentElement.style.setProperty('--bg-end', t.bg_end);
        document.body.style.background = `linear-gradient(135deg, ${t.bg_start}, ${t.bg_end})`;
    } else {
        document.body.removeAttribute('data-mode');
        applySkin();
    }
}

// ==================== MODE HELPERS ====================

function startTimer(context) {
    clearInterval(timerInterval);
    const secs = modeState.timer_seconds || 20;
    let remaining = secs;
    const elId = context === 'host' ? 'host-timer' : 'play-timer';
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = '⏱️ ' + remaining + 's';
    timerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(timerInterval);
            el.textContent = '⏱️ 0s';
            if (context === 'player' && !playerAnswered) {
                playerAnswered = true;
                document.querySelectorAll('#play-options .option-btn').forEach(b => b.disabled = true);
                document.getElementById('play-feedback').textContent = 'Tijd op! ⏰';
                document.getElementById('play-feedback').className = 'wrong';
                document.getElementById('play-feedback').classList.remove('hidden');
            }
        } else {
            el.textContent = '⏱️ ' + remaining + 's';
        }
    }, 1000);
}

function renderRushHostNav() {
    const nav = document.getElementById('rush-host-nav');
    if (!nav) return;
    nav.innerHTML = questions.map((q, i) => {
        const isCurrent = i === currentQuestionIndex;
        return `<button class="btn ${isCurrent ? 'primary' : 'secondary'} small" onclick="rushHostGoTo(${i})">${i + 1}</button>`;
    }).join('');
    nav.classList.remove('hidden');
}

async function renderRushPlayerNav() {
    const nav = document.getElementById('rush-question-nav');
    if (!nav) return;
    const { data: answers } = await sb.from('answers').select('question_index,correct').eq('game_id', gameId).eq('player_id', playerId);
    const answered = answers ? new Map(answers.map(a => [a.question_index, a.correct])) : new Map();
    nav.innerHTML = questions.map((q, i) => {
        const status = answered.has(i) ? (answered.get(i) ? '✅' : '❌') : '⬜';
        return `<button class="btn secondary small" onclick="rushPlayerGoTo(${i})">${status} ${i + 1}</button>`;
    }).join('');
    nav.classList.remove('hidden');
}

function rushHostGoTo(index) {
    if (index >= questions.length) return;
    currentQuestionIndex = index;
    showHostQuestion(index);
}

function rushPlayerGoTo(index) {
    if (index >= questions.length) return;
    currentQuestionIndex = index;
    showPlayerQuestion(index);
}

async function endGame() {
    clearInterval(timerInterval);
    clearInterval(globalTimerInterval);
    window._globalTimerRunning = false;
    await sb.from('games').update({ status:'finished' }).eq('id', gameId);
}

async function buildRushStandings() {
    const { data: players } = await sb.from('players').select('*').eq('game_id', gameId);
    const { data: answers } = await sb.from('answers').select('*').eq('game_id', gameId).order('created_at', { ascending: true });
    if (!players) return [];

    const totalQ = questions.length;
    const playerStats = players.map(p => {
        const pAnswers = (answers || []).filter(a => a.player_id === p.id);
        const correct = pAnswers.filter(a => a.correct).length;
        const lastTime = pAnswers.length > 0 ? Math.max(...pAnswers.map(a => new Date(a.created_at).getTime())) : Infinity;
        return { ...p, correct, lastTime, answered: pAnswers.length };
    });

    playerStats.sort((a, b) => {
        if (a.correct !== b.correct) return b.correct - a.correct;
        return (a.lastTime || Infinity) - (b.lastTime || Infinity);
    });
    return { playerStats, totalQ };
}

async function showFinalStandings() {
    if (gameMode === 'rush') {
        const { playerStats, totalQ } = await buildRushStandings();
        document.getElementById('final-standings').innerHTML = playerStats.map((x,i) => {
            return '<div class="standing-row"><span class="rank">#'+(i+1)+'</span><span class="name">'+x.name+'</span><span class="score">'+x.correct+'/'+totalQ+' ✅</span></div>';
        }).join('');
        return;
    }
    const { data: p } = await sb.from('players').select('*').eq('game_id',gameId).order('score',{ascending:false});
    if (!p) return;
    const ptsLabel = gameMode === 'tijdbom' ? '✅' : 'pts';
    document.getElementById('final-standings').innerHTML = p.map((x,i) =>
        '<div class="standing-row"><span class="rank">#'+(i+1)+'</span><span class="name">'+x.name+'</span><span class="score">'+x.score+' '+ptsLabel+'</span></div>'
    ).join('');
}

async function showPlayerStandings() {
    if (gameMode === 'rush') {
        const { playerStats, totalQ } = await buildRushStandings();
        const me = playerStats.find(x => x.id === playerId);
        document.getElementById('play-final-score').textContent = me ? 'Jouw score: ' + me.correct + '/' + totalQ + ' goed' : 'Quiz afgelopen!';
        document.getElementById('play-standings').innerHTML = playerStats.map((x,i) => {
            return '<div class="standing-row"><span class="rank">#'+(i+1)+'</span><span class="name">'+x.name+'</span><span class="score">'+x.correct+'/'+totalQ+' ✅</span></div>';
        }).join('');
        return;
    }
    const { data: p } = await sb.from('players').select('*').eq('game_id',gameId).order('score',{ascending:false});
    if (!p) return;
    const me = p.find(x => x.id === playerId);
    document.getElementById('play-final-score').textContent = me ? 'Jouw score: '+me.score+' punten' : 'Quiz afgelopen!';
    document.getElementById('play-standings').innerHTML = p.map((x,i) =>
        '<div class="standing-row"><span class="rank">#'+(i+1)+'</span><span class="name">'+x.name+'</span><span class="score">'+x.score+' pts</span></div>'
    ).join('');
}

async function cancelGame() {
    if (gameId && sb) await sb.from('games').delete().eq('id', gameId);
    resetQuiz();
}

function resetQuiz() {
    if (supabaseChannel) supabaseChannel.unsubscribe();
    clearInterval(timerInterval);
    clearInterval(globalTimerInterval);
    window._globalTimerRunning = false;
    gameId=null; playerId=null; gameCode=null; currentQuestionIndex=0; playerAnswered=false; questions=[]; editingQuestionId=null;
    gameMode='standard'; modeState={};
    applyModeTheme('standard');
    document.getElementById('modeSelect').value = 'standard';
    document.getElementById('host-setup').classList.remove('hidden');
    document.getElementById('host-lobby').classList.add('hidden');
    document.getElementById('host-game').classList.add('hidden');
    document.getElementById('host-result').classList.add('hidden');
    document.getElementById('earnings-msg').classList.add('hidden');
    document.getElementById('rush-host-nav').classList.add('hidden');
    document.getElementById('rush-question-nav').classList.add('hidden');
    document.getElementById('play-crypto-setup').classList.add('hidden');
    document.getElementById('play-crypto-cards').classList.add('hidden');
    document.getElementById('crypto-hack-modal').classList.add('hidden');
    showView('home');
}

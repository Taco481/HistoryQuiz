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

function goHome() {
    if (currentUser) document.getElementById('user-bar').classList.remove('hidden');
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

// ==================== AUTH ====================

async function login() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) { showAuthError('Vul e-mail en wachtwoord in.'); return; }
    try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) { showAuthError(error.message); return; }
        await onAuth(data.user);
    } catch (e) { showAuthError('Fout bij inloggen.'); }
}

async function register() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) { showAuthError('Vul e-mail en wachtwoord in.'); return; }
    if (password.length < 6) { showAuthError('Wachtwoord moet minstens 6 tekens zijn.'); return; }
    try {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) { showAuthError(error.message); return; }
        if (data?.user?.identities?.length === 0) { showAuthError('Dit e-mailadres is al geregistreerd.'); return; }
        showAuthError('Account gemaakt! Check je e-mail om te bevestigen.', false);
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
    showView('home');
    await loadProfile();
    await applySkin();
    await loadSavedQuizzesSelect();
}

async function loadProfile() {
    if (!currentUser) return;
    const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
    if (data) {
        currentUser.profile = data;
        document.getElementById('user-coins').textContent = '🪙 ' + data.coins;
        document.getElementById('shop-coins').textContent = 'Jouw coins: 🪙 ' + data.coins;
    }
}

async function logout() {
    await sb.auth.signOut();
    currentUser = null;
    document.getElementById('user-bar').classList.add('hidden');
    showView('home');
}

// Check existing session on load
(async function() {
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) await onAuth(session.user);
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
        const isEquipped = currentUser.profile?.selected_skin === s.name;
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
    if (currentUser.profile.coins < price) { alert('Niet genoeg coins!'); return; }
    const { error } = await sb.from('user_skins').insert({ user_id: currentUser.id, skin_id: skinId });
    if (error) { logError('Kopen mislukt', error); alert('Fout bij kopen.'); return; }
    await sb.from('profiles').update({ coins: currentUser.profile.coins - price }).eq('id', currentUser.id);
    currentUser.profile.coins -= price;
    await renderShop();
}

async function equipSkin(skinName) {
    await sb.from('profiles').update({ selected_skin: skinName }).eq('id', currentUser.id);
    currentUser.profile.selected_skin = skinName;
    await applySkin();
    await renderShop();
}

async function applySkin() {
    const skinName = currentUser?.profile?.selected_skin || 'default';
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
    const code = generateCode();

    try {
        const { data: game, error } = await sb.from('games').insert({ code, status: 'waiting', host_id: currentUser?.id }).select().single();
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
    gameId = game.id; gameCode = code;

    const { data: player } = await sb.from('players').insert({ game_id: gameId, name: playerName, score: 0 }).select().single();
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
        if (currentUser.profile) currentUser.profile.coins = prof.coins + coins;
    }
}

async function handlePlayerChange() { await updatePlayerList(); await updateLeaderboard(); await updateAnswerStatus(); }
async function handleAnswerChange() { await updateAnswerStatus(); await updateLeaderboard(); await loadOpenAnswers(); }

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
    board.innerHTML = isActive
        ? p.map((x,i) => '<div class="leaderboard-row"><span class="lb-rank">#'+(i+1)+'</span><span class="lb-name">'+x.name+'</span><span class="lb-score">'+x.score+' pts</span></div>').join('')
        : p.map(x => '<span class="score-chip">'+x.name+': '+x.score+'</span>').join('');
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
    currentQuestionIndex = 0;
    await sb.from('games').update({ status:'active', current_question:0 }).eq('id', gameId);
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

    if (q.type === 'open') {
        ho.classList.add('hidden'); ho.innerHTML = '';
        ha.classList.remove('hidden'); loadOpenAnswers();
    } else {
        ha.classList.add('hidden'); ha.innerHTML = '';
        ho.classList.remove('hidden');
        const lbl = q.type === 'truefalse' ? ['Waar','Niet waar'] : ['A','B','C','D'];
        ho.innerHTML = (q.options||[]).map((o,i) => '<button class="option-btn" disabled>'+lbl[i]+'. '+o+'</button>').join('');
    }
    document.getElementById('btn-next-question').textContent = index < questions.length-1 ? 'Volgende Vraag' : 'Bekijk Resultaten';
}

async function showPlayerQuestion(index) {
    if (index >= questions.length) return;
    const q = questions[index];
    playerAnswered = false;
    document.getElementById('play-question-number').textContent = 'Vraag '+(index+1)+' van '+questions.length;
    document.getElementById('play-question-text').textContent = q.question;
    document.getElementById('play-feedback').classList.add('hidden');
    document.getElementById('play-feedback').textContent = '';

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
    if (playerAnswered || !sb || currentQuestionIndex >= questions.length) return;
    playerAnswered = true;
    const q = questions[currentQuestionIndex];
    const correct = index === parseInt(q.answer);
    const pts = correct ? 10 : 0;
    await sb.from('answers').insert({ game_id:gameId, player_id:playerId, question_index:currentQuestionIndex, answer:String(index), correct });
    if (correct) {
        const { data: c } = await sb.from('players').select('score').eq('id',playerId).single();
        if (c) await sb.from('players').update({ score: c.score + pts }).eq('id',playerId);
    }
    document.querySelectorAll('#play-options .option-btn').forEach((b,i) => {
        b.disabled = true;
        if (i === index) b.classList.add(correct?'correct':'wrong');
        if (i === parseInt(q.answer)) b.classList.add('correct');
    });
    document.getElementById('play-feedback').textContent = correct ? 'Goed! +10 punten' : 'Het antwoord was: '+(q.options?.[parseInt(q.answer)]||q.answer);
    document.getElementById('play-feedback').className = correct ? 'correct' : 'wrong';
    document.getElementById('play-feedback').classList.remove('hidden');
    await updatePlayerScore();
}

async function submitOpenAnswer() {
    if (playerAnswered || !sb) return;
    const inp = document.getElementById('play-open-answer');
    const a = inp.value.trim();
    if (!a) { alert('Typ een antwoord.'); return; }
    playerAnswered = true;
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
    const n = currentQuestionIndex + 1;
    if (n >= questions.length) { await endGame(); return; }
    currentQuestionIndex = n;
    await sb.from('games').update({ current_question: n }).eq('id', gameId);
    showHostQuestion(n);
}

async function endGame() {
    await sb.from('games').update({ status:'finished' }).eq('id', gameId);
}

async function showFinalStandings() {
    const { data: p } = await sb.from('players').select('*').eq('game_id',gameId).order('score',{ascending:false});
    if (!p) return;
    document.getElementById('final-standings').innerHTML = p.map((x,i) =>
        '<div class="standing-row"><span class="rank">#'+(i+1)+'</span><span class="name">'+x.name+'</span><span class="score">'+x.score+' pts</span></div>'
    ).join('');
}

async function showPlayerStandings() {
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
    gameId=null; playerId=null; gameCode=null; currentQuestionIndex=0; playerAnswered=false; questions=[]; editingQuestionId=null;
    document.getElementById('host-setup').classList.remove('hidden');
    document.getElementById('host-lobby').classList.add('hidden');
    document.getElementById('host-game').classList.add('hidden');
    document.getElementById('host-result').classList.add('hidden');
    document.getElementById('earnings-msg').classList.add('hidden');
    showView('home');
}

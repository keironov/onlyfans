/* ========= Helpers ========= */
async function fetchJson(url, opts){ const res = await fetch(url, opts); return res.json(); }
const reportsTable = document.getElementById('reportsTable');
let happnChart = null;
let leadsChart = null;
let combinedChart = null;
let currentWorklogDate = new Date();
let isSelectOpen = false;
let isInputFocused = false;
let pendingInstagramUpdates = {};
let selectedNoteColor = '#f59e0b';

function escapeHtml(text){
  if(!text && text!==0) return '';
  return String(text).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"'"}[m]));
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('ru-RU', options);
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ========= Tab Switching ========= */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    tab.classList.add('active');
    const tabName = tab.dataset.tab;
    document.getElementById('tab-' + tabName).style.display = 'block';
    
    if(tabName === 'stats'){
      loadStatistics();
    } else if(tabName === 'rankings'){
      loadAllRankings();
    } else if(tabName === 'notes'){
      loadPersonalNotes();
    }
  });
});

/* ========= Preserve scroll state ========= */
let lastRefreshTime = Date.now();
const REFRESH_COOLDOWN = 3000;

function preserveStateStart(){
  return {
    scrollY: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0,
    activeElement: document.activeElement
  };
}

function preserveStateEnd(state){
  window.scrollTo({ top: state.scrollY, behavior: 'auto' });
  if(state.activeElement && document.body.contains(state.activeElement)) {
    try { state.activeElement.focus({ preventScroll: true }); } catch(e) {}
  }
}

document.addEventListener('mousedown', (e) => {
  if (e.target.tagName === 'SELECT') {
    isSelectOpen = true;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.tagName === 'SELECT') {
    isSelectOpen = false;
  }
});

document.addEventListener('blur', (e) => {
  if (e.target.tagName === 'SELECT') {
    setTimeout(() => { isSelectOpen = false; }, 100);
  }
}, true);

document.addEventListener('focus', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    isInputFocused = true;
  }
}, true);

document.addEventListener('blur', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    setTimeout(() => { isInputFocused = false; }, 100);
  }
}, true);

/* ========= REPORTS ========= */
async function loadReports(){
  if (isSelectOpen || isInputFocused) return;
  
  const state = preserveStateStart();
  try{
    const res = await fetchJson('/api/reports');
    if(!res.ok){ reportsTable.innerHTML='<tr><td colspan="7">Ошибка загрузки</td></tr>'; preserveStateEnd(state); return; }
    const pendingReports = res.reports.filter(r=>r.status==='pending');

    const existingMap = {};
    reportsTable.querySelectorAll('tr[data-report-id]').forEach(tr=>{
      existingMap[tr.dataset.reportId] = tr;
    });

    pendingReports.forEach(rep=>{
      const id = String(rep.id);
      let tr = existingMap[id];
      if(!tr){
        tr = document.createElement('tr');
        tr.className = 'pending-row';
        tr.dataset.reportId = id;
        tr.innerHTML = `
          <td class="table-username">${escapeHtml(rep.username||'—')}</td>
          <td class="table-instagram">${escapeHtml(rep.instagram_username||'—')}</td>
          <td class="report-text" style="white-space:normal;word-break:break-word">${escapeHtml(rep.text)}</td>
          <td><input type="number" class="happn-input" value="0" style="width:70px" min="0" /></td>
          <td><input type="number" class="leads-input" value="0" style="width:70px" min="0" /></td>
          <td><input type="date" class="date-input" value="${rep.report_date||formatDate(new Date())}" style="width:140px" /></td>
          <td>
            <button class="action-btn approve">✔</button>
            <button class="action-btn reject" style="margin-left:8px">✖</button>
          </td>
        `;
        reportsTable.appendChild(tr);

        const happnInput = tr.querySelector('.happn-input');
        const leadsInput = tr.querySelector('.leads-input');
        const dateInput = tr.querySelector('.date-input');
        
        tr.querySelector('.approve').addEventListener('click', async ()=>{
          const happn = parseInt(happnInput.value)||0;
          const leads = parseInt(leadsInput.value)||0;
          const date = dateInput.value;
          try {
            await fetch(`/api/reports/${id}/approve`,{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ happn_accounts: happn, leads_converted: leads, report_date: date })
            });
            tr.remove();
            await loadGlobalStats();
          } catch(e){ console.error(e); }
        });
        
        tr.querySelector('.reject').addEventListener('click', async ()=>{
          try {
            await fetch(`/api/reports/${id}/reject`,{ method:'POST' });
            tr.remove();
          } catch(e){ console.error(e); }
        });
      }
      delete existingMap[id];
    });

    Object.keys(existingMap).forEach(oldId=>{
      const tr = existingMap[oldId];
      if(tr) tr.remove();
    });

  }catch(e){ console.error('loadReports err', e); }
  preserveStateEnd(state);
}

/* ========= GLOBAL STATS ========= */
async function loadGlobalStats(){
  try{
    const res = await fetchJson('/api/stats/global');
    if(!res.ok) return;
    
    document.getElementById('totalHappn').textContent = res.data.happn || 0;
    document.getElementById('totalLeads').textContent = res.data.leads || 0;
    document.getElementById('totalUsers').textContent = res.data.users || 0;
    
    const approvalRes = await fetchJson('/api/stats/approvals');
    if(approvalRes.ok){
      const approved = approvalRes.stats.total_approved || 0;
      const rejected = approvalRes.stats.total_rejected || 0;
      const total = approved + rejected;
      const rate = total > 0 ? Math.round((approved / total) * 100) : 0;
      document.getElementById('approvalRate').textContent = rate + '%';
    }
  }catch(e){ console.error('loadGlobalStats err', e); }
}

/* ========= FEEDBACK ========= */
document.getElementById('sendFeedbackBtn').addEventListener('click', async () => {
  const userId = document.getElementById('feedbackUserSelect').value;
  const text = document.getElementById('feedbackText').value.trim();
  const status = document.getElementById('feedbackStatus');

  if (!userId) { status.textContent = "Выбери пользователя!"; return; }
  if (!text) { status.textContent = "Напиши текст фидбэка!"; return; }
  status.textContent = "Отправка…";

  try {
    const res = await fetch('/api/feedback/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: userId, text })
    });
    const data = await res.json();
    if (data.ok) {
      status.textContent = "✅ Фидбек отправлен!";
      document.getElementById('feedbackText').value = "";
    } else {
      status.textContent = "❌ Ошибка: " + data.error;
    }
  } catch (e) {
    console.error(e);
    status.textContent = "❌ Ошибка соединения";
  }
});

/* ========= TEAM MANAGEMENT ========= */
async function loadTeam(){
  if (isSelectOpen || isInputFocused) return;
  
  try{
    const res = await fetchJson('/api/users');
    if(!res.ok){ document.getElementById('teamList').innerText='Ошибка'; return; }
    
    const teamList = document.getElementById('teamList');
    const currentHtml = teamList.innerHTML;
    
    let newHtml = '';
    
    res.users.forEach(u=>{
      const uname = u.username || ('id:'+u.id);
      const instagramValue = pendingInstagramUpdates[u.id] !== undefined ? pendingInstagramUpdates[u.id] : (u.instagram_username || '');
      
      newHtml += `
        <div class="user-row" data-user-id="${u.id}">
          <div style="flex:1;">
            <div style="font-weight:600;color:var(--accent);">${escapeHtml(uname)}</div>
            <div class="small">Instagram: ${escapeHtml(u.instagram_username||'—')}</div>
          </div>
          <input type="text" class="instagram-input" placeholder="@instagram" value="${escapeHtml(instagramValue)}" style="width:140px;" data-user-id="${u.id}" />
          <select class="table-select role-select" data-user-id="${u.id}">
            <option value="">Выбрать роль</option>
            <option value="Трафер" ${u.role==='Трафер'?'selected':''}>Трафер</option>
            <option value="Новичок Трафер" ${u.role==='Новичок Трафер'?'selected':''}>Новичок Трафер</option>
            <option value="Тим Лид" ${u.role==='Тим Лид'?'selected':''}>Тим Лид</option>
            <option value="⭐️ Раф" ${u.role==='⭐️ Раф'?'selected':''}>⭐️ Раф</option>
          </select>
          <button class="action-btn reject delete-user" data-user-id="${u.id}" title="Удалить">✖</button>
        </div>
      `;
    });
    
    if(currentHtml !== newHtml){
      teamList.innerHTML = newHtml;
      
      // Instagram update handlers
      teamList.querySelectorAll('.instagram-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const userId = e.target.dataset.userId;
          pendingInstagramUpdates[userId] = e.target.value;
        });
        
        input.addEventListener('blur', async (e) => {
          const userId = e.target.dataset.userId;
          const instagram = e.target.value.trim();
          try {
            await fetch(`/api/users/${userId}/instagram`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ instagram })
            });
            delete pendingInstagramUpdates[userId];
          } catch (err) {
            console.error('Instagram update error', err);
          }
        });
      });

      // Role change handlers
      teamList.querySelectorAll('.role-select').forEach(sel => {
        sel.addEventListener('change', async (e) => {
          const userId = e.target.dataset.userId;
          const role = e.target.value;
          try {
            await fetch(`/api/users/${userId}/role`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role })
            });
          } catch (err) {
            console.error('Role update error', err);
          }
        });
      });

      // Delete handlers
      teamList.querySelectorAll('.delete-user').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const userId = e.target.dataset.userId;
          if (!confirm('Удалить этого пользователя?')) return;
          try {
            await fetch(`/api/users/${userId}`, { method: 'DELETE' });
            delete pendingInstagramUpdates[userId];
            await loadTeam();
          } catch (err) {
            console.error('Delete error', err);
          }
        });
      });
    }

    // Fill selects
    fillFeedbackUsers(res.users);
    fillWorklogUsers(res.users);
    fillNotesUsers(res.users);
    fillUserStatsSelect(res.users);
    
  }catch(e){ console.error(e); document.getElementById('teamList').innerText='Ошибка'; }
}

document.getElementById('addUserBtn').addEventListener('click', async () => {
  const username = document.getElementById('newUsername').value.trim();
  const status = document.getElementById('addUserStatus');
  
  if (!username) {
    status.textContent = 'Введи username!';
    return;
  }
  
  status.textContent = 'Добавление...';
  
  try {
    const res = await fetch('/api/users/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    
    if (data.ok) {
      status.textContent = '✅ Пользователь добавлен!';
      document.getElementById('newUsername').value = '';
      await loadTeam();
    } else {
      status.textContent = '❌ Ошибка: ' + data.error;
    }
  } catch (e) {
    console.error(e);
    status.textContent = '❌ Ошибка соединения';
  }
});

function fillFeedbackUsers(users){
  const sel = document.getElementById('feedbackUserSelect');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Выбери пользователя…</option>';
  users.forEach(u=>{
    const option = document.createElement('option');
    option.value = u.telegram_id || '';
    option.textContent = u.username || ('id:'+u.id);
    sel.appendChild(option);
  });
  if(cur) sel.value = cur;
}

function fillWorklogUsers(users){
  const sel = document.getElementById('worklogUser');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Выбери пользователя…</option>';
  users.forEach(u=>{
    const option = document.createElement('option');
    option.value = u.id;
    option.textContent = u.username || ('id:'+u.id);
    sel.appendChild(option);
  });
  if(cur) sel.value = cur;
}

function fillNotesUsers(users){
  const sel = document.getElementById('notesUserSelect');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Выбери пользователя…</option>';
  users.forEach(u=>{
    const option = document.createElement('option');
    option.value = u.id;
    option.textContent = u.username || ('id:'+u.id);
    sel.appendChild(option);
  });
  if(cur) sel.value = cur;
}

function fillUserStatsSelect(users){
  const sel = document.getElementById('userStatsSelect');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Все пользователи</option>';
  users.forEach(u=>{
    const option = document.createElement('option');
    option.value = u.id;
    option.textContent = u.username || ('id:'+u.id);
    sel.appendChild(option);
  });
  if(cur) sel.value = cur;
}

/* ========= MANAGER NOTES ========= */
document.getElementById('notesUserSelect').addEventListener('change', async (e) => {
  const userId = e.target.value;
  if(!userId){
    document.getElementById('notesList').innerHTML = 'Выбери пользователя';
    return;
  }
  await loadNotes(userId);
});

document.getElementById('addNoteBtn2').addEventListener('click', async () => {
  const userId = document.getElementById('notesUserSelect').value;
  const note = document.getElementById('newNote').value.trim();
  
  if(!userId || !note){
    alert('Выбери пользователя и введи заметку!');
    return;
  }
  
  try{
    const res = await fetch('/api/notes/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, note })
    });
    const data = await res.json();
    if(data.ok){
      document.getElementById('newNote').value = '';
      await loadNotes(userId);
    }
  }catch(e){
    console.error('Add note error', e);
  }
});

async function loadNotes(userId){
  try{
    const res = await fetchJson(`/api/notes/${userId}`);
    if(!res.ok) return;
    
    const list = document.getElementById('notesList');
    if(res.notes.length === 0){
      list.innerHTML = '<div class="small muted">Нет заметок</div>';
      return;
    }
    
    list.innerHTML = '';
    res.notes.forEach(note => {
      const div = document.createElement('div');
      div.className = 'note-item';
      div.innerHTML = `
        <div style="flex:1;">${escapeHtml(note.note)}</div>
        <button class="action-btn reject" data-note-id="${note.id}">✖</button>
      `;
      list.appendChild(div);
      
      div.querySelector('.reject').addEventListener('click', async () => {
        try{
          await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
          await loadNotes(userId);
        }catch(e){
          console.error('Delete note error', e);
        }
      });
    });
  }catch(e){
    console.error('Load notes error', e);
  }
}

/* ========= PERSONAL NOTES ========= */
// Color picker
document.querySelectorAll('.color-option').forEach(opt => {
  opt.addEventListener('click', (e) => {
    document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
    e.target.classList.add('selected');
    selectedNoteColor = e.target.dataset.color;
  });
});

document.getElementById('addNoteBtn').addEventListener('click', async () => {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  
  if(!title || !content){
    alert('Заполни заголовок и текст заметки!');
    return;
  }
  
  try{
    const res = await fetch('/api/personal-notes/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, color: selectedNoteColor })
    });
    const data = await res.json();
    if(data.ok){
      document.getElementById('noteTitle').value = '';
      document.getElementById('noteContent').value = '';
      await loadPersonalNotes();
    }
  }catch(e){
    console.error('Add personal note error', e);
  }
});

async function loadPersonalNotes(){
  try{
    const res = await fetchJson('/api/personal-notes');
    if(!res.ok) return;
    
    const board = document.getElementById('notesBoard');
    
    if(res.notes.length === 0){
      board.innerHTML = '<div class="small muted" style="grid-column:1/-1;text-align:center;padding:40px;">Нет заметок. Создай свою первую заметку!</div>';
      return;
    }
    
    board.innerHTML = '';
    res.notes.forEach(note => {
      const div = document.createElement('div');
      div.className = 'sticky-note' + (note.completed ? ' completed' : '');
      div.style.setProperty('--note-color', note.color);
      
      div.innerHTML = `
        <div class="sticky-note-header">
          <div class="sticky-note-title">${escapeHtml(note.title)}</div>
          <div class="sticky-note-actions">
            <button class="sticky-note-btn toggle-note" data-note-id="${note.id}" title="${note.completed ? 'Восстановить' : 'Выполнено'}">
              ${note.completed ? '↩️' : '✓'}
            </button>
            <button class="sticky-note-btn delete-note" data-note-id="${note.id}" title="Удалить">✖</button>
          </div>
        </div>
        <div class="sticky-note-content">${escapeHtml(note.content)}</div>
        <div class="sticky-note-date">${formatTimestamp(note.created_at)}</div>
      `;
      
      board.appendChild(div);
      
      div.querySelector('.toggle-note').addEventListener('click', async (e) => {
        e.stopPropagation();
        try{
          await fetch(`/api/personal-notes/${note.id}/toggle`, { method: 'POST' });
          await loadPersonalNotes();
        }catch(err){
          console.error('Toggle note error', err);
        }
      });
      
      div.querySelector('.delete-note').addEventListener('click', async (e) => {
        e.stopPropagation();
        if(!confirm('Удалить эту заметку?')) return;
        try{
          await fetch(`/api/personal-notes/${note.id}`, { method: 'DELETE' });
          await loadPersonalNotes();
        }catch(err){
          console.error('Delete note error', err);
        }
      });
    });
  }catch(e){
    console.error('Load personal notes error', e);
  }
}

/* ========= STATISTICS ========= */
async function loadStatistics(){
  await loadStatsCharts('yesterday');
  await loadUserDetailedStats();
}

// Period buttons for stats chart
document.querySelectorAll('.period-buttons .period-btn').forEach(btn => {
  if(!btn.dataset.userPeriod && !btn.dataset.rankingPeriod){
    btn.addEventListener('click', async (e) => {
      document.querySelectorAll('.period-buttons .period-btn').forEach(b => {
        if(!b.dataset.userPeriod && !b.dataset.rankingPeriod) b.classList.remove('active');
      });
      e.target.classList.add('active');
      
      const period = e.target.dataset.period;
      if(period === 'custom'){
        document.getElementById('customDateRange').style.display = 'flex';
      } else {
        document.getElementById('customDateRange').style.display = 'none';
        await loadStatsCharts(period);
      }
    });
  }
});

document.getElementById('applyDateRange').addEventListener('click', async () => {
  const startDate = document.getElementById('statsStartDate').value;
  const endDate = document.getElementById('statsEndDate').value;
  
  if(!startDate || !endDate){
    alert('Выбери обе даты!');
    return;
  }
  
  await loadStatsCharts('custom', startDate, endDate);
});

async function loadStatsCharts(period, startDate = null, endDate = null){
  try{
    let start, end;
    const today = new Date();
    
    if(period === 'custom' && startDate && endDate){
      start = startDate;
      end = endDate;
    } else if(period === 'today'){
      start = end = formatDate(today);
    } else if(period === 'yesterday'){
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      start = end = formatDate(yesterday);
    } else if(period === 'week'){
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      start = formatDate(weekAgo);
      end = formatDate(today);
    } else if(period === 'month'){
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      start = formatDate(monthAgo);
      end = formatDate(today);
    }
    
    const [happnRes, leadsRes] = await Promise.all([
      fetchJson(`/api/stats/growth/happn?startDate=${start}&endDate=${end}`),
      fetchJson(`/api/stats/growth/leads?startDate=${start}&endDate=${end}`)
    ]);
    
    if(!happnRes.ok || !leadsRes.ok) return;
    
    const allDates = new Set();
    happnRes.growth.forEach(g => allDates.add(g.date));
    leadsRes.growth.forEach(g => allDates.add(g.date));
    
    const labels = Array.from(allDates).sort();
    
    const happnData = labels.map(date => {
      const found = happnRes.growth.find(g => g.date === date);
      return found ? found.total : 0;
    });
    
    const leadsData = labels.map(date => {
      const found = leadsRes.growth.find(g => g.date === date);
      return found ? found.total : 0;
    });
    
    // Happn Chart
    const happnCtx = document.getElementById('happnChart').getContext('2d');
    if(happnChart){
      happnChart.data.labels = labels;
      happnChart.data.datasets[0].data = happnData;
      happnChart.update();
    } else {
      happnChart = new Chart(happnCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Happn аккаунты',
            data: happnData,
            backgroundColor: 'rgba(245,158,11,0.8)',
            borderColor: '#f59e0b',
            borderWidth: 2,
            borderRadius: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {color: '#8b92a8', font: {size: 12}}
            }
          },
          scales: {
            x: {
              ticks: {color: '#8b92a8'},
              grid: {color: 'rgba(255,255,255,0.05)'}
            },
            y: {
              ticks: {
                color: '#8b92a8',
                stepSize: 1
              },
              grid: {color: 'rgba(255,255,255,0.05)'}
            }
          }
        }
      });
    }
    
    // Leads Chart
    const leadsCtx = document.getElementById('leadsChart').getContext('2d');
    if(leadsChart){
      leadsChart.data.labels = labels;
      leadsChart.data.datasets[0].data = leadsData;
      leadsChart.update();
    } else {
      leadsChart = new Chart(leadsCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Лиды',
            data: leadsData,
            backgroundColor: 'rgba(16,185,129,0.8)',
            borderColor: '#10b981',
            borderWidth: 2,
            borderRadius: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {color: '#8b92a8', font: {size: 12}}
            }
          },
          scales: {
            x: {
              ticks: {color: '#8b92a8'},
              grid: {color: 'rgba(255,255,255,0.05)'}
            },
            y: {
              ticks: {
                color: '#8b92a8',
                stepSize: 1
              },
              grid: {color: 'rgba(255,255,255,0.05)'}
            }
          }
        }
      });
    }
    
    // Combined Chart
    const combinedCtx = document.getElementById('combinedChart').getContext('2d');
    if(combinedChart){
      combinedChart.data.labels = labels;
      combinedChart.data.datasets[0].data = happnData;
      combinedChart.data.datasets[1].data = leadsData;
      combinedChart.update();
    } else {
      combinedChart = new Chart(combinedCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Happn аккаунты',
              data: happnData,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.1)',
              borderWidth: 3,
              fill: true,
              tension: 0.4,
              pointRadius: 5,
              pointHoverRadius: 7,
              pointBackgroundColor: '#f59e0b',
              pointBorderColor: '#fff',
              pointBorderWidth: 2
            },
            {
              label: 'Лиды',
              data: leadsData,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16,185,129,0.1)',
              borderWidth: 3,
              fill: true,
              tension: 0.4,
              pointRadius: 5,
              pointHoverRadius: 7,
              pointBackgroundColor: '#10b981',
              pointBorderColor: '#fff',
              pointBorderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {color: '#8b92a8', font: {size: 12}}
            }
          },
          scales: {
            x: {
              ticks: {color: '#8b92a8'},
              grid: {color: 'rgba(255,255,255,0.05)'}
            },
            y: {
              ticks: {
                color: '#8b92a8',
                stepSize: 1
              },
              grid: {color: 'rgba(255,255,255,0.05)'}
            }
          }
        }
      });
    }
  }catch(e){ console.error('loadStatsCharts err', e); }
}

// User stats filtering
document.querySelectorAll('[data-user-period]').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    document.querySelectorAll('[data-user-period]').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    
    const period = e.target.dataset.userPeriod;
    if(period === 'custom'){
      document.getElementById('userCustomDateRange').style.display = 'flex';
    } else {
      document.getElementById('userCustomDateRange').style.display = 'none';
      await loadUserDetailedStats(period);
    }
  });
});

document.getElementById('userStatsSelect').addEventListener('change', async () => {
  const activePeriod = document.querySelector('[data-user-period].active');
  const period = activePeriod ? activePeriod.dataset.userPeriod : 'all';
  await loadUserDetailedStats(period);
});

document.getElementById('applyUserDateRange').addEventListener('click', async () => {
  const startDate = document.getElementById('userStatsStartDate').value;
  const endDate = document.getElementById('userStatsEndDate').value;
  
  if(!startDate || !endDate){
    alert('Выбери обе даты!');
    return;
  }
  
  await loadUserDetailedStats('custom', startDate, endDate);
});

async function loadUserDetailedStats(period = 'all', startDate = null, endDate = null){
  try{
    const userId = document.getElementById('userStatsSelect').value;
    
    let start, end;
    const today = new Date();
    
    if(period === 'custom' && startDate && endDate){
      start = startDate;
      end = endDate;
    } else if(period === 'week'){
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      start = formatDate(weekAgo);
      end = formatDate(today);
    } else if(period === 'month'){
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      start = formatDate(monthAgo);
      end = formatDate(today);
    }
    
    let url = '/api/stats/detailed';
    if(start && end){
      url = `/api/stats/by-date?startDate=${start}&endDate=${end}`;
    }
    
    const res = await fetchJson(url);
    if(!res.ok) return;
    
    let stats = res.stats;
    
    // Filter by user if selected
    if(userId){
      stats = stats.filter(s => s.id === parseInt(userId));
    }
    
    const container = document.getElementById('userDetailedStats');
    
    if(stats.length === 0){
      container.innerHTML = '<div class="small muted">Нет данных</div>';
      return;
    }
    
    // Sort by total
    stats.sort((a, b) => {
      const totalA = (a.happn_total || 0) + (a.leads_total || 0);
      const totalB = (b.happn_total || 0) + (b.leads_total || 0);
      return totalB - totalA;
    });
    
    let html = '';
    stats.forEach((user, index) => {
      const happn = user.happn_total || 0;
      const leads = user.leads_total || 0;
      const total = happn + leads;
      
      const isTopPerformer = index < 3 && total > 20;
      const topBadge = isTopPerformer ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:12px;font-size:12px;font-weight:600;background:linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);color:#0a0e1a;margin-left:8px;">🏆 Топ-${index + 1}</span>` : '';
      
      // Role-based requirements
      let requirementText = '';
      if(user.role === 'Трафер'){
        const status = leads >= 10 ? '✅' : '⚠️';
        requirementText = `${status} Норма: 10 лидов (текущее: ${leads})`;
      } else if(user.role === 'Новичок Трафер'){
        const dailyAvg = period === 'week' ? (happn / 7).toFixed(1) : (happn / 30).toFixed(1);
        const status = dailyAvg >= 5 ? '✅' : '⚠️';
        requirementText = `${status} Норма: 5 аккаунтов/день (средн: ${dailyAvg})`;
      } else if(user.role === 'Тим Лид' || user.role === '⭐️ Раф'){
        requirementText = '✨ Нет обязательств';
      }
      
      html += `
        <div style="padding:20px;background:rgba(255,255,255,0.03);border-radius:16px;border:1px solid var(--glass-border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <div style="font-weight:600;font-size:18px;color:var(--accent);margin-bottom:4px;">
                ${escapeHtml(user.username || 'Unknown')}${topBadge}
              </div>
              <div class="small">Роль: ${user.role || 'Не назначена'} · Instagram: ${escapeHtml(user.instagram_username || '—')}</div>
              ${requirementText ? `<div class="small" style="margin-top:4px;">${requirementText}</div>` : ''}
            </div>
            <div style="text-align:right;">
              <div style="font-size:24px;font-weight:700;color:var(--accent);">${total}</div>
              <div class="small">всего</div>
            </div>
          </div>
          
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
            <div class="stat-card">
              <div style="font-size:20px;font-weight:700;color:#f59e0b;">${happn}</div>
              <div class="stat-label">Happn аккаунты</div>
            </div>
            <div class="stat-card">
              <div style="font-size:20px;font-weight:700;color:#10b981;">${leads}</div>
              <div class="stat-label">Лиды</div>
            </div>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }catch(e){ console.error('loadUserDetailedStats err', e); }
}

/* ========= RANKINGS ========= */
async function loadAllRankings(){
  await loadRanking('today', 'rankingToday');
  await loadRanking('week', 'rankingWeek');
  await loadRanking('month', 'rankingMonth');
  await loadRankingTable('today');
}

async function loadRanking(period, containerId){
  try{
    const res = await fetchJson(`/api/stats/top-performers/${period}`);
    if(!res.ok) return;
    
    const container = document.getElementById(containerId);
    
    if(res.performers.length === 0){
      container.innerHTML = '<div class="small muted">Нет данных</div>';
      return;
    }
    
    let html = '';
    res.performers.forEach((user, index) => {
      const position = index + 1;
      let positionClass = '';
      if(position === 1) positionClass = 'gold';
      else if(position === 2) positionClass = 'silver';
      else if(position === 3) positionClass = 'bronze';
      
      const happn = user.happn_total || 0;
      const leads = user.leads_total || 0;
      const total = user.total_score || 0;
      
      html += `
        <div class="ranking-item">
          <div class="ranking-position ${positionClass}">#${position}</div>
          <div class="ranking-info">
            <div class="ranking-name">${escapeHtml(user.username || 'Unknown')}</div>
            <div class="ranking-role">${user.role || 'Не назначена'}</div>
          </div>
          <div class="ranking-score">
            <div class="ranking-total">${total}</div>
            <div class="ranking-details">${happn}H + ${leads}L</div>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }catch(e){
    console.error('loadRanking err', e);
  }
}

// Ranking table period buttons
document.querySelectorAll('[data-ranking-period]').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    document.querySelectorAll('[data-ranking-period]').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    
    const period = e.target.dataset.rankingPeriod;
    await loadRankingTable(period);
  });
});

async function loadRankingTable(period){
  try{
    const res = await fetchJson(`/api/stats/top-performers/${period}?limit=100`);
    if(!res.ok) return;
    
    const tbody = document.getElementById('rankingTableBody');
    
    if(res.performers.length === 0){
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Нет данных</td></tr>';
      return;
    }
    
    let html = '';
    res.performers.forEach((user, index) => {
      const position = index + 1;
      const happn = user.happn_total || 0;
      const leads = user.leads_total || 0;
      const total = user.total_score || 0;
      
      let medal = '';
      if(position === 1) medal = '🥇';
      else if(position === 2) medal = '🥈';
      else if(position === 3) medal = '🥉';
      
      html += `
        <tr>
          <td style="font-weight:700;">${medal} ${position}</td>
          <td>${escapeHtml(user.username || 'Unknown')}</td>
          <td>${user.role || '—'}</td>
          <td>${escapeHtml(user.instagram_username || '—')}</td>
          <td style="color:#f59e0b;font-weight:600;">${happn}</td>
          <td style="color:#10b981;font-weight:600;">${leads}</td>
          <td style="font-weight:700;color:var(--accent);">${total}</td>
        </tr>
      `;
    });
    
    tbody.innerHTML = html;
  }catch(e){
    console.error('loadRankingTable err', e);
  }
}

/* ========= WORK LOG ========= */
document.getElementById('addWorklogBtn').addEventListener('click', async () => {
  const userId = document.getElementById('worklogUser').value;
  const date = document.getElementById('worklogDate').value;
  const status = document.getElementById('worklogStatus').value;
  const reason = document.getElementById('worklogReason').value.trim();
  const statusEl = document.getElementById('worklogStatusMsg');
  
  if (!userId || !date) {
    statusEl.textContent = 'Заполни все поля!';
    return;
  }
  
  try {
    const res = await fetch('/api/worklogs/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, date, status, reason })
    });
    const data = await res.json();
    
    if (data.ok) {
      statusEl.textContent = '✅ Запись добавлена!';
      document.getElementById('worklogReason').value = '';
      document.getElementById('worklogUser').selectedIndex = 0;
      document.getElementById('worklogStatus').selectedIndex = 0;
      await loadWorklogsByDate(currentWorklogDate);
    }
  } catch (e) {
    console.error('Add worklog error', e);
  }
});

document.getElementById('worklogDatePicker').addEventListener('change', (e) => {
  currentWorklogDate = new Date(e.target.value);
  loadWorklogsByDate(currentWorklogDate);
});

document.getElementById('prevDayBtn').addEventListener('click', () => {
  currentWorklogDate.setDate(currentWorklogDate.getDate() - 1);
  document.getElementById('worklogDatePicker').valueAsDate = currentWorklogDate;
  loadWorklogsByDate(currentWorklogDate);
});

document.getElementById('nextDayBtn').addEventListener('click', () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextDate = new Date(currentWorklogDate);
  nextDate.setDate(nextDate.getDate() + 1);
  nextDate.setHours(0, 0, 0, 0);
  
  if (nextDate <= today) {
    currentWorklogDate = nextDate;
    document.getElementById('worklogDatePicker').valueAsDate = currentWorklogDate;
    loadWorklogsByDate(currentWorklogDate);
  }
});

async function loadWorklogsByDate(date) {
  try {
    const dateStr = formatDate(date);
    const res = await fetchJson(`/api/worklogs?date=${dateStr}`);
    if (!res.ok) return;
    
    const listEl = document.getElementById('worklogList');
    
    if (res.logs.length === 0) {
      listEl.innerHTML = '<div class="small muted">Нет записей за этот день</div>';
      return;
    }
    
    let html = '';
    res.logs.forEach(log => {
      let badgeStyle = 'padding:6px 14px;border-radius:12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;';
      let statusText = '';
      
      if (log.status === 'working') {
        badgeStyle += 'background:linear-gradient(135deg, var(--accent-green) 0%, #059669 100%);color:#fff;';
        statusText = '✅ Работает';
      } else if (log.status === 'absent') {
        badgeStyle += 'background:linear-gradient(135deg, var(--accent-red) 0%, #dc2626 100%);color:#fff;';
        statusText = '❌ Не вышел';
      } else if (log.status === 'evening') {
        badgeStyle += 'background:linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);color:#0a0e1a;';
        statusText = '🌙 Вечером';
      }
      
      html += `
        <div style="padding:16px;margin:8px 0;border-radius:16px;background:rgba(255,255,255,0.03);display:flex;justify-content:space-between;align-items:center;border:1px solid var(--glass-border);">
          <div>
            <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(log.username || 'Unknown')}</div>
            <div class="small muted">${log.reason ? escapeHtml(log.reason) : '—'}</div>
          </div>
          <span style="${badgeStyle}">${statusText}</span>
        </div>
      `;
    });
    
    listEl.innerHTML = html;
  } catch (e) {
    console.error('Load worklogs error', e);
  }
}

// Set today's date as default
document.getElementById('worklogDate').valueAsDate = new Date();
document.getElementById('worklogDatePicker').valueAsDate = new Date();
currentWorklogDate = new Date();

/* ========= AUTO-REFRESH ========= */
let periodicHandle = null;

async function refreshAll(){
  if (isSelectOpen || isInputFocused) return;
  
  const now = Date.now();
  if (now - lastRefreshTime < REFRESH_COOLDOWN) return;
  lastRefreshTime = now;
  
  const state = preserveStateStart();
  await Promise.all([ 
    loadReports(), 
    loadTeam(), 
    loadGlobalStats()
  ]);
  preserveStateEnd(state);
}

(async function init(){
  await refreshAll();
  await loadWorklogsByDate(currentWorklogDate);
  
  if(periodicHandle) clearInterval(periodicHandle);
  periodicHandle = setInterval(async ()=>{ 
    if(document.hidden) return; 
    await refreshAll(); 
  }, 3000);
})();

window.addEventListener('beforeunload', ()=>{ if(periodicHandle) clearInterval(periodicHandle); });
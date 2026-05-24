// ========== Storage Keys ==========
const STORE = {
  users: 'kovowife_users',
  session: 'kovowife_session',
  chats: (uid) => `kovowife_chats_${uid}`,
  config: (uid) => `kovowife_config_${uid}`
};

// ========== State ==========
let currentUser = null;
let conversations = [];
let activeConversationId = null;
let isProcessing = false;

// ========== DOM ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ========== Crypto helpers (Web Crypto API) ==========
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateId() {
  return crypto.randomUUID();
}

// ========== User Storage ==========
function getUsers() {
  try { return JSON.parse(localStorage.getItem(STORE.users)) || {}; } catch { return {}; }
}
function saveUsers(users) {
  localStorage.setItem(STORE.users, JSON.stringify(users));
}

// ========== Chat Storage ==========
function getUserChats() {
  if (!currentUser) return [];
  try { return JSON.parse(localStorage.getItem(STORE.chats(currentUser.id))) || []; } catch { return []; }
}
function saveUserChats(chats) {
  if (!currentUser) return;
  localStorage.setItem(STORE.chats(currentUser.id), JSON.stringify(chats));
}

// ========== Config Storage ==========
function getUserConfig() {
  if (!currentUser) return { apiKey: '', apiUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-3.5-turbo' };
  try { return JSON.parse(localStorage.getItem(STORE.config(currentUser.id))) || { apiKey: '', apiUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-3.5-turbo' }; } catch { return { apiKey: '', apiUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-3.5-turbo' }; }
}
function saveUserConfig(config) {
  if (!currentUser) return;
  localStorage.setItem(STORE.config(currentUser.id), JSON.stringify(config));
}

// ========== Auth ==========
function showLogin() {
  $('#loginForm').classList.add('active');
  $('#registerForm').classList.remove('active');
  $('#loginError').textContent = '';
}
function showRegister() {
  $('#registerForm').classList.add('active');
  $('#loginForm').classList.remove('active');
  $('#regError').textContent = '';
}

$('#showRegister').addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
$('#showLogin').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#loginError');
  errEl.textContent = '';
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  if (!username || !password) { errEl.textContent = '请填写用户名和密码'; return; }

  const users = getUsers();
  const user = Object.values(users).find(u => u.username === username);
  if (!user) { errEl.textContent = '用户名或密码错误'; return; }

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.password) { errEl.textContent = '用户名或密码错误'; return; }

  currentUser = { id: user.id, username: user.username };
  localStorage.setItem(STORE.session, JSON.stringify(currentUser));
  enterApp();
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#regError');
  errEl.textContent = '';
  const username = $('#regUsername').value.trim();
  const password = $('#regPassword').value;
  const confirm = $('#regPasswordConfirm').value;

  if (!username || !password) { errEl.textContent = '请填写所有字段'; return; }
  if (username.length < 3 || username.length > 20) { errEl.textContent = '用户名长度需在3-20个字符之间'; return; }
  if (password.length < 6) { errEl.textContent = '密码长度不能少于6位'; return; }
  if (password !== confirm) { errEl.textContent = '两次密码输入不一致'; return; }

  const users = getUsers();
  if (Object.values(users).some(u => u.username === username)) {
    errEl.textContent = '该用户名已被注册'; return;
  }

  const id = generateId();
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  users[id] = { id, username, password: hash, salt, createdAt: new Date().toISOString() };
  saveUsers(users);

  currentUser = { id, username };
  localStorage.setItem(STORE.session, JSON.stringify(currentUser));
  enterApp();
});

// ========== App Entry ==========
function enterApp() {
  $('#authOverlay').style.display = 'none';
  $('#appContainer').style.display = 'flex';
  $('#displayUsername').textContent = currentUser.username;

  const config = getUserConfig();
  updateModeBadge(!!config.apiKey);
  loadConversations();
}

function updateModeBadge(hasApiKey) {
  const badge = $('#modeBadge');
  if (hasApiKey) {
    badge.textContent = '在线模式';
    badge.classList.add('online');
  } else {
    badge.textContent = '离线模式';
    badge.classList.remove('online');
  }
}

function logout() {
  localStorage.removeItem(STORE.session);
  currentUser = null;
  activeConversationId = null;
  conversations = [];
  $('#authOverlay').style.display = 'flex';
  $('#appContainer').style.display = 'none';
  $('#loginForm').classList.add('active');
  $('#registerForm').classList.remove('active');
  $('#loginUsername').value = '';
  $('#loginPassword').value = '';
  renderConversations();
  showWelcome();
  $('#chatTitle').textContent = '选择或新建一个对话';
}

$('#btnLogout').addEventListener('click', () => {
  if (confirm('确定要退出登录吗？')) logout();
});

// ========== Conversations ==========
function loadConversations() {
  conversations = getUserChats();
  renderConversations();
}

function renderConversations() {
  const list = $('#conversationList');
  const sorted = [...conversations].reverse();
  list.innerHTML = sorted.map(c => `
    <div class="conv-item${c.id === activeConversationId ? ' active' : ''}" data-id="${c.id}">
      <span class="conv-title">${escapeHtml(c.title || '新对话')}</span>
      <button class="conv-delete" data-id="${c.id}" title="删除">🗑</button>
    </div>
  `).join('') || '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">暂无对话</div>';

  list.querySelectorAll('.conv-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('conv-delete')) return;
      selectConversation(item.dataset.id);
    });
  });
  list.querySelectorAll('.conv-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(btn.dataset.id);
    });
  });
}

function selectConversation(id) {
  activeConversationId = id;
  const conv = conversations.find(c => c.id === id);
  if (conv) {
    $('#chatTitle').textContent = conv.title || '对话';
    renderMessages();
    renderConversations();
  }
}

function showWelcome() {
  $('#chatMessages').innerHTML = `<div class="welcome-screen">
    <div class="welcome-icon">🤖</div>
    <h2>欢迎使用 Kovowife AI助手</h2>
    <p>点击左侧"新建对话"开始与AI交流</p>
    <div class="welcome-tips">
      <div class="tip-item" data-prompt="帮我写一段Python代码">💻 帮我写一段Python代码</div>
      <div class="tip-item" data-prompt="解释一下什么是机器学习">📚 解释一下什么是机器学习</div>
      <div class="tip-item" data-prompt="帮我翻译一段英文">🌐 帮我翻译一段英文</div>
      <div class="tip-item" data-prompt="写一份工作周报模板">📝 写一份工作周报模板</div>
    </div>
  </div>`;
  bindWelcomeTips();
}

function renderMessages() {
  const conv = conversations.find(c => c.id === activeConversationId);
  if (!conv || conv.messages.length === 0) {
    showWelcome();
    return;
  }
  $('#chatMessages').innerHTML = conv.messages.map(m => `
    <div class="message ${m.role}">
      <div class="message-avatar">${m.role === 'user' ? '👤' : '🤖'}</div>
      <div class="message-content">${formatMessage(m.content)}</div>
    </div>
  `).join('');
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
}

function formatMessage(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:3px;">$1</code>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function deleteConversation(id) {
  if (!confirm('确定删除这个对话吗？')) return;
  conversations = conversations.filter(c => c.id !== id);
  saveUserChats(conversations);
  if (activeConversationId === id) {
    activeConversationId = null;
    showWelcome();
    $('#chatTitle').textContent = '选择或新建一个对话';
  }
  renderConversations();
}

// ========== Chat ==========
async function sendMessage() {
  if (isProcessing) return;
  const message = $('#chatInput').value.trim();
  if (!message) return;

  $('#chatInput').value = '';
  $('#chatInput').style.height = 'auto';
  isProcessing = true;
  $('#btnSend').disabled = true;

  // Ensure conversation exists
  if (!activeConversationId || !conversations.find(c => c.id === activeConversationId)) {
    const conv = {
      id: generateId(),
      title: message.substring(0, 30),
      messages: [],
      createdAt: new Date().toISOString()
    };
    conversations.push(conv);
    activeConversationId = conv.id;
    saveUserChats(conversations);
    renderConversations();
    $('#chatTitle').textContent = conv.title;
  }

  const conv = conversations.find(c => c.id === activeConversationId);
  conv.messages.push({ role: 'user', content: message, time: new Date().toISOString() });
  renderMessages();

  // Typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'message assistant';
  typingEl.innerHTML = `<div class="message-avatar">🤖</div><div class="message-content"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
  $('#chatMessages').appendChild(typingEl);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;

  const config = getUserConfig();
  let reply;

  if (!config.apiKey) {
    reply = generateLocalReply(message, conv.messages);
    conv.messages.push({ role: 'assistant', content: reply, time: new Date().toISOString() });
    saveUserChats(conversations);
    renderMessages();
    finishSending();
    return;
  }

  // Call AI API directly from browser
  try {
    reply = await callAI(message, conv.messages, config);
    conv.messages.push({ role: 'assistant', content: reply, time: new Date().toISOString() });
  } catch (err) {
    conv.messages.push({ role: 'assistant', content: `❌ 请求失败: ${err.message}`, time: new Date().toISOString() });
  }

  saveUserChats(conversations);
  renderMessages();
  finishSending();
}

function finishSending() {
  isProcessing = false;
  $('#btnSend').disabled = false;
  $('#chatInput').focus();
}

async function callAI(message, history, config) {
  const messages = [
    { role: 'system', content: '你是一个有帮助的AI助手。请用中文回复。' },
    ...history.slice(-20).map(m => ({ role: m.role, content: m.content }))
  ];

  const res = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: 2048,
      stream: false
    })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw new Error('AI未返回有效回复');
  return reply;
}

function generateLocalReply(message) {
  const msg = message.toLowerCase();
  if (msg.includes('你好') || msg.includes('hello') || msg.includes('hi')) {
    return '你好！我是本地AI助手。当前未配置外部AI API，我只能在本地模式下进行简单回复。\n\n请在左侧 **⚙️ API设置** 中配置OpenAI兼容的API密钥来启用完整的AI对话功能。';
  }
  if (msg.includes('帮助') || msg.includes('help')) {
    return '**📋 使用说明**\n\n1. 点击左下角 **⚙️ API设置** 配置AI API\n2. 支持OpenAI及兼容API（如Ollama、vLLM等）\n3. 配置后即可进行完整AI对话\n4. 对话记录会自动保存在浏览器中\n\n当前处于本地离线模式，只能进行简单问答。';
  }
  if (msg.includes('你是谁') || msg.includes('你是什么')) {
    return '我是Kovowife AI助手，运行在你的浏览器中。当前处于离线模式（未配置外部AI API），功能有限。配置API密钥后，我可以调用大语言模型为你提供更智能的回复。';
  }
  if (msg.includes('时间') || msg.includes('几点')) {
    return `现在是 ${new Date().toLocaleString('zh-CN')}。`;
  }
  return `收到你的消息: "${message}"\n\n💡 **提示**: 当前为本地离线模式。要获得更好的AI对话体验，请点击左下角 ⚙️ 配置OpenAI兼容的API密钥和接口地址。`;
}

// ========== Event Listeners ==========
$('#btnSend').addEventListener('click', sendMessage);
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$('#chatInput').addEventListener('input', () => {
  $('#chatInput').style.height = 'auto';
  $('#chatInput').style.height = Math.min($('#chatInput').scrollHeight, 150) + 'px';
});
$('#btnNewChat').addEventListener('click', () => {
  activeConversationId = null;
  $('#chatTitle').textContent = '新建对话';
  showWelcome();
  renderConversations();
  $('#chatInput').focus();
});

function bindWelcomeTips() {
  $$('.tip-item').forEach(tip => {
    tip.addEventListener('click', () => {
      $('#chatInput').value = tip.dataset.prompt;
      sendMessage();
    });
  });
}
bindWelcomeTips();

// ========== Settings ==========
$('#btnSettings').addEventListener('click', () => {
  const config = getUserConfig();
  $('#apiUrl').value = config.apiUrl || '';
  $('#apiKey').value = '';
  $('#modelName').value = config.model || '';
  $('#apiKey').placeholder = config.apiKey ? '已设置（不显示原密钥）' : 'sk-...';
  $('#settingsMsg').textContent = '';
  $('#settingsModal').style.display = 'flex';
});

$('#closeSettings').addEventListener('click', () => { $('#settingsModal').style.display = 'none'; });
$('#settingsModal').addEventListener('click', (e) => { if (e.target === $('#settingsModal')) $('#settingsModal').style.display = 'none'; });

$('#saveSettings').addEventListener('click', () => {
  const msgEl = $('#settingsMsg');
  msgEl.textContent = '';
  const apiKey = $('#apiKey').value.trim();
  const apiUrl = $('#apiUrl').value.trim();
  const model = $('#modelName').value.trim();

  if (!apiUrl || !model) {
    msgEl.textContent = '⚠️ 请填写API地址和模型名称';
    msgEl.style.color = 'var(--danger)';
    return;
  }

  const config = getUserConfig();
  config.apiUrl = apiUrl;
  config.model = model;
  if (apiKey) config.apiKey = apiKey;
  saveUserConfig(config);

  msgEl.textContent = '✅ 设置已保存';
  msgEl.style.color = 'var(--success)';
  $('#apiKey').value = '';
  $('#apiKey').placeholder = '已设置（不显示原密钥）';
  updateModeBadge(!!config.apiKey);
});

$('#testConnection').addEventListener('click', async () => {
  const msgEl = $('#settingsMsg');
  msgEl.textContent = '⏳ 正在测试连接...';
  msgEl.style.color = 'var(--text-secondary)';

  const apiKey = $('#apiKey').value.trim();
  const apiUrl = $('#apiUrl').value.trim();
  const model = $('#modelName').value.trim();
  const config = getUserConfig();

  const testKey = apiKey || config.apiKey;
  if (!apiUrl || !testKey) {
    msgEl.textContent = '⚠️ 请填写API地址和密钥';
    msgEl.style.color = 'var(--danger)';
    return;
  }

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${testKey}`
      },
      body: JSON.stringify({
        model: model || config.model,
        messages: [{ role: 'user', content: '你好，请简单回复"连接成功"' }],
        max_tokens: 50
      })
    });
    if (res.ok) {
      msgEl.textContent = '✅ 连接成功！AI已响应';
      msgEl.style.color = 'var(--success)';
      // Save the config
      config.apiUrl = apiUrl;
      config.model = model || config.model;
      if (apiKey) config.apiKey = apiKey;
      saveUserConfig(config);
      updateModeBadge(true);
    } else {
      const err = await res.json().catch(() => ({}));
      msgEl.textContent = `❌ 连接失败: ${err.error?.message || `HTTP ${res.status}`}`;
      msgEl.style.color = 'var(--danger)';
    }
  } catch (err) {
    msgEl.textContent = `❌ 网络错误: ${err.message}`;
    msgEl.style.color = 'var(--danger)';
  }
});

// ========== Sidebar Toggle ==========
$('#sidebarToggle').addEventListener('click', () => $('#sidebar').classList.toggle('collapsed'));
$('#sidebarToggleMobile').addEventListener('click', () => $('#sidebar').classList.toggle('collapsed'));

// ========== Init ==========
(function init() {
  const session = localStorage.getItem(STORE.session);
  if (session) {
    try {
      currentUser = JSON.parse(session);
      if (currentUser && currentUser.id && currentUser.username) {
        enterApp();
        return;
      }
    } catch { /* ignore */ }
  }
  // Show login
  $('#authOverlay').style.display = 'flex';
  $('#appContainer').style.display = 'none';
})();

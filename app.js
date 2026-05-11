// ── Auth Gate ─────────────────────────────────────────────────────
// Password is hashed so it's not visible in plain text in source code.
// SHA-256 of "4231"
const PASS_HASH = 'bba155c5f227c6e52a8b2707a13e817137cbac50806b4822f99bbf0778c3f8fd';

async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function checkPassword() {
    const input = document.getElementById('password-input');
    const errorEl = document.getElementById('auth-error');
    const hash = await sha256(input.value);

    if (hash === PASS_HASH) {
        // Correct — show dashboard, remove gate
        sessionStorage.setItem('lvsAdminAuth', '1');
        const gate = document.getElementById('auth-gate');
        gate.style.opacity = '0';
        gate.style.transition = 'opacity 0.3s';
        setTimeout(() => gate.remove(), 300);

        const dash = document.getElementById('dashboard');
        dash.style.display = 'contents';
        fetchChannels();
    } else {
        // Wrong — shake animation + error message
        errorEl.style.display = 'block';
        input.classList.remove('shake');
        void input.offsetWidth; // reflow to restart animation
        input.classList.add('shake');
        input.value = '';
        setTimeout(() => input.classList.remove('shake'), 500);
    }
}

// Auto-unlock if already authenticated in this session
(function initAuth() {
    if (sessionStorage.getItem('lvsAdminAuth') === '1') {
        document.getElementById('auth-gate').style.display = 'none';
        document.getElementById('dashboard').style.display = 'contents';
        // fetchChannels() will be called after DOMContentLoaded
    }
})();

// ── Mobile Sidebar Toggle ─────────────────────────────────────────
function toggleSidebar() {
    document.body.classList.toggle('sidebar-open');
}

function closeSidebar() {
    document.body.classList.remove('sidebar-open');
}

// ── Theme Management ─────────────────────────────────────────────
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('lvsAdminTheme', newTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const iconTopbar = document.getElementById('theme-icon');
    const iconSidebar = document.getElementById('theme-icon-sidebar');
    const iconText = theme === 'dark' ? '☀️' : '🌙';
    
    if (iconTopbar) iconTopbar.textContent = iconText;
    if (iconSidebar) iconSidebar.textContent = iconText;
}

// Initialize theme
(function initTheme() {
    const savedTheme = localStorage.getItem('lvsAdminTheme');
    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        // Fallback to system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'dark' : 'light');
    }

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('lvsAdminTheme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
})();

const API_URL = 'https://lvs-streem-backend.onrender.com/api/channels';


// ── DOM refs ──────────────────────────────────────────────────────
const channelsList    = document.getElementById('channels-list');
const loadingEl       = document.getElementById('loading');
const emptyState      = document.getElementById('empty-state');
const toastEl         = document.getElementById('toast');
const searchInput     = document.getElementById('search-input');
const categoryFilter  = document.getElementById('category-filter');
const typeFilter      = document.getElementById('type-filter');

// ── State ──────────────────────────────────────────────────────────
let allChannels   = [];
let isEditing     = false;
let pendingDelete = null;
let currentView   = 'all'; // 'all' | 'tv' | 'radio'

// ── Set Channel View (sidebar nav) ───────────────────────────────────
function setChannelView(view) {
    currentView = view;

    // Update active nav item
    ['nav-all', 'nav-tv', 'nav-radio'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    const activeNav = document.getElementById(`nav-${view}`);
    if (activeNav) activeNav.classList.add('active');

    // Update page title
    const titles = { all: 'All Channels', tv: '📺 TV Channels', radio: '📻 Radio Channels' };
    document.getElementById('page-title').textContent = titles[view] || 'Channels';

    // Re-populate category filter and render
    populateCategoryFilter();
    filterChannels();
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Only load channels if already authenticated
    if (sessionStorage.getItem('lvsAdminAuth') === '1') {
        fetchChannels();
    }

    // Focus password input on load
    const pwInput = document.getElementById('password-input');
    if (pwInput) pwInput.focus();

    // Open modal from multiple buttons
    document.getElementById('topbar-add-btn').addEventListener('click', openAddModal);
    document.getElementById('add-channel-nav').addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn').addEventListener('click', openAddModal);

    // Form submit
    document.getElementById('channel-form').addEventListener('submit', handleFormSubmit);

    // Confirm delete
    document.getElementById('confirm-delete-btn').addEventListener('click', confirmDelete);

    // Close modals on overlay click
    document.getElementById('modal-overlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('delete-overlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) cancelDelete();
    });

    // ESC key closes modals
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeModal(); cancelDelete(); }
    });
});

// ── Fetch ──────────────────────────────────────────────────────────
async function fetchChannels() {
    showLoading(true);
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        allChannels = await res.json();
        updateStats();
        populateCategoryFilter();
        renderChannels(getFiltered());
    } catch (err) {
        showToast('Failed to load channels: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ── Stats ──────────────────────────────────────────────────────────
function updateStats() {
    const tvChannels    = allChannels.filter(c => c.category.toLowerCase() !== 'radio');
    const radioChannels = allChannels.filter(c => c.category.toLowerCase() === 'radio');
    const total   = allChannels.length;
    const active  = allChannels.filter(c => c.isActive !== false).length;
    const hidden  = total - active;
    const webview = allChannels.filter(c => c.webPlayerUrl && c.webPlayerUrl.trim()).length;

    document.getElementById('stat-total').textContent   = total;
    document.getElementById('stat-active').textContent  = active;
    document.getElementById('stat-hidden').textContent  = hidden;
    document.getElementById('stat-webview').textContent = webview;

    // Update label to show TV/Radio breakdown in stat cards
    const labelTotal = document.querySelector('#stat-total').closest('.stat-card').querySelector('.stat-label');
    if (labelTotal) labelTotal.textContent = `Total (TV: ${tvChannels.length} | Radio: ${radioChannels.length})`;
}

// ── Category filter population ─────────────────────────────────────
function populateCategoryFilter() {
    // Only show categories relevant to current view
    const viewChannels = currentView === 'tv'
        ? allChannels.filter(c => c.category.toLowerCase() !== 'radio')
        : currentView === 'radio'
            ? allChannels.filter(c => c.category.toLowerCase() === 'radio')
            : allChannels;

    const cats = [...new Set(viewChannels.map(c => c.category).filter(Boolean))].sort();
    const sel = categoryFilter;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>';
    cats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat; opt.textContent = cat;
        if (cat === current) opt.selected = true;
        sel.appendChild(opt);
    });

    // Also populate datalist in form
    const dl = document.getElementById('category-datalist');
    dl.innerHTML = '';
    cats.forEach(cat => {
        const o = document.createElement('option'); o.value = cat; dl.appendChild(o);
    });
}

// ── Filter ─────────────────────────────────────────────────────────
function filterChannels() {
    renderChannels(getFiltered());
}

function getFiltered() {
    const q    = searchInput.value.toLowerCase().trim();
    const cat  = categoryFilter.value;
    const type = typeFilter.value;

    return allChannels.filter(c => {
        // View filter (TV / Radio / All)
        const isRadio = c.category.toLowerCase() === 'radio';
        if (currentView === 'tv' && isRadio) return false;
        if (currentView === 'radio' && !isRadio) return false;

        const matchQ    = !q || c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
        const matchCat  = !cat || c.category === cat;
        const hasWeb    = !!(c.webPlayerUrl && c.webPlayerUrl.trim());
        const matchType = !type || (type === 'webview' ? hasWeb : !hasWeb);
        return matchQ && matchCat && matchType;
    });
}

// ── Render ─────────────────────────────────────────────────────────
function renderChannels(channels) {
    channelsList.innerHTML = '';

    if (channels.length === 0) {
        emptyState.style.display = 'block';
        document.getElementById('channels-table').style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    document.getElementById('channels-table').style.display = 'table';

    channels.forEach(ch => {
        const hasWebUrl = !!(ch.webPlayerUrl && ch.webPlayerUrl.trim());
        const playerBadge = hasWebUrl
            ? '<span class="badge badge-webview">WebView</span>'
            : '<span class="badge badge-native">Native</span>';

        const iconHtml = ch.icon
            ? `<img src="${ch.icon}" alt="${ch.name}" class="channel-img" onerror="this.src='https://placehold.co/44x44/1e1e2a/6366f1?text=TV'">`
            : `<div class="channel-img" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">📺</div>`;

        const streamUrlHtml = ch.url
            ? `<a href="${ch.url}" target="_blank" rel="noopener" title="${ch.url}">${truncate(ch.url, 30)}</a>`
            : '<span style="color:#4b5563">—</span>';

        const webUrlHtml = hasWebUrl
            ? `<a href="${ch.webPlayerUrl}" target="_blank" rel="noopener" title="${ch.webPlayerUrl}">${truncate(ch.webPlayerUrl, 28)}</a>`
            : '<span style="color:#4b5563">—</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${iconHtml}</td>
            <td><strong>${ch.name}</strong></td>
            <td><span style="background:rgba(99,102,241,0.12);color:#818cf8;padding:2px 10px;border-radius:20px;font-size:0.78rem;">${ch.category}</span></td>
            <td class="url-cell">${streamUrlHtml}</td>
            <td class="url-cell">${webUrlHtml}</td>
            <td>${playerBadge}</td>
            <td>
                <label class="switch" title="${ch.isActive !== false ? 'Active – click to hide' : 'Hidden – click to show'}">
                    <input type="checkbox" onchange="toggleActive('${ch._id}', this.checked)" ${ch.isActive !== false ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </td>
            <td style="white-space:nowrap">
                <button class="btn btn-sm btn-ghost" onclick="openEditModal('${ch._id}')">✏️ Edit</button>
                <button class="btn btn-sm btn-danger" style="margin-left:6px" onclick="openDeleteModal('${ch._id}')">🗑️</button>
            </td>
        `;
        channelsList.appendChild(tr);
    });
}

function truncate(str, n) {
    return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Modal helpers ─────────────────────────────────────────────────
function openAddModal() {
    closeSidebar();
    isEditing = false;
    document.getElementById('modal-title').textContent = 'Add New Channel';
    document.getElementById('submit-btn').textContent = 'Add Channel';
    document.getElementById('channel-form').reset();
    document.getElementById('channel-id').value = '';
    document.getElementById('isActive').checked = true;
    document.getElementById('icon-preview').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'flex';
}

function openEditModal(id) {
    const ch = allChannels.find(c => c._id === id);
    if (!ch) return;
    isEditing = true;

    document.getElementById('modal-title').textContent = 'Edit Channel';
    document.getElementById('submit-btn').textContent = 'Update Channel';
    document.getElementById('channel-id').value   = ch._id;
    document.getElementById('name').value          = ch.name || '';
    document.getElementById('icon').value          = ch.icon || '';
    document.getElementById('url').value           = ch.url  || '';
    document.getElementById('category').value      = ch.category || '';
    document.getElementById('webPlayerUrl').value  = ch.webPlayerUrl || '';
    document.getElementById('dns').value           = ch.dns || '';
    document.getElementById('isActive').checked    = ch.isActive !== false;

    previewIcon();
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('channel-form').reset();
    document.getElementById('icon-preview').style.display = 'none';
}

// ── Form Submit ───────────────────────────────────────────────────
async function handleFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = isEditing ? 'Updating…' : 'Adding…';

    const data = {
        name:         document.getElementById('name').value.trim(),
        icon:         document.getElementById('icon').value.trim(),
        url:          document.getElementById('url').value.trim(),
        category:     document.getElementById('category').value.trim(),
        webPlayerUrl: document.getElementById('webPlayerUrl').value.trim(),
        dns:          document.getElementById('dns').value.trim(),
        isActive:     document.getElementById('isActive').checked,
    };

    // Validate: at least one of Stream URL or Web Player URL must be set
    if (!data.url && !data.webPlayerUrl) {
        showToast('Please enter either a Stream URL or a Web Player URL.', 'error');
        btn.disabled = false;
        btn.textContent = isEditing ? 'Update Channel' : 'Add Channel';
        document.getElementById('webPlayerUrl').focus();
        return;
    }

    try {
        const id = document.getElementById('channel-id').value;
        const endpoint = isEditing ? `${API_URL}/${id}` : API_URL;
        const method   = isEditing ? 'PUT' : 'POST';

        const res = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        showToast(isEditing ? 'Channel updated ✓' : 'Channel added ✓', 'success');
        closeModal();
        await fetchChannels();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = isEditing ? 'Update Channel' : 'Add Channel';
    }
}

// ── Toggle Active ──────────────────────────────────────────────────
async function toggleActive(id, isActive) {
    try {
        const res = await fetch(`${API_URL}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive }),
        });
        if (!res.ok) throw new Error('Failed');
        const ch = allChannels.find(c => c._id === id);
        if (ch) ch.isActive = isActive;
        updateStats();
        showToast(`Channel ${isActive ? 'activated' : 'hidden'}`, 'success');
    } catch {
        showToast('Failed to update visibility', 'error');
        fetchChannels(); // revert UI
    }
}

// ── Delete ─────────────────────────────────────────────────────────
function openDeleteModal(id) {
    pendingDelete = id;
    const ch = allChannels.find(c => c._id === id);
    document.getElementById('delete-channel-name').textContent =
        `This will permanently delete "${ch?.name || 'this channel'}".`;
    document.getElementById('delete-overlay').style.display = 'flex';
}

function cancelDelete() {
    pendingDelete = null;
    document.getElementById('delete-overlay').style.display = 'none';
}

async function confirmDelete() {
    if (!pendingDelete) return;
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
        const res = await fetch(`${API_URL}/${pendingDelete}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        allChannels = allChannels.filter(c => c._id !== pendingDelete);
        cancelDelete();
        updateStats();
        populateCategoryFilter();
        renderChannels(getFiltered());
        showToast('Channel deleted', 'success');
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Delete';
    }
}

// ── Icon preview ──────────────────────────────────────────────────
function previewIcon() {
    const url = document.getElementById('icon').value.trim();
    const img = document.getElementById('icon-preview');
    if (url) {
        img.src = url;
        img.style.display = 'block';
        img.onerror = () => img.style.display = 'none';
    } else {
        img.style.display = 'none';
    }
}

// ── Toast ──────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
    toastEl.textContent = msg;
    toastEl.className = `toast ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3500);
}

// ── Loading ────────────────────────────────────────────────────────
function showLoading(show) {
    loadingEl.style.display = show ? 'flex' : 'none';
    if (show) {
        channelsList.innerHTML = '';
        emptyState.style.display = 'none';
        document.getElementById('channels-table').style.display = show ? 'none' : 'table';
    }
}

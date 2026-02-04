// ===== UI Utilities =====
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ===== DolfPower App =====
const API_URL = 'http://127.0.0.1:3001';

// State
let allProfiles = [];
let allProxies = [];
let allGroups = [];
let selectedProfiles = new Set();
let selectedProxies = new Set();
let currentSort = 'created_at';
let currentSortOrder = 'desc';
let searchQuery = '';
let filterStatus = '';
let filterGroup = '';
let currentSection = 'profiles';
let rpaActions = [];
let allScenarios = [];
let allExtensions = [];
let allBookmarks = [];
let selectedExtensions = new Set();
let selectedBookmarks = new Set();
let extensionSearchQuery = '';
let bookmarkSearchQuery = '';
let runningProfiles = new Set();
let recentlyCheckedProfileId = null;
let statusInterval = null;

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    // Initialize Lucide icons
    lucide.createIcons();
    
    // Load saved theme
    const savedTheme = localStorage.getItem('dolfpower_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    // Check Authentication State
    const isAuthenticated = await checkAuthState();
    if (!isAuthenticated) return;

    // Load data only after authentication
    await loadAppData();
    
    // Start polling status
    startStatusPolling();
    
    // Apply translations
    applyTranslations();
}

async function loadAppData() {
    await Promise.all([
        loadProfiles(),
        loadProxies(),
        loadGroups(),
        loadJarvisConfig(),
        loadJarvisHistory()
    ]);
}

async function logout() {
    if (!confirm('Logout and lock application?')) return;
    
    try {
        await fetch(`${API_URL}/v1.0/auth/logout`, { method: 'POST' });
        // Reload app to show login screen
        window.location.reload();
    } catch (e) {
        showToast('Logout failed', 'error');
    }
}

// ===== Authentication Logic =====
async function checkAuthState() {
    try {
        const response = await fetch(`${API_URL}/v1.0/auth/state`);
        const result = await response.json();
        
        if (!result.success) return false;
        
        const state = result.data;
        
        // Update security status indicator in top bar
        const indicator = document.getElementById('security-status-indicator');
        if (indicator) {
            indicator.style.display = state.isAuthenticated ? 'flex' : 'none';
        }

        const modal = document.getElementById('auth-modal');
        const title = document.getElementById('auth-title');
        const desc = document.getElementById('auth-desc');
        const error = document.getElementById('auth-error');
        
        error.style.display = 'none';
        modal.style.display = 'flex';

        if (!state.isInitialized) {
            title.textContent = t('auth.setupTitle');
            desc.textContent = t('auth.setupDesc');
            document.getElementById('auth-setup-fields').style.display = 'block';
            document.getElementById('auth-login-fields').style.display = 'none';
            document.getElementById('auth-2fa-fields').style.display = 'none';
            return false;
        }

        if (state.requiresTotp) {
            title.textContent = t('auth.totpTitle');
            desc.textContent = t('auth.totpDesc');
            document.getElementById('auth-setup-fields').style.display = 'none';
            document.getElementById('auth-login-fields').style.display = 'none';
            document.getElementById('auth-2fa-fields').style.display = 'block';
            return false;
        }

        if (!state.isAuthenticated) {
            title.textContent = t('auth.loginTitle');
            desc.textContent = '';
            document.getElementById('auth-setup-fields').style.display = 'none';
            document.getElementById('auth-login-fields').style.display = 'block';
            document.getElementById('auth-2fa-fields').style.display = 'none';
            return false;
        }

        // Already authenticated
        modal.style.display = 'none';
        return true;
    } catch (e) {
        console.error('Auth state check failed:', e);
        return false;
    }
}

async function handleAuthSetup() {
    const password = document.getElementById('auth-setup-password').value;
    const confirm = document.getElementById('auth-setup-confirm').value;
    const error = document.getElementById('auth-error');

    if (password.length < 8) {
        error.textContent = 'Password must be at least 8 characters';
        error.style.display = 'block';
        return;
    }

    if (password !== confirm) {
        error.textContent = t('auth.passwordsDontMatch');
        error.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/v1.0/auth/initialize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const result = await response.json();

        if (result.success) {
            initializeApp(); // Restart initialization
        } else {
            error.textContent = result.error || 'Setup failed';
            error.style.display = 'block';
        }
    } catch (e) {
        error.textContent = 'Connection error';
        error.style.display = 'block';
    }
}

async function handleAuthLogin() {
    const password = document.getElementById('auth-login-password').value;
    const error = document.getElementById('auth-error');

    try {
        const response = await fetch(`${API_URL}/v1.0/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const result = await response.json();

        if (result.success) {
            initializeApp(); // Restart initialization
        } else {
            error.textContent = result.error === 'Invalid password' ? t('auth.invalidPassword') : result.error;
            error.style.display = 'block';
        }
    } catch (e) {
        error.textContent = 'Connection error';
        error.style.display = 'block';
    }
}

async function handleAuthVerify2FA() {
    const code = document.getElementById('auth-2fa-code').value;
    const error = document.getElementById('auth-error');

    try {
        const response = await fetch(`${API_URL}/v1.0/auth/verify-2fa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const result = await response.json();

        if (result.success) {
            initializeApp(); // Restart initialization
        } else {
            error.textContent = 'Invalid 2FA code';
            error.style.display = 'block';
        }
    } catch (e) {
        error.textContent = 'Connection error';
        error.style.display = 'block';
    }
}

// ===== Status Polling =====
function startStatusPolling() {
    if (statusInterval) clearInterval(statusInterval);
    
    const poll = async () => {
        try {
            const response = await fetch(`${API_URL}/v1.0/browser_profiles/running/list`);
            const data = await response.json();
            if (data.success && data.data && data.data.profiles) {
                const runningIds = new Set(data.data.profiles.map(p => p.profileId));
                
                // Update if changed
                const runningArray = Array.from(runningIds).sort();
                const currentArray = Array.from(runningProfiles).sort();
                
                if (JSON.stringify(runningArray) !== JSON.stringify(currentArray)) {
                    runningProfiles = runningIds;
                    renderProfiles();
                }
            }
        } catch (e) {
            console.error('Status polling error:', e);
        }
    };
    
    poll();
    statusInterval = setInterval(poll, 3000);
    
    // Poll Jarvis notifications
    setInterval(updateJarvisBadge, 10000);
}

// ===== Jarvis Notifications =====
async function updateJarvisBadge() {
    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/tasks`);
        const data = await response.json();
        if (data.success && data.data) {
            // Count tasks with errors in logs or failed status
            const failedCount = data.data.filter(t => t.status === 'failed').length;
            
            const badge = document.getElementById('jarvis-badge');
            if (badge) {
                if (failedCount > 0) {
                    badge.textContent = failedCount;
                    badge.style.display = 'block';
                } else {
                    badge.style.display = 'none';
                }
            }
        }
    } catch (e) {
        console.error('Failed to update Jarvis badge:', e);
    }
}

// ===== Theme =====
function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('dolfpower_theme', newTheme);
    lucide.createIcons();
}

// ===== Navigation =====
function switchSection(section) {
    currentSection = section;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === section);
    });
    
    // Update sections
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === `${section}-section`);
    });
    
    // Update title
    const titles = {
        profiles: t('profiles.title'),
        proxies: t('proxies.title'),
        extensions: t('extensions.title'),
        bookmarks: t('bookmarks.title'),
        groups: t('groups.title'),
        scenarios: t('rpa.title'),
        jarvis: t('nav.jarvis'),
        trash: t('nav.trash')
    };
    document.querySelector('.page-title').textContent = titles[section] || section;
    
    // Load section data
    if (section === 'profiles') loadProfiles();
    if (section === 'proxies') loadProxies();
    if (section === 'extensions') loadExtensions();
    if (section === 'bookmarks') loadBookmarks();
    if (section === 'groups') loadGroups();
    if (section === 'scenarios') loadScenarios();
    if (section === 'trash') loadTrash();
    if (section === 'jarvis') {
        loadJarvisConfig();
        loadJarvisHistory();
    }
    if (section === 'security') updateSecurityUI();
    
    lucide.createIcons();
}

// ===== Profiles =====
async function loadProfiles() {
    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles`);
        const data = await response.json();
        allProfiles = data.data || [];
        renderProfiles();
    } catch (error) {
        console.error('Failed to load profiles:', error);
        showToast(t('common.error'), 'error');
    }
}

function renderProfiles() {
    let profiles = [...allProfiles];
    
    // Apply search
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        profiles = profiles.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.tags && p.tags.toLowerCase().includes(q)) ||
            (p.notes && p.notes.toLowerCase().includes(q))
        );
    }
    
    // Apply status filter
    if (filterStatus) {
        profiles = profiles.filter(p => p.status === filterStatus);
    }
    
    // Apply group filter
    if (filterGroup) {
        profiles = profiles.filter(p => p.group_id === filterGroup);
    }
    
    // Apply sorting
    profiles.sort((a, b) => {
        let aVal = a[currentSort] || 0;
        let bVal = b[currentSort] || 0;
        
        // Prioritize running profiles
        const aRunning = runningProfiles.has(a.id);
        const bRunning = runningProfiles.has(b.id);
        if (aRunning && !bRunning) return -1;
        if (!aRunning && bRunning) return 1;

        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        if (currentSortOrder === 'asc') return aVal > bVal ? 1 : -1;
        return aVal < bVal ? 1 : -1;
    });
    
    // Update count
    document.getElementById('total-count').textContent = profiles.length;
    
    const tbody = document.getElementById('profiles-tbody');
    
    if (profiles.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="user-circle"></i>
                        <h3>${t('profiles.noProfiles')}</h3>
                        <p>${t('profiles.noProfilesDesc')}</p>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }
    
    tbody.innerHTML = profiles.map(profile => {
        const isSelected = selectedProfiles.has(profile.id);
        const isRunning = runningProfiles.has(profile.id);
        const isRecentlyChecked = recentlyCheckedProfileId === profile.id;
        const tags = profile.tags ? profile.tags.split(',').map(t => t.trim()).filter(t => t) : [];
        const proxyInfo = getProxyInfo(profile.proxy_id, profile.last_checked_ip, profile.last_checked_country);
        
        return `
            <tr class="${isSelected ? 'selected' : ''} ${isRunning ? 'running' : ''} ${isRecentlyChecked ? 'recently-checked' : ''}" data-id="${profile.id}">
                <td>
                    <input type="checkbox" ${isSelected ? 'checked' : ''} 
                        onchange="toggleProfileSelection('${profile.id}', this.checked)">
                </td>
                <td>
                    <span class="status-dot ${profile.status || 'new'}"></span>
                </td>
                <td>
                    <div class="profile-name">
                        ${escapeHtml(profile.name)}
                        ${isRunning ? `<span class="running-badge">${t('profiles.running')}</span>` : ''}
                    </div>
                    ${tags.length > 0 ? `
                        <div class="profile-tags">
                            ${tags.slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                            ${tags.length > 3 ? `<span class="tag">+${tags.length - 3}</span>` : ''}
                        </div>
                    ` : ''}
                </td>
                <td>
                    <div class="group-cell">
                        ${getGroupInfo(profile.group_id)}
                    </div>
                </td>
                <td>
                    <div class="proxy-info">
                        ${proxyInfo.flag ? `<span class="proxy-flag">${proxyInfo.flag}</span>` : ''}
                        <span class="proxy-text" style="${isRecentlyChecked ? 'color: var(--success); font-weight: bold;' : ''}">${proxyInfo.text}</span>
                    </div>
                </td>
                <td>
                    <span class="status-badge ${profile.status || 'new'}">
                        ${profile.status || 'new'}
                    </span>
                </td>
                <td>
                    <span class="time-ago">${formatTimeAgo(profile.last_opened_at)}</span>
                </td>
                <td>
                    <span class="notes-text" title="${escapeHtml(profile.notes || '')}">
                        ${profile.notes ? escapeHtml(profile.notes.substring(0, 30)) + (profile.notes.length > 30 ? '...' : '') : '-'}
                    </span>
                </td>
                <td>
                    <div class="row-actions">
                        ${isRunning ? `
                            <button class="btn btn-ghost btn-sm btn-danger" onclick="stopProfile('${profile.id}')" title="${t('common.stop')}">
                                <i data-lucide="square"></i>
                            </button>
                        ` : `
                            <button class="btn btn-ghost btn-sm btn-success" onclick="startProfile('${profile.id}')" title="${t('common.start')}">
                                <i data-lucide="play"></i>
                            </button>
                        `}
                        <button class="btn btn-ghost btn-sm" onclick="checkProfileProxy('${profile.id}')" title="${t('proxies.test')}">
                            <i data-lucide="globe"></i>
                        </button>
                        <button class="btn btn-ghost btn-sm" onclick="openEditModal('${profile.id}')" title="${t('common.edit')}">
                            <i data-lucide="pencil"></i>
                        </button>
                        <button class="btn btn-ghost btn-sm" onclick="openTotpModal('${profile.id}')" title="${t('modal.totp')}">
                            <i data-lucide="shield-check"></i>
                        </button>
                        <button class="btn btn-ghost btn-sm" onclick="duplicateProfile('${profile.id}')" title="${t('common.duplicate')}">
                            <i data-lucide="copy"></i>
                        </button>
                        <button class="btn btn-ghost btn-sm" onclick="deleteProfile('${profile.id}')" title="${t('common.delete')}">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    lucide.createIcons();
    updateBulkActions();
}

function getCountryFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🌐';
    try {
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    } catch (e) {
        return '🌐';
    }
}

function getProxyInfo(proxyId, lastCheckedIp = null, lastCheckedCountry = null) {
    if (!proxyId && !lastCheckedIp) return { text: t('common.direct'), flag: '' };
    
    const proxy = proxyId ? allProxies.find(p => p.id === proxyId) : null;
    
    // Use last checked info if available, fallback to proxy config
    const ip = lastCheckedIp || (proxy ? `${proxy.host}:${proxy.port}` : t('common.direct'));
    const countryCode = lastCheckedCountry || (proxy ? proxy.country_code : null);
    const flag = getCountryFlag(countryCode);
    
    return { text: ip, flag };
}

function getGroupInfo(groupId) {
    if (!groupId) return `<span class="text-muted">${t('profiles.noGroup')}</span>`;
    const group = allGroups.find(g => g.id === groupId);
    if (!group) return `<span class="text-muted">${t('profiles.noGroup')}</span>`;
    
    return `
        <div class="group-badge-wrapper">
            <span class="group-color-dot" style="background-color: ${group.color}"></span>
            <span class="group-name-text">${escapeHtml(group.name)}</span>
        </div>
    `;
}

// ===== Profile Actions =====
async function startProfile(id) {
    try {
        await fetch(`${API_URL}/v1.0/browser_profiles/${id}/start`);
        showToast(t('profiles.started'), 'success');
        setTimeout(loadProfiles, 1000);
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

async function stopProfile(id) {
    try {
        await fetch(`${API_URL}/v1.0/browser_profiles/${id}/stop`);
        showToast(t('profiles.stopped'), 'success');
        setTimeout(loadProfiles, 500);
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

async function deleteProfile(id) {
    const confirmed = await showConfirm(
        t('confirm.deleteTitle') || 'Move to Trash',
        t('confirm.deleteProfile') || 'Are you sure you want to move this profile to Trash?',
        t('common.delete') || 'Delete'
    );
    if (!confirmed) return;
    
    showLoading(t('msg.deleting') || 'Deleting profile...', 'Closing browser and cleaning up data directory...');
    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            showToast(t('profiles.deleted'), 'success');
            await loadProfiles();
        } else {
            showToast(data.error || t('common.error'), 'error');
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    } finally {
        hideLoading();
    }
}

async function duplicateProfile(id) {
    try {
        await fetch(`${API_URL}/v1.0/browser_profiles/${id}/duplicate`, { method: 'POST' });
        showToast(t('profiles.duplicated'), 'success');
        loadProfiles();
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

// ===== Selection =====
function toggleProfileSelection(id, checked) {
    if (checked) {
        selectedProfiles.add(id);
    } else {
        selectedProfiles.delete(id);
    }
    updateBulkActions();
    
    // Update row style
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) row.classList.toggle('selected', checked);
}

function toggleSelectAll(checked) {
    const visibleIds = Array.from(document.querySelectorAll('#profiles-tbody tr[data-id]'))
        .map(row => row.dataset.id);
    
    visibleIds.forEach(id => {
        if (checked) {
            selectedProfiles.add(id);
        } else {
            selectedProfiles.delete(id);
        }
    });
    
    renderProfiles();
}

function updateBulkActions() {
    const bulkActions = document.getElementById('bulk-actions');
    const selectedCount = document.getElementById('selected-count');
    
    if (selectedProfiles.size > 0) {
        bulkActions.style.display = 'flex';
        selectedCount.textContent = selectedProfiles.size;
    } else {
        bulkActions.style.display = 'none';
    }
}

// ===== Bulk Actions =====
async function bulkStartProfiles() {
    const ids = Array.from(selectedProfiles);
    let started = 0;
    
    for (const id of ids) {
        try {
            await fetch(`${API_URL}/v1.0/browser_profiles/${id}/start`);
            started++;
        } catch (e) {}
    }
    
    showToast(`${started} ${t('profiles.started')}`, 'success');
    setTimeout(loadProfiles, 2000);
}

async function bulkStopProfiles() {
    const ids = Array.from(selectedProfiles);
    let stopped = 0;
    
    for (const id of ids) {
        try {
            await fetch(`${API_URL}/v1.0/browser_profiles/${id}/stop`);
            stopped++;
        } catch (e) {}
    }
    
    showToast(`${stopped} ${t('profiles.stopped')}`, 'success');
    setTimeout(loadProfiles, 1000);
}

async function bulkDeleteProfiles() {
    const count = selectedProfiles.size;
    if (count === 0) return;
    
    const confirmed = await showConfirm(
        t('confirm.deleteTitle') || 'Move to Trash',
        t('confirm.deleteProfiles', { n: count }) || `Are you sure you want to move ${count} profiles to the Trash Bin?`,
        t('common.delete') || 'Delete'
    );
    if (!confirmed) return;
    
    showLoading(t('msg.deleting') || 'Deleting profiles...', 'Closing browsers and cleaning up profile data...');
    try {
        await fetch(`${API_URL}/v1.0/browser_profiles/bulk-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(selectedProfiles) })
        });
        
        selectedProfiles.clear();
        showToast(t('profiles.deleted'), 'success');
        loadProfiles();
    } catch (error) {
        showToast(t('common.error'), 'error');
    } finally {
        hideLoading();
    }
}

// ===== Search & Filter =====
function searchProfiles(query) {
    searchQuery = query;
    renderProfiles();
}

function filterByStatus(status) {
    filterStatus = status;
    renderProfiles();
}

function filterByGroup(group) {
    filterGroup = group;
    renderProfiles();
}

function sortProfiles(field) {
    if (currentSort === field) {
        currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort = field;
        currentSortOrder = 'desc';
    }
    renderProfiles();
}

// ===== Proxies =====
async function loadProxies() {
    try {
        const response = await fetch(`${API_URL}/v1.0/proxies`);
        const data = await response.json();
        allProxies = data.data || [];
        renderProxies();
        updateProxySelects();
    } catch (error) {
        console.error('Failed to load proxies:', error);
    }
}

function renderProxies() {
    const tbody = document.getElementById('proxies-tbody');
    if (!tbody) return;
    
    if (allProxies.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="globe"></i>
                        <h3>${t('proxies.noProxies')}</h3>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }
    
    tbody.innerHTML = allProxies.map(proxy => {
        const isSelected = selectedProxies.has(proxy.id);
        return `
            <tr data-id="${proxy.id}" class="${isSelected ? 'selected' : ''}">
                <td><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleProxySelection('${proxy.id}', this.checked)"></td>
                <td>${escapeHtml(proxy.name)}</td>
                <td><span class="tag">${proxy.protocol.toUpperCase()}</span></td>
                <td>${proxy.host}</td>
                <td>${proxy.port}</td>
                <td>
                    <div class="proxy-flag-cell" title="${proxy.country_code || ''}">
                        ${getCountryFlag(proxy.country_code)}
                        <span class="country-code-text">${proxy.country_code || '-'}</span>
                    </div>
                </td>
                <td>
                    <div class="group-cell">
                        ${getGroupInfo(proxy.group_id)}
                    </div>
                </td>
                <td class="proxy-status-cell"><span class="status-badge active">${t('proxies.working')}</span></td>
                <td>
                    <div class="row-actions">
                        <button class="btn btn-ghost btn-sm" onclick="testProxyById('${proxy.id}')" title="${t('proxies.test')}">
                            <i data-lucide="activity"></i>
                        </button>
                        <button class="btn btn-ghost btn-sm" onclick="deleteProxy('${proxy.id}')" title="${t('common.delete')}">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    lucide.createIcons();
    updateProxyBulkActions();
}

function toggleProxySelection(id, checked) {
    if (checked) {
        selectedProxies.add(id);
    } else {
        selectedProxies.delete(id);
    }
    
    const row = document.querySelector(`#proxies-tbody tr[data-id="${id}"]`);
    if (row) row.classList.toggle('selected', checked);
    
    updateProxyBulkActions();
}

function toggleSelectAllProxies(checked) {
    const visibleIds = Array.from(document.querySelectorAll('#proxies-tbody tr[data-id]'))
        .map(row => row.dataset.id);
    
    visibleIds.forEach(id => {
        if (checked) {
            selectedProxies.add(id);
        } else {
            selectedProxies.delete(id);
        }
    });
    
    renderProxies();
}

function updateProxyBulkActions() {
    const bulkActions = document.getElementById('proxy-bulk-actions');
    const selectedCount = document.getElementById('proxy-selected-count');
    
    if (selectedProxies.size > 0) {
        bulkActions.style.display = 'flex';
        selectedCount.textContent = selectedProxies.size;
    } else {
        bulkActions.style.display = 'none';
    }
}


async function bulkDeleteProxies() {
    if (!confirm(t('confirm.deleteProxies', { n: selectedProxies.size }))) return;
    
    const ids = Array.from(selectedProxies);
    try {
        await fetch(`${API_URL}/v1.0/proxies/bulk/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxy_ids: ids })
        });
        
        selectedProxies.clear();
        showToast(t('proxies.deleted'), 'success');
        loadProxies();
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

function updateProxySelects() {
    const selects = document.querySelectorAll('#profile-proxy, #edit-proxy');
    selects.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = `<option value="">${t('common.noProxy')}</option>` +
            allProxies.map(p => `<option value="${p.id}">${p.name} (${p.host}:${p.port})</option>`).join('');
        select.value = currentValue;
    });
}

// ===== Free Proxies =====
function openFreeProxyModal() {
    openModal('free-proxy-modal');
}

async function runFetchFreeProxies() {
    const sources = Array.from(document.querySelectorAll('#free-proxy-sources input:checked')).map(cb => cb.value);
    const maxProxies = parseInt(document.getElementById('free-proxy-max').value) || 50;
    const testBeforeImport = document.getElementById('free-proxy-test-before').checked;
    
    if (sources.length === 0) {
        showToast(t('msg.selectSources'), 'warning');
        return;
    }
    
    showToast(t('proxies.fetching'), 'info');
    closeModal('free-proxy-modal');
    
    try {
        const response = await fetch(`${API_URL}/v1.0/proxies/free/fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sources, maxProxies, testBeforeImport })
        });
        const data = await response.json();
        
        if (data.success) {
            showToast(`${t('proxies.fetched')}: ${data.data.imported}`, 'success');
            loadProxies();
        } else {
            showToast(data.error || t('proxies.fetch_failed'), 'error');
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

// ===== Chrome Web Store =====
function openChromeStoreModal() {
    document.getElementById('chrome-store-url').value = '';
    document.getElementById('chrome-store-warning').style.display = 'none';
    document.getElementById('chrome-store-loader').style.display = 'none';
    document.getElementById('chrome-store-btn').disabled = false;
    openModal('chrome-store-modal');
}

async function verifyChromeExtension() {
    const input = document.getElementById('chrome-store-url').value.trim();
    if (!input) return;
    
    // Extract ID from URL
    let extensionId = input;
    const match = input.match(/\/detail\/[^\/]+\/([a-z]{32})/i) || input.match(/([a-z]{32})/i);
    if (match) extensionId = match[1];
    
    if (extensionId.length !== 32) {
        showToast(t('msg.invalidExtensionId'), 'error');
        return;
    }
    
    const warning = document.getElementById('chrome-store-warning');
    const loader = document.getElementById('chrome-store-loader');
    const btn = document.getElementById('chrome-store-btn');
    
    if (warning.style.display === 'none') {
        warning.style.display = 'block';
        btn.textContent = t('msg.continueAnyway');
        return;
    }
    
    warning.style.display = 'none';
    loader.style.display = 'block';
    btn.disabled = true;
    
    try {
        const response = await fetch(`${API_URL}/v1.0/extensions/chrome-store/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extensionId })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(t('msg.extensionInstalled'), 'success');
            closeModal('chrome-store-modal');
            loadExtensions();
        } else {
            showToast(data.error || t('msg.extensionInstallFailed'), 'error');
        }
    } catch (error) {
        showToast(t('msg.serverError'), 'error');
    } finally {
        loader.style.display = 'none';
        btn.disabled = false;
        btn.textContent = t('extensions.add');
    }
}

// ===== Mass Proxy Check =====

async function deleteProxy(id) {
    if (!confirm(t('confirm.deleteProxy'))) return;
    
    try {
        await fetch(`${API_URL}/v1.0/proxies/${id}`, { method: 'DELETE' });
        showToast(t('proxies.deleted'), 'success');
        loadProxies();
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

async function loadExtensions() {
    try {
        const response = await fetch(`${API_URL}/v1.0/extensions`);
        const data = await response.json();
        allExtensions = data.data || [];
        renderExtensions();
    } catch (error) {
        console.error('Failed to load extensions:', error);
    }
}

function renderExtensions() {
    const grid = document.getElementById('extensions-grid');
    if (!grid) return;
    
    let extensions = [...allExtensions];
    if (extensionSearchQuery) {
        const q = extensionSearchQuery.toLowerCase();
        extensions = extensions.filter(ext => 
            ext.name.toLowerCase().includes(q) || 
            ext.path.toLowerCase().includes(q)
        );
    }

    if (extensions.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i data-lucide="puzzle"></i>
                <h3>${t('extensions.noExtensions')}</h3>
            </div>
        `;
        lucide.createIcons();
        return;
    }
    
    grid.innerHTML = extensions.map(ext => {
        const isSelected = selectedExtensions.has(ext.id);
        return `
            <div class="extension-card ${isSelected ? 'selected' : ''}" onclick="toggleExtensionSelection('${ext.id}', event)">
                <div class="extension-selection">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleExtensionSelection('${ext.id}', event)">
                </div>
                <div class="extension-icon">
                    <i data-lucide="puzzle"></i>
                </div>
                <div class="extension-info">
                    <div class="extension-name">${escapeHtml(ext.name)}</div>
                    <div class="extension-path" title="${escapeHtml(ext.path)}">${escapeHtml(ext.path)}</div>
                </div>
                <div class="extension-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-ghost btn-sm" onclick="deleteExtension('${ext.id}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    lucide.createIcons();
    updateExtensionBulkActions();
}

function searchExtensions(query) {
    extensionSearchQuery = query;
    renderExtensions();
}

function toggleExtensionSelection(id, event) {
    if (selectedExtensions.has(id)) {
        selectedExtensions.delete(id);
    } else {
        selectedExtensions.add(id);
    }
    renderExtensions();
}

function updateExtensionBulkActions() {
    const bulkActions = document.getElementById('extension-bulk-actions');
    const selectedCount = document.getElementById('extension-selected-count');
    if (selectedExtensions.size > 0) {
        bulkActions.style.display = 'flex';
        selectedCount.textContent = selectedExtensions.size;
    } else {
        bulkActions.style.display = 'none';
    }
}

async function bulkDeleteExtensions() {
    if (!confirm(t('confirm.deleteExtensions', { n: selectedExtensions.size }))) return;
    
    const ids = Array.from(selectedExtensions);
    let deleted = 0;
    for (const id of ids) {
        try {
            await fetch(`${API_URL}/v1.0/extensions/${id}`, { method: 'DELETE' });
            deleted++;
        } catch (e) {}
    }
    
    if (deleted > 0) {
        selectedExtensions.clear();
        showToast(`${deleted} ${t('nav.extensions')} ${t('profiles.deleted')}`, 'success');
        loadExtensions();
    }
}

// ===== Bookmarks =====
async function loadBookmarks() {
    try {
        const response = await fetch(`${API_URL}/v1.0/bookmarks`);
        const data = await response.json();
        allBookmarks = data.data || [];
        renderBookmarks();
    } catch (error) {
        console.error('Failed to load bookmarks:', error);
    }
}

function renderBookmarks() {
    const list = document.getElementById('bookmarks-list');
    if (!list) return;
    
    let bookmarks = [...allBookmarks];
    if (bookmarkSearchQuery) {
        const q = bookmarkSearchQuery.toLowerCase();
        bookmarks = bookmarks.filter(bm => 
            bm.name.toLowerCase().includes(q) || 
            bm.url.toLowerCase().includes(q)
        );
    }

    if (bookmarks.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i data-lucide="bookmark"></i>
                <h3>${t('bookmarks.noBookmarks')}</h3>
            </div>
        `;
        lucide.createIcons();
        return;
    }
    
    list.innerHTML = bookmarks.map(bm => {
        const isSelected = selectedBookmarks.has(bm.id);
        return `
            <div class="bookmark-item ${isSelected ? 'selected' : ''}" onclick="toggleBookmarkSelection('${bm.id}', event)">
                <div class="bookmark-selection">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleBookmarkSelection('${bm.id}', event)">
                </div>
                <div class="bookmark-icon">
                    <i data-lucide="link"></i>
                </div>
                <div class="bookmark-info">
                    <div class="bookmark-name">${escapeHtml(bm.name)}</div>
                    <div class="bookmark-url" title="${escapeHtml(bm.url)}">${escapeHtml(bm.url)}</div>
                </div>
                <div class="bookmark-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-ghost btn-sm" onclick="deleteBookmark('${bm.id}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    lucide.createIcons();
    updateBookmarkBulkActions();
}

function searchBookmarks(query) {
    bookmarkSearchQuery = query;
    renderBookmarks();
}

function toggleBookmarkSelection(id, event) {
    if (selectedBookmarks.has(id)) {
        selectedBookmarks.delete(id);
    } else {
        selectedBookmarks.add(id);
    }
    renderBookmarks();
}

function updateBookmarkBulkActions() {
    const bulkActions = document.getElementById('bookmark-bulk-actions');
    const selectedCount = document.getElementById('bookmark-selected-count');
    if (selectedBookmarks.size > 0) {
        bulkActions.style.display = 'flex';
        selectedCount.textContent = selectedBookmarks.size;
    } else {
        bulkActions.style.display = 'none';
    }
}

async function bulkDeleteBookmarks() {
    if (!confirm(t('confirm.deleteBookmarks', { n: selectedBookmarks.size }))) return;
    
    const ids = Array.from(selectedBookmarks);
    let deleted = 0;
    for (const id of ids) {
        try {
            await fetch(`${API_URL}/v1.0/bookmarks/${id}`, { method: 'DELETE' });
            deleted++;
        } catch (e) {}
    }
    
    if (deleted > 0) {
        selectedBookmarks.clear();
        showToast(`${deleted} ${t('nav.bookmarks')} ${t('profiles.deleted')}`, 'success');
        loadBookmarks();
    }
}

function openMassBookmarkModal() {
    const groupSelect = document.getElementById('mass-bookmark-group');
    groupSelect.innerHTML = allGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    
    const list = document.getElementById('mass-bookmarks-list');
    if (allBookmarks.length === 0) {
        list.innerHTML = `<p class="text-muted">${t('bookmarks.none_available')}</p>`;
    } else {
        list.innerHTML = allBookmarks.map(bm => `
            <div class="bookmark-select-item">
                <label class="checkbox-label">
                    <input type="checkbox" name="mass-bookmark-id" value="${bm.id}">
                    <span>${escapeHtml(bm.name)}</span>
                </label>
            </div>
        `).join('');
    }
    
    document.getElementById('mass-bookmark-target').value = 'all';
    document.getElementById('mass-bookmark-group-container').style.display = 'none';
    document.getElementById('mass-bookmark-action').value = 'add';
    
    openModal('mass-bookmark-modal');
}

function toggleMassBookmarkGroup() {
    const target = document.getElementById('mass-bookmark-target').value;
    document.getElementById('mass-bookmark-group-container').style.display = target === 'group' ? 'block' : 'none';
}

async function applyMassBookmarks() {
    const action = document.getElementById('mass-bookmark-action').value;
    const target = document.getElementById('mass-bookmark-target').value;
    const groupId = document.getElementById('mass-bookmark-group').value;
    const bookmarkIds = Array.from(document.querySelectorAll('input[name="mass-bookmark-id"]:checked')).map(cb => cb.value);
    
    if (bookmarkIds.length === 0 && action !== 'clear') {
        showToast(t('bookmarks.selectBookmarks'), 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/v1.0/bookmarks/mass-manage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, target, groupId, bookmarkIds })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(`${t('common.success')}: ${data.updated} ${t('nav.profiles')} ${t('profiles.updated') || 'updated'}`, 'success');
            closeModal('mass-bookmark-modal');
        } else {
            showToast(data.error || t('common.error'), 'error');
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}


async function loadGroups() {
    try {
        const response = await fetch(`${API_URL}/v1.0/groups`);
        const data = await response.json();
        allGroups = data.data || [];
        renderGroups();
        updateGroupSelects();
    } catch (error) {
        console.error('Failed to load groups:', error);
    }
}

function renderGroups() {
    const tbody = document.getElementById('groups-tbody');
    if (!tbody) return;
    
    if (allGroups.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <i data-lucide="layers"></i>
                        <h3>${t('groups.noGroups')}</h3>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }
    
    tbody.innerHTML = allGroups.map(group => `
        <tr>
            <td>
                <div class="group-name-cell">
                    <span class="group-color-dot" style="background-color: ${group.color}"></span>
                    ${escapeHtml(group.name)}
                </div>
            </td>
            <td><code>${group.color}</code></td>
            <td>${escapeHtml(group.description || '-')}</td>
            <td><span class="badge">${group.profile_count || 0}</span></td>
            <td><span class="badge" style="background-color: var(--secondary)">${group.proxy_count || 0}</span></td>
            <td>
                <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" onclick="openEditGroupModal('${group.id}')" title="${t('common.edit')}">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="btn btn-ghost btn-sm" onclick="deleteGroup('${group.id}')" title="${t('common.delete')}">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    
    lucide.createIcons();
}

function updateGroupSelects() {
    const selects = document.querySelectorAll('#profile-group, #edit-group, #group-filter, #proxy-group, #bulk-proxy-group');
    selects.forEach(select => {
        const currentValue = select.value;
        const isFilter = select.id === 'group-filter';
        
        let html = isFilter ? `<option value="">${t('filter.allGroups')}</option>` : `<option value="">${t('common.noGroup')}</option>`;
        html += allGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
        
        select.innerHTML = html;
        select.value = currentValue;
    });
}

function openCreateGroupModal() {
    document.getElementById('group-modal-title').textContent = t('groups.create');
    document.getElementById('group-id').value = '';
    document.getElementById('group-name').value = '';
    document.getElementById('group-color').value = '#6366f1';
    document.getElementById('group-description').value = '';
    openModal('group-modal');
}

function openEditGroupModal(id) {
    const group = allGroups.find(g => g.id === id);
    if (!group) return;
    
    document.getElementById('group-modal-title').textContent = t('common.edit');
    document.getElementById('group-id').value = group.id;
    document.getElementById('group-name').value = group.name;
    document.getElementById('group-color').value = group.color || '#6366f1';
    document.getElementById('group-description').value = group.description || '';
    openModal('group-modal');
}

async function saveGroup() {
    const id = document.getElementById('group-id').value;
    const name = document.getElementById('group-name').value.trim();
    const color = document.getElementById('group-color').value;
    const description = document.getElementById('group-description').value.trim();
    
    if (!name) {
        showToast(t('msg.nameRequired'), 'error');
        return;
    }
    
    const data = { name, color, description };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_URL}/v1.0/groups/${id}` : `${API_URL}/v1.0/groups/create`;
    
    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast(id ? t('groups.updated') : t('groups.added'), 'success');
            closeModal('group-modal');
            loadGroups();
            if (!id) loadProfiles(); // Update filter
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

async function deleteGroup(id) {
    if (!confirm(t('common.confirm'))) return;
    
    try {
        await fetch(`${API_URL}/v1.0/groups/${id}`, { method: 'DELETE' });
        showToast(t('groups.deleted'), 'success');
        loadGroups();
        loadProfiles(); // Profile counts might change
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

// ===== TOTP =====
let totpInterval = null;

async function openTotpModal(profileId) {
    document.getElementById('totp-profile-id').value = profileId;
    document.getElementById('new-totp-name').value = '';
    document.getElementById('new-totp-secret').value = '';
    
    await loadTotpSecrets(profileId);
    openModal('totp-modal');
    
    // Start refresh interval
    if (totpInterval) clearInterval(totpInterval);
    totpInterval = setInterval(() => refreshTotpCodes(profileId), 1000);
}

async function loadTotpSecrets(profileId) {
    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/${profileId}/totp`);
        const data = await response.json();
        const secrets = data.data || [];
        
        renderTotpList(secrets);
    } catch (error) {
        console.error('Failed to load TOTP secrets:', error);
    }
}

function renderTotpList(secrets) {
    const list = document.getElementById('totp-list');
    
    if (secrets.length === 0) {
        list.innerHTML = `<div class="empty-state" style="padding: 20px;"><p>${t('msg.noAuthAdded') || 'No authenticators added.'}</p></div>`;
        return;
    }
    
    list.innerHTML = secrets.map(secret => `
        <div class="totp-item" data-id="${secret.id}">
            <div class="totp-icon"><i data-lucide="shield"></i></div>
            <div class="totp-content">
                <div class="totp-name">${escapeHtml(secret.name)}</div>
                <div class="totp-code-wrapper">
                    <span class="totp-code" id="code-${secret.id}">------</span>
                    <span class="totp-timer" id="timer-${secret.id}">--s</span>
                    <i data-lucide="copy" class="totp-copy" onclick="copyTotpCode('${secret.id}')"></i>
                </div>
            </div>
            <div class="totp-delete" onclick="deleteTotpSecret('${secret.id}')">
                <i data-lucide="trash-2"></i>
            </div>
        </div>
    `).join('');
    
    lucide.createIcons();
    // Initial code fetch
    refreshTotpCodes();
}

async function refreshTotpCodes() {
    const profileId = document.getElementById('totp-profile-id').value;
    if (!profileId || !document.getElementById('totp-modal').classList.contains('active')) {
        if (totpInterval) clearInterval(totpInterval);
        return;
    }
    
    const items = document.querySelectorAll('.totp-item');
    for (const item of items) {
        const id = item.dataset.id;
        try {
            const response = await fetch(`${API_URL}/v1.0/totp/${id}/code`);
            const data = await response.json();
            if (data.success) {
                document.getElementById(`code-${id}`).textContent = data.data.code;
                document.getElementById(`timer-${id}`).textContent = `${data.data.timeRemaining}s`;
            }
        } catch (e) {}
    }
}

async function addTotpSecret() {
    const profileId = document.getElementById('totp-profile-id').value;
    const name = document.getElementById('new-totp-name').value.trim();
    const secret = document.getElementById('new-totp-secret').value.trim();
    
    if (!name || !secret) {
        showToast(t('msg.nameSecretRequired'), 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/${profileId}/totp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, secret })
        });
        
        if (response.ok) {
            showToast(t('msg.authAdded'), 'success');
            document.getElementById('new-totp-name').value = '';
            document.getElementById('new-totp-secret').value = '';
            loadTotpSecrets(profileId);
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

async function deleteTotpSecret(id) {
    if (!confirm(t('common.confirm'))) return;
    
    try {
        await fetch(`${API_URL}/v1.0/totp/${id}`, { method: 'DELETE' });
        showToast(t('msg.authDeleted'), 'success');
        const profileId = document.getElementById('totp-profile-id').value;
        loadTotpSecrets(profileId);
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

function copyTotpCode(id) {
    const code = document.getElementById(`code-${id}`).textContent;
    if (code === '------') return;
    
    navigator.clipboard.writeText(code);
    showToast(t('msg.codeCopied'), 'success');
}

// ===== Export =====
function openExportModal() {
    if (selectedProfiles.size === 0) {
        showToast(t('msg.selectProfileExport'), 'warning');
        return;
    }
    document.getElementById('export-profiles-count').textContent = `${selectedProfiles.size} ${t('profiles.selected')}`;
    openModal('export-modal');
}

async function exportProfiles() {
    const format = document.getElementById('export-format').value;
    const ids = Array.from(selectedProfiles).join(',');
    
    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/export?ids=${ids}&format=${format}`);
        const result = await response.json();
        
        if (result.success) {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.data, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `profiles_export_${format}_${new Date().toISOString().slice(0,10)}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            
            showToast(t('msg.exportStarted'), 'success');
            closeModal('export-modal');
        } else {
            showToast(t('common.error'), 'error');
        }
    } catch (error) {
        console.error('Export error:', error);
        showToast(t('common.error'), 'error');
    }
}

// ===== Import Helpers =====
function handleImportFileChange(input) {
    const label = document.getElementById('import-file-name');
    if (input.files && input.files[0]) {
        label.textContent = input.files[0].name;
    } else {
        label.textContent = t('form.dropFile');
    }
}

// ===== UI Utilities =====
let confirmCallback = null;

function showConfirm(title, message, btnText, type = 'danger') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        
        const btn = document.getElementById('confirm-button');
        btn.textContent = btnText || t('common.confirm') || 'Confirm';
        btn.className = `btn btn-${type}`;
        
        confirmCallback = resolve;
        openModal('confirm-modal');
    });
}

function closeConfirm(result) {
    closeModal('confirm-modal');
    if (confirmCallback) {
        confirmCallback(result);
        confirmCallback = null;
    }
}

function showLoading(text, subtext) {
    const loader = document.getElementById('global-loader');
    const loaderText = document.getElementById('loader-text');
    const loaderSub = document.getElementById('loader-subtext');
    if (loader && loaderText) {
        loaderText.textContent = text || t('common.loading') || 'Loading...';
        if (loaderSub) loaderSub.textContent = subtext || 'Please wait, this may take a moment.';
        loader.style.display = 'flex';
    }
}

function hideLoading() {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.style.display = 'none';
    }
}

function scrollToSection(modalPrefix, sectionId) {
    const container = document.getElementById(`${modalPrefix}-modal-scroll`);
    const section = document.getElementById(`${modalPrefix}-section-${sectionId}`);
    
    if (container && section) {
        container.scrollTop = section.offsetTop - 20;
        
        // Update tabs
        const tabs = document.querySelectorAll(`#${modalPrefix}-modal .form-tab`);
        tabs.forEach(tab => {
            const isMatch = tab.getAttribute('onclick').includes(`'${sectionId}'`);
            tab.classList.toggle('active', isMatch);
        });
    }
}

// ===== Trash Bin =====
async function loadTrash() {
    try {
        const response = await fetch(`${API_URL}/v1.0/trash/profiles`);
        const data = await response.json();
        renderTrash(data.data || []);
    } catch (error) {
        console.error('Failed to load trash:', error);
    }
}

function renderTrash(profiles) {
    const tbody = document.getElementById('trash-tbody');
    if (!tbody) return;
    
    if (profiles.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4">
                    <div class="empty-state">
                        <i data-lucide="trash-2"></i>
                        <h3>${t('trash.emptyBin') || 'Trash is empty'}</h3>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }
    
    tbody.innerHTML = profiles.map(p => {
        const deletedAt = new Date(p.deleted_at).getTime();
        const now = Date.now();
        const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
        const remainingMs = Math.max(0, tenDaysMs - (now - deletedAt));
        
        const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
        const remainingHours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (3600000));
        
        const countdownText = remainingMs > 0 
            ? `${remainingDays}d ${remainingHours}h`
            : '<span style="color: var(--danger)">Expired</span>';

        return `
            <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${new Date(p.deleted_at).toLocaleString()}</td>
                <td style="font-weight: 500; color: var(--warning);">${countdownText}</td>
                <td>
                    <div class="row-actions">
                        <button class="btn btn-ghost btn-sm btn-success" onclick="restoreProfileFromTrash('${p.id}')" title="${t('common.restore') || 'Restore'}">
                            <i data-lucide="rotate-ccw"></i>
                        </button>
                        <button class="btn btn-ghost btn-sm btn-danger" onclick="deleteProfilePermanently('${p.id}')" title="${t('common.deletePermanently') || 'Delete Permanently'}">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    lucide.createIcons();
}

async function restoreProfileFromTrash(id) {
    showLoading(t('msg.restoring') || 'Restoring profile...');
    try {
        await fetch(`${API_URL}/v1.0/trash/profiles/${id}/restore`, { method: 'POST' });
        showToast(t('profiles.restored') || 'Profile restored', 'success');
        loadTrash();
    } catch (error) {
        showToast(t('common.error'), 'error');
    } finally {
        hideLoading();
    }
}

async function deleteProfilePermanently(id) {
    const confirmed = await showConfirm(
        t('confirm.deletePermanentlyTitle') || 'Permanent Deletion',
        t('confirm.deletePermanently') || 'Are you sure you want to permanently delete this profile and all its data? This action cannot be undone.',
        t('common.delete') || 'Delete'
    );
    if (!confirmed) return;
    
    showLoading(t('msg.deleting') || 'Deleting permanently...', 'Purging profile files from disk...');
    try {
        const response = await fetch(`${API_URL}/v1.0/trash/profiles/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            showToast(t('profiles.deletedPermanently') || 'Profile permanently deleted', 'success');
            loadTrash();
        } else {
            showToast(data.error || t('common.error'), 'error');
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    } finally {
        hideLoading();
    }
}

async function emptyTrash() {
    const confirmed = await showConfirm(
        t('trash.empty') || 'Empty Trash',
        t('confirm.emptyTrash') || 'Are you sure you want to permanently delete ALL profiles in the Trash Bin? This action cannot be undone.',
        t('trash.empty') || 'Empty Trash'
    );
    if (!confirmed) return;
    
    showLoading(t('msg.emptyingTrash') || 'Emptying trash...', 'Please wait while we purge all deleted data...');
    try {
        const response = await fetch(`${API_URL}/v1.0/trash/profiles`);
        const data = await response.json();
        const profiles = data.data || [];
        
        for (const p of profiles) {
            await fetch(`${API_URL}/v1.0/trash/profiles/${p.id}`, { method: 'DELETE' });
        }
        
        showToast(t('trash.emptied') || 'Trash emptied', 'success');
        loadTrash();
    } catch (error) {
        showToast(t('common.error'), 'error');
    } finally {
        hideLoading();
    }
}
// ===== Proxy Modals =====
function openAddProxyModal() {
    document.getElementById('proxy-name').value = '';
    document.getElementById('proxy-type').value = 'http';
    document.getElementById('proxy-host').value = '';
    document.getElementById('proxy-port').value = '';
    document.getElementById('proxy-username').value = '';
    document.getElementById('proxy-password').value = '';
    document.getElementById('proxy-group').value = '';
    openModal('proxy-modal');
}

async function checkSelectedProxy(mode) {
    const selectId = mode === 'edit' ? 'edit-proxy' : 'profile-proxy';
    const previewId = mode === 'edit' ? 'edit-proxy-preview' : 'proxy-preview';
    const proxyId = document.getElementById(selectId).value;
    const previewEl = document.getElementById(previewId);
    
    if (previewEl) {
        previewEl.style.display = 'block';
        previewEl.innerHTML = `<i data-lucide="loader" class="spin"></i> ${t('msg.checkingProxy')}`;
        lucide.createIcons();
    }
    
    try {
        const url = proxyId ? `${API_URL}/v1.0/proxies/${proxyId}/check` : `${API_URL}/v1.0/ip/check`;
        const response = await fetch(url);
        const data = await response.json();
        
        // Data format differs between /proxies/:id/check and /ip/check
        const result = proxyId ? data.data : data.data;
        const isWorking = proxyId ? result.working : data.success;
        const ip = proxyId ? result.ip : result.info?.ip;
        const country = proxyId ? result.country : result.info?.country;
        const city = proxyId ? result.city : result.info?.city;

        if (isWorking && ip) {
            showToast(`${t('msg.connectionWorking')}: ${country || t('common.unknown')}`, 'success');
            if (previewEl) {
                previewEl.innerHTML = `
                    <div style="color: var(--success); font-weight: bold;">
                        <i data-lucide="check-circle" style="width:14px;height:14px"></i> ${t('proxies.working')}
                    </div>
                    <div style="margin-top:4px">
                        <strong>${t('common.ip')}:</strong> ${ip}<br>
                        <strong>${t('common.geo')}:</strong> ${country || t('common.unknown')}${city ? ', ' + city : ''}
                    </div>
                `;
                lucide.createIcons();
            }
        } else {
            showToast(t('msg.proxyCheckFailed'), 'error');
            if (previewEl) {
                previewEl.innerHTML = `<div style="color: var(--danger); font-weight: bold;"><i data-lucide="x-circle" style="width:14px;height:14px"></i> ${t('msg.proxyCheckFailed')}</div>`;
                lucide.createIcons();
            }
        }
    } catch (error) {
        console.error('Check error:', error);
        showToast(t('msg.proxyCheckError'), 'error');
        if (previewEl) previewEl.innerHTML = `<div style="color: var(--danger)">${t('msg.proxyCheckError')}</div>`;
    }
}

async function checkProfileProxy(profileId) {
    const profile = allProfiles.find(p => p.id === profileId);
    if (!profile) return;
    
    const row = document.querySelector(`tr[data-id="${profileId}"]`);
    const proxyText = row?.querySelector('.proxy-text');
    
    showToast(t('msg.checkingProxy') || 'Checking...', 'info');
    try {
        const url = profile.proxy_id ? `${API_URL}/v1.0/proxies/${profile.proxy_id}/check` : `${API_URL}/v1.0/ip/check`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.success) throw new Error(data.error || 'Request failed');

        let isWorking, ip, countryCode, cityName, countryName;
        
        if (profile.proxy_id) {
            isWorking = data.data.working;
            ip = data.data.ip;
            countryCode = data.data.countryCode;
            cityName = data.data.city;
            countryName = data.data.country;
        } else {
            isWorking = data.data.success;
            ip = data.data.info?.ip;
            countryCode = data.data.info?.countryCode;
            cityName = data.data.info?.city;
            countryName = data.data.info?.country;
        }
        
        if (isWorking && ip) {
            showToast(`${t('msg.connectionWorking')}: ${countryName || countryCode || t('common.unknown')}`, 'success');
            const pIndex = allProfiles.findIndex(p => p.id === profileId);
            if (pIndex !== -1) {
                allProfiles[pIndex].last_checked_ip = ip;
                allProfiles[pIndex].last_checked_country = countryCode;
                
                recentlyCheckedProfileId = profileId;
                renderProfiles();
                
                // Persist IP to database
                fetch(`${API_URL}/v1.0/browser_profiles/${profileId}/ip-update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        ip, 
                        country: countryCode, 
                        city: cityName 
                    })
                }).catch(err => console.error('Failed to persist IP:', err));

                // Clear highlight after 5 seconds
                setTimeout(() => {
                    if (recentlyCheckedProfileId === profileId) {
                        recentlyCheckedProfileId = null;
                        renderProfiles();
                    }
                }, 5000);
            }
        } else {
            showToast(t('msg.proxyCheckFailed'), 'error');
            if (proxyText) {
                proxyText.style.color = 'var(--danger)';
                proxyText.style.fontWeight = 'bold';
            }
        }
    } catch (error) {
        console.error('Check error:', error);
        showToast(t('msg.proxyCheckError'), 'error');
        if (proxyText) {
            proxyText.style.color = 'var(--danger)';
        }
    }
}

async function randomizeFingerprint(mode) {
    const prefix = mode === 'edit' ? 'edit-' : '';
    const osType = document.getElementById(prefix + (mode === 'edit' ? 'os' : 'os-type'))?.value || 'windows';
    const template = `${osType}_chrome`;

    showToast(t('msg.generatingFp') || 'Generating fingerprint...', 'info');
    
    try {
        const response = await fetch(`${API_URL}/v1.0/fingerprint/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template })
        });
        
        const result = await response.json();
        if (!result.success) throw new Error(result.error);
        
        const fp = result.data;
        
        // Map API response to UI fields
        if (fp.screen) {
            const resVal = `${fp.screen.width}x${fp.screen.height}`;
            const resEl = document.getElementById(`${prefix}screen-resolution`);
            if (resEl) {
                // Ensure option exists or add it
                if (!Array.from(resEl.options).some(opt => opt.value === resVal)) {
                    const opt = document.createElement('option');
                    opt.value = resVal;
                    opt.textContent = resVal;
                    resEl.appendChild(opt);
                }
                resEl.value = resVal;
            }
        }
        
        if (fp.languages && fp.languages.language) {
            const langEl = document.getElementById(`${prefix}browser-language`);
            if (langEl) langEl.value = fp.languages.language;
        }
        
        if (fp.navigator) {
            const cpuEl = document.getElementById(`${prefix}cpu-cores`);
            if (cpuEl) cpuEl.value = fp.navigator.hardwareConcurrency.toString();
            
            const memEl = document.getElementById(`${prefix}device-memory`);
            if (memEl) memEl.value = fp.navigator.deviceMemory.toString();
        }
        
        if (fp.webgl) {
            const vendorEl = document.getElementById(`${prefix}webgl-vendor`);
            if (vendorEl) vendorEl.value = fp.webgl.vendor || '';
            
            const rendererEl = document.getElementById(`${prefix}webgl-renderer`);
            if (rendererEl) rendererEl.value = fp.webgl.renderer || '';
            
            const webglModeEl = document.getElementById(`${prefix}webgl-mode`);
            if (webglModeEl) webglModeEl.value = fp.webgl.mode || 'noise';
        }

        if (fp.canvas) {
            const canvasEl = document.getElementById(`${prefix}canvas-mode`);
            if (canvasEl) canvasEl.value = fp.canvas.mode || 'noise';
        }
        
        if (fp.audio) {
            const audioEl = document.getElementById(`${prefix}audio-mode`);
            if (audioEl) audioEl.value = fp.audio.mode || 'noise';
        }
        
        if (fp.clientRects) {
            const crEl = document.getElementById(`${prefix}client-rects-mode`);
            if (crEl) crEl.value = fp.clientRects.mode || 'noise';
        }

        if (fp.webrtc) {
            const webrtcEl = document.getElementById(`${prefix}webrtc-mode`);
            if (webrtcEl) webrtcEl.value = fp.webrtc.mode || 'altered';
        }
        
        showToast(t('msg.fpRandomized'), 'success');
    } catch (error) {
        console.error('Randomize FP error:', error);
        showToast(t('msg.fpRandomizeError') || 'Failed to generate fingerprint', 'error');
    }
}

// ===== Scenarios =====
async function loadScenarios() {
    try {
        const response = await fetch(`${API_URL}/v1.0/rpa/scenarios`);
        const data = await response.json();
        allScenarios = data.data || [];
        renderScenarios();
    } catch (error) {
        console.error('Failed to load scenarios:', error);
    }
}

function renderScenarios() {
    const grid = document.getElementById('scenarios-grid');
    if (!grid) return;
    
    if (allScenarios.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i data-lucide="play-circle"></i>
                <h3>${t('rpa.noScenarios')}</h3>
            </div>
        `;
        lucide.createIcons();
        return;
    }
    
    grid.innerHTML = allScenarios.map(scenario => `
        <div class="scenario-card">
            <div class="scenario-header">
                <div class="scenario-icon">
                    <i data-lucide="play"></i>
                </div>
                <div class="scenario-name">${escapeHtml(scenario.name)}</div>
                <div class="scenario-actions">
                    <button class="btn btn-ghost btn-sm" onclick="deleteScenario('${scenario.id}')" title="${t('common.delete')}">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
            <div class="scenario-body">
                <div class="scenario-meta">
                    <span><i data-lucide="calendar"></i> ${new Date(scenario.created_at).toLocaleDateString()}</span>
                    <span><i data-lucide="activity"></i> ${JSON.parse(scenario.actions || '[]').length} ${t('rpa.actions')}</span>
                </div>
            </div>
            <div class="scenario-footer">
                <button class="btn btn-primary btn-sm" onclick="runScenario('${scenario.id}')">
                    <i data-lucide="play"></i> ${t('rpa.play')}
                </button>
            </div>
        </div>
    `).join('');
    
    lucide.createIcons();
}

async function deleteScenario(id) {
    if (!confirm(t('common.confirm'))) return;
    try {
        await fetch(`${API_URL}/v1.0/rpa/scenarios/${id}`, { method: 'DELETE' });
        showToast(t('common.success'), 'success');
        loadScenarios();
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

function runScenario(id) {
    const runningProfileList = allProfiles.filter(p => runningProfiles.has(p.id));
    
    if (runningProfileList.length === 0) {
        showToast(t('msg.noRunningProfiles'), 'warning');
        return;
    }

    document.getElementById('run-scenario-id').value = id;
    const select = document.getElementById('run-rpa-profile');
    select.innerHTML = runningProfileList.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    
    openModal('run-rpa-modal');
}

async function executeScenario() {
    const scenarioId = document.getElementById('run-scenario-id').value;
    const profileId = document.getElementById('run-rpa-profile').value;

    if (!scenarioId || !profileId) return;

    try {
        const response = await fetch(`${API_URL}/v1.0/rpa/scenarios/${scenarioId}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile_id: profileId })
        });

        const data = await response.json();
        if (data.success) {
            showToast(t('msg.scenarioStarted'), 'success');
            closeModal('run-rpa-modal');
        } else {
            showToast(data.error || t('common.error'), 'error');
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

// ===== RPA Visual Builder =====
function switchRPAMode(mode) {
    const visual = document.getElementById('rpa-visual-editor');
    const json = document.getElementById('rpa-json-editor');
    const tabs = document.querySelectorAll('#rpa-modal .form-tab');
    
    if (mode === 'visual') {
        visual.style.display = 'flex';
        json.style.display = 'none';
        tabs[0].classList.add('active');
        tabs[1].classList.remove('active');
        // Update JSON from visual
        updateActionsJson();
    } else {
        visual.style.display = 'none';
        json.style.display = 'block';
        tabs[0].classList.remove('active');
        tabs[1].classList.add('active');
        // Update visual from JSON
        try {
            rpaActions = JSON.parse(document.getElementById('rpa-actions').value || '[]');
            renderActionBlocks();
        } catch (e) {}
    }
}

function addActionBlock() {
    const type = document.getElementById('new-action-type').value;
    const action = { type };
    
    if (type === 'navigate') action.url = 'https://';
    if (type === 'click' || type === 'hover') action.selector = '';
    if (type === 'type') { action.selector = ''; action.text = ''; }
    if (type === 'pressKey') { action.key = 'Enter'; }
    if (type === 'wait') action.ms = 1000;
    if (type === 'scroll') { action.x = 0; action.y = 500; }
    if (type === 'installExtension') { action.value = 'nkbihfbeogaeaoehlefnkodbefgpgknn'; }
    // reload and back don't need extra params
    
    rpaActions.push(action);
    renderActionBlocks();
    updateActionsJson();
}

function removeActionBlock(index) {
    rpaActions.splice(index, 1);
    renderActionBlocks();
    updateActionsJson();
}

function updateActionParam(index, key, value) {
    rpaActions[index][key] = value;
    updateActionsJson();
}

function moveActionBlock(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= rpaActions.length) return;
    
    const temp = rpaActions[index];
    rpaActions[index] = rpaActions[newIndex];
    rpaActions[newIndex] = temp;
    
    renderActionBlocks();
    updateActionsJson();
}

function renderActionBlocks() {
    const list = document.getElementById('action-list');
    const icons = {
        navigate: 'globe',
        click: 'mouse-pointer-2',
        hover: 'mouse-pointer',
        type: 'type',
        pressKey: 'keyboard',
        wait: 'clock',
        scroll: 'move',
        reload: 'refresh-cw',
        back: 'arrow-left',
        screenshot: 'camera',
        installExtension: 'puzzle'
    };

    list.innerHTML = rpaActions.map((action, index) => `
        <div class="action-block">
            <div class="action-reorder">
                <button class="btn-action-order" onclick="moveActionBlock(${index}, -1)" ${index === 0 ? 'disabled' : ''}>
                    <i data-lucide="chevron-up"></i>
                </button>
                <button class="btn-action-order" onclick="moveActionBlock(${index}, 1)" ${index === rpaActions.length - 1 ? 'disabled' : ''}>
                    <i data-lucide="chevron-down"></i>
                </button>
            </div>
            <div class="action-icon"><i data-lucide="${icons[action.type] || 'play'}"></i></div>
            <div class="action-content">
                <div class="action-type">${action.type}</div>
                <div class="action-params">
                    ${renderActionInputs(action, index)}
                </div>
            </div>
            <div class="action-remove" onclick="removeActionBlock(${index})">
                <i data-lucide="trash-2"></i>
            </div>
        </div>
    `).join('');
    
    lucide.createIcons();
}

function renderActionInputs(action, index) {
    if (action.type === 'navigate') {
        return `<input type="text" value="${escapeHtml(action.url)}" placeholder="URL" oninput="updateActionParam(${index}, 'url', this.value)">`;
    }
    if (action.type === 'click' || action.type === 'hover') {
        return `<input type="text" value="${escapeHtml(action.selector)}" placeholder="Selector" oninput="updateActionParam(${index}, 'selector', this.value)">`;
    }
    if (action.type === 'type') {
        return `
            <input type="text" value="${escapeHtml(action.selector)}" placeholder="Selector" oninput="updateActionParam(${index}, 'selector', this.value)">
            <input type="text" value="${escapeHtml(action.text)}" placeholder="Text" oninput="updateActionParam(${index}, 'text', this.value)">
        `;
    }
    if (action.type === 'pressKey') {
        return `<input type="text" value="${escapeHtml(action.key)}" placeholder="Key (e.g. Enter, Tab)" oninput="updateActionParam(${index}, 'key', this.value)">`;
    }
    if (action.type === 'wait') {
        return `<input type="number" value="${action.ms}" placeholder="ms" oninput="updateActionParam(${index}, 'ms', parseInt(this.value))">`;
    }
    if (action.type === 'scroll') {
        return `
            <input type="number" value="${action.x}" placeholder="X" oninput="updateActionParam(${index}, 'x', parseInt(this.value))">
            <input type="number" value="${action.y}" placeholder="Y" oninput="updateActionParam(${index}, 'y', parseInt(this.value))">
        `;
    }
    if (action.type === 'installExtension') {
        return `<input type="text" value="${escapeHtml(action.value)}" placeholder="Extension ID (e.g. nkbihfbeogaeaoehlefnkodbefgpgknn)" oninput="updateActionParam(${index}, 'value', this.value)">`;
    }
    return '';
}

function updateActionsJson() {
    document.getElementById('rpa-actions').value = JSON.stringify(rpaActions, null, 2);
}

// ===== Mouse Trail Preview Logic =====
let previewCanvas, previewCtx;
let lastPreviewX = 20, lastPreviewY = 120;

function initMousePreview() {
    previewCanvas = document.getElementById('mouse-preview-canvas');
    if (!previewCanvas) return;
    previewCtx = previewCanvas.getContext('2d');
    
    previewCanvas.onclick = () => {
        const targetX = Math.random() * 140 + 20;
        const targetY = Math.random() * 110 + 20;
        drawMouseTrail(lastPreviewX, lastPreviewY, targetX, targetY);
        lastPreviewX = targetX;
        lastPreviewY = targetY;
    };
    
    // Initial draw
    previewCtx.fillStyle = '#6366f1';
    previewCtx.beginPath();
    previewCtx.arc(lastPreviewX, lastPreviewY, 3, 0, Math.PI * 2);
    previewCtx.fill();
}

function drawMouseTrail(x1, y1, x2, y2) {
    const steps = 25;
    const cx = (x1 + x2) / 2 + (Math.random() * 60 - 30);
    const cy = (y1 + y2) / 2 + (Math.random() * 60 - 30);
    
    let step = 0;
    
    // Clear trail periodically but keep last position
    const animate = () => {
        if (step > steps) return;
        
        const t = step / steps;
        // Ease in out
        const et = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        
        const x = (1 - et) * (1 - et) * x1 + 2 * (1 - et) * et * cx + et * et * x2;
        const y = (1 - et) * (1 - et) * y1 + 2 * (1 - et) * et * cy + et * et * y2;
        
        // Draw dot
        previewCtx.fillStyle = `rgba(99, 102, 241, ${0.2 + (t * 0.8)})`;
        previewCtx.beginPath();
        previewCtx.arc(x, y, 1.5, 0, Math.PI * 2);
        previewCtx.fill();
        
        step++;
        setTimeout(animate, 20);
    };
    
    // Clear canvas with fade effect
    previewCtx.fillStyle = 'rgba(19, 19, 26, 0.3)';
    previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    
    animate();
}

// Call init in openCreateScenarioModal
const originalOpenCreateScenarioModal = openCreateScenarioModal;
openCreateScenarioModal = function() {
    originalOpenCreateScenarioModal();
    setTimeout(initMousePreview, 100);
};

function openCreateScenarioModal() {
    document.getElementById('rpa-name').value = '';
    document.getElementById('rpa-actions').value = '[]';
    rpaActions = [];
    renderActionBlocks();
    switchRPAMode('visual');
    
    // Populate profiles dropdown
    const select = document.getElementById('rpa-profile');
    select.innerHTML = `<option value="">${t('rpa.noProfileRun')}</option>` +
        allProfiles.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    
    openModal('rpa-modal');
}

async function saveScenario() {
    const name = document.getElementById('rpa-name').value.trim();
    const actionsText = document.getElementById('rpa-actions').value.trim();
    const profileId = document.getElementById('rpa-profile').value || null;

    if (!name || !actionsText) {
        showToast(t('msg.nameActionsRequired'), 'error');
        return;
    }

    try {
        const actions = JSON.parse(actionsText);
        const response = await fetch(`${API_URL}/v1.0/rpa/scenarios/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, actions, profile_id: profileId })
        });

        if (response.ok) {
            showToast(t('common.success'), 'success');
            closeModal('rpa-modal');
            loadScenarios();
        }
    } catch (error) {
        console.error('Save scenario error:', error);
        showToast(t('msg.invalidJson'), 'error');
    }
}

// ===== Modals =====
function openCreateModal() {
    // Reset form
    document.getElementById('profile-name').value = '';
    document.getElementById('profile-tags').value = '';
    document.getElementById('profile-notes').value = '';
    
    // Reset scroll
    const scrollContainer = document.getElementById('create-modal-scroll');
    if (scrollContainer) scrollContainer.scrollTop = 0;
    
    // Set active tab to basic
    scrollToSection('create', 'basic');
    
    // Load extensions and bookmarks for selection
    renderProfileTabLists('create');
    
    openModal('create-modal');
}

async function openEditModal(id) {
    const profileDataResponse = await fetch(`${API_URL}/v1.0/browser_profiles/${id}`);
    const profileData = await profileDataResponse.json();
    
    if (!profileData.success) return;
    
    const { profile, fingerprint } = profileData.data;
    
    document.getElementById('edit-profile-id').value = id;
    document.getElementById('edit-name').value = profile.name;
    document.getElementById('edit-status').value = profile.status || 'new';
    document.getElementById('edit-group').value = profile.group_id || '';
    document.getElementById('edit-tags').value = profile.tags || '';
    document.getElementById('edit-notes').value = profile.notes || '';
    
    // Update proxy select
    updateProxySelects();
    document.getElementById('edit-proxy').value = profile.proxy_id || '';
    
    // Fingerprint fields
    if (fingerprint) {
        document.getElementById('edit-screen-resolution').value = `${fingerprint.screen_width}x${fingerprint.screen_height}`;
        document.getElementById('edit-browser-language').value = fingerprint.language || 'en-US';
        document.getElementById('edit-webrtc-mode').value = fingerprint.webrtc_mode || 'altered';
        document.getElementById('edit-canvas-mode').value = fingerprint.canvas_mode || 'noise';
        document.getElementById('edit-webgl-mode').value = fingerprint.webgl_mode || 'noise';
        document.getElementById('edit-audio-mode').value = fingerprint.audio_mode || 'noise';
        document.getElementById('edit-client-rects-mode').value = fingerprint.client_rects_mode || 'noise';
        document.getElementById('edit-cpu-cores').value = fingerprint.hardware_concurrency || '4';
        document.getElementById('edit-device-memory').value = fingerprint.device_memory || '8';
        document.getElementById('edit-webgl-vendor').value = fingerprint.webgl_vendor || '';
        document.getElementById('edit-webgl-renderer').value = fingerprint.webgl_renderer || '';
        
        // Ultra Stealth toggles
        document.getElementById('edit-battery-spoofing').checked = fingerprint.battery_spoofing !== 0;
        document.getElementById('edit-v8-break-iterator').checked = fingerprint.v8_break_iterator !== 0;
        document.getElementById('edit-chrome-spoofing').checked = fingerprint.chrome_object_spoofing !== 0;
        document.getElementById('edit-perf-jitter').checked = fingerprint.perf_jitter !== 0;
    }

    // Advanced fields
    document.getElementById('edit-start-urls').value = profile.start_urls || '';
    document.getElementById('edit-launch-args').value = profile.launch_args || '';
    document.getElementById('edit-restore-tabs').checked = !!profile.restore_tabs;
    
    // Reset scroll
    const scrollContainer = document.getElementById('edit-modal-scroll');
    if (scrollContainer) scrollContainer.scrollTop = 0;
    
    // Set active tab to basic
    scrollToSection('edit', 'basic');

    // Load extensions and bookmarks for selection
    await renderProfileTabLists('edit', id);
    
    openModal('edit-modal');
}

async function renderProfileTabLists(mode, profileId = null) {
    const extList = document.getElementById(mode === 'edit' ? 'edit-profile-extensions-list' : 'profile-extensions-list');
    const bmList = document.getElementById(mode === 'edit' ? 'edit-profile-bookmarks-list' : 'profile-bookmarks-list');
    
    if (!extList || !bmList) return;
    
    // Get all extensions and bookmarks
    await Promise.all([loadExtensions(), loadBookmarks()]);
    
    let assignedExtensions = new Set();
    let assignedBookmarks = new Set();
    if (profileId) {
        try {
            const extRes = await fetch(`${API_URL}/v1.0/browser_profiles/${profileId}/extensions`);
            const extData = await extRes.json();
            if (extData.success) extData.data.forEach(ext => assignedExtensions.add(ext.id));

            const bmRes = await fetch(`${API_URL}/v1.0/browser_profiles/${profileId}/bookmarks`);
            const bmData = await bmRes.json();
            if (bmData.success) bmData.data.forEach(bm => assignedBookmarks.add(bm.id));
        } catch (e) {
            console.error('Failed to load profile assets:', e);
        }
    }
    
    extList.innerHTML = allExtensions.length === 0 ? `<p class="text-muted">${t('extensions.none_available')}</p>` : allExtensions.map(ext => `
        <label class="checkbox-label">
            <input type="checkbox" name="profile-extension" value="${ext.id}" ${assignedExtensions.has(ext.id) ? 'checked' : ''}>
            <span>${escapeHtml(ext.name)}</span>
        </label>
    `).join('');
    
    bmList.innerHTML = allBookmarks.length === 0 ? `<p class="text-muted">${t('bookmarks.none_available')}</p>` : allBookmarks.map(bm => `
        <div class="bookmark-select-item">
            <label class="checkbox-label">
                <input type="checkbox" name="profile-bookmark" value="${bm.id}" ${assignedBookmarks.has(bm.id) ? 'checked' : ''}>
                <span>${escapeHtml(bm.name)} (${escapeHtml(bm.url)})</span>
            </label>
        </div>
    `).join('');
}

function switchEditFormTab(tab) {
    scrollToSection('edit', tab);
}

// ===== Form Tabs =====
function switchFormTab(tab) {
    scrollToSection('create', tab);
}

// Add scroll listener to update active tab on manual scroll
document.addEventListener('DOMContentLoaded', () => {
    ['create', 'edit'].forEach(prefix => {
        const scrollContainer = document.getElementById(`${prefix}-modal-scroll`);
        if (!scrollContainer) return;
        
        scrollContainer.addEventListener('scroll', () => {
            const sections = scrollContainer.querySelectorAll('.form-section');
            let currentSectionId = '';
            
            sections.forEach(section => {
                const sectionTop = section.offsetTop - scrollContainer.offsetTop;
                if (scrollContainer.scrollTop >= sectionTop - 100) {
                    currentSectionId = section.id.replace(`${prefix}-section-`, '');
                }
            });
            
            if (currentSectionId) {
                const modal = document.getElementById(`${prefix}-modal`);
                modal.querySelectorAll('.form-tab').forEach(t => {
                    const isTarget = t.getAttribute('onclick').includes(`'${currentSectionId}'`);
                    t.classList.toggle('active', isTarget);
                });
            }
        });
    });
});

// ===== Bulk Create =====
async function openBulkCreateModal() {
    openModal('bulk-create-modal');
    
    document.getElementById('bulk-count').value = 10;
    document.getElementById('bulk-name-prefix').value = 'Profile';
    document.getElementById('bulk-os').value = '';
    document.getElementById('bulk-group').value = '';
    document.getElementById('bulk-proxy-mode').value = 'none';
    document.getElementById('bulk-specific-proxy-container').style.display = 'none';
    document.getElementById('bulk-proxy-group-container').style.display = 'none';
    document.getElementById('bulk-fp-mode').value = 'random';
    document.getElementById('bulk-custom-fp').style.display = 'none';
    
    // Reset tabs
    scrollToSection('bulk', 'basic');

    // Populate group select
    const groupSelect = document.getElementById('bulk-group');
    groupSelect.innerHTML = `<option value="">${t('common.noGroup') || 'None'}</option>` +
        allGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
        
    // Populate proxy select
    const proxySelect = document.getElementById('bulk-specific-proxy');
    proxySelect.innerHTML = allProxies.map(p => `<option value="${p.id}">${p.name} (${p.host}:${p.port})</option>`).join('');

    // Populate Proxy Groups
    const proxyGroupSelect = document.getElementById('bulk-proxy-group');
    if (proxyGroupSelect) {
        // We don't have explicit proxy groups yet, but we can use the same groups as profiles for now
        // OR we should check if there's a separate proxy group entity. 
        // Based on LS, there is a group-manager.ts. Let's check if it handles proxy groups too.
        proxyGroupSelect.innerHTML = `<option value="">${t('common.noGroup')}</option>` + 
            allGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    }

    // Proxy Mode Change listener
    const bulkProxyMode = document.getElementById('bulk-proxy-mode');
    bulkProxyMode.onchange = () => {
        const val = bulkProxyMode.value;
        document.getElementById('bulk-specific-proxy-container').style.display = val === 'specific' ? 'block' : 'none';
        document.getElementById('bulk-proxy-group-container').style.display = val === 'group' ? 'block' : 'none';
    };

    // Populate Extensions list
    const extList = document.getElementById('bulk-extensions-list');
    if (extList) {
        if (allExtensions.length === 0) await loadExtensions();
        extList.innerHTML = allExtensions.map(ext => `
            <label class="checkbox-label">
                <input type="checkbox" name="bulk-extension" value="${ext.id}">
                <span>${escapeHtml(ext.name)}</span>
            </label>
        `).join('');
    }

    // Populate Bookmarks list
    const bmList = document.getElementById('bulk-bookmarks-list');
    if (bmList) {
        if (allBookmarks.length === 0) await loadBookmarks();
        bmList.innerHTML = allBookmarks.map(bm => `
            <label class="checkbox-label">
                <input type="checkbox" name="bulk-bookmark" value="${bm.id}">
                <span>${escapeHtml(bm.name)}</span>
            </label>
        `).join('');
    }

    openModal('bulk-create-modal');
}

async function executeBulkCreate() {
    const count = parseInt(document.getElementById('bulk-count').value);
    const namePrefix = document.getElementById('bulk-name-prefix').value.trim();
    const osType = document.getElementById('bulk-os').value;
    const template = osType ? `${osType}_chrome` : undefined;
    const groupId = document.getElementById('bulk-group').value || null;
    const proxyMode = document.getElementById('bulk-proxy-mode').value;
    const proxyGroupId = document.getElementById('bulk-proxy-group').value || null;
    const onlyFree = document.getElementById('bulk-proxy-only-free').checked;
    const allowReuse = document.getElementById('bulk-proxy-allow-reuse').checked;
    const fpMode = document.getElementById('bulk-fp-mode').value;
    
    if (isNaN(count) || count < 1 || count > 1000) {
        showToast('Please enter a valid count between 1 and 1000', 'warning');
        return;
    }

    let proxyIds = [];
    if (proxyMode === 'round-robin') {
        proxyIds = allProxies.map(p => p.id);
        if (proxyIds.length === 0) {
            showToast('No proxies available for Round Robin mode', 'warning');
            return;
        }
    } else if (proxyMode === 'specific') {
        const proxy_id = document.getElementById('bulk-specific-proxy').value;
        if (!proxy_id) {
            showToast('Please select a proxy', 'warning');
            return;
        }
        proxyIds = [proxy_id];
    } else if (proxyMode === 'group') {
        if (!proxyGroupId) {
            showToast('Please select a proxy group', 'warning');
            return;
        }
        // This will be handled on backend by filtering by group_id
        proxyIds = ['__group__' + proxyGroupId]; 
    }

    // Frozen Fingerprint config if selected
    let fingerprintConfig = undefined;
    if (fpMode === 'frozen') {
        const [width, height] = document.getElementById('bulk-screen-resolution').value.split('x').map(Number);
        fingerprintConfig = {
            screen: { width, height, availWidth: width, availHeight: height - 40 },
            languages: { language: document.getElementById('bulk-language').value },
            navigator: {
                hardwareConcurrency: parseInt(document.getElementById('bulk-cpu-cores').value),
                deviceMemory: parseInt(document.getElementById('bulk-device-memory').value)
            }
        };
    }

    // Collect extensions and bookmarks
    const selectedExts = Array.from(document.querySelectorAll('input[name="bulk-extension"]:checked')).map(cb => cb.value);
    const selectedBms = Array.from(document.querySelectorAll('input[name="bulk-bookmark"]:checked')).map(cb => cb.value);

    closeModal('bulk-create-modal');
    showLoading(`Creating ${count} profiles... Please wait.`);

    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/bulk/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                count,
                name_prefix: namePrefix,
                template,
                proxy_ids: proxyIds,
                group_id: groupId,
                options: {
                    fingerprintConfig,
                    extensionIds: selectedExts,
                    bookmarkIds: selectedBms,
                    proxyOptions: {
                        onlyFree,
                        allowReuse
                    }
                }
            })
        });

        const data = await response.json();
        if (data.success) {
            showToast(`Successfully created ${data.data.success} profiles`, 'success');
            loadProfiles();
        } else {
            showToast(data.error || 'Failed to create profiles', 'error');
        }
    } catch (error) {
        showToast('Error connecting to server', 'error');
    } finally {
        hideLoading();
    }
}

// ===== Create Profile =====
async function createProfile() {
    const name = document.getElementById('profile-name').value.trim();
    if (!name) {
        showToast(t('msg.profileNameRequired'), 'error');
        return;
    }
    
    showLoading(t('msg.creatingProfile') || 'Creating profile...');
    const [width, height] = document.getElementById('screen-resolution').value.split('x').map(Number);

    const data = {
        name,
        os_type: document.getElementById('os-type').value,
        browser_type: document.getElementById('browser-type').value,
        group_id: document.getElementById('profile-group').value || null,
        tags: document.getElementById('profile-tags').value,
        notes: document.getElementById('profile-notes').value,
        proxy_id: document.getElementById('profile-proxy').value || null,
        start_urls: document.getElementById('start-urls').value,
        launch_args: document.getElementById('launch-args').value,
        restore_tabs: document.getElementById('restore-tabs').checked,
        fingerprint_config: {
            screen: { width, height, availWidth: width, availHeight: height - 40 },
            languages: { language: document.getElementById('browser-language').value },
            canvas: { mode: document.getElementById('canvas-mode').value },
            webgl: { 
                mode: document.getElementById('webgl-mode').value,
                vendor: document.getElementById('webgl-vendor').value || undefined,
                renderer: document.getElementById('webgl-renderer').value || undefined
            },
            audio: { mode: document.getElementById('audio-mode').value },
            clientRects: { mode: document.getElementById('client-rects-mode').value },
            navigator: { 
                hardwareConcurrency: parseInt(document.getElementById('cpu-cores').value),
                deviceMemory: parseInt(document.getElementById('device-memory').value)
            },
            webrtc: { mode: document.getElementById('webrtc-mode').value },
            ultraStealth: {
                battery: document.getElementById('battery-spoofing').checked,
                v8BreakIterator: document.getElementById('v8-break-iterator').checked,
                chromeObject: document.getElementById('chrome-spoofing').checked,
                perfJitter: document.getElementById('perf-jitter').checked
            }
        }
    };
    
    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            const result = await response.json();
            const profileId = result.data.id;
            
            // Assign selected extensions
            const extensionCheckboxes = document.querySelectorAll('#create-modal input[name="profile-extension"]:checked');
            for (const cb of extensionCheckboxes) {
                await fetch(`${API_URL}/v1.0/browser_profiles/${profileId}/extensions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ extension_id: cb.value })
                });
            }

            // Assign selected bookmarks
            const bookmarkCheckboxes = document.querySelectorAll('#create-modal input[name="profile-bookmark"]:checked');
            for (const cb of bookmarkCheckboxes) {
                await fetch(`${API_URL}/v1.0/browser_profiles/${profileId}/bookmarks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bookmark_id: cb.value })
                });
            }

            showToast(t('profiles.created'), 'success');
            closeModal('create-modal');
            loadProfiles();
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    } finally {
        hideLoading();
    }
}

async function createRandomProfile() {
    showLoading(t('msg.creatingProfile') || 'Creating profile...');
    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/create-unique`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}) // Ensure body is sent even if empty
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            showToast(t('profiles.created'), 'success');
            closeModal('create-modal');
            loadProfiles();
        } else {
            showToast(data.error || t('common.error'), 'error');
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    } finally {
        hideLoading();
    }
}



// ===== Save Profile =====
async function saveProfile() {
    const id = document.getElementById('edit-profile-id').value;
    const [width, height] = document.getElementById('edit-screen-resolution').value.split('x').map(Number);
    
    const data = {
        name: document.getElementById('edit-name').value,
        status: document.getElementById('edit-status').value,
        group_id: document.getElementById('edit-group').value || null,
        proxy_id: document.getElementById('edit-proxy').value || null,
        tags: document.getElementById('edit-tags').value,
        notes: document.getElementById('edit-notes').value,
        start_urls: document.getElementById('edit-start-urls').value,
        launch_args: document.getElementById('edit-launch-args').value,
        restore_tabs: document.getElementById('edit-restore-tabs').checked
    };

    const fingerprintData = {
        screen: { width, height, availWidth: width, availHeight: height - 40 },
        languages: { language: document.getElementById('edit-browser-language').value },
        canvas: { mode: document.getElementById('edit-canvas-mode').value },
        webgl: { 
            mode: document.getElementById('edit-webgl-mode').value,
            vendor: document.getElementById('edit-webgl-vendor').value || undefined,
            renderer: document.getElementById('edit-webgl-renderer').value || undefined
        },
        audio: { mode: document.getElementById('edit-audio-mode').value },
        clientRects: { mode: document.getElementById('edit-client-rects-mode').value },
        navigator: { 
            hardwareConcurrency: parseInt(document.getElementById('edit-cpu-cores').value),
            deviceMemory: parseInt(document.getElementById('edit-device-memory').value)
        },
        webrtc: { mode: document.getElementById('edit-webrtc-mode').value },
        ultraStealth: {
            battery: document.getElementById('edit-battery-spoofing').checked,
            v8BreakIterator: document.getElementById('edit-v8-break-iterator').checked,
            chromeObject: document.getElementById('edit-chrome-spoofing').checked,
            perfJitter: document.getElementById('edit-perf-jitter').checked
        }
    };
    
    try {
        // Save profile basic info
        await fetch(`${API_URL}/v1.0/browser_profiles/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        // Save fingerprint info
        await fetch(`${API_URL}/v1.0/browser_profiles/${id}/fingerprint`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fingerprintData)
        });
        
        // Update assigned extensions
        // Simplest way: remove all and re-add selected
        const currentExtensionsRes = await fetch(`${API_URL}/v1.0/browser_profiles/${id}/extensions`);
        const currentExtensionsData = await currentExtensionsRes.json();
        if (currentExtensionsData.success) {
            for (const ext of currentExtensionsData.data) {
                await fetch(`${API_URL}/v1.0/browser_profiles/${id}/extensions/${ext.id}`, { method: 'DELETE' });
            }
        }

        const extensionCheckboxes = document.querySelectorAll('#edit-modal input[name="profile-extension"]:checked');
        for (const cb of extensionCheckboxes) {
            await fetch(`${API_URL}/v1.0/browser_profiles/${id}/extensions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ extension_id: cb.value })
            });
        }

        // Update assigned bookmarks
        const currentBookmarksRes = await fetch(`${API_URL}/v1.0/browser_profiles/${id}/bookmarks`);
        const currentBookmarksData = await currentBookmarksRes.json();
        if (currentBookmarksData.success) {
            for (const bm of currentBookmarksData.data) {
                await fetch(`${API_URL}/v1.0/browser_profiles/${id}/bookmarks/${bm.id}`, { method: 'DELETE' });
            }
        }

        const bookmarkCheckboxes = document.querySelectorAll('#edit-modal input[name="profile-bookmark"]:checked');
        for (const cb of bookmarkCheckboxes) {
            await fetch(`${API_URL}/v1.0/browser_profiles/${id}/bookmarks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookmark_id: cb.value })
            });
        }
        
        showToast(t('profiles.updated'), 'success');
        closeModal('edit-modal');
        loadProfiles();
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

// ===== Save Proxy =====
async function saveProxy() {
    const data = {
        name: document.getElementById('proxy-name').value,
        protocol: document.getElementById('proxy-type').value,
        host: document.getElementById('proxy-host').value,
        port: parseInt(document.getElementById('proxy-port').value),
        username: document.getElementById('proxy-username').value || null,
        password: document.getElementById('proxy-password').value || null,
        group_id: document.getElementById('proxy-group').value || null
    };
    
    if (!data.name || !data.host || !data.port) {
        showToast(t('msg.hostPortRequired'), 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/v1.0/proxies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast(t('proxies.added'), 'success');
            closeModal('proxy-modal');
            loadProxies();
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

// ===== Import =====
function openImportModal() {
    openModal('import-modal');
}

async function importProfiles() {
    const fileInput = document.getElementById('import-file');
    const format = document.getElementById('import-format').value;
    
    if (!fileInput.files || !fileInput.files[0]) {
        showToast(t('msg.selectFile'), 'error');
        return;
    }
    
    try {
        const text = await fileInput.files[0].text();
        const profiles = JSON.parse(text);
        
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profiles, format: format === 'auto' ? undefined : format })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`${t('profiles.import')}: ${data.data.imported}`, 'success');
            closeModal('import-modal');
            loadProfiles();
        }
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

// ===== Missing UI Modals =====
function openBulkProxyModal() {
    document.getElementById('bulk-proxies-input').value = '';
    openModal('bulk-proxy-modal');
}

async function importBulkProxies() {
    const proxies_text = document.getElementById('bulk-proxies-input').value.trim();
    const default_protocol = document.getElementById('bulk-proxy-protocol').value;
    const resultsArea = document.getElementById('bulk-proxy-results');
    
    if (!proxies_text) {
        showToast(t('msg.enterProxies'), 'warning');
        return;
    }
    
    showToast(t('msg.importingProxies'), 'info');
    
    try {
        const response = await fetch(`${API_URL}/v1.0/proxies/bulk/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxies_text, default_protocol })
        });
        
        const data = await response.json();
        if (data.success) {
            const { success, failed, errors } = data.data;
            showToast(`${t('profiles.import')}: ${success}`, 'success');
            
            if (failed > 0) {
                resultsArea.style.display = 'block';
                resultsArea.innerHTML = `
                    <div class="results-summary error">
                        <strong>${t('proxies.bulkImportFailed', { count: failed })}</strong>
                        <ul>
                            ${errors.map(err => `<li>${t('proxies.line')} ${err.line}: ${escapeHtml(err.proxy)} - ${err.error}</li>`).join('')}
                        </ul>
                    </div>
                `;
            } else {
                resultsArea.style.display = 'none';
                closeModal('bulk-proxy-modal');
            }
            
            loadProxies();
        } else {
            showToast(data.error || t('msg.importProxyFailed'), 'error');
        }
    } catch (error) {
        showToast(t('msg.importProxyError'), 'error');
    }
}

function openAddExtensionModal() {
    document.getElementById('extension-name-input').value = '';
    document.getElementById('extension-path-input').value = '';
    openModal('extension-modal');
}

async function saveExtensionRobust() {
    const name = document.getElementById('extension-name-input').value.trim();
    const path = document.getElementById('extension-path-input').value.trim();
    const resultsArea = document.getElementById('extension-modal-results');
    
    if (!name || !path) {
        showToast(t('msg.namePathRequired'), 'warning');
        return;
    }
    
    resultsArea.style.display = 'none';
    showToast(t('msg.savingExtension'), 'info');
    
    try {
        const response = await fetch(`${API_URL}/v1.0/extensions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, path, is_default: true })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(t('msg.extensionAdded'), 'success');
            closeModal('extension-modal');
            loadExtensions();
        } else {
            resultsArea.style.display = 'block';
            resultsArea.innerHTML = `<div class="results-summary error"><strong>${t('common.error')}:</strong> ${escapeHtml(data.error || t('extensions.add_failed'))}</div>`;
            showToast(t('extensions.add_failed'), 'error');
        }
    } catch (e) {
        resultsArea.style.display = 'block';
        resultsArea.innerHTML = `<div class="results-summary error"><strong>${t('common.error')}:</strong> ${escapeHtml(e.message)}</div>`;
        showToast(t('extensions.add_failed'), 'error');
    }
}

function openAddBookmarkModal() {
    document.getElementById('bookmark-name-input').value = '';
    document.getElementById('bookmark-url-input').value = '';
    openModal('bookmark-modal');
}

async function saveBookmarkRobust() {
    const name = document.getElementById('bookmark-name-input').value.trim();
    const url = document.getElementById('bookmark-url-input').value.trim();
    const resultsArea = document.getElementById('bookmark-modal-results');
    
    if (!name || !url) {
        showToast(t('msg.nameUrlRequired'), 'warning');
        return;
    }
    
    resultsArea.style.display = 'none';
    showToast(t('msg.savingBookmark'), 'info');
    
    try {
        const response = await fetch(`${API_URL}/v1.0/bookmarks/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookmarks: [{ name, url }] })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            showToast(t('msg.bookmarkAdded'), 'success');
            closeModal('bookmark-modal');
            loadBookmarks();
        } else {
            resultsArea.style.display = 'block';
            resultsArea.innerHTML = `<div class="results-summary error"><strong>${t('common.error')}:</strong> ${escapeHtml(data.error || t('bookmarks.add_failed'))}</div>`;
            showToast(t('bookmarks.add_failed'), 'error');
        }
    } catch (e) {
        resultsArea.style.display = 'block';
        resultsArea.innerHTML = `<div class="results-summary error"><strong>${t('common.error')}:</strong> ${escapeHtml(e.message)}</div>`;
        showToast(t('bookmarks.add_failed'), 'error');
    }
}

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    
    const icons = {
        success: 'check-circle',
        error: 'x-circle',
        warning: 'alert-triangle',
        info: 'info'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i data-lucide="${icons[type]}" class="toast-icon"></i>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== Utilities =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return t('common.never');
    
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return t('time.justNow');
    if (minutes < 60) return t('time.minutesAgo', { n: minutes });
    if (hours < 24) return t('time.hoursAgo', { n: hours });
    return t('time.daysAgo', { n: days });
}

// ===== Security Section =====
async function updateSecurityUI() {
    try {
        const response = await fetch(`${API_URL}/v1.0/auth/state`);
        const result = await response.json();
        if (result.success) {
            const state = result.data;
            const badge = document.getElementById('2fa-status-badge');
            const btn = document.getElementById('btn-toggle-2fa');
            
            if (state.isTotpEnabled) {
                badge.textContent = 'Enabled';
                badge.className = 'status-badge active';
                btn.textContent = 'Disable 2FA';
                btn.className = 'btn btn-danger';
                btn.onclick = () => disable2FA();
            } else {
                badge.textContent = 'Disabled';
                badge.className = 'status-badge';
                btn.textContent = 'Enable 2FA';
                btn.className = 'btn btn-secondary';
                btn.onclick = () => start2FASetup();
            }
        }
    } catch (e) {
        console.error('Failed to update security UI:', e);
    }
}

async function changeMasterPassword() {
    const oldPassword = document.getElementById('sec-old-password').value;
    const newPassword = document.getElementById('sec-new-password').value;
    const confirm = document.getElementById('sec-confirm-password').value;

    if (!oldPassword || !newPassword) {
        showToast('Please fill all password fields', 'warning');
        return;
    }

    if (newPassword.length < 8) {
        showToast('New password must be at least 8 characters', 'warning');
        return;
    }

    if (newPassword !== confirm) {
        showToast(t('auth.passwordsDontMatch'), 'error');
        return;
    }

    showLoading('Updating security...', 'Re-encrypting all your data with new password...');
    try {
        const response = await fetch(`${API_URL}/v1.0/auth/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPassword, newPassword })
        });
        const result = await response.json();

        if (result.success) {
            showToast('Master password updated successfully', 'success');
            document.getElementById('sec-old-password').value = '';
            document.getElementById('sec-new-password').value = '';
            document.getElementById('sec-confirm-password').value = '';
        } else {
            showToast(result.error || 'Failed to change password', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    } finally {
        hideLoading();
    }
}

async function start2FASetup() {
    try {
        const response = await fetch(`${API_URL}/v1.0/auth/totp/generate`);
        const result = await response.json();
        if (result.success) {
            const { secret, otpauth } = result.data;
            document.getElementById('2fa-secret-text').textContent = secret;
            
            // Generate QR code using Google Charts API for easy integration
            const qrUrl = `https://chart.googleapis.com/chart?chs=160x160&cht=qr&chl=${encodeURIComponent(otpauth)}&choe=UTF-8`;
            document.getElementById('2fa-qr-placeholder').innerHTML = `
                <img src="${qrUrl}" alt="QR Code" style="width: 100%; height: 100%; display: block;">
            `;
            
            document.getElementById('2fa-setup-area').style.display = 'block';
            document.getElementById('2fa-setup-code').value = '';
            window.pendingTotpSecret = secret;
        }
    } catch (e) {
        showToast('Failed to start 2FA setup', 'error');
    }
}

async function enable2FA() {
    const token = document.getElementById('2fa-setup-code').value;
    const secret = window.pendingTotpSecret;

    if (!token || token.length !== 6) {
        showToast('Enter a valid 6-digit code', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/v1.0/auth/totp/enable`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret, token })
        });
        const result = await response.json();

        if (result.success) {
            showToast('Two-Factor Authentication enabled', 'success');
            document.getElementById('2fa-setup-area').style.display = 'none';
            updateSecurityUI();
        } else {
            showToast(result.error || 'Invalid code', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

async function disable2FA() {
    const password = prompt('Enter your master password to disable 2FA:');
    if (!password) return;

    try {
        const response = await fetch(`${API_URL}/v1.0/auth/totp/disable`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const result = await response.json();

        if (result.success) {
            showToast('2FA disabled', 'info');
            updateSecurityUI();
        } else {
            showToast(result.error || 'Failed to disable 2FA', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

// Update original switchSection to include Security
const oldSwitchSection = switchSection;
switchSection = function(section) {
    oldSwitchSection(section);
    if (section === 'security') updateSecurityUI();
};

function searchProxies(query) {
    const rows = document.querySelectorAll('#proxies-tbody tr[data-id]');
    const q = query.toLowerCase();
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(q) ? '' : 'none';
    });
}



async function testProxyById(id) {
    const row = document.querySelector(`#proxies-tbody tr[data-id="${id}"]`);
    const statusCell = row?.querySelector('.proxy-status-cell');
    
    if (statusCell) {
        statusCell.innerHTML = `<span class="status-badge warning"><i data-lucide="loader" class="spin"></i> ${t('proxies.testing')}</span>`;
        lucide.createIcons();
    }
    
    try {
        const response = await fetch(`${API_URL}/v1.0/proxies/${id}/check`);
        const data = await response.json();
        
        if (data.success && data.data) {
            const isWorking = data.data.working;
            if (statusCell) {
                if (isWorking) {
                    const country = data.data.country || '';
                    statusCell.innerHTML = `<span class="status-badge active">${t('proxies.working')} ${country}</span>`;
                    
                    // Update country in table if it was missing
                    if (country) {
                        const countryCell = row.querySelector('td:nth-child(6)');
                        if (countryCell) countryCell.textContent = country;
                    }
                } else {
                    statusCell.innerHTML = `<span class="status-badge banned">${t('proxies.failed')}</span>`;
                }
            }
        } else {
            if (statusCell) {
                statusCell.innerHTML = `<span class="status-badge banned">${t('proxies.failed')}</span>`;
            }
        }
    } catch (error) {
        console.error('Proxy test error:', error);
        if (statusCell) {
            statusCell.innerHTML = `<span class="status-badge banned">${t('proxies.failed')}</span>`;
        }
    }
}

async function testProxy() {
    const data = {
        protocol: document.getElementById('proxy-type').value,
        host: document.getElementById('proxy-host').value,
        port: parseInt(document.getElementById('proxy-port').value),
        username: document.getElementById('proxy-username').value || null,
        password: document.getElementById('proxy-password').value || null
    };
    
    if (!data.host || !data.port) {
        showToast(t('msg.hostPortRequired'), 'warning');
        return;
    }
    
    showToast(t('proxies.testing'), 'info');
    try {
        const response = await fetch(`${API_URL}/v1.0/proxies/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        
        if (result.success && result.data.working) {
            showToast(`${t('proxies.working')}: ${result.data.country || t('common.unknown')}`, 'success');
        } else {
            showToast(t('msg.proxyCheckFailed'), 'error');
        }
    } catch (error) {
        showToast(t('msg.proxyCheckError'), 'error');
    }
}

async function deleteExtension(id) {
    if (!confirm(t('confirm.deleteExtension'))) return;
    try {
        await fetch(`${API_URL}/v1.0/extensions/${id}`, { method: 'DELETE' });
        loadExtensions();
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

async function deleteBookmark(id) {
    if (!confirm(t('confirm.deleteBookmark'))) return;
    try {
        await fetch(`${API_URL}/v1.0/bookmarks/${id}`, { method: 'DELETE' });
        loadBookmarks();
    } catch (error) {
        showToast(t('common.error'), 'error');
    }
}

// ===== Jarvis AI Logic =====
let jarvisHistory = [];
let jarvisConfig = null;
let currentJarvisSessionId = null;
let jarvisAttachedFiles = [];

function updateJarvisStatus(connected) {
    const statusCard = document.getElementById('jarvis-ai-status');
    if (!statusCard) return;
    
    const dot = statusCard.querySelector('.status-dot');
    const text = statusCard.querySelector('.status-text');
    
    if (connected) {
        statusCard.classList.add('connected');
        statusCard.classList.remove('disconnected');
        if (dot) dot.className = 'status-dot active';
        
        let providerName = 'AI';
        if (jarvisConfig && jarvisConfig.provider) {
            const p = jarvisConfig.provider;
            providerName = p === 'droidgravity' ? 'DroidGravity' : (p === 'openai' ? 'OpenAI' : 'OpenRouter');
        }
        
        if (text) text.textContent = `${t('jarvis.connected')} (${providerName})`;
    } else {
        statusCard.classList.add('disconnected');
        statusCard.classList.remove('connected');
        if (dot) dot.className = 'status-dot';
        if (text) text.textContent = t('jarvis.disconnected');
    }
}

async function loadJarvisConfig() {
    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/config`);
        const data = await response.json();
        if (data.success) {
            jarvisConfig = data.data;
            updateJarvisStatus(true);
            
            // Update permission level display
            const permText = document.getElementById('jarvis-permission-text');
            if (permText && jarvisConfig.permission_level) {
                const level = jarvisConfig.permission_level;
                permText.textContent = level.charAt(0).toUpperCase() + level.slice(1);
                
                // Color coding based on level
                const badge = document.getElementById('jarvis-permission-display');
                if (badge) {
                    if (level === 'admin') badge.style.color = '#ef4444'; // Red
                    else if (level === 'standard') badge.style.color = '#3b82f6'; // Blue
                    else badge.style.color = '#9ca3af'; // Gray
                }
            }
        } else {
            updateJarvisStatus(false);
        }
    } catch (e) {
        updateJarvisStatus(false);
    }
}

async function loadJarvisHistory() {
    try {
        // Load sessions
        const sessionRes = await fetch(`${API_URL}/v1.0/jarvis/sessions`);
        const sessionData = await sessionRes.json();
        
        // Refresh task status bar as well
        refreshJarvisTaskStatusBar();
        
        const container = document.getElementById('jarvis-history-items');
        if (!container) return;

        let html = '';
        
        if (sessionData.success && sessionData.data.length > 0) {
            html += `<div class="history-group-title">${t('jarvis.recentChats') || 'Recent Chats'}</div>`;
            html += sessionData.data.slice(0, 10).map(session => `
                <div class="jarvis-history-item ${currentJarvisSessionId === session.id ? 'active' : ''}" onclick="switchJarvisSession('${session.id}')">
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
                        <i data-lucide="message-square" style="width:12px;height:12px; flex-shrink: 0;"></i>
                        <span class="item-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(session.title || 'Untitled Session')}</span>
                    </div>
                    <button class="btn-ghost btn-sm" onclick="event.stopPropagation(); deleteJarvisSession('${session.id}')" title="Delete">
                        <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                    </button>
                </div>
            `).join('');
        }

        // Tasks now handled by status bar, but keeping list in history too for full view
        const taskRes = await fetch(`${API_URL}/v1.0/jarvis/tasks`);
        const taskData = await taskRes.json();
        if (taskData.success && taskData.data.length > 0) {
            html += `<div class="history-group-title" style="margin-top:10px;">${t('jarvis.recentTasks') || 'Recent Tasks'}</div>`;
            html += taskData.data.slice(0, 5).map(task => `
                <div class="jarvis-history-item" onclick="showJarvisTaskLogs('${task.id}')">
                    <i data-lucide="zap" style="width:12px;height:12px;"></i>
                    <span class="item-title">${escapeHtml(task.name)}</span>
                    <span class="item-date">${task.status}</span>
                </div>
            `).join('');
        }

        if (!html) {
            html = `<div class="empty-state" style="padding: 10px; font-size: 12px;">${t('jarvis.noHistory')}</div>`;
        }
        
        container.innerHTML = html;
        lucide.createIcons();
    } catch (e) {
        console.error('Failed to load Jarvis history:', e);
    }
}

async function refreshJarvisTaskStatusBar() {
    const bar = document.getElementById('jarvis-task-status-bar');
    if (!bar) return;

    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/tasks`);
        const data = await response.json();

        if (data.success) {
            let html = `
                <div class="jarvis-task-pill" onclick="openJarvisConfig()" style="border-color: var(--primary); background: rgba(59, 130, 246, 0.1); flex-shrink: 0;">
                    <i data-lucide="settings" style="width: 14px; height: 14px;"></i>
                    <span data-i18n="jarvis.connectBtn">Connect</span>
                </div>
                <div style="width: 1px; height: 20px; background: var(--border-color); margin: 0 5px; flex-shrink: 0;"></div>
            `;

            if (data.data.length === 0) {
                html += `<div style="color: var(--text-muted); font-size: 11px; padding-left: 10px;">${t('jarvis.noActiveTasks') || 'No active tasks'}</div>`;
                bar.innerHTML = html;
            } else {
                html += data.data.map(task => {
                    let statusClass = 'status-pending';
                    if (task.status === 'running') statusClass = 'status-running';
                    if (task.status === 'failed') statusClass = 'status-failed';
                    if (task.status === 'completed') statusClass = 'status-completed';

                    return `
                        <div class="jarvis-task-pill ${statusClass}" onclick="showJarvisTaskLogs('${task.id}')">
                            <div class="task-dot"></div>
                            <span>${escapeHtml(task.name)}</span>
                        </div>
                    `;
                }).join('');
                bar.innerHTML = html;
            }
            
            applyTranslations(); // Translate the "Connect" button
            lucide.createIcons();
        }
    } catch (e) {
        console.error('Failed to refresh tasks:', e);
    }
}

// Auto-refresh tasks every 5 seconds if in Jarvis section
setInterval(() => {
    if (currentSection === 'jarvis') {
        refreshJarvisTaskStatusBar();
    }
}, 5000);

async function showJarvisTaskLogs(taskId) {
    currentTaskLogsId = taskId;
    const titleEl = document.getElementById('jarvis-logs-title');
    if (titleEl) titleEl.textContent = t('jarvis.logsTitle', { taskId }) || 'Task Logs: ' + taskId;
    
    const container = document.getElementById('jarvis-task-logs-container');
    if (container) {
        container.innerHTML = `<div class="loading-state" style="display: flex; align-items: center; justify-content: center; height: 100%; gap: 10px; color: var(--text-muted);">
            <i data-lucide="loader" class="spin"></i> Loading logs...
        </div>`;
    }
    
    lucide.createIcons();
    openModal('jarvis-task-logs-modal');
    refreshCurrentTaskLogs();
}

let currentTaskLogsId = null;
async function refreshCurrentTaskLogs() {
    if (!currentTaskLogsId) return;
    const container = document.getElementById('jarvis-task-logs-container');
    if (!container) return;
    
    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/tasks/${currentTaskLogsId}/logs`);
        const data = await response.json();
        
        if (data.success) {
            if (data.data.length === 0) {
                container.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 20px;">${t('jarvis.noLogs') || 'No logs found for this task.'}</div>`;
                return;
            }
            
            container.innerHTML = data.data.map(log => {
                const statusClass = log.status === 'success' ? 'active' : (log.status === 'failed' ? 'banned' : 'warning');
                const profile = allProfiles.find(p => p.id === log.profile_id);
                const profileName = profile ? profile.name : log.profile_id;
                
                return `<div style="margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span class="status-badge ${statusClass}" style="font-size: 10px; padding: 2px 6px;">${log.status.toUpperCase()}</span>
                        <span style="font-size: 10px; color: var(--text-muted);">${new Date(log.finished_at).toLocaleString()}</span>
                    </div>
                    <strong style="color: var(--primary); font-size: 12px;">${escapeHtml(profileName)}</strong>
                    <div style="font-size: 13px; margin-top: 4px; color: #eee; font-family: inherit; white-space: pre-wrap;">${escapeHtml(log.log_data)}</div>
                </div>`;
            }).join('');
            container.scrollTop = 0; // Show latest at top or keep bottom? Tasks usually scroll down.
        }
    } catch (e) {
        container.innerHTML = `<div style="color: #ef4444; font-size: 12px; padding: 10px;">Failed to load logs: ${e.message}</div>`;
    }
}

async function createJarvisSession() {
    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'New Chat ' + new Date().toLocaleTimeString() })
        });
        const data = await response.json();
        if (data.success) {
            currentJarvisSessionId = data.data.id;
            jarvisHistory = [];
            jarvisAttachedFiles = [];
            document.getElementById('jarvis-messages').innerHTML = '';
            renderAttachedFiles();
            addChatMessage('assistant', t('jarvis.welcome'));
            loadJarvisHistory();
        }
    } catch (e) {
        showToast('Failed to create session', 'error');
    }
}

async function switchJarvisSession(id) {
    try {
        currentJarvisSessionId = id;
        const response = await fetch(`${API_URL}/v1.0/jarvis/sessions/${id}`);
        const data = await response.json();
        if (data.success) {
            jarvisHistory = data.data.history || [];
            jarvisAttachedFiles = JSON.parse(data.data.attached_files || '[]');
            
            const container = document.getElementById('jarvis-messages');
            container.innerHTML = '';
            
            if (jarvisHistory.length === 0) {
                addChatMessage('assistant', t('jarvis.welcome'));
            } else {
                jarvisHistory.forEach(msg => {
                    addChatMessage(msg.role, msg.content);
                });
            }
            renderAttachedFiles();
            loadJarvisHistory();
        }
    } catch (e) {
        showToast('Failed to load session', 'error');
    }
}

function handleJarvisKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendJarvisMessage();
    }
}

// Add paste listener for screenshots
document.addEventListener('DOMContentLoaded', () => {
    const jarvisInput = document.getElementById('jarvis-input');
    if (jarvisInput) {
        jarvisInput.addEventListener('paste', async (event) => {
            const items = (event.clipboardData || event.originalEvent.clipboardData).items;
            let imageCount = 0;
            
            for (const item of items) {
                if (item.type.indexOf('image') !== -1) {
                    if (jarvisAttachedFiles.length >= 3) {
                        showToast(t('jarvis.maxScreenshots') || 'Max 3 screenshots allowed', 'warning');
                        return;
                    }

                    const blob = item.getAsFile();
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        const base64Data = e.target.result;
                        // Save to temporary file via Electron
                        try {
                            const filePath = await window.electron.saveTempImage(base64Data);
                            if (filePath) {
                                jarvisAttachedFiles.push(filePath);
                                await updateSessionFiles();
                                renderAttachedFiles();
                            }
                        } catch (err) {
                            console.error('Failed to save pasted image:', err);
                        }
                    };
                    reader.readAsDataURL(blob);
                    imageCount++;
                }
            }
        });
    }
});

async function jarvisAttachFile() {
    if (!currentJarvisSessionId) {
        showToast('Please select or create a chat session first', 'warning');
        return;
    }
    try {
        const filePath = await window.electron.selectFile();
        if (filePath && !jarvisAttachedFiles.includes(filePath)) {
            jarvisAttachedFiles.push(filePath);
            await updateSessionFiles();
            renderAttachedFiles();
        }
    } catch (e) {
        console.error('File selection error:', e);
    }
}

async function updateSessionFiles() {
    if (!currentJarvisSessionId) return;
    try {
        await fetch(`${API_URL}/v1.0/jarvis/sessions/${currentJarvisSessionId}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: jarvisAttachedFiles })
        });
    } catch (e) {
        console.error('Failed to update session files:', e);
    }
}

function renderAttachedFiles() {
    const container = document.getElementById('jarvis-attached-files-container');
    const list = document.getElementById('jarvis-files-list');
    const sidebarContainer = document.getElementById('jarvis-active-session-files');
    const sidebarList = document.getElementById('jarvis-sidebar-files-list');

    if (!container || !list) return;
    
    if (jarvisAttachedFiles.length === 0) {
        container.style.display = 'none';
        if (sidebarContainer) sidebarContainer.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    if (sidebarContainer) sidebarContainer.style.display = 'block';

    const filesHtml = jarvisAttachedFiles.map(file => `
        <div class="jarvis-file-pill">
            <i data-lucide="file-text"></i>
            <span title="${file}">${file.split(/[\\/]/).pop()}</span>
            <i data-lucide="x" class="btn-remove-file" onclick="removeAttachedFile('${file.replace(/\\/g, '\\\\')}')"></i>
        </div>
    `).join('');

    list.innerHTML = filesHtml;
    if (sidebarList) {
        sidebarList.innerHTML = jarvisAttachedFiles.map(file => `
            <div class="jarvis-file-pill" style="justify-content: space-between; width: 100%; margin-bottom: 4px;">
                <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                    <i data-lucide="file-text"></i>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px;" title="${file}">${file.split(/[\\/]/).pop()}</span>
                </div>
                <i data-lucide="x" class="btn-remove-file" onclick="removeAttachedFile('${file.replace(/\\/g, '\\\\')}')" style="width: 12px; height: 12px;"></i>
            </div>
        `).join('');
    }
    
    lucide.createIcons();
}

async function removeAttachedFile(path) {
    jarvisAttachedFiles = jarvisAttachedFiles.filter(f => f !== path);
    await updateSessionFiles();
    renderAttachedFiles();
}

async function sendJarvisMessage(text = null, extraData = {}) {
    if (!currentJarvisSessionId && !text) {
        showToast('Please select or create a chat session first', 'warning');
        return;
    }

    const input = document.getElementById('jarvis-input');
    const message = text || input.value.trim();
    if (!message) return;

    if (!text) input.value = '';
    
    // Don't show technical "confirm" messages in chat
    if (!extraData.isConfirmedAction) {
        addChatMessage('user', message);
    }
    
    const thinkingId = addChatMessage('assistant', `<i data-lucide="loader" class="spin"></i> ${t('jarvis.thinking')}`);
    lucide.createIcons();

    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                history: jarvisHistory,
                session_id: currentJarvisSessionId,
                attached_files: jarvisAttachedFiles,
                ...extraData
            })
        });
        
        const data = await response.json();
        removeChatMessage(thinkingId);

        if (data.success) {
            const aiResponse = data.data.response;
            const toolResult = data.data.toolResult;

            if (toolResult && toolResult.requiresConfirmation) {
                renderConfirmationUI(aiResponse, toolResult);
            } else {
                addChatMessage('assistant', aiResponse);
            }

            jarvisHistory.push({ role: 'user', content: message });
            jarvisHistory.push({ role: 'assistant', content: aiResponse });
        } else {
            addChatMessage('assistant', `Error: ${data.error}`);
        }
    } catch (e) {
        removeChatMessage(thinkingId);
        addChatMessage('assistant', `Failed to connect to Jarvis: ${e.message}`);
    }
}

function renderConfirmationUI(aiResponse, toolResult) {
    const container = document.getElementById('jarvis-messages');
    const id = 'confirm-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant confirmation-message';
    msgDiv.id = id;

    msgDiv.innerHTML = `
        <div class="message-content">
            <p>${escapeHtml(aiResponse)}</p>
            <div class="confirmation-box" style="margin-top: 10px; padding: 12px; background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; border-radius: 8px;">
                <p style="color: #f59e0b; font-weight: bold; margin-bottom: 10px;">
                    <i data-lucide="alert-triangle"></i> ${t('jarvis.confirmAction')}
                </p>
                <div class="jarvis-suggestions" style="justify-content: flex-start;">
                    <button class="btn-success" onclick="confirmJarvisAction('${id}', true)">${t('jarvis.confirmBtn')}</button>
                    <button class="btn-secondary" onclick="confirmJarvisAction('${id}', false)">${t('jarvis.cancelBtn')}</button>
                </div>
            </div>
        </div>
    `;
    
    container.appendChild(msgDiv);
    lucide.createIcons();
    container.scrollTop = container.scrollHeight;
}

window.confirmJarvisAction = function(msgId, confirmed) {
    const msgEl = document.getElementById(msgId);
    if (!confirmed) {
        msgEl.innerHTML = `<div class="message-content">${t('jarvis.cancelBtn')}</div>`;
        return;
    }

    // Parse the original tool call from the history or message to resend with confirmed: true
    // For simplicity, we just send a confirmation message to the server
    msgEl.innerHTML = `<div class="message-content"><i data-lucide="loader" class="spin"></i> ${t('jarvis.thinking')}</div>`;
    lucide.createIcons();
    
    sendJarvisMessage("Confirmed. Proceed with the action.", { confirmed: true, isConfirmedAction: true });
};

function addChatMessage(role, content) {
    const container = document.getElementById('jarvis-messages');
    const id = 'msg-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.id = id;
    
    // Check if content is a script result (starts with JSON array)
    if (content.trim().startsWith('[') && content.trim().endsWith(']')) {
        try {
            const actions = JSON.parse(content);
            msgDiv.innerHTML = `
                <div class="message-content">
                    <p>${t('jarvis.scriptGenerated')}:</p>
                    <div class="jarvis-script-card">${escapeHtml(JSON.stringify(actions, null, 2))}</div>
                    <div class="jarvis-suggestions" style="justify-content: flex-start;">
                        <button onclick="jarvisTestRun('${id}')"><i data-lucide="play"></i> Test Run</button>
                        <button onclick="jarvisSaveScenario('${id}')"><i data-lucide="save"></i> Save Scenario</button>
                        <button onclick="openJarvisTaskModal('${id}')"><i data-lucide="users"></i> ${t('jarvis.applyToProfiles')}</button>
                    </div>
                </div>
            `;
            container.appendChild(msgDiv);
            lucide.createIcons();
            container.scrollTop = container.scrollHeight;
            return id;
        } catch (e) {}
    }

    // Convert newlines to breaks if not HTML
    const formattedContent = content.includes('<') ? content : content.replace(/\n/g, '<br>');
    
    msgDiv.innerHTML = `<div class="message-content">${formattedContent}</div>`;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return id;
}

async function jarvisTestRun(msgId) {
    const msgEl = document.getElementById(msgId);
    const scriptText = msgEl.querySelector('.jarvis-script-card').textContent;
    const actions = JSON.parse(scriptText);

    showToast(t('msg.testRunStarted'), 'info');
    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/test-run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions })
        });
        const data = await response.json();
        if (data.success) {
            showToast(t('msg.testRunSuccess'), 'success');
        } else {
            showToast(`${t('common.error')}: ${data.error}`, 'error');
        }
    } catch (e) {
        showToast(`${t('common.error')}: ${e.message}`, 'error');
    }
}

async function jarvisSaveScenario(msgId) {
    const msgEl = document.getElementById(msgId);
    const scriptText = msgEl.querySelector('.jarvis-script-card').textContent;
    const actions = JSON.parse(scriptText);
    const name = prompt(t('msg.enterScenarioName'), t('msg.jarvisGeneratedTask'));
    
    if (!name) return;

    try {
        const response = await fetch(`${API_URL}/v1.0/rpa/scenarios/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, actions })
        });
        if (response.ok) {
            showToast(t('msg.scenarioSaved'), 'success');
            if (currentSection === 'scenarios') loadScenarios();
        }
    } catch (e) {
        showToast(t('common.error'), 'error');
    }
}

// Jarvis Multi-Profile Task logic
let jarvisSelectedProfiles = new Set();

function openJarvisTaskModal(msgId) {
    const msgEl = document.getElementById(msgId);
    const scriptText = msgEl.querySelector('.jarvis-script-card').textContent;
    const actions = JSON.parse(scriptText);
    
    // We'll save the script temporarily to get an ID or just pass it to the modal
    // For now, let's assume user saves it first or we create a temporary scenario
    document.getElementById('jarvis-task-name').value = t('jarvis.defaultTaskName') + ' ' + new Date().toLocaleTimeString();
    
    // We need a script_id. If not saved, we'll create a temp one.
    // Better: ask user to save it first or just use the actions directly in the task creation.
    // I'll update the API to accept actions directly or just save it automatically.
    
    // For simplicity, let's just save it automatically as "Temp Jarvis Script"
    fetch(`${API_URL}/v1.0/rpa/scenarios/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t('msg.jarvisGeneratedTask'), actions })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            document.getElementById('jarvis-task-script-id').value = data.data.id;
            
            // Populate groups
            const groupSelect = document.getElementById('jarvis-task-group-select');
            groupSelect.innerHTML = `<option value="">${t('common.selectGroup')}</option>` + 
                allGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
                
            renderJarvisTaskProfiles();
            openModal('jarvis-task-modal');
        }
    });
}

function renderJarvisTaskProfiles(groupId = null) {
    const list = document.getElementById('jarvis-task-profiles-list');
    let profiles = allProfiles;
    if (groupId) {
        profiles = profiles.filter(p => p.group_id === groupId);
    }
    
    list.innerHTML = profiles.map(p => `
        <div class="bookmark-select-item">
            <label class="checkbox-label">
                <input type="checkbox" onchange="toggleJarvisProfile('${p.id}', this.checked)" ${jarvisSelectedProfiles.has(p.id) ? 'checked' : ''}>
                <span>${escapeHtml(p.name)}</span>
            </label>
        </div>
    `).join('');
}

function toggleJarvisProfile(id, checked) {
    if (checked) jarvisSelectedProfiles.add(id);
    else jarvisSelectedProfiles.delete(id);
}

function selectJarvisTaskGroup(groupId) {
    renderJarvisTaskProfiles(groupId);
}

function toggleSchedulingMode(mode) {
    if (mode === 'interval') {
        document.getElementById('jarvis-task-dow').value = '*';
        document.getElementById('jarvis-task-time').value = '';
    } else {
        document.getElementById('jarvis-task-repeat').value = '0';
    }
}

async function createJarvisTask() {
    const name = document.getElementById('jarvis-task-name').value;
    const script_id = document.getElementById('jarvis-task-script-id').value;
    const scheduleVal = document.getElementById('jarvis-task-schedule').value;
    const repeatVal = document.getElementById('jarvis-task-repeat').value;
    const dow = document.getElementById('jarvis-task-dow').value;
    const time = document.getElementById('jarvis-task-time').value;
    
    const profile_ids = Array.from(jarvisSelectedProfiles);
    
    if (profile_ids.length === 0) {
        showToast(t('msg.noRunningProfiles'), 'warning');
        return;
    }

    const scheduled_at = scheduleVal ? new Date(scheduleVal).getTime() : null;
    const repeat_interval = parseInt(repeatVal) || 0;
    
    let cron_expression = null;
    if (time) {
        const [hour, min] = time.split(':');
        // Format: min hour dom month dow
        cron_expression = `${parseInt(min)} ${parseInt(hour)} * * ${dow}`;
    }
    
    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name, 
                script_id, 
                profile_ids, 
                scheduled_at, 
                repeat_interval,
                cron_expression
            })
        });
        
        if (response.ok) {
            let msg = scheduled_at 
                ? t('jarvis.taskScheduled', { date: new Date(scheduled_at).toLocaleString() }) 
                : t('jarvis.taskStarted', { count: profile_ids.length });
            
            if (cron_expression) {
                msg = t('jarvis.taskScheduledCron');
            } else if (repeat_interval > 0) {
                msg += ` (${t('jarvis.repeatingEvery')} ${repeat_interval}m)`;
            }

            showToast(msg, 'success');
            closeModal('jarvis-task-modal');
            jarvisSelectedProfiles.clear();
            loadJarvisHistory();
        }
    } catch (e) {
        showToast(t('common.error'), 'error');
    }
}

function removeChatMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function jarvisQuickCommand(cmd) {
    if (cmd === 'record') {
        sendJarvisMessage("I want to record a new browser action.");
    } else if (cmd === 'setup_metamask') {
        sendJarvisMessage("How do I install Metamask across all my profiles?");
    } else if (cmd === 'help') {
        sendJarvisMessage("Show me what you can do.");
    }
}

function toggleJarvisProviderFields() {
    const provider = document.getElementById('jarvis-provider').value;
    const urlGroup = document.getElementById('jarvis-api-url-group');
    const modelInput = document.getElementById('jarvis-model-name');
    const urlInput = document.getElementById('jarvis-api-url');
    
    if (provider === 'droidgravity') {
        urlGroup.style.display = 'block';
        if (!urlInput.value) urlInput.value = 'http://127.0.0.1:8045';
        if (!modelInput.value || modelInput.value.includes('gpt')) modelInput.value = 'gemini-3-flash';
    } else if (provider === 'openai') {
        urlGroup.style.display = 'block';
        urlInput.placeholder = 'https://api.openai.com/v1 (Optional)';
        if (modelInput.value === 'gemini-3-flash') modelInput.value = 'gpt-4o';
    } else if (provider === 'openrouter') {
        urlGroup.style.display = 'block';
        urlInput.placeholder = 'https://openrouter.ai/api/v1 (Optional)';
        if (modelInput.value === 'gemini-3-flash') modelInput.value = 'openai/gpt-4o';
    }
}

function toggleTgSecurityFields() {
    const mode = document.getElementById('jarvis-tg-mode').value;
    document.getElementById('tg-security-fields').style.display = mode === 'full' ? 'block' : 'none';
}

function populateTgToolsList(selectedTools = []) {
    const container = document.getElementById('tg-tools-list');
    const availableTools = [
        'listProfiles', 'getProfile', 'startProfile', 'stopProfile', 
        'listProxies', 'createProxy', 'deleteProxy', 
        'createProfile', 'updateProfile', 'bulkCreateProfiles', 'deleteProfile',
        'listGroups', 'runRpa', 'installExtension', 'startRecording', 'stopRecording'
    ];

    container.innerHTML = availableTools.map(tool => `
        <label class="checkbox-label" style="font-size: 11px;">
            <input type="checkbox" name="tg-safe-tool" value="${tool}" ${selectedTools.includes(tool) ? 'checked' : ''}>
            <span>${tool}</span>
        </label>
    `).join('');
}

function openJarvisConfig() {
    console.log('Opening Jarvis Config Modal');
    if (jarvisConfig) {
        document.getElementById('jarvis-provider').value = jarvisConfig.provider || 'droidgravity';
        document.getElementById('jarvis-api-url').value = jarvisConfig.api_url || '';
        document.getElementById('jarvis-api-key').value = ''; // Don't show encrypted key
        document.getElementById('jarvis-model-name').value = jarvisConfig.model_name || 'gemini-3-flash';
        document.getElementById('jarvis-system-prompt').value = jarvisConfig.system_prompt || '';
        document.getElementById('jarvis-enabled').checked = jarvisConfig.is_enabled === 1;
        document.getElementById('jarvis-permission-level').value = jarvisConfig.permission_level || 'standard';
        
        // MCP
        document.getElementById('jarvis-mcp-servers').value = jarvisConfig.mcp_servers ? JSON.parse(jarvisConfig.mcp_servers).join('\n') : '';

        // Telegram settings
        document.getElementById('jarvis-tg-token').value = ''; // Don't show encrypted key
        document.getElementById('jarvis-tg-chat-id').value = jarvisConfig.tg_chat_id ? '********' : ''; 
        const whitelist = jarvisConfig.tg_whitelist ? EncryptionService.decrypt(jarvisConfig.tg_whitelist) : '';
        document.getElementById('jarvis-tg-whitelist').value = whitelist;
        document.getElementById('jarvis-tg-notify-success').checked = jarvisConfig.tg_notify_success === 1;
        document.getElementById('jarvis-tg-notify-error').checked = jarvisConfig.tg_notify_error === 1;
        document.getElementById('jarvis-tg-notify-summary').checked = jarvisConfig.tg_notify_summary === 1;
        document.getElementById('jarvis-tg-mode').value = jarvisConfig.tg_mode || 'notify';
        
        // Telegram Security
        const safeTools = jarvisConfig.tg_safe_tools ? JSON.parse(jarvisConfig.tg_safe_tools) : ['listProfiles', 'listProxies', 'getProfile', 'startProfile', 'stopProfile', 'listGroups'];
        populateTgToolsList(safeTools);
        document.getElementById('jarvis-tg-requires-2fa').checked = jarvisConfig.tg_requires_2fa !== 0;
        toggleTgSecurityFields();

        // Whitelist warning logic
        const updateWhitelistWarning = () => {
            const val = document.getElementById('jarvis-tg-whitelist').value.trim();
            document.getElementById('tg-whitelist-warning').style.display = val ? 'none' : 'flex';
        };
        document.getElementById('jarvis-tg-whitelist').oninput = updateWhitelistWarning;
        updateWhitelistWarning();

        // Populate Master Profile dropdown
        const select = document.getElementById('jarvis-master-profile');
        const currentVal = jarvisConfig.master_profile_id;
        select.innerHTML = `<option value="">No Profile Selected</option>` + 
            allProfiles.map(p => `<option value="${p.id}" ${p.id === currentVal ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
            
        toggleJarvisProviderFields();
    }
    openModal('jarvis-config-modal');
}

async function saveJarvisConfig() {
    const safeTools = Array.from(document.querySelectorAll('input[name="tg-safe-tool"]:checked')).map(cb => cb.value);
    
    const config = {
        provider: document.getElementById('jarvis-provider').value,
        api_url: document.getElementById('jarvis-api-url').value,
        api_key: document.getElementById('jarvis-api-key').value,
        model_name: document.getElementById('jarvis-model-name').value,
        master_profile_id: document.getElementById('jarvis-master-profile').value,
        permission_level: document.getElementById('jarvis-permission-level').value,
        system_prompt: document.getElementById('jarvis-system-prompt').value,
        is_enabled: document.getElementById('jarvis-enabled').checked ? 1 : 0,
        mcp_servers: JSON.stringify(document.getElementById('jarvis-mcp-servers').value.split('\n').map(s => s.trim()).filter(s => s)),
        
        // Telegram
        tg_token: document.getElementById('jarvis-tg-token').value,
        tg_chat_id: document.getElementById('jarvis-tg-chat-id').value === '********' ? undefined : document.getElementById('jarvis-tg-chat-id').value,
        tg_whitelist: document.getElementById('jarvis-tg-whitelist').value,
        tg_notify_success: document.getElementById('jarvis-tg-notify-success').checked ? 1 : 0,
        tg_notify_error: document.getElementById('jarvis-tg-notify-error').checked ? 1 : 0,
        tg_notify_summary: document.getElementById('jarvis-tg-notify-summary').checked ? 1 : 0,
        tg_mode: document.getElementById('jarvis-tg-mode').value,
        tg_safe_tools: JSON.stringify(safeTools),
        tg_requires_2fa: document.getElementById('jarvis-tg-requires-2fa').checked ? 1 : 0
    };

    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(t('msg.jarvisConfigSaved'), 'success');
            closeModal('jarvis-config-modal');
            await loadJarvisConfig();
        } else {
            showToast(data.error || t('common.error'), 'error');
        }
    } catch (e) {
        showToast(t('common.error'), 'error');
    }
}

async function launchJarvisMasterProfile() {
    if (!jarvisConfig || !jarvisConfig.master_profile_id) {
        showToast('Please configure a Master Profile in Jarvis settings first', 'warning');
        openJarvisConfig();
        return;
    }

    const btn = document.getElementById('btn-launch-jarvis-profile');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="spin"></i> Launching...`;
    lucide.createIcons();

    try {
        const response = await fetch(`${API_URL}/v1.0/browser_profiles/${jarvisConfig.master_profile_id}/start`);
        const data = await response.json();
        if (data.success) {
            showToast('Jarvis Orchestrator started', 'success');
        } else {
            showToast(data.error || 'Failed to start profile', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        lucide.createIcons();
    }
}

async function testJarvisTelegram() {
    showToast(t('proxies.testing'), 'info');
    try {
        const response = await fetch(`${API_URL}/v1.0/jarvis/tg-test`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast(t('common.success'), 'success');
        } else {
            showToast(data.error || t('common.error'), 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// IPC Listeners from Electron Main
if (window.electron) {
    window.electron.on('jarvis-status-update', (event, data) => {
        const panel = document.getElementById('jarvis-recording-panel');
        if (data.status === 'recording') {
            panel.style.display = 'flex';
            addChatMessage('system', t('jarvis.recordingStarted', { profileId: data.profileId }));
        } else if (data.status === 'finished') {
            panel.style.display = 'none';
            addChatMessage('system', t('jarvis.recordingFinished'));
            
            if (data.data && data.data.humanReadable) {
                renderEditableSteps(data.data.humanReadable);
            }
        }
    });
}

function renderEditableSteps(humanReadable) {
    const container = document.getElementById('jarvis-messages');
    const id = 'steps-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant editable-steps-message';
    msgDiv.id = id;

    // Split by lines or numbered items
    const steps = humanReadable.split(/\n/).filter(line => line.trim());
    
    msgDiv.innerHTML = `
        <div class="message-content">
            <p>${t('jarvis.recordingAnalyzedSimple') || 'Recording analyzed. You can edit the steps below:'}</p>
            <div class="jarvis-steps-list" id="steps-list-${id}">
                ${steps.map((step, idx) => `
                    <div class="jarvis-step-item">
                        <span class="step-number">${idx + 1}.</span>
                        <input type="text" class="step-input" value="${escapeHtml(step.replace(/^\d+\.\s*/, ''))}" onchange="updateStep('${id}', ${idx}, this.value)">
                        <button class="btn-remove-step" onclick="removeStep('${id}', ${idx})">×</button>
                    </div>
                `).join('')}
            </div>
            <div class="jarvis-suggestions" style="justify-content: flex-start; margin-top: 10px;">
                <button onclick="addStep('${id}')"><i data-lucide="plus"></i> Add Step</button>
                <button onclick="generateScriptFromSteps('${id}')"><i data-lucide="zap"></i> Generate Script</button>
            </div>
        </div>
    `;
    
    container.appendChild(msgDiv);
    lucide.createIcons();
    container.scrollTop = container.scrollHeight;
}

window.updateStep = function(msgId, idx, value) {
    console.log(`Step ${idx} updated to: ${value}`);
};

window.removeStep = function(msgId, idx) {
    const item = document.querySelector(`#steps-list-${msgId} .jarvis-step-item:nth-child(${idx + 1})`);
    if (item) item.remove();
    // Re-index
    const items = document.querySelectorAll(`#steps-list-${msgId} .jarvis-step-item`);
    items.forEach((it, i) => {
        it.querySelector('.step-number').textContent = `${i + 1}.`;
        it.querySelector('.btn-remove-step').setAttribute('onclick', `removeStep('${msgId}', ${i})`);
    });
};

window.addStep = function(msgId) {
    const list = document.getElementById(`steps-list-${msgId}`);
    const idx = list.children.length;
    const div = document.createElement('div');
    div.className = 'jarvis-step-item';
    div.innerHTML = `
        <span class="step-number">${idx + 1}.</span>
        <input type="text" class="step-input" value="" placeholder="e.g. Click on settings button" onchange="updateStep('${msgId}', ${idx}, this.value)">
        <button class="btn-remove-step" onclick="removeStep('${msgId}', ${idx})">×</button>
    `;
    list.appendChild(div);
};

window.generateScriptFromSteps = async function(msgId) {
    const inputs = document.querySelectorAll(`#steps-list-${msgId} .step-input`);
    const combinedSteps = Array.from(inputs).map((input, i) => `${i + 1}. ${input.value}`).join('\n');
    
    sendJarvisMessage(`Generate an RPA script based on these steps:\n${combinedSteps}`);
};

// Extend initializeApp to load Jarvis
const originalInitializeApp = initializeApp;
initializeApp = async function() {
    await originalInitializeApp();
    loadJarvisConfig();
};

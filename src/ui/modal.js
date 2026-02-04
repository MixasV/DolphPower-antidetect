// ==================== MODAL FUNCTIONS ====================

let currentEditingProfileId = null;
let currentProfileData = null;
let currentFingerprintData = null;

// Open edit modal
async function openEditModal(profileId) {
    currentEditingProfileId = profileId;

    try {
        // Load profile data and proxies in parallel
        const [profileResponse, proxiesResponse] = await Promise.all([
            fetch(`${API_URL}/v1.0/browser_profiles/${profileId}`),
            fetch(`${API_URL}/v1.0/proxies`)
        ]);
        
        const data = await profileResponse.json();
        const proxiesData = await proxiesResponse.json();

        if (!data.success) {
            alert(t('modal.loadFailed'));
            return;
        }

        currentProfileData = data.data.profile;
        currentFingerprintData = data.data.fingerprint;

        // Populate proxy select
        const proxySelect = document.getElementById('edit-proxy');
        const proxies = proxiesData.data || [];
        proxySelect.innerHTML = `<option value="">${t('common.noProxy')}</option>` +
            proxies.map(p => `<option value="${p.id}">${p.name} (${p.host}:${p.port})${p.group_id ? ' [' + p.group_id + ']' : ''}</option>`).join('');

        // Populate form
        populateEditForm();

        // Show modal
        document.getElementById('edit-modal').classList.add('active');
        document.body.style.overflow = 'hidden';

        // Fix focus issue: small delay to ensure rendering is complete before focusing
        setTimeout(() => {
            const firstInput = document.getElementById('edit-name');
            if (firstInput) {
                firstInput.focus();
                firstInput.select(); // Select text for easier editing
            }
        }, 150);
    } catch (error) {
        console.error('Failed to load profile:', error);
        alert(t('modal.loadFailed'));
    }
}

// Close edit modal
function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('active');
    document.body.style.overflow = '';
    currentEditingProfileId = null;
    currentProfileData = null;
    currentFingerprintData = null;
}

// Switch modal tab
function switchModalTab(tabName) {
    // Update tabs
    document.querySelectorAll('.modal-tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    // Update content
    document.querySelectorAll('.modal-tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`modal-tab-${tabName}`).classList.add('active');
}

// Select mode for fingerprint options
function selectMode(category, mode) {
    const container = event.target.parentElement;
    container.querySelectorAll('.mode-option').forEach(opt => opt.classList.remove('active'));
    event.target.classList.add('active');

    // Show/hide additional options
    if (category === 'canvas') {
        document.getElementById('canvas-noise-container').style.display = mode === 'noise' ? 'block' : 'none';
    } else if (category === 'audio') {
        document.getElementById('audio-noise-container').style.display = mode === 'noise' ? 'block' : 'none';
    } else if (category === 'webrtc') {
        document.getElementById('webrtc-ip-container').style.display = mode === 'fake' ? 'block' : 'none';
    } else if (category === 'webgl') {
        document.getElementById('webgl-custom-container').style.display = mode === 'custom' ? 'block' : 'none';
    }
}

// Populate edit form with profile data
function populateEditForm() {
    if (!currentProfileData || !currentFingerprintData) return;

    const profile = currentProfileData;
    const fp = currentFingerprintData;

    // Modal title
    document.getElementById('modal-profile-name').textContent = profile.name;

    // Basic tab
    document.getElementById('edit-profile-name').value = profile.name || '';
    document.getElementById('edit-browser-type').value = profile.browser_type || 'chrome';
    document.getElementById('edit-browser-version').value = profile.browser_version || '120.0.6099.130';
    document.getElementById('edit-os-type').value = profile.os_type || 'windows';
    document.getElementById('edit-os-version').value = profile.os_version || '10';
    document.getElementById('edit-group-id').value = profile.group_id || '';
    document.getElementById('edit-tags').value = profile.tags || '';
    document.getElementById('edit-notes').value = profile.notes || '';

    // Proxy tab
    document.getElementById('edit-proxy').value = profile.proxy_id || '';

    // Platform tab
    document.getElementById('edit-user-agent').value = fp.user_agent || '';
    document.getElementById('edit-platform').value = fp.platform || 'Win32';
    document.getElementById('edit-platform-version').value = fp.platform_version || '10.0.0';
    document.getElementById('edit-screen-width').value = fp.screen_width || 1920;
    document.getElementById('edit-screen-height').value = fp.screen_height || 1080;
    document.getElementById('edit-color-depth').value = fp.color_depth || 24;
    document.getElementById('edit-pixel-ratio').value = fp.pixel_ratio || 1.0;
    document.getElementById('edit-language').value = fp.language || 'en-US';

    // Parse languages array
    try {
        const langs = JSON.parse(fp.languages || '["en-US","en"]');
        document.getElementById('edit-languages').value = langs.join(', ');
    } catch (e) {
        document.getElementById('edit-languages').value = 'en-US, en';
    }

    document.getElementById('edit-geo-lat').value = fp.geolocation_latitude || '';
    document.getElementById('edit-geo-lon').value = fp.geolocation_longitude || '';
    document.getElementById('edit-geo-accuracy').value = fp.geolocation_accuracy || 100;

    // Fingerprint tab
    // Canvas
    setModeActive('canvas', fp.canvas_mode || 'noise');
    document.getElementById('edit-canvas-noise').value = fp.canvas_noise || 50;
    document.getElementById('canvas-noise-value').textContent = fp.canvas_noise || 50;
    document.getElementById('canvas-noise-container').style.display = fp.canvas_mode === 'noise' ? 'block' : 'none';

    // WebGL
    setModeActive('webgl', fp.webgl_mode || 'noise');
    document.getElementById('edit-webgl-vendor').value = fp.webgl_vendor || 'Google Inc. (Intel)';
    document.getElementById('edit-webgl-renderer').value = fp.webgl_renderer || 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)';
    document.getElementById('webgl-custom-container').style.display = fp.webgl_mode === 'custom' ? 'block' : 'none';

    // Audio
    setModeActive('audio', fp.audio_mode || 'noise');
    document.getElementById('edit-audio-noise').value = fp.audio_noise || 50;
    document.getElementById('audio-noise-value').textContent = fp.audio_noise || 50;
    document.getElementById('audio-noise-container').style.display = fp.audio_mode === 'noise' ? 'block' : 'none';

    // WebRTC
    setModeActive('webrtc', fp.webrtc_mode || 'disabled');
    document.getElementById('edit-webrtc-public-ip').value = fp.webrtc_public_ip || '';
    document.getElementById('edit-webrtc-local-ip').value = fp.webrtc_local_ip || '';
    document.getElementById('webrtc-ip-container').style.display = fp.webrtc_mode === 'fake' ? 'block' : 'none';

    // ClientRects
    setModeActive('clientrects', fp.client_rects_mode || 'off');

    // Advanced tab
    document.getElementById('edit-hardware-concurrency').value = fp.hardware_concurrency || 8;
    document.getElementById('edit-device-memory').value = fp.device_memory || 8;
    document.getElementById('edit-max-touch-points').value = fp.max_touch_points || 0;
    document.getElementById('edit-audio-inputs').value = fp.media_devices_audio_inputs || 1;
    document.getElementById('edit-audio-outputs').value = fp.media_devices_audio_outputs || 2;
    document.getElementById('edit-video-inputs').value = fp.media_devices_video_inputs || 1;
    document.getElementById('edit-do-not-track').checked = fp.do_not_track === '1' || fp.do_not_track === 1;

    // Ultra Stealth
    document.getElementById('edit-battery-spoofing').checked = fp.battery_spoofing === 1;
    document.getElementById('edit-v8-break-iterator').checked = fp.v8_break_iterator === 1;
    document.getElementById('edit-chrome-object').checked = fp.chrome_object_spoofing === 1;
    document.getElementById('edit-perf-jitter').checked = fp.perf_jitter === 1;
}

// Helper to set active mode
function setModeActive(category, mode) {
    const containers = {
        'canvas': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(1) .mode-option'),
        'webgl': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(2) .mode-option'),
        'audio': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(3) .mode-option'),
        'webrtc': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(4) .mode-option'),
        'clientrects': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(5) .mode-option')
    };

    const options = containers[category];
    if (!options) return;

    options.forEach(opt => {
        opt.classList.remove('active');
        if (opt.getAttribute('data-mode') === mode) {
            opt.classList.add('active');
        }
    });
}

// Get active mode
function getActiveMode(category) {
    const containers = {
        'canvas': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(1) .mode-option'),
        'webgl': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(2) .mode-option'),
        'audio': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(3) .mode-option'),
        'webrtc': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(4) .mode-option'),
        'clientrects': document.querySelectorAll('#modal-tab-fingerprint .fingerprint-section:nth-child(5) .mode-option')
    };

    const options = containers[category];
    if (!options) return 'off';

    for (let opt of options) {
        if (opt.classList.contains('active')) {
            return opt.getAttribute('data-mode');
        }
    }
    return 'off';
}

// Save profile changes
async function saveProfileChanges() {
    if (!currentEditingProfileId) return;

    try {
        // Collect profile data
        const profileUpdates = {
            name: document.getElementById('edit-profile-name').value,
            browser_type: document.getElementById('edit-browser-type').value,
            browser_version: document.getElementById('edit-browser-version').value,
            os_type: document.getElementById('edit-os-type').value,
            os_version: document.getElementById('edit-os-version').value,
            proxy_id: document.getElementById('edit-proxy').value || null,
            group_id: document.getElementById('edit-group-id').value || null,
            tags: document.getElementById('edit-tags').value || null,
            notes: document.getElementById('edit-notes').value || null
        };

        // Collect fingerprint data
        const languages = document.getElementById('edit-languages').value.split(',').map(l => l.trim());

        const fingerprintUpdates = {
            canvas: {
                mode: getActiveMode('canvas'),
                noise: parseInt(document.getElementById('edit-canvas-noise').value)
            },
            webgl: {
                mode: getActiveMode('webgl'),
                vendor: document.getElementById('edit-webgl-vendor').value,
                renderer: document.getElementById('edit-webgl-renderer').value
            },
            audio: {
                mode: getActiveMode('audio'),
                noise: parseInt(document.getElementById('edit-audio-noise').value)
            },
            screen: {
                width: parseInt(document.getElementById('edit-screen-width').value),
                height: parseInt(document.getElementById('edit-screen-height').value),
                colorDepth: parseInt(document.getElementById('edit-color-depth').value),
                pixelDepth: parseInt(document.getElementById('edit-color-depth').value),
                pixelRatio: parseFloat(document.getElementById('edit-pixel-ratio').value),
                availWidth: parseInt(document.getElementById('edit-screen-width').value),
                availHeight: parseInt(document.getElementById('edit-screen-height').value) - 40
            },
            languages: {
                language: document.getElementById('edit-language').value,
                languages: languages,
                acceptLanguage: languages.map((l, i) => `${l};q=${1 - i * 0.1}`).join(',')
            },
            geolocation: {
                latitude: parseFloat(document.getElementById('edit-geo-lat').value) || null,
                longitude: parseFloat(document.getElementById('edit-geo-lon').value) || null,
                accuracy: parseInt(document.getElementById('edit-geo-accuracy').value) || 100
            },
            navigator: {
                userAgent: document.getElementById('edit-user-agent').value,
                platform: document.getElementById('edit-platform').value,
                platformVersion: document.getElementById('edit-platform-version').value,
                hardwareConcurrency: parseInt(document.getElementById('edit-hardware-concurrency').value),
                deviceMemory: parseInt(document.getElementById('edit-device-memory').value),
                maxTouchPoints: parseInt(document.getElementById('edit-max-touch-points').value),
                doNotTrack: document.getElementById('edit-do-not-track').checked ? '1' : null
            },
            webrtc: {
                mode: getActiveMode('webrtc'),
                publicIp: document.getElementById('edit-webrtc-public-ip').value || null,
                localIp: document.getElementById('edit-webrtc-local-ip').value || null
            },
            mediaDevices: {
                audioInputs: parseInt(document.getElementById('edit-audio-inputs').value),
                audioOutputs: parseInt(document.getElementById('edit-audio-outputs').value),
                videoInputs: parseInt(document.getElementById('edit-video-inputs').value)
            },
            clientRects: {
                mode: getActiveMode('clientrects')
            },
            ultraStealth: {
                battery: document.getElementById('edit-battery-spoofing').checked,
                v8BreakIterator: document.getElementById('edit-v8-break-iterator').checked,
                chromeObject: document.getElementById('edit-chrome-object').checked,
                perfJitter: document.getElementById('edit-perf-jitter').checked
            }
        };

        // Update profile
        const profileResponse = await fetch(`${API_URL}/v1.0/browser_profiles/${currentEditingProfileId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileUpdates)
        });

        if (!profileResponse.ok) {
            throw new Error(t('modal.updateFailed'));
        }

        // Update fingerprint
        const fingerprintResponse = await fetch(`${API_URL}/v1.0/browser_profiles/${currentEditingProfileId}/fingerprint`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fingerprintUpdates)
        });

        if (!fingerprintResponse.ok) {
            throw new Error(t('modal.updateFpFailed'));
        }

        // Success
        closeEditModal();
        loadProfiles();
        alert(t('modal.updateSuccess'));

    } catch (error) {
        console.error('Failed to save changes:', error);
        alert(t('modal.saveError') + ': ' + error.message);
    }
}

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('edit-modal').classList.contains('active')) {
        closeEditModal();
    }
});

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'edit-modal') {
        closeEditModal();
    }
});

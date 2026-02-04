# 🎯 IMPLEMENTATION PLAN: Profile Editor + Fingerprint Settings

## Цель
Создать полноценный редактор профилей как в AdsPower с детальными настройками fingerprint

## Компоненты

### 1. Backend API (PRIORITY: HIGH)

#### Новые endpoints:
```typescript
PUT /v1.0/browser_profiles/:id/fingerprint
// Обновить fingerprint настройки профиля
Body: FingerprintData
```

#### Обновить существующие:
```typescript
PUT /v1.0/browser_profiles/:id
// Добавить поддержку обновления всех полей профиля
```

### 2. Frontend UI (PRIORITY: HIGH)

#### 2.1 Модальное окно редактирования
- Открывается по клику на "Edit" в карточке профиля
- Полноэкранное или большое модальное окно
- Закрывается по ESC или клику вне окна

#### 2.2 Вкладки (Tabs) внутри модального окна:

**Вкладка 1: Общий (Basic)**
- Profile Name
- Browser Template
- Browser Type/Version
- OS Type/Version
- Group ID
- Tags
- Notes

**Вкладка 2: Прокси (Proxy)**
- Proxy selection
- Proxy type
- IP check settings
- Timezone from IP

**Вкладка 3: Платформа (Platform)**
- User-Agent (manual/auto)
- Platform
- Screen Resolution
- Languages
- Timezone
- Geolocation

**Вкладка 4: Отпечаток (Fingerprint)** ⭐ MAIN
- **Canvas:**
  - Mode: Off/Noise/Block
  - Noise level (slider 0-100)
  
- **WebGL:**
  - Mode: Off/Noise/Block/Custom
  - Vendor (dropdown)
  - Renderer (dropdown)
  - Metadata (JSON editor)

- **Audio:**
  - Mode: Off/Noise
  - Noise level (slider)

- **Fonts:**
  - List of fonts (multiselect)
  - Add custom fonts

- **WebRTC:**
  - Mode: Disabled/Fake/Real
  - Public IP
  - Local IP

- **Media Devices:**
  - Audio inputs count
  - Audio outputs count
  - Video inputs count

- **ClientRects:**
  - Mode: Off/Noise

- **SpeechVoices:**
  - List of voices

**Вкладка 5: Дополнительно (Advanced)**
- Do Not Track
- Hardware Concurrency
- Device Memory
- Max Touch Points
- Plugins list

### 3. UI Components Structure

```
<div class="modal-overlay" id="edit-modal">
  <div class="modal-container">
    <div class="modal-header">
      <h2>Edit Profile: {name}</h2>
      <button class="close-btn">×</button>
    </div>
    
    <div class="modal-tabs">
      <div class="tab active">Общий</div>
      <div class="tab">Прокси</div>
      <div class="tab">Платформа</div>
      <div class="tab">Отпечаток</div>
      <div class="tab">Дополнительно</div>
    </div>
    
    <div class="modal-body">
      <div class="tab-content active" id="tab-basic">
        <!-- Basic settings form -->
      </div>
      <div class="tab-content" id="tab-proxy">
        <!-- Proxy settings -->
      </div>
      <div class="tab-content" id="tab-platform">
        <!-- Platform settings -->
      </div>
      <div class="tab-content" id="tab-fingerprint">
        <!-- Fingerprint settings -->
      </div>
      <div class="tab-content" id="tab-advanced">
        <!-- Advanced settings -->
      </div>
    </div>
    
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeEditModal()">Cancel</button>
      <button class="btn-success" onclick="saveProfile()">Save Changes</button>
    </div>
  </div>
</div>
```

### 4. JavaScript Functions

```javascript
// Modal control
function openEditModal(profileId)
function closeEditModal()
function switchModalTab(tabName)

// Data loading
async function loadProfileForEdit(profileId)
async function loadFingerprintForEdit(profileId)

// Data saving
async function saveProfile()
async function updateFingerprint()

// UI helpers
function populateFormWithProfile(profile)
function populateFingerprintForm(fingerprint)
function collectFormData()
function collectFingerprintData()
```

### 5. CSS Styling

```css
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  z-index: 1000;
  display: none;
}

.modal-overlay.active {
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-container {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 1200px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-tabs {
  display: flex;
  border-bottom: 2px solid #e5e7eb;
  padding: 0 20px;
}

.modal-tab {
  padding: 15px 25px;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.3s;
}

.modal-tab.active {
  border-bottom-color: #667eea;
  color: #667eea;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
```

## Implementation Steps

### Phase 1: Backend (1-2 hours)
1. ✅ Add PUT /v1.0/browser_profiles/:id/fingerprint endpoint
2. ✅ Add updateFingerprintConfig method to ProfileManager
3. ✅ Test API endpoints

### Phase 2: Modal UI Structure (1 hour)
1. ✅ Create modal HTML structure
2. ✅ Add modal CSS styling
3. ✅ Add open/close modal functions
4. ✅ Add tab switching

### Phase 3: Forms Implementation (2-3 hours)
1. ✅ Basic tab form
2. ✅ Proxy tab form
3. ✅ Platform tab form
4. ✅ Fingerprint tab form (MAIN - most complex)
5. ✅ Advanced tab form

### Phase 4: Data Loading & Saving (1-2 hours)
1. ✅ Load profile data into forms
2. ✅ Load fingerprint data into forms
3. ✅ Collect data from forms
4. ✅ Save to API
5. ✅ Handle errors

### Phase 5: Testing & Polish (1 hour)
1. ✅ Test all fields
2. ✅ Test save/cancel
3. ✅ Test validation
4. ✅ Polish UI/UX

## Total Estimate: 6-9 hours

## Priority Order:
1. Backend API (fingerprint update)
2. Modal structure + Basic tab
3. Fingerprint tab (MOST IMPORTANT)
4. Other tabs
5. Testing

## Notes:
- Follow AGENTS.md - REAL CODE ONLY
- No mocks, no placeholders
- All functionality must work
- Match AdsPower UI/UX as closely as possible

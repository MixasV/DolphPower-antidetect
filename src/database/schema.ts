import sqlite3 from 'sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const DB_DIR = path.join(os.homedir(), '.antidetect');
const DB_PATH = path.join(DB_DIR, 'database.db');

export async function initializeDatabase(): Promise<sqlite3.Database> {
  // Ensure directory exists
  await fs.mkdir(DB_DIR, { recursive: true });

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
      } else {
        db.serialize(() => {
          // Profiles table with browser config
          db.run(`
            CREATE TABLE IF NOT EXISTS profiles (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              proxy_id TEXT,
              user_data_dir TEXT NOT NULL,
              fingerprint_seed TEXT NOT NULL,
              
              -- Browser configuration
              browser_type TEXT DEFAULT 'chrome',
              browser_version TEXT DEFAULT '132.0.6834.110',
              os_type TEXT DEFAULT 'windows',
              os_version TEXT DEFAULT '10',
              
              -- Organization
              group_id TEXT,
              notes TEXT,
              tags TEXT,
              
              -- Status and tracking
              status TEXT DEFAULT 'new',
              last_opened_at INTEGER,
              open_count INTEGER DEFAULT 0,
              
              -- Startup configuration
              start_urls TEXT,
              launch_args TEXT,
              restore_tabs INTEGER DEFAULT 1,
              last_checked_ip TEXT,
              deleted_at INTEGER,
              
              custom_data TEXT,
              FOREIGN KEY (proxy_id) REFERENCES proxies(id)
            )
          `);

          // Add new columns if they don't exist (migration)
          db.run(`ALTER TABLE profiles ADD COLUMN status TEXT DEFAULT 'new'`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN last_opened_at INTEGER`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN open_count INTEGER DEFAULT 0`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN start_urls TEXT`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN launch_args TEXT`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN restore_tabs INTEGER DEFAULT 1`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN last_checked_ip TEXT`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN last_checked_country TEXT`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN last_checked_city TEXT`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN last_checked_time INTEGER`, () => { });
          db.run(`ALTER TABLE profiles ADD COLUMN deleted_at INTEGER`, () => { });

          // Profile groups with colors
          db.run(`
            CREATE TABLE IF NOT EXISTS profile_groups (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              color TEXT DEFAULT '#3b82f6',
              description TEXT,
              created_at TEXT NOT NULL
            )
          `);

          // Comprehensive fingerprint configuration
          db.run(`
            CREATE TABLE IF NOT EXISTS fingerprints (
              id TEXT PRIMARY KEY,
              profile_id TEXT NOT NULL UNIQUE,
              
              -- Canvas fingerprinting
              canvas_mode TEXT DEFAULT 'noise' CHECK(canvas_mode IN ('off', 'noise', 'block')),
              canvas_noise INTEGER DEFAULT 50,
              
              -- WebGL fingerprinting
              webgl_mode TEXT DEFAULT 'noise' CHECK(webgl_mode IN ('off', 'noise', 'block', 'custom')),
              webgl_vendor TEXT DEFAULT 'Google Inc. (Intel)',
              webgl_renderer TEXT DEFAULT 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
              webgl_metadata TEXT, -- JSON for all GL parameters
              
              -- Audio Context
              audio_mode TEXT DEFAULT 'noise' CHECK(audio_mode IN ('off', 'noise')),
              audio_noise INTEGER DEFAULT 50,
              audio_context_state TEXT DEFAULT 'suspended',
              
              -- Screen & Resolution
              screen_width INTEGER DEFAULT 1920,
              screen_height INTEGER DEFAULT 1080,
              avail_width INTEGER DEFAULT 1920,
              avail_height INTEGER DEFAULT 1040,
              color_depth INTEGER DEFAULT 24,
              pixel_depth INTEGER DEFAULT 24,
              pixel_ratio REAL DEFAULT 1.0,
              
              -- Timezone
              timezone_id TEXT DEFAULT 'auto',
              timezone_offset INTEGER DEFAULT 0,
              
              -- Languages
              language TEXT DEFAULT 'en-US',
              languages TEXT DEFAULT '["en-US","en"]',
              accept_language TEXT DEFAULT 'en-US,en;q=0.9',
              
              -- Geolocation (optional)
              geolocation_latitude REAL,
              geolocation_longitude REAL,
              geolocation_accuracy INTEGER DEFAULT 100,
              
              -- Navigator properties
              user_agent TEXT NOT NULL,
              platform TEXT DEFAULT 'Win32',
              platform_version TEXT DEFAULT '10.0.0',
              hardware_concurrency INTEGER DEFAULT 8,
              device_memory INTEGER DEFAULT 8,
              max_touch_points INTEGER DEFAULT 0,
              
              -- Fonts
              fonts TEXT, -- JSON array of font families
              
              -- WebRTC
              webrtc_mode TEXT DEFAULT 'altered' CHECK(webrtc_mode IN ('real', 'disabled', 'altered')),
              webrtc_public_ip TEXT,
              webrtc_local_ip TEXT,
              
              -- Media Devices
              media_devices_audio_inputs INTEGER DEFAULT 1,
              media_devices_audio_outputs INTEGER DEFAULT 1,
              media_devices_video_inputs INTEGER DEFAULT 1,
              
              -- Other properties
              do_not_track TEXT DEFAULT '0',
              plugins TEXT, -- JSON array
              
              -- Client Rects
              client_rects_mode TEXT DEFAULT 'noise' CHECK(client_rects_mode IN ('off', 'noise')),
              
              -- Speech Voices
              speech_voices TEXT, -- JSON array
              
              -- Ultra Stealth Layer (New)
              battery_spoofing INTEGER DEFAULT 1,
              v8_break_iterator INTEGER DEFAULT 1,
              chrome_object_spoofing INTEGER DEFAULT 1,
              perf_jitter INTEGER DEFAULT 1,
              
              FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            )
          `);

          // Migration: Add new columns if they don't exist
          db.run(`ALTER TABLE fingerprints ADD COLUMN battery_spoofing INTEGER DEFAULT 1`, () => { });
          db.run(`ALTER TABLE fingerprints ADD COLUMN v8_break_iterator INTEGER DEFAULT 1`, () => { });
          db.run(`ALTER TABLE fingerprints ADD COLUMN chrome_object_spoofing INTEGER DEFAULT 1`, () => { });
          db.run(`ALTER TABLE fingerprints ADD COLUMN perf_jitter INTEGER DEFAULT 1`, () => { });

          // Proxies table
          db.run(`
            CREATE TABLE IF NOT EXISTS proxies (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              protocol TEXT CHECK(protocol IN ('http', 'https', 'socks5')),
              host TEXT NOT NULL,
              port INTEGER NOT NULL,
              username TEXT,
              password TEXT,
              group_id TEXT,
              created_at INTEGER NOT NULL
            )
          `);

          // Migration: Add group_id column if it doesn't exist
          db.run(`ALTER TABLE proxies ADD COLUMN group_id TEXT`, (err) => {
            // Ignore error if column already exists
          });

          // Cookies table
          db.run(`
            CREATE TABLE IF NOT EXISTS cookies (
              id TEXT PRIMARY KEY,
              profile_id TEXT NOT NULL,
              name TEXT NOT NULL,
              value TEXT,
              domain TEXT,
              path TEXT,
              expires INTEGER,
              secure BOOLEAN,
              httpOnly BOOLEAN,
              sameSite TEXT,
              FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            )
          `);

          // RPA Scenarios
          db.run(`
            CREATE TABLE IF NOT EXISTS rpa_scenarios (
              id TEXT PRIMARY KEY,
              profile_id TEXT,
              name TEXT NOT NULL,
              actions TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
            )
          `);

          // Default Bookmarks
          db.run(`
            CREATE TABLE IF NOT EXISTS bookmarks (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              url TEXT NOT NULL,
              group_id TEXT, -- Associated group or NULL for all
              created_at TEXT NOT NULL
            )
          `);

          // Migration: Add group_id to bookmarks
          db.run(`ALTER TABLE bookmarks ADD COLUMN group_id TEXT`, () => { });

          // Default Extensions
          db.run(`
            CREATE TABLE IF NOT EXISTS default_extensions (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              path TEXT NOT NULL,
              is_default INTEGER DEFAULT 1,
              group_id TEXT, -- Associated group or NULL for all
              created_at TEXT NOT NULL
            )
          `);

          // Migration: Add group_id to default_extensions
          db.run(`ALTER TABLE default_extensions ADD COLUMN group_id TEXT`, () => { });

          // Extensions table (managed by ExtensionManager but defined here for consistency)
          db.run(`
            CREATE TABLE IF NOT EXISTS extensions (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              path TEXT NOT NULL,
              enabled INTEGER DEFAULT 1,
              group_id TEXT, -- Associated group or NULL for all
              created_at INTEGER NOT NULL,
              version TEXT,
              description TEXT
            )
          `);

          // Migration: Add group_id to extensions
          db.run(`ALTER TABLE extensions ADD COLUMN group_id TEXT`, () => { });

          // Profile Extensions (Join table)
          db.run(`
            CREATE TABLE IF NOT EXISTS profile_extensions (
              profile_id TEXT NOT NULL,
              extension_id TEXT NOT NULL,
              enabled INTEGER DEFAULT 1,
              PRIMARY KEY (profile_id, extension_id),
              FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
              FOREIGN KEY (extension_id) REFERENCES extensions(id) ON DELETE CASCADE
            )
          `);

          // Migration: Add columns to extensions if they don't exist
          db.run(`ALTER TABLE extensions ADD COLUMN version TEXT`, () => { });
          db.run(`ALTER TABLE extensions ADD COLUMN description TEXT`, () => { });

          // Profile Bookmarks (Join table)
          db.run(`
            CREATE TABLE IF NOT EXISTS profile_bookmarks (
              profile_id TEXT NOT NULL,
              bookmark_id TEXT NOT NULL,
              PRIMARY KEY (profile_id, bookmark_id),
              FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
              FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
            )
          `);

          // Jarvis Configuration
          db.run(`
            CREATE TABLE IF NOT EXISTS jarvis_config (
              id INTEGER PRIMARY KEY CHECK (id = 1), -- Single row config
              provider TEXT DEFAULT 'droidgravity', -- 'droidgravity', 'openai', 'openrouter'
              api_url TEXT DEFAULT 'http://127.0.0.1:8045',
              api_key TEXT, -- Encrypted
              model_name TEXT DEFAULT 'gemini-3-flash',
              master_profile_id TEXT, -- Dedicated profile for testing scripts
              permission_level TEXT DEFAULT 'standard', -- 'readonly', 'standard', 'admin'
              system_prompt TEXT,
              is_enabled INTEGER DEFAULT 1,
              
              -- Telegram Notifications
              tg_token TEXT, -- Encrypted
              tg_chat_id TEXT, -- Encrypted
              tg_whitelist TEXT, -- Encrypted, comma-separated IDs
              tg_notify_success INTEGER DEFAULT 1,
              tg_notify_error INTEGER DEFAULT 1,
              tg_notify_summary INTEGER DEFAULT 1,
              tg_mode TEXT DEFAULT 'notify', -- 'notify', 'full'
              mcp_servers TEXT, -- JSON array
              
              updated_at INTEGER NOT NULL
            )
          `);

          // Migration: Add Telegram columns
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_token TEXT`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_chat_id TEXT`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_whitelist TEXT`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_notify_success INTEGER DEFAULT 1`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_notify_error INTEGER DEFAULT 1`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_notify_summary INTEGER DEFAULT 1`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_mode TEXT DEFAULT 'notify'`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN mcp_servers TEXT`, () => {});

          // Migration: Add columns if they don't exist
          db.run(`ALTER TABLE jarvis_config ADD COLUMN provider TEXT DEFAULT 'droidgravity'`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN permission_level TEXT DEFAULT 'standard'`, () => {});
          db.run(`ALTER TABLE jarvis_config ADD COLUMN master_profile_id TEXT`, () => {});

          // Jarvis Chat Sessions (Encrypted)
          db.run(`
            CREATE TABLE IF NOT EXISTS jarvis_sessions (
              id TEXT PRIMARY KEY,
              title TEXT,
              history TEXT NOT NULL, -- Encrypted JSON (dialogues)
              attached_files TEXT, -- JSON array of paths
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
          `);

          // Migration: Add attached_files if not exists
          db.run(`ALTER TABLE jarvis_sessions ADD COLUMN attached_files TEXT`, () => {});

          // Jarvis Execution Logs
          db.run(`
            CREATE TABLE IF NOT EXISTS jarvis_execution_logs (
              id TEXT PRIMARY KEY,
              session_id TEXT,
              profile_id TEXT,
              script_id TEXT,
              status TEXT NOT NULL, -- 'pending', 'running', 'success', 'failed'
              log_data TEXT, -- Detailed execution steps/errors
              started_at INTEGER,
              finished_at INTEGER,
              FOREIGN KEY (session_id) REFERENCES jarvis_sessions(id) ON DELETE SET NULL,
              FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
            )
          `);

          // Jarvis Scheduled Tasks
          db.run(`
            CREATE TABLE IF NOT EXISTS jarvis_tasks (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              script_id TEXT,
              profile_ids TEXT, -- JSON array of profile IDs
              scheduled_at INTEGER,
              repeat_interval INTEGER DEFAULT 0, -- In minutes, 0 = no repeat
              cron_expression TEXT, -- e.g. "0 14 * * 0" (Sunday 14:00)
              last_run_at INTEGER,
              status TEXT DEFAULT 'pending',
              created_at INTEGER NOT NULL,
              FOREIGN KEY (script_id) REFERENCES rpa_scenarios(id) ON DELETE CASCADE
            )
          `);

          // Migration: Add cron_expression
          db.run(`ALTER TABLE jarvis_tasks ADD COLUMN cron_expression TEXT`, () => {});
          db.run(`ALTER TABLE jarvis_tasks ADD COLUMN repeat_interval INTEGER DEFAULT 0`, () => {});
          db.run(`ALTER TABLE jarvis_tasks ADD COLUMN silent INTEGER DEFAULT 0`, () => {});
          db.run(`ALTER TABLE jarvis_tasks ADD COLUMN allowed_paths TEXT`, () => {});
          db.run(`ALTER TABLE jarvis_tasks ADD COLUMN parent_session_id TEXT`, () => {});

          // App Authentication & Security
          db.run(`
            CREATE TABLE IF NOT EXISTS auth_config (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              password_hash TEXT,
              password_salt TEXT,
              totp_secret TEXT, -- Encrypted with hardware key initially, then re-encrypted with master password
              is_totp_enabled INTEGER DEFAULT 0,
              trusted_hardware_id TEXT, -- Derived from machine info
              login_attempts INTEGER DEFAULT 0,
              last_attempt_at INTEGER,
              updated_at INTEGER NOT NULL
            )
          `);

          // Update Jarvis Config for extra Telegram security
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_safe_tools TEXT`, () => {}); // JSON array of allowed tool names
          db.run(`ALTER TABLE jarvis_config ADD COLUMN tg_requires_2fa INTEGER DEFAULT 1`, () => {});

          // Profile Versions table for versioning and rollback
          db.run(`
            CREATE TABLE IF NOT EXISTS profile_versions (
              id TEXT PRIMARY KEY,
              profile_id TEXT NOT NULL,
              version_number INTEGER NOT NULL,
              created_at INTEGER NOT NULL,
              profile_data TEXT NOT NULL, -- JSON string of profile
              fingerprint_data TEXT NOT NULL, -- JSON string of fingerprint config
              FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            )
          `);

          // Migration: Add index for faster lookups
          db.run(`CREATE INDEX IF NOT EXISTS idx_profile_versions_profile_id ON profile_versions(profile_id)`, () => {});
          db.run(`CREATE INDEX IF NOT EXISTS idx_profile_versions_version ON profile_versions(profile_id, version_number)`, () => {});

          console.log('✓ Database initialized with comprehensive fingerprint, Jarvis and Auth schema');
          resolve(db);
        });
      }
    });
  });
}

// ==================== INTERFACES ====================

export interface JarvisConfig {
  provider: 'droidgravity' | 'openai' | 'openrouter';
  api_url: string;
  api_key: string;
  model_name: string;
  master_profile_id: string;
  permission_level: 'readonly' | 'standard' | 'admin';
  system_prompt: string;
  is_enabled: boolean;
  
  // Telegram
  tg_token?: string;
  tg_chat_id?: string;
  tg_whitelist?: string;
  tg_notify_success?: number;
  tg_notify_error?: number;
  tg_notify_summary?: number;
  tg_mode?: string;
  mcp_servers?: string;
  tg_safe_tools?: string;
  tg_requires_2fa?: number;
  
  updated_at: number;
}

export interface JarvisSession {
  id: string;
  title: string;
  history: string; // Encrypted JSON
  attached_files: string | null; // JSON string array
  created_at: number;
  updated_at: number;
}

export interface JarvisExecutionLog {
  id: string;
  session_id: string | null;
  profile_id: string | null;
  script_id: string | null;
  status: 'pending' | 'running' | 'success' | 'failed';
  log_data: string;
  started_at: number;
  finished_at: number;
}

export interface Profile {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  proxy_id: string | null;
  user_data_dir: string;
  fingerprint_seed: string;

  // Browser config
  browser_type: string;
  browser_version: string;
  os_type: string;
  os_version: string;

  // Organization
  group_id: string | null;
  notes: string | null;
  tags: string | null;

  last_checked_ip: string | null;
  last_checked_country: string | null;
  last_checked_city: string | null;
  last_checked_time: number | null;

  // New fields
  status: string | null;
  last_opened_at: number | null;
  open_count: number | null;
  start_urls: string | null;
  launch_args: string | null;
  restore_tabs: number | null;

  custom_data: string | null;
}

export interface FingerprintConfig {
  id: string;
  profile_id: string;

  // Canvas
  canvas_mode: 'off' | 'noise' | 'block';
  canvas_noise: number;

  // WebGL
  webgl_mode: 'off' | 'noise' | 'block' | 'custom';
  webgl_vendor: string;
  webgl_renderer: string;
  webgl_metadata: string | null; // JSON

  // Audio
  audio_mode: 'off' | 'noise';
  audio_noise: number;
  audio_context_state: string;

  // Screen
  screen_width: number;
  screen_height: number;
  avail_width: number;
  avail_height: number;
  color_depth: number;
  pixel_depth: number;
  pixel_ratio: number;

  // Timezone
  timezone_id: string;
  timezone_offset: number;

  // Languages
  language: string;
  languages: string; // JSON array
  accept_language: string;

  // Geolocation
  geolocation_latitude: number | null;
  geolocation_longitude: number | null;
  geolocation_accuracy: number;

  // Navigator
  user_agent: string;
  platform: string;
  platform_version: string;
  hardware_concurrency: number;
  device_memory: number;
  max_touch_points: number;

  // Fonts
  fonts: string | null; // JSON array

  // WebRTC
  webrtc_mode: 'real' | 'disabled' | 'altered';
  webrtc_public_ip: string | null;
  webrtc_local_ip: string | null;

  // Media Devices
  media_devices_audio_inputs: number;
  media_devices_audio_outputs: number;
  media_devices_video_inputs: number;

  // Other
  do_not_track: string;
  plugins: string | null; // JSON array

  // Client Rects
  client_rects_mode: 'off' | 'noise';

  // Speech
  speech_voices: string | null; // JSON array

  // Ultra Stealth
  battery_spoofing: number;
  v8_break_iterator: number;
  chrome_object_spoofing: number;
  perf_jitter: number;
}

// Legacy interface for backward compatibility
export interface Fingerprint {
  id: string;
  profile_id: string;
  canvas_hash: string;
  webgl_vendor: string;
  webgl_renderer: string;
  audio_fingerprint: number;
  user_agent: string;
  language: string;
  timezone: string;
  platform: string;
  screen_width: number;
  screen_height: number;
  color_depth: number;
  device_memory: number;
  hardwareConcurrency: number;
}

export interface Proxy {
  id: string;
  name: string;
  protocol: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  created_at: number;
}

export interface Cookie {
  id: string;
  profile_id: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

export interface JarvisTask {
  id: string;
  name: string;
  script_id: string;
  profile_ids: string; // JSON string in DB
  scheduled_at: number | null;
  repeat_interval: number; // minutes
  cron_expression: string | null;
  last_run_at: number | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'scheduled';
  created_at: number;
}

// Helper types for fingerprint data
export interface FingerprintData {
  // Canvas
  canvas: {
    mode: 'off' | 'noise' | 'block';
    noise: number;
  };

  // WebGL
  webgl: {
    mode: 'off' | 'noise' | 'block' | 'custom';
    vendor: string;
    renderer: string;
    metadata?: Record<string, any>;
  };

  // Audio
  audio: {
    mode: 'off' | 'noise';
    noise: number;
  };

  // Screen
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
    colorDepth: number;
    pixelDepth: number;
    pixelRatio: number;
  };

  // Timezone
  timezone: {
    id: string;
    offset: number;
  };

  // Languages
  languages: {
    language: string;
    languages: string[];
    acceptLanguage: string;
  };

  // Navigator
  navigator: {
    userAgent: string;
    platform: string;
    platformVersion: string;
    hardwareConcurrency: number;
    deviceMemory: number;
    maxTouchPoints: number;
    doNotTrack: string;
  };

  // Geolocation (optional)
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };

  // Fonts
  fonts: string[];

  // WebRTC
  webrtc: {
    mode: 'real' | 'disabled' | 'altered';
    publicIp?: string;
    localIp?: string;
  };

  // Media Devices
  mediaDevices: {
    audioInputs: number;
    audioOutputs: number;
    videoInputs: number;
  };

  // Client Rects
  clientRects: {
    mode: 'off' | 'noise';
  };

  // Plugins
  plugins: Array<{
    name: string;
    description: string;
    filename: string;
  }>;

  // Speech
  speech_voices?: Array<{
    name: string;
    lang: string;
  }>;

  // Ultra Stealth Toggles
  ultraStealth?: {
    battery?: boolean;
    v8BreakIterator?: boolean;
    chromeObject?: boolean;
    perfJitter?: boolean;
  };
}

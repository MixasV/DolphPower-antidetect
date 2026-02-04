import { FingerprintData } from '../database/schema';

/**
 * Fingerprint Generator - Ultimate Stealth v23.0
 * Ultra-high fidelity shadowing and consistency for anti-bot bypass.
 */
export class FingerprintGenerator {
  private seed: string;
  private defaultChromeVersion: string;

  constructor(seed: string, defaultChromeVersion: string = '132.0.6834.110') {
    this.seed = seed;
    this.defaultChromeVersion = defaultChromeVersion;
  }

  generateFingerprint(template: string = 'windows_chrome'): FingerprintData {
    const isMac = template.includes('mac');
    const isLinux = template.includes('linux');
    const isWindows = !isMac && !isLinux;

    const resolutions = [
      { w: 1920, h: 1080, ratio: 1 },
      { w: 1536, h: 864, ratio: 1.25 },
      { w: 1440, h: 900, ratio: 2 },
      { w: 2560, h: 1440, ratio: 1.5 }
    ];
    const res = resolutions[Math.floor(this.random() * resolutions.length)];

    const cpuCores = isMac ? [8, 10, 12] : [4, 6, 8, 12, 16];
    const memory = isMac ? [8, 16, 32] : [8, 16, 32, 64];
    
    const webglData = isMac ? [
      { vendor: 'Apple Inc.', renderer: 'Apple M1' },
      { vendor: 'Apple Inc.', renderer: 'Apple M2' },
      { vendor: 'Apple Inc.', renderer: 'Apple M3' }
    ] : isWindows ? [
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)' }
    ] : [
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.6)' }
    ];
    const gpu = webglData[Math.floor(this.random() * webglData.length)];

    const platform = isMac ? 'MacIntel' : isLinux ? 'Linux x86_64' : 'Win32';
    const ua = isMac 
      ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${this.defaultChromeVersion} Safari/537.36`
      : isLinux
      ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${this.defaultChromeVersion} Safari/537.36`
      : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${this.defaultChromeVersion} Safari/537.36`;

    return {
      canvas: { mode: 'noise', noise: Math.floor(this.random() * 5) + 1 },
      webgl: { mode: 'noise', vendor: gpu.vendor, renderer: gpu.renderer },
      audio: { mode: 'noise', noise: Math.floor(this.random() * 10) + 1 },
      screen: { 
        width: res.w, 
        height: res.h, 
        availWidth: res.w, 
        availHeight: res.h - (isWindows ? 40 : 0), 
        colorDepth: 24, 
        pixelDepth: 24, 
        pixelRatio: res.ratio 
      },
      timezone: { id: 'auto', offset: 0 },
      languages: { language: 'auto_ip', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
      navigator: {
        userAgent: ua,
        platform: platform,
        platformVersion: isWindows ? '10.0.0' : '14.5.0',
        hardwareConcurrency: cpuCores[Math.floor(this.random() * cpuCores.length)],
        deviceMemory: memory[Math.floor(this.random() * memory.length)],
        maxTouchPoints: 0,
        doNotTrack: '0'
      },
      fonts: [
        'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Cambria Math', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Wingdings'
      ],
      webrtc: { mode: 'altered' },
      mediaDevices: { audioInputs: 1, audioOutputs: 1, videoInputs: 1 },
      clientRects: { mode: 'noise' },
      plugins: [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
      ],
      ultraStealth: { battery: true, v8BreakIterator: true, chromeObject: true, perfJitter: true }
    };
  }

  private random(): number {
    let seed = 0;
    for (let i = 0; i < this.seed.length; i++) {
        seed = ((seed << 5) - seed) + this.seed.charCodeAt(i);
        seed |= 0;
    }
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  generateInjectionScript(fp: FingerprintData): string {
    const fpJson = JSON.stringify(fp);
    const chromeVersion = fp.navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '132.0.0.0';
    const chromeMajor = chromeVersion.split('.')[0];

    return `
(function() {
  'use strict';
  try {
    const fp = ${fpJson};
    
    // 0. Core Shadowing Utils
    const originalToString = Function.prototype.toString;
    const shadowedFns = new WeakMap();

    const setNative = (fn, name) => {
      if (!fn) return;
      const str = 'function ' + (name || fn.name || 'anonymous') + '() { [native code] }';
      shadowedFns.set(fn, str);
      
      try {
        Object.defineProperty(fn, 'name', { value: name || fn.name || '', configurable: true });
      } catch(e) {}
      
      try {
        const toStringHandler = function toString() {
            if (this === fn || this === toStringHandler) return str;
            return originalToString.apply(this, arguments);
        };
        // Use defineProperty to avoid potential non-writable errors
        Object.defineProperty(fn, 'toString', {
            value: toStringHandler,
            configurable: true,
            writable: true,
            enumerable: false
        });
        shadowedFns.set(toStringHandler, 'function toString() { [native code] }');
      } catch(e) {}
    };

    Function.prototype.toString = function toString() {
      if (shadowedFns.has(this)) return shadowedFns.get(this);
      return originalToString.apply(this, arguments);
    };
    setNative(Function.prototype.toString, 'toString');

    const hook = (obj, prop, val) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(obj, prop);
        if (desc && !desc.configurable) return;

        const getter = function() { return val; };
        setNative(getter, 'get ' + prop);
        Object.defineProperty(obj, prop, { 
            get: getter, 
            configurable: true, 
            enumerable: true 
        });
      } catch(e) {}
    };

    // 1. Navigator Consistency
    const navProps = {
      userAgent: fp.navigator.userAgent,
      appVersion: fp.navigator.userAgent.substring(8),
      platform: fp.navigator.platform,
      vendor: 'Google Inc.',
      deviceMemory: fp.navigator.deviceMemory,
      hardwareConcurrency: fp.navigator.hardwareConcurrency,
      maxTouchPoints: fp.navigator.maxTouchPoints || 0,
      doNotTrack: fp.navigator.doNotTrack || '0',
      onLine: true,
      cookieEnabled: true,
      pdfViewerEnabled: true,
      language: fp.languages.language,
      languages: fp.languages.languages,
    };

    Object.keys(navProps).forEach(prop => hook(Navigator.prototype, prop, navProps[prop]));
    
    // 1.0 Timezone Hook
    if (fp.timezone && fp.timezone.id) {
        const oldResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function() {
            const res = oldResolvedOptions.apply(this, arguments);
            Object.defineProperty(res, 'timeZone', { get: () => fp.timezone.id });
            return res;
        };
        setNative(Intl.DateTimeFormat.prototype.resolvedOptions, 'resolvedOptions');

        // Hook Date.prototype.getTimezoneOffset
        const offset = fp.timezone.offset || 0; // minutes
        const oldGetTimezoneOffset = Date.prototype.getTimezoneOffset;
        Date.prototype.getTimezoneOffset = function() {
            return offset;
        };
        setNative(Date.prototype.getTimezoneOffset, 'getTimezoneOffset');
    }

    // 1.1 Client Hints - Sec-CH-UA
    if (navigator.userAgentData) {
        try {
            const brands = [
                { brand: 'Not(A:Brand', version: '99' },
                { brand: 'Google Chrome', version: '${chromeMajor}' },
                { brand: 'Chromium', version: '${chromeMajor}' }
            ];
            const platformName = fp.navigator.platform.includes('Win') ? 'Windows' : 
                                 fp.navigator.platform.includes('Mac') ? 'macOS' : 'Linux';
            
            const uaData = Object.create(NavigatorUAData.prototype);
            hook(uaData, 'brands', brands);
            hook(uaData, 'mobile', false);
            hook(uaData, 'platform', platformName);
            
            const getHighEntropyValues = function(hints) {
                return Promise.resolve({
                    brands,
                    mobile: false,
                    platform: platformName,
                    platformVersion: fp.navigator.platformVersion || (platformName === 'Windows' ? '10.0.0' : '14.5.0'),
                    architecture: platformName === 'macOS' ? (fp.navigator.userAgent.includes('Arm') ? 'arm' : 'x86') : 'x86',
                    bitness: '64',
                    model: '',
                    uaFullVersion: '${chromeVersion}',
                    fullVersionList: brands.map(b => ({ brand: b.brand, version: b.brand === 'Not(A:Brand' ? '99.0.0.0' : '${chromeVersion}' }))
                });
            };
            setNative(getHighEntropyValues, 'getHighEntropyValues');
            uaData.getHighEntropyValues = getHighEntropyValues;
            hook(navigator, 'userAgentData', uaData);
        } catch (e) {}
    }

    // 2. Plugins & MimeTypes
    const createPlugin = (name, filename, description) => {
        const p = Object.create(Plugin.prototype);
        hook(p, 'name', name);
        hook(p, 'filename', filename);
        hook(p, 'description', description);
        hook(p, 'length', 0);
        return p;
    };

    const plugins = (fp.plugins || []).map(p => createPlugin(p.name, p.filename, p.description));
    const pluginArray = Object.create(PluginArray.prototype);
    hook(pluginArray, 'length', plugins.length);
    plugins.forEach((p, i) => {
        pluginArray[i] = p;
        hook(pluginArray, p.name, p);
    });

    const item = function(index) { return this[index] || null; };
    const namedItem = function(name) { return this[name] || null; };
    setNative(item, 'item');
    setNative(namedItem, 'namedItem');
    pluginArray.item = item;
    pluginArray.namedItem = namedItem;

    const mimeTypeArray = Object.create(MimeTypeArray.prototype);
    hook(mimeTypeArray, 'length', 0);
    mimeTypeArray.item = item;
    mimeTypeArray.namedItem = namedItem;
    
    hook(Navigator.prototype, 'plugins', pluginArray);
    hook(Navigator.prototype, 'mimeTypes', mimeTypeArray);

    // 3. WebGL & Canvas Spoofing
    const patchGL = (proto) => {
      if (!proto) return;
      const oldGetParam = proto.getParameter;
      proto.getParameter = function(param) {
        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) return fp.webgl.vendor;
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) return fp.webgl.renderer;
        // VENDOR
        if (param === 7936) return 'WebKit';
        // RENDERER
        if (param === 7937) return 'WebKit WebGL';
        // VERSION
        if (param === 7938) return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
        // SHADING_LANGUAGE_VERSION
        if (param === 35724) return 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';
        
        return oldGetParam.apply(this, arguments);
      };
      setNative(proto.getParameter, 'getParameter');

      const oldGetExtension = proto.getExtension;
      proto.getExtension = function(name) {
        if (name === 'WEBGL_debug_renderer_info') return {
            UNMASKED_VENDOR_WEBGL: 37445,
            UNMASKED_RENDERER_WEBGL: 37446
        };
        return oldGetExtension.apply(this, arguments);
      };
      setNative(proto.getExtension, 'getExtension');

      // Spoof supported extensions to look like a real browser
      const oldGetSupportedExtensions = proto.getSupportedExtensions;
      proto.getSupportedExtensions = function() {
        const exts = oldGetSupportedExtensions.apply(this, arguments) || [];
        if (!exts.includes('WEBGL_debug_renderer_info')) exts.push('WEBGL_debug_renderer_info');
        return exts;
      };
      setNative(proto.getSupportedExtensions, 'getSupportedExtensions');
    };
    patchGL(WebGLRenderingContext.prototype);
    patchGL(WebGL2RenderingContext.prototype);

    if (fp.canvas && fp.canvas.mode === 'noise') {
        const oldToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const oldToBlob = HTMLCanvasElement.prototype.toBlob;
        const oldGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        
        const noiseCanvas = (canvas) => {
            const ctx = canvas.getContext('2d');
            if (ctx && !canvas._noised) {
                canvas._noised = true;
                const oldFill = ctx.fillStyle;
                // Very subtle noise
                ctx.fillStyle = 'rgba(' + fp.canvas.noise + ',' + fp.canvas.noise + ',' + fp.canvas.noise + ', 0.00001)';
                ctx.fillRect(0, 0, 1, 1);
                ctx.fillStyle = oldFill;
            }
        };

        HTMLCanvasElement.prototype.toDataURL = function() {
            noiseCanvas(this);
            return oldToDataURL.apply(this, arguments);
        };
        setNative(HTMLCanvasElement.prototype.toDataURL, 'toDataURL');

        HTMLCanvasElement.prototype.toBlob = function() {
            noiseCanvas(this);
            return oldToBlob.apply(this, arguments);
        };
        setNative(HTMLCanvasElement.prototype.toBlob, 'toBlob');

        CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
            const res = oldGetImageData.apply(this, arguments);
            if (!this.canvas._noised && w > 10 && h > 10) {
                // Only noise one pixel to change hash but stay statistically safe
                res.data[0] = (res.data[0] + (fp.canvas.noise % 2)) % 256;
            }
            return res;
        };
        setNative(CanvasRenderingContext2D.prototype.getImageData, 'getImageData');
    }

    // 3.1 Audio Spoofing
    if (fp.audio && fp.audio.mode === 'noise') {
        const audioCtx = window.AudioContext || window.webkitAudioContext;
        if (audioCtx) {
            const oldCreateOscillator = audioCtx.prototype.createOscillator;
            audioCtx.prototype.createOscillator = function() {
                const osc = oldCreateOscillator.apply(this, arguments);
                const oldStart = osc.start;
                osc.start = function() {
                    // Inject very subtle frequency shift
                    if (this.frequency) {
                        this.frequency.value += (fp.audio.noise / 1000000);
                    }
                    return oldStart.apply(this, arguments);
                };
                setNative(osc.start, 'start');
                return osc;
            };
            setNative(audioCtx.prototype.createOscillator, 'createOscillator');

            const oldGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function() {
                const res = oldGetChannelData.apply(this, arguments);
                // Subtle noise in audio buffer
                for (let i = 0; i < res.length; i += 4096) {
                    res[i] += (fp.audio.noise / 1000000);
                }
                return res;
            };
            setNative(AudioBuffer.prototype.getChannelData, 'getChannelData');
        }
    }

    // 3.2 WebRTC Spoofing
    if (fp.webrtc && fp.webrtc.mode === 'altered') {
        const oldRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (oldRTCPeerConnection) {
            const publicIp = fp.webrtc.publicIp || '1.1.1.1';
            
            const mockRTCPeerConnection = function(config) {
                const pc = new oldRTCPeerConnection(config);
                
                const patchCandidate = (candidate) => {
                    if (!candidate || !candidate.candidate) return candidate;
                    const newCandidate = Object.create(RTCIceCandidate.prototype);
                    const original = candidate.candidate;
                    // Replace any IP-like string with our spoofed IP
                    const spoofed = original.replace(/([0-9]{1,3}(\.[0-9]{1,3}){3}|([a-f0-9]{1,4}(:[a-f0-9]{1,4}){7}))/g, publicIp);
                    
                    Object.defineProperty(newCandidate, 'candidate', { get: () => spoofed });
                    Object.defineProperty(newCandidate, 'sdpMid', { get: () => candidate.sdpMid });
                    Object.defineProperty(newCandidate, 'sdpMLineIndex', { get: () => candidate.sdpMLineIndex });
                    Object.defineProperty(newCandidate, 'usernameFragment', { get: () => candidate.usernameFragment });
                    return newCandidate;
                };

                const oldAddEventListener = pc.addEventListener;
                pc.addEventListener = function(type, listener, options) {
                    if (type === 'icecandidate') {
                        const wrappedListener = (event) => {
                            if (event.candidate) {
                                const patched = patchCandidate(event.candidate);
                                Object.defineProperty(event, 'candidate', { get: () => patched });
                            }
                            listener.call(this, event);
                        };
                        return oldAddEventListener.call(this, type, wrappedListener, options);
                    }
                    return oldAddEventListener.apply(this, arguments);
                };

                const oldCreateOffer = pc.createOffer;
                pc.createOffer = function() {
                    return oldCreateOffer.apply(this, arguments).then(offer => {
                        offer.sdp = offer.sdp.replace(/([0-9]{1,3}(\.[0-9]{1,3}){3}|([a-f0-9]{1,4}(:[a-f0-9]{1,4}){7}))/g, publicIp);
                        return offer;
                    });
                };
                setNative(pc.createOffer, 'createOffer');
                return pc;
            };
            mockRTCPeerConnection.prototype = oldRTCPeerConnection.prototype;
            setNative(mockRTCPeerConnection, 'RTCPeerConnection');
            window.RTCPeerConnection = mockRTCPeerConnection;
            if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = mockRTCPeerConnection;
        }
    }

    // 4. Permissions & Notifications
    if (typeof Notification !== 'undefined') {
        const oldRequest = Notification.requestPermission;
        Notification.requestPermission = function() {
            return Promise.resolve('granted');
        };
        setNative(Notification.requestPermission, 'requestPermission');
        hook(Notification, 'permission', 'granted');
    } else {
        const mockNotification = function(title, options) {
            this.title = title;
            this.close = function() {};
            setNative(this.close, 'close');
        };
        mockNotification.requestPermission = function() { return Promise.resolve('granted'); };
        mockNotification.permission = 'granted';
        setNative(mockNotification, 'Notification');
        setNative(mockNotification.requestPermission, 'requestPermission');
        window.Notification = mockNotification;
    }

    if (typeof Permissions !== 'undefined' && Permissions.prototype.query) {
        const oldQuery = Permissions.prototype.query;
        Permissions.prototype.query = function(queryObj) {
            if (queryObj && (queryObj.name === 'notifications' || queryObj.name === 'geolocation')) {
                const status = Object.create(PermissionStatus.prototype);
                hook(status, 'name', queryObj.name);
                hook(status, 'state', 'granted');
                hook(status, 'onchange', null);
                return Promise.resolve(status);
            }
            return oldQuery.apply(this, arguments);
        };
        setNative(Permissions.prototype.query, 'query');
    }

    // 5. Automation & CDC Cleanup
    const clean = () => {
      try {
        // 5.0 Chrome Object Mocking
        if (fp.ultraStealth && fp.ultraStealth.chromeObject && !window.chrome) {
            const chrome = {
                app: {
                    isInstalled: false,
                    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
                },
                runtime: {
                    OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
                    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                    PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                    RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
                },
                loadTimes: function() { return {}; },
                csi: function() { return {}; }
            };
            setNative(chrome.loadTimes, 'loadTimes');
            setNative(chrome.csi, 'csi');
            window.chrome = chrome;
        }

        const proto = Navigator.prototype;
        if (proto.hasOwnProperty('webdriver')) {
            delete proto.webdriver;
        }
        Object.defineProperty(proto, 'webdriver', { get: () => false, configurable: true, enumerable: true });
        
        // 5.1 Geolocation Hook (Double Layer)
        if (fp.geolocation && navigator.geolocation) {
            const coords = {
                latitude: fp.geolocation.latitude,
                longitude: fp.geolocation.longitude,
                accuracy: fp.geolocation.accuracy || 10,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null
            };
            
            const position = {
                coords: coords,
                timestamp: Date.now()
            };

            navigator.geolocation.getCurrentPosition = function(success) {
                setTimeout(() => success(position), 10);
            };
            setNative(navigator.geolocation.getCurrentPosition, 'getCurrentPosition');

            navigator.geolocation.watchPosition = function(success) {
                setTimeout(() => success(position), 10);
                return Math.floor(Math.random() * 1000);
            };
            setNative(navigator.geolocation.watchPosition, 'watchPosition');
        }

        const keys = [
            '__last_focus_id', 'cdc_adoiery6178e7_Array', 'cdc_adoiery6178e7_Promise', 
            'cdc_adoiery6178e7_Symbol', '__webdriver_evaluate', '__webdriver_unwrapped',
            '__webdriver_script_function', '__webdriver_script_func', '__webdriver_script_fn',
            '$cdc_asdjflasdf_', '$chrome_asyncScriptInfo', '__$webdriverAsyncExecutor'
        ];
        keys.forEach(k => {
            if (window[k] !== undefined) window[k] = undefined;
            if (document[k] !== undefined) document[k] = undefined;
        });
      } catch(e) {}
    };
    
    clean();
    setInterval(clean, 500);

    // Iframe Support
    const originalCreate = document.createElement;
    document.createElement = function(tag) {
        const el = originalCreate.apply(this, arguments);
        if (tag && tag.toLowerCase() === 'iframe') {
            try {
                Object.defineProperty(el, 'contentWindow', {
                    get: function() {
                        const win = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get.apply(this);
                        if (win && !win._patched) {
                            win._patched = true;
                            // Basic patch for sub-frames
                            Object.defineProperty(win.navigator, 'webdriver', { get: () => false });
                        }
                        return win;
                    }
                });
            } catch(e) {}
        }
        return el;
    };
    setNative(document.createElement, 'createElement');

    console.log('✓ Stealth Engine Ready');
  } catch(e) {}
})();`;
  }
}

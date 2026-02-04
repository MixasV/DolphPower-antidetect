# Core Features

DolfPower offers a suite of advanced features designed to give you complete control over your digital identities.

## 1. Browser Profile Isolation
Every profile in DolfPower is a completely isolated environment.
- **Separate Cookies & Cache**: Data never leaks between sessions.
- **Isolated Storage**: LocalStorage and IndexedDB are unique to each profile.
- **Unique Fingerprints**: Each profile appears as a different physical device to websites.

## 2. Advanced Fingerprint Spoofing
We customize over 40 hardware and software parameters to make your profiles unique:
- **Canvas & WebGL**: Noise injection to prevent hardware-based tracking.
- **Audio Context**: Spoofing of audio hardware signatures.
- **Screen & Resolution**: Custom resolutions, color depth, and pixel ratios.
- **Navigator Properties**: User Agent, platform, languages, hardware concurrency, and device memory.
- **Timezone & Geolocation**: Automatic synchronization based on proxy or manual override.
- **WebRTC**: Modes to leak real IP, disable it, or provide an "altered" IP that matches your proxy.

## 3. Integrated Proxy Management
- Support for **HTTP, HTTPS, and SOCKS5** protocols.
- **Proxy Testing**: Verify speed and connectivity before launching.
- **IP Info Checker**: Detailed data on IP, country, city, and ISP.
- **Free Proxy Fetcher**: Built-in tool to source and test proxies from public lists (GeoNode, ProxyScrape).

## 4. Extension & Bookmark Management
- **Global Extensions**: Automatically install specific extensions (like uBlock or MetaMask) into every new profile.
- **Shared Bookmarks**: Maintain a consistent set of bookmarks across your entire farm.

## 5. Group Organization
Organize hundreds of profiles into groups with custom colors and descriptions for easier management.

## 6. Real-time Monitoring
- Monitor running browser instances.
- Track resource usage (CPU/RAM) to optimize concurrency.
- Automatic trash cleanup for deleted profiles.

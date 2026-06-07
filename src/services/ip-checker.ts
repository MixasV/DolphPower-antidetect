import { spawn } from 'child_process';
import util from 'util';

export interface IPInfo {
    ip: string;
    country: string;
    countryCode: string;
    region: string;
    city: string;
    zip: string;
    lat: number;
    lon: number;
    timezone: string;
    isp: string;
    org: string;
    as: string;
    proxy: boolean;
    hosting: boolean;
}

export interface ProxyCheckResult {
    success: boolean;
    latency: number;
    info?: IPInfo;
    error?: string;
}

export class IPChecker {
    private providers: Array<{
        name: string;
        url: string;
        parse: (data: any) => Partial<IPInfo>;
    }> = [
        {
            name: 'ip-api',
            url: 'http://ip-api.com/json/?fields=status,message,country,countryCode,region,city,zip,lat,lon,timezone,isp,org,as,proxy,hosting,query',
            parse: (data) => ({
                ip: data.query,
                country: data.country,
                countryCode: data.countryCode,
                region: data.region,
                city: data.city,
                zip: data.zip,
                lat: data.lat,
                lon: data.lon,
                timezone: data.timezone,
                isp: data.isp,
                org: data.org,
                as: data.as,
                proxy: data.proxy,
                hosting: data.hosting,
            }),
        },
        {
            name: 'ipapi',
            url: 'https://ipapi.co/json/',
            parse: (data) => ({
                ip: data.ip,
                country: data.country_name,
                countryCode: data.country_code,
                region: data.region,
                city: data.city,
                zip: data.postal,
                lat: data.latitude,
                lon: data.longitude,
                timezone: data.timezone,
                isp: data.org,
                org: data.org,
                as: data.asn,
                proxy: false,
                hosting: false,
            }),
        },
        {
            name: 'ipify',
            url: 'https://api.ipify.org?format=json',
            parse: (data) => ({
                ip: data.ip,
            }),
        },
        {
            name: 'ip-api-direct',
            url: 'http://ip-api.com/json/',
            parse: (data) => ({
                ip: data.query,
                country: data.country,
                countryCode: data.countryCode,
                region: data.regionName,
                city: data.city,
                isp: data.isp,
            }),
        },
        {
            name: 'seeip',
            url: 'https://api.seeip.org/jsonip',
            parse: (data) => ({
                ip: data.ip,
            }),
        }
    ];

    private async runCurl(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const cp = spawn('curl', args, { windowsHide: true });
            let stdout = '';
            let stderr = '';
            cp.stdout.on('data', d => stdout += d.toString());
            cp.stderr.on('data', d => stderr += d.toString());
            cp.on('close', code => {
                if (code === 0) resolve(stdout);
                else reject(new Error(stderr || `Exit code ${code}`));
            });
            cp.on('error', err => reject(err));
            
            // Safety timeout
            setTimeout(() => {
                try { cp.kill(); } catch(e) {}
                reject(new Error('Curl request timed out'));
            }, 20000);
        });
    }

    async checkIP(proxyConfig?: {
        protocol: string;
        host: string;
        port: number;
        username?: string;
        password?: string;
    }): Promise<ProxyCheckResult> {
        const startTime = Date.now();

        // Use curl for more reliable proxy checking (supports SOCKS5 and complex auth)
        if (proxyConfig) {
            try {
                const protocol = proxyConfig.protocol.replace(':', '');
                
                // Use multiple check URLs for curl to ensure reliability
                const checkUrls = [
                    "http://ip-api.com/json/?fields=status,message,country,countryCode,region,city,zip,lat,lon,timezone,isp,org,as,proxy,hosting,query",
                    "https://ipapi.co/json/",
                    "https://api.ipify.org?format=json"
                ];

                for (const url of checkUrls) {
                    try {
                        const args = ['-s', '-i', '--connect-timeout', '15', '--max-time', '20', '--insecure', '-L'];
                        
                        // Proxy configuration
                        let protocolPrefix = protocol;
                        if (protocol === 'socks5' || protocol === 'socks4') {
                            protocolPrefix = protocol + 'h'; 
                        }
                        
                        const proxyUrl = `${proxyConfig.host}:${proxyConfig.port}`;
                        args.push('--proxy', `${protocolPrefix}://${proxyUrl}`);
                        
                        if (proxyConfig.username) {
                            // Use basic auth strictly if provided to avoid 407 on initial probe
                            // Adding --proxy-basic to force basic authentication
                            args.push('--proxy-user', `${proxyConfig.username}:${proxyConfig.password || ''}`);
                            args.push('--proxy-basic');
                        }
                        
                        args.push(url);
                        console.log(`[IPChecker] Running: curl ${args.join(' ')}`);

                        const output = await this.runCurl(args);
                        if (!output) {
                            console.warn(`[IPChecker] No output from curl for ${url}`);
                            continue;
                        }

                        // Robust status code checking for multiple header blocks (due to -L redirects)
                        const headerBlocks = output.split('\r\n\r\n');
                        const lastHeaderBlock = headerBlocks.length > 1 ? headerBlocks[headerBlocks.length - 2] : '';
                        const body = headerBlocks[headerBlocks.length - 1] || '';
                        
                        const statusLine = lastHeaderBlock.split('\n')[0];
                        const statusCode = statusLine ? parseInt(statusLine.split(' ')[1]) : 0;

                        console.log(`[IPChecker] Final Status Code: ${statusCode} for ${url}`);

                        if (statusCode === 407) {
                            return { success: false, latency: Date.now() - startTime, error: 'Proxy Authentication Failed (407). Check credentials.' };
                        }
                        if (statusCode >= 500) {
                            return { success: false, latency: Date.now() - startTime, error: `Proxy Gateway Error (${statusCode}).` };
                        }
                        if (statusCode === 403) {
                            return { success: false, latency: Date.now() - startTime, error: 'Proxy Access Forbidden (403).' };
                        }
                        if (statusCode === 0 || (statusCode >= 400 && statusCode < 500)) {
                             // If it's a 4xx error (other than 407/403), we might still want to try next provider
                             continue;
                        }
                        
                        try {
                            const data = JSON.parse(body);
                            if (data.status === 'success' || data.ip || data.query) {
                                const latency = Date.now() - startTime;
                                // Normalization
                                const info: IPInfo = {
                                    ip: data.query || data.ip || '',
                                    country: data.country || data.country_name || '',
                                    countryCode: data.countryCode || data.country_code || '',
                                    region: data.region || data.region_name || '',
                                    city: data.city || '',
                                    zip: data.zip || data.postal || '',
                                    lat: data.lat || data.latitude || 0,
                                    lon: data.lon || data.longitude || 0,
                                    timezone: data.timezone || '',
                                    isp: data.isp || data.org || '',
                                    org: data.org || '',
                                    as: data.as || data.asn || '',
                                    proxy: data.proxy || false,
                                    hosting: data.hosting || false,
                                };
                                return { success: true, latency, info };
                            }
                        } catch (parseErr) {
                            // If JSON parsing fails, but we have a response, maybe it's not JSON
                            continue;
                        }
                    } catch (innerErr: any) {
                        const errorMsg = innerErr.message || String(innerErr);
                        if (errorMsg.includes('407')) return { success: false, latency: Date.now() - startTime, error: 'Proxy Auth Failed' };
                        continue;
                    }
                }
            } catch (e: any) {
                console.warn('[IPChecker] Curl proxy check failed:', e.message);
            }
        }

        // Fallback or Direct check using axios
        const axios = require('axios');
        for (const provider of this.providers) {
            try {
                const config: any = {
                    url: provider.url,
                    timeout: 15000,
                };

                if (proxyConfig) {
                    // Axios proxy config
                    const protocol = proxyConfig.protocol.replace(':', '');
                    config.proxy = {
                        protocol: protocol,
                        host: proxyConfig.host,
                        port: proxyConfig.port
                    };
                    
                    // Auth for axios: handle empty passwords correctly
                    if (proxyConfig.username) {
                        config.proxy.auth = {
                            username: proxyConfig.username,
                            password: proxyConfig.password || ''
                        };
                    }
                }

                const response = await axios.get(config.url, config);
                const latency = Date.now() - startTime;

                if (response.data) {
                    const parsed = provider.parse(response.data);

                    if (parsed.ip) {
                        return {
                            success: true,
                            latency,
                            info: {
                                ip: parsed.ip || '',
                                country: parsed.country || 'Unknown',
                                countryCode: parsed.countryCode || 'XX',
                                region: parsed.region || '',
                                city: parsed.city || '',
                                zip: parsed.zip || '',
                                lat: parsed.lat || 0,
                                lon: parsed.lon || 0,
                                timezone: parsed.timezone || '',
                                isp: parsed.isp || '',
                                org: parsed.org || '',
                                as: parsed.as || '',
                                proxy: parsed.proxy || false,
                                hosting: parsed.hosting || false,
                            },
                        };
                    }
                }
            } catch (error) {
                continue;
            }
        }

        return {
            success: false,
            latency: Date.now() - startTime,
            error: 'All IP check providers failed',
        };
    }

    async checkProxyIP(proxy: {
        protocol: 'http' | 'https' | 'socks5';
        host: string;
        port: number;
        username?: string;
        password?: string;
    }): Promise<ProxyCheckResult> {
        return this.checkIP({
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
        });
    }

    async getMyIP(): Promise<ProxyCheckResult> {
        return this.checkIP();
    }

    getTimezoneForLocation(lat: number, lon: number): string {
        const timezones: Array<{ lat: number; lon: number; tz: string }> = [
            { lat: 40.7128, lon: -74.0060, tz: 'America/New_York' },
            { lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
            { lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
            { lat: 51.5074, lon: -0.1278, tz: 'Europe/London' },
            { lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
            { lat: 52.5200, lon: 13.4050, tz: 'Europe/Berlin' },
            { lat: 55.7558, lon: 37.6173, tz: 'Europe/Moscow' },
            { lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
            { lat: 31.2304, lon: 121.4737, tz: 'Asia/Shanghai' },
            { lat: 22.3193, lon: 114.1694, tz: 'Asia/Hong_Kong' },
            { lat: 1.3521, lon: 103.8198, tz: 'Asia/Singapore' },
            { lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
            { lat: 19.4326, lon: -99.1332, tz: 'America/Mexico_City' },
            { lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo' },
            { lat: 28.6139, lon: 77.2090, tz: 'Asia/Kolkata' },
            { lat: 37.5665, lon: 126.9780, tz: 'Asia/Seoul' },
        ];

        let closest = timezones[0];
        let minDistance = Infinity;

        for (const tz of timezones) {
            const distance = Math.sqrt(
                Math.pow(lat - tz.lat, 2) + Math.pow(lon - tz.lon, 2)
            );
            if (distance < minDistance) {
                minDistance = distance;
                closest = tz;
            }
        }

        return closest.tz;
    }

    getLanguageForCountry(countryCode: string): string {
        const languages: Record<string, string> = {
            'US': 'en-US',
            'GB': 'en-GB',
            'CA': 'en-CA',
            'AU': 'en-AU',
            'DE': 'de-DE',
            'FR': 'fr-FR',
            'ES': 'es-ES',
            'IT': 'it-IT',
            'PT': 'pt-PT',
            'BR': 'pt-BR',
            'RU': 'ru-RU',
            'JP': 'ja-JP',
            'CN': 'zh-CN',
            'KR': 'ko-KR',
            'IN': 'hi-IN',
            'MX': 'es-MX',
            'AR': 'es-AR',
            'NL': 'nl-NL',
            'PL': 'pl-PL',
            'TR': 'tr-TR',
            'TH': 'th-TH',
            'VN': 'vi-VN',
            'ID': 'id-ID',
            'PH': 'fil-PH',
            'MY': 'ms-MY',
            'SG': 'en-SG',
            'HK': 'zh-HK',
            'TW': 'zh-TW',
            'UA': 'uk-UA',
            'CZ': 'cs-CZ',
            'SE': 'sv-SE',
            'NO': 'nb-NO',
            'DK': 'da-DK',
            'FI': 'fi-FI',
        };

        return languages[countryCode.toUpperCase()] || 'en-US';
    }
}

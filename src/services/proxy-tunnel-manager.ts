import net from 'net';
import tls from 'tls';

export class ProxyTunnelManager {
    private activeTunnels: Map<string, net.Server> = new Map();
    private blockedProfiles: Set<string> = new Set();

    private allowedHosts: string[] = [
        'ip-api.com',
        'ipapi.co',
        'ip.nf',
        'api.ipify.org',
        'icanhazip.com',
        'ident.me',
        'ifconfig.me',
        'api.myip.com',
        '127.0.0.1',
        'localhost',
        'google.com'
    ];

    async createHttpTunnel(profileId: string, proxy: { protocol: string; host: string; port: number; username?: string; password?: string }, startBlocked: boolean = false): Promise<number> {
        if (startBlocked) {
            this.blockedProfiles.add(profileId);
        }

        return new Promise((resolve, reject) => {
            const server = net.createServer((clientSocket) => {
                let isUnlocked = !this.blockedProfiles.has(profileId);
                let remoteSocket: net.Socket | null = null;
                let buffer: Buffer[] = [];
                let sniffedHost: string | null = null;
                let isTunneling = false; // For HTTPS CONNECT streams
                let handshaked = proxy.protocol !== 'socks5';

                const auth = (proxy.username) ? 
                    Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64') : null;

                const connectToRemote = () => {
                    if (remoteSocket) return;
                    
                    const isHttpsProxy = proxy.protocol === 'https';
                    
                    if (isHttpsProxy) {
                        remoteSocket = tls.connect(proxy.port, proxy.host, { rejectUnauthorized: false });
                    } else {
                        remoteSocket = net.connect(proxy.port, proxy.host);
                    }

                    const performSocks5Handshake = () => {
                        if (!remoteSocket) return;

                        // Phase 1: Greeting
                        const greeting = (proxy.username) ? 
                            Buffer.from([0x05, 0x02, 0x00, 0x02]) : // No auth, User/Pass
                            Buffer.from([0x05, 0x01, 0x00]);        // No auth only
                        
                        remoteSocket.write(greeting);

                        remoteSocket.once('data', (data) => {
                            if (data[0] !== 0x05) return;
                            
                            const method = data[1];
                            if (method === 0x02 && proxy.username) {
                                // User/Pass Auth
                                const uLen = proxy.username.length;
                                const password = proxy.password || '';
                                const pLen = password.length;
                                const authData = Buffer.concat([
                                    Buffer.from([0x01, uLen]),
                                    Buffer.from(proxy.username),
                                    Buffer.from([pLen]),
                                    Buffer.from(password)
                                ]);
                                remoteSocket!.write(authData);
                                
                                remoteSocket!.once('data', (authRes) => {
                                    if (authRes[1] === 0x00) sendConnectRequest();
                                });
                            } else if (method === 0x00) {
                                sendConnectRequest();
                            }
                        });
                    };

                    const sendConnectRequest = () => {
                        if (!remoteSocket) return;

                        const target = sniffedHost || 'google.com:443';
                        
                        if (proxy.protocol === 'socks5') {
                            console.log(`[Tunnel] SOCKS5 CONNECT to ${target} for profile ${profileId}`);
                            let host: string;
                            let port: number;

                            if (target.includes(':')) {
                                const parts = target.split(':');
                                host = parts[0];
                                port = parseInt(parts[1]);
                            } else {
                                host = target;
                                port = 80; 
                            }

                            const isIP = net.isIP(host);
                            let request;

                            if (isIP === 4) {
                                const ipParts = host.split('.').map(p => parseInt(p));
                                request = Buffer.concat([
                                    Buffer.from([0x05, 0x01, 0x00, 0x01]),
                                    Buffer.from(ipParts),
                                    Buffer.from([ (port >> 8) & 0xff, port & 0xff ])
                                ]);
                            } else {
                                const hostBuf = Buffer.from(host);
                                request = Buffer.concat([
                                    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                                    hostBuf,
                                    Buffer.from([ (port >> 8) & 0xff, port & 0xff ])
                                ]);
                            }

                            remoteSocket.write(request);
                            remoteSocket.once('data', (res) => {
                                if (res[1] === 0x00) {
                                    handshaked = true;
                                    
                                    let connectIndex = -1;
                                    for(let i = 0; i < buffer.length; i++) {
                                        if (buffer[i].toString('binary').startsWith('CONNECT ')) {
                                            connectIndex = i;
                                            break;
                                        }
                                    }

                                    if (connectIndex !== -1) {
                                        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                                        buffer.splice(connectIndex, 1);
                                    }
                                    
                                    flushBuffer();
                                }
                            });
                        } else {
                            // For HTTP/HTTPS proxies, we don't "handshake" SOCKS style.
                            // We just need to forward the requests, including the CONNECT ones.
                            handshaked = true;
                            flushBuffer();
                        }
                    };

                    const flushBuffer = () => {
                        if (!handshaked) return;
                        if (remoteSocket && remoteSocket.writable) {
                            while (buffer.length > 0) {
                                let data = buffer.shift()!;
                                if (proxy.protocol === 'http' || proxy.protocol === 'https') {
                                    if (auth) {
                                        let dataStr = data.toString('binary');
                                        // Improved injection: check for request line more strictly
                                        if (/^(CONNECT|GET|POST|PUT|DELETE|OPTIONS|HEAD|PATCH) /i.test(dataStr) && !dataStr.includes('Proxy-Authorization:')) {
                                            const authHeader = `Proxy-Authorization: Basic ${auth}\r\n`;
                                            // Find the first line ending
                                            const index = dataStr.indexOf('\r\n');
                                            if (index !== -1) {
                                                data = Buffer.from(
                                                    dataStr.slice(0, index + 2) + 
                                                    authHeader + 
                                                    dataStr.slice(index + 2), 
                                                    'binary'
                                                );
                                                console.log(`[Tunnel] Injected Proxy-Authorization into buffered request`);
                                            }
                                        }
                                    }
                                }
                                remoteSocket.write(data);
                            }
                        }
                    };

                    remoteSocket.on('connect', () => {
                        if (proxy.protocol === 'socks5') {
                            performSocks5Handshake();
                        } else {
                            flushBuffer();
                        }
                    });

                    if (isHttpsProxy) {
                        remoteSocket.on('secureConnect', () => {
                            flushBuffer();
                        });
                    }

                    remoteSocket.on('data', (data) => {
                        if (clientSocket.writable) {
                            clientSocket.write(data);

                            // Detect successful CONNECT response to stop injecting headers into the encrypted stream
                            if (!isTunneling && (proxy.protocol === 'http' || proxy.protocol === 'https')) {
                                const respStr = data.toString('binary');
                                if (respStr.includes('200 Connection Established') || respStr.includes('HTTP/1.1 200') || respStr.includes('HTTP/1.0 200 OK')) {
                                    isTunneling = true;
                                    console.log(`[Tunnel] HTTPS Tunnel established to ${sniffedHost || 'remote'}`);
                                }
                            }
                        }
                    });

                    const cleanup = () => {
                        clientSocket.destroy();
                        if (remoteSocket) remoteSocket.destroy();
                    };

                    clientSocket.on('error', cleanup);
                    remoteSocket.on('error', cleanup);
                    clientSocket.on('close', cleanup);
                    remoteSocket.on('close', cleanup);
                };

                clientSocket.on('data', (data) => {
                    if (isUnlocked) {
                        if (!remoteSocket) {
                            const dataStr = data.toString('binary');
                            const match = dataStr.match(/(?:CONNECT\s+([a-zA-Z0-9.-]+(?::\d+)?)|Host:\s+([a-zA-Z0-9.-]+))/i);
                            if (match) {
                                sniffedHost = match[1] || match[2];
                            }
                            connectToRemote();
                        }

                        let dataToProxy = data;
                        // Inject Proxy-Authorization if needed, but ONLY for HTTP/HTTPS proxies and NOT inside an established tunnel
                        if (!isTunneling && (proxy.protocol === 'http' || proxy.protocol === 'https') && auth) {
                            const dataStr = data.toString('binary');
                            // Check for request line
                            if (/^(CONNECT|GET|POST|PUT|DELETE|OPTIONS|HEAD|PATCH) /i.test(dataStr) && !dataStr.includes('Proxy-Authorization:')) {
                                const authHeader = `Proxy-Authorization: Basic ${auth}\r\n`;
                                const index = dataStr.indexOf('\r\n');
                                if (index !== -1) {
                                    dataToProxy = Buffer.from(
                                        dataStr.slice(0, index + 2) + 
                                        authHeader + 
                                        dataStr.slice(index + 2), 
                                        'binary'
                                    );
                                    console.log(`[Tunnel] Injected Proxy-Authorization for ${sniffedHost || 'unknown host'}`);
                                }
                            }
                        }

                        if (remoteSocket && remoteSocket.writable && handshaked) {
                            remoteSocket.write(dataToProxy);
                        } else {
                            buffer.push(dataToProxy);
                        }
                        return;
                    }

                    // Blocked mode logic
                    const dataStr = data.toString('binary');
                    const match = dataStr.match(/(?:CONNECT\s+([a-zA-Z0-9.-]+(?::\d+)?)|Host:\s+([a-zA-Z0-9.-]+))/i);
                    if (match) {
                        sniffedHost = match[1] || match[2];
                        if (this.allowedHosts.some(h => sniffedHost?.includes(h))) {
                            console.log(`[Tunnel] Allowing whitelisted host ${sniffedHost} for blocked profile ${profileId}`);
                            connectToRemote();
                            buffer.push(data);
                            return;
                        }
                    }

                    buffer.push(data);
                    console.log(`[Tunnel] Buffered request to ${sniffedHost || 'unknown'} for blocked profile ${profileId}`);
                });

                const checkInterval = setInterval(() => {
                    if (!this.blockedProfiles.has(profileId)) {
                        clearInterval(checkInterval);
                        isUnlocked = true;
                        if (!remoteSocket) connectToRemote();
                        else {
                            while (buffer.length > 0) remoteSocket.write(buffer.shift()!);
                        }
                    }
                }, 100);

                clientSocket.on('close', () => clearInterval(checkInterval));
            });

            server.on('error', reject);

            server.listen(0, '127.0.0.1', () => {
                const port = (server.address() as net.AddressInfo).port;
                this.activeTunnels.set(profileId, server);
                console.log(`🔗 Proxy tunnel for ${profileId} active on 127.0.0.1:${port}`);
                resolve(port);
            });
        });
    }

    async closeTunnel(profileId: string): Promise<void> {
        const server = this.activeTunnels.get(profileId);
        this.blockedProfiles.delete(profileId);
        if (server) {
            return new Promise((resolve) => {
                server.close(() => {
                    this.activeTunnels.delete(profileId);
                    resolve();
                });
            });
        }
    }

    unlockTunnel(profileId: string): void {
        console.log(`🔓 Unlocking proxy tunnel for profile ${profileId}`);
        this.blockedProfiles.delete(profileId);
    }
}

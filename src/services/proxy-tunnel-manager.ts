import net from 'net';

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
        'localhost'
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

                const connectToRemote = () => {
                    if (remoteSocket) return;
                    
                    remoteSocket = net.connect(proxy.port, proxy.host);
                    let handshaked = proxy.protocol !== 'socks5';

                    const auth = (proxy.username && proxy.password) ? 
                        Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64') : null;

                    const performSocks5Handshake = () => {
                        if (!remoteSocket) return;

                        // Phase 1: Greeting
                        const greeting = (proxy.username && proxy.password) ? 
                            Buffer.from([0x05, 0x02, 0x00, 0x02]) : // No auth, User/Pass
                            Buffer.from([0x05, 0x01, 0x00]);        // No auth only
                        
                        remoteSocket.write(greeting);

                        remoteSocket.once('data', (data) => {
                            if (data[0] !== 0x05) return;
                            
                            const method = data[1];
                            if (method === 0x02 && proxy.username && proxy.password) {
                                // User/Pass Auth
                                const uLen = proxy.username.length;
                                const pLen = proxy.password.length;
                                const authData = Buffer.concat([
                                    Buffer.from([0x01, uLen]),
                                    Buffer.from(proxy.username),
                                    Buffer.from([pLen]),
                                    Buffer.from(proxy.password)
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

                        // We need the destination
                        // Since Chromium thinks this is an HTTP proxy, it sends CONNECT host:port or GET http://host...
                        const target = sniffedHost || 'google.com:443';
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
                                
                                // BRIDGE: If the browser sent a CONNECT request, we MUST send a 200 OK back
                                // so it starts sending the TLS handshake (or other payload).
                                const lastData = buffer[buffer.length - 1]?.toString('binary') || '';
                                if (lastData.startsWith('CONNECT ')) {
                                    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                                    buffer.pop(); // Remove the CONNECT request as it's fulfilled
                                }
                                
                                flushBuffer();
                            }
                        });
                    };

                    let authInjected = false;
                    const flushBuffer = () => {
                        if (!handshaked) return;
                        if (remoteSocket && remoteSocket.writable) {
                            while (buffer.length > 0) {
                                let data = buffer.shift()!;
                                if (proxy.protocol === 'http' || proxy.protocol === 'https') {
                                    if (auth && !authInjected) {
                                        let dataStr = data.toString('binary');
                                        if (dataStr.includes('CONNECT ') || dataStr.includes('GET ') || dataStr.includes('POST ')) {
                                            const authHeader = `Proxy-Authorization: Basic ${auth}\r\n`;
                                            const index = dataStr.indexOf('\r\n');
                                            if (index !== -1) {
                                                data = Buffer.from(
                                                    dataStr.slice(0, index + 2) + 
                                                    authHeader + 
                                                    dataStr.slice(index + 2), 
                                                    'binary'
                                                );
                                                authInjected = true;
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

                    remoteSocket.on('data', (data) => {
                        if (clientSocket.writable) {
                            clientSocket.write(data);
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
                            // Try to sniff host/port even if unlocked for SOCKS5 destination
                            const dataStr = data.toString('binary');
                            const match = dataStr.match(/(?:CONNECT\s+([a-zA-Z0-9.-]+(?::\d+)?)|Host:\s+([a-zA-Z0-9.-]+))/i);
                            if (match) {
                                sniffedHost = match[1] || match[2];
                            }
                            connectToRemote();
                        }
                        buffer.push(data);
                        if (remoteSocket && remoteSocket.writable) {
                            while (buffer.length > 0) remoteSocket.write(buffer.shift()!);
                        }
                        return;
                    }

                    // Sniff host for whitelist
                    const dataStr = data.toString('binary');
                    // Improved regex to capture host and port
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

                // Periodically check for unlock
                const checkInterval = setInterval(() => {
                    if (!this.blockedProfiles.has(profileId)) {
                        clearInterval(checkInterval);
                        isUnlocked = true;
                        if (!remoteSocket) connectToRemote();
                        else {
                            // If it was already connected for whitelisted host, just flush remaining buffer
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

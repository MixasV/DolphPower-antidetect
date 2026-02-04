import axios from 'axios';

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: any;
}

export class MCPManager {
    private servers: string[] = [];

    constructor(serverList?: string[]) {
        if (serverList) {
            this.servers = serverList;
        }
    }

    setServers(servers: string[]) {
        this.servers = servers;
    }

    async getAllTools(): Promise<MCPTool[]> {
        const allTools: MCPTool[] = [];
        
        for (const url of this.servers) {
            try {
                // MCP HTTP spec usually has /tools endpoint
                const response = await axios.post(url, {
                    jsonrpc: '2.0',
                    method: 'tools/list',
                    params: {},
                    id: Date.now()
                }, { timeout: 3000 });

                if (response.data && response.data.result && response.data.result.tools) {
                    allTools.push(...response.data.result.tools);
                }
            } catch (error: any) {
                console.error(`[MCP] Failed to fetch tools from ${url}:`, error.message);
            }
        }
        
        return allTools;
    }

    async callTool(toolName: string, args: any): Promise<any> {
        for (const url of this.servers) {
            try {
                // Try to find which server has this tool by calling it or we could have mapped it in getAllTools
                // For simplicity, we'll try each server or implement a mapping
                const response = await axios.post(url, {
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: {
                        name: toolName,
                        arguments: args
                    },
                    id: Date.now()
                }, { timeout: 10000 });

                if (response.data && response.data.result) {
                    return response.data.result;
                }
                
                if (response.data && response.data.error) {
                    // Tool might not exist on this server, continue
                    if (response.data.error.message.includes('not found')) continue;
                    return { error: response.data.error.message };
                }
            } catch (error: any) {
                // Skip failed server
                continue;
            }
        }
        return { error: `Tool ${toolName} not found on any MCP server.` };
    }
}

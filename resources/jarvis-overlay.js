(function() {
    if (window.__dolfJarvisOverlay) return;

    const shadow = document.createElement('div').attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    container.id = 'jarvis-overlay-container';

    const style = document.createElement('style');
    style.textContent = `
        :host {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        #jarvis-bubble {
            width: 60px;
            height: 60px;
            background: #4f46e5;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: white;
            font-size: 30px;
            transition: transform 0.2s;
        }
        #jarvis-bubble:hover { transform: scale(1.1); }
        
        #jarvis-panel {
            display: none;
            width: 350px;
            height: 500px;
            background: #1e1e2d;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            flex-direction: column;
            overflow: hidden;
            border: 1px solid #2f2f42;
        }
        #jarvis-panel.active { display: flex; }
        
        .header {
            padding: 12px 16px;
            background: #2a2a3c;
            color: white;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .close-btn { cursor: pointer; opacity: 0.7; }
        .close-btn:hover { opacity: 1; }

        .chat-area {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            background: #13131a;
        }
        .message {
            max-width: 85%;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 13px;
            line-height: 1.4;
        }
        .message.user { align-self: flex-end; background: #4f46e5; color: white; }
        .message.assistant { align-self: flex-start; background: #2a2a3c; color: #e1e1e1; border: 1px solid #2f2f42; }

        .input-area {
            padding: 12px;
            background: #1e1e2d;
            border-top: 1px solid #2f2f42;
            display: flex;
            gap: 8px;
        }
        input {
            flex: 1;
            background: #13131a;
            border: 1px solid #2f2f42;
            color: white;
            padding: 8px;
            border-radius: 4px;
            outline: none;
        }
        button {
            background: #4f46e5;
            color: white;
            border: none;
            padding: 0 12px;
            border-radius: 4px;
            cursor: pointer;
        }
    `;

    container.innerHTML = `
        <div id="jarvis-bubble">🐬</div>
        <div id="jarvis-panel">
            <div class="header">
                <span>Jarvis AI</span>
                <span class="close-btn">✕</span>
            </div>
            <div class="chat-area" id="jarvis-chat">
                <div class="message assistant">Hello! I'm here to help with this session. What should we do?</div>
            </div>
            <div class="input-area">
                <input type="text" id="jarvis-input" placeholder="Message Jarvis...">
                <button id="jarvis-send">Send</button>
            </div>
        </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(container);
    document.body.appendChild(shadow);

    const bubble = container.querySelector('#jarvis-bubble');
    const panel = container.querySelector('#jarvis-panel');
    const closeBtn = container.querySelector('.close-btn');
    const input = container.querySelector('#jarvis-input');
    const sendBtn = container.querySelector('#jarvis-send');
    const chat = container.querySelector('#jarvis-chat');

    const API_BASE = 'http://127.0.0.1:3001/v1.0/jarvis';

    bubble.onclick = () => {
        panel.classList.add('active');
        bubble.style.display = 'none';
    };

    closeBtn.onclick = () => {
        panel.classList.remove('active');
        bubble.style.display = 'flex';
    };

    const addMessage = (role, content) => {
        const msg = document.createElement('div');
        msg.className = `message ${role}`;
        // Support for JSON scripts in overlay
        if (content.trim().startsWith('[') && content.trim().endsWith(']')) {
            msg.innerHTML = `<div style="font-family:monospace; font-size:11px; background:#000; padding:8px; border-radius:4px; color:#0f0;">Script Generated. See main app for details.</div>`;
        } else {
            msg.textContent = content;
        }
        chat.appendChild(msg);
        chat.scrollTop = chat.scrollHeight;
    };

    const loadHistory = async () => {
        if (!window.__dolfJarvisSessionId) return;
        try {
            const res = await fetch(`${API_BASE}/sessions/${window.__dolfJarvisSessionId}`);
            const data = await res.json();
            if (data.success && data.data.history) {
                chat.innerHTML = '';
                data.data.history.forEach(msg => addMessage(msg.role, msg.content));
            }
        } catch (e) {}
    };

    const sendMessage = async () => {
        const text = input.value.trim();
        if (!text) return;

        addMessage('user', text);
        input.value = '';

        // Gather page context
        const pageContext = {
            url: window.location.href,
            title: document.title,
            html: document.body.innerText.substring(0, 2000) // Simple text context to save tokens
        };

        try {
            const res = await fetch(`${API_BASE}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: text,
                    session_id: window.__dolfJarvisSessionId,
                    page_context: pageContext
                })
            });
            const data = await res.json();
            if (data.success) {
                addMessage('assistant', data.data.response);
            } else {
                addMessage('assistant', 'Error: ' + data.error);
            }
        } catch (e) {
            addMessage('assistant', 'Connection error');
        }
    };

    sendBtn.onclick = sendMessage;
    input.onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };

    // Initial load
    setTimeout(loadHistory, 500);

    window.__dolfJarvisOverlay = {
        addSystemMessage: (msg) => addMessage('assistant', '[System] ' + msg),
        refresh: loadHistory
    };
})();

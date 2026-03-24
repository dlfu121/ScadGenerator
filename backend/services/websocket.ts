import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// WebSocket 客户端会话模型。
interface ClientSession {
  id: string;
  ws: WebSocket;
  lastActivity: Date;
}

const sessions = new Map<string, ClientSession>();

// 创建并管理 WebSocket 服务实例。
export function createWebSocketServer(server: any) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    // 每个连接分配独立会话，用于状态同步与生命周期管理。
    const sessionId = uuidv4();
    const session: ClientSession = {
      id: sessionId,
      ws,
      lastActivity: new Date()
    };

    sessions.set(sessionId, session);
    console.log(`WebSocket客户端连接: ${sessionId}`);

    ws.send(JSON.stringify({
      type: 'connected',
      sessionId
    }));

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        // 收到任何消息都刷新活跃时间，避免误清理在线会话。
        session.lastActivity = new Date();

        switch (data.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'update_parameters':
            // 当前实现为“回发当前会话”，后续可扩展为协同广播。
            broadcastToSession(sessionId, {
              type: 'parameters_updated',
              parameters: data.parameters
            });
            break;
        }
      } catch (error) {
        console.error('WebSocket消息处理错误:', error);
      }
    });

    ws.on('close', () => {
      sessions.delete(sessionId);
      console.log(`WebSocket客户端断开: ${sessionId}`);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket错误 (${sessionId}):`, error);
      sessions.delete(sessionId);
    });
  });

  // 定时清理超过 30 分钟未活动的会话，防止内存持续增长。
  setInterval(() => {
    const now = new Date();
    sessions.forEach((session, id) => {
      if (now.getTime() - session.lastActivity.getTime() > 30 * 60 * 1000) { // 30分钟
        session.ws.close();
        sessions.delete(id);
      }
    });
  }, 5 * 60 * 1000); // 每5分钟检查一次
}

function broadcastToSession(sessionId: string, message: any) {
  // 仅在连接可写时发送，避免 CLOSED/CLOSING 状态抛错。
  const session = sessions.get(sessionId);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(message));
  }
}

export function emitSessionEvent(sessionId: string, event: Record<string, unknown>) {
  if (!sessionId) {
    return;
  }

  broadcastToSession(sessionId, event);
}

export function getSession(sessionId: string): ClientSession | undefined {
  return sessions.get(sessionId);
}

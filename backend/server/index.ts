import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import parametricChatRouter from '../routes/parametric-chat';
import { createWebSocketServer } from '../services/websocket';

const app = express();
const PORT = process.env.PORT || 5001;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '5mb';

// 基础中间件：允许跨域并解析 JSON 请求体。
app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// 挂载参数化对话接口。
app.use('/api/parametric-chat', parametricChatRouter);

// 启动 HTTP 服务。
const server = app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

// 基于同一 HTTP 服务创建 WebSocket 通道。
createWebSocketServer(server);

export default app;

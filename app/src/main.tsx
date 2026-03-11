import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 创建 React 18 根节点，统一挂载应用。
const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// 使用 StrictMode 便于在开发阶段发现潜在副作用。
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

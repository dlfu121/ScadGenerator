import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';

export type CompileStatus = 'queued' | 'running' | 'success' | 'error';

// 状态接口定义
export interface AppState {
  sessionId: string;
  isOpen: boolean;
  isLoading: boolean;
  prompt: string;
  openscadCode: string;
  parameters: Record<string, any>;
  stlData?: ArrayBuffer;
  compileStatus: CompileStatus;
  compileProgress: number;
  compileMessage: string;
  compileErrorDetail?: string;
  error?: string;
  history: HistoryItem[];
}

interface HistoryItem {
  id: string;
  prompt: string;
  openscadCode: string;
  parameters: Record<string, any>;
  timestamp: Date;
}

// 动作类型定义：集中描述可触发的状态变更。
export type AppAction =
  | { type: 'SET_SESSION_ID'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_PROMPT'; payload: string }
  | { type: 'SET_OPENSCAD_CODE'; payload: string }
  | { type: 'SET_PARAMETERS'; payload: Record<string, any> }
  | { type: 'SET_STL_DATA'; payload?: ArrayBuffer }
  | { type: 'SET_COMPILE_STATUS'; payload: CompileStatus }
  | { type: 'SET_COMPILE_PROGRESS'; payload: number }
  | { type: 'SET_COMPILE_MESSAGE'; payload: string }
  | { type: 'SET_COMPILE_ERROR_DETAIL'; payload?: string }
  | { type: 'SET_ERROR'; payload?: string }
  | { type: 'CLEAR_COMPILE_ERROR' }
  | { type: 'ADD_TO_HISTORY'; payload: HistoryItem }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'RESET_STATE' };

// 初始状态
const initialState: AppState = {
  sessionId: '',
  isOpen: false,
  isLoading: false,
  prompt: '',
  openscadCode: '',
  parameters: {},
  stlData: undefined,
  compileStatus: 'queued',
  compileProgress: 0,
  compileMessage: '等待编译',
  compileErrorDetail: undefined,
  error: undefined,
  history: []
};

// Reducer：统一处理状态转移逻辑。
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SESSION_ID':
      return { ...state, sessionId: action.payload };
    
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    
    case 'SET_PROMPT':
      return { ...state, prompt: action.payload };
    
    case 'SET_OPENSCAD_CODE':
      return { ...state, openscadCode: action.payload };
    
    case 'SET_PARAMETERS':
      return { ...state, parameters: action.payload };
    
    case 'SET_STL_DATA':
      return { ...state, stlData: action.payload };

    case 'SET_COMPILE_STATUS':
      return { ...state, compileStatus: action.payload };

    case 'SET_COMPILE_PROGRESS':
      return { ...state, compileProgress: Math.max(0, Math.min(100, action.payload)) };

    case 'SET_COMPILE_MESSAGE':
      return { ...state, compileMessage: action.payload };

    case 'SET_COMPILE_ERROR_DETAIL':
      return { ...state, compileErrorDetail: action.payload };
    
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    
    case 'CLEAR_COMPILE_ERROR':
      return { 
        ...state, 
        compileStatus: 'queued' as CompileStatus,
        compileErrorDetail: undefined,
        compileMessage: '等待编译',
        compileProgress: 0
      };
    
    case 'ADD_TO_HISTORY':
      return { 
        ...state, 
        history: [action.payload, ...state.history.slice(0, 9)] // 保留最近10条
      };
    
    case 'CLEAR_HISTORY':
      return { ...state, history: [] };
    
    case 'RESET_STATE':
      return { ...initialState, sessionId: state.sessionId };
    
    default:
      return state;
  }
}

// Context：对外暴露全局状态与 dispatch。
const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

// Provider 组件：管理 WebSocket、持久化与会话恢复。
interface StateProviderProps {
  children: ReactNode;
}

export const StateProvider: React.FC<StateProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // WebSocket 连接管理：负责 session 同步与参数更新消息。
  useEffect(() => {
    let shouldIgnoreClose = false;
    const ws = new WebSocket('ws://localhost:5000');
    
    ws.onopen = () => {
      console.log('WebSocket连接已建立');
      dispatch({ type: 'SET_SESSION_ID', payload: generateSessionId() });
      dispatch({ type: 'SET_ERROR', payload: undefined });
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'connected':
          dispatch({ type: 'SET_SESSION_ID', payload: data.sessionId });
          break;
        case 'parameters_updated':
          dispatch({ type: 'SET_PARAMETERS', payload: data.parameters });
          break;
      }
    };

    ws.onerror = (error) => {
      if (!shouldIgnoreClose) {
        console.error('WebSocket错误:', error);
        dispatch({ type: 'SET_ERROR', payload: 'WebSocket连接失败' });
      }
    };

    ws.onclose = () => {
      console.log('WebSocket连接已关闭');
      if (!shouldIgnoreClose) {
        dispatch({ type: 'SET_ERROR', payload: '连接已断开' });
      }
    };

    return () => {
      // React StrictMode 开发环境会触发一次额外卸载，这里忽略预期关闭。
      shouldIgnoreClose = true;
      ws.close();
    };
  }, []);

  // 本地存储同步：把 session 与历史记录落盘。
  useEffect(() => {
    if (state.sessionId) {
      localStorage.setItem('scad-generator-session', JSON.stringify({
        sessionId: state.sessionId,
        history: state.history,
        lastActivity: new Date().toISOString()
      }));
    }
  }, [state.sessionId, state.history]);

  // 恢复会话：应用启动时从 localStorage 读取历史上下文。
  useEffect(() => {
    const savedSession = localStorage.getItem('scad-generator-session');
    if (savedSession) {
      try {
        const { sessionId, history } = JSON.parse(savedSession);
        dispatch({ type: 'SET_SESSION_ID', payload: sessionId });
        // 可以根据需要恢复历史记录
      } catch (error) {
        console.error('恢复会话失败:', error);
      }
    }
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
};

// Hook：简化组件侧对全局状态的访问。
export const useAppState = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppState must be used within StateProvider');
  }
  return context;
};

// 辅助函数：生成临时会话 ID（服务端会话返回前使用）。
function generateSessionId(): string {
  return 'session_' + Math.random().toString(36).substr(2, 9);
}

// 会话管理工具：封装历史写入、会话清理和导出能力。
export const sessionManager = {
  saveToHistory: (
    dispatch: React.Dispatch<AppAction>,
    prompt: string,
    openscadCode: string,
    parameters: Record<string, any>
  ) => {
    const historyItem: HistoryItem = {
      id: Date.now().toString(),
      prompt,
      openscadCode,
      parameters,
      timestamp: new Date()
    };
    dispatch({ type: 'ADD_TO_HISTORY', payload: historyItem });
  },

  clearSession: (dispatch: React.Dispatch<AppAction>) => {
    dispatch({ type: 'RESET_STATE' });
    localStorage.removeItem('scad-generator-session');
  },

  exportSession: (state: AppState) => {
    return {
      sessionId: state.sessionId,
      prompt: state.prompt,
      openscadCode: state.openscadCode,
      parameters: state.parameters,
      history: state.history,
      exportDate: new Date().toISOString()
    };
  }
};

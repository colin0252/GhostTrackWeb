
 // API 配置
const isDevelopment = import.meta.env.DEV;

// 检测本地 Docker 环境（前端端口 8192）
const isDockerEnvironment = window.location.port === '8192';

// Render 后端地址
const RENDER_API_URL = 'https://ghosttrack-api-28m2.onrender.com';

// 根据运行环境确定 API 基础地址
export const getApiBaseUrl = (): string => {
  if (isDockerEnvironment) {
    const hostname = window.location.hostname;
    return `http://${hostname}:8088`;
  }

  if (isDevelopment) {
    return 'http://localhost:8000';
  }

  return RENDER_API_URL;
};

export const API_BASE_URL = getApiBaseUrl();

// API 接口地址
export const API_ENDPOINTS = {
  TRACK_IP: `${API_BASE_URL}/api/track-ip`,
  TRACK_PHONE: `${API_BASE_URL}/api/track-phone`,
  TRACK_USERNAME: `${API_BASE_URL}/api/track-username`,
  MY_IP: `${API_BASE_URL}/api/my-ip`,
  HEALTH: `${API_BASE_URL}/health`,
};

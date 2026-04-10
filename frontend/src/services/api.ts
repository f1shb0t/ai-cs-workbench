import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import axios from 'axios';
import type { ApiResponse, Ticket, Conversation, DashboardStats, AppConfig } from '../types';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
});

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
});

// Add auth token to requests
api.interceptors.request.use(async (config) => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Not authenticated
  }
  return config;
});

// Reviews
export async function getReviews(status?: string, pageSize = 50) {
  const params: Record<string, string> = { pageSize: String(pageSize) };
  if (status) params.status = status;
  const { data } = await api.get<ApiResponse<{ items: Ticket[]; hasMore: boolean }>>('/reviews', { params });
  return data.data;
}

export async function getTicketConversations(ticketId: string) {
  const { data } = await api.get<ApiResponse<{ ticket: Ticket; conversations: Conversation[] }>>(
    `/reviews/${ticketId}`
  );
  return data.data;
}

export async function updateReview(
  ticketId: string,
  timestamp: number,
  reviewStatus: string,
  editedAnswer?: string,
) {
  const { data } = await api.patch<ApiResponse<Conversation>>(
    `/reviews/${ticketId}/${timestamp}`,
    { reviewStatus, editedAnswer },
  );
  return data.data;
}

export async function sendReply(ticketId: string, timestamp?: number) {
  const { data } = await api.post<ApiResponse<{ sent: boolean }>>(`/reviews/${ticketId}/send`, { timestamp });
  return data.data;
}

export async function regenerateAnswer(ticketId: string) {
  const { data } = await api.post<ApiResponse<Conversation>>(`/reviews/${ticketId}/regenerate`);
  return data.data;
}

// Config
export async function getConfig() {
  const { data } = await api.get<ApiResponse<AppConfig>>('/config');
  return data.data;
}

export async function updateConfig(config: Partial<AppConfig>) {
  const { data } = await api.put<ApiResponse<{ updated: string[] }>>('/config', config);
  return data.data;
}

// Dashboard
export async function getDashboardStats() {
  const { data } = await api.get<ApiResponse<DashboardStats>>('/dashboard/stats');
  return data.data;
}

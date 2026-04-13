export interface Ticket {
  ticketId: string;
  userId: string;
  userDisplayName: string;
  platform: string;
  language: string;
  tags: string[];
  status: number;
  birthTime: number;
  latestPlayerMessage: string;
  latestAiAnswer: string;
  reviewStatus: ReviewStatus;
  conversationCount: number;
  closeTime?: number;
  playerRating?: number;
  playerFeedback?: string;
}

export type ReviewStatus =
  | 'pending_review'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'sent'
  | 'send_failed'
  | 'no_answer'
  | 'awaiting';

export interface Conversation {
  ticketId: string;
  timestamp: number;
  source: 'webhook' | 'manual';
  webhookEvent: string;
  playerMessage: string;
  playerUserId: string;
  playerName: string;
  platform?: string;
  tags?: string[];
  aiAnswer: string;
  aiSources: AiSource[];
  retrievedChunks?: RetrievedChunk[];
  aiLatencyMs: number;
  aiModel: string;
  aiKbId: string;
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: number;
  editedAnswer?: string;
  sentAnswer?: string;
  sentAt?: number;
  sendStatus?: 'success' | 'failed';
}

export interface AiSource {
  uri: string;
  snippet: string;
}

export interface RetrievedChunk {
  content: string;
  score: number;
  uri: string;
  metadata?: Record<string, any>;
}

export interface DashboardStats {
  total: number;
  approved: number;
  edited: number;
  rejected: number;
  pending: number;
  adoption_rate: number;
  avg_latency_ms: number;
}

export interface AppConfig {
  aihelp_app_key: string;
  aihelp_secret_key: string;
  aihelp_app_domain: string;
  aihelp_customer_login_name: string;
  knowledge_base_id: string;
  model_id: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  auto_generate_enabled: boolean;
  auto_generate_tags: string[];
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

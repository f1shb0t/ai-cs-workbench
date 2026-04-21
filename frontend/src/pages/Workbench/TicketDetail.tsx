import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Avatar,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import type { Conversation, RetrievedChunk, Ticket } from '../../types';
import { regenerateAnswer, sendReply, updateReview } from '../../services/api';
import { formatTime, platformText, statusColor, statusText } from '../../utils';

const { TextArea } = Input;

interface Props {
  ticket: Ticket | null;
  conversations: Conversation[];
  loading: boolean;
  onRefresh: () => void;
  /** Notify parent when user enters/exits edit mode on any AI bubble. */
  onEditingChange?: (editing: boolean) => void;
}

type BubbleStatus = 'pending' | 'sent' | 'rejected' | 'failed' | 'noanswer';

function bubbleStatusOf(conv: Conversation): BubbleStatus {
  const rs = conv.reviewStatus;
  if (rs === 'sent') return 'sent';
  if (rs === 'rejected') return 'rejected';
  if (rs === 'send_failed') return 'failed';
  if (rs === 'no_answer') return 'noanswer';
  return 'pending';
}

/** Chunks collapsible block reused for each AI bubble. */
const ChunksBlock: React.FC<{ chunks?: RetrievedChunk[] }> = ({ chunks }) => {
  if (!chunks || chunks.length === 0) return null;
  return (
    <Collapse
      size="small"
      ghost
      style={{ marginTop: 6 }}
      items={[
        {
          key: 'chunks',
          label: (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              📚 引用了 {chunks.length} 条知识
            </Typography.Text>
          ),
          children: chunks.map((chunk, i) => {
            const metaAnswer = chunk.metadata?.Answer || chunk.metadata?.answer || '';
            const question = chunk.question || (metaAnswer ? chunk.content : '');
            const answer = chunk.answer || metaAnswer || '';
            const displayContent = answer || chunk.content || '';
            return (
              <Card
                key={i}
                size="small"
                style={{ marginBottom: 6, backgroundColor: '#fafafa' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Tag
                    color={
                      chunk.score >= 0.7 ? 'green' : chunk.score >= 0.4 ? 'orange' : 'red'
                    }
                  >
                    置信度: {(chunk.score * 100).toFixed(1)}%
                  </Tag>
                  {chunk.uri && (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                      {chunk.uri.split('/').pop()}
                    </Typography.Text>
                  )}
                </div>
                {question && (
                  <div style={{ marginBottom: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      📋 匹配问题：
                    </Typography.Text>
                    <Typography.Paragraph
                      style={{ fontSize: 13, margin: '2px 0 0', color: '#595959' }}
                    >
                      {question}
                    </Typography.Paragraph>
                  </div>
                )}
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    💡 知识片段：
                  </Typography.Text>
                  <Typography.Paragraph
                    style={{ fontSize: 13, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}
                    ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
                  >
                    {displayContent}
                  </Typography.Paragraph>
                </div>
              </Card>
            );
          }),
        },
      ]}
    />
  );
};

interface AIBubbleProps {
  ticket: Ticket;
  conv: Conversation;
  onRefresh: () => void;
  onEditingChange?: (editing: boolean) => void;
}

const AIBubble: React.FC<AIBubbleProps> = ({ ticket, conv, onRefresh, onEditingChange }) => {
  const status = bubbleStatusOf(conv);
  const baseAnswer = conv.sentAnswer || conv.editedAnswer || conv.aiAnswer || '';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(baseAnswer);
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Propagate editing state up so parent can pause background polling
  useEffect(() => {
    onEditingChange?.(editing);
    return () => {
      if (editing) onEditingChange?.(false);
    };
  }, [editing, onEditingChange]);

  useEffect(() => {
    // Reset local draft when underlying conversation changes
    setDraft(conv.editedAnswer || conv.aiAnswer || '');
    setEditing(false);
  }, [conv.timestamp, conv.editedAnswer, conv.aiAnswer]);

  const startEdit = () => {
    setDraft(conv.editedAnswer || conv.aiAnswer || '');
    setEditing(true);
  };

  const saveEdit = async () => {
    try {
      await updateReview(ticket.ticketId, conv.timestamp, 'edited', draft);
      message.success('已保存');
      setEditing(false);
      onRefresh();
    } catch {
      message.error('保存失败');
    }
  };

  const cancelEdit = () => {
    setDraft(conv.editedAnswer || conv.aiAnswer || '');
    setEditing(false);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      // If the user has edits they haven't saved, persist them first
      if (editing && draft !== (conv.editedAnswer || conv.aiAnswer || '')) {
        await updateReview(ticket.ticketId, conv.timestamp, 'edited', draft);
      } else if (!editing && !conv.editedAnswer) {
        await updateReview(ticket.ticketId, conv.timestamp, 'approved');
      }
      await sendReply(ticket.ticketId, conv.timestamp);
      message.success('已发送');
      setEditing(false);
      onRefresh();
    } catch {
      message.error('发送失败');
    } finally {
      setSending(false);
    }
  };

  const handleReject = async () => {
    try {
      await updateReview(ticket.ticketId, conv.timestamp, 'rejected');
      message.success('已拒绝');
      onRefresh();
    } catch {
      message.error('操作失败');
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await regenerateAnswer(ticket.ticketId);
      message.success('已重新生成');
      onRefresh();
    } catch {
      message.error('重新生成失败');
    } finally {
      setRegenerating(false);
    }
  };

  // Status-driven styles
  const bubbleStyle: React.CSSProperties = (() => {
    switch (status) {
      case 'sent':
        return { backgroundColor: '#f6ffed', border: '1px solid #b7eb8f' };
      case 'rejected':
        return {
          backgroundColor: '#f5f5f5',
          border: '1px dashed #bfbfbf',
          opacity: 0.7,
          textDecoration: 'line-through',
        };
      case 'failed':
        return { backgroundColor: '#fff1f0', border: '1px solid #ffa39e' };
      case 'noanswer':
        return { backgroundColor: '#fafafa', border: '1px dashed #d9d9d9' };
      default:
        return { backgroundColor: '#e6f4ff', border: '1px solid #91caff' };
    }
  })();

  const displayAnswer = editing
    ? draft
    : conv.sentAnswer || conv.editedAnswer || conv.aiAnswer || '(暂无 AI 回答)';

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'row-reverse', gap: 8 }}>
        <Avatar
          size={36}
          icon={<RobotOutlined />}
          style={{ backgroundColor: '#1677ff', flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              textAlign: 'right',
              fontSize: 11,
              color: '#8c8c8c',
              marginBottom: 4,
            }}
          >
            {conv.source === 'manual' ? '🔄 重新生成' : 'AI 客服'}
            {conv.aiLatencyMs ? ` · ${(conv.aiLatencyMs / 1000).toFixed(1)}s` : ''}
            {' · '}
            {formatTime(conv.timestamp)}
          </div>

          <div
            style={{
              ...bubbleStyle,
              borderRadius: 12,
              padding: '10px 12px',
            }}
          >
            {editing ? (
              <TextArea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 12 }}
                variant="borderless"
                style={{ backgroundColor: 'transparent', padding: 0, fontSize: 14 }}
              />
            ) : (
              <Typography.Paragraph
                style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}
              >
                {displayAnswer}
              </Typography.Paragraph>
            )}

            <ChunksBlock chunks={conv.retrievedChunks} />
          </div>

          {/* Action bar */}
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
            {status === 'sent' && (
              <Typography.Text type="success" style={{ fontSize: 12 }}>
                <CheckCircleOutlined /> 已发送
                {conv.reviewedBy && ` by ${conv.reviewedBy}`}
                {conv.sentAt && ` · ${formatTime(conv.sentAt)}`}
              </Typography.Text>
            )}
            {status === 'rejected' && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已拒绝{conv.reviewedBy && ` by ${conv.reviewedBy}`}
              </Typography.Text>
            )}
            {status === 'failed' && (
              <>
                <Typography.Text type="danger" style={{ fontSize: 12, marginRight: 8 }}>
                  ⚠️ 发送失败{conv.sendStatus === 'failed' ? '' : ''}
                </Typography.Text>
                <Button
                  size="small"
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  onClick={handleSend}
                >
                  重试
                </Button>
              </>
            )}
            {status === 'noanswer' && (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={regenerating}
                onClick={handleRegenerate}
              >
                生成回答
              </Button>
            )}
            {status === 'pending' && !editing && (
              <>
                <Button size="small" icon={<EditOutlined />} onClick={startEdit}>
                  编辑
                </Button>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={regenerating}
                  onClick={handleRegenerate}
                >
                  重新生成
                </Button>
                <Tooltip title="拒绝该回复">
                  <Button size="small" danger icon={<CloseCircleOutlined />} onClick={handleReject}>
                    拒绝
                  </Button>
                </Tooltip>
                <Button
                  size="small"
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  onClick={handleSend}
                >
                  发送
                </Button>
              </>
            )}
            {status === 'pending' && editing && (
              <>
                <Button size="small" onClick={cancelEdit}>
                  取消
                </Button>
                <Button size="small" icon={<SaveOutlined />} onClick={saveEdit}>
                  保存
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  onClick={handleSend}
                >
                  保存并发送
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface PlayerBubbleProps {
  playerName: string;
  playerMessage: string;
  timestamp: number;
}

const PlayerBubble: React.FC<PlayerBubbleProps> = ({ playerName, playerMessage, timestamp }) => {
  const initial = (playerName || 'U').trim().charAt(0).toUpperCase();
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 14 }}>
      <div style={{ maxWidth: '78%', display: 'flex', gap: 8 }}>
        <Avatar size={36} style={{ backgroundColor: '#87d068', flexShrink: 0 }}>
          {initial}
        </Avatar>
        <div>
          <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>
            {playerName || '玩家'} · {formatTime(timestamp)}
          </div>
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #f0f0f0',
              borderRadius: 12,
              padding: '10px 12px',
            }}
          >
            <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>
              {playerMessage}
            </Typography.Paragraph>
          </div>
        </div>
      </div>
    </div>
  );
};

const TicketDetail: React.FC<Props> = ({ ticket, conversations, loading, onRefresh, onEditingChange }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Sort ascending by timestamp for chat feel
  const ordered = useMemo(
    () => [...conversations].sort((a, b) => a.timestamp - b.timestamp),
    [conversations],
  );

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [ordered.length, ticket?.ticketId]);

  if (!ticket) {
    return (
      <Card
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Empty description="请从左侧选择一个工单" />
      </Card>
    );
  }

  const handleStandaloneRegenerate = async () => {
    setRegenerating(true);
    try {
      await regenerateAnswer(ticket.ticketId);
      message.success('已重新生成');
      onRefresh();
    } catch {
      message.error('重新生成失败');
    } finally {
      setRegenerating(false);
    }
  };

  // Detect if the ticket currently needs a new AI reply (last conv is player
  // without any generated answer)
  const last = ordered[ordered.length - 1];
  const needsReply = last && last.playerMessage && !last.aiAnswer && last.reviewStatus === 'no_answer';

  return (
    <Spin spinning={loading}>
      <Card size="small" bodyStyle={{ padding: 12 }}>
        {/* Header */}
        <Descriptions size="small" column={4} style={{ marginBottom: 8 }}>
          <Descriptions.Item label="玩家">{ticket.userDisplayName || ticket.userId}</Descriptions.Item>
          <Descriptions.Item label="平台">{platformText(ticket.platform)}</Descriptions.Item>
          <Descriptions.Item label="工单号">#{ticket.ticketId}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusColor(ticket.reviewStatus)}>{statusText(ticket.reviewStatus)}</Tag>
          </Descriptions.Item>
        </Descriptions>
        {ticket.appName && (
          <Tag color="blue" style={{ marginBottom: 8 }}>
            📱 {ticket.appName}
          </Tag>
        )}
        {ticket.tags && ticket.tags.length > 0 && (
          <Space style={{ marginBottom: 8 }} wrap>
            {ticket.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        )}

        {/* Chat stream */}
        <div
          ref={scrollRef}
          style={{
            backgroundColor: '#f5f5f5',
            borderRadius: 8,
            padding: 12,
            height: 'calc(100vh - 260px)',
            overflowY: 'auto',
          }}
        >
          {ordered.length === 0 ? (
            <Empty description="暂无对话" />
          ) : (
            ordered.map((conv) => (
              <React.Fragment key={conv.timestamp}>
                {conv.playerMessage && (
                  <PlayerBubble
                    playerName={conv.playerName || ticket.userDisplayName || ticket.userId}
                    playerMessage={conv.playerMessage}
                    timestamp={conv.timestamp}
                  />
                )}
                {(conv.aiAnswer || conv.editedAnswer || conv.sentAnswer) && (
                  <AIBubble
                    ticket={ticket}
                    conv={conv}
                    onRefresh={onRefresh}
                    onEditingChange={onEditingChange}
                  />
                )}
                {!conv.aiAnswer && !conv.editedAnswer && conv.reviewStatus === 'no_answer' && (
                  <AIBubble
                    ticket={ticket}
                    conv={conv}
                    onRefresh={onRefresh}
                    onEditingChange={onEditingChange}
                  />
                )}
              </React.Fragment>
            ))
          )}
        </div>

        {needsReply && (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <Button
              icon={<ReloadOutlined />}
              loading={regenerating}
              onClick={handleStandaloneRegenerate}
            >
              为最新消息生成回答
            </Button>
          </div>
        )}
      </Card>
    </Spin>
  );
};

export default TicketDetail;

import React, { useState } from 'react';
import { Card, Typography, Tag, Space, Button, Input, Divider, Timeline, Collapse, Empty, Spin, message, Descriptions } from 'antd';
import {
  CheckCircleOutlined,
  ReloadOutlined,
  CloseCircleOutlined,
  SendOutlined,
  EditOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Ticket, Conversation } from '../../types';
import { updateReview, sendReply, regenerateAnswer } from '../../services/api';
import { statusColor, statusText, formatTime, platformText } from '../../utils';

const { TextArea } = Input;

interface Props {
  ticket: Ticket | null;
  conversations: Conversation[];
  loading: boolean;
  onRefresh: () => void;
}

const TicketDetail: React.FC<Props> = ({ ticket, conversations, loading, onRefresh }) => {
  const [editedAnswer, setEditedAnswer] = useState('');
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  if (!ticket) {
    return (
      <Card style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="请从左侧选择一个工单" />
      </Card>
    );
  }

  const latestConversation = conversations.length > 0 ? conversations[conversations.length - 1] : null;
  const currentAnswer = editing ? editedAnswer : (latestConversation?.editedAnswer || latestConversation?.aiAnswer || '');
  const isPending = latestConversation?.reviewStatus === 'pending_review';

  const handleApproveAndSend = async () => {
    if (!latestConversation) return;
    setSending(true);
    try {
      if (editing && editedAnswer !== latestConversation.aiAnswer) {
        await updateReview(ticket.ticketId, latestConversation.timestamp, 'edited', editedAnswer);
      } else {
        await updateReview(ticket.ticketId, latestConversation.timestamp, 'approved');
      }
      await sendReply(ticket.ticketId, latestConversation.timestamp);
      message.success('回复已发送');
      setEditing(false);
      onRefresh();
    } catch (err) {
      message.error('发送失败');
    } finally {
      setSending(false);
    }
  };

  const handleReject = async () => {
    if (!latestConversation) return;
    try {
      await updateReview(ticket.ticketId, latestConversation.timestamp, 'rejected');
      message.success('已拒绝');
      onRefresh();
    } catch (err) {
      message.error('操作失败');
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await regenerateAnswer(ticket.ticketId);
      message.success('已重新生成');
      setEditing(false);
      onRefresh();
    } catch (err) {
      message.error('重新生成失败');
    } finally {
      setRegenerating(false);
    }
  };

  const startEditing = () => {
    setEditedAnswer(currentAnswer);
    setEditing(true);
  };

  return (
    <Spin spinning={loading}>
      <Card size="small">
        {/* Player Info */}
        <Descriptions size="small" column={4} style={{ marginBottom: 12 }}>
          <Descriptions.Item label="玩家">{ticket.userDisplayName || ticket.userId}</Descriptions.Item>
          <Descriptions.Item label="平台">{platformText(ticket.platform)}</Descriptions.Item>
          <Descriptions.Item label="工单号">#{ticket.ticketId}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusColor(ticket.reviewStatus)}>{statusText(ticket.reviewStatus)}</Tag>
          </Descriptions.Item>
        </Descriptions>
        {ticket.tags && ticket.tags.length > 0 && (
          <Space style={{ marginBottom: 12 }}>
            {ticket.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
          </Space>
        )}

        <Divider style={{ margin: '8px 0' }} />

        {/* Player Message */}
        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <UserOutlined /> 玩家消息
          </Typography.Text>
          <Card size="small" style={{ marginTop: 4, backgroundColor: '#f6f6f6' }}>
            <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {latestConversation?.playerMessage || ticket.latestPlayerMessage}
            </Typography.Paragraph>
          </Card>
        </div>

        {/* AI Answer */}
        <div style={{ marginBottom: 16 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <RobotOutlined /> AI 建议回答
              {latestConversation?.aiLatencyMs ? ` (${(latestConversation.aiLatencyMs / 1000).toFixed(1)}s)` : ''}
            </Typography.Text>
            {!editing && isPending && (
              <Button size="small" icon={<EditOutlined />} onClick={startEditing}>编辑</Button>
            )}
          </Space>
          {editing ? (
            <TextArea
              value={editedAnswer}
              onChange={(e) => setEditedAnswer(e.target.value)}
              rows={8}
              style={{ marginTop: 4 }}
            />
          ) : (
            <Card size="small" style={{ marginTop: 4, backgroundColor: '#f0f5ff', borderColor: '#adc6ff' }}>
              <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {currentAnswer || '暂无 AI 回答'}
              </Typography.Paragraph>
            </Card>
          )}
        </div>

        {/* Retrieved Chunks */}
        {latestConversation?.retrievedChunks && latestConversation.retrievedChunks.length > 0 && (
          <Collapse
            size="small"
            style={{ marginBottom: 16 }}
            items={[{
              key: 'chunks',
              label: `🔍 召回片段 (${latestConversation.retrievedChunks.length})`,
              children: latestConversation.retrievedChunks.map((chunk, i) => (
                <Card key={i} size="small" style={{ marginBottom: 8, backgroundColor: '#fafafa' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Tag color={chunk.score >= 0.7 ? 'green' : chunk.score >= 0.4 ? 'orange' : 'red'}>
                      置信度: {(chunk.score * 100).toFixed(1)}%
                    </Tag>
                    {chunk.uri && (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                        {chunk.uri.split('/').pop()}
                      </Typography.Text>
                    )}
                  </div>
                  {chunk.question && (
                    <div style={{ marginBottom: 6 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>📋 匹配问题：</Typography.Text>
                      <Typography.Paragraph style={{ fontSize: 13, margin: '2px 0 0', color: '#595959' }}>
                        {chunk.question}
                      </Typography.Paragraph>
                    </div>
                  )}
                  {chunk.answer ? (
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>💡 知识片段：</Typography.Text>
                      <Typography.Paragraph style={{ fontSize: 13, margin: '2px 0 0', whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}>
                        {chunk.answer}
                      </Typography.Paragraph>
                    </div>
                  ) : (
                    <Typography.Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}>
                      {chunk.content}
                    </Typography.Paragraph>
                  )}
                </Card>
              )),
            }]}
          />
        )}

        {/* Sources */}
        {latestConversation?.aiSources && latestConversation.aiSources.length > 0 && (
          <Collapse
            size="small"
            style={{ marginBottom: 16 }}
            items={[{
              key: 'sources',
              label: `📚 引用来源 (${latestConversation.aiSources.length})`,
              children: latestConversation.aiSources.map((src, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{src.uri}</Typography.Text>
                  <Typography.Paragraph style={{ fontSize: 12, margin: 0 }} ellipsis={{ rows: 2 }}>
                    {src.snippet}
                  </Typography.Paragraph>
                </div>
              )),
            }]}
          />
        )}

        {/* Action Buttons */}
        {isPending && (
          <Space>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleApproveAndSend}
              loading={sending}
            >
              确认发送
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRegenerate}
              loading={regenerating}
            >
              重新生成
            </Button>
            <Button danger icon={<CloseCircleOutlined />} onClick={handleReject}>
              拒绝
            </Button>
          </Space>
        )}

        {/* Conversation Timeline */}
        {conversations.length > 1 && (
          <>
            <Divider style={{ margin: '16px 0 8px' }}>历史对话</Divider>
            <Timeline
              items={conversations.slice(0, -1).map((conv) => ({
                color: statusColor(conv.reviewStatus),
                children: (
                  <div style={{ fontSize: 12 }}>
                    <Typography.Text type="secondary">{formatTime(conv.timestamp)}</Typography.Text>
                    <div><strong>玩家:</strong> {conv.playerMessage?.substring(0, 100)}</div>
                    <div><strong>AI:</strong> {(conv.editedAnswer || conv.aiAnswer)?.substring(0, 100)}</div>
                    <Tag color={statusColor(conv.reviewStatus)} style={{ fontSize: 11 }}>
                      {statusText(conv.reviewStatus)}
                      {conv.reviewedBy && ` by ${conv.reviewedBy}`}
                    </Tag>
                  </div>
                ),
              }))}
            />
          </>
        )}
      </Card>
    </Spin>
  );
};

export default TicketDetail;

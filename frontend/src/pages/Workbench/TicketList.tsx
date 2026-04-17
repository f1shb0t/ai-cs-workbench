import React, { useMemo } from 'react';
import { List, Card, Tag, Tabs, Typography, Badge, Space, Select } from 'antd';
import type { Ticket, AppEntry } from '../../types';
import { statusColor, statusText, formatTimeAgo, platformText } from '../../utils';

interface Props {
  tickets: Ticket[];
  apps?: AppEntry[];
  selectedId?: string;
  statusFilter: string;
  appFilter?: string;
  onStatusFilterChange: (status: string) => void;
  onAppFilterChange?: (appId: string) => void;
  onSelect: (ticket: Ticket) => void;
  loading: boolean;
}

const TicketList: React.FC<Props> = ({
  tickets,
  apps = [],
  selectedId,
  statusFilter,
  appFilter = 'all',
  onStatusFilterChange,
  onAppFilterChange,
  onSelect,
  loading,
}) => {
  const pendingCount = tickets.filter((t) => t.reviewStatus === 'pending_review').length;

  const tabItems = [
    { key: 'pending_review', label: <Badge count={pendingCount} offset={[10, 0]}>待审核</Badge> },
    { key: 'sent', label: '已发送' },
    { key: 'rejected', label: '已拒绝' },
    { key: 'all', label: '全部' },
  ];

  const appOptions = useMemo(
    () => [
      { value: 'all', label: '全部 App' },
      ...apps.map((a) => ({ value: a.app_id, label: a.app_name || a.app_id })),
    ],
    [apps],
  );

  const appNameById = useMemo(() => {
    const map = new Map<string, string>();
    apps.forEach((a) => map.set(a.app_id, a.app_name || a.app_id));
    return map;
  }, [apps]);

  return (
    <Card
      title="工单列表"
      size="small"
      styles={{ body: { padding: 0 } }}
      extra={
        apps.length > 0 && onAppFilterChange ? (
          <Select
            size="small"
            value={appFilter}
            onChange={onAppFilterChange}
            options={appOptions}
            style={{ minWidth: 140 }}
          />
        ) : null
      }
    >
      <Tabs
        activeKey={statusFilter}
        onChange={onStatusFilterChange}
        items={tabItems}
        style={{ padding: '0 12px' }}
        size="small"
      />
      <List
        loading={loading}
        dataSource={tickets}
        renderItem={(ticket) => (
          <List.Item
            onClick={() => onSelect(ticket)}
            style={{
              padding: '12px 16px',
              cursor: 'pointer',
              backgroundColor: selectedId === ticket.ticketId ? '#e6f4ff' : 'transparent',
              borderLeft: selectedId === ticket.ticketId ? '3px solid #1677ff' : '3px solid transparent',
            }}
          >
            <div style={{ width: '100%' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  #{ticket.ticketId}
                </Typography.Text>
                <Tag color={statusColor(ticket.reviewStatus)} style={{ fontSize: 11 }}>
                  {statusText(ticket.reviewStatus)}
                </Tag>
              </Space>
              <div style={{ marginTop: 4 }}>
                {ticket.appId && (
                  <Tag color="purple" style={{ fontSize: 11 }}>
                    {appNameById.get(ticket.appId) || ticket.appName || ticket.appId}
                  </Tag>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {ticket.userDisplayName || ticket.userId}
                </Typography.Text>
                {ticket.platform && (
                  <Tag style={{ fontSize: 11, marginLeft: 4 }}>{platformText(ticket.platform)}</Tag>
                )}
              </div>
              <Typography.Paragraph
                ellipsis={{ rows: 2 }}
                style={{ fontSize: 13, margin: '4px 0 0', color: '#333' }}
              >
                {ticket.latestPlayerMessage}
              </Typography.Paragraph>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {ticket.birthTime ? formatTimeAgo(ticket.birthTime) : ''}
                {ticket.conversationCount > 1 && ` · ${ticket.conversationCount} 轮对话`}
              </Typography.Text>
            </div>
          </List.Item>
        )}
      />
    </Card>
  );
};

export default TicketList;

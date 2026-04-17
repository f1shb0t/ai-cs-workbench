import React, { useState, useCallback, useEffect } from 'react';
import { Row, Col, message } from 'antd';
import TicketList from './TicketList';
import TicketDetail from './TicketDetail';
import type { Ticket, Conversation, AppEntry } from '../../types';
import { getReviews, getTicketConversations, getConfig } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';

const Workbench: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [appFilter, setAppFilter] = useState<string>('all');
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    getConfig()
      .then((cfg) => setApps(cfg?.apps ?? []))
      .catch(() => setApps([]));
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getReviews(
        statusFilter === 'all' ? undefined : statusFilter,
        50,
        appFilter === 'all' ? undefined : appFilter,
      );
      setTickets(result.items);
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, appFilter]);

  usePolling(fetchTickets, 10000);

  const handleStatusFilterChange = (status: string) => {
    setStatusFilter(status);
    setTickets([]);
    setLoading(true);
    setSelectedTicket(null);
    setConversations([]);
  };

  const handleAppFilterChange = (appId: string) => {
    setAppFilter(appId);
    setTickets([]);
    setLoading(true);
    setSelectedTicket(null);
    setConversations([]);
  };

  const handleSelectTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setDetailLoading(true);
    try {
      const result = await getTicketConversations(ticket.ticketId);
      setConversations(result.conversations);
    } catch (err) {
      message.error('获取工单详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchTickets();
    if (selectedTicket) {
      handleSelectTicket(selectedTicket);
    }
  };

  return (
    <Row gutter={16} style={{ height: 'calc(100vh - 112px)' }}>
      <Col span={8} style={{ height: '100%', overflow: 'auto' }}>
        <TicketList
          tickets={tickets}
          apps={apps}
          selectedId={selectedTicket?.ticketId}
          statusFilter={statusFilter}
          appFilter={appFilter}
          onStatusFilterChange={handleStatusFilterChange}
          onAppFilterChange={handleAppFilterChange}
          onSelect={handleSelectTicket}
          loading={loading}
        />
      </Col>
      <Col span={16} style={{ height: '100%', overflow: 'auto' }}>
        <TicketDetail
          ticket={selectedTicket}
          conversations={conversations}
          loading={detailLoading}
          onRefresh={handleRefresh}
        />
      </Col>
    </Row>
  );
};

export default Workbench;

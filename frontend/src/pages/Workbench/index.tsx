import React, { useState, useCallback } from 'react';
import { Row, Col, Badge, message } from 'antd';
import TicketList from './TicketList';
import TicketDetail from './TicketDetail';
import type { Ticket, Conversation } from '../../types';
import { getReviews, getTicketConversations } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';

const Workbench: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getReviews(statusFilter === 'all' ? undefined : statusFilter);
      setTickets(result.items);
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  usePolling(fetchTickets, 10000);

  const handleStatusFilterChange = (status: string) => {
    setStatusFilter(status);
    setTickets([]);
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
          selectedId={selectedTicket?.ticketId}
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
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

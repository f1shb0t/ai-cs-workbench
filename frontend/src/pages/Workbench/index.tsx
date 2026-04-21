import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  // Whether any AI bubble is currently being edited. Used to pause detail
  // polling so live refresh doesn't wipe out unsaved edits.
  const editingRef = useRef(false);
  const setEditingActive = useCallback((active: boolean) => {
    editingRef.current = active;
  }, []);

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

  // Silent refresh of the currently open ticket's conversations.
  // Skips when user is editing an AI bubble to avoid clobbering unsaved work.
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedTicket?.ticketId ?? null;

  const refreshDetailSilently = useCallback(async () => {
    const ticketId = selectedIdRef.current;
    if (!ticketId) return;
    if (editingRef.current) return; // pause while editing
    try {
      const result = await getTicketConversations(ticketId);
      setConversations((prev) => {
        // Shallow compare: same length + same last timestamp + same statuses
        // means nothing meaningful changed; skip state update to avoid
        // unnecessary re-renders.
        const next = result.conversations;
        if (
          prev.length === next.length &&
          prev.length > 0 &&
          prev[prev.length - 1].timestamp === next[next.length - 1].timestamp &&
          prev.every((c, i) => c.reviewStatus === next[i].reviewStatus)
        ) {
          return prev;
        }
        return next;
      });
      // Also update ticket header (status, latest message) if changed
      if (result.ticket) {
        setSelectedTicket((prev) =>
          prev && prev.ticketId === result.ticket.ticketId ? { ...prev, ...result.ticket } : prev,
        );
      }
    } catch (err) {
      // Silent — don't spam toasts on transient errors during background poll
      console.warn('Detail refresh failed:', err);
    }
  }, []);

  usePolling(refreshDetailSilently, 8000, !!selectedTicket);

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
          onEditingChange={setEditingActive}
        />
      </Col>
    </Row>
  );
};

export default Workbench;

import React, { useState, useEffect } from 'react';
import { Card, Col, Row, Statistic, Table, Tag, Spin, Typography } from 'antd';
import { ArrowUpOutlined, ClockCircleOutlined, CheckCircleOutlined, RobotOutlined } from '@ant-design/icons';
import { getDashboardStats } from '../../services/api';
import type { DashboardStats } from '../../types';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!stats) return <Typography.Text>无法加载数据</Typography.Text>;

  return (
    <div>
      <Typography.Title level={4}>数据看板</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="今日处理"
              value={stats.total}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="AI 采纳率"
              value={stats.adoption_rate}
              suffix="%"
              prefix={<RobotOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均响应时间"
              value={stats.avg_latency_ms > 0 ? (stats.avg_latency_ms / 1000).toFixed(1) : '-'}
              suffix="秒"
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="待处理"
              value={stats.pending}
              prefix={<ArrowUpOutlined />}
              valueStyle={{ color: stats.pending > 0 ? '#faad14' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="处理统计">
            <Table
              size="small"
              pagination={false}
              dataSource={[
                { key: '1', label: '已通过', value: stats.approved, color: 'green' },
                { key: '2', label: '已编辑后发送', value: stats.edited, color: 'blue' },
                { key: '3', label: '已拒绝', value: stats.rejected, color: 'red' },
                { key: '4', label: '待审核', value: stats.pending, color: 'orange' },
              ]}
              columns={[
                { title: '状态', dataIndex: 'label', render: (text, record: any) => <Tag color={record.color}>{text}</Tag> },
                { title: '数量', dataIndex: 'value', align: 'right' },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="说明">
            <Typography.Paragraph>
              <strong>AI 采纳率</strong> = (已通过 + 已编辑) / 总处理数 × 100%
            </Typography.Paragraph>
            <Typography.Paragraph>
              采纳率低的工单类型说明知识库在该领域需要补充文档，可以形成 KB 质量改进闭环。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;

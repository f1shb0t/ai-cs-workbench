import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Slider,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { getConfig, updateConfig } from '../../services/api';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import type { AppConfig, AppEntry } from '../../types';

const MODEL_SUGGESTIONS = [
  { value: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Claude 4.5 Haiku (推荐)' },
  { value: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2' },
  { value: 'anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku' },
  { value: 'amazon.nova-pro-v1:0', label: 'Amazon Nova Pro' },
  { value: 'amazon.nova-lite-v1:0', label: 'Amazon Nova Lite' },
  { value: 'amazon.nova-micro-v1:0', label: 'Amazon Nova Micro' },
];

const emptyApp = (): AppEntry => ({
  app_id: '',
  app_name: '',
  aihelp_app_key: '',
  aihelp_secret_key: '',
  aihelp_app_domain: '',
  aihelp_customer_login_name: 'ai-assistant',
  knowledge_base_id: '',
  enabled: true,
});

const Settings: React.FC = () => {
  const [globalForm] = Form.useForm();
  const [appForm] = Form.useForm<AppEntry>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [apps, setApps] = useState<AppEntry[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const readOnly = !isAdmin;

  const loadConfig = () => {
    setLoading(true);
    setLoadError(false);
    getConfig()
      .then((config) => {
        if (!config) {
          setLoading(false);
          return;
        }
        const cfg = config as AppConfig;
        globalForm.setFieldsValue({
          model_id: cfg.model_id,
          system_prompt: cfg.system_prompt,
          temperature: Number(cfg.temperature ?? 0.2),
          max_tokens: Number(cfg.max_tokens ?? 1024),
          auto_generate_enabled: !!cfg.auto_generate_enabled,
          auto_generate_tags: cfg.auto_generate_tags ?? [],
          default_app_id: cfg.default_app_id ?? '',
        });
        setApps(Array.isArray(cfg.apps) ? cfg.apps : []);
        setLoading(false);
      })
      .catch(() => {
        setLoadError(true);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const defaultAppOptions = useMemo(
    () => [
      { value: '', label: '无（按首个启用的 app 兜底）' },
      ...apps.map((a) => ({ value: a.app_id, label: `${a.app_name} (${a.app_id})` })),
    ],
    [apps],
  );

  const handleSave = async () => {
    if (readOnly) return;
    setSaving(true);
    setSavedAt(null);
    try {
      const globals = await globalForm.validateFields();
      const payload: Partial<AppConfig> = { ...globals, apps };
      const result = await updateConfig(payload);
      const count = result?.updated?.length ?? 0;
      message.success(`配置已保存（${count} 项已更新）`);
      setSavedAt(new Date().toLocaleTimeString('zh-CN'));
    } catch (err) {
      message.error('保存失败，请检查表单和网络');
    } finally {
      setSaving(false);
    }
  };

  const openAddApp = () => {
    appForm.resetFields();
    appForm.setFieldsValue(emptyApp());
    setEditingIndex(null);
    setModalOpen(true);
  };

  const openEditApp = (index: number) => {
    appForm.resetFields();
    appForm.setFieldsValue(apps[index]);
    setEditingIndex(index);
    setModalOpen(true);
  };

  const handleDeleteApp = (index: number) => {
    const next = apps.slice();
    next.splice(index, 1);
    setApps(next);
  };

  const handleModalOk = async () => {
    try {
      const values = await appForm.validateFields();
      const clean: AppEntry = { ...emptyApp(), ...values };
      clean.app_id = (clean.app_id || '').trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(clean.app_id)) {
        message.error('App ID 只允许字母、数字、下划线、连字符');
        return;
      }
      const duplicate = apps.some(
        (a, i) => a.app_id === clean.app_id && i !== editingIndex,
      );
      if (duplicate) {
        message.error(`App ID "${clean.app_id}" 已存在`);
        return;
      }
      const next = apps.slice();
      if (editingIndex === null) {
        next.push(clean);
      } else {
        next[editingIndex] = clean;
      }
      setApps(next);
      setModalOpen(false);
    } catch {
      // validation errors handled by antd
    }
  };

  if (loading || adminLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <Typography.Title level={4}>系统设置</Typography.Title>

      {loadError && (
        <Alert
          type="error"
          message="加载配置失败"
          description="无法从服务器获取配置，请检查网络连接。"
          action={<Button size="small" onClick={loadConfig}>重试</Button>}
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      {readOnly && (
        <Alert
          type="warning"
          icon={<LockOutlined />}
          message="只读模式"
          description="只有管理员（admins 用户组）可以修改系统配置。你可以查看当前配置，但无法保存改动。"
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      {/* Apps list */}
      <Card
        title="🎮 AIHelp Apps（多游戏来源）"
        style={{ marginBottom: 16 }}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAddApp}
            disabled={readOnly}
          >
            新增 App
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          每个 App 对应一款游戏/产品的客诉来源，独立配置 AppKey / SecretKey / AppDomain / Knowledge Base。
        </Typography.Paragraph>
        <Table<AppEntry>
          rowKey="app_id"
          dataSource={apps}
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无 App 配置，点击右上角新增' }}
          columns={[
            {
              title: 'App ID',
              dataIndex: 'app_id',
              width: 180,
              render: (v: string) => <code>{v}</code>,
            },
            { title: '名称', dataIndex: 'app_name', width: 180 },
            { title: 'AppKey', dataIndex: 'aihelp_app_key', ellipsis: true },
            {
              title: 'KB ID',
              dataIndex: 'knowledge_base_id',
              width: 140,
              render: (v: string) => <code>{v || '-'}</code>,
            },
            {
              title: '状态',
              dataIndex: 'enabled',
              width: 80,
              render: (v: boolean) => v ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag>,
            },
            {
              title: '操作',
              width: 130,
              render: (_: unknown, _row: AppEntry, idx: number) => (
                <Space size="small">
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEditApp(idx)}
                    disabled={readOnly}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="确认删除这个 App？"
                    onConfirm={() => handleDeleteApp(idx)}
                    disabled={readOnly}
                  >
                    <Button
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={readOnly}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Form form={globalForm} layout="vertical" disabled={readOnly}>
        {/* Global AI config */}
        <Card title="🤖 全局 AI 配置" style={{ marginBottom: 16 }}>
          <Form.Item
            label="模型 ID"
            name="model_id"
            extra="输入 Bedrock 模型 ID，或从建议列表中选择"
          >
            <AutoComplete
              options={MODEL_SUGGESTIONS}
              placeholder="输入或选择模型 ID"
              filterOption={(inputValue, option) =>
                (option?.value as string)?.toLowerCase().includes(inputValue.toLowerCase()) ||
                (option?.label as string)?.toLowerCase().includes(inputValue.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item label="系统提示词" name="system_prompt">
            <Input.TextArea rows={4} placeholder="你是一个专业的游戏客服助手..." />
          </Form.Item>
          <Form.Item label="温度" name="temperature">
            <Slider min={0} max={1} step={0.1} marks={{ 0: '精确', 0.5: '平衡', 1: '创意' }} />
          </Form.Item>
          <Form.Item label="最大回复长度" name="max_tokens">
            <Select
              options={[
                { value: 512, label: '512 (简短)' },
                { value: 1024, label: '1024 (标准)' },
                { value: 2048, label: '2048 (详细)' },
                { value: 4096, label: '4096 (很长)' },
              ]}
            />
          </Form.Item>
        </Card>

        {/* Business rules */}
        <Card title="⚙️ 业务规则" style={{ marginBottom: 16 }}>
          <Form.Item
            label="默认 App"
            name="default_app_id"
            extra="当 webhook 未指定 appId 时使用此兜底。留空则使用第一个启用的 app。"
          >
            <Select options={defaultAppOptions} placeholder="选择默认 App" allowClear />
          </Form.Item>
          <Form.Item label="Webhook 自动生成 AI 答案" name="auto_generate_enabled" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item label="仅对以下标签自动生成" name="auto_generate_tags">
            <Select mode="tags" placeholder="输入标签后按回车添加" />
          </Form.Item>
        </Card>

        {!readOnly && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} size="large">
              保存配置
            </Button>
            {savedAt && (
              <Typography.Text type="success">
                <CheckCircleOutlined /> 上次保存：{savedAt}
              </Typography.Text>
            )}
          </div>
        )}
      </Form>

      {/* App edit modal */}
      <Modal
        title={editingIndex === null ? '新增 App' : `编辑 App: ${apps[editingIndex]?.app_id}`}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        okText="确定"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form form={appForm} layout="vertical">
          <Form.Item
            label="App ID"
            name="app_id"
            rules={[{ required: true, message: '请输入 App ID（唯一标识）' }]}
            extra="唯一标识。建议用游戏代号+地区，例如 gameA_cn。只允许字母、数字、下划线、连字符。"
          >
            <Input placeholder="例如 gameA_cn" disabled={editingIndex !== null} />
          </Form.Item>
          <Form.Item
            label="App 名称"
            name="app_name"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="例如 Game A 国服" />
          </Form.Item>
          <Form.Item
            label="AIHelp App Key"
            name="aihelp_app_key"
            rules={[{ required: true, message: '请输入 App Key' }]}
          >
            <Input placeholder="TryElva_app_xxx" />
          </Form.Item>
          <Form.Item
            label="AIHelp Secret Key"
            name="aihelp_secret_key"
            rules={[{ required: true, message: '请输入 Secret Key' }]}
          >
            <Input.Password placeholder="输入 Secret Key" />
          </Form.Item>
          <Form.Item
            label="App Domain（完整 URL）"
            name="aihelp_app_domain"
            rules={[{ required: true, message: '请输入 AIHelp 服务地址' }]}
            extra="包含协议。例如 https://your-game.aihelp.net 或 http://localhost:8888"
          >
            <Input placeholder="https://your-game.aihelp.net" />
          </Form.Item>
          <Form.Item label="默认客服账号" name="aihelp_customer_login_name">
            <Input placeholder="ai-assistant" />
          </Form.Item>
          <Form.Item
            label="Knowledge Base ID"
            name="knowledge_base_id"
            rules={[{ required: true, message: '请输入 Knowledge Base ID' }]}
          >
            <Input placeholder="输入 Bedrock Knowledge Base ID" />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Settings;

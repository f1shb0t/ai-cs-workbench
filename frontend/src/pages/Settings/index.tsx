import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Switch, Select, Slider, message, Typography, Spin, Alert, AutoComplete } from 'antd';
import { SaveOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { getConfig, updateConfig } from '../../services/api';
import type { AppConfig } from '../../types';

const MODEL_SUGGESTIONS = [
  { value: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Claude 4.5 Haiku (推荐)' },
  { value: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2' },
  { value: 'anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku' },
  { value: 'amazon.nova-pro-v1:0', label: 'Amazon Nova Pro' },
  { value: 'amazon.nova-lite-v1:0', label: 'Amazon Nova Lite' },
  { value: 'amazon.nova-micro-v1:0', label: 'Amazon Nova Micro' },
];

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const loadConfig = () => {
    setLoading(true);
    setLoadError(false);
    getConfig()
      .then((config) => {
        if (config) {
          // Ensure boolean type for switch
          if (config.auto_generate_enabled !== undefined) {
            config.auto_generate_enabled = !!config.auto_generate_enabled;
          }
          // Ensure number type for slider
          if (config.temperature !== undefined) {
            config.temperature = Number(config.temperature);
          }
          if (config.max_tokens !== undefined) {
            config.max_tokens = Number(config.max_tokens);
          }
          form.setFieldsValue(config);
        }
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

  const handleSave = async () => {
    setSaving(true);
    setSavedAt(null);
    try {
      const values = form.getFieldsValue();
      const result = await updateConfig(values);
      const count = result?.updated?.length ?? 0;
      message.success(`配置已保存（${count} 项已更新）`);
      setSavedAt(new Date().toLocaleTimeString('zh-CN'));
    } catch (err) {
      message.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div style={{ maxWidth: 800 }}>
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

      <Form form={form} layout="vertical">
        {/* AIHelp Connection */}
        <Card title="📡 AIHelp 连接配置" style={{ marginBottom: 16 }}>
          <Form.Item label="App Key" name="aihelp_app_key" rules={[{ required: true, message: '请输入 App Key' }]}>
            <Input placeholder="TryElva_app_xxx" />
          </Form.Item>
          <Form.Item label="Secret Key" name="aihelp_secret_key" rules={[{ required: true, message: '请输入 Secret Key' }]}>
            <Input.Password placeholder="输入 Secret Key" />
          </Form.Item>
          <Form.Item
            label="App Domain (完整 URL)"
            name="aihelp_app_domain"
            rules={[{ required: true, message: '请输入 AIHelp 服务地址' }]}
            extra="输入完整地址，包含协议。例如 https://your-game.aihelp.net 或 http://localhost:8888"
          >
            <Input placeholder="https://your-game.aihelp.net" />
          </Form.Item>
          <Form.Item label="默认客服账号" name="aihelp_customer_login_name">
            <Input placeholder="ai-assistant" />
          </Form.Item>
        </Card>

        {/* AI Config */}
        <Card title="🤖 AI 配置" style={{ marginBottom: 16 }}>
          <Form.Item label="Knowledge Base ID" name="knowledge_base_id" rules={[{ required: true, message: '请输入 Knowledge Base ID' }]}>
            <Input placeholder="SWOFQ7S45C" />
          </Form.Item>
          <Form.Item
            label="模型 ID"
            name="model_id"
            extra="输入 Bedrock 模型 ID，或从建议列表中选择"
          >
            <AutoComplete
              options={MODEL_SUGGESTIONS}
              placeholder="输入或选择模型 ID，例如 global.anthropic.claude-haiku-4-5-20251001-v1:0"
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

        {/* Business Rules */}
        <Card title="⚙️ 业务规则" style={{ marginBottom: 16 }}>
          <Form.Item label="Webhook 自动生成 AI 答案" name="auto_generate_enabled" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item label="仅对以下标签自动生成" name="auto_generate_tags">
            <Select mode="tags" placeholder="输入标签后按回车添加" />
          </Form.Item>
        </Card>

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
      </Form>
    </div>
  );
};

export default Settings;

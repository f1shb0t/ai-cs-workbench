import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Switch, Select, Slider, Tag, Space, message, Typography, Divider, Spin } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { getConfig, updateConfig } from '../../services/api';
import type { AppConfig } from '../../types';

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    getConfig()
      .then((config) => {
        form.setFieldsValue(config);
        setLoading(false);
      })
      .catch(() => {
        message.error('加载配置失败');
        setLoading(false);
      });
  }, [form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      await updateConfig(values);
      message.success('配置已保存');
    } catch (err) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div style={{ maxWidth: 800 }}>
      <Typography.Title level={4}>系统设置</Typography.Title>
      <Form form={form} layout="vertical">
        {/* AIHelp Connection */}
        <Card title="📡 AIHelp 连接配置" style={{ marginBottom: 16 }}>
          <Form.Item label="App Key" name="aihelp_app_key" rules={[{ required: true }]}>
            <Input placeholder="TryElva_app_xxx" />
          </Form.Item>
          <Form.Item label="Secret Key" name="aihelp_secret_key" rules={[{ required: true }]}>
            <Input.Password placeholder="输入 Secret Key" />
          </Form.Item>
          <Form.Item label="App Domain" name="aihelp_app_domain" rules={[{ required: true }]}>
            <Input placeholder="your-game.aihelp.net" />
          </Form.Item>
          <Form.Item label="默认客服账号" name="aihelp_customer_login_name">
            <Input placeholder="ai-assistant" />
          </Form.Item>
        </Card>

        {/* AI Config */}
        <Card title="🤖 AI 配置" style={{ marginBottom: 16 }}>
          <Form.Item label="Knowledge Base ID" name="bedrock_kb_id" rules={[{ required: true }]}>
            <Input placeholder="SWOFQ7S45C" />
          </Form.Item>
          <Form.Item label="模型" name="bedrock_model_id">
            <Select
              options={[
                { value: 'anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude 3 Haiku (快速)' },
                { value: 'anthropic.claude-3-sonnet-20240229-v1:0', label: 'Claude 3 Sonnet (平衡)' },
                { value: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet (高质量)' },
                { value: 'anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku (快速+高质量)' },
              ]}
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

        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} size="large">
          保存配置
        </Button>
      </Form>
    </div>
  );
};

export default Settings;

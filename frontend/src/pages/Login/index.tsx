import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, RobotOutlined, KeyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { login, completeNewPassword } from '../../services/auth';

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [needNewPassword, setNeedNewPassword] = useState(false);
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [newPwdForm] = Form.useForm();

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const result = await login(values.username, values.password);
      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setNeedNewPassword(true);
      } else if (result.isSignedIn) {
        navigate('/workbench');
      } else {
        message.error('登录失败：未知状态');
      }
    } catch (err: any) {
      message.error(err?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleNewPassword = async (values: { newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次密码输入不一致');
      return;
    }
    setLoading(true);
    try {
      const result = await completeNewPassword(values.newPassword);
      if (result.isSignedIn) {
        message.success('密码设置成功');
        navigate('/workbench');
      } else {
        message.error('设置密码后登录状态异常，请重新登录');
        setNeedNewPassword(false);
      }
    } catch (err: any) {
      message.error(err?.message || '密码设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <Card style={{ width: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <RobotOutlined style={{ fontSize: 48, color: '#1677ff' }} />
          <Typography.Title level={3} style={{ margin: '8px 0 0' }}>AI 客服工作台</Typography.Title>
          <Typography.Text type="secondary">
            {needNewPassword ? '首次登录，请设置新密码' : '智能问答审核平台'}
          </Typography.Text>
        </div>

        {!needNewPassword ? (
          <Form form={form} onFinish={handleLogin} size="large">
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
            </Form.Item>
          </Form>
        ) : (
          <Form form={newPwdForm} onFinish={handleNewPassword} size="large">
            <Form.Item
              name="newPassword"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '密码至少 8 位' },
              ]}
            >
              <Input.Password prefix={<KeyOutlined />} placeholder="新密码" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              rules={[
                { required: true, message: '请确认新密码' },
              ]}
            >
              <Input.Password prefix={<KeyOutlined />} placeholder="确认新密码" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>设置密码并登录</Button>
            </Form.Item>
          </Form>
        )}
      </Card>
    </div>
  );
};

export default Login;

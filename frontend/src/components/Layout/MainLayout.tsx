import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Avatar, Dropdown, Space, Typography } from 'antd';
import {
  CustomerServiceOutlined,
  DashboardOutlined,
  SettingOutlined,
  LogoutOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { getUser } from '../../services/auth';
import { logout } from '../../services/auth';

const { Header, Sider, Content } = Layout;

const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    getUser().then((user) => {
      if (user) setUsername(user.username);
    });
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const menuItems = [
    { key: '/workbench', icon: <CustomerServiceOutlined />, label: '工作台' },
    { key: '/dashboard', icon: <DashboardOutlined />, label: '数据看板' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <RobotOutlined style={{ fontSize: 24, color: '#fff' }} />
          {!collapsed && (
            <Typography.Text strong style={{ color: '#fff', marginLeft: 8, fontSize: 16 }}>
              AI 客服工作台
            </Typography.Text>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Dropdown
            menu={{
              items: [
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
              ],
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" style={{ backgroundColor: '#1677ff' }}>
                {username.charAt(0).toUpperCase()}
              </Avatar>
              <span>{username}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;

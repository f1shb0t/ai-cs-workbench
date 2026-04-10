import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export function formatTime(ts: number): string {
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss');
}

export function formatTimeAgo(ts: number): string {
  return dayjs(ts).fromNow();
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    pending_review: 'orange',
    approved: 'green',
    edited: 'blue',
    rejected: 'red',
    sent: 'green',
    send_failed: 'red',
    no_answer: 'default',
  };
  return map[status] || 'default';
}

export function statusText(status: string): string {
  const map: Record<string, string> = {
    pending_review: '待审核',
    approved: '已通过',
    edited: '已编辑',
    rejected: '已拒绝',
    sent: '已发送',
    send_failed: '发送失败',
    no_answer: '无答案',
    awaiting: '等待中',
  };
  return map[status] || status;
}

export function platformText(platform: string): string {
  const map: Record<string, string> = {
    android: 'Android',
    ios: 'iOS',
    web: 'Web',
    mail: '邮件',
  };
  return map[platform] || platform;
}

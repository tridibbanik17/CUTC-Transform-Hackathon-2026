import React, { useEffect } from 'react';

export type NotificationType = 'error' | 'warning' | 'info' | 'success';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
}

function getNotificationStyles(type: NotificationType) {
  switch (type) {
    case 'error':
      return { background: '#fce8e6', border: '#f28b82', color: '#b3261e' };
    case 'warning':
      return { background: '#fef7e0', border: '#fdd663', color: '#8a6d3b' };
    case 'success':
      return { background: '#e6f4ea', border: '#81c995', color: '#188038' };
    default:
      return { background: '#e8f0fe', border: '#aecbfa', color: '#1967d2' };
  }
}

function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: NotificationItem;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onDismiss(notification.id);
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [notification.id, onDismiss]);

  const styles = getNotificationStyles(notification.type);

  return (
    <div
      style={{
        background: styles.background,
        border: `1px solid ${styles.border}`,
        color: styles.color,
        borderRadius: '10px',
        padding: '10px 12px',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ flex: 1, fontSize: '12px', lineHeight: 1.45 }}>{notification.message}</div>
      <button
        type="button"
        onClick={() => onDismiss(notification.id)}
        style={{
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: '14px',
          lineHeight: 1,
          padding: 0,
        }}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

export function NotificationArea({
  notifications,
  onDismiss,
}: {
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
}) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
      {notifications.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

export const DEMO_USERS = {
  owner: 'owner@fxdesk.demo',
  sales: 'sales@fxdesk.demo',
  warehouse: 'warehouse@fxdesk.demo',
  marketing: 'marketing@fxdesk.demo',
} as const;

export type DemoRole = keyof typeof DEMO_USERS;

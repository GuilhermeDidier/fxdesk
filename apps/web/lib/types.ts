// Row shapes for the columns the screens read. Money columns are integers
// (see libs/money); PostgREST returns bigint as JSON numbers, and every
// amount this business handles stays far below 2^53.

export type Role = 'owner' | 'marketing' | 'sales' | 'warehouse';
export type OrderStatus = 'quote' | 'pending_approval' | 'confirmed' | 'cancelled';

export interface Tenant {
  id: string;
  name: string;
  brand_name: string;
  brand_color: string;
  timezone: string;
  sand_max_bps: number;
  red_max_bps: number;
  min_sdg_per_usd_e6: number;
  max_transfer_sdg: number;
}

export interface FxRate {
  id: number;
  rate_date: string;
  sdg_per_usd_e6: number;
  eur_per_usd_e6: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  price_usd_cents: number;
  min_stock: number;
}

export interface Customer {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  labels: string[];
}

export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  booked_on: string;
  customer_id: string;
  adviser_id: string;
  sdg_per_usd_e6: number;
  eur_per_usd_e6: number;
  total_usd_cents: number;
  total_sdg: number;
  total_eur_cents: number;
  paid_sdg: number;
  note: string | null;
  approved_at: string | null;
  released_at: string | null;
  converted_to: string | null;
  quoted_from: string | null;
  created_at: string;
}

export interface OrderLine {
  id: number;
  position: number;
  product_id: string;
  qty: number;
  unit_price_usd_cents: number;
  discount_bps: number;
  gross_usd_cents: number;
  discount_usd_cents: number;
  net_usd_cents: number;
}

export interface BankAccountStatus {
  bank_account_id: string;
  name: string;
  bank: string;
  daily_limit_sdg: number;
  received_today_sdg: number;
  remaining_today_sdg: number;
  received_total_sdg: number;
  unallocated_sdg: number;
}

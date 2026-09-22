import { formatRate, formatSdg, formatUsd } from '@fxdesk/money';

export interface WhatsAppOrder {
  number: number;
  status: string;
  booked_on: string;
  total_usd_cents: number;
  total_sdg: number;
  paid_sdg: number;
  sdg_per_usd_e6: number;
}

/**
 * A wa.me link with the order or quote summary, ready to send from the
 * adviser's own WhatsApp. Returns null when the customer has no usable number.
 */
export function whatsappLink(phone: string | null, brand: string, o: WhatsAppOrder, maxTransferSdg: number): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;

  const quote = o.status === 'quote';
  const lines = [
    `${brand}, ${quote ? 'quote' : 'order'} #${o.number}`,
    `Total: ${formatSdg(o.total_sdg)} (${formatUsd(o.total_usd_cents)} at ${formatRate(o.sdg_per_usd_e6)} SDG per dollar, rate of ${o.booked_on})`,
  ];
  if (quote) {
    lines.push('Prices are fixed in dollars. The pound amount is recalculated at the rate of the day you confirm.');
  } else {
    lines.push(`Still to pay: ${formatSdg(o.total_sdg - o.paid_sdg)}`);
    lines.push(`Please send transfers of at most ${formatSdg(maxTransferSdg)} and share each receipt here.`);
  }
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

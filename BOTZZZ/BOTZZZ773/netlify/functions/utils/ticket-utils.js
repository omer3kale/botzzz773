const crypto = require('crypto');
const { supabaseAdmin } = require('./supabase');

const TICKET_PREFIX = 'TCK';

function buildTicketNumberCandidate() {
  const timestampPart = Date.now().toString(36).toUpperCase().slice(-6);
  const randomBytes = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${TICKET_PREFIX}-${timestampPart}${randomBytes}`.slice(0, 20);
}

async function insertTicketRecord(payload = {}, options = {}) {
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ticketNumber = payload.ticket_number || buildTicketNumberCandidate();

    const insertPayload = {
      ...payload,
      ticket_number: ticketNumber
    };

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .insert(insertPayload)
      .select()
      .single();

    if (!error) {
      return data;
    }

    lastError = error;

    const isDuplicate = error?.code === '23505' || /duplicate/i.test(error?.message || '');
    const canRetry = !payload.ticket_number && isDuplicate;

    if (!canRetry) {
      break;
    }
  }

  throw lastError || new Error('Failed to insert ticket');
}

module.exports = {
  buildTicketNumberCandidate,
  insertTicketRecord
};

const crypto = require('crypto');
const { supabaseAdmin } = require('./supabase');

function buildTicketNumberCandidate() {
  // Preserve existing ticket_number behavior if still used elsewhere
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TCK-${ts}${rand}`.slice(0, 20);
}

function buildShortIdCandidate() {
  // Generate a 6-digit random numeric short ID (100000-999999)
  const number = Math.floor(100000 + Math.random() * 900000);
  return String(number);
}

async function insertTicketRecord(payload = {}, options = {}) {
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ticketNumber = payload.ticket_number || buildTicketNumberCandidate();
    const shortId = payload.short_id || buildShortIdCandidate();

    const insertPayload = {
      ...payload,
      ticket_number: ticketNumber,
      short_id: shortId
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
    const canRetry = (!payload.ticket_number || !payload.short_id) && isDuplicate;

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

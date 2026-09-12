// Catch-all handler for the Hartwell & Rowe mock booking API.
//
// Handles all five endpoints in ONE Vercel serverless function so they
// share the same in-memory store (see lib/store.js for why this must be a
// single file, not five separate ones):
//
//   POST /api/availability
//   POST /api/book
//   POST /api/confirm
//   POST /api/reset
//   GET  /api/bookings
//
// Every inbound request is logged to the console in a readable form —
// watching the tool calls land live (via `vercel logs` or the Vercel
// dashboard) is part of the demo.

const { PRACTICE_AREAS, getState, resetStore, generateBookingReference } = require("../lib/store");

const CONSULTATION_FEE = "£195 + VAT";

const DOCUMENTS_BY_AREA = {
  residential_conveyancing:
    "photo ID, proof of address dated within the last three months, the estate agent's details, the property address, and (if buying) their mortgage offer or agreement in principle",
  property_dispute:
    "photo ID, proof of address dated within the last three months, any letters or emails with the other party, their title deeds or Land Registry title plan if they have it, and any relevant photographs",
  commercial_property:
    "photo ID, proof of address dated within the last three months, the current lease, and any correspondence from the landlord or their agent",
};

function logRequest(method, pathname, body) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${method} ${pathname}`, body ? JSON.stringify(body) : "");
}

function sendJson(res, status, data) {
  res.status(status).json(data);
}

function tryParseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return value;
  }
}

function getArgs(body) {
  // Confirmed from a real live call's conversation log: the model produces
  // its tool-call arguments as an OpenAI-style JSON-ENCODED STRING (e.g.
  // `"{\"practice_area\":\"residential_conveyancing\"}"`), not a parsed
  // object. Telnyx's webhook delivery likely forwards that same string
  // through (under `arguments`, or possibly nested under
  // `function.arguments`/`tool_call.function.arguments`, mirroring the
  // OpenAI tool-calling shape) rather than a pre-parsed object — this was
  // the root cause of a real production bug where a well-formed
  // `practice_area` value was rejected as missing. Handle every level
  // defensively: check several likely locations, and JSON.parse() any of
  // them that come through as a string instead of an object.
  const candidates = [
    body?.arguments,
    body?.parameters,
    body?.input,
    body?.function?.arguments,
    body?.tool_call?.function?.arguments,
    body,
  ];

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }
  return {};
}

function handleAvailability(req, res) {
  const args = getArgs(req.body);
  const { practice_area, solicitor, preferred_period } = args;

  if (!practice_area || !PRACTICE_AREAS.includes(practice_area)) {
    return sendJson(res, 400, {
      error: "invalid_practice_area",
      message: `practice_area is required and must be one of: ${PRACTICE_AREAS.join(", ")}`,
    });
  }

  const { slots } = getState();
  const now = new Date();

  let candidates = slots.filter(
    (s) => !s.booked && s.practice_area === practice_area && new Date(s.datetime) > now
  );

  if (solicitor) {
    const needle = String(solicitor).toLowerCase();
    candidates = candidates.filter(
      (s) =>
        s.solicitor_name.toLowerCase().includes(needle) ||
        s.solicitor_id.toLowerCase() === needle
    );
  }

  if (preferred_period === "morning") {
    candidates = candidates.filter((s) => Number(s.time.split(":")[0]) < 12);
  } else if (preferred_period === "afternoon") {
    candidates = candidates.filter((s) => Number(s.time.split(":")[0]) >= 12);
  }

  const top3 = candidates.slice(0, 3).map((s) => ({
    slot_id: s.slot_id,
    solicitor_name: s.solicitor_name,
    solicitor_role: s.solicitor_role,
    date: s.date,
    day_of_week: s.day_of_week,
    time: s.time,
  }));

  return sendJson(res, 200, {
    practice_area,
    available: top3.length > 0,
    slots: top3,
  });
}

function handleBook(req, res) {
  const args = getArgs(req.body);
  const {
    full_name,
    phone,
    email,
    slot_id,
    format,
    practice_area,
    property_address,
    matter_summary,
    other_parties,
    referral_source,
  } = args;

  if (!full_name || !phone || !slot_id || !practice_area) {
    return sendJson(res, 400, {
      error: "missing_required_field",
      message: "full_name, phone, slot_id, and practice_area are all required",
    });
  }

  const state = getState();
  const slot = state.slots.find((s) => s.slot_id === slot_id);

  if (!slot) {
    return sendJson(res, 404, {
      error: "slot_not_found",
      message: "That slot doesn't exist — please check availability again.",
    });
  }
  if (slot.booked) {
    return sendJson(res, 409, {
      error: "slot_already_booked",
      message: "That slot's just gone. Please check availability again for another option.",
    });
  }

  slot.booked = true;
  const booking_reference = generateBookingReference();
  const booking = {
    booking_reference,
    full_name,
    phone,
    email: email || null,
    slot_id,
    solicitor_name: slot.solicitor_name,
    date: slot.date,
    day_of_week: slot.day_of_week,
    time: slot.time,
    format: format || "in_person",
    practice_area,
    property_address: property_address || null,
    matter_summary: matter_summary || null,
    other_parties: other_parties || null,
    referral_source: referral_source || null,
    created_at: new Date().toISOString(),
  };
  state.bookings.push(booking);

  return sendJson(res, 200, {
    booking_reference,
    solicitor_name: slot.solicitor_name,
    date: slot.date,
    day_of_week: slot.day_of_week,
    time: slot.time,
    format: booking.format,
  });
}

function handleConfirm(req, res) {
  const args = getArgs(req.body);
  const { booking_reference, channel } = args;

  if (!booking_reference) {
    return sendJson(res, 400, {
      error: "missing_booking_reference",
      message: "booking_reference is required",
    });
  }

  const state = getState();
  const booking = state.bookings.find((b) => b.booking_reference === booking_reference);
  if (!booking) {
    return sendJson(res, 404, {
      error: "booking_not_found",
      message: "No booking found with that reference.",
    });
  }

  const documents = DOCUMENTS_BY_AREA[booking.practice_area] || "photo ID and proof of address";
  const message =
    `Hartwell & Rowe Solicitors — appointment confirmed.\n` +
    `${booking.solicitor_name}, ${booking.day_of_week} ${booking.date} at ${booking.time} (${booking.format}).\n` +
    `Initial consultation fee: ${CONSULTATION_FEE} (payable in advance by secure link).\n` +
    `Please bring: ${documents}.\n` +
    `Reference: ${booking.booking_reference}`;

  // Mock only — logs the message rather than actually sending it, per the
  // demo brief (no real SMS/email integration wired up for this build).
  console.log(`[MOCK SEND — ${channel || "sms"}]`, message);

  return sendJson(res, 200, {
    success: true,
    channel: channel || "sms",
    sent: "mock", // true integration not wired up for this demo
    message,
  });
}

function handleReset(req, res) {
  const state = resetStore();
  return sendJson(res, 200, {
    reset: true,
    slot_count: state.slots.length,
    seeded_at: state.seededAt,
  });
}

function handleBookings(req, res) {
  const { bookings } = getState();
  return sendJson(res, 200, { bookings });
}

module.exports = async (req, res) => {
  const pathname = (req.url || "").split("?")[0];
  logRequest(req.method, pathname, req.body);

  try {
    if (pathname.endsWith("/availability") && req.method === "POST") {
      return handleAvailability(req, res);
    }
    if (pathname.endsWith("/book") && req.method === "POST") {
      return handleBook(req, res);
    }
    if (pathname.endsWith("/confirm") && req.method === "POST") {
      return handleConfirm(req, res);
    }
    if (pathname.endsWith("/reset") && req.method === "POST") {
      return handleReset(req, res);
    }
    if (pathname.endsWith("/bookings") && req.method === "GET") {
      return handleBookings(req, res);
    }
    return sendJson(res, 404, { error: "not_found", path: pathname, method: req.method });
  } catch (err) {
    console.error("Unhandled error:", err);
    return sendJson(res, 500, { error: "internal_error", message: String(err && err.message) });
  }
};

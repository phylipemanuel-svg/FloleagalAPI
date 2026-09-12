// Shared in-memory store for the Hartwell & Rowe mock booking API.
//
// IMPORTANT ARCHITECTURE NOTE: on Vercel, every file under api/ is deployed
// as a SEPARATE serverless function with its own isolated process memory.
// If /api/availability.js and /api/book.js were separate files, a booking
// made via one would never be visible to the other — there is no shared
// memory between distinct Vercel functions. To get a single shared
// in-memory store (as the demo needs — book a slot, then see it reflected
// in availability), ALL FIVE endpoints are handled by one catch-all
// function (api/[...path].js) that imports this module. The module-level
// `state` object below persists only for the lifetime of one warm
// serverless instance — a cold start resets it. That's a known, accepted
// tradeoff for this demo (plain in-memory, no external KV/database).

const PRACTICE_AREAS = [
  "residential_conveyancing",
  "property_dispute",
  "commercial_property",
];

const SOLICITORS = [
  {
    id: "drowe",
    name: "Daniel Rowe",
    role: "Partner",
    areas: ["residential_conveyancing"],
    pattern: ["Tue 10:00", "Tue 15:30", "Wed 09:30", "Thu 14:00", "Fri 11:00"],
  },
  {
    id: "tbennett",
    name: "Tom Bennett",
    role: "Associate",
    areas: ["residential_conveyancing"],
    pattern: ["Mon 13:00", "Wed 11:30", "Thu 09:00", "Fri 15:00"],
  },
  {
    id: "rhartwell",
    name: "Rachel Hartwell",
    role: "Partner",
    areas: ["property_dispute"],
    pattern: ["Tue 09:00", "Wed 14:30", "Thu 16:00", "Fri 10:30"],
  },
  {
    id: "pshah",
    name: "Priya Shah",
    role: "Senior Associate",
    areas: ["commercial_property"],
    pattern: ["Mon 10:00", "Wed 16:00", "Thu 11:00"],
  },
];

// Known UK bank holidays covering late 2026 into 2027 (enough range for a
// demo run any time soon). Not a general Easter-calculation algorithm —
// good enough for a mock demo, not for production scheduling.
const UK_BANK_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-04-03", // Good Friday
  "2026-04-06", // Easter Monday
  "2026-05-04", // Early May bank holiday
  "2026-05-25", // Spring bank holiday
  "2026-08-31", // Summer bank holiday
  "2026-12-25",
  "2026-12-28", // Boxing Day (26th is a Saturday, substitute day)
  "2027-01-01",
  "2027-04-02", // Good Friday
  "2027-04-05", // Easter Monday
  "2027-05-03",
  "2027-05-31",
  "2027-08-30",
  "2027-12-27", // Christmas Day substitute (25th is a Saturday)
  "2027-12-28", // Boxing Day substitute (26th is a Sunday)
]);

const DAY_NAME_TO_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function generateSlotsForNext14Days(now = new Date()) {
  const slots = [];
  for (let offset = 0; offset < 14; offset++) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + offset);
    day.setUTCHours(0, 0, 0, 0);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekend
    const dateStr = isoDate(day);
    if (UK_BANK_HOLIDAYS.has(dateStr)) continue;

    for (const solicitor of SOLICITORS) {
      for (const entry of solicitor.pattern) {
        const [dayName, time] = entry.split(" ");
        if (DAY_NAME_TO_NUM[dayName] !== dow) continue;
        const [hh, mm] = time.split(":").map(Number);
        const slotDate = new Date(day);
        slotDate.setUTCHours(hh, mm, 0, 0);
        if (slotDate <= now) continue; // only future slots

        const slotId = `${solicitor.id}-${dateStr}-${time.replace(":", "")}`;
        slots.push({
          slot_id: slotId,
          solicitor_id: solicitor.id,
          solicitor_name: solicitor.name,
          solicitor_role: solicitor.role,
          practice_area: solicitor.areas[0],
          date: dateStr,
          day_of_week: dayName,
          time,
          datetime: slotDate.toISOString(),
          booked: false,
        });
      }
    }
  }
  slots.sort((a, b) => a.datetime.localeCompare(b.datetime));
  return slots;
}

function seed() {
  const now = new Date();
  const slots = generateSlotsForNext14Days(now);
  // Mark 2-3 slots in the first week as already booked, per the brief, so
  // the agent has to say "that one's gone, but I could do..." at least once.
  const firstWeek = slots.filter((s) => {
    const d = new Date(s.datetime);
    return (d - now) / (1000 * 60 * 60 * 24) <= 7;
  });
  const toPreBook = firstWeek.slice(0, 3);
  for (const s of toPreBook) s.booked = true;

  return {
    slots,
    bookings: [],
    seededAt: now.toISOString(),
  };
}

// Module-scope state — persists across warm invocations of THIS function
// only (see architecture note above).
let state = seed();

function resetStore() {
  state = seed();
  return state;
}

function getState() {
  return state;
}

function generateBookingReference() {
  const chars = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I to avoid ambiguity when read aloud
  let ref = "HR-";
  for (let i = 0; i < 4; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}

module.exports = {
  PRACTICE_AREAS,
  SOLICITORS,
  getState,
  resetStore,
  generateBookingReference,
};

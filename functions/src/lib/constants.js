// Shared backend constants. Mirrors the frontend's FMT.ITBMS_RATE so
// a rate change is a single edit on each side instead of a hunt.
// If the rate ever needs to vary per region or per customer, move to
// a Firestore config doc read at function init.
const ITBMS_RATE = 0.07;

module.exports = { ITBMS_RATE };

// Name-moderation tests for the leaderboard validator.
//   deno test --allow-read name_test.ts
// Two guarantees: innocent handles are never rejected (the Scunthorpe problem), and obvious
// evasions (leetspeak, spacing, punctuation, repeated letters) are still caught.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isNameBlocked } from "./index.ts";

// ── Must PASS: ordinary words, place names, surnames and plausible handles ───
const ALLOWED = [
  // the classic substring traps
  "Scunthorpe", "Penistone", "Clitheroe", "Lightwater", "Cockburn", "Hancock", "Hitchcock",
  "Middlesex", "Sussex", "Essex", "Sexton", "Sextant", "Titmouse", "Titan", "Titanium",
  "Assassin", "Assassinate", "Classic", "Class", "Bass", "Brass", "Grass", "Glass", "Password",
  "Massachusetts", "Assume", "Assess", "Assist", "Assign", "Embarrass", "Harassment", "Cassette",
  "Ambassador", "Bassett", "Hello", "Shelter", "Shellfish", "Michelle", "Cumulus", "Cucumber",
  "Accumulate", "Document", "Circumstance", "Analysis", "Analyst", "Banal", "Canal",
  "Constitution", "Institute", "Butter", "Button", "Buttress", "Cockpit", "Cocktail", "Cockroach",
  "Peacock", "Shuttlecock", "Arsenal", "Sparse", "Coarse", "Hoarse", "Dickens", "Dickinson",
  "Therapist", "Specialist", "Cummings", "Matsushita", "Shiitake", "Arsenic", "Fagin", "Hoare",
  // game-flavoured handles
  "Knight", "Bishop", "Rook", "Pawn", "Queen", "King", "MadKraken", "Griffindohr", "Charlie",
  // multi-word handles — their parts are innocent alone and must not be tokenised as profanity
  "Black Knight", "White Queen", "One Punch Man", "My King", "Top Gun", "Love and Peace",
  "Big Boss", "Hot Rod", "Action Hero", "Party Time", "Power Up", "Girl Gamer", "Come On",
  "How To Win", "Men At Arms", "Women Warriors", "Blue Bishop", "I hate this game",
  "One of Us", "To The Top", "Golden Knight",
  // short words that repeat-collapsing must not fold onto profanity
  "Fast As Light", "All But One", "As Above", "But Why",
];

// ── Must BLOCK: plain, cased, spaced, punctuated, leetspeak, repeated, embedded ───
const BLOCKED = [
  "fuck", "FUCK", "Fuck You", "f.u.c.k", "f u c k", "f-u-c-k", "fuuuuck", "xXfuckXx",
  "MOTHERFUCKER", "sh1t", "$hit", "bitch", "B!tch", "b i t c h", "b1tch3s",
  "asshole", "a55hole", "buuutt", "aaassss", "wh0re", "c0ck", "dildo", "big black cock",
];

Deno.test("innocent names are never blocked", () => {
  const wrong = ALLOWED.filter((n) => isNameBlocked(n));
  assert(wrong.length === 0, `false positives: ${JSON.stringify(wrong)}`);
});

Deno.test("profanity and evasions are blocked", () => {
  const missed = BLOCKED.filter((n) => !isNameBlocked(n));
  assert(missed.length === 0, `missed ${missed.length} of ${BLOCKED.length}`);
});

Deno.test("empty and punctuation-only names are not blocked (handled by the empty-name check)", () => {
  assert(!isNameBlocked(""));
  assert(!isNameBlocked("---"));
});

Deno.test("unicode look-alikes and diacritics are normalized", () => {
  assert(isNameBlocked("fück"));      // diacritic stripped
  assert(isNameBlocked("ｆｕｃｋ"));   // fullwidth forms
});

// Status and reputation are computed from the raw records every time, never stored.
// That keeps them consistent: change a rule here and every number updates.

export const RULES = {
  verifyMin: 3,            // confirmations needed to be "verified"…
  verifyRatio: 2,          // …and at least this many confirms per challenge
  disputeMin: 2,           // challenges needed to be "disputed" (and challenges >= confirms)
  points: {
    authoredVerified: 40,
    authoredDisputed: -60,
    evidenceOnchain: 10,    // per on-chain-verified tx added to someone else's case
    confirmRight: 5,        // confirmed a case that ended verified
    challengeRight: 25,     // challenged a case that ended disputed
    reviewWrong: -10,       // confirmed a disputed case, or challenged a verified one
  },
};

export function statusOf(confirms, challenges) {
  const c = Number(confirms) || 0, h = Number(challenges) || 0;
  if (c >= RULES.verifyMin && c >= RULES.verifyRatio * h) return 'verified';
  if (h >= RULES.disputeMin && h >= c) return 'disputed';
  if (c + h > 0) return 'under_review';
  return 'open';
}

/** Per-user reputation, accuracy and counts. `since` (unix seconds) limits the window. */
export function computeReputation(db, since = 0) {
  const invs = db.prepare(`
    SELECT i.id, i.author_id, i.created_at,
      COALESCE(SUM(r.verdict = 'confirm'), 0) AS c,
      COALESCE(SUM(r.verdict = 'challenge'), 0) AS h
    FROM investigations i LEFT JOIN reviews r ON r.investigation_id = i.id
    GROUP BY i.id`).all();
  const status = new Map(invs.map((i) => [i.id, statusOf(i.c, i.h)]));
  const P = RULES.points;
  const users = new Map();
  const u = (id) => {
    if (!users.has(id)) users.set(id, { userId: id, reputation: 0, verified: 0, disputed: 0, authored: 0, reviews: 0, challengesWon: 0, challenges: 0, evidence: 0 });
    return users.get(id);
  };

  for (const i of invs) {
    if (i.created_at < since) continue;
    const a = u(i.author_id); a.authored++;
    const s = status.get(i.id);
    if (s === 'verified') { a.verified++; a.reputation += P.authoredVerified; }
    if (s === 'disputed') { a.disputed++; a.reputation += P.authoredDisputed; }
  }

  for (const e of db.prepare(`
    SELECT e.user_id, e.created_at FROM evidence e JOIN investigations i ON i.id = e.investigation_id
    WHERE e.onchain_ok = 1 AND e.user_id != i.author_id AND e.created_at >= ?`).all(since)) {
    const x = u(e.user_id); x.evidence++; x.reputation += P.evidenceOnchain;
  }

  for (const r of db.prepare('SELECT investigation_id, user_id, verdict FROM reviews WHERE created_at >= ?').all(since)) {
    const x = u(r.user_id); x.reviews++;
    const s = status.get(r.investigation_id);
    if (r.verdict === 'challenge') x.challenges++;
    if (r.verdict === 'confirm' && s === 'verified') x.reputation += P.confirmRight;
    else if (r.verdict === 'challenge' && s === 'disputed') { x.reputation += P.challengeRight; x.challengesWon++; }
    else if ((r.verdict === 'confirm' && s === 'disputed') || (r.verdict === 'challenge' && s === 'verified')) x.reputation += P.reviewWrong;
  }

  for (const x of users.values()) {
    const decided = x.verified + x.disputed;
    x.accuracy = decided ? Math.round((x.verified / decided) * 100) : null;
  }
  return users;
}

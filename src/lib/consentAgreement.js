/**
 * Aegis-Split User Consent Agreement — displayed in UI and referenced in ConsentLogs.
 * Version bumps when substantive terms change.
 */

const USER_CONSENT_AGREEMENT_VERSION = '2.0.0';

const USER_CONSENT_AGREEMENT_TITLE = 'Aegis-Split User Consent Agreement';

const USER_CONSENT_AGREEMENT_MARKDOWN = `# Aegis-Split User Consent Agreement

**Version ${USER_CONSENT_AGREEMENT_VERSION}**

By ticking “I agree” and providing your name and the date, you confirm you have read and accept this Agreement.

## 1. Identity verification

You agree to complete government-ID verification (DigiLocker in India, or an equivalent regional verifier elsewhere) before creating projects, funding escrow, posting a security deposit, linking GitHub work, or merging code. False identity information is grounds for account suspension and forfeiture of deposits where allowed by this Agreement.

## 2. Platform-only communication

For active engagements on Aegis-Split, you agree to keep project-related negotiation, delivery updates, and payment discussions on the platform. Off-platform deals that bypass escrow void platform protections. On-platform chats and call recordings may be monitored and accessed for dispute resolution and counseling.

## 3. Exit and penalty rules

Money is held in a client vault (PayPal Orders capture) plus an optional freelancer security deposit (same approve → capture rails). Amounts use integer cents; percentages use floor rounding.

**Security deposit.** Before work starts, the freelancer funds a deposit (default **10%** of the milestone total, or the amount set on the project). While held, it may be returned or forfeited under the paths below. On successful completion (AI audit PASS and milestone payout), the deposit is returned to the freelancer.

**Mutual cancel.** Either party may request cancellation in-app; the other must accept. Then: refund **100%** of the unspent vault to the client; return the freelancer deposit. **No penalty.**

**Client one-sided cancel.** If the client cancels without freelancer agreement and without a failed audit: deduct **earlyExitPenaltyPercent** (default **20%**) of the **remaining vault** and pay that amount to the freelancer via PayPal Payouts; refund the rest of the remaining vault to the client; return the freelancer deposit.

**Freelancer walk-away.** If the freelancer abandons the engagement: forfeit the freelancer deposit to the client; refund **100%** of the client’s unspent vault. No additional vault penalty beyond deposit forfeiture.

After any of these exits, the project status becomes \`CANCELLED_MUTUAL\`, \`CANCELLED_BY_CLIENT\`, or \`ABANDONED_BY_FREELANCER\`. Funding, GitHub linking, and merges are blocked.

## 4. Code of conduct

Treat the other party with professionalism. Do not harass, threaten, or submit knowingly fraudulent work or acceptance criteria. Abuse may lead to suspension, cancelled engagements under Section 3, and reporting where required by law.

## 5. Dispute resolution

Disputes use platform records (milestones, audits, funding/payout history, and consented monitoring materials). Parties should first use in-app cancellation or exit paths in Section 3. Remaining disputes may be escalated through Aegis-Split support for review against this Agreement and recorded evidence.

---

*Payment rails are PayPal (Orders, Captures refunds, Payouts). Aegis-Split is not a bank. Sandbox and mock modes simulate transfers for demos; live refunds depend on PayPal capture refund availability.*
`;

module.exports = {
  USER_CONSENT_AGREEMENT_VERSION,
  USER_CONSENT_AGREEMENT_TITLE,
  USER_CONSENT_AGREEMENT_MARKDOWN,
};
